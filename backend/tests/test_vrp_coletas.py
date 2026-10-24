"""Testes do motor de rotas com coletas e entregas (python -m unittest discover -s tests)."""
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

CD = {"lat": -23.4245, "lng": -46.3877, "nome": "CD teste"}


def ped(nf, tipo, peso, dlat, dlng):
    p = {"id": ("C_" if tipo == "coleta" else "") + nf, "nf": nf, "peso": peso, "itens": 1,
         "cidade": "Guarulhos", "lat": CD["lat"] + dlat, "lng": CD["lng"] + dlng, "status": "pendente"}
    if tipo:
        p["tipo"] = tipo
    return p


def veic(cap, maxped=10):
    return [{"id": "vuc", "nome": "VUC", "capKg": cap, "maxPed": maxped}]


def resolver(pedidos, cap, maxped=10, saida=None):
    # sem internet nos testes: força a distância em linha reta
    with mock.patch.object(vs.requests, "get", side_effect=OSError("sem rede")):
        return vs.solve_vrp(pedidos, veic(cap, maxped), 5, CD, saida)


def tipos_em_ordem(res):
    return [vs._tipo(p) for p in res["routes"][0]["pedidos"]]


class TesteCarga(unittest.TestCase):
    def test_perfil(self):
        seq = [ped("1", "entrega", 300, 0, 0), ped("2", "entrega", 200, 0, 0), ped("3", "coleta", 450, 0, 0)]
        self.assertEqual(vs.perfil_carga(seq), {"saida_kg": 500, "retorno_kg": 450, "maxima_kg": 500})

    def test_perfil_coleta_antes_sobe_a_carga(self):
        seq = [ped("3", "coleta", 450, 0, 0), ped("1", "entrega", 300, 0, 0), ped("2", "entrega", 200, 0, 0)]
        self.assertEqual(vs.perfil_carga(seq)["maxima_kg"], 950)

    def test_peso_quebrado_arredonda_para_cima(self):
        self.assertEqual(vs._kg({"peso": 99.2}), 100)
        self.assertEqual(vs._kg({"peso": None}), 0)

    def test_sem_tipo_e_entrega(self):
        self.assertEqual(vs._tipo({"nf": "1"}), "entrega")
        self.assertEqual(vs._tipo({"tipo": "Coleta"}), "coleta")

    def test_regra_detecta_entrega_depois_de_coleta(self):
        rota = {"veiculo_id": "vuc", "pedidos": [ped("3", "coleta", 10, 0, 0), ped("1", "entrega", 10, 0, 0)]}
        self.assertFalse(vs._rotas_dentro_da_regra([rota], veic(1000)))
        rota["pedidos"].reverse()
        self.assertTrue(vs._rotas_dentro_da_regra([rota], veic(1000)))


class TesteMotor(unittest.TestCase):
    def test_so_entregas_respeita_capacidade(self):
        peds = [ped("1", "entrega", 400, .01, 0), ped("2", "entrega", 400, .02, 0), ped("3", "entrega", 400, .03, 0)]
        res = resolver(peds, 1000)
        self.assertEqual(res["regra_carga"], "so_entregas")
        self.assertEqual(len(res["routes"][0]["pedidos"]), 2)
        self.assertLessEqual(res["routes"][0]["peso_total"], 1000)
        self.assertEqual(len(res["nao_alocados"]), 1)

    def test_pedidos_antigos_sem_tipo(self):
        peds = [ped("1", None, 400, .01, 0), ped("2", None, 400, .02, 0)]
        res = resolver(peds, 1000)
        self.assertEqual(res["regra_carga"], "so_entregas")
        self.assertEqual(res["routes"][0]["entregas"], 2)

    def test_so_coletas(self):
        peds = [ped("1", "coleta", 700, .01, 0), ped("2", "coleta", 400, .02, 0)]
        res = resolver(peds, 1000)
        self.assertEqual(res["regra_carga"], "so_coletas")
        self.assertEqual(res["routes"][0]["coletas"], 1)
        self.assertEqual(res["routes"][0]["carga_maxima_kg"], 700)

    def test_misto_entregas_antes_das_coletas(self):
        # A coleta 9 fica no caminho (perto do CD): sem a regra, seria a 1ª parada.
        peds = [
            ped("1", "entrega", 600, .05, .05),
            ped("2", "entrega", 300, .06, .04),
            ped("9", "coleta", 500, .005, .005),
            ped("8", "coleta", 400, .055, .045),
        ]
        res = resolver(peds, 1000)
        self.assertEqual(res["regra_carga"], "entregas_antes_das_coletas")
        r = res["routes"][0]
        # 900 kg de entregas + 900 de coletas: somando passaria de 1000, mas nunca há mais de 900 a bordo
        self.assertEqual(len(r["pedidos"]), 4)
        self.assertEqual(tipos_em_ordem(res), ["entrega", "entrega", "coleta", "coleta"])
        self.assertEqual(r["carga_saida_kg"], 900)
        self.assertEqual(r["carga_maxima_kg"], 900)
        self.assertEqual((r["entregas"], r["coletas"]), (2, 2))
        self.assertEqual(res["nao_alocados"], [])

    def test_misto_entregas_passam_da_capacidade(self):
        peds = [ped("1", "entrega", 700, .01, 0), ped("2", "entrega", 600, .02, 0), ped("9", "coleta", 300, .03, 0)]
        res = resolver(peds, 1000)
        r = res["routes"][0]
        self.assertLessEqual(r["carga_maxima_kg"], 1000)
        self.assertEqual(r["entregas"], 1)
        self.assertEqual(len(res["nao_alocados"]), 1)

    def test_misto_limite_de_paradas(self):
        peds = [ped(str(i), "entrega" if i % 2 else "coleta", 10, .01 * i, 0) for i in range(1, 6)]
        res = resolver(peds, 1000, maxped=3)
        self.assertEqual(len(res["routes"][0]["pedidos"]), 3)
        self.assertNotIn(["coleta", "entrega"], [tipos_em_ordem(res)[i:i + 2] for i in range(2)])

    def test_plano_b_se_o_modelo_misto_falhar(self):
        original = vs._resolver

        def quebra(*a):
            if a[-1] == "ordem":
                raise RuntimeError("simulado")
            return original(*a)

        peds = [ped("1", "entrega", 600, .05, .05), ped("9", "coleta", 500, .005, .005)]
        with mock.patch.object(vs, "_resolver", side_effect=quebra):
            res = resolver(peds, 1000)
        self.assertEqual(res["regra_carga"], "soma_entregas_e_coletas")
        # pela soma, 600 + 500 não cabe em 1000: vai só um dos dois
        self.assertEqual(len(res["routes"][0]["pedidos"]), 1)

    def test_resultado_leva_id_e_tipo(self):
        peds = [ped("5", "coleta", 100, .01, 0)]
        res = resolver(peds, 1000)
        p = res["routes"][0]["pedidos"][0]
        self.assertEqual((p["id"], p["nf"], p["tipo"]), ("C_5", "5", "coleta"))



