"""
totvs_sync.py — Sincronização TOTVS Protheus → Firebase
---------------------------------------------------------
Lê pedidos prontos para faturamento/entrega diretamente do banco SQL
do TOTVS Protheus e grava (upsert) no Firebase Realtime Database.

Compatível com:
  - TOTVS Protheus + SQL Server  (driver: pyodbc)
  - TOTVS Protheus + Progress DB (driver: pyodbc + ODBC Progress)

Tabelas utilizadas:
  SC9 — Pedidos de venda aprovados (itens)
  SA1 — Cadastro de clientes
  SD1 — Itens de nota fiscal (pós-faturamento)

Executar manualmente:   python totvs_sync.py
Executar como serviço:  ver railway.toml (cron: a cada 5 min)

Variáveis de ambiente necessárias (arquivo .env):
  TOTVS_DRIVER      — ex: "SQL Server" ou "ODBC Driver 17 for SQL Server"
  TOTVS_SERVER      — ex: "192.168.1.10\\SQLEXPRESS" ou "192.168.1.10,1433"
  TOTVS_DATABASE    — ex: "PROTHEUS12" ou "P12_PRODUCAO"
  TOTVS_USER        — ex: "sa" ou "protheus_ro" (usuário somente leitura recomendado)
  TOTVS_PASSWORD    — senha do banco
  TOTVS_EMPRESA     — código da empresa no TOTVS, ex: "01"
  TOTVS_FILIAL      — código da filial,           ex: "01"
  FIREBASE_URL      — ex: "https://slog-pedidos-default-rtdb.firebaseio.com"
  FIREBASE_SECRET   — Database Secret do Firebase (legacy auth — ok para backend)
  CITY_DEFAULT      — cidade padrão se não identificada, ex: "Guarulhos"
"""

import os
import logging
import time
from datetime import datetime, date

try:
    import pyodbc
except ImportError:
    pyodbc = None
import requests        # pip install requests
from dotenv import load_dotenv  # pip install python-dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

TOTVS_DRIVER   = os.getenv("TOTVS_DRIVER",   "SQL Server")
TOTVS_SERVER   = os.getenv("TOTVS_SERVER",   "localhost")
TOTVS_DATABASE = os.getenv("TOTVS_DATABASE", "PROTHEUS12")
TOTVS_USER     = os.getenv("TOTVS_USER",     "sa")
TOTVS_PASSWORD = os.getenv("TOTVS_PASSWORD", "")
TOTVS_EMPRESA  = os.getenv("TOTVS_EMPRESA",  "01")
TOTVS_FILIAL   = os.getenv("TOTVS_FILIAL",   "01")

FIREBASE_URL    = os.getenv("FIREBASE_URL",    "https://slog-pedidos-default-rtdb.firebaseio.com")
FIREBASE_SECRET = os.getenv("FIREBASE_SECRET", "")
CITY_DEFAULT    = os.getenv("CITY_DEFAULT",    "Guarulhos")

# Mapa de cidades reconhecidas (fragmento do nome → cidade padronizada)
# Ajuste conforme as cidades reais dos seus clientes
CITY_MAP: dict[str, str] = {
    "guarulhos":    "Guarulhos",
    "santos":       "Santos",
    "guarujá":      "Guarujá",
    "guaruja":      "Guarujá",
    "são paulo":    "São Paulo",
    "sao paulo":    "São Paulo",
    "praia grande": "Praia Grande",
    "sorocaba":     "Sorocaba",
    "mogi":         "Mogi das Cruzes",
    "santo andré":  "Santo André",
    "santo andre":  "Santo André",
    "são bernardo": "São Bernardo do Campo",
    "sao bernardo": "São Bernardo do Campo",
    "osasco":       "Osasco",
    "campinas":     "Campinas",
    "itu":          "Itu",
}

# Coordenadas aproximadas por cidade (fallback quando não há CEP geocodificado)
CITY_COORDS: dict[str, dict] = {
    "Guarulhos":             {"lat": -23.4566, "lng": -46.5055},
    "Santos":                {"lat": -23.9617, "lng": -46.3322},
    "Guarujá":               {"lat": -23.9928, "lng": -46.2569},
    "São Paulo":             {"lat": -23.5614, "lng": -46.6559},
    "Praia Grande":          {"lat": -23.9864, "lng": -46.4119},
    "Sorocaba":              {"lat": -23.5015, "lng": -47.4581},
    "Mogi das Cruzes":       {"lat": -23.5234, "lng": -46.1845},
    "Santo André":           {"lat": -23.6738, "lng": -46.5438},
    "São Bernardo do Campo": {"lat": -23.6940, "lng": -46.5648},
    "Osasco":                {"lat": -23.5325, "lng": -46.7919},
    "Campinas":              {"lat": -22.9099, "lng": -47.0626},
    "Itu":                   {"lat": -23.2644, "lng": -47.2996},
}

