"""
OR-Tools de mentira, só para os testes (o pacote real não instala neste ambiente).

Implementa o pedaço da API de roteirização que o vrp_solver usa, com a mesma
regra das dimensões do OR-Tools:

    cumul(próximo) = cumul(atual) + trânsito(atual[, próximo]) + folga

(trânsito "unário" é avaliado no nó de onde sai; folga de 0 até slack_max, usada
para esperar a janela abrir), cumul <= capacidade em todos os nós e dentro do
SetRange de cada nó. Resolve por força bruta (1 veículo, poucos
pedidos): testa todas as sequências e devolve a de menor custo (km + multa dos
pedidos que ficaram de fora). Serve para conferir se o MODELO montado pelo
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

    def RegisterTransitCallback(self, fn):
        self.cbs.append((fn, False))
        return len(self.cbs) - 1

    def RegisterUnaryTransitCallback(self, fn):
        self.cbs.append((fn, True))
        return len(self.cbs) - 1

    def SetArcCostEvaluatorOfAllVehicles(self, cb):
        self.arc_cb = cb

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

    def _viavel(self, path):
        for d in self.dims.values():
            assert d.fix_start, "teste só cobre fix_start_cumul_to_zero=True"
            cumul = 0
            for k, idx in enumerate(path):
                var = d.vars.get(idx)
                if k:
                    cumul += self._transito(d.cb, path[k - 1], idx)
                    if var and cumul < var.lo and var.lo - cumul <= d.slack:
                        cumul = var.lo  # espera (folga) até a janela abrir
                if cumul < 0 or cumul > d.caps[0]:
                    return False
                if var and not (var.lo <= cumul <= var.hi):
                    return False
        return True

    def SolveWithParameters(self, params):
        if self.m.v != 1:
            raise NotImplementedError("OR-Tools de teste: só 1 veículo")
        clientes = list(range(1, self.m.n))
        multa = {idx[0]: p for idx, p in self.disj}
        melhor = None
        for k in range(len(clientes) + 1):
            for seq in itertools.permutations(clientes, k):
                path = [self.Start(0), *seq, self.m.end(0)]
                if not self._viavel(path):
                    continue
                custo = sum(self._transito(self.arc_cb, path[i], path[i + 1]) for i in range(len(path) - 1))
                custo += sum(p for c, p in multa.items() if c not in seq)
                if melhor is None or custo < melhor[0]:
                    melhor = (custo, path)
        if melhor is None:
            self._status = 3
            return None
        self._status = 1
        path = melhor[1]
        return _Solution({path[i]: path[i + 1] for i in range(len(path) - 1)})


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
