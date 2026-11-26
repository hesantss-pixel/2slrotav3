"""Frota do dia no motor de rotas: vários veículos numa conta só, custo de usar cada um (usa o
mínimo e o menor que der) e peça comprida só no veículo que comporta."""
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
FIORINO = {"id": "fio", "nome": "Fiorino", "capKg": 650, "capM3": 2.5, "maxPed": 8, "custoFixo": 1800, "compCm": 187}
VUC = {"id": "vuc", "nome": "VUC", "capKg": 3000, "capM3": 15, "maxPed": 8, "custoFixo": 2700, "compCm": 420}


def ped(nf, peso, dlat, m3=None, maior=None, tipo="entrega"):
    p = {"id": nf, "nf": nf, "peso": peso, "itens": 1, "cidade": "Guarulhos", "status": "pendente", "tipo": tipo,
         "lat": CD["lat"] + dlat, "lng": CD["lng"] + dlat / 2}
    if m3 is not None:
        p["m3"] = m3
    if maior is not None:
        p["maiorCm"] = maior
    return p


def resolver(pedidos, frota):
    with mock.patch.object(vs.requests, "get", side_effect=OSError("sem rede")):
        return vs.solve_vrp(pedidos, frota, 5, CD)


class TesteFrota(unittest.TestCase):
    def test_carga_leve_vai_so_no_menor(self):
        res = resolver([ped("1", 100, .01), ped("2", 150, .02), ped("3", 200, .03)], [VUC, FIORINO])
        self.assertEqual(len(res["routes"]), 1)
        self.assertEqual(res["routes"][0]["veiculo_id"], "fio")
        self.assertEqual(res["nao_alocados"], [])

    def test_carga_que_nao_cabe_no_menor_vai_no_maior_sozinho(self):
        res = resolver([ped("1", 500, .01), ped("2", 400, .02), ped("3", 300, .03)], [FIORINO, VUC])
        self.assertEqual([r["veiculo_id"] for r in res["routes"]], ["vuc"])   # 1 veículo, não os dois
        self.assertEqual(len(res["routes"][0]["pedidos"]), 3)

    def test_volume_divide_entre_os_dois_quando_precisa(self):
        # 3,6 t não cabem no VUC (3 t): o motor usa os dois, cada um dentro da capacidade
        res = resolver([ped("1", 1500, .01), ped("2", 1500, .02), ped("3", 600, .03)], [FIORINO, VUC])
        usados = {r["veiculo_id"]: r for r in res["routes"]}
        self.assertEqual(set(usados), {"fio", "vuc"})
        self.assertLessEqual(usados["fio"]["peso_total"], 650)
        self.assertLessEqual(usados["vuc"]["peso_total"], 3000)
        self.assertEqual(res["nao_alocados"], [])

    def test_peca_comprida_so_no_veiculo_que_comporta(self):
        res = resolver([ped("1", 50, .01, maior=300), ped("2", 50, .02)], [FIORINO, VUC])
        onde = {p["nf"]: r["veiculo_id"] for r in res["routes"] for p in r["pedidos"]}
        self.assertEqual(onde["1"], "vuc")

    def test_peca_maior_que_todos_os_baus_fica_de_fora_e_o_resto_sai(self):
        res = resolver([ped("1", 50, .01, maior=600), ped("2", 50, .02)], [FIORINO, VUC])
        self.assertEqual(res["maior_que_bau"], ["1"])
        self.assertIn("1", res["nao_alocados"])
        self.assertEqual([p["nf"] for r in res["routes"] for p in r["pedidos"]], ["2"])

    def test_carroceria_aberta_leva_peca_comprida(self):
        aberta = {**VUC, "id": "aberta", "compCm": None}
        res = resolver([ped("1", 50, .01, maior=900)], [FIORINO, aberta])
        self.assertEqual(res["maior_que_bau"], [])
        self.assertEqual(res["routes"][0]["veiculo_id"], "aberta")

    def test_modelo_recebe_custo_fixo_e_veiculos_permitidos(self):
        modelos = []
        orig = fake_ortools.RoutingModel.__init__

        def guarda(self, m):
            orig(self, m)
            modelos.append(self)
        with mock.patch.object(fake_ortools.RoutingModel, "__init__", guarda):
            resolver([ped("1", 50, .01, maior=300)], [FIORINO, VUC])
        ch = modelos[0].chamadas
        self.assertIn(("SetFixedCostOfVehicle", 0, 1800), ch)
        self.assertIn(("SetFixedCostOfVehicle", 1, 2700), ch)
        self.assertIn(("SetAllowedVehiclesForIndex", 1, (1,)), ch)

    def test_sem_custo_fixo_continua_como_antes(self):
        v = {"id": "v", "nome": "VUC", "capKg": 3000, "maxPed": 8}
        res = resolver([ped("1", 100, .01), ped("2", 100, .02)], [v])
        self.assertEqual(len(res["routes"]), 1)
        self.assertEqual(res["maior_que_bau"], [])

    def test_motor_de_verdade_e_conferido_com_as_chamadas_novas(self):
        vs._motor_ok = None
        self.assertTrue(vs.conferir_motor())


if __name__ == "__main__":
    unittest.main()