# ── Conexão TOTVS ─────────────────────────────────────────────────────────────

def conectar_totvs():
  if pyodbc is None:
        raise RuntimeError("pyodbc não disponível neste ambiente. Execute localmente na rede da empresa.") -> pyodbc.Connection:
    conn_str = (
        f"DRIVER={{{TOTVS_DRIVER}}};"
        f"SERVER={TOTVS_SERVER};"
        f"DATABASE={TOTVS_DATABASE};"
        f"UID={TOTVS_USER};"
        f"PWD={TOTVS_PASSWORD};"
        "TrustServerCertificate=yes;"
        "Encrypt=no;"
    )
    logger.info("Conectando ao TOTVS (%s / %s)...", TOTVS_SERVER, TOTVS_DATABASE)
    return pyodbc.connect(conn_str, timeout=15)


# ── Query principal ───────────────────────────────────────────────────────────
# Busca pedidos de venda aprovados ainda não faturados (SC9.C9_BLEST = 'A' ou 'P')
# e une com dados do cliente (SA1) para obter endereço e cidade.
#
# ATENÇÃO: os nomes de campo do TOTVS variam por versão (P11, P12, P12.1.17...).
# Se a query retornar erro, verifique os campos na sua instância com:
#   SELECT TOP 1 * FROM SC9010 WHERE C9_FILIAL = '01'
# ─────────────────────────────────────────────────────────────────────────────

QUERY_PEDIDOS = """
SELECT
    SC9.C9_PEDIDO   AS nf,
    SC9.C9_ITEM     AS item,
    SC9.C9_QTDLIB   AS qtd,
    SC9.C9_PESO     AS peso,
    SC9.C9_BLEST    AS status_item,
    SC9.C9_CLIENTE  AS cod_cliente,
    SC9.C9_LOJA     AS loja_cliente,
    SA1.A1_NOME     AS nome_cliente,
    SA1.A1_END      AS endereco,
    SA1.A1_BAIRRO   AS bairro,
    SA1.A1_MUN      AS cidade,
    SA1.A1_EST      AS estado,
    SA1.A1_CEP      AS cep,
    SA1.A1_TEL      AS telefone,
    SC9.C9_DATPRF   AS data_prevista,
    SC9.C9_URGENT   AS urgente
FROM
    SC9010 SC9                              -- SC9010 = tabela filial 01; ajuste se necessário
    INNER JOIN SA1010 SA1                   -- SA1010 = clientes filial 01
        ON SA1.A1_COD  = SC9.C9_CLIENTE
        AND SA1.A1_LOJA = SC9.C9_LOJA
        AND SA1.D_E_L_E_T_ = ' '
WHERE
    SC9.C9_FILIAL   = ?
    AND SC9.C9_BLEST IN ('A', 'P', 'L')    -- Aprovado / Parcial / Liberado
    AND SC9.D_E_L_E_T_ = ' '
ORDER BY
    SC9.C9_DATPRF ASC, SC9.C9_PEDIDO ASC
"""

# ── Normalização ──────────────────────────────────────────────────────────────

def _normalizar_cidade(cidade_raw: str) -> str:
    if not cidade_raw:
        return CITY_DEFAULT
    low = cidade_raw.strip().lower()
    for frag, std in CITY_MAP.items():
        if frag in low:
            return std
    return cidade_raw.strip().title()


def _coords_para_cidade(cidade: str) -> dict:
    return CITY_COORDS.get(cidade, CITY_COORDS.get(CITY_DEFAULT, {"lat": -23.4566, "lng": -46.5055}))


def _parse_data(d: str) -> str:
    """Converte YYYYMMDD → YYYY-MM-DD; retorna '' se inválido."""
    if not d or len(d) < 8:
        return ""
    try:
        return f"{d[:4]}-{d[4:6]}-{d[6:8]}"
    except Exception:
        return ""


def _e_urgente(flag) -> bool:
    if flag is None:
        return False
    return str(flag).strip().upper() in ("S", "1", "T", "Y")


def _e_agendado(data_prevista: str) -> bool:
    """Considera agendado se a data prevista for amanhã ou depois."""
    if not data_prevista:
        return False
    try:
        dp = date.fromisoformat(data_prevista)
        return dp > date.today()
    except ValueError:
        return False


