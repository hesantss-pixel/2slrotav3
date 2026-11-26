"""
OR-Tools de mentira, só para os testes (o pacote real não instala neste ambiente).

Implementa o pedaço da API de roteirização que o vrp_solver usa, com a mesma
regra das dimensões do OR-Tools:

    cumul(próximo) = cumul(atual) + trânsito(atual[, próximo]) + folga

(trânsito "unário" é avaliado no nó de onde sai; folga de 0 até slack_max, usada
para esperar a janela abrir), cumul <= capacidade em todos os nós e dentro do
SetRange de cada nó. Resolve por força bruta (poucos veículos, poucos
pedidos): testa todas as divisões e sequências e devolve a de menor custo (km + custo
fixo de cada veículo usado + multa dos pedidos que ficaram de fora), respeitando os
veículos permitidos de cada nó. Serve para conferir se o MODELO montado pelo
vrp_solver diz o que deveria dizer — não testa o desempenho do OR-Tools de verdade.
"""

import itertools
import sys
import types


class _Var:
    def __init__(self):
        self.lo, self.hi = 0, 10**18

    def SetRange(self, lo, hi):
        self.lo, self.hi = max(self.lo, lo), min(self.hi, hi)

    def SetMax(self, hi):
        self.hi = min(self.hi, hi)

    def SetMin(self, lo):
        self.lo = max(self.lo, lo)


class _Dim:
    def __init__(self, cb, caps, fix_start, name, slack=0):
        self.cb, self.caps, self.fix_start, self.name, self.slack = cb, caps, fix_start, name, slack
        self.vars = {}

    def CumulVar(self, index):
        return self.vars.setdefault(index, _Var())


class RoutingIndexManager:
    def __init__(self, n_nodes, n_veh, depot):
        assert depot == 0
        self.n, self.v = n_nodes, n_veh

    def start(self, v):
        return self.n + 2 * v

    def end(self, v):
        return self.n + 2 * v + 1

    def IndexToNode(self, index):
        return index if 1 <= index < self.n else 0

    def NodeToIndex(self, node):
        return node if node >= 1 else self.start(0)


class _Solution:
    def __init__(self, nxt):
        self.nxt = nxt

    def Value(self, token):
        return self.nxt[token[1]]