def jan(p, ini, fim):
    p["janela_ini"], p["janela_fim"] = ini, fim
    return p


class TesteJanela(unittest.TestCase):
    def test_janela_decide_a_ordem(self):
        # B é longe e precisa chegar até 07:45; A é perto, mas só abre às 09:00
        a = jan(ped("A", "entrega", 50, .01, 0), 540, 600)
        b = jan(ped("B", "entrega", 50, .2, 0), 420, 465)
        res = resolver([a, b], 1000, saida=420)
        r = res["routes"][0]
        self.assertEqual([p["nf"] for p in r["pedidos"]], ["B", "A"])
        cheg = {p["nf"]: p["chegada_min"] for p in r["pedidos"]}
        self.assertLessEqual(cheg["B"], 465)
        self.assertEqual(cheg["A"], 540)  # chegou antes e esperou abrir
        self.assertGreaterEqual(r["mins"], 540 - 420 + 15)

    def test_janela_que_ja_passou_fica_de_fora(self):
        a = ped("A", "entrega", 50, .01, 0)
        b = jan(ped("B", "entrega", 50, .02, 0), 360, 390)  # 06:00–06:30, saída 07:00
        res = resolver([a, b], 1000, saida=420)
        self.assertEqual(res["fora_da_janela"], ["B"])
        self.assertIn("B", res["nao_alocados"])
        self.assertEqual([p["nf"] for p in res["routes"][0]["pedidos"]], ["A"])

    def test_janela_impossivel_pelo_caminho(self):
        # abre 07:00 e fecha 07:10, mas a viagem até lá leva ~33 min: o motor deixa de fora
        b = jan(ped("B", "entrega", 50, .2, 0), 420, 430)
        a = ped("A", "entrega", 50, .01, 0)
        res = resolver([a, b], 1000, saida=420)
        self.assertEqual([p["nf"] for p in res["routes"][0]["pedidos"]], ["A"])
        self.assertIn("B", res["nao_alocados"])

    def test_sem_hora_de_saida_ignora_janela(self):
        b = jan(ped("B", "entrega", 50, .02, 0), 360, 390)
        res = resolver([b], 1000)
        self.assertEqual(len(res["routes"][0]["pedidos"]), 1)
        self.assertNotIn("chegada_min", res["routes"][0]["pedidos"][0])

    def test_janela_com_coletas(self):
        e = jan(ped("E", "entrega", 300, .02, .01), 480, 600)
        c = ped("C", "coleta", 200, .005, .005)
        res = resolver([e, c], 1000, saida=420)
        self.assertEqual(res["regra_carga"], "entregas_antes_das_coletas")
        r = res["routes"][0]
        self.assertEqual([p["nf"] for p in r["pedidos"]], ["E", "C"])
        self.assertEqual(r["pedidos"][0]["chegada_min"], 480)


if __name__ == "__main__":
    unittest.main()
