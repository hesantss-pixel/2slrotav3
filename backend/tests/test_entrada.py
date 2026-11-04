"""Entrada automática de pedidos: leitura da NF-e, gravação, credenciais e e-mail
(python -m unittest discover -s tests)."""
import copy
import io
import os
import sys
import unittest
import zipfile
from email.message import EmailMessage

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import entrada  # noqa: E402
import entrada_email  # noqa: E402


class FakeBanco(entrada.Banco):
    """Realtime Database em memória, com a semântica de PATCH em vários caminhos."""

    def __init__(self, dados=None):
        super().__init__("https://banco.teste", "segredo")
        self.d = dados or {}
        self.falhar = False
        self.leituras = []

    @staticmethod
    def _partes(path):
        return [p for p in path.strip("/").split("/") if p]

    def _get(self, path):
        no = self.d
        for p in self._partes(path):
            if not isinstance(no, dict) or p not in no:
                return None
            no = no[p]
        return no

    def _set(self, path, valor):
        ps = self._partes(path)
        no = self.d
        for p in ps[:-1]:
            if not isinstance(no.get(p), dict):
                no[p] = {}
            no = no[p]
        if valor is None:
            no.pop(ps[-1], None)
        else:
            no[ps[-1]] = copy.deepcopy(valor)

    def ler(self, path, **params):
        if self.falhar:
            raise entrada.ErroBanco("fora do ar")
        self.leituras.append(path)
        v = copy.deepcopy(self._get(path))
        if params.get("shallow") and isinstance(v, dict):
            return {k: True for k in v}
        if "limitToLast" in params and isinstance(v, dict):
            ks = sorted(v)[-int(params["limitToLast"]):]
            return {k: v[k] for k in ks}
        return v

    def atualizar(self, path, dados):
        if self.falhar:
            raise entrada.ErroBanco("fora do ar")
        for k, v in dados.items():
            self._set(f"{path}/{k}" if path else k, v)


CH1 = "35261111222333000100550010009100011000000010"


def nfe(chave=CH1, nnf="910001", cidade="mogi das cruzes", cep="08700-000", com_entrega=True, enc="UTF-8",
        dest_nome="Cliente  X", vols='<vol><qVol>2</qVol><pesoL>10,5</pesoL></vol><vol><qVol>x</qVol><pesoB>0</pesoB><pesoL>1.255</pesoL></vol>'):
    entrega = ('<entrega><xNome>Loja Entrega</xNome><xLgr>Av. Entrega</xLgr><nro>77</nro><xBairro>Bairro E</xBairro>'
               '<xMun>vila nova de cachoeirinha da serra</xMun><UF>SP</UF><CEP>07010001</CEP></entrega>') if com_entrega else ""
    return (f'<?xml version="1.0" encoding="{enc}"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe{chave}" versao="4.00">'
            f'<ide><nNF>{nnf}</nNF><serie>1</serie></ide>'
            '<emit><CNPJ>11222333000100</CNPJ><xNome>FABRICA TESTE LTDA</xNome><xFant>Fábrica Teste</xFant><enderEmit><xLgr>Rua A</xLgr><nro>10</nro>'
            '<xBairro>Centro</xBairro><xMun>SAO PAULO - SP</xMun><UF>SP</UF><CEP>01001-000</CEP></enderEmit></emit>'
            f'<dest><CNPJ>99888777000101</CNPJ><xNome>{dest_nome}</xNome><enderDest><xLgr>Rua B</xLgr><nro>S/N</nro><xCpl>Fundos</xCpl>'
            f'<xBairro>Vila</xBairro><xMun>{cidade}</xMun><UF>SP</UF><CEP>{cep}</CEP></enderDest></dest>'
            '<retirada><xLgr>Av. Retirada</xLgr><nro>5</nro><xBairro>Ind</xBairro><xMun>ITAQUAQUECETUBA</xMun><UF>SP</UF><CEP>08570002</CEP></retirada>'
            f'{entrega}<det nItem="1"/><det nItem="2"/><det nItem="3"/><transp>{vols}</transp></infNFe></NFe></nfeProc>')


def evento(tp, ch=CH1):
    return (f'<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe"><evento><infEvento Id="ID{tp}{ch}01">'
            f'<chNFe>{ch}</chNFe><tpEvento>{tp}</tpEvento></infEvento></evento>'
            f'<retEvento><infEvento><chNFe>{ch}</chNFe><tpEvento>{tp}</tpEvento></infEvento></retEvento></procEventoNFe>')


