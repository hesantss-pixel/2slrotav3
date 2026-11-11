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

vs.OSRM_INTERVALO = 0   # nos testes não há servidor público para respeitar

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


def avaliar(pedidos, saida=None):
    with mock.patch.object(vs.requests, "get", side_effect=OSError("sem rede")):
        return vs.avaliar_sequencia(pedidos, CD, saida)


class TesteAvaliarSequencia(unittest.TestCase):
    """Rota ajustada à mão: mede na ordem recebida, sem reordenar."""

    def test_vazia(self):
        r = avaliar([])
        self.assertEqual((r["km"], r["mins"], r["chegada_min"]), (0.0, 0, []))

    def test_mantem_a_ordem_e_mede_ida_e_volta(self):
        perto, longe = ped("P", "entrega", 10, .01, 0), ped("L", "entrega", 10, .05, 0)
        a = avaliar([perto, longe], saida=420)
        b = avaliar([longe, perto], saida=420)
        # CD → P → L → CD e CD → L → P → CD têm o mesmo km (mesma reta), mas as chegadas mudam
        self.assertAlmostEqual(a["km"], b["km"], places=1)
        self.assertLess(a["chegada_min"][0], a["chegada_min"][1])
        self.assertGreater(b["chegada_min"][1], b["chegada_min"][0])
        self.assertLess(a["chegada_min"][0], b["chegada_min"][1])
        self.assertTrue(a["fonte_distancia"].startswith("Haversine"), a["fonte_distancia"])

    def test_ordem_ruim_custa_mais_km(self):
        norte, sul = ped("N", "entrega", 10, .05, 0), ped("S", "entrega", 10, -.05, 0)
        norte2 = ped("N2", "entrega", 10, .06, 0)
        boa = avaliar([norte, norte2, sul])
        ruim = avaliar([norte, sul, norte2])
        self.assertGreater(ruim["km"], boa["km"])

    def test_tempo_inclui_atendimento(self):
        r = avaliar([ped("A", "entrega", 10, 0, 0)], saida=420)
        # ponto em cima do CD: só os 15 min de atendimento
        self.assertEqual(r["mins"], 15)
        self.assertEqual(r["chegada_min"], [420])

    def test_espera_a_janela_abrir(self):
        a = jan(ped("A", "entrega", 10, .001, 0), 600, 660)
        r = avaliar([a], saida=420)
        self.assertEqual(r["chegada_min"], [600])
        self.assertGreaterEqual(r["mins"], 600 - 420 + 15)

    def test_sem_saida_nao_tem_chegada(self):
        r = avaliar([ped("A", "entrega", 10, .01, 0)])
        self.assertEqual(r["chegada_min"], [None])

    def test_passa_da_jornada(self):
        # janela abre 7 h depois da saída e o ponto fica a ~1 h: volta depois das 8 h
        a = jan(ped("A", "entrega", 10, .3, 0), 420 + 7 * 60, 420 + 7 * 60 + 30)
        self.assertTrue(avaliar([a], saida=420)["passa_da_jornada"])
        self.assertFalse(avaliar([ped("B", "entrega", 10, .01, 0)], saida=420)["passa_da_jornada"])

    def test_limite_de_paradas(self):
        with self.assertRaises(ValueError):
            avaliar([ped(str(i), "entrega", 1, 0, 0) for i in range(vs.MAX_PARADAS_AVALIAR + 1)])

    def test_mesmo_calculo_do_motor(self):
        # a medida da rota gerada pelo motor e a da mesma ordem medida aqui batem
        peds = [ped("A", "entrega", 50, .01, .01), ped("B", "entrega", 50, .02, -.01), ped("C", "entrega", 50, -.01, .02)]
        res = resolver(peds, 1000, saida=420)
        rota = res["routes"][0]
        med = avaliar(rota["pedidos"], saida=420)
        self.assertEqual(med["km"], rota["km"])
        self.assertEqual(med["mins"], rota["mins"])
        self.assertEqual(med["chegada_min"], [p["chegada_min"] for p in rota["pedidos"]])


