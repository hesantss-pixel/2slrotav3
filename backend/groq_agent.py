"""
groq_agent.py — Assistente de Logística com Groq (openai/gpt-oss-120b)
-----------------------------------------------------------------------
Mesma função do gemini_agent.py, só que usando a Groq como provedor de IA
em vez do Gemini — motivo: Gemini free tier tem limite de 20 req/dia,
Groq free tier tem 14.400 req/dia, sem cartão.

Dependências:
    pip install groq

Variável de ambiente:
    GROQ_API_KEY — obtenha em https://console.groq.com/keys (grátis, sem cartão)

Nota: modelo usado é openai/gpt-oss-120b — substituto oficial recomendado
pela Groq após a desativação do llama-3.3-70b-versatile em 17/06/2026.
"""

import os
import logging

logger = logging.getLogger(__name__)

# ── Lazy import do SDK Groq ───────────────────────────────────────────────────

_client = None
MODEL_NAME = "openai/gpt-oss-120b"

def _init_groq():
    global _client
    if _client:
        return
    try:
        from groq import Groq
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise ValueError("GROQ_API_KEY não definida. Defina no .env ou variáveis de ambiente do Railway.")
        _client = Groq(api_key=api_key)
        logger.info("Groq (%s) inicializado com sucesso.", MODEL_NAME)
    except ImportError as e:
        raise RuntimeError(
            "SDK Groq não instalado. Execute: pip install groq"
        ) from e


# ── System Prompt (idêntico ao gemini_agent.py) ───────────────────────────────

SYSTEM_PROMPT = """
Você é o Assistente de Operações da 2SL LOG, transportadora de Guarulhos (SP) especializada em produtos químicos e controlados, com operações em Guarulhos e Itu.

Motor de roteirização: OR-Tools VRP (Google Operations Research Tools).
Frota disponível: Fiorino (1,5t), VUC (3t), Truck Toco (8t), Bitruck (16t), Carreta (33t).
Depósito: 2SL LOG — Av. Júlia Gaiolli, 740 — Guarulhos, SP.

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


# ── Contexto operacional (idêntico ao gemini_agent.py, copiado sem mudança) ──

def montar_contexto(
    pedidos: list[dict],
    rotas: list[dict] | None = None,
    veiculo: str | None = None,
    cap_kg: int | None = None,
) -> str:
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
    ctx += "Depósito: Av. Júlia Gaiolli, 740 — Guarulhos SP\n"
    return ctx


# ── Chat ──────────────────────────────────────────────────────────────────────

class GroqChat:
    """
    Wrapper com histórico de conversa por sessão — mesma interface do
    GeminiChat original (__init__, atualizar_contexto, enviar), pra trocar
    em main.py sem precisar reescrever os endpoints.

    Diferença interna: Groq (estilo OpenAI) não tem "start_chat(history)"
    como o Gemini — a lista de mensagens é mantida manualmente aqui e
    reenviada inteira a cada chamada.
    """

    def __init__(self):
        _init_groq()
        self._historico: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
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
        self._historico.append({"role": "user", "content": prompt})
        try:
            resp = _client.chat.completions.create(
                model=MODEL_NAME,
                messages=self._historico,
                temperature=0.3,
                top_p=0.9,
                max_tokens=1024,
            )
            texto = resp.choices[0].message.content
            self._historico.append({"role": "assistant", "content": texto})
            return texto
        except Exception as e:
            logger.error("Erro Groq: %s", e)
            return f"Erro ao consultar a IA: {e}"


# ── Função utilitária para uso único (sem histórico) ──────────────────────────

def consulta_unica(
    mensagem: str,
    pedidos: list[dict],
    rotas: list[dict] | None = None,
    veiculo: str | None = None,
    cap_kg: int | None = None,
) -> str:
    """Consulta sem histórico — mesma assinatura do gemini_agent.py original."""
    _init_groq()
    ctx = montar_contexto(pedidos, rotas, veiculo, cap_kg)
    prompt = f"Dados operacionais:\n{ctx}\n\nSolicitação: {mensagem}"
    try:
        resp = _client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            top_p=0.9,
            max_tokens=1024,
        )
        return resp.choices[0].message.content
    except Exception as e:
        logger.error("Erro Groq (consulta_unica): %s", e)
        return f"Erro ao consultar IA: {e}"


# ── Análise automática pós-VRP (idêntica ao gemini_agent.py) ─────────────────

def analisar_rotas_geradas(
    rotas: list[dict],
    pedidos: list[dict],
    nao_alocados: list[str],
    veiculo: str,
    cap_kg: int,
) -> str:
    prompt = (
        "Analise as rotas recém-geradas pelo OR-Tools e forneça:\n"
        "1. Resumo executivo (2-3 linhas)\n"
        "2. Rota mais pesada ou longa (atenção especial)\n"
        "3. Pedidos urgentes ou agendados na sequência\n"
        "4. Alertas operacionais (ex: região isolada, carga próxima do limite)\n"
        f"{'5. Pedidos NÃO alocados: ' + ', '.join(nao_alocados) if nao_alocados else ''}"
    )
    return consulta_unica(prompt, pedidos, rotas, veiculo, cap_kg)
