"""Reentrega com prioridade: quando não cabe tudo, o pedido com prioridade (reentrega, urgente)
entra antes de um pedido novo; prioridade inválida vale como normal."""
import os
import sys
import unittest
from unittest import mock

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)

import fake_ortools  # noqa: E402

fake_ortools.instalar()
import vrp_solver as vs  # noqa: E402

vs.OSRM_INTERVALO = 0
CD = {"lat": -23.4245, "lng": -46.3877, "nome": "CD teste"}
VUC = {"id": "vuc", "nome": "VUC", "capKg": 500, "maxPed": 8}


def ped(nf, dlat, prio=None):
    p = {"id": nf, "nf": nf, "peso": 300, "itens": 1, "cidade": "Guarulhos", "status": "pendente", "tipo": "entrega",
         "lat": CD["lat"] + dlat, "lng": CD["lng"] + dlat / 2}
    if prio is not None:
        p["prioridade"] = prio
    return p


def resolver(pedidos):
    with mock.patch.object(vs.requests, "get", side_effect=OSError("sem rede")):
        return vs.solve_vrp(pedidos, [VUC], 5, CD)


class TestePrioridade(unittest.TestCase):
    def test_sem_prioridade_fica_o_mais_perto(self):
        res = resolver([ped("perto", .01), ped("longe", .08)])
        self.assertEqual([p["nf"] for p in res["routes"][0]["pedidos"]], ["perto"])

    def test_reentrega_entra_antes_do_pedido_novo(self):
        res = resolver([ped("perto", .01), ped("longe", .08, prio=3)])
        self.assertEqual([p["nf"] for p in res["routes"][0]["pedidos"]], ["longe"])
        self.assertEqual(res["nao_alocados"], ["perto"])

    def test_prioridade_invalida_vale_como_normal(self):
        for ruim in ("x", -5, None, ""):
            self.assertEqual(vs._prioridade({"prioridade": ruim}), 0)
        self.assertEqual(vs._prioridade({"prioridade": 9}), 3)

    def test_penalidade_no_modelo(self):
        modelos = []
        orig = fake_ortools.RoutingModel.__init__

        def guarda(self, m):
            orig(self, m)
            modelos.append(self)
        with mock.patch.object(fake_ortools.RoutingModel, "__init__", guarda):
            resolver([ped("a", .01), ped("b", .02, prio=2)])
        pen = [p for _, p in modelos[0].disj]
        self.assertEqual(len(pen), 2)
        self.assertEqual(pen[1], pen[0] * 5)   # prioridade 2: 1 + 2 × 2


if __name__ == "__main__":
    unittest.main()
