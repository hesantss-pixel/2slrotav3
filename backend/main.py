"""
main.py — Servidor de rotas do ROTAV3 (FastAPI)
-----------------------------------------------
Endpoints (todos, menos /status, exigem login — ver auth_firebase.py):
  POST /solve       — Monta as rotas (OR-Tools VRP) a partir dos pedidos
  POST /chat        — Assistente de IA (com histórico por session_id)
  POST /upload-nf   — Lê notas fiscais (PDF, XML, XLSX, CSV)
  POST /sync        — Sincronização manual TOTVS → Firebase (opcional)
  GET  /status      — Verificação de funcionamento (público)
  GET  /pedidos     — Lista pedidos pendentes do Firebase

Deploy: Railway.app (ver railway.toml)
Docs:   http://localhost:8000/docs  (Swagger automático do FastAPI)
"""

import os
import logging
import uuid
from typing import Optional

import requests as req_lib
from fastapi import Depends, FastAPI, HTTPException, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from vrp_solver   import solve_vrp
from groq_agent import GroqChat as GeminiChat, consulta_unica, analisar_rotas_geradas
from nf_parser    import parse_many
import auth_firebase

try:
    from totvs_sync import sincronizar
except Exception:
    def sincronizar():
        raise RuntimeError("Sync TOTVS indisponivel neste ambiente.")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ROTAV3 — Servidor de rotas",
    description="Roteirização (OR-Tools VRP), assistente de IA e leitura de notas fiscais",
    version="3.2.0",
    docs_url="/docs" if os.getenv("DOCS_PUBLICAS", "0") == "1" else None,
    redoc_url=None,
)

# CORS — de onde a tela pode chamar este servidor (separe por vírgula)
ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "https://hesantss-pixel.github.io,https://app.rotav3.com.br,"
    "http://localhost:8080,http://127.0.0.1:8080,http://127.0.0.1:5500"
).split(",") if o.strip()]

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

def _salvar_rota_firebase(payload: dict) -> bool:
    r = req_lib.post(_fb("rotas"), json=payload, timeout=10)
    return r.ok

_STATUS_FINAIS = {"despachado", "entregue", "confirmado"}

def _salvar_pedido_firebase(pedido: dict) -> str:
    """
    Upsert idempotente por NF em pedidos_rota/<nf>.
    - Se a NF já existe com status em {despachado, entregue, confirmado}:
      não sobrescreve (preserva o histórico).
    - Se existe como 'pendente' ou é novo: grava.
    Retorna: 'novo', 'atualizado', 'preservado' ou 'erro'.
    """
    nf = str(pedido.get("nf", "")).strip()
    if not nf:
        return "erro"
    try:
        atual = req_lib.get(_fb(f"pedidos_rota/{nf}"), timeout=5)
        existente = atual.json() if atual.ok else None
        if isinstance(existente, dict):
            if existente.get("status") in _STATUS_FINAIS:
                return "preservado"
            r = req_lib.put(_fb(f"pedidos_rota/{nf}"), json=pedido, timeout=10)
            return "atualizado" if r.ok else "erro"
        r = req_lib.put(_fb(f"pedidos_rota/{nf}"), json=pedido, timeout=10)
        return "novo" if r.ok else "erro"
    except Exception as e:
        logger.warning("Firebase upsert falhou nf=%s: %s", nf, e)
        return "erro"

def _tem_segredo() -> bool:
    return bool(FIREBASE_SECRET)


def exigir_login(authorization: Optional[str] = Header(None)) -> str:
    """Dependência dos endpoints protegidos: devolve o uid do usuário liberado."""
    try:
        return auth_firebase.verificar(authorization)
    except auth_firebase.AuthError as e:
        raise HTTPException(status_code=e.status, detail=e.mensagem)


