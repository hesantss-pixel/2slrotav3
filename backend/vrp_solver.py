"""
vrp_solver.py — Motor de roteirização (OR-Tools VRP) do ROTAV3
------------------------------------------------
Resolve Vehicle Routing Problem com:
  - Capacidade por peso (kg)
  - Limite de paradas por veículo
  - Limite de 8 horas por viagem (estrada + 15 min por parada + espera)
  - Janela de horário por pedido (agendados): chegar entre janela_ini e janela_fim
  - Penalidade por pedido não atendido (solução parcial)
  - Suporte a múltiplos veículos
  - Coletas e entregas na mesma viagem (entregas primeiro, coletas depois)

Dependências:
    pip install ortools requests

Referência: Google OR-Tools VRP Docs
https://developers.google.com/optimization/routing/vrp
"""

import math
import requests
import logging
from typing import TypedDict, Optional

logger = logging.getLogger(__name__)

# ── Tipos ──────────────────────────────────────────────────────────────────────

class Pedido(TypedDict, total=False):
    id: str            # chave do pedido no banco (pode ser diferente do número da NF)
    nf: str
    tipo: str          # "entrega" (padrão) ou "coleta"
    dest: str
    cidade: str
    peso: float        # kg
    itens: int
    urgente: bool
    agendado: bool
    dataAgendada: str  # "YYYY-MM-DD" ou ""
    lat: float
    lng: float

class Veiculo(TypedDict):
    id: str
    nome: str
    capKg: float
    maxPed: int

class RotaResultado(TypedDict):
    veiculo: str
    pedidos: list[Pedido]
    km: float
    mins: int
    peso_total: float
    itens_total: int
    entregas: int
    coletas: int
    carga_maxima_kg: int
    sequencia_coords: list[dict]  # [{lat, lng}] para desenhar no mapa

# ── Constantes ─────────────────────────────────────────────────────────────────

OSRM_URL   = "https://router.project-osrm.org/table/v1/driving"
# Centro de distribuição padrão; a tela manda o da conta em "deposito".
DEPOT      = {"lat": -23.424492, "lng": -46.387695, "nome": "Centro de distribuição"}
OSRM_LIMIT = 100   # Máximo de pontos por chamada OSRM (servidor público)

# Velocidade média estimada para fallback Haversine: 40 km/h
SPEED_KMH = 40

# Tempo de serviço por parada: 15 min (900 s)
SERVICE_TIME_S = 900

# Jornada máxima da viagem e espera máxima numa parada (para cumprir janela)
JORNADA_S = 8 * 3600
ESPERA_MAX_S = 3 * 3600

# Penalidade por pedido não atendido — valor alto para forçar atendimento
# quando há capacidade; OR-Tools vai dropar só se realmente impossível
PENALTY = 100_000

# ── Distâncias ─────────────────────────────────────────────────────────────────

