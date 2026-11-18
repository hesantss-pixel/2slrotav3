#!/usr/bin/env python3
"""Gera DANFEs de exemplo no layout da SEFAZ e guarda, junto, a posicao de cada
pedaco de texto na pagina (o que o pdf.js entrega ao navegador).

    python3 gerar_danfe.py

Sai: danfe-exemplo.pdf, danfe-sem-endereco.pdf e um .json por pagina com
[{s,x,y,h}] — usados por t_pdf.js, que roda sem baixar o pdf.js da internet.

Os dados sao ficticios. Serve para provar a leitura dos campos, nao para
substituir uma nota de verdade: cada emissor desenha o DANFE de um jeito.
"""
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

L, A = A4  # 595 x 842 pt
ESQ, DIR = 28, 28
LARG = L - ESQ - DIR


def caixa(c, x, y, w, h, rotulo, valor, fr=5, fv=7.5):
    """Uma caixa do DANFE: rotulo em letra miuda em cima, valor embaixo."""
    c.rect(x, y - h, w, h)
    c.setFont("Helvetica", fr)
    c.drawString(x + 2, y - fr - 1.5, rotulo)
    if valor:
        c.setFont("Helvetica-Bold", fv)
        c.drawString(x + 2, y - h + 3, str(valor))


def faixa(c, y, titulo, fonte=6.5):
    c.setFont("Helvetica-Bold", fonte)
    c.drawString(ESQ + 2, y, titulo)
    return y - 3


def linha_caixas(c, y, altura, campos):
    """campos: [(fracao_da_largura, rotulo, valor)]"""
    x = ESQ
    for fr, rot, val in campos:
        w = LARG * fr
        caixa(c, x, y, w, altura, rot, val)
        x += w
    return y - altura


