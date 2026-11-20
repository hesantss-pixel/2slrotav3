#!/usr/bin/env python3
"""Gera uma "Ordem de Coleta de Cargas" de exemplo no mesmo layout do PDF real
(duas vias da mesma ordem por pagina, "ROTULO: valor" na mesma linha) e guarda,
junto, a posicao de cada pedaco de texto (o que o pdf.js entrega ao navegador).

    python3 gerar_ordem_coleta.py

Sai: ordem-coleta-exemplo.pdf e ordem-coleta-exemplo.json — usados por
t_ordem_coleta.js. Os dados sao FICTICIOS: o repositorio e publico, entao os
documentos reais do cliente nunca entram aqui.
"""
import json
import os

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

AQUI = os.path.dirname(os.path.abspath(__file__))

ORDENS = [
    dict(serie="SP3", num="000101", rem="TRANSPORTES EXEMPLO ALFA LTDA", contato="MARIA",
         end="RUA DAS FLORES 120", bairro="CENTRO", cidade="GUARULHOS/SP", fone="(0011) 1234-5678",
         cep="07010-000", dest="CLIENTE BETA LTDA", destcid="SALVADOR/BA", qtd="12",
         esp="VOLUMES", peso="1.250,500", merc="VIDE NF", nf="004521", contato_grudado=False),
    dict(serie="SP3", num="000102", rem="INDUSTRIA EXEMPLO GAMA SA", contato="JOAO",
         end="AV PAULISTA 1000 SALA 5", bairro="BELA VISTA", cidade="SAO PAULO/SP", fone="(0011) 8765-4321",
         cep="01310-100", dest="COMERCIO DELTA ME", destcid="CURITIBA/PR", qtd="3",
         esp="VOLUMES", peso="80,000", merc="VIDE NF", nf="", contato_grudado=True),
]


def via(c, itens, o, dy):
    """Uma via da ordem. dy desloca para a 2a via (metade de baixo da folha)."""
    def t(x, y, s, h):
        y = y + dy
        c.setFont("Helvetica", h)
        c.drawString(x, y, s)
        itens.append({"s": s, "x": float(x), "y": float(y), "h": float(h)})

    t(234, 811, "TRANSPORTADORA EXEMPLO LTDA", 8.2)
    t(234, 799, "R DO DEPOSITO EXEMPLO, 1", 7.7)
    t(234, 788, "GUARULHOS/SP - 07000-000", 7.7)
    t(234, 776, "CNPJ/MF: 00.000.000/0000-00", 7.7)
    t(235, 753, "Ordem de Coleta de Cargas", 12)
    t(447, 753, "Nº", 12)
    t(478, 753, o["serie"], 12)
    t(522, 753, o["num"], 12)
    t(304, 732, "Solicitação efetuada em 01/01/2026 AS 08:00:00", 9.8)
    t(24, 714, "REMETENTE:", 7.2)
    t(64, 712, o["rem"], 8.2)
    if o["contato_grudado"]:
        t(433, 714, "CONTATO:" + o["contato"], 7.2)
    else:
        t(433, 714, "CONTATO:", 7.2)
        t(464, 712, o["contato"], 8.2)
    t(24, 703, "ENDEREÇO:", 7.2)
    t(64, 701, o["end"], 8.2)
    t(24, 693, "BAIRRO:", 7.2)
    t(64, 691, o["bairro"], 8.2)
    t(190, 693, "CIDADE/UF:", 7.2)
    t(230, 691, o["cidade"], 8.2)
    t(432, 693, "TELEFONE:", 7.2)
    t(465, 691, o["fone"], 8.2)
    t(24, 682, "CEP:", 7.2)
    t(64, 680, o["cep"], 8.2)
    t(208, 675, "HORÁRIO DE FUNCIONAMENTO DO SOLICITANTE:", 7.2)
    t(351, 673, "08:00 a 12:00", 8.2)
    t(420, 673, "13:00 a 17:00", 8.2)
    t(24, 658, "DESTINATÁRIO:", 7.2)
    t(73, 656, o["dest"], 8.2)
    t(24, 648, "CIDADE/UF:", 7.2)
    t(73, 646, o["destcid"], 8.2)
    t(376, 648, "TIPO FRETE:", 7.2)
    t(414, 646, "[ ] C I F", 8.2)
    t(483, 646, "[XX] F O B", 8.2)
    t(223, 627, "Descrição da Carga a ser Coletada", 8.9)
    for x, s in ((24, "Quantidade"), (81, "Espécie"), (151, "Peso"), (221, "Mercadoria a Coletar"), (502, "Nota Fiscal")):
        t(x, 611, s, 8.2)
    t(69, 596, o["qtd"], 8)
    t(82, 596, o["esp"], 8)
    t(171, 596, o["peso"], 8)
    t(221, 596, o["merc"], 8)
    if o["nf"]:
        t(502, 596, o["nf"], 8)
    t(24, 532, "Observações:", 8.2)
    t(423, 534, "EMITIDO POR:", 7.2)
    t(466, 532, "ANA", 8.2)
    t(24, 511, "MED 50X50X50 CM", 8)


def main():
    pdf = os.path.join(AQUI, "ordem-coleta-exemplo.pdf")
    c = canvas.Canvas(pdf, pagesize=A4)
    paginas = []
    for o in ORDENS:
        itens = []
        via(c, itens, o, 0)
        via(c, itens, o, -392)
        paginas.append(itens)
        c.showPage()
    c.save()
    with open(os.path.join(AQUI, "ordem-coleta-exemplo.json"), "w", encoding="utf-8") as f:
        json.dump(paginas, f, ensure_ascii=False)
    print(pdf)


if __name__ == "__main__":
    main()
