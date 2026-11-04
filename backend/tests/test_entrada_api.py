"""Rotas da entrada automática (main.py), chamadas direto, sem servidor.
O FastAPI não instala no ambiente de testes: um substituto mínimo faz o papel dele
(decoradores, Depends, HTTPException). A lógica das rotas é a de verdade."""
import asyncio
import os
import sys
import types
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
sys.path.insert(0, AQUI)


def _instalar_substitutos():
    if "fastapi" in sys.modules and getattr(sys.modules["fastapi"], "_substituto", False):
        return
    fa = types.ModuleType("fastapi")
    fa._substituto = True

    class HTTPException(Exception):
        def __init__(self, status_code, detail=None):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    class FastAPI:
        def __init__(self, *a, **k):
            self.rotas = {}

        def add_middleware(self, *a, **k):
            pass

        def on_event(self, _ev):
            return lambda f: f

        def _reg(self, metodo, caminho):
            def deco(f):
                self.rotas[(metodo, caminho)] = f
                return f
            return deco

        def get(self, caminho, **k):
            return self._reg("GET", caminho)

        def post(self, caminho, **k):
            return self._reg("POST", caminho)

    fa.FastAPI, fa.HTTPException = FastAPI, HTTPException
    fa.Depends = lambda f=None: ("Depends", f)
    fa.Header = lambda *a, **k: None
    fa.File = fa.Form = lambda *a, **k: None
    fa.Request = object
    fa.UploadFile = object
    cors = types.ModuleType("fastapi.middleware.cors")
    cors.CORSMiddleware = object
    sys.modules.update({"fastapi": fa, "fastapi.middleware": types.ModuleType("fastapi.middleware"),
                        "fastapi.middleware.cors": cors})
    ga = types.ModuleType("groq_agent")
    ga.GroqChat = object
    ga.consulta_unica = ga.analisar_rotas_geradas = lambda *a, **k: ""
    sys.modules["groq_agent"] = ga
    import fake_ortools
    fake_ortools.instalar()


_instalar_substitutos()
import main  # noqa: E402
import entrada  # noqa: E402
from test_entrada import FakeBanco, nfe, CH1  # noqa: E402

HTTPException = sys.modules["fastapi"].HTTPException


class FakeRequest:
    def __init__(self, corpo=b"", tipo="application/xml"):
        self.corpo = corpo
        self.headers = {"content-type": tipo, "content-length": str(len(corpo))}

    async def body(self):
        return self.corpo