if __name__ == "__main__":
    unittest.main()


class TesteServidorDeRotasConfiguravel(unittest.TestCase):
    """O servidor de rotas sai de variáveis de ambiente (para trocar o público por um próprio)."""

    def _carregar(self, env):
        import importlib.util
        spec = importlib.util.spec_from_file_location("vrp_env_teste", vs.__file__)
        m = importlib.util.module_from_spec(spec)
        with mock.patch.dict(os.environ, env, clear=False):
            spec.loader.exec_module(m)
        return m

    def test_padrao_e_o_servidor_publico(self):
        m = self._carregar({"OSRM_URL": "", "OSRM_LIMIT": "", "OSRM_TIMEOUT": ""})
        self.assertEqual(m.OSRM_URL, "https://router.project-osrm.org/table/v1/driving")
        self.assertEqual((m.OSRM_LIMIT, m.OSRM_TIMEOUT), (100, 10))

    def test_servidor_proprio(self):
        m = self._carregar({"OSRM_URL": "https://rotas.exemplo.com.br/table/v1/driving/",
                            "OSRM_LIMIT": "400", "OSRM_TIMEOUT": "20"})
        self.assertEqual(m.OSRM_URL, "https://rotas.exemplo.com.br/table/v1/driving")
        self.assertEqual((m.OSRM_LIMIT, m.OSRM_TIMEOUT), (400, 20))
        with mock.patch.object(m.requests, "get", side_effect=m.requests.ConnectionError("x")) as g:
            fonte = m.build_distance_matrix([CD, {"lat": -23.5, "lng": -46.5}])[2]
        self.assertIn("Haversine", fonte)  # servidor fora do ar: cai para linha reta, sem erro
        self.assertTrue(g.call_args.args[0].startswith("https://rotas.exemplo.com.br/table/v1/driving/"))
        self.assertEqual(g.call_args.kwargs["timeout"], 20)

    def test_valor_errado_nao_derruba_o_servidor(self):
        m = self._carregar({"OSRM_LIMIT": "cem", "OSRM_TIMEOUT": "-3"})
        self.assertEqual((m.OSRM_LIMIT, m.OSRM_TIMEOUT), (100, 10))


def _resp_route(geo):
    r = mock.Mock()
    r.raise_for_status.return_value = None
    r.json.return_value = {"code": "Ok", "routes": [{"geometry": geo, "distance": 1000, "duration": 100}]}
    return r


