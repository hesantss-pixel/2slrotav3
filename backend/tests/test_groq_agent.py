"""Assistente (Groq): histórico curto e mensagens de erro que dizem o que fazer.

Não chama a Groq: um cliente falso registra o que seria enviado."""
import importlib.util
import os
import unittest
from types import SimpleNamespace

# Carrega o arquivo de verdade pelo caminho: outro teste troca "groq_agent" em
# sys.modules por um substituto, e a ordem dos testes não pode mudar o resultado.
_ARQ = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "groq_agent.py")
_spec = importlib.util.spec_from_file_location("groq_agent_em_teste", _ARQ)
ga = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ga)


class ErroApi(Exception):
    def __init__(self, status):
        super().__init__(f"Error code: {status} - {{'error': {{'message': 'detalhe interno sk-xyz'}}}}")
        self.status_code = status


class ClienteFalso:
    def __init__(self, respostas):
        self.respostas = list(respostas)
        self.enviados = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.enviados.append(kw)
        r = self.respostas.pop(0)
        if isinstance(r, Exception):
            raise r
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=r))])


PEDIDOS = [{"cliente": f"Cliente {i}", "cidade": "Guarulhos", "peso": 100, "lat": -23.4, "lng": -46.5}
           for i in range(40)]


class TesteAssistente(unittest.TestCase):
    def setUp(self):
        self._antes = ga._client

    def tearDown(self):
        ga._client = self._antes

    def _chat(self, respostas):
        ga._client = ClienteFalso(respostas)
        c = ga.GroqChat()
        c.atualizar_contexto(PEDIDOS)
        return c, ga._client

    def test_dados_do_dia_vao_so_na_pergunta_atual(self):
        c, cli = self._chat([f"resposta {i}" for i in range(10)])
        for i in range(10):
            self.assertEqual(c.enviar(f"pergunta {i}"), f"resposta {i}")
        ultimo = cli.enviados[-1]["messages"]
        ctx_vezes = sum("Dados operacionais atuais" in m["content"] for m in ultimo)
        self.assertEqual(ctx_vezes, 1, "o contexto do dia foi repetido no histórico")
        # instruções + no máximo HISTORICO_MAX anteriores + a pergunta
        self.assertLessEqual(len(ultimo), 1 + ga.HISTORICO_MAX + 1)
        self.assertEqual(ultimo[0]["role"], "system")
        self.assertTrue(ultimo[-1]["content"].endswith("pergunta 9"))
        # o tamanho do envio não cresce com o número de perguntas
        tam = [sum(len(m["content"]) for m in e["messages"]) for e in cli.enviados]
        self.assertLess(max(tam[4:]) - min(tam[4:]), 200)

    def test_historico_comeca_sempre_por_pergunta(self):
        c, cli = self._chat(["r"] * 8)
        for i in range(8):
            c.enviar(f"p{i}")
        msgs = cli.enviados[-1]["messages"]
        self.assertEqual(msgs[1]["role"], "user")
        self.assertEqual([m["role"] for m in msgs[1:-1]], ["user", "assistant"] * (ga.HISTORICO_MAX // 2))

    def test_limite_por_minuto_vira_frase_util_e_nao_suja_o_historico(self):
        c, cli = self._chat(["ok 1", ErroApi(429), "ok 2"])
        c.enviar("primeira")
        r = c.enviar("segunda")
        self.assertIn("limite de uso", r)
        self.assertNotIn("sk-xyz", r)
        self.assertNotIn("Error code", r)
        c.enviar("terceira")
        enviados = [m["content"] for m in cli.enviados[-1]["messages"][1:-1]]
        self.assertEqual(enviados, ["primeira", "ok 1"], "a pergunta que falhou entrou no histórico")

    def test_cada_erro_tem_sua_frase(self):
        casos = {413: "grandes demais", 401: "administrador", 403: "administrador",
                 500: "fora do ar", 503: "fora do ar"}
        for st, trecho in casos.items():
            c, _ = self._chat([ErroApi(st)])
            self.assertIn(trecho, c.enviar("x"), st)
        c, _ = self._chat([ConnectionError("dns falhou em api.groq.com")])
        r = c.enviar("x")
        self.assertIn("Tente de novo", r)
        self.assertNotIn("dns", r)

    def test_status_dentro_de_response(self):
        e = Exception("x")
        e.response = SimpleNamespace(status_code=429)
        self.assertIn("limite de uso", ga._mensagem_de_erro(e))

    def test_resposta_vazia(self):
        c, cli = self._chat([None, "agora sim"])
        self.assertIn("outro jeito", c.enviar("x"))
        c.enviar("y")
        self.assertEqual(len(cli.enviados[-1]["messages"]), 2, "resposta vazia entrou no histórico")

    def test_consulta_unica_sem_erro_cru(self):
        ga._client = ClienteFalso([ErroApi(429)])
        r = ga.consulta_unica("resumo", PEDIDOS)
        self.assertIn("limite de uso", r)
        self.assertNotIn("Error code", r)


if __name__ == "__main__":
    unittest.main()