class TesteLeituraNFe(unittest.TestCase):
    def test_entrega_usa_o_grupo_entrega(self):
        p = entrada.ler_xml_nfe(nfe())["pedidos"][0]
        self.assertEqual(p["id"], CH1)
        self.assertEqual((p["nf"], p["tipo"], p["chave"]), ("910001", "entrega", CH1))
        self.assertEqual(p["dest"], "Loja Entrega")
        self.assertEqual(p["endereco"], "Av. Entrega, 77")
        self.assertEqual(p["cidade"], "Vila Nova de Cachoeirinha da Serra")
        self.assertEqual((p["cep"], p["geoStatus"]), ("07010001", "pendente"))
        self.assertEqual(p["peso"], 11.76)        # 10,5 + 1,255 (pesoB zerado usa pesoL)
        self.assertEqual(p["itens"], 2)           # qVol "x" conta 0
        self.assertEqual(p["status"], "pendente")
        self.assertNotIn("lat", p)                # a tela preenche o ponto e localiza

    def test_entrega_sem_grupo_usa_destinatario(self):
        p = entrada.ler_xml_nfe(nfe(com_entrega=False))["pedidos"][0]
        self.assertEqual(p["dest"], "Cliente  X")
        self.assertEqual(p["endereco"], "Rua B, S/N - Fundos")
        self.assertEqual(p["cidade"], "Mogi das Cruzes")
        self.assertEqual(p["cep"], "08700000")

    def test_cep_incompleto_fica_sem_cep(self):
        p = entrada.ler_xml_nfe(nfe(com_entrega=False, cep="0870"))["pedidos"][0]
        self.assertEqual((p["cep"], p["geoStatus"]), ("", "sem_cep"))

    def test_coleta_usa_retirada_e_prefixo(self):
        p = entrada.ler_xml_nfe(nfe(), "coleta")["pedidos"][0]
        self.assertEqual(p["id"], "C_" + CH1)
        self.assertEqual(p["dest"], "Fábrica Teste")
        self.assertEqual(p["endereco"], "Av. Retirada, 5")
        self.assertEqual(p["cidade"], "Itaquaquecetuba")

    def test_sem_peso_entra_com_100_e_avisa(self):
        r = entrada.ler_xml_nfe(nfe(vols=""))
        self.assertEqual((r["pedidos"][0]["peso"], r["pedidos"][0]["itens"], r["sem_peso"]), (100, 3, 1))

    def test_sem_chave_usa_cnpj_serie_nf(self):
        p = entrada.ler_xml_nfe(nfe(chave="123"))["pedidos"][0]
        self.assertEqual((p["id"], p["chave"]), ("11222333000100-1-910001", ""))

    def test_iso_8859_1(self):
        xml = nfe(enc="ISO-8859-1", com_entrega=False, dest_nome="Clínica São José").encode("latin-1")
        self.assertEqual(entrada.ler_xml_nfe(xml)["pedidos"][0]["dest"], "Clínica São José")

    def test_cancelamento_e_erros(self):
        self.assertEqual(entrada.ler_xml_nfe(evento("110111"))["cancelamentos"], [CH1])
        for xml, msg in [(evento("110110"), "carta de correção"), ("<cteProc><CTe><infCte/></CTe></cteProc>", "CT-e"),
                         ("<nfe><quebrado>", "inválido"), ("<a><b/></a>", "não é o XML")]:
            with self.assertRaises(ValueError) as c:
                entrada.ler_xml_nfe(xml)
            self.assertIn(msg, str(c.exception))

    def test_cidade_norm(self):
        self.assertEqual(entrada.cidade_norm("SAO PAULO/SP"), "São Paulo")
        self.assertEqual(entrada.cidade_norm("  ferraz de  vasconcelos "), "Ferraz de Vasconcelos")
        self.assertEqual(entrada.cidade_norm(""), "Sem cidade")


