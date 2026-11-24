"""Cubagem no motor de rotas: o baú (m³) limita junto com o peso (kg)."""
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


def ped(nf, tipo, peso, m3, dlat):
    p = {"id": nf, "nf": nf, "peso": peso, "itens": 1, "cidade": "Guarulhos",
         "lat": CD["lat"] + dlat, "lng": CD["lng"], "status": "pendente", "tipo": tipo}
    if m3 is not None:
        p["m3"] = m3
    return p


def resolver(pedidos, cap_kg, cap_m3, maxped=10):
    v = [{"id": "vuc", "nome": "VUC", "capKg": cap_kg, "capM3": cap_m3, "maxPed": maxped}]
    with mock.patch.object(vs.requests, "get", side_effect=OSError("sem rede")):
        return vs.solve_vrp(pedidos, v, 5, CD)


class TesteMedida(unittest.TestCase):
    def test_litros_arredonda_para_cima_sem_erro_de_virgula(self):
        self.assertEqual(vs._litros({"m3": 0.03}), 30)
        self.assertEqual(vs._litros({"m3": 0.0301}), 31)
        self.assertEqual(vs._litros({"m3": "x"}), 0)
        self.assertEqual(vs._litros({}), 0)

    def test_capacidade_arredonda_para_baixo(self):
        self.assertEqual(vs._cap_litros({"capM3": 18.0009}), 18000)
        self.assertIsNone(vs._cap_litros({"capM3": None}))
        self.assertIsNone(vs._cap_litros({}))
        self.assertIsNone(vs._cap_litros({"capM3": 0}))

    def test_perfil_volume(self):
        seq = [ped("1", "entrega", 10, 2, 0), ped("2", "entrega", 10, 1, 0), ped("9", "coleta", 10, 2.5, 0)]
        self.assertEqual(vs.perfil_volume(seq), {"saida_l": 3000, "retorno_l": 2500, "maxima_l": 3000})


class TesteMotorVolume(unittest.TestCase):
    def test_volume_limita_mesmo_com_peso_sobrando(self):
        # 3 pedidos leves e volumosos (isopor): o peso cabe, o baú não
        peds = [ped(str(i), "entrega", 50, 4, .01 * i) for i in range(1, 4)]
        res = resolver(peds, 3000, 10)
        r = res["routes"][0]
        self.assertEqual(len(r["pedidos"]), 2)
        self.assertEqual(r["m3_total"], 8)
        self.assertEqual(r["carga_maxima_m3"], 8)
        self.assertEqual(len(res["nao_alocados"]), 1)

    def test_sem_bau_medido_volume_nao_limita(self):
        peds = [ped(str(i), "entrega", 50, 4, .01 * i) for i in range(1, 4)]
        res = resolver(peds, 3000, None)
        self.assertEqual(len(res["routes"][0]["pedidos"]), 3)
        self.assertEqual(res["routes"][0]["m3_total"], 12)

    def test_pedido_sem_medida_nao_ocupa_volume(self):
        peds = [ped("1", "entrega", 50, 9, .01), ped("2", "entrega", 50, None, .02)]
        res = resolver(peds, 3000, 10)
        self.assertEqual(len(res["routes"][0]["pedidos"]), 2)
        self.assertEqual(res["routes"][0]["m3_total"], 9)

    def test_peso_continua_limitando(self):
        peds = [ped("1", "entrega", 800, .5, .01), ped("2", "entrega", 800, .5, .02)]
        res = resolver(peds, 1000, 20)
        self.assertEqual(len(res["routes"][0]["pedidos"]), 1)

    def test_misto_entregas_e_coletas_cada_uma_no_bau(self):
        # 8 m³ de entregas + 8 m³ de coletas num baú de 10: nunca há mais de 8 a bordo
        peds = [ped("1", "entrega", 50, 4, .05), ped("2", "entrega", 50, 4, .06),
                ped("8", "coleta", 50, 4, .055), ped("9", "coleta", 50, 4, .005)]
        res = resolver(peds, 3000, 10)
        r = res["routes"][0]
        self.assertEqual(res["regra_carga"], "entregas_antes_das_coletas")
        self.assertEqual(len(r["pedidos"]), 4)
        self.assertEqual(r["carga_saida_m3"], 8)
        self.assertEqual(r["carga_maxima_m3"], 8)
        self.assertEqual((r["m3_entregas"], r["m3_coletas"]), (8, 8))

    def test_misto_entregas_passam_do_bau(self):
        peds = [ped("1", "entrega", 50, 6, .01), ped("2", "entrega", 50, 6, .02), ped("9", "coleta", 50, 1, .03)]
        res = resolver(peds, 3000, 10)
        r = res["routes"][0]
        self.assertLessEqual(r["carga_maxima_m3"], 10)
        self.assertEqual(r["entregas"], 1)

    def test_regra_confere_o_volume(self):
        rota = {"veiculo_id": "vuc", "pedidos": [ped("1", "entrega", 10, 6, 0), ped("2", "entrega", 10, 6, 0)]}
        v = [{"id": "vuc", "nome": "VUC", "capKg": 1000, "capM3": 10, "maxPed": 10}]
        self.assertFalse(vs._rotas_dentro_da_regra([rota], v))
        v[0]["capM3"] = 12
        self.assertTrue(vs._rotas_dentro_da_regra([rota], v))

    def test_plano_b_soma_volume(self):
        original = vs._resolver

        def quebra(*a):
            if "ordem" in a:
                raise RuntimeError("simulado")
            return original(*a)

        peds = [ped("1", "entrega", 50, 6, .05), ped("9", "coleta", 50, 5, .005)]
        with mock.patch.object(vs, "_resolver", side_effect=quebra):
            res = resolver(peds, 3000, 10)
        self.assertEqual(res["regra_carga"], "soma_entregas_e_coletas")
        self.assertEqual(len(res["routes"][0]["pedidos"]), 1)


if __name__ == "__main__":
    unittest.main()
