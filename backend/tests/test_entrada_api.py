"""Rotas da entrada automática (main.py), chamadas direto, sem servidor.
O FastAPI não instala no ambiente de testes: um substituto mínimo faz o papel dele
(decoradores, Depends, HTTPException). A lógica das rotas é a de verdade."""
import asyncio
import io
import os
import sys
import types
import unittest
from unittest import mock

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
    ga.conferir_assistente = lambda: "ok"
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
        # a versão vem de um lugar só (main.VERSAO) e o /status diz qual código está no ar
        self.assertEqual(st["versao"], main.VERSAO)
        self.assertRegex(st["versao"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(st["codigo"], "local")   # fora do Railway não existe commit publicado
        self.assertEqual(st["entrada_automatica"], {"api": True, "email": True})
        self.assertRegex(st["python"], r"^3\.\d+$")   # só major.minor
        self.assertEqual(st["componentes"], {"motor_de_rotas": "ok", "assistente": "ok", "leitura_de_nf": "ok"})

    def test_health_responde_sem_tocar_em_nada(self):
        # o Railway chama /health antes de trocar de deploy: não pode depender de banco
        # nem de serviço externo, e não devolve nada da operação
        main._componentes = None
        with mock.patch.object(main.req_lib, "get") as g, mock.patch.object(main.req_lib, "post") as p:
            self.assertEqual(main.health(), {"ok": True})
        g.assert_not_called()
        p.assert_not_called()

    def test_segredo_do_banco_nao_vaza_em_erro_nem_em_log(self):
        segredo = "SEGREDOdoBANCO123456"
        url = f"https://x.firebaseio.com/empresas/e/pedidos.json?auth={segredo}"
        erro = main.req_lib.ConnectionError(f"Max retries exceeded with url: {url}")
        with mock.patch.dict(os.environ, {"FIREBASE_SECRET": segredo}):
            self.assertNotIn(segredo, main.sem_segredo(f"falhou: {erro}"))
            # resposta da API
            with mock.patch.object(main, "_carregar_pedidos_firebase", side_effect=erro):
                with self.assertRaises(HTTPException) as c:
                    main.listar_pedidos(uid="admin")
            self.assertNotIn(segredo, str(c.exception.detail))
            # log, inclusive o traceback
            import logging
            saida = io.StringIO()
            h = logging.StreamHandler(saida)
            h.addFilter(main._FiltroSegredo())
            lg = logging.getLogger("teste_segredo")
            lg.addHandler(h)
            try:
                try:
                    raise erro
                except Exception as e:
                    lg.exception("Erro no /pedidos: %s", e)
            finally:
                lg.removeHandler(h)
            texto = saida.getvalue()
            self.assertIn("Max retries", texto)
            self.assertIn("Traceback", texto)
            self.assertNotIn(segredo, texto)

    def test_health_recusa_deploy_com_motor_quebrado(self):
        # biblioteca atualizada que quebra o OR-Tools: o Railway precisa ver 503 e manter o
        # deploy anterior, em vez de o erro aparecer só quando alguém pedir uma rota
        main._componentes = None
        try:
            with mock.patch.object(main, "conferir_motor", return_value=False):
                with self.assertRaises(main.HTTPException) as c:
                    main.health()
            self.assertEqual(c.exception.status_code, 503)
            self.assertEqual(c.exception.detail, {"falhou": ["motor_de_rotas"]})
        finally:
            main._componentes = None

    def test_assistente_sem_chave_nao_bloqueia_deploy(self):
        main._componentes = None
        try:
            with mock.patch.object(main, "conferir_assistente", return_value="sem chave"):
                self.assertEqual(main.health(), {"ok": True})
        finally:
            main._componentes = None


if __name__ == "__main__":
    unittest.main()