class TesteJSON(unittest.TestCase):
    def test_pedido_completo(self):
        p = entrada.pedido_de_json({"nf": "77", "cliente": "Loja", "endereco": "Rua X", "numero": "12", "complemento": "sala 2",
                                    "cidade": "guarulhos", "uf": "sp", "cep": "07010-000", "peso": "1.250", "volumes": 3,
                                    "data_agendada": "2026-11-05", "hora_inicio": "08:00", "hora_fim": "12:00"}, "coleta")
        self.assertEqual(p["id"], "C_77")
        self.assertEqual(p["endereco"], "Rua X, 12 - sala 2")
        self.assertEqual((p["cidade"], p["uf"], p["cep"], p["peso"], p["itens"]), ("Guarulhos", "SP", "07010000", 1250, 3))
        self.assertEqual((p["agendado"], p["dataAgendada"], p["horaEntrega"], p["horaFim"]), (True, "2026-11-05", "08:00", "12:00"))

    def test_validacoes(self):
        base = {"nf": "1", "cidade": "Guarulhos", "peso": 10}
        for muda, msg in [({"nf": ""}, "nf"), ({"cidade": ""}, "cidade"), ({"peso": 0}, "peso"), ({"peso": "abc"}, "peso"),
                          ({"cep": "123"}, "cep"), ({"uf": "São"}, "uf"), ({"tipo": "x"}, "tipo"),
                          ({"data_agendada": "05/11/2026"}, "AAAA-MM-DD"), ({"hora_inicio": "8h"}, "HH:MM")]:
            with self.assertRaises(ValueError) as c:
                entrada.pedido_de_json({**base, **muda})
            self.assertIn(msg, str(c.exception))
        self.assertEqual(entrada.pedido_de_json({**base, "peso": "12,5"})["peso"], 12.5)


class TesteReceber(unittest.TestCase):
    def setUp(self):
        self.b = FakeBanco({"empresas": {"e1": {"pedidos_rota": {
            "500": {"nf": "500", "status": "pendente", "peso": 9, "lat": -23.1},          # já existia e foi editado
            CH1: {"nf": "910001", "status": "despachado", "chave": CH1},                  # em rota
            "C_" + "3" * 44: {"nf": "333", "status": "pendente", "tipo": "coleta"},       # pendente cancelável
        }}}})

    def test_grava_novos_e_nao_mexe_nos_que_existem(self):
        peds = [entrada.pedido_de_json({"nf": "500", "cidade": "Guarulhos", "peso": 50}),
                entrada.pedido_de_json({"nf": "501", "cidade": "Guarulhos", "peso": 50}),
                entrada.pedido_de_json({"nf": "501", "cidade": "Guarulhos", "peso": 60})]
        r = entrada.receber(self.b, "e1", peds, [], "api", agora_ms=1_700_000_000_000)
        pr = self.b.d["empresas"]["e1"]["pedidos_rota"]
        self.assertEqual((r["novos"], r["ja_existiam"]), (1, 2))
        self.assertEqual(pr["500"]["peso"], 9)                 # a edição continua
        self.assertEqual((pr["501"]["peso"], pr["501"]["origem"], pr["501"]["criadoEm"]), (50, "api", 1_700_000_000_000))
        self.assertNotIn("id", pr["501"])

    def test_cancelamento(self):
        r = entrada.receber(self.b, "e1", [], ["3" * 44, CH1, "9" * 44], "email")
        pr = self.b.d["empresas"]["e1"]["pedidos_rota"]
        self.assertNotIn("C_" + "3" * 44, pr)
        self.assertIn(CH1, pr)
        self.assertEqual((r["cancelados"], r["cancelados_em_rota"], r["cancelamentos_fora"]), (["333"], ["910001"], 1))

    def test_registro_de_recebimentos_guarda_os_ultimos_100(self):
        for i in range(105):
            entrada.receber(self.b, "e1", [], [], "api", agora_ms=1_700_000_000_000 + i)
        log = self.b.d["empresas"]["e1"]["entrada_log"]
        self.assertEqual(len(log), 100)
        rec = entrada.ultimos_recebimentos(self.b, "e1", 3)
        self.assertEqual([x["em"] for x in rec], [1_700_000_000_104, 1_700_000_000_103, 1_700_000_000_102])

    def test_banco_fora_levanta_erro(self):
        self.b.falhar = True
        with self.assertRaises(entrada.ErroBanco):
            entrada.receber(self.b, "e1", [], [], "api")


