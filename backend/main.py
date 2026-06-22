"""
main.py — Backend 2SL LOG (FastAPI)
------------------------------------
Endpoints:
  POST /solve       — Executa OR-Tools VRP e retorna rotas otimizadas
  POST /chat        — Chat com Gemini (com histórico por session_id)
  POST /sync        — Dispara sincronização manual TOTVS → Firebase
  GET  /status      — Health check + info da última sincronização
  GET  /pedidos     — Lista pedidos pendentes do Firebase (proxy)

Deploy: Railway.app (ver railway.toml)
Docs:   http://localhost:8000/docs  (Swagger automático do FastAPI)
"""

import os
import logging
import uuid
from typing import Optional

import requests as req_lib
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vrp_solver   import solve_vrp
from gemini_agent import GeminiChat, analisar_rotas_geradas, consulta_unica

try:
    from totvs_sync import sincronizar
except Exception:
    def sincronizar():
        raise RuntimeError("Sync TOTVS indisponivel neste ambiente.")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="2SL LOG — Backend",
    description="Motor OR-Tools VRP + Gemini AI + Sync TOTVS",
    version="2.0.0",
)

# CORS — permite chamadas do GitHub Pages (ajuste o domínio conforme necessário)
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://seu-usuario.github.io,http://localhost:3000,http://127.0.0.1:5500"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Firebase helpers ──────────────────────────────────────────────────────────

FIREBASE_URL    = os.getenv("FIREBASE_URL", "https://slog-pedidos-default-rtdb.firebaseio.com")
FIREBASE_SECRET = os.getenv("FIREBASE_SECRET", "")

def _fb(path: str) -> str:
    return f"{FIREBASE_URL}/{path}.json?auth={FIREBASE_SECRET}"

def _carregar_pedidos_firebase() -> list[dict]:
    resp = req_lib.get(_fb("pedidos_rota"), timeout=10)
    if not resp.ok or not resp.json():
        return []
    data = resp.json()
    return list(data.values()) if isinstance(data, dict) else []

def _salvar_rota_firebase(payload: dict) -> None:
    req_lib.post(_fb("rotas"), json=payload, timeout=10)

# ── Chaves de sessão chat (em memória; escala horizontal requer Redis) ────────

_sessions: dict[str, GeminiChat] = {}

def _get_session(sid: str) -> GeminiChat:
    if sid not in _sessions:
        _sessions[sid] = GeminiChat()
        # Limpa sessões antigas se passar de 500 (proteção simples)
        if len(_sessions) > 500:
            oldest = list(_sessions.keys())[0]
            del _sessions[oldest]
    return _sessions[sid]

# ── Schemas Pydantic ──────────────────────────────────────────────────────────

class Veiculo(BaseModel):
    id:     str
    nome:   str
    capKg:  float
    maxPed: int = 10

class SolveRequest(BaseModel):
    veiculos:     list[Veiculo]
    time_limit_s: int = 30          # tempo máximo solver (s)
    # Opcionalmente passa pedidos direto (evita busca extra no Firebase)
    pedidos:      Optional[list[dict]] = None

class ChatRequest(BaseModel):
    mensagem:   str
    session_id: str = ""
    # Contexto opcional para atualizar o agente antes de responder
    rotas:      Optional[list[dict]] = None
    veiculo:    Optional[str] = None
    cap_kg:     Optional[int] = None

class SyncRequest(BaseModel):
    # Corpo vazio — apenas POST para disparar
    pass

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/status")
def status():
    """Health check. Retorna versão e última sincronização TOTVS."""
    sync_resp = req_lib.get(_fb("sync_log/ultimo"), timeout=5)
    sync_data = sync_resp.json() if sync_resp.ok else {}
    return {
        "status": "online",
        "versao": "2.0.0",
        "motor": "OR-Tools VRP",
        "ia": "Gemini 1.5 Flash",
        "ultima_sync": sync_data,
    }