class Deposito(BaseModel):
    lat:  float
    lng:  float
    nome: str = "Centro de distribuição"


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
    """
    Aceita dois formatos:
      Novo:     {veiculos:[{id,nome,capKg,maxPed}], time_limit_s?, pedidos?}
      Legado:   {pedidos:[...], capacidade_kg:float, max_paradas:int, veiculo?:str}
    O legado é convertido internamente em um Veiculo único.
    """
    model_config = {"extra": "ignore"}

    veiculos:     Optional[list[Veiculo]] = None
    time_limit_s: int = 30
    pedidos:      Optional[list[dict]] = None
    deposito:     Optional[Deposito] = None
    # Hora de saída do CD em minutos desde a meia-noite (ex.: 420 = 07:00).
    # Com ela, os pedidos com janela_ini/janela_fim respeitam o horário.
    hora_saida:   Optional[int] = None

    # Campos legado (frontend antigo)
    capacidade_kg: Optional[float] = None
    max_paradas:   Optional[int]   = None
    veiculo:       Optional[str]   = None

    def frota(self) -> list[Veiculo]:
        if self.veiculos:
            return self.veiculos
        if self.capacidade_kg is not None:
            return [Veiculo(
                id     = "v1",
                nome   = self.veiculo or "Veículo",
                capKg  = float(self.capacidade_kg),
                maxPed = int(self.max_paradas or 10),
            )]
        raise HTTPException(
            status_code=422,
            detail="Envie 'veiculos:[...]' ou 'capacidade_kg' + 'max_paradas'.",
        )

class ChatRequest(BaseModel):
    mensagem:   str
    session_id: str = ""
    # Contexto opcional para atualizar o agente antes de responder
    rotas:      Optional[list[dict]] = None
    veiculo:    Optional[str] = None
    cap_kg:     Optional[int] = None
    pedidos:    Optional[list[dict]] = None

class SyncRequest(BaseModel):
    # Corpo vazio — apenas POST para disparar
    pass

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/status")
def status():
    """Verificação de funcionamento (pública, sem dados da operação)."""
    return {
        "status": "online",
        "versao": "3.2.0",
        "login": "obrigatório" if auth_firebase.AUTH_REQUIRED else "desligado (teste local)",
    }