class TesteCredenciais(unittest.TestCase):
    def test_chave(self):
        b = FakeBanco({"membros": {"u1": "e1"}})
        c1 = entrada.gerar_chave(b, "e1")
        self.assertTrue(c1.startswith("rv3_") and len(c1) > 30)
        self.assertEqual(entrada.eid_da_chave(b, c1), "e1")
        cfg = b.d["empresas"]["e1"]["config"]["integracao"]
        self.assertEqual(cfg["chave_inicio"], c1[:10])
        self.assertNotIn(c1, str(b.d))                          # só o hash fica guardado
        c2 = entrada.gerar_chave(b, "e1")
        self.assertIsNone(entrada.eid_da_chave(b, c1))          # a chave antiga deixa de valer
        self.assertEqual(entrada.eid_da_chave(b, c2), "e1")
        self.assertEqual(len(b.d["integracao_chaves"]), 1)
        for ruim in ["", "rv3_", "abc", "rv3_" + "x" * 10, "rv3_../../acesso"]:
            self.assertIsNone(entrada.eid_da_chave(b, ruim))

    def test_codigo_email(self):
        b = FakeBanco()
        k1 = entrada.gerar_codigo_email(b, "e1")
        self.assertRegex(k1, r"^[a-z0-9]{10}$")
        self.assertEqual(entrada.eid_do_codigo(b, k1), "e1")
        k2 = entrada.gerar_codigo_email(b, "e1")
        self.assertIsNone(entrada.eid_do_codigo(b, k1))
        self.assertEqual(entrada.eid_do_codigo(b, k2), "e1")
        self.assertEqual(entrada.enderecos_email("pedidos.rotav3@gmail.com", k2),
                         {"entregas": f"pedidos.rotav3+{k2}@gmail.com", "coletas": f"pedidos.rotav3+{k2}-coleta@gmail.com"})

    def test_empresa_do_usuario(self):
        b = FakeBanco({"membros": {"u1": "e1"}})
        self.assertEqual(entrada.eid_do_usuario(b, "u1", "ADM", "principal"), "e1")
        self.assertEqual(entrada.eid_do_usuario(b, "ADM", "ADM", "principal"), "principal")
        self.assertIsNone(entrada.eid_do_usuario(b, "u2", "ADM", "principal"))

    def test_limite(self):
        entrada._uso.clear()
        self.assertTrue(all(entrada.limitar("eX", 3) for _ in range(3)))
        self.assertFalse(entrada.limitar("eX", 3))
        self.assertTrue(entrada.limitar("eY", 3))


def email_com(para, anexos, entregue_para=None):
    m = EmailMessage()
    m["From"] = "fornecedor@exemplo.com"
    m["To"] = para
    if entregue_para:
        m["Delivered-To"] = entregue_para
    m["Subject"] = "NF-e"
    m.set_content("segue a nota")
    for nome, dados, tipo in anexos:
        mt, st = tipo.split("/")
        m.add_attachment(dados, maintype=mt, subtype=st, filename=nome)
    return m.as_bytes()


