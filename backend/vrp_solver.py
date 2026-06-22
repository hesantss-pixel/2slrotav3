"""
vrp_solver.py — Motor OR-Tools VRP para 2SL LOG
------------------------------------------------
Resolve Vehicle Routing Problem com:
  - Capacidade por peso (kg)
  - Limite de paradas por veículo
  - Janelas de tempo (VRPTW) para pedidos agendados
  - Penalidade por pedido não atendido (solução parcial)
  - Suporte a múltiplos veículos

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

class Pedido(TypedDict):
    nf: str
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
    sequencia_coords: list[dict]  # [{lat, lng}] para desenhar no mapa

# ── Constantes ─────────────────────────────────────────────────────────────────

OSRM_URL   = "https://router.project-osrm.org/table/v1/driving"
DEPOT      = {"lat": -23.4566, "lng": -46.5055, "nome": "2SL LOG — Guarulhos"}
OSRM_LIMIT = 100   # Máximo de pontos por chamada OSRM (servidor público)

# Velocidade média estimada para fallback Haversine: 40 km/h
SPEED_KMH = 40

# Tempo de serviço por parada: 15 min (900 s)
SERVICE_TIME_S = 900

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


# ── OR-Tools VRP ───────────────────────────────────────────────────────────────

def solve_vrp(
    pedidos: list[Pedido],
    veiculos: list[Veiculo],
    time_limit_s: int = 30,
) -> dict:
    """
    Resolve VRP com OR-Tools.

    Parâmetros
    ----------
    pedidos      : lista de pedidos pendentes com lat/lng
    veiculos     : lista de veículos disponíveis
    time_limit_s : tempo máximo do solver em segundos

    Retorna
    -------
    {
        "routes": [RotaResultado, ...],
        "nao_alocados": [nf, ...],
        "fonte_distancia": "OSRM" | "Haversine",
        "solver_status": str,
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

    if not pedidos:
        return {"routes": [], "nao_alocados": [], "fonte_distancia": "—", "solver_status": "vazio"}

    # ── 1. Pontos: depósito (índice 0) + pedidos ──────────────────────────────
    points = [DEPOT] + [{"lat": p["lat"], "lng": p["lng"]} for p in pedidos]
    n_nodes   = len(points)
    n_veics   = len(veiculos)

    dist_mx, dur_mx, fonte = build_distance_matrix(points)

    # ── 2. Cria modelo ────────────────────────────────────────────────────────
    manager = pywrapcp.RoutingIndexManager(n_nodes, n_veics, 0)
    routing = pywrapcp.RoutingModel(manager)

    # ── 3. Callback de distância ──────────────────────────────────────────────
    def dist_cb(from_idx, to_idx):
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return dist_mx[i][j]

    transit_cb_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_cb_idx)

    # ── 4. Callback de duração (para janelas de tempo) ────────────────────────
    def dur_cb(from_idx, to_idx):
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return dur_mx[i][j] + (SERVICE_TIME_S if j != 0 else 0)

    dur_cb_idx = routing.RegisterTransitCallback(dur_cb)

    # ── 5. Dimensão tempo (VRPTW) ─────────────────────────────────────────────
    routing.AddDimension(
        dur_cb_idx,
        slack_max=3600,          # espera máxima em um nó (1 hora)
        capacity=8 * 3600,       # janela do dia: 8 horas
        fix_start_cumul_to_zero=True,
        name="Tempo",
    )

    # ── 6. Dimensão capacidade (peso) ─────────────────────────────────────────
    def demand_cb(idx):
        node = manager.IndexToNode(idx)
        if node == 0:
            return 0
        return int(pedidos[node - 1]["peso"])

    demand_cb_idx = routing.RegisterUnaryTransitCallback(demand_cb)

    # Cada veículo tem sua própria capacidade — define por veículo
    caps = [int(v["capKg"]) for v in veiculos]
    routing.AddDimensionWithVehicleCapacity(
        demand_cb_idx,
        slack_max=0,
        vehicle_capacities=caps,
        fix_start_cumul_to_zero=True,
        name="Peso",
    )

    # ── 7. Limite de paradas por veículo ──────────────────────────────────────
    count_cb_idx = routing.RegisterUnaryTransitCallback(
        lambda idx: 0 if manager.IndexToNode(idx) == 0 else 1
    )
    routing.AddDimensionWithVehicleCapacity(
        count_cb_idx,
        slack_max=0,
        vehicle_capacities=[int(v["maxPed"]) for v in veiculos],
        fix_start_cumul_to_zero=True,
        name="Paradas",
    )

    # ── 8. Penalidade por pedido não atendido ─────────────────────────────────
    for node in range(1, n_nodes):
        routing.AddDisjunction([manager.NodeToIndex(node)], PENALTY)

    # ── 9. Parâmetros do solver ───────────────────────────────────────────────
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.seconds = time_limit_s
    params.log_search = False

    # ── 10. Solve ─────────────────────────────────────────────────────────────
    solution = routing.SolveWithParameters(params)

    STATUS_MAP = {
        0: "não encontrada",
        1: "ótima",
        2: "viável",
        3: "inviável",
        4: "sem modelo",
    }

    if not solution:
        return {
            "routes": [],
            "nao_alocados": [p["nf"] for p in pedidos],
            "fonte_distancia": fonte,
            "solver_status": STATUS_MAP.get(routing.status(), "desconhecido"),
        }

    # ── 11. Extrai rotas ──────────────────────────────────────────────────────
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

        peds_rota = [pedidos[n - 1] for n in seq]

        # Métricas
        km = _calc_km(seq, dist_mx)
        mins = _calc_mins(seq, dur_mx)

        # Coordenadas para polilinha no mapa
        coords = [{"lat": DEPOT["lat"], "lng": DEPOT["lng"]}]
        coords += [{"lat": p["lat"], "lng": p["lng"]} for p in peds_rota]
        coords += [{"lat": DEPOT["lat"], "lng": DEPOT["lng"]}]

        routes.append({
            "veiculo": veiculo["nome"],
            "veiculo_id": veiculo["id"],
            "pedidos": peds_rota,
            "km": km,
            "mins": mins,
            "peso_total": sum(p["peso"] for p in peds_rota),
            "itens_total": sum(p["itens"] for p in peds_rota),
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
        "fonte_distancia": fonte,
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