@app.get("/pedidos")
def listar_pedidos():
    """Retorna pedidos pendentes do Firebase."""
    try:
        pedidos = _carregar_pedidos_firebase()
        pendentes = [p for p in pedidos if p.get("status") == "pendente"]
        return {"total": len(pendentes), "pedidos": pendentes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/solve")
def solve(body: SolveRequest):
    """
    Executa OR-Tools VRP.

    Fluxo:
    1. Carrega pedidos do Firebase (ou usa body.pedidos se fornecidos)
    2. Roda VRP solver
    3. Salva rotas no Firebase
    4. Gera análise automática com Gemini
    5. Retorna rotas + análise
    """
    try:
        # 1. Pedidos
        pedidos = body.pedidos or _carregar_pedidos_firebase()
        pendentes = [p for p in pedidos if p.get("status") == "pendente"]

        if not pendentes:
            return {"routes": [], "analise_ia": "Nenhum pedido pendente encontrado.", "nao_alocados": []}

        # 2. Solver
        veiculos_dict = [v.model_dump() for v in body.veiculos]
        resultado = solve_vrp(pendentes, veiculos_dict, body.time_limit_s)

        routes    = resultado["routes"]
        n_aloc    = resultado["nao_alocados"]
        fonte     = resultado["fonte_distancia"]
        status_vp = resultado["solver_status"]

        logger.info("Solver: %d rotas | %d não alocados | fonte: %s | status: %s",
                    len(routes), len(n_aloc), fonte, status_vp)

        # 3. Salvar no Firebase
        veiculo_nome = body.veiculos[0].nome if body.veiculos else "—"
        cap_kg_val   = body.veiculos[0].capKg if body.veiculos else 0

        _salvar_rota_firebase({
            "criadoEm":    __import__("datetime").datetime.utcnow().isoformat(),
            "veiculo":     veiculo_nome,
            "status":      "ativa",
            "total_rotas": len(routes),
            "fonte_dist":  fonte,
            "rotas": [
                {
                    "veiculo":  r["veiculo"],
                    "km":       r["km"],
                    "mins":     r["mins"],
                    "pedidos":  [p["nf"] for p in r["pedidos"]],
                }
                for r in routes
            ],
        })

        # Marca pedidos roteirizados no Firebase
        for r in routes:
            for p in r["pedidos"]:
                try:
                    req_lib.patch(
                        _fb(f"pedidos_rota/{p['nf']}"),
                        json={"status": "roteirizado"},
                        timeout=5,
                    )
                except Exception:
                    pass

        # 4. Análise Gemini
        try:
            analise = analisar_rotas_geradas(
                routes, pendentes, n_aloc, veiculo_nome, int(cap_kg_val)
            )
        except Exception as e:
            logger.warning("Gemini indisponível: %s", e)
            analise = (
                f"Motor OR-Tools gerou {len(routes)} rota(s) com {sum(len(r['pedidos']) for r in routes)} "
                f"entregas totais. {('Pedidos não alocados: ' + ', '.join(n_aloc)) if n_aloc else 'Todos os pedidos foram alocados.'}"
            )

        return {
            "routes":            routes,
            "nao_alocados":      n_aloc,
            "fonte_distancia":   fonte,
            "solver_status":     status_vp,
            "analise_ia":        analise,
        }

    except Exception as e:
        logger.exception("Erro no /solve: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
def chat(body: ChatRequest):
    """
    Chat com Gemini.
    Mantém histórico por session_id.
    Se session_id vazio, cria nova sessão e retorna o ID.
    """
    try:
        sid = body.session_id or str(uuid.uuid4())
        session = _get_session(sid)

        # Atualiza contexto com dados frescos
        pedidos = _carregar_pedidos_firebase()
        session.atualizar_contexto(
            pedidos,
            rotas=body.rotas,
            veiculo=body.veiculo,
            cap_kg=body.cap_kg,
        )

        resposta = session.enviar(body.mensagem)
        return {"resposta": resposta, "session_id": sid}

    except Exception as e:
        logger.exception("Erro no /chat: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/sync")
def sync_totvs():
    """Dispara sincronização manual TOTVS → Firebase."""
    try:
        sincronizar()
        return {"status": "ok", "mensagem": "Sincronização TOTVS concluída."}
    except Exception as e:
        logger.exception("Erro no /sync: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Servidor local ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
