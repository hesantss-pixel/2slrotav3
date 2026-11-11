"""Leitura de NF por planilha e por PDF, com as bibliotecas de verdade (openpyxl, pdfplumber).

O PDF de teste é gerado na hora com o reportlab, quando ele está instalado (não vai para o
servidor: só serve para montar o arquivo do teste)."""
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import nf_parser  # noqa: E402

try:
    from reportlab.pdfgen import canvas  # noqa: F401
    TEM_REPORTLAB = True
except ImportError:
    TEM_REPORTLAB = False


def planilha(linhas):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    for ln in linhas:
        ws.append(ln)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def pdf_de_texto(linhas):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 800
    for ln in linhas:
        c.drawString(40, y, ln)
        y -= 18
    c.save()
    return buf.getvalue()


class TesteLeituraDeNF(unittest.TestCase):
    def test_planilha(self):
        conteudo = planilha([
            ["NF", "Cidade", "Peso", "Volumes", "Destinatário"],
            [123456, "Guarulhos", 350.5, 4, "Mercado Exemplo"],
            [None, None, None, None, None],
            ["123457", "Arujá", "1.200", 10, "Loja Exemplo"],
        ])
        r = nf_parser.parse_many([("pedidos.xlsx", conteudo)])
        nfs = sorted(p["nf"] for p in r["pedidos"])
        self.assertEqual(nfs, ["123456", "123457"], r)

    def test_planilha_sem_coluna_nf_explica_o_que_falta(self):
        conteudo = planilha([["Cidade", "Peso"], ["Guarulhos", 10]])
        with self.assertRaises(ValueError) as c:
            nf_parser.parse_xlsx(conteudo, "x.xlsx")
        self.assertIn("coluna 'nf'", str(c.exception))

    @unittest.skipUnless(TEM_REPORTLAB, "reportlab não instalado para gerar o PDF de teste")
    def test_pdf_de_danfe_em_texto(self):
        conteudo = pdf_de_texto([
            "DANFE - Documento Auxiliar da Nota Fiscal Eletronica",
            "N\u00ba. 000.004.521",
            "MUNICIPIO: GUARULHOS",
            "PESO BRUTO 412,30",
            "QUANTIDADE VOLUMES 7",
        ])
        (p,) = nf_parser.parse_pdf(conteudo, "nota.pdf")
        self.assertEqual(p["nf"], "4521")   # igual ao nNF do XML
        self.assertEqual(p["cidade"], "Guarulhos")
        self.assertAlmostEqual(float(p["peso"]), 412.3, places=1)

    def test_numero_da_nota_como_o_danfe_imprime(self):
        # chave: SP(35) 2409 CNPJ(14) mod 55 série 001 nNF 000004521 ...
        chave = "35240912345678000190" + "55" + "001" + "000004521" + "1" + "00000001" + "2"
        self.assertEqual(len(chave), 44)
        em_blocos = " ".join(chave[i:i + 4] for i in range(0, 44, 4))
        casos = {
            # endereço com "Nº 1500" antes do número da nota: vale a chave de acesso
            f"RUA DAS FLORES, Nº 1500\nCHAVE DE ACESSO\n{em_blocos}\nNº. 000.004.521": "4521",
            f"CHAVE DE ACESSO {chave}": "4521",
            "NF-e\nNº. 000.004.521\nSÉRIE 001": "4521",
            "AV. BRASIL Nº 1500\nNF-e Nº 000.004.521": "4521",
            "Nota No 004521": "004521",          # padrão antigo continua aceito
        }
        for texto, esperado in casos.items():
            self.assertEqual(nf_parser._numero_nf(texto), esperado, texto)
        # 44 dígitos que não são chave de NF (modelo diferente de 55/65) não contam
        outra = chave[:20] + "99" + chave[22:]
        self.assertIsNone(nf_parser._numero_nf(f"CODIGO {outra}"))

    @unittest.skipUnless(TEM_REPORTLAB, "reportlab não instalado para gerar o PDF de teste")
    def test_pdf_sem_texto(self):
        from reportlab.pdfgen import canvas
        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        c.rect(50, 50, 100, 100)
        c.save()
        with self.assertRaises(ValueError) as e:
            nf_parser.parse_pdf(buf.getvalue(), "scan.pdf")
        self.assertIn("nenhum texto", str(e.exception))


if __name__ == "__main__":
    unittest.main()
