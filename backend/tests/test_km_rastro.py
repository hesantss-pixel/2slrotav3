"""Km rodado pelo rastro do GPS: limpeza, trechos, casamento com as ruas e buracos."""
import math
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fake_ortools  # noqa: E402

fake_ortools.instalar()
import vrp_solver as vs  # noqa: E402
import km_rastro as kr  # noqa: E402

vs.OSRM_INTERVALO = 0

LAT0, LNG0 = -23.4245, -46.3877
M_POR_GRAU = 111_195


def andar(n, passo_m=100, dt_s=20, ini_t=0, tremer=0.0, acc=8, norte=True):
    """n pontos andando reto para o norte, passo_m metros a cada dt_s segundos."""
    pts = []
    for i in range(n):
        d = i * passo_m
        ruido = tremer * (1 if i % 2 else -1) / (M_POR_GRAU * math.cos(math.radians(LAT0)))
        pts.append({"lat": LAT0 + (d / M_POR_GRAU if norte else 0), "lng": LNG0 + ruido,
                    "t": (ini_t + i * dt_s) * 1000, "acc": acc})
    return pts


def resposta(dados):
    r = mock.Mock()
    r.raise_for_status.return_value = None
    r.json.return_value = dados
    return r


def osrm_falso(url, params=None, **kw):
    """/match devolve a reta entre o primeiro e o último ponto (a rua é reta), num pedaço
    só, com um tracepoint por ponto; /route devolve 1,3 × a linha reta."""
    pares = url.rsplit("/", 1)[1].split(";")
    pts = [{"lng": float(c.split(",")[0]), "lat": float(c.split(",")[1])} for c in pares]
    reta = vs._haversine_m(pts[0], pts[-1])
    if "/match/" in url:
        tps = [{"location": [p["lng"], p["lat"]], "matchings_index": 0, "waypoint_index": i} for i, p in enumerate(pts)]
        return resposta({"code": "Ok", "matchings": [{"distance": reta, "confidence": 0.9}], "tracepoints": tps})
    return resposta({"code": "Ok", "routes": [{"distance": reta * 1.3}]})


def osrm_em_pedacos(cortes, distancias=None):
    """/match que corta o traço nos índices dados (o veículo parou, o GPS falhou):
    os pontos dos cortes ficam sem tracepoint e cada pedaço é a reta dos seus pontos,
    a não ser que `distancias` diga outra coisa."""
    def f(url, params=None, **kw):
        pares = url.rsplit("/", 1)[1].split(";")
        pts = [{"lng": float(c.split(",")[0]), "lat": float(c.split(",")[1])} for c in pares]
        if "/route/" in url:
            return resposta({"code": "Ok", "routes": [{"distance": vs._haversine_m(pts[0], pts[-1]) * 1.3}]})
        tps, grupos, k = [], [[]], 0
        for i, p in enumerate(pts):
            if i in cortes:
                tps.append(None)
                if grupos[-1]:
                    grupos.append([])
                    k += 1
                continue
            tps.append({"location": [p["lng"], p["lat"]], "matchings_index": k, "waypoint_index": len(grupos[-1])})
            grupos[-1].append(p)
        grupos = [g for g in grupos if g]
        ms = [{"distance": (distancias[j] if distancias else vs._haversine_m(g[0], g[-1])), "confidence": 0.8}
              for j, g in enumerate(grupos)]
        return resposta({"code": "Ok", "matchings": ms, "tracepoints": tps})
    return f


class TesteLimpeza(unittest.TestCase):
    def test_parado_nao_faz_zigue_zague(self):
        # 10 leituras paradas na frente do cliente, tremendo até 12 m: fica uma só
        parado = [{"lat": LAT0 + (6 if i % 2 else -6) / M_POR_GRAU, "lng": LNG0, "t": i * 20_000, "acc": 10} for i in range(10)]
        limpos, desc = kr.limpar(parado)
        self.assertEqual(len(limpos), 1)
        self.assertEqual(desc, 9)

    def test_raio_e_metade_da_precisao(self):
        # o navegador dá o raio de 95%; o /match quer o desvio padrão
        self.assertEqual([kr.raio(a) for a in (4, 8, 20, 40, 50)], [5, 5, 10, 20, 25])

    def test_descarta_precisao_ruim_salto_e_repetido(self):
        pts = andar(5)
        pts.insert(2, {"lat": LAT0 + 0.5, "lng": LNG0, "t": 30_000, "acc": 8})       # salto de 55 km em 10 s
        pts.append({"lat": LAT0, "lng": LNG0, "t": 200_000, "acc": 300})             # precisão de 300 m
        pts.append(dict(pts[-2], t=pts[-2]["t"] + 1000))                              # repetido
        pts.append({"lat": "x", "lng": LNG0, "t": 1})                                 # lixo
        limpos, desc = kr.limpar(pts)
        self.assertEqual(len(limpos), 5)
        self.assertEqual(desc, 4)

    def test_ordena_por_tempo(self):
        pts = andar(4)[::-1]
        limpos, _ = kr.limpar(pts)
        self.assertEqual([p["t"] for p in limpos], sorted(p["t"] for p in limpos))

    def test_divide_onde_o_sinal_sumiu(self):
        a = andar(6)
        b = andar(6, ini_t=6 * 20 + 600)   # 10 min sem ponto
        for p in b:
            p["lat"] += 700 / M_POR_GRAU
        grupos = kr.trechos(kr.limpar(a + b)[0])
        self.assertEqual([len(g) for g in grupos], [6, 6])