class TesteRotasEntrada(unittest.TestCase):
    def setUp(self):
        self.b = FakeBanco({"membros": {"u1": "e1"}, "empresas": {"e1": {"pedidos_rota": {}}}})
        main.BANCO = self.b
        main.auth_firebase.AUTH_REQUIRED = False      # exigir_login devolve "teste-local"
        main.entrada_email.estado["ligado"] = True
        main.EMAIL_USUARIO = "pedidos.rotav3@gmail.com"
        entrada._uso.clear()
        self.chave = entrada.gerar_chave(self.b, "e1")

    def tearDown(self):
        main.auth_firebase.AUTH_REQUIRED = True
        main.entrada_email.estado["ligado"] = False

    def test_chave_api(self):
        self.assertEqual(main.exigir_chave_api("Bearer " + self.chave), "e1")
        for ruim in [None, "", "Bearer ", "Bearer rv3_errada_" + "x" * 30, self.chave]:
            with self.assertRaises(HTTPException) as c:
                main.exigir_chave_api(ruim)
            self.assertEqual(c.exception.status_code, 401)
        main.BANCO = FakeBanco()
        main.BANCO.segredo = ""
        with self.assertRaises(HTTPException) as c:
            main.exigir_chave_api("Bearer " + self.chave)
        self.assertEqual(c.exception.status_code, 503)

    def test_limite_por_hora(self):
        entrada._uso["e1"] = [__import__("time").time()] * 600
        with self.assertRaises(HTTPException) as c:
            main.exigir_chave_api("Bearer " + self.chave)
        self.assertEqual(c.exception.status_code, 429)

    def test_xml_no_corpo(self):
        r = asyncio.run(main.entrada_xml(FakeRequest(nfe().encode()), "entrega", "e1"))
        self.assertEqual((r["novos"], r["origem"]), (1, "api"))
        self.assertIn(CH1, self.b.d["empresas"]["e1"]["pedidos_rota"])
        r = asyncio.run(main.entrada_xml(FakeRequest(nfe().encode()), "coleta", "e1"))
        self.assertIn("C_" + CH1, self.b.d["empresas"]["e1"]["pedidos_rota"])
        with self.assertRaises(HTTPException) as c:
            asyncio.run(main.entrada_xml(FakeRequest(b"<a/>"), "entrega", "e1"))
        self.assertEqual(c.exception.status_code, 422)
        self.assertIn("não é o XML", c.exception.detail)
        with self.assertRaises(HTTPException) as c:
            asyncio.run(main.entrada_xml(FakeRequest(b""), "entrega", "e1"))
        self.assertEqual(c.exception.status_code, 400)
        with self.assertRaises(HTTPException) as c:
            asyncio.run(main.entrada_xml(FakeRequest(nfe().encode()), "outro", "e1"))
        self.assertEqual(c.exception.status_code, 422)

    def test_json(self):
        body = main.EntradaPedidos(pedidos=[{"nf": "10", "cidade": "Guarulhos", "peso": 5},
                                            {"nf": "", "cidade": "x", "peso": 1}])
        r = main.entrada_pedidos(body, "e1")
        self.assertEqual(r["novos"], 1)
        self.assertTrue(r["erros"][0].startswith("pedido 2:"))
        with self.assertRaises(HTTPException) as c:
            main.entrada_pedidos(main.EntradaPedidos(pedidos=[{"nf": ""}]), "e1")
        self.assertEqual(c.exception.status_code, 422)

    def test_tela_gera_e_consulta(self):
        self.b.d["membros"]["teste-local"] = "e1"            # login desligado no teste: uid "teste-local"
        eid = main.exigir_empresa("Bearer qualquer")
        self.assertEqual(eid, "e1")
        nova = main.integracao_gerar(main.GerarRequest(qual="chave"), eid)["chave"]
        self.assertIsNone(entrada.eid_da_chave(self.b, self.chave))   # a antiga parou de valer
        end = main.integracao_gerar(main.GerarRequest(qual="email"), eid)["enderecos"]
        self.assertTrue(end["entregas"].startswith("pedidos.rotav3+") and end["coletas"].endswith("-coleta@gmail.com"))
        main.entrada_pedidos(main.EntradaPedidos(pedidos=[{"nf": "11", "cidade": "Guarulhos", "peso": 5}]), "e1")
        info = main.integracao(eid)
        self.assertEqual(info["chave"]["inicio"], nova[:10])
        self.assertNotIn(nova, str(info))
        self.assertEqual(info["email"]["enderecos"], end)
        self.assertEqual(info["recebimentos"][0]["nfs_novas"], ["11"])
        with self.assertRaises(HTTPException) as c:
            main.integracao_gerar(main.GerarRequest(qual="outra"), eid)
        self.assertEqual(c.exception.status_code, 422)

    def test_usuario_sem_empresa(self):
        with self.assertRaises(HTTPException) as c:
            main.exigir_empresa("Bearer qualquer")
        self.assertEqual(c.exception.status_code, 403)

    def test_email_desligado_no_servidor(self):
        self.b.d["membros"]["teste-local"] = "e1"
        main.entrada_email.estado["ligado"] = False
        with self.assertRaises(HTTPException) as c:
            main.integracao_gerar(main.GerarRequest(qual="email"), "e1")
        self.assertEqual(c.exception.status_code, 503)
        self.assertEqual(main.integracao("e1")["email"]["enderecos"], {})

    def test_status_mostra_o_que_esta_ligado(self):
        st = main.status()
        self.assertEqual(st["versao"], "3.7.0")
        self.assertEqual(st["entrada_automatica"], {"api": True, "email": True})


if __name__ == "__main__":
    unittest.main()
