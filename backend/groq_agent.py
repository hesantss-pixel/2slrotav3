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
# Modelo em variável de ambiente: quando a Groq desligar um modelo (ela avisa na página
# de descontinuações), troca-se GROQ_MODEL no Railway, sem mexer no código.
MODEL_NAME = os.getenv("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"
# Quantas mensagens anteriores (perguntas e respostas) vão junto em cada pergunta.
# 6 = as três últimas trocas. O plano gratuito da Groq tem um teto de tokens por
# minuto, e cada mensagem a mais custa tokens em todas as perguntas seguintes.
def _num_env(nome: str, padrao: int) -> int:
    try:
        return max(0, int(os.getenv(nome, "").strip() or padrao))
    except ValueError:
        logger.warning("%s inválido; usando %s", nome, padrao)
        return padrao


HISTORICO_MAX = _num_env("GROQ_HISTORICO", 6) // 2 * 2   # sempre pares pergunta+resposta


def _status_http(e: Exception):
    st = getattr(e, "status_code", None)
    if st is None:
        st = getattr(getattr(e, "response", None), "status_code", None)
    return st if isinstance(st, int) else None


def _mensagem_de_erro(e: Exception) -> str:
    """O que a pessoa lê quando a Groq falha. Nunca o texto cru do erro: ele pode trazer
    detalhes internos da API e não diz o que fazer."""
    st = _status_http(e)
    if st == 429:
        return ("O assistente chegou ao limite de uso deste minuto. "
                "Espere um minuto e pergunte de novo.")
    if st == 413:
        return ("Os dados do dia ficaram grandes demais para o assistente de uma vez. "
                "Pergunte sobre uma cidade ou uma rota por vez.")
    if st in (401, 403):
        return "O assistente está sem acesso à IA agora. Avise o administrador do sistema."
    if st is not None and st >= 500:
        return "O serviço de IA está fora do ar agora. Tente de novo em alguns minutos."
    return "Não deu para consultar o assistente agora. Tente de novo em alguns minutos."

_assistente: str | None = None


def conferir_assistente() -> str:
    """'ok', 'sem chave' ou 'falhou'. Cria um cliente sem chamar a API: é aí que versões
    incompatíveis do SDK e do httpx quebram (o caso do 'proxies' no httpx 0.28)."""
    global _assistente
    if _assistente is None:
        try:
            from groq import Groq
            Groq(api_key="conferencia-sem-uso").close()
            _assistente = "ok" if os.getenv("GROQ_API_KEY", "").strip() else "sem chave"
        except Exception:
            logger.exception("SDK da Groq não carregou")
            _assistente = "falhou"
    return _assistente


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
Você é o Assistente de Operações do ROTAV3, sistema de roteirização de entregas e coletas.
Você conversa com a equipe de logística da empresa que usa o sistema.

Você recebe, a cada pergunta, o resumo dos pedidos pendentes (por cidade, peso,
urgência e agendamento) e, quando houver, as rotas geradas pelo sistema.
Cada pedido é uma ENTREGA (sai do centro de distribuição para o destinatário) ou uma
COLETA (busca no remetente e traz para o centro de distribuição). Quando uma viagem
tem os dois, o sistema faz as entregas primeiro e as coletas depois.

Sua função é ajudar a equipe a:
- Analisar e dividir rotas de entrega e de coleta
- Identificar pedidos isolados ou regiões distantes do centro de distribuição
- Alertar sobre pedidos com risco de atraso (urgentes ou agendados)
- Sugerir o veículo adequado para cada rota a partir do peso
- Sugerir formas de reduzir quilometragem
- Responder dúvidas sobre pedidos específicos (por NF ou cidade)
- Explicar o resultado das rotas geradas

Regras de resposta:
- Seja direto, objetivo e use só os dados recebidos; não invente pedidos, clientes ou números
- Use listas quando listar rotas, pedidos ou cidades
- Não use markdown (sem asteriscos, sem #, sem `)
- Respostas em português do Brasil
- Máximo 400 palavras por resposta
- Se não tiver dados suficientes, diga claramente o que falta
""".strip()


# ── Contexto operacional (idêntico ao gemini_agent.py, copiado sem mudança) ──

def _eh_coleta(p: dict) -> bool:
    return str(p.get("tipo", "")).strip().lower() == "coleta"


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
            por_cidade[c] = {"qtd": 0, "peso": 0.0, "urg": 0, "agendados": 0, "coletas": 0}
        por_cidade[c]["qtd"]  += 1
        if _eh_coleta(p):
            por_cidade[c]["coletas"] += 1
        por_cidade[c]["peso"] += float(p.get("peso", 0))
        if p.get("urgente"):
            por_cidade[c]["urg"] += 1
        if p.get("agendado"):
            por_cidade[c]["agendados"] += 1

    n_col = sum(1 for p in pendentes if _eh_coleta(p))
    ctx = (f"OPERAÇÃO\nTotal pendentes: {len(pendentes)} pedidos "
           f"({len(pendentes) - n_col} entregas, {n_col} coletas)\n\n")
    ctx += "POR CIDADE:\n"
    for c, v in sorted(por_cidade.items(), key=lambda x: -x[1]["qtd"]):
        ctx += (
            f"- {c}: {v['qtd']} pedidos ({v['qtd'] - v['coletas']} entregas, {v['coletas']} coletas) | "
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
                f"{'Coleta' if _eh_coleta(p) else 'Entrega'} NF{p['nf']}({p.get('cidade','?')},{p.get('peso',0):.0f}kg)"
                for p in r.get("pedidos", [])
            )
            ctx += (
                f"Rota {i}: {len(r.get('pedidos', []))} paradas | "
                f"{r.get('km', 0)}km | {r.get('mins', 0)}min\n"
                f"  Seq: {nfs}\n"
            )

    ctx += "\nVEÍCULOS COMUNS: Fiorino (até 650 kg), VUC (até 3 t), Toco (até 8 t), Truck (até 16 t), Carreta (até 33 t)\n"
    return ctx


# ── Chat ──────────────────────────────────────────────────────────────────────

class GroqChat:
    """
    Wrapper com histórico de conversa por sessão — mesma interface do
    GeminiChat original (__init__, atualizar_contexto, enviar), pra trocar
    em main.py sem precisar reescrever os endpoints.

    Diferença interna: Groq (estilo OpenAI) não tem "start_chat(history)"
    como o Gemini — a lista de mensagens é mantida aqui, com no máximo
    HISTORICO_MAX mensagens anteriores, e os dados do dia vão só na pergunta atual.
    """

    def __init__(self):
        _init_groq()
        # Só perguntas e respostas. O contexto do dia vai na pergunta atual, não aqui.
        self._historico: list[dict] = []
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
        """Envia mensagem e retorna resposta como string.

        Antes, cada pergunta ia para o histórico junto com uma cópia inteira dos dados do
        dia, e o histórico nunca era cortado: a conversa crescia sem parar e estourava o
        limite de tokens por minuto da Groq já na segunda ou terceira pergunta."""
        anteriores = self._historico[-HISTORICO_MAX:] if HISTORICO_MAX else []
        prompt = f"Dados operacionais atuais:\n{self._ctx}\n\nPergunta: {mensagem}"
        mensagens = [{"role": "system", "content": SYSTEM_PROMPT}, *anteriores,
                     {"role": "user", "content": prompt}]
        try:
            resp = _client.chat.completions.create(
                model=MODEL_NAME,
                messages=mensagens,
                temperature=0.3,
                top_p=0.9,
                max_tokens=1024,
            )
            texto = (resp.choices[0].message.content or "").strip()
        except Exception as e:
            # a pergunta que falhou não entra no histórico
            logger.error("Erro Groq (%s): %s", _status_http(e), e)
            return _mensagem_de_erro(e)
        if not texto:
            return "O assistente não conseguiu montar uma resposta. Tente perguntar de outro jeito."
        self._historico += [{"role": "user", "content": mensagem},
                            {"role": "assistant", "content": texto}]
        self._historico = self._historico[-HISTORICO_MAX:] if HISTORICO_MAX else []
        return texto


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
        texto = (resp.choices[0].message.content or "").strip()
        return texto or "O assistente não conseguiu montar uma resposta agora."
    except Exception as e:
        logger.error("Erro Groq (consulta_unica, %s): %s", _status_http(e), e)
        return _mensagem_de_erro(e)


# ── Análise automática pós-VRP (idêntica ao gemini_agent.py) ─────────────────

def analisar_rotas_geradas(
    rotas: list[dict],
    pedidos: list[dict],
    nao_alocados: list[str],
    veiculo: str,
    cap_kg: int,
) -> str:
    prompt = (
        "Analise as rotas recém-geradas pelo sistema e forneça:\n"
        "1. Resumo executivo (2-3 linhas)\n"
        "2. Rota mais pesada ou longa (atenção especial)\n"
        "3. Pedidos urgentes ou agendados na sequência\n"
        "4. Alertas operacionais (ex: região isolada, carga próxima do limite)\n"
        f"{'5. Pedidos NÃO alocados: ' + ', '.join(nao_alocados) if nao_alocados else ''}"
    )
    return consulta_unica(prompt, pedidos, rotas, veiculo, cap_kg)