class TesteKm(unittest.TestCase):
    def test_rastro_completo_e_casado(self):
        # 3 km reto, ponto a cada 100 m, com o GPS tremendo 8 m para os lados
        pts = andar(31, tremer=8)
        with mock.patch.object(kr.requests, "get", side_effect=osrm_falso) as g:
            r = kr.calcular(pts)
        self.assertAlmostEqual(r["km_total"], 3.0, delta=0.05)
        self.assertEqual(r["km_estimado"], 0)
        self.assertEqual(r["cobertura"], 1.0)
        self.assertTrue(r["casado"])
        # a soma ponto a ponto teria inflado pelo tremor
        soma_bruta = sum(vs._haversine_m(a, b) for a, b in zip(pts, pts[1:])) / 1000
        self.assertGreater(soma_bruta, 3.0)
        url, kw = g.call_args.args[0], g.call_args.kwargs
        self.assertIn("/match/v1/driving/", url)
        self.assertEqual(len(kw["params"]["timestamps"].split(";")), 31)
        self.assertEqual(kw["params"]["radiuses"].split(";")[0], "5")   # precisão 8 m ÷ 2, no mínimo 5
        self.assertIn("ROTAV3", kw["headers"]["User-Agent"])

    def test_buraco_do_sinal_vira_estimado(self):
        a = andar(11)                                   # 1 km
        b = andar(11, ini_t=11 * 20 + 900)              # 15 min sem sinal, depois mais 1 km
        for p in b:
            p["lat"] += 3000 / M_POR_GRAU               # começa 2 km depois do fim de a
        with mock.patch.object(kr.requests, "get", side_effect=osrm_falso):
            r = kr.calcular(a + b)
        self.assertAlmostEqual(r["km_medido"], 2.0, delta=0.05)
        self.assertAlmostEqual(r["km_estimado"], 2.6, delta=0.05)   # 2 km × 1,3 pelas ruas
        self.assertEqual(r["trechos"], 2)
        self.assertAlmostEqual(r["cobertura"], 2.0 / 4.6, delta=0.02)

    def test_rastro_longo_vai_em_blocos_com_emenda(self):
        pts = andar(250)                                # 24,9 km
        with mock.patch.object(kr.requests, "get", side_effect=osrm_falso) as g:
            r = kr.calcular(pts)
        self.assertEqual(g.call_count, 3)               # 0-99, 99-198, 198-249
        self.assertAlmostEqual(r["km_total"], 24.9, delta=0.05)

    def test_pedacos_do_match_sao_emendados(self):
        # 2 km em pontos a cada 100 m; o /match corta no ponto 10 (parada de entrega):
        # devolve dois pedaços e o espaço entre eles (200 m) entra como medido
        pts = andar(21)
        with mock.patch.object(kr.requests, "get", side_effect=osrm_em_pedacos({10})):
            r = kr.calcular(pts)
        self.assertAlmostEqual(r["km_total"], 2.0, delta=0.05)
        self.assertEqual(r["km_estimado"], 0)
        self.assertTrue(r["casado"])

    def test_emenda_longa_vai_pelas_ruas_como_estimado(self):
        # o /match descarta 4 pontos seguidos (500 m sem casar): a emenda vai pelo /route
        pts = andar(21)
        with mock.patch.object(kr.requests, "get", side_effect=osrm_em_pedacos({8, 9, 10, 11})) as g:
            r = kr.calcular(pts)
        self.assertAlmostEqual(r["km_medido"], 1.5, delta=0.05)
        self.assertAlmostEqual(r["km_estimado"], 0.65, delta=0.05)    # 500 m × 1,3
        self.assertTrue(any("/route/" in c.args[0] for c in g.call_args_list))

    def test_volta_inventada_pelo_match_entra_como_estimado(self):
        # pedaço de 1 km que o /match diz ter 3 km (volta no quarteirão que não houve)
        pts = andar(11)
        with mock.patch.object(kr.requests, "get", side_effect=osrm_em_pedacos(set(), [3000])):
            r = kr.calcular(pts)
        self.assertAlmostEqual(r["km_total"], 1.0, delta=0.05)
        self.assertAlmostEqual(r["km_estimado"], 1.0, delta=0.05)
        self.assertEqual(r["km_medido"], 0)

    def test_sem_servidor_soma_em_linha_reta_e_avisa(self):
        pts = andar(11)
        with mock.patch.object(kr.requests, "get", side_effect=OSError("fora")):
            r = kr.calcular(pts)
        self.assertFalse(r["casado"])
        self.assertAlmostEqual(r["km_total"], 1.0, delta=0.05)

    def test_rastro_vazio_ou_grande_demais(self):
        self.assertEqual(kr.calcular([])["km_total"], 0)
        with self.assertRaises(ValueError):
            kr.calcular([{"lat": 0, "lng": 0, "t": i} for i in range(kr.MAX_PONTOS + 1)])