class RoutingModel:
    def __init__(self, manager):
        self.m = manager
        self.cbs, self.dims, self.disj = [], {}, []
        self.arc_cb = None
        self._status = 0
        self.chamadas = []
        self.fixos, self.permitidos = {}, {}

    def RegisterTransitCallback(self, fn):
        self.cbs.append((fn, False))
        return len(self.cbs) - 1

    def RegisterUnaryTransitCallback(self, fn):
        self.cbs.append((fn, True))
        return len(self.cbs) - 1

    def SetArcCostEvaluatorOfAllVehicles(self, cb):
        self.arc_cb = cb

    def SetFixedCostOfVehicle(self, cost, v):
        self.chamadas.append(("SetFixedCostOfVehicle", v, cost))
        self.fixos[v] = cost

    def SetAllowedVehiclesForIndex(self, vehicles, index):
        self.chamadas.append(("SetAllowedVehiclesForIndex", index, tuple(vehicles)))
        if vehicles:   # como no OR-Tools: lista vazia = todos os veículos
            self.permitidos[index] = set(vehicles)

    def AddDimension(self, cb, slack_max, capacity, fix_start, name):
        self.chamadas.append(("AddDimension", name))
        self.dims[name] = _Dim(cb, [capacity] * self.m.v, fix_start, name, slack_max)
        return True

    def AddDimensionWithVehicleCapacity(self, cb, slack_max, caps, fix_start, name):
        self.chamadas.append(("AddDimensionWithVehicleCapacity", name))
        assert len(caps) == self.m.v
        self.dims[name] = _Dim(cb, list(caps), fix_start, name, slack_max)
        return True

    def GetDimensionOrDie(self, name):
        return self.dims[name]

    def AddDisjunction(self, indices, penalty):
        self.disj.append((indices, penalty))

    def Start(self, v):
        return self.m.start(v)

    def IsEnd(self, index):
        return index >= self.m.n and (index - self.m.n) % 2 == 1

    def NextVar(self, index):
        return ("next", index)

    def status(self):
        return self._status

    def _transito(self, cb, a, b):
        fn, unario = self.cbs[cb]
        return fn(a) if unario else fn(a, b)

    def _viavel(self, path, v=0):
        for d in self.dims.values():
            assert d.fix_start, "teste só cobre fix_start_cumul_to_zero=True"
            cumul = 0
            for k, idx in enumerate(path):
                var = d.vars.get(idx)
                if k:
                    cumul += self._transito(d.cb, path[k - 1], idx)
                    if var and cumul < var.lo and var.lo - cumul <= d.slack:
                        cumul = var.lo  # espera (folga) até a janela abrir
                if cumul < 0 or cumul > d.caps[v]:
                    return False
                if var and not (var.lo <= cumul <= var.hi):
                    return False
        return True

    def _melhor_seq(self, v, nos):
        """Melhor ordem para o veículo v visitar todos os nós (ou None se não dá)."""
        if any(v not in self.permitidos.get(c, {v}) for c in nos):
            return None
        melhor = None
        for seq in itertools.permutations(nos):
            path = [self.Start(v), *seq, self.m.end(v)]
            if not self._viavel(path, v):
                continue
            custo = sum(self._transito(self.arc_cb, path[i], path[i + 1]) for i in range(len(path) - 1))
            if melhor is None or custo < melhor[0]:
                melhor = (custo, path)
        return melhor

    def SolveWithParameters(self, params):
        clientes = list(range(1, self.m.n))
        multa = {idx[0]: p for idx, p in self.disj}
        V = self.m.v
        melhor = None
        # cada cliente vai para um veículo (0..V-1) ou fica de fora (V)
        for divisao in itertools.product(range(V + 1), repeat=len(clientes)):
            # como no OR-Tools: nó sem AddDisjunction é obrigatório
            if any(dv == V and c not in multa for c, dv in zip(clientes, divisao)):
                continue
            custo, paths, ok = 0, {}, True
            for v in range(V):
                nos = [c for c, dv in zip(clientes, divisao) if dv == v]
                if not nos:
                    continue
                m = self._melhor_seq(v, nos)
                if m is None:
                    ok = False
                    break
                custo += m[0] + self.fixos.get(v, 0)
                paths[v] = m[1]
            if not ok:
                continue
            custo += sum(p for c, p in multa.items() if divisao[clientes.index(c)] == V)
            if melhor is None or custo < melhor[0]:
                melhor = (custo, paths)
        if melhor is None:
            self._status = 3
            return None
        self._status = 1
        nxt = {}
        for v in range(V):
            path = melhor[1].get(v, [self.Start(v), self.m.end(v)])
            nxt.update({path[i]: path[i + 1] for i in range(len(path) - 1)})
        return _Solution(nxt)


def DefaultRoutingSearchParameters():
    p = types.SimpleNamespace()
    p.time_limit = types.SimpleNamespace(seconds=0)
    return p


def instalar():
    """Coloca o módulo falso no lugar de 'ortools' (chamar antes de importar o solver)."""
    pywrapcp = types.ModuleType("ortools.constraint_solver.pywrapcp")
    pywrapcp.RoutingIndexManager = RoutingIndexManager
    pywrapcp.RoutingModel = RoutingModel
    pywrapcp.DefaultRoutingSearchParameters = DefaultRoutingSearchParameters
    enums = types.ModuleType("ortools.constraint_solver.routing_enums_pb2")
    enums.FirstSolutionStrategy = types.SimpleNamespace(PATH_CHEAPEST_ARC=3)
    enums.LocalSearchMetaheuristic = types.SimpleNamespace(GUIDED_LOCAL_SEARCH=2)
    cs = types.ModuleType("ortools.constraint_solver")
    cs.pywrapcp, cs.routing_enums_pb2 = pywrapcp, enums
    root = types.ModuleType("ortools")
    root.constraint_solver = cs
    sys.modules.update({
        "ortools": root,
        "ortools.constraint_solver": cs,
        "ortools.constraint_solver.pywrapcp": pywrapcp,
        "ortools.constraint_solver.routing_enums_pb2": enums,
    })
    return pywrapcp