def linhas_para_pedidos(rows: list) -> dict[str, dict]:
    """
    Agrupa linhas do SQL (um item por linha) em pedidos consolidados.
    Retorna dict { nf: pedido_dict }.
    """
    pedidos: dict[str, dict] = {}
    for row in rows:
        nf = str(row.nf).strip()
        if not nf:
            continue

        cidade = _normalizar_cidade(str(row.cidade or ""))
        coords = _coords_para_cidade(cidade)
        data_prev = _parse_data(str(row.data_prevista or ""))

        if nf not in pedidos:
            endereco_fmt = (
                f"{(row.endereco or '').strip()}, {(row.bairro or '').strip()} — {cidade}"
            ).strip(", ")
            pedidos[nf] = {
                "nf":           nf,
                "dest":         endereco_fmt,
                "cliente":      str(row.nome_cliente or "").strip(),
                "cidade":       cidade,
                "cep":          str(row.cep or "").strip(),
                "peso":         0.0,
                "itens":        0,
                "urgente":      _e_urgente(row.urgente),
                "agendado":     _e_agendado(data_prev),
                "dataAgendada": data_prev,
                "status":       "pendente",
                "lat":          coords["lat"],
                "lng":          coords["lng"],
                "ts":           datetime.utcnow().isoformat(),
                "origem":       "TOTVS",
            }

        # Acumula peso e itens por item do pedido
        pedidos[nf]["peso"]  += float(row.peso or 0)
        pedidos[nf]["itens"] += 1

    return pedidos


# ── Firebase ──────────────────────────────────────────────────────────────────

def _fb_url(path: str) -> str:
    return f"{FIREBASE_URL}/{path}.json?auth={FIREBASE_SECRET}"


def gravar_firebase(pedidos: dict[str, dict]) -> int:
    """
    Grava pedidos no Firebase via REST (PATCH = upsert).
    Não sobrescreve pedidos já roteirizados.
    Retorna número de pedidos gravados.
    """
    # Busca status atual para não sobrescrever roteirizados
    resp = requests.get(_fb_url("pedidos_rota"), timeout=10)
    existentes: dict = {}
    if resp.ok and resp.json():
        existentes = resp.json()

    payload: dict[str, dict] = {}
    for nf, ped in pedidos.items():
        atual = existentes.get(nf, {})
        if atual.get("status") in ("roteirizado", "entregue"):
            continue  # não mexe em pedidos já processados
        payload[nf] = ped

    if not payload:
        logger.info("Nenhum pedido novo para gravar.")
        return 0

    r = requests.patch(
        _fb_url("pedidos_rota"),
        json=payload,
        timeout=15,
    )
    r.raise_for_status()
    logger.info("%d pedido(s) gravado(s) no Firebase.", len(payload))
    return len(payload)


def gravar_log_sync(total_lidos: int, total_gravados: int, status: str) -> None:
    payload = {
        "ts":            datetime.utcnow().isoformat(),
        "total_lidos":   total_lidos,
        "total_gravados": total_gravados,
        "status":        status,
    }
    requests.put(_fb_url("sync_log/ultimo"), json=payload, timeout=10)


# ── Entry point ───────────────────────────────────────────────────────────────

def sincronizar() -> None:
    logger.info("=== Iniciando sincronização TOTVS → Firebase ===")
    try:
        conn   = conectar_totvs()
        cursor = conn.cursor()
        cursor.execute(QUERY_PEDIDOS, TOTVS_FILIAL)
        rows   = cursor.fetchall()
        conn.close()
        logger.info("%d linhas lidas do TOTVS.", len(rows))

        pedidos = linhas_para_pedidos(rows)
        logger.info("%d pedidos consolidados.", len(pedidos))

        gravados = gravar_firebase(pedidos)
        gravar_log_sync(len(pedidos), gravados, "ok")
        logger.info("=== Sincronização concluída: %d gravados ===", gravados)

    except pyodbc.Error as e:
        logger.error("Erro de conexão TOTVS: %s", e)
        gravar_log_sync(0, 0, f"erro_sql: {e}")
    except requests.RequestException as e:
        logger.error("Erro ao gravar no Firebase: %s", e)
        gravar_log_sync(0, 0, f"erro_firebase: {e}")
    except Exception as e:
        logger.exception("Erro inesperado: %s", e)
        gravar_log_sync(0, 0, f"erro: {e}")


if __name__ == "__main__":
    sincronizar()