@app.get("/pedidos")
def listar_pedidos(uid: str = Depends(exigir_login)):
    """Retorna pedidos pendentes do Firebase."""
    try:
        pedidos = _carregar_pedidos_firebase()
        pendentes = [p for p in pedidos if p.get("status") == "pendente"]
        return {"total": len(pendentes), "pedidos": pendentes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/solve")
def solve(body: SolveRequest, uid: str = Depends(exigir_login)):
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
        # 1. Frota (aceita formato novo e legado)
        frota = body.frota()

        # 2. Pedidos — inclui tudo que NÃO foi despachado/entregue/confirmado.
        # /solve é apenas PREVIEW; a "consumação" da NF acontece só quando o
        # frontend chama confirmarRotaD() e grava status=despachado.
        pedidos = body.pedidos or _carregar_pedidos_firebase()
        pendentes = [p for p in pedidos if p.get("status", "pendente") not in _STATUS_FINAIS]

        if not pendentes:
            return {
                "routes": [], "rotas": [],
                "analise_ia": "Nenhum pedido pendente encontrado.",
                "nao_alocados": [],
            }

        # 3. Solver
        veiculos_dict = [v.model_dump() for v in frota]
        deposito = body.deposito.model_dump() if body.deposito else None
        resultado = solve_vrp(pendentes, veiculos_dict, body.time_limit_s, deposito, body.hora_saida)

        routes    = resultado["routes"]
        n_aloc    = resultado["nao_alocados"]
        fonte     = resultado["fonte_distancia"]
        status_vp = resultado["solver_status"]

        logger.info("Solver: %d rotas | %d não alocados | fonte: %s | status: %s",
                    len(routes), len(n_aloc), fonte, status_vp)

        # 4. Salvar no Firebase
        veiculo_nome = frota[0].nome
        cap_kg_val   = frota[0].capKg

        salvo = False
        if _tem_segredo():
            try:
                salvo = _salvar_rota_firebase({
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
                            "pedidos":  [str(p.get("id") or p["nf"]) for p in r["pedidos"]],
                        }
                        for r in routes
                    ],
                })
            except Exception as e:
                logger.warning("Não salvou a prévia da rota no Firebase: %s", e)
        # Sem a chave do Firebase no servidor, a própria tela grava a prévia
        # (com o login do usuário) — ver executarVRPD() no index.html.

        # NÃO marca pedidos aqui — o /solve é PREVIEW. O status muda pra
        # "despachado" só quando o frontend chama confirmarRotaD() e o
        # usuário aperta "Confirmar Saída para Entrega". Isso permite gerar
        # várias previews (com veículos/capacidades diferentes) sem "queimar"
        # os pedidos pendentes.

        # 5. Análise automática da IA
        try:
            analise = analisar_rotas_geradas(
                routes, pendentes, n_aloc, veiculo_nome, int(cap_kg_val)
            )
        except Exception as e:
            logger.warning("IA indisponível: %s", e)
            analise = (
                f"Motor OR-Tools gerou {len(routes)} rota(s) com {sum(len(r['pedidos']) for r in routes)} "
                f"paradas (entregas e coletas). {('Pedidos não alocados: ' + ', '.join(n_aloc)) if n_aloc else 'Todos os pedidos foram alocados.'}"
            )

        return {
            # 'routes' (novo) e 'rotas' (legado) — mesmo payload, chaves diferentes
            "routes":            routes,
            "rotas":             routes,
            "nao_alocados":      n_aloc,
            "fora_da_janela":    resultado.get("fora_da_janela", []),
            "fonte_distancia":   fonte,
            "solver_status":     status_vp,
            "regra_carga":       resultado.get("regra_carga", "—"),
            "analise_ia":        analise,
            "salvo":             salvo,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro no /solve: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
def chat(body: ChatRequest, uid: str = Depends(exigir_login)):
    """
    Chat com Gemini.
    Mantém histórico por session_id.
    Se session_id vazio, cria nova sessão e retorna o ID.
    """
    try:
        sid = body.session_id or str(uuid.uuid4())
        session = _get_session(sid)

        # Atualiza contexto com os pedidos enviados pela tela (ou do Firebase)
        pedidos = body.pedidos if body.pedidos is not None else (_carregar_pedidos_firebase() if _tem_segredo() else [])
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


MAX_UPLOAD_BYTES  = int(os.getenv("MAX_UPLOAD_BYTES",  str(15 * 1024 * 1024)))   # 15 MB/arquivo
MAX_UPLOAD_TOTAL  = int(os.getenv("MAX_UPLOAD_TOTAL",  str(60 * 1024 * 1024)))   # 60 MB/req
MAX_UPLOAD_FILES  = int(os.getenv("MAX_UPLOAD_FILES",  "40"))

@app.post("/upload-nf")
async def upload_nf(
    arquivos: list[UploadFile] = File(..., description="PDF, XML NF-e, XLSX ou CSV"),
    persistir: bool = Form(True, description="Se true, grava no Firebase"),
    uid: str = Depends(exigir_login),
):
    """
    Recebe uma ou várias notas fiscais em PDF, XML NF-e, XLSX ou CSV,
    extrai os pedidos e (opcional) grava direto em pedidos_rota do Firebase.
    """
    if not arquivos:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")
    if len(arquivos) > MAX_UPLOAD_FILES:
        raise HTTPException(status_code=413, detail=f"Máximo {MAX_UPLOAD_FILES} arquivos por vez.")

    buffers: list[tuple[str, bytes]] = []
    total = 0
    for up in arquivos:
        blob = await up.read()
        if len(blob) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Arquivo '{up.filename}' excede {MAX_UPLOAD_BYTES//1024//1024} MB.",
            )
        total += len(blob)
        if total > MAX_UPLOAD_TOTAL:
            raise HTTPException(
                status_code=413,
                detail=f"Envio total excede {MAX_UPLOAD_TOTAL//1024//1024} MB.",
            )
        buffers.append((up.filename or "sem_nome", blob))

    try:
        resultado = parse_many(buffers)
    except Exception as e:
        logger.exception("Falha no parse: %s", e)
        raise HTTPException(status_code=500, detail=f"Falha ao processar arquivos: {e}")

    pedidos = resultado["pedidos"]
    erros   = resultado["erros"]

    resumo = {"novo": 0, "atualizado": 0, "preservado": 0, "erro": 0}
    if persistir and pedidos and _tem_segredo():
        for p in pedidos:
            r = _salvar_pedido_firebase(p)
            resumo[r] = resumo.get(r, 0) + 1

    logger.info("Upload NF: %d arquivos, %d extraídos, novos=%d atualizados=%d preservados=%d erros=%d",
                len(arquivos), len(pedidos),
                resumo["novo"], resumo["atualizado"], resumo["preservado"], resumo["erro"])

    return {
        "status":       "ok" if pedidos else "vazio",
        "arquivos":     len(arquivos),
        "pedidos":      pedidos,
        # salvos_fb mantido pra compat com frontend antigo (soma novos+atualizados)
        "salvos_fb":    resumo["novo"] + resumo["atualizado"],
        "resumo":       resumo,
        "erros":        erros + ([{"arquivo":"—","erro":"falha ao gravar no Firebase"}] if resumo["erro"] else []),
        "persistido":   persistir,
    }


@app.post("/sync")
def sync_totvs(uid: str = Depends(exigir_login)):
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