def zip_com(arquivos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for nome, dados in arquivos:
            z.writestr(nome, dados)
    return buf.getvalue()


class TesteEmail(unittest.TestCase):
    CAIXA = "pedidos.rotav3@gmail.com"

    def setUp(self):
        self.b = FakeBanco({"integracao_email": {"abcde23456": {"eid": "e1"}}, "empresas": {"e1": {"pedidos_rota": {}}}})

    def test_codigo_do_destino(self):
        msg = lambda **h: __import__("email").message_from_bytes(email_com(**h))
        self.assertEqual(entrada_email.codigo_do_destino(msg(para="Pedidos <pedidos.rotav3+abcde23456@gmail.com>", anexos=[]), self.CAIXA), "abcde23456")
        # encaminhado pelo e-mail da empresa: vale o Delivered-To; Gmail ignora pontos
        self.assertEqual(entrada_email.codigo_do_destino(
            msg(para="logistica@transportadora.com.br", anexos=[], entregue_para="pedidosrotav3+abcde23456-coleta@gmail.com"), self.CAIXA),
            "abcde23456-coleta")
        self.assertIsNone(entrada_email.codigo_do_destino(msg(para="outra+abcde23456@gmail.com", anexos=[]), self.CAIXA))
        self.assertIsNone(entrada_email.codigo_do_destino(msg(para="pedidos.rotav3@gmail.com", anexos=[]), self.CAIXA))

    def test_importa_xml_e_zip(self):
        x2 = nfe(chave="3" * 44, nnf="2")
        bruto = email_com("pedidos.rotav3+abcde23456@gmail.com",
                          [("NF1.xml", nfe().encode(), "application/xml"),
                           ("lote.zip", zip_com([("pasta/NF2.xml", x2), ("leia.txt", "x")]), "application/zip"),
                           ("danfe.pdf", b"%PDF", "application/pdf")])
        r = entrada_email.processar_mensagem(bruto, self.CAIXA, self.b)
        pr = self.b.d["empresas"]["e1"]["pedidos_rota"]
        self.assertEqual((r["novos"], r["arquivos"], r["origem"]), (2, 2, "email"))
        self.assertEqual(set(pr), {CH1, "3" * 44})
        self.assertEqual(pr[CH1]["origem"], "email")

    def test_endereco_de_coleta(self):
        bruto = email_com("x@y.com", [("NF1.xml", nfe().encode(), "text/xml")], entregue_para="pedidos.rotav3+abcde23456-coleta@gmail.com")
        entrada_email.processar_mensagem(bruto, self.CAIXA, self.b)
        self.assertIn("C_" + CH1, self.b.d["empresas"]["e1"]["pedidos_rota"])

    def test_xml_ruim_e_email_sem_anexo_ficam_no_registro(self):
        r = entrada_email.processar_mensagem(email_com("pedidos.rotav3+abcde23456@gmail.com", [("ruim.xml", b"<a>", "application/xml")]), self.CAIXA, self.b)
        self.assertEqual(r["novos"], 0)
        self.assertIn("ruim.xml: XML inválido ou corrompido", r["erros"])
        r = entrada_email.processar_mensagem(email_com("pedidos.rotav3+abcde23456@gmail.com", []), self.CAIXA, self.b)
        self.assertIn("e-mail sem anexo XML", r["erros"])
        self.assertEqual(len(self.b.d["empresas"]["e1"]["entrada_log"]), 2)

    def test_codigo_desconhecido_nao_grava(self):
        r = entrada_email.processar_mensagem(email_com("pedidos.rotav3+zzzzzzzzzz@gmail.com", [("a.xml", nfe().encode(), "text/xml")]), self.CAIXA, self.b)
        self.assertIsNone(r)
        self.assertEqual(self.b.d["empresas"]["e1"]["pedidos_rota"], {})

    def test_caixa_so_marca_lido_o_que_processou(self):
        msgs = {b"1": email_com("pedidos.rotav3+abcde23456@gmail.com", [("NF1.xml", nfe().encode(), "text/xml")]),
                b"2": email_com("pedidos.rotav3+abcde23456@gmail.com", [("NF2.xml", nfe(chave="4" * 44, nnf="4").encode(), "text/xml")])}
        banco = self.b

        class FakeIMAP:
            def __init__(s):
                s.lidos, s.saiu, s.falhou = [], False, False

            def search(s, _c, crit):
                return "OK", [b" ".join(k for k in msgs if k not in s.lidos)]

            def fetch(s, num, _q):
                if num == b"2" and not s.falhou:
                    banco.falhar = s.falhou = True   # o banco cai no meio da primeira leitura
                return "OK", [(b"%s (BODY[] {1}" % num, msgs[num]), b")"]

            def store(s, num, _f, flag):
                s.lidos.append(num)

            def logout(s):
                s.saiu = True

        im = FakeIMAP()
        feitos = entrada_email.processar_caixa(lambda: im, self.CAIXA, self.b)
        self.assertEqual((feitos, im.lidos, im.saiu), (1, [b"1"], True))   # o 2 fica para a próxima
        self.b.falhar = False
        self.assertEqual(entrada_email.processar_caixa(lambda: im, self.CAIXA, self.b), 1)
        self.assertEqual(set(self.b.d["empresas"]["e1"]["pedidos_rota"]), {CH1, "4" * 44})

    def test_nao_liga_sem_configuracao(self):
        self.assertFalse(entrada_email.iniciar("", "", "imap.gmail.com", self.b))
        self.assertFalse(entrada_email.iniciar("a@gmail.com", "x", "imap.gmail.com", entrada.Banco("https://x", "")))


if __name__ == "__main__":
    unittest.main()