def _haversine_m(a: dict, b: dict) -> float:
    """Distância em metros entre dois pontos lat/lng."""
    R = 6_371_000
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat = lat2 - lat1
    dlng = math.radians(b["lng"] - a["lng"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _haversine_matrix(points: list[dict]) -> tuple[list[list[int]], list[list[int]]]:
    """Matriz de distância/duração por Haversine (fallback sem internet)."""
    n = len(points)
    dist = [[0] * n for _ in range(n)]
    dur  = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                d = _haversine_m(points[i], points[j])
                dist[i][j] = int(d)
                dur[i][j]  = int(d / (SPEED_KMH * 1000 / 3600))
    return dist, dur


def build_distance_matrix(points: list[dict]) -> tuple[list[list[int]], list[list[int]], str]:
    """
    Constrói matriz de distâncias reais via OSRM.
    Fallback automático para Haversine se OSRM indisponível.
    Retorna (dist_matrix, duration_matrix, fonte).
    """
    if len(points) > OSRM_LIMIT:
        logger.warning("Mais de %d pontos — usando Haversine", OSRM_LIMIT)
        d, t = _haversine_matrix(points)
        return d, t, "Haversine"

    coords = ";".join(f"{p['lng']:.5f},{p['lat']:.5f}" for p in points)
    try:
        resp = requests.get(
            f"{OSRM_URL}/{coords}",
            params={"annotations": "distance,duration"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok":
            raise ValueError(f"OSRM code: {data.get('code')}")

        dist = [[int(v) for v in row] for row in data["distances"]]
        dur  = [[int(v) for v in row] for row in data["durations"]]
        return dist, dur, "OSRM"

    except Exception as exc:
        logger.warning("OSRM indisponível (%s) — usando Haversine", exc)
        d, t = _haversine_matrix(points)
        return d, t, "Haversine"


# ── Coletas e entregas ─────────────────────────────────────────────────────────
#
# Cada pedido é uma ENTREGA (leva do centro de distribuição até o destinatário)
# ou uma COLETA (busca no remetente e traz para o centro de distribuição).
# Pedido sem "tipo" é entrega (era assim antes desta versão).
#
# Na mesma viagem, o veículo sai com todas as entregas, faz as entregas e só
# depois começa as coletas. Assim a carga a bordo nunca passa da capacidade:
# na saída é o peso das entregas e, no fim, o peso das coletas.

def _tipo(p: dict) -> str:
    return "coleta" if str(p.get("tipo", "")).strip().lower() == "coleta" else "entrega"


def _kg(p: dict) -> int:
    """Peso inteiro em kg, arredondado para cima (nunca subestima a carga)."""
    try:
        return max(0, int(math.ceil(float(p.get("peso") or 0))))
    except (TypeError, ValueError):
        return 0


def perfil_carga(pedidos_em_ordem: list[dict]) -> dict:
    """Carga a bordo ao longo da viagem, na ordem das paradas."""
    carga = sum(_kg(p) for p in pedidos_em_ordem if _tipo(p) == "entrega")
    saida = maxima = carga
    for p in pedidos_em_ordem:
        carga += _kg(p) if _tipo(p) == "coleta" else -_kg(p)
        maxima = max(maxima, carga)
    return {"saida_kg": saida, "retorno_kg": carga, "maxima_kg": maxima}


def _entrega_depois_de_coleta(pedidos_em_ordem: list[dict]) -> bool:
    viu_coleta = False
    for p in pedidos_em_ordem:
        if _tipo(p) == "coleta":
            viu_coleta = True
        elif viu_coleta:
            return True
    return False


def _janela_s(p: dict, saida_min: int | None):
    """Janela do pedido em segundos a partir da saída do CD, ou None.
    janela_ini / janela_fim chegam em minutos desde a meia-noite do dia da rota."""
    if saida_min is None or p.get("janela_ini") is None or p.get("janela_fim") is None:
        return None
    try:
        ini, fim = int(p["janela_ini"]), int(p["janela_fim"])
    except (TypeError, ValueError):
        return None
    if fim < ini:
        return None
    return ((ini - saida_min) * 60, (fim - saida_min) * 60)


def _horarios(seq: list[int], dur_mx: list[list[int]], janelas: list) -> tuple[list[int], int]:
    """Chegada em cada parada (segundos desde a saída, esperando a janela abrir
    quando preciso) e a hora de volta ao CD."""
    t, prev, chegadas = 0, 0, []
    for n in seq:
        t += dur_mx[prev][n]
        j = janelas[n - 1]
        if j and t < j[0]:
            t = j[0]
        chegadas.append(t)
        t += SERVICE_TIME_S
        prev = n
    if seq:
        t += dur_mx[prev][0]
    return chegadas, t


def _rotas_dentro_da_regra(routes: list[dict], veiculos: list[dict]) -> bool:
    caps = {v["id"]: int(v["capKg"]) for v in veiculos}
    maxp = {v["id"]: int(v["maxPed"]) for v in veiculos}
    for r in routes:
        peds = r["pedidos"]
        if perfil_carga(peds)["maxima_kg"] > caps.get(r["veiculo_id"], 0):
            return False
        if len(peds) > maxp.get(r["veiculo_id"], 0) or _entrega_depois_de_coleta(peds):
            return False
    return True


# ── OR-Tools VRP ───────────────────────────────────────────────────────────────

STATUS_MAP = {
    0: "não encontrada",
    1: "ótima",
    2: "viável",
    3: "inviável",
    4: "sem modelo",
}


def solve_vrp(
    pedidos: list[Pedido],
    veiculos: list[Veiculo],
    time_limit_s: int = 30,
    deposito: dict | None = None,
    saida_min: int | None = None,
) -> dict:
    """
    Resolve VRP com OR-Tools.

    Parâmetros
    ----------
    pedidos      : lista de pedidos pendentes com lat/lng (e "tipo": entrega | coleta)
    veiculos     : lista de veículos disponíveis
    time_limit_s : tempo máximo do solver em segundos
    deposito     : {lat, lng, nome} de onde as rotas saem (padrão: DEPOT)
    saida_min    : hora de saída do CD em minutos desde a meia-noite (ex.: 420 = 07:00).
                   Com ela, os pedidos com janela_ini/janela_fim respeitam o horário.

    Retorna
    -------
    {
        "routes": [RotaResultado, ...],
        "nao_alocados": [nf, ...],
        "fora_da_janela": [nf, ...],   # janela impossível para esta saída (não entraram)
        "fonte_distancia": "OSRM" | "Haversine",
        "solver_status": str,
        "regra_carga": "so_entregas" | "so_coletas" | "entregas_antes_das_coletas"
                       | "soma_entregas_e_coletas",
    }
    """
    # Import tardio para não travar se OR-Tools não estiver instalado
    try:
        from ortools.constraint_solver import routing_enums_pb2
        from ortools.constraint_solver import pywrapcp
    except ImportError as e:
        raise RuntimeError(
            "OR-Tools não instalado. Execute: pip install ortools"
        ) from e

    # Janela que não dá para cumprir com esta saída (já passou, ou abre depois
    # do fim da jornada) fica de fora antes de montar o modelo.
    fora_janela: list[str] = []
    if saida_min is not None:
        cabem = []
        for p in pedidos:
            j = _janela_s(p, saida_min)
            if j and (j[1] < 0 or j[0] > JORNADA_S - SERVICE_TIME_S):
                fora_janela.append(p["nf"])
            else:
                cabem.append(p)
        pedidos = cabem

    if not pedidos:
        return {"routes": [], "nao_alocados": list(fora_janela), "fora_da_janela": fora_janela,
                "fonte_distancia": "—", "solver_status": "vazio", "regra_carga": "—"}

    dep = deposito if deposito and deposito.get("lat") is not None and deposito.get("lng") is not None else DEPOT

    # Pontos: depósito (índice 0) + pedidos
    points = [{"lat": float(dep["lat"]), "lng": float(dep["lng"])}] + [{"lat": p["lat"], "lng": p["lng"]} for p in pedidos]
    dist_mx, dur_mx, fonte = build_distance_matrix(points)

    tipos = [_tipo(p) for p in pedidos]
    janelas = [_janela_s(p, saida_min) for p in pedidos]
    misto = "coleta" in tipos and "entrega" in tipos

    def rodar(modo: str, limite: int) -> dict:
        return _resolver(pywrapcp, routing_enums_pb2, pedidos, tipos, janelas, saida_min,
                         veiculos, dep, dist_mx, dur_mx, limite, modo)

    if not misto:
        res = rodar("simples", time_limit_s)
        regra = "so_coletas" if tipos[0] == "coleta" else "so_entregas"
    else:
        try:
            res = rodar("ordem", time_limit_s)
            if not _rotas_dentro_da_regra(res["routes"], veiculos):
                raise ValueError("rota mista fora da regra de carga")
            regra = "entregas_antes_das_coletas"
        except Exception as exc:
            # Plano B, sempre seguro: soma entregas + coletas na capacidade
            # (a carga a bordo nunca passa dessa soma, em qualquer ordem).
            logger.warning("Rota mista: usando a soma das cargas (%s)", exc)
            res = rodar("simples", min(time_limit_s, 15))
            regra = "soma_entregas_e_coletas"

    res["fonte_distancia"] = fonte
    res["regra_carga"] = regra
    res["nao_alocados"] = res["nao_alocados"] + fora_janela
    res["fora_da_janela"] = fora_janela
    return res


def _resolver(pywrapcp, routing_enums_pb2, pedidos, tipos, janelas, saida_min, veiculos,
              dep, dist_mx, dur_mx, time_limit_s, modo) -> dict:
    """Monta e resolve o modelo. modo: "simples" (uma soma de peso) ou
    "ordem" (entregas e coletas separadas, entregas antes das coletas)."""
    n_nodes = len(pedidos) + 1
    n_veics = len(veiculos)

    # ── Cria modelo ───────────────────────────────────────────────────────────
    manager = pywrapcp.RoutingIndexManager(n_nodes, n_veics, 0)
    routing = pywrapcp.RoutingModel(manager)

    # ── Callback de distância ─────────────────────────────────────────────────
    def dist_cb(from_idx, to_idx):
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return dist_mx[i][j]

    transit_cb_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

    # ── Callback de duração: estrada + atendimento na parada de onde sai ──────
    # (assim o tempo acumulado num nó é a hora de CHEGADA nele)
    def dur_cb(from_idx, to_idx):
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return dur_mx[i][j] + (SERVICE_TIME_S if i != 0 else 0)

    dur_cb_idx = routing.RegisterTransitCallback(dur_cb)

    # ── Dimensão tempo ────────────────────────────────────────────────────────
    routing.AddDimension(
        dur_cb_idx,
        ESPERA_MAX_S,  # espera máxima numa parada (janela ainda não abriu)
        JORNADA_S,     # jornada da viagem
        True,
        "Tempo",
    )
    tempo = routing.GetDimensionOrDie("Tempo")
    for node in range(1, n_nodes):
        j = janelas[node - 1]
        if j:
            tempo.CumulVar(manager.NodeToIndex(node)).SetRange(max(0, j[0]), min(j[1], JORNADA_S))

    # ── Capacidade (peso) ─────────────────────────────────────────────────────
    caps = [int(v["capKg"]) for v in veiculos]

    def demanda(filtro):
        def cb(idx):
            node = manager.IndexToNode(idx)
            if node == 0 or (filtro and tipos[node - 1] != filtro):
                return 0
            return _kg(pedidos[node - 1])
        return routing.RegisterUnaryTransitCallback(cb)

    if modo == "ordem":
        # Peso das entregas (o que sai carregado) e das coletas (o que volta):
        # cada um cabe na capacidade.
        routing.AddDimensionWithVehicleCapacity(demanda("entrega"), 0, caps, True, "PesoEntregas")
        routing.AddDimensionWithVehicleCapacity(demanda("coleta"), 0, caps, True, "PesoColetas")
        # "Fase" conta as coletas já feitas; uma entrega só acontece com zero coletas antes.
        fase_cb = routing.RegisterUnaryTransitCallback(
            lambda idx: 1 if manager.IndexToNode(idx) != 0 and tipos[manager.IndexToNode(idx) - 1] == "coleta" else 0
        )
        routing.AddDimension(fase_cb, 0, n_nodes, True, "Fase")
        fase = routing.GetDimensionOrDie("Fase")
        for node in range(1, n_nodes):
            if tipos[node - 1] == "entrega":
                fase.CumulVar(manager.NodeToIndex(node)).SetRange(0, 0)
    else:
        routing.AddDimensionWithVehicleCapacity(demanda(None), 0, caps, True, "Peso")

    # ── Limite de paradas por veículo ─────────────────────────────────────────
    count_cb_idx = routing.RegisterUnaryTransitCallback(
        lambda idx: 0 if manager.IndexToNode(idx) == 0 else 1
    )
    routing.AddDimensionWithVehicleCapacity(
        count_cb_idx,
        0,
        [int(v["maxPed"]) for v in veiculos],
        True,
        "Paradas",
    )

    # ── Penalidade por pedido não atendido ────────────────────────────────────
    for node in range(1, n_nodes):
        routing.AddDisjunction([manager.NodeToIndex(node)], PENALTY)

    # ── Parâmetros do solver ──────────────────────────────────────────────────
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.seconds = time_limit_s
    params.log_search = False

    # ── Solve ─────────────────────────────────────────────────────────────────
    solution = routing.SolveWithParameters(params)

    if not solution:
        return {
            "routes": [],
            "nao_alocados": [p["nf"] for p in pedidos],
            "solver_status": STATUS_MAP.get(routing.status(), "desconhecido"),
        }

    # ── Extrai rotas ──────────────────────────────────────────────────────────
    routes: list[RotaResultado] = []
    alocados: set[int] = set()

    for v_idx, veiculo in enumerate(veiculos):
        idx = routing.Start(v_idx)
        seq: list[int] = []  # índices de pedido (base-1 em points)

        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node != 0:
                seq.append(node)
                alocados.add(node)
            idx = solution.Value(routing.NextVar(idx))

        if not seq:
            continue

        chegadas, volta_s = _horarios(seq, dur_mx, janelas)
        peds_rota = []
        for n, t in zip(seq, chegadas):
            p = dict(pedidos[n - 1])
            if saida_min is not None:
                p["chegada_min"] = saida_min + int(round(t / 60))
            peds_rota.append(p)
        carga = perfil_carga(peds_rota)

        # Coordenadas para polilinha no mapa
        coords = [{"lat": float(dep["lat"]), "lng": float(dep["lng"])}]
        coords += [{"lat": p["lat"], "lng": p["lng"]} for p in peds_rota]
        coords += [{"lat": float(dep["lat"]), "lng": float(dep["lng"])}]

        routes.append({
            "veiculo": veiculo["nome"],
            "veiculo_id": veiculo["id"],
            "pedidos": peds_rota,
            "km": _calc_km(seq, dist_mx),
            "mins": max(_calc_mins(seq, dur_mx), math.ceil(volta_s / 60)),
            "peso_total": sum(p["peso"] for p in peds_rota),
            "itens_total": sum(p["itens"] for p in peds_rota),
            "entregas": sum(1 for p in peds_rota if _tipo(p) == "entrega"),
            "coletas": sum(1 for p in peds_rota if _tipo(p) == "coleta"),
            "peso_entregas": sum(p["peso"] for p in peds_rota if _tipo(p) == "entrega"),
            "peso_coletas": sum(p["peso"] for p in peds_rota if _tipo(p) == "coleta"),
            "carga_saida_kg": carga["saida_kg"],
            "carga_maxima_kg": carga["maxima_kg"],
            "sequencia_coords": coords,
        })

    nao_alocados = [
        pedidos[n - 1]["nf"]
        for n in range(1, n_nodes)
        if n not in alocados
    ]

    routes.sort(key=lambda r: len(r["pedidos"]), reverse=True)

    return {
        "routes": routes,
        "nao_alocados": nao_alocados,
        "solver_status": STATUS_MAP.get(routing.status(), "desconhecido"),
    }


def _calc_km(seq: list[int], dist_mx: list[list[int]]) -> float:
    if not seq:
        return 0.0
    km = dist_mx[0][seq[0]] / 1000
    for i in range(len(seq) - 1):
        km += dist_mx[seq[i]][seq[i + 1]] / 1000
    km += dist_mx[seq[-1]][0] / 1000
    return round(km, 1)


def _calc_mins(seq: list[int], dur_mx: list[list[int]]) -> int:
    if not seq:
        return 0
    secs = dur_mx[0][seq[0]]
    for i in range(len(seq) - 1):
        secs += dur_mx[seq[i]][seq[i + 1]]
    secs += dur_mx[seq[-1]][0]
    secs += len(seq) * SERVICE_TIME_S
    return math.ceil(secs / 60)
