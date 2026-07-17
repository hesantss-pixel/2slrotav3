"""
gemini_agent.py — Assistente de Logística com Gemini 3.5 Flash
--------------------------------------------------------------
Encapsula chamadas ao Google Gemini para o chat de operações da 2SL LOG.
O agente recebe contexto operacional (pedidos, rotas, frotas) e responde
como especialista em roteirização e logística de produtos químicos.

Dependências:
    pip install google-generativeai

Variável de ambiente:
    GEMINI_API_KEY — obtenha em https://aistudio.google.com/app/apikey
"""

import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── Lazy import do SDK Gemini ─────────────────────────────────────────────────

_genai = None
_model = None

def _init_gemini():
    global _genai, _model
    if _model:
        return
    try:
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            raise ValueError("GEMINI_API_KEY não definida. Defina no .env ou variáveis de ambiente do Railway.")
        genai.configure(api_key=api_key)
        _model = genai.GenerativeModel(
            model_name="gemini-3.5-flash",
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "temperature":     0.3,   # mais determinístico para logística
                "top_p":           0.9,
                "max_output_tokens": 1024,
            },
        )
        _genai = genai
        logger.info("Gemini 3.5 Flash inicializado com sucesso.")
    except ImportError as e:
        raise RuntimeError(
            "SDK Gemini não instalado. Execute: pip install google-generativeai"
        ) from e


# ── System Prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
Você é o Assistente de Operações da 2SL LOG, transportadora de Guarulhos (SP) especializada em produtos químicos e controlados, com operações em Guarulhos e Itu.

Motor de roteirização: OR-Tools VRP (Google Operations Research Tools).
Frota disponível: Fiorino (1,5t), VUC (3t), Truck Toco (8t), Bitruck (16t), Carreta (33t).
Depósito: 2SL LOG — Guarulhos, SP.

Sua função é ajudar o operador de logística a:
- Analisar e dividir rotas de entrega
- Identificar clientes isolados ou regiões problemáticas
- Alertar sobre pedidos com risco de atraso
- Recomendar veículos adequados para cada rota
- Sugerir formas de reduzir km e combustível
- Responder dúvidas sobre pedidos específicos (por NF ou cidade)
- Interpretar resultados do solver VRP