def _pt(x, y, t, acc=8):
    """Ponto a x metros a leste e y metros ao norte do CD, no segundo t."""
    return {"lat": LAT0 + y / M_POR_GRAU,
            "lng": LNG0 + x / (M_POR_GRAU * math.cos(math.radians(LAT0))),
            "t": t * 1000, "acc": acc}


def osrm_pelas_ruas(url, params=None, **kw):
    """/match devolve o caminho que passa por todos os pontos (as ruas são a grade deles),
    e não a reta entre as pontas: é o que o OSRM de verdade faz com um traço denso."""
    pares = url.rsplit("/", 1)[1].split(";")
    pts = [{"lng": float(c.split(",")[0]), "lat": float(c.split(",")[1])} for c in pares]
    if "/route/" in url:
        return resposta({"code": "Ok", "routes": [{"distance": vs._haversine_m(pts[0], pts[-1]) * 1.3}]})
    d = sum(vs._haversine_m(a, b) for a, b in zip(pts, pts[1:]))
    tps = [{"location": [p["lng"], p["lat"]], "matchings_index": 0, "waypoint_index": i} for i, p in enumerate(pts)]
    return resposta({"code": "Ok", "matchings": [{"distance": d, "confidence": 0.9}], "tracepoints": tps})


class TesteCaminhoImporta(unittest.TestCase):
    """O km tem de mudar quando o caminho muda. Sem o caminho gravado ele NÃO muda —
    e é por isso que o escritório não pode mostrar esse número como km rodado."""

    def reto(self, n=40, passo=75, dt=12):
        return [_pt(0, i * passo, i * dt) for i in range(n)]

    def com_voltas(self, voltas=3, lado=300, passo=75, dt=12):
        """Mesmas pontas do reto, mas dando voltas num quarteirão antes de seguir."""
        pts, t, x, y = [], 0, 0, 0
        passos = ([(passo, 0)] * (lado // passo) + [(0, passo)] * (lado // passo)
                  + [(-passo, 0)] * (lado // passo) + [(0, -passo)] * (lado // passo))
        for _ in range(voltas):
            for dx, dy in passos:
                x += dx; y += dy; t += dt
                pts.append(_pt(x, y, t))
        for _ in range(20):
            y += passo; t += dt
            pts.append(_pt(x, y, t))
        return pts

    def test_dar_voltas_aumenta_o_km(self):
        with mock.patch.object(kr.requests, "get", side_effect=osrm_pelas_ruas):
            reto = kr.calcular(self.reto())
            voltas = kr.calcular(self.com_voltas())
        self.assertGreater(voltas["km_total"], reto["km_total"] * 1.5,
                           f'dar voltas tem de pesar no km (reto {reto["km_total"]}, voltas {voltas["km_total"]})')
        self.assertEqual(reto["cobertura"], 1.0)
        self.assertEqual(voltas["cobertura"], 1.0)

    def test_so_as_baixas_da_sempre_o_mesmo_km(self):
        """Sem trilha, sobram as posições das baixas: pontos longe no tempo viram trechos
        de um ponto só, e o km é a ligação entre eles pelas ruas — o menor caminho.
        Qualquer trajeto entre as mesmas paradas dá esse mesmo número."""
        baixas = [_pt(0, 0, 0), _pt(0, 1500, 3600), _pt(0, 3000, 7200)]
        with mock.patch.object(kr.requests, "get", side_effect=osrm_pelas_ruas):
            r = kr.calcular(baixas)
        self.assertEqual(r["pontos_usados"], 0)
        self.assertEqual(r["km_medido"], 0)
        self.assertEqual(r["cobertura"], 0.0)
        self.assertGreater(r["km_total"], 0)


if __name__ == "__main__":
    unittest.main()