def pagina(c, nota):
    y = A - 30
    # ── canhoto ──────────────────────────────────────────────────────────
    c.setFont("Helvetica", 5)
    c.drawString(ESQ + 2, y, "RECEBEMOS DE %s OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO"
                 % nota["emitente"].upper())
    c.rect(ESQ, y - 22, LARG, 26)
    y -= 34

    # ── emitente + DANFE + chave ─────────────────────────────────────────
    c.rect(ESQ, y - 74, LARG, 78)
    c.setFont("Helvetica", 5)
    c.drawString(ESQ + 4, y - 7, "IDENTIFICAÇÃO DO EMITENTE")
    c.setFont("Helvetica-Bold", 9)
    c.drawString(ESQ + 4, y - 20, nota["emitente"])
    c.setFont("Helvetica", 7)
    for i, t in enumerate(nota["emitente_linhas"]):
        c.drawString(ESQ + 4, y - 32 - i * 10, t)

    xm = ESQ + LARG * 0.42
    c.setFont("Helvetica-Bold", 13)
    c.drawString(xm + 30, y - 18, "DANFE")
    c.setFont("Helvetica", 5.5)
    c.drawString(xm + 10, y - 28, "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRÔNICA")
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(xm + 10, y - 40, "Nº. %s" % nota["nf_impresso"])
    c.drawString(xm + 90, y - 40, "SÉRIE %s" % nota["serie"])
    c.drawString(xm + 10, y - 52, "FOLHA 1/1")

    xd = ESQ + LARG * 0.68
    c.setFont("Helvetica", 5)
    c.drawString(xd + 2, y - 50, "CHAVE DE ACESSO")
    c.setFont("Helvetica-Bold", 6.5)
    ch = nota["chave"]
    c.drawString(xd + 2, y - 60, " ".join(ch[i:i + 4] for i in range(0, 44, 4)))
    y -= 86

    y = linha_caixas(c, y, 22, [
        (0.50, "NATUREZA DA OPERAÇÃO", "VENDA DE MERCADORIA"),
        (0.25, "PROTOCOLO DE AUTORIZAÇÃO DE USO", "135260001234567 18/11/2026"),
        (0.25, "INSCRIÇÃO ESTADUAL", "336.123.456.789"),
    ])

    # ── destinatário / remetente ─────────────────────────────────────────
    y = faixa(c, y - 8, "DESTINATÁRIO / REMETENTE")
    y = linha_caixas(c, y, 22, [
        (0.58, "NOME/RAZÃO SOCIAL", nota["dest_nome"]),
        (0.24, "CNPJ/CPF", nota["dest_cnpj"]),
        (0.18, "DATA DA EMISSÃO", "18/11/2026"),
    ])
    y = linha_caixas(c, y, 22, [
        (0.48, "ENDEREÇO", nota["dest_endereco"]),
        (0.22, "BAIRRO/DISTRITO", nota["dest_bairro"]),
        (0.12, "CEP", nota["dest_cep"]),
        (0.18, "DATA DA ENTRADA/SAÍDA", "18/11/2026"),
    ])
    y = linha_caixas(c, y, 22, [
        (0.34, "MUNICÍPIO", nota["dest_municipio"]),
        (0.20, "FONE/FAX", "(11) 2234-5678"),
        (0.08, "UF", nota["dest_uf"]),
        (0.22, "INSCRIÇÃO ESTADUAL", "116.543.210.987"),
        (0.16, "HORA DE SAÍDA", "08:15"),
    ])

    # ── cálculo do imposto ───────────────────────────────────────────────
    y = faixa(c, y - 8, "CÁLCULO DO IMPOSTO")
    y = linha_caixas(c, y, 22, [
        (0.34, "BASE DE CÁLCULO DO ICMS", "1.250,00"),
        (0.33, "VALOR DO ICMS", "225,00"),
        (0.33, "VALOR TOTAL DA NOTA", "1.250,00"),
    ])

    # ── transportador: repete NOME, ENDEREÇO, MUNICÍPIO e UF ─────────────
    y = faixa(c, y - 8, "TRANSPORTADOR / VOLUMES TRANSPORTADOS")
    y = linha_caixas(c, y, 22, [
        (0.42, "NOME/RAZÃO SOCIAL", "TRANSPORTES EXEMPLO LTDA"),
        (0.16, "FRETE POR CONTA", "0-EMITENTE"),
        (0.14, "CÓDIGO ANTT", "12345678"),
        (0.14, "PLACA DO VEÍCULO", "ABC1D23"),
        (0.06, "UF", "SP"),
        (0.08, "CNPJ/CPF", "99.888.777/0001-66"),
    ])
    y = linha_caixas(c, y, 22, [
        (0.52, "ENDEREÇO", "AVENIDA DOS TRANSPORTADORES, 4000"),
        (0.30, "MUNICÍPIO", "BARUERI"),
        (0.06, "UF", "SP"),
        (0.12, "INSCRIÇÃO ESTADUAL", "222.333.444.555"),
    ])
    y = linha_caixas(c, y, 22, [
        (0.14, "QUANTIDADE", nota["volumes"]),
        (0.20, "ESPÉCIE", "CAIXA"),
        (0.16, "MARCA", "—"),
        (0.20, "NUMERAÇÃO", "1/%s" % nota["volumes"]),
        (0.15, "PESO BRUTO", nota["peso_bruto"]),
        (0.15, "PESO LÍQUIDO", nota["peso_liquido"]),
    ])

    # ── produtos ─────────────────────────────────────────────────────────
    y = faixa(c, y - 8, "DADOS DO PRODUTO / SERVIÇO")
    c.rect(ESQ, y - 60, LARG, 64)
    c.setFont("Helvetica", 5)
    for i, (rot, dx) in enumerate([("CÓDIGO", 0), ("DESCRIÇÃO DO PRODUTO/SERVIÇO", 50),
                                   ("NCM/SH", 300), ("CFOP", 350), ("UNID", 395),
                                   ("QUANT", 430), ("VALOR UNITÁRIO", 470)]):
        c.drawString(ESQ + 2 + dx, y - 7, rot)
    c.setFont("Helvetica", 7)
    c.drawString(ESQ + 2, y - 20, "7788")
    c.drawString(ESQ + 52, y - 20, "MERCADORIA DE EXEMPLO PARA TESTE")
    c.drawString(ESQ + 302, y - 20, "39269090")
    c.drawString(ESQ + 352, y - 20, "5102")
    c.drawString(ESQ + 397, y - 20, "UN")
    c.drawString(ESQ + 432, y - 20, "10")
    c.drawString(ESQ + 472, y - 20, "125,00")
    c.showPage()


# ── as notas ────────────────────────────────────────────────────────────────
def chave(cuf, aamm, cnpj, mod, serie, nnf, tp, cnf, dv):
    k = f"{cuf}{aamm}{cnpj}{mod}{serie}{nnf}{tp}{cnf}{dv}"
    assert len(k) == 44, (k, len(k))
    return k