Regras de resposta:
- Seja direto, objetivo e use dados concretos
- Use listas quando listar rotas, pedidos ou cidades
- Não use markdown (sem asteriscos, sem #, sem `)
- Respostas em português do Brasil
- Máximo 400 palavras por resposta
- Se não tiver dados suficientes, diga claramente
- Para produtos químicos: mencione se há restrição de circulação (VUC em SP) quando relevante
""".strip()


# ── Contexto operacional ──────────────────────────────────────────────────────

def montar_contexto(
    pedidos: list[dict],
    rotas: list[dict] | None = None,
    veiculo: str | None = None,
    cap_kg: int | None = None,
) -> str:
    """
    Monta o bloco de contexto operacional que é anexado a cada mensagem
    enviada ao Gemini, para que ele sempre tenha os dados atualizados.
    """
    pendentes = [p for p in pedidos if p.get("status") == "pendente"]

    por_cidade: dict[str, dict] = {}
    for p in pendentes:
        c = p.get("cidade", "Outros")
        if c not in por_cidade:
            por_cidade[c] = {"qtd": 0, "peso": 0.0, "urg": 0, "agendados": 0}
        por_cidade[c]["qtd"]  += 1
        por_cidade[c]["peso"] += float(p.get("peso", 0))
        if p.get("urgente"):
            por_cidade[c]["urg"] += 1
        if p.get("agendado"):
            por_cidade[c]["agendados"] += 1

    ctx = f"OPERAÇÃO 2SL LOG\nTotal pendentes: {len(pendentes)} pedidos\n\n"
    ctx += "POR CIDADE:\n"
    for c, v in sorted(por_cidade.items(), key=lambda x: -x[1]["qtd"]):
        ctx += (
            f"- {c}: {v['qtd']} pedidos | "
            f"{v['peso']/1000:.1f}t | "
            f"{v['urg']} urgentes | "
            f"{v['agendados']} agendados\n"
        )

    if rotas:
        total_km = sum(r.get("km", 0) for r in rotas)
        ctx += f"\nROTAS GERADAS ({len(rotas)} viagem(ns)"
        if veiculo:
            ctx += f" | {veiculo}"
        if cap_kg:
            ctx += f" | cap {cap_kg:,} kg"
        ctx += f" | {total_km:.0f} km total):\n"
        for i, r in enumerate(rotas, 1):
            nfs = " → ".join(
                f"NF{p['nf']}({p.get('cidade','?')},{p.get('peso',0):.0f}kg)"
                for p in r.get("pedidos", [])
            )
            ctx += (
                f"Rota {i}: {len(r.get('pedidos', []))} entregas | "
                f"{r.get('km', 0)}km | {r.get('mins', 0)}min\n"
                f"  Seq: {nfs}\n"
            )

    ctx += "\nFROTA: Fiorino(1,5t) VUC(3t) Toco(8t) Bitruck(16t) Carreta(33t)\n"
    ctx += "Depósito: Guarulhos SP\n"
    return ctx


# ── Chat ──────────────────────────────────────────────────────────────────────

class GeminiChat:
    """
    Wrapper com histórico de conversa por sessão.
    Cada instância representa uma sessão de chat.
    """

    def __init__(self):
        _init_gemini()
        self._chat = _model.start_chat(history=[])
        self._ctx: str = ""

    def atualizar_contexto(
        self,
        pedidos: list[dict],
        rotas: list[dict] | None = None,
        veiculo: str | None = None,
        cap_kg: int | None = None,
    ) -> None:
        self._ctx = montar_contexto(pedidos, rotas, veiculo, cap_kg)

    def enviar(self, mensagem: str) -> str:
        """Envia mensagem e retorna resposta como string."""
        prompt = f"Dados operacionais atuais:\n{self._ctx}\n\nPergunta: {mensagem}"
        try:
            response = self._chat.send_message(prompt)
            return response.text
        except Exception as e:
            logger.error("Erro Gemini: %s", e)
            return f"Erro ao consultar a IA: {e}"


# ── Função utilitária para uso único (sem histórico) ─────────────────────────

def consulta_unica(
    mensagem: str,
    pedidos: list[dict],
    rotas: list[dict] | None = None,
    veiculo: str | None = None,
    cap_kg: int | None = None,
) -> str:
    """
    Consulta sem histórico de conversa.
    Útil para análises pontuais (ex: ao gerar rota, pedir resumo automático).
    """
    _init_gemini()
    ctx = montar_contexto(pedidos, rotas, veiculo, cap_kg)
    prompt = f"Dados operacionais:\n{ctx}\n\nSolicitação: {mensagem}"
    try:
        response = _model.generate_content(prompt)
        return response.text
    except Exception as e:
        logger.error("Erro Gemini (consulta_unica): %s", e)
        return f"Erro ao consultar IA: {e}"


# ── Análise automática pós-VRP ───────────────────────────────────────────────

def analisar_rotas_geradas(
    rotas: list[dict],
    pedidos: list[dict],
    nao_alocados: list[str],
    veiculo: str,
    cap_kg: int,
) -> str:
    """
    Gera automaticamente um resumo inteligente logo após o VRP solver terminar.
    Chamado pelo endpoint /solve do FastAPI.
    """
    prompt = (
        "Analise as rotas recém-geradas pelo OR-Tools e forneça:\n"
        "1. Resumo executivo (2-3 linhas)\n"
        "2. Rota mais pesada ou longa (atenção especial)\n"
        "3. Pedidos urgentes ou agendados na sequência\n"
        "4. Alertas operacionais (ex: região isolada, carga próxima do limite)\n"
        f"{'5. Pedidos NÃO alocados: ' + ', '.join(nao_alocados) if nao_alocados else ''}"
    )
    return consulta_unica(prompt, pedidos, rotas, veiculo, cap_kg)