class TesteTracadoPelasRuas(unittest.TestCase):
    """A linha da rota no mapa vem do /route do OSRM, pelas ruas, na ordem das paradas."""

    def setUp(self):
        vs._cache_tracado.clear()

    def test_polyline6_ida_e_volta(self):
        # mesmos inteiros do exemplo oficial do Google (precisão 5) = mesma sequência de letras
        self.assertEqual(vs.polyline6_encode([(3.85, -12.02), (4.07, -12.095), (4.3252, -12.6453)]),
                         "_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        pts = [(-23.424492, -46.387695), (-23.45, -46.53), (-23.4501, -46.5302), (-23.424492, -46.387695)]
        volta = vs.polyline6_decode(vs.polyline6_encode(pts))
        for a, b in zip(pts, volta):
            self.assertAlmostEqual(a[0], b[0], places=6)
            self.assertAlmostEqual(a[1], b[1], places=6)

    def test_le_a_geometria_de_verdade_do_osrm(self):
        # resposta real do router.project-osrm.org (CD → Av. Papa João XXIII → CD, 11/11/2026)
        import json
        with open(os.path.join(AQUI, "dados", "osrm_route_guarulhos.json"), encoding="utf-8") as f:
            r = json.load(f)["routes"][0]
        pts = vs.polyline6_decode(r["geometry"])
        self.assertGreater(len(pts), 400, "linha pelas ruas tem centenas de pontos, não 3")
        soma = sum(vs._haversine_m({"lat": a[0], "lng": a[1]}, {"lat": b[0], "lng": b[1]})
                   for a, b in zip(pts, pts[1:]))
        self.assertAlmostEqual(soma / r["distance"], 1.0, delta=0.01)   # mesmo comprimento que o OSRM mediu
        self.assertEqual(vs.polyline6_encode(pts), r["geometry"])

    def test_pede_o_route_na_ordem_com_geometria_completa(self):
        linha = [(-23.4245, -46.3877), (-23.43, -46.40), (-23.44, -46.41)]
        geo = vs.polyline6_encode(linha)
        pts = [CD, {"lat": -23.44, "lng": -46.41}, CD]
        with mock.patch.object(vs.requests, "get", return_value=_resp_route(geo)) as g:
            self.assertEqual(vs.tracado_rota(pts), geo)
            self.assertEqual(vs.tracado_rota(pts), geo)      # a segunda vem da memória
        self.assertEqual(g.call_count, 1)
        url, kw = g.call_args.args[0], g.call_args.kwargs
        self.assertIn("/route/v1/driving/", url)
        # OSRM recebe longitude,latitude, na ordem das paradas
        self.assertTrue(url.endswith("-46.38770,-23.42450;-46.41000,-23.44000;-46.38770,-23.42450"), url)
        self.assertEqual(kw["params"]["overview"], "full")
        self.assertEqual(kw["params"]["geometries"], "polyline6")
        self.assertIn("ROTAV3", kw["headers"]["User-Agent"])

    def test_rota_grande_vai_em_partes_e_emenda(self):
        pts = [{"lat": -23.40 - i / 100, "lng": -46.40} for i in range(7)]
        # cada parte devolve a reta entre seus próprios pontos
        def resposta(url, **kw):
            coords = url.rsplit("/", 1)[1].split(";")
            linha = [(float(c.split(",")[1]), float(c.split(",")[0])) for c in coords]
            return _resp_route(vs.polyline6_encode(linha))
        with mock.patch.object(vs, "OSRM_ROUTE_MAX", 3), \
                mock.patch.object(vs.requests, "get", side_effect=resposta) as g:
            geo = vs.tracado_rota(pts)
        self.assertEqual(g.call_count, 3)                     # 0-2, 2-4, 4-6
        linha = vs.polyline6_decode(geo)
        self.assertEqual(len(linha), 7, "o ponto de emenda não pode aparecer duas vezes")
        self.assertAlmostEqual(linha[-1][0], -23.46, places=5)

    def test_servidor_fora_devolve_none(self):
        with mock.patch.object(vs.requests, "get", side_effect=vs.requests.ConnectionError("x")):
            self.assertIsNone(vs.tracado_rota([CD, {"lat": -23.5, "lng": -46.5}, CD]))
        ruim = mock.Mock()
        ruim.raise_for_status.return_value = None
        ruim.json.return_value = {"code": "NoRoute", "routes": []}
        with mock.patch.object(vs.requests, "get", return_value=ruim):
            self.assertIsNone(vs.tracado_rota([CD, {"lat": -23.6, "lng": -46.6}, CD]))
        self.assertEqual(vs._cache_tracado, {}, "falha não fica guardada")
        self.assertIsNone(vs.tracado_rota([CD]))

    def test_uma_consulta_por_segundo_so_no_servidor_publico(self):
        import time
        with mock.patch.object(vs, "OSRM_INTERVALO", 0.3), \
                mock.patch.object(vs, "_ultima_consulta", 0.0):
            t0 = time.monotonic()
            vs._esperar_vez("https://router.project-osrm.org/route/v1/driving")
            vs._esperar_vez("https://router.project-osrm.org/table/v1/driving")
            self.assertGreaterEqual(time.monotonic() - t0, 0.29)
            t1 = time.monotonic()
            vs._esperar_vez("https://rotas.exemplo.com.br/route/v1/driving")
            vs._esperar_vez("https://rotas.exemplo.com.br/route/v1/driving")
            self.assertLess(time.monotonic() - t1, 0.05)