EMIT = ["AVENIDA INDUSTRIAL, 1200 - GALPAO 3", "CEP: 07140-000 - GUARULHOS - SP",
        "CNPJ: 12.345.678/0001-99   FONE: (11) 2222-3333"]

NOTAS = [
    dict(arquivo="danfe-exemplo", emitente="INDUSTRIA EXEMPLO LTDA", emitente_linhas=EMIT,
         chave=chave("35", "2611", "12345678000199", "55", "001", "000012345", "1", "12345678", "0"),
         nf_impresso="000.012.345", serie="001",
         dest_nome="SUPERMERCADO BOM PRECO LTDA", dest_cnpj="98.765.432/0001-10",
         dest_endereco="RUA DAS ACACIAS, 457", dest_bairro="JARDIM SAO PAULO",
         dest_cep="07095-420", dest_municipio="GUARULHOS", dest_uf="SP",
         volumes="12", peso_bruto="1.250,500", peso_liquido="1.180,000"),
    # mesma nota, segunda via: nao pode virar dois pedidos
    dict(arquivo="danfe-exemplo", emitente="INDUSTRIA EXEMPLO LTDA", emitente_linhas=EMIT,
         chave=chave("35", "2611", "12345678000199", "55", "001", "000012345", "1", "12345678", "0"),
         nf_impresso="000.012.345", serie="001",
         dest_nome="SUPERMERCADO BOM PRECO LTDA", dest_cnpj="98.765.432/0001-10",
         dest_endereco="RUA DAS ACACIAS, 457", dest_bairro="JARDIM SAO PAULO",
         dest_cep="07095-420", dest_municipio="GUARULHOS", dest_uf="SP",
         volumes="12", peso_bruto="1.250,500", peso_liquido="1.180,000"),
    # outra nota: municipio com UF na mesma caixa e sem peso
    dict(arquivo="danfe-exemplo", emitente="INDUSTRIA EXEMPLO LTDA", emitente_linhas=EMIT,
         chave=chave("35", "2611", "12345678000199", "55", "001", "000067890", "1", "87654321", "3"),
         nf_impresso="000.067.890", serie="001",
         dest_nome="PADARIA DOIS IRMAOS ME", dest_cnpj="11.222.333/0001-44",
         dest_endereco="AVENIDA PAULISTA, 1500 - CONJ 42", dest_bairro="BELA VISTA",
         dest_cep="01310-200", dest_municipio="SAO PAULO - SP", dest_uf="",
         volumes="3", peso_bruto="", peso_liquido=""),
    # nota ilegivel: sem CEP e sem municipio
    dict(arquivo="danfe-sem-endereco", emitente="INDUSTRIA EXEMPLO LTDA", emitente_linhas=EMIT,
         chave=chave("35", "2611", "12345678000199", "55", "001", "000099999", "1", "11112222", "7"),
         nf_impresso="000.099.999", serie="001",
         dest_nome="CLIENTE SEM ENDERECO", dest_cnpj="55.666.777/0001-88",
         dest_endereco="", dest_bairro="", dest_cep="", dest_municipio="", dest_uf="",
         volumes="1", peso_bruto="50,000", peso_liquido="49,000"),
]

AQUI = os.path.dirname(os.path.abspath(__file__))
for nome in sorted({n["arquivo"] for n in NOTAS}):
    cv = canvas.Canvas(os.path.join(AQUI, nome + ".pdf"), pagesize=A4)
    for n in [x for x in NOTAS if x["arquivo"] == nome]:
        pagina(cv, n)
    cv.save()
    print(nome + ".pdf")

# ── o mesmo texto com a posicao de cada pedaco, como o pdf.js entrega ──────
from pypdf import PdfReader  # noqa: E402

for nome in sorted({n["arquivo"] for n in NOTAS}):
    leitor = PdfReader(os.path.join(AQUI, nome + ".pdf"))
    paginas = []
    for pag in leitor.pages:
        itens = []

        def visita(texto, cm, tm, dic, tamanho, itens=itens):
            t = (texto or "").strip()
            if t:
                itens.append({"s": t, "x": round(tm[4], 2), "y": round(tm[5], 2),
                              "h": round(float(tamanho or 8), 2)})

        pag.extract_text(visitor_text=visita)
        paginas.append(itens)
    destino = os.path.join(AQUI, nome + ".json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(paginas, f, ensure_ascii=False, indent=0)
    print(nome + ".json", sum(len(p) for p in paginas), "pedacos de texto")
