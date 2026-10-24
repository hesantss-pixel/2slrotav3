"""Testes da conferência de login (rode com: python -m unittest discover -s tests)."""
import ast
import base64
import json
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import auth_firebase as af  # noqa: E402


def token(uid="u1", aud="slog-pedidos", exp=None, iss=None):
    def b64(d):
        return base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    claims = {"user_id": uid, "sub": uid, "aud": aud,
              "iss": iss or f"https://securetoken.google.com/{aud}",
              "exp": exp if exp is not None else time.time() + 3600}
    return f"{b64({'alg': 'RS256'})}.{b64(claims)}.assinatura"


def resposta(status, corpo):
    r = mock.Mock()
    r.status_code = status
    r.ok = 200 <= status < 300
    r.json.return_value = corpo
    return r


class TesteLogin(unittest.TestCase):
    def setUp(self):
        af._cache.clear()
        af.AUTH_REQUIRED = True

    def test_sem_cabecalho(self):
        with self.assertRaises(af.AuthError) as c:
            af.verificar(None)
        self.assertEqual(c.exception.status, 401)

    def test_token_malformado(self):
        with self.assertRaises(af.AuthError):
            af.verificar("Bearer abc")

    def test_token_de_outro_projeto(self):
        with mock.patch.object(af.requests, "get") as g:
            with self.assertRaises(af.AuthError):
                af.verificar("Bearer " + token(aud="outro-projeto"))
            g.assert_not_called()

    def test_token_vencido(self):
        with mock.patch.object(af.requests, "get") as g:
            with self.assertRaises(af.AuthError) as c:
                af.verificar("Bearer " + token(exp=time.time() - 10))
            self.assertIn("expirou", c.exception.mensagem)
            g.assert_not_called()

    def test_firebase_recusa_assinatura(self):
        with mock.patch.object(af.requests, "get", return_value=resposta(401, {"error": "Auth token is invalid"})):
            with self.assertRaises(af.AuthError) as c:
                af.verificar("Bearer " + token())
            self.assertEqual(c.exception.status, 401)

    def test_usuario_sem_liberacao(self):
        for st, corpo in [(200, None), (200, False), (403, {"error": "Permission denied"})]:
            af._cache.clear()
            with mock.patch.object(af.requests, "get", return_value=resposta(st, corpo)):
                with self.assertRaises(af.AuthError) as c:
                    af.verificar("Bearer " + token())
                self.assertEqual(c.exception.status, 403)

    def test_usuario_liberado_e_cache(self):
        t = token(uid="ana")
        with mock.patch.object(af.requests, "get", return_value=resposta(200, True)) as g:
            self.assertEqual(af.verificar("Bearer " + t), "ana")
            self.assertEqual(af.verificar("Bearer " + t), "ana")
            self.assertEqual(g.call_count, 1)  # segunda vez vem do cache
            url, kw = g.call_args[0][0], g.call_args[1]
            self.assertTrue(url.endswith("/acesso/ana.json"))
            self.assertEqual(kw["params"]["auth"], t)

    def test_firebase_fora_do_ar(self):
        with mock.patch.object(af.requests, "get", side_effect=af.requests.ConnectionError("x")):
            with self.assertRaises(af.AuthError) as c:
                af.verificar("Bearer " + token())
            self.assertEqual(c.exception.status, 503)

    def test_desligado_para_teste_local(self):
        af.AUTH_REQUIRED = False
        self.assertEqual(af.verificar(None), "teste-local")


class TesteRotasProtegidas(unittest.TestCase):
    def test_todas_menos_status_exigem_login(self):
        src = open(os.path.join(os.path.dirname(af.__file__), "main.py"), encoding="utf-8").read()
        arvore = ast.parse(src)
        protegidas, abertas = [], []
        for no in arvore.body:
            if isinstance(no, (ast.FunctionDef, ast.AsyncFunctionDef)) and any(
                isinstance(d, ast.Call) and getattr(d.func, "attr", "") in ("get", "post") for d in no.decorator_list
            ):
                usa = any(
                    isinstance(dflt, ast.Call) and getattr(dflt.func, "id", "") == "Depends"
                    and dflt.args and getattr(dflt.args[0], "id", "") == "exigir_login"
                    for dflt in no.args.defaults + no.args.kw_defaults if dflt is not None
                )
                (protegidas if usa else abertas).append(no.name)
        self.assertEqual(abertas, ["status"], f"rotas sem login: {abertas}")
        self.assertEqual(sorted(protegidas), sorted(["listar_pedidos", "solve", "chat", "upload_nf", "sync_totvs"]))


if __name__ == "__main__":
    unittest.main()
