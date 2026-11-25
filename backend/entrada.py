"""
entrada.py — Entrada automática de pedidos (por e-mail e por API)
------------------------------------------------------------------
Os pedidos que chegam sozinhos (XML da NF-e por e-mail, ou JSON/XML pela API de
cada empresa) são lidos aqui com as MESMAS regras da importação na tela
(index.html: _lerXmlNFe, _cidadeNorm, _chaveId) e gravados em
empresas/<id>/pedidos_rota. A tela recebe na hora e localiza no mapa.

Regras da entrada automática:
  - Pedido que já existe (mesma chave) não é alterado: a mesma nota enviada de novo
    não apaga edições nem o local corrigido. Para trocar dados, use a tela.
  - XML de cancelamento da NF-e: tira dos pendentes; se a nota já está em rota,
    fica e o aviso vai para o registro de recebimentos.
  - Cada recebimento fica em empresas/<id>/entrada_log (últimos 100).

Credenciais (geradas pelo servidor, nunca pela tela):
  integracao_chaves/<sha256 da chave>  -> {eid, em}      (chave da API)
  integracao_email/<código>            -> {eid, em}      (endereço de e-mail)
  empresas/<id>/config/integracao      -> início da chave, código do e-mail, datas
A chave inteira só aparece uma vez, para quem gerou.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import secrets
import threading
import time
import unicodedata
import xml.etree.ElementTree as ET

import requests

logger = logging.getLogger(__name__)

TIPOS = ("entrega", "coleta")
FINAIS = {"despachado", "entregue", "coletado", "confirmado"}
MAX_PEDIDOS_POR_ENVIO = 500
MAX_LOG = 100


class ErroBanco(Exception):
    """O banco não respondeu: a mensagem/pedido deve ser tentado de novo."""


# ── Banco: Firebase Realtime Database pela API REST, com o segredo do servidor ──

class Banco:
    def __init__(self, url: str, segredo: str, sessao=requests):
        self.url = (url or "").rstrip("/")
        self.segredo = segredo or ""
        self.s = sessao

    def ligado(self) -> bool:
        return bool(self.url and self.segredo)

    def _u(self, path: str) -> str:
        return f"{self.url}/{path.strip('/')}.json" if path.strip("/") else f"{self.url}/.json"

    def ler(self, path: str, **params):
        try:
            r = self.s.get(self._u(path), params={"auth": self.segredo, **params}, timeout=12)
        except requests.RequestException as e:
            raise ErroBanco(str(e))
        if not r.ok:
            raise ErroBanco(f"leitura {path}: HTTP {r.status_code}")
        return r.json()

    def atualizar(self, path: str, dados: dict) -> None:
        if not dados:
            return
        try:
            r = self.s.patch(self._u(path), params={"auth": self.segredo}, json=dados, timeout=20)
        except requests.RequestException as e:
            raise ErroBanco(str(e))
        if not r.ok:
            raise ErroBanco(f"gravação {path}: HTTP {r.status_code}")


# ── Leitura da NF-e (mesmas regras de _lerXmlNFe na tela) ─────────────────────

_CONHECIDAS = {
    "guaruja": "Guarujá", "sao paulo": "São Paulo", "santo andre": "Santo André",
    "sao bernardo do campo": "São Bernardo do Campo", "sao caetano do sul": "São Caetano do Sul",
    "taboao da serra": "Taboão da Serra", "aruja": "Arujá", "poa": "Poá", "jundiai": "Jundiaí",
    "santana de parnaiba": "Santana de Parnaíba", "maua": "Mauá",
    "itaquaquecetuba": "Itaquaquecetuba", "mogi das cruzes": "Mogi das Cruzes",
}


def _sem_acento(s: str) -> str:
    return re.sub(r"[̀-ͯ]", "", unicodedata.normalize("NFD", str(s or "")))


def cidade_norm(raw) -> str:
    """Igual a _cidadeNorm: tira '- SP', acerta maiúsculas e nomes conhecidos."""
    t = re.sub(r"\s+", " ", str(raw or "").strip())
    if not t:
        return "Sem cidade"
    base = re.sub(r"\s*[-/]\s*[A-Za-z]{2}$", "", t)
    k = _sem_acento(base).lower()
    if k in _CONHECIDAS:
        return _CONHECIDAS[k]
    s = re.sub(r"(^|\s)(\S)", lambda m: m.group(1) + m.group(2).upper(), base.lower())
    return re.sub(r" (Da|De|Do|Das|Dos|E)(?= )", lambda m: m.group(0).lower(), s)


def chave_id(base, tipo: str) -> str:
    """Igual a _chaveId: entrega = base; coleta = 'C_' + base."""
    b = re.sub(r"[^A-Za-z0-9_-]+", "-", str(base or "").strip()).strip("-")
    if not b:
        b = "SN-" + _base36(int(time.time() * 1000))
    return ("C_" if tipo == "coleta" else "") + b


def _base36(n: int) -> str:
    dig = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = dig[r] + s
    return s or "0"


def _local(tag) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _filho(el, nome):
    if el is None:
        return None
    for c in el:
        if _local(c.tag) == nome:
            return c
    return None


def _txt(el, nome) -> str:
    c = _filho(el, nome)
    return "".join(c.itertext()).strip() if c is not None else ""


def _num(v) -> float:
    """parseFloat do JavaScript (com vírgula trocada por ponto): lê o número do começo."""
    m = re.match(r"\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)", str(v or "").replace(",", "."))
    return float(m.group(1)) if m else 0.0


def _int(v) -> int:
    m = re.match(r"\s*([-+]?\d+)", str(v or ""))
    return int(m.group(1)) if m else 0


def _arred2(x: float) -> float:
    """Math.round(x*100)/100 do JavaScript (arredonda .5 para cima)."""
    import math
    return math.floor(x * 100 + 0.5) / 100


MAX_PRODUTOS_NOTA = 30


def _limpa(s, n: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:n]


_M3_ROTULO = re.compile(r"\b(?:cubagem(?: total)?|metros? cubicos?|volume\s*\(m[3³]\)|m3|m³)\s*(?:\(m[3³]\))?\s*[:=]\s*(\d{1,3}(?:[.,]\d{1,4})?)", re.I)
_M3_CUBAGEM = re.compile(r"\bcubagem(?: total)?\s+(\d{1,3}(?:[.,]\d{1,4})?)\s*m[3³]?(?![a-z0-9])", re.I)
_M3_SOLTO = re.compile(r"(?:^|[\s(])(\d{1,3}(?:[.,]\d{1,4})?)\s?m[3³](?![a-z0-9])", re.I)


def m3_do_texto(txt: str, livre: bool = False) -> float:
    """Volume em m³ escrito no texto da nota ("Cubagem: 1,25 m3", "M3: 0,8").
    livre=True aceita também um "2,5 m³" solto (só nas informações complementares,
    onde não há nome de produto). Igual a _m3DoTexto do index.html. 0 = não achou."""
    t = unicodedata.normalize("NFD", str(txt or ""))
    t = re.sub(r"[\u0300-\u036f]", "", t).lower()
    t = re.sub(r"\s+", " ", t)
    m = _M3_ROTULO.search(t) or _M3_CUBAGEM.search(t) or (_M3_SOLTO.search(t) if livre else None)
    if not m:
        return 0.0
    v = m.group(1)
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", v):
        v = v.replace(".", "")   # "1.250" é milhar, como na tela
    try:
        n = float(v)
    except ValueError:
        return 0.0
    return round(n, 4) if 0 < n <= 200 else 0.0


_N = r"(\d+(?:[.,]\d+)?)"
_U = r"(?:\s*(MM|CM|MTS|METROS?|M)(?![A-Z0-9]))?"
_R = r"\s*(?:\((?:COMPRIMENTO|LARGURA|ALTURA|COMP|LARG|ALT)\.?\))?\s*"
_MED_ROT = re.compile(_N + _U + r"\s*(?:DE\s+)?COMP(?:RIMENTO)?\b.*?" + _N + _U + r"\s*(?:DE\s+)?LARG(?:URA)?\b.*?"
                      + _N + _U + r"\s*(?:DE\s+)?ALT(?:URA)?\b")
_MED_X = re.compile(_N + _U + _R + r"X\s*" + _N + _U + _R + r"X\s*" + _N + _U)
_MED_COMP = re.compile(r"(?:^|[^\d.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:METROS?|MTS|M)(?![A-Z0-9])")


def _num_br_txt(v: str) -> float:
    if "," in v:
        v = v.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", v):
        v = v.replace(".", "")
    try:
        return float(v)
    except ValueError:
        return 0.0


def _lados_cm(x) -> list | None:
    un = lambda u: "" if not u else ("MM" if u == "MM" else "CM" if u == "CM" else "M")
    v = [_num_br_txt(n) for n, _ in x]
    if not all(n > 0 for n in v):
        return None
    mx, tem_dec = max(v), any(re.search(r"[.,]", n) for n, _ in x)
    prop = [un(u) for _, u in x]
    n_prop = len([u for u in prop if u])
    fim = prop[2] or next((u for u in prop if u), "") or ("M" if mx <= 6 else "CM")
    if n_prop <= 1 and fim == "M" and mx > 14:
        fim = "CM"     # "10*15*330 METROS": 330 m não é carga
    if n_prop <= 1 and fim == "CM" and mx <= 6 and tem_dec:
        fim = "M"      # "1,15X1,15X0,60CM": é metro
    cm = []
    for i, n in enumerate(v):
        k = prop[i] if n_prop > 1 and prop[i] else fim
        cm.append(round((n / 10 if k == "MM" else n * 100 if k == "M" else n) * 10) / 10)
    if all(1 <= n <= 1400 for n in cm) and cm[0] * cm[1] * cm[2] / 1e6 <= 60:
        return cm
    return None


def medidas_do_texto(txt: str) -> dict | None:
    """Medidas de UM volume escritas à mão ("MED 50X50X50", "1,15X1,15X0,60CM",
    "120 CM (COMPRIMENTO) X 49 CM (LARGURA) X 23 CM (ALTURA)", "60 CM . 30 CM . 5M 20CM").
    Igual a _medidasDoTexto do index.html. {"cm": [c, l, a], "maiorCm"}, {"maiorCm"} ou None."""
    t = unicodedata.normalize("NFD", str(txt or ""))
    t = re.sub(r"[\u0300-\u036f]", "", t).upper()
    t = re.sub(r"[*×]", "X", t)
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"(\d+)\s*M\s+(\d{1,2})\s*CM\b", lambda m: m.group(1) + "," + m.group(2).zfill(2) + "M", t)
    t = re.sub(r"(\d)(\s*(?:MM|CM|M))?\s+\.\s+(?=\d)", lambda m: m.group(1) + (m.group(2) or "") + " X ", t)
    tri = []
    m = _MED_ROT.search(t)
    if m:
        tri.append([(m.group(1), m.group(2)), (m.group(3), m.group(4)), (m.group(5), m.group(6))])
    for m in _MED_X.finditer(t):
        tri.append([(m.group(1), m.group(2)), (m.group(3), m.group(4)), (m.group(5), m.group(6))])
    for x in tri:
        cm = _lados_cm(x)
        if cm:
            return {"cm": cm, "maiorCm": max(cm)}
    m = _MED_COMP.search(t)
    if m:
        v = _num_br_txt(m.group(1))
        if 1 <= v <= 14:
            return {"maiorCm": round(v * 100)}
    return None


def _fmt_med(v: float) -> str:
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


_QTD_UN = (r"CXS?|CAIXAS?|VOL(?:UME)?S?|PCS?|PECAS?|UN(?:IDADES?)?|UNDS?|PALETES?|PLTS?|FARDOS?|ROLOS?"
           r"|BOMBONAS?|TAMBOR(?:ES)?|SACOS?|ITENS?|VEZES")
_UNI = r"\d+(?:[.,]\d+)?(?:\s*(?:MM|CM|MTS|METROS?|M)(?![A-Z0-9]))?" + _R
_MED_VARIAS = re.compile(_UNI + r"(?:X\s*" + _UNI + r"){2,3}")
_MED_PARTE = re.compile(r"^(\d+(?:[.,]\d+)?)(?:\s*(MM|CM|MTS|METROS?|M)(?![A-Z0-9]))?")
_QTD_ANTES = re.compile(r"(?:^|[^\d.,])(\d{1,4})\s*(?:" + _QTD_UN + r")\.?\s*(?:DE|COM|C/)?\s*(?:MED(?:IDAS?)?\.?\s*:?)?\s*$"
                        r"|QTDE?\.?\s*:?\s*(\d{1,4})\s*(?:[-/,;]\s*)?(?:MED(?:IDAS?)?\.?\s*:?)?\s*$")
_QTD_DEPOIS = re.compile(r"^\s*(?:\(\s*(\d{1,4})\s*(?:X|" + _QTD_UN + r")?\s*\)|[-=:]\s*(\d{1,4})\s*(?:" + _QTD_UN + r")\b"
                         r"|(\d{1,4})\s*(?:" + _QTD_UN + r")\b(?!\.?\s*(?:DE|COM|C/)?\s*(?:MED(?:IDAS?)?\.?\s*:?)?\s*\d))")


def medidas_varias_do_texto(txt: str) -> list:
    """Vários tamanhos na mesma observação, cada um com a quantidade: "2X 50X50X50 + 3X 80X60X40",
    "2 CX 50X50X50 / 3 CX 80X60X40", "50X50X50 (2) 80X60X40 (3)", "QTD 2 MED 1,15X1,15X0,60".
    Igual a _medidasVariasDoTexto do index.html. [{"cm": [c, l, a], "q": int | None}]"""
    t = unicodedata.normalize("NFD", str(txt or ""))
    t = re.sub(r"[̀-ͯ]", "", t).upper()
    t = re.sub(r"[*×]", "X", t)
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"(\d+)\s*M\s+(\d{1,2})\s*CM\b", lambda m: m.group(1) + "," + m.group(2).zfill(2) + "M", t)
    t = re.sub(r"(\d)(\s*(?:MM|CM|M))?\s+\.\s+(?=\d)", lambda m: m.group(1) + (m.group(2) or "") + " X ", t)
    out, fim, pos = [], 0, 0
    while True:
        m = _MED_VARIAS.search(t, pos)
        if not m:
            break
        pos = m.end() if m.end() > m.start() else m.start() + 1
        ps = [mp.groups() for mp in (_MED_PARTE.match(x.strip()) for x in m.group(0).split("X")) if mp]
        if len(ps) < 3:
            continue
        dims, q = ps[:3], None
        if len(ps) == 4:   # a quantidade é bem menor que o menor lado (em cm): "2X50X50X50", "1,15X1,15X0,60X2"
            v = [_num_br_txt(n) for n, _ in ps]
            inteiro = lambda k: re.fullmatch(r"\d+", ps[k][0]) and not ps[k][1] and 1 <= v[k] <= 999
            c0 = _lados_cm(ps[1:]) if inteiro(0) else None
            c3 = _lados_cm(ps[:3]) if inteiro(3) else None
            if c0 and v[0] * 2 <= min(c0):
                q, dims = int(v[0]), ps[1:]
            elif c3 and v[3] * 2 <= min(c3):
                q = int(v[3])
        cm = _lados_cm(dims)
        if not cm:
            continue
        if q is None:
            a = _QTD_ANTES.search(t[fim:m.start()][-40:])
            if a:
                q = int(a.group(1) or a.group(2))
        fim_q = m.end()
        if q is None:
            d = _QTD_DEPOIS.match(t[fim_q:])
            if d:
                q = int(d.group(1) or d.group(2) or d.group(3))
                fim_q += d.end()
        out.append({"cm": cm, "q": q if q and q > 0 else None})
        fim = fim_q
        pos = max(pos, fim_q)
    # o mesmo tamanho repetido sem quantidade (a nota repete a medida) conta uma vez
    return [x for i, x in enumerate(out)
            if x["q"] is not None or not any(y["q"] is None and y["cm"] == x["cm"] for y in out[:i])]


def _txt_tamanhos(lista: list) -> str:
    return "; ".join((f'{x["q"]} de ' if x.get("q") is not None else "") + " × ".join(_fmt_med(n) for n in x["cm"]) + " cm"
                     for x in lista)


def m3_por_medidas(txt: str, volumes) -> dict | None:
    """m³ pelas medidas das observações (igual a _m3PorMedidasVarias do index.html): um tamanho →
    medida × volumes; vários → cada tamanho × a quantidade dele. Sem a quantidade de algum, só fecha
    quando os volumes dizem (um de cada, ou o que sobra para o único sem quantidade); senão só avisa.
    {"m3", "maiorCm", "medidas", "cx"?, "aviso"?}, {"maiorCm", "aviso"?} ou None."""
    lista = medidas_varias_do_texto(txt)
    vol = max(0, int(math.floor((float(volumes or 0)) + 0.5)))
    if len(lista) < 2:   # um tamanho só: medida × volumes ("2X50X50X50" é 2 de 50 × 50 × 50)
        md = {"cm": lista[0]["cm"], "maiorCm": max(lista[0]["cm"])} if lista else medidas_do_texto(txt)
        if not md:
            return None
        if not md.get("cm"):
            return {"maiorCm": md["maiorCm"]}
        c = md["cm"]
        m3 = math.floor(c[0] * c[1] * c[2] / 1e6 * max(1, vol) * 1e4 + 0.5) / 1e4
        if not 0 < m3 <= 200:
            return {"maiorCm": md["maiorCm"]}
        r = {"m3": m3, "maiorCm": md["maiorCm"], "medidas": " × ".join(_fmt_med(n) for n in c) + " cm"}
        q = lista[0]["q"] if len(lista) == 1 else None
        if q and vol > 0 and q != vol:
            r["aviso"] = f"As observações falam em {q} volume{'s' if q > 1 else ''} e a nota tem {vol}: confira."
        return r
    maior = max(n for x in lista for n in x["cm"])
    sem = [x for x in lista if x["q"] is None]
    conh = sum(x["q"] or 0 for x in lista)
    qs = [x["q"] for x in lista]
    if len(sem) == len(lista) and vol == len(lista):
        qs = [1] * len(lista)
    elif len(sem) == 1 and vol > conh:
        qs = [x["q"] if x["q"] is not None else vol - conh for x in lista]
    elif sem:
        return {"maiorCm": maior, "aviso": f"As observações têm {len(lista)} tamanhos ({_txt_tamanhos(lista)}) sem a quantidade "
                                            "de cada um: digite o m³ ou use a calculadora."}
    cx = [{"c": x["cm"][0], "l": x["cm"][1], "a": x["cm"][2], "q": q} for x, q in zip(lista, qs)]
    m3 = math.floor(sum(x["c"] * x["l"] * x["a"] / 1e6 * x["q"] for x in cx) * 1e4 + 0.5) / 1e4
    if not 0 < m3 <= 200:
        return {"maiorCm": maior}
    r = {"m3": m3, "maiorCm": maior, "medidas": _txt_tamanhos([{**x, "q": q} for x, q in zip(lista, qs)]), "cx": cx}
    tot = sum(qs)
    if vol > 0 and tot != vol:
        r["aviso"] = f"As quantidades das observações ({tot}) não batem com os volumes ({vol}): confira."
    return r


def _medidas_da_obs(p: dict) -> None:
    """m³ pelas medidas escritas nas observações, quando a nota não diz o m³."""
    r = m3_por_medidas(p.get("obsNota", ""), p.get("itens") or 1) if p.get("obsNota") else None
    if not r:
        return
    p["maiorCm"] = r["maiorCm"]
    if (p.get("m3") or 0) > 0:
        return
    if r.get("aviso"):
        p["medidasAviso"] = r["aviso"]
    if r.get("m3"):
        p["m3"], p["m3Fonte"], p["medidas"] = r["m3"], "medidas", r["medidas"]
        if r.get("cx"):
            p["cx"] = r["cx"]


def _detalhes_nota(inf) -> dict:
    """O que a janela "ver pedido" da tela mostra além do básico (igual a _detalhesNota do
    index.html). A NF-e não tem medida: o tamanho da carga vem do peso, dos volumes e da
    espécie. No máximo 30 produtos por nota; só entra campo com valor."""
    r: dict = {}
    prods, total = [], 0
    for d in inf:
        if _local(d.tag) != "det":
            continue
        p = _filho(d, "prod")
        desc = _limpa(_txt(p, "xProd"), 80)
        if not desc:
            continue
        total += 1
        if len(prods) >= MAX_PRODUTOS_NOTA:
            continue
        it = {"d": desc, "q": math.floor(_num(_txt(p, "qCom")) * 1000 + 0.5) / 1000}
        u = _limpa(_txt(p, "uCom"), 8)
        if u:
            it["u"] = u
        c = _limpa(_txt(p, "cProd"), 40)
        if c:
            it["c"] = c   # código do produto no emitente: liga às medidas cadastradas (cubagem)
        prods.append(it)
    if prods:
        r["produtos"] = prods
        if total > len(prods):
            r["produtosTotal"] = total
    vols, liq = [], 0.0
    transp = _filho(inf, "transp")
    for v in (list(transp) if transp is not None else []):
        if _local(v.tag) != "vol":
            continue
        liq += _num(_txt(v, "pesoL"))
        q, esp = max(0, _int(_txt(v, "qVol"))), _limpa(_txt(v, "esp"), 30)
        if esp and len(vols) < 10:   # sem a espécie, o número já está em "itens"
            vols.append({"q": q, "esp": esp})
    if vols:
        r["volumes"] = vols
    if liq > 0:
        r["pesoLiq"] = _arred2(liq)
    vnf = _num(_txt(_filho(_filho(inf, "total"), "ICMSTot"), "vNF"))
    if vnf > 0:
        r["valor"] = _arred2(vnf)
    obs = _limpa(_txt(_filho(inf, "infAdic"), "infCpl"), 500)
    if obs:
        r["obsNota"] = obs
        m3 = m3_do_texto(obs, livre=True)
        if m3:
            r["m3"], r["m3Fonte"] = m3, "nota"
    ide = _filho(inf, "ide")
    em = (_txt(ide, "dhEmi") or _txt(ide, "dEmi"))[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", em):
        r["emissao"] = em
    return r


def ler_xml_nfe(conteudo, tipo: str = "entrega") -> dict:
    """XML da NF-e (layout 4.00) -> {"pedidos": [...], "sem_peso": n, "cancelamentos": [chaves]}.
    Levanta ValueError com a mesma mensagem da tela para XML que não é nota."""
    tipo = tipo if tipo in TIPOS else "entrega"
    try:
        if isinstance(conteudo, bytes):
            raiz = ET.fromstring(conteudo.lstrip(b"\xef\xbb\xbf"))
        else:
            raiz = ET.fromstring(str(conteudo).lstrip("﻿"))
    except ET.ParseError:
        raise ValueError("XML inválido ou corrompido")
    elems = list(raiz.iter())
    infs = [e for e in elems if _local(e.tag) == "infNFe"]
    if not infs:
        if any(_local(e.tag) == "infCte" for e in elems):
            raise ValueError("é um CT-e; por enquanto o sistema lê o XML da NF-e")
        evs = [e for e in elems if _local(e.tag) == "infEvento"]
        if evs:
            # 110111 = cancelamento; 110112 = cancelamento por substituição
            canc, tipo_ev = [], ""
            for ev in evs:
                tp, ch = _txt(ev, "tpEvento"), _txt(ev, "chNFe")
                if re.fullmatch(r"11011[12]", tp) and re.fullmatch(r"\d{44}", ch):
                    if ch not in canc:
                        canc.append(ch)
                elif tp:
                    tipo_ev = tp
            if canc:
                return {"pedidos": [], "sem_peso": 0, "cancelamentos": canc}
            raise ValueError("é uma carta de correção, não uma nota" if tipo_ev == "110110"
                             else "é um evento da nota, não a nota nem um cancelamento")
        raise ValueError("não é o XML de uma NF-e")

    sem_peso = 0
    pedidos = []
    for inf in infs:
        ide, emit, dest = _filho(inf, "ide"), _filho(inf, "emit"), _filho(inf, "dest")
        grp_entrega, grp_retirada = _filho(inf, "entrega"), _filho(inf, "retirada")
        coleta = tipo == "coleta"
        local = (grp_retirada if grp_retirada is not None else _filho(emit, "enderEmit")) if coleta \
            else (grp_entrega if grp_entrega is not None else _filho(dest, "enderDest"))
        remetente = _txt(emit, "xFant") or _txt(emit, "xNome")
        destinatario = _txt(dest, "xNome")
        nf = _txt(ide, "nNF") or "S/N"
        chave = re.sub(r"^NFe", "", inf.get("Id") or "")
        chave_ok = bool(re.fullmatch(r"\d{44}", chave))
        base = chave if chave_ok else f"{_txt(emit, 'CNPJ') or _txt(emit, 'CPF')}-{_txt(ide, 'serie')}-{nf}"
        peso, vols = 0.0, 0
        transp = _filho(inf, "transp")
        for v in (list(transp) if transp is not None else []):
            if _local(v.tag) != "vol":
                continue
            peso += _num(_txt(v, "pesoB")) or _num(_txt(v, "pesoL"))
            vols += _int(_txt(v, "qVol"))
        if not peso:
            sem_peso += 1
        itens = vols or len([c for c in inf if _local(c.tag) == "det"]) or 1
        cidade = cidade_norm(_txt(local, "xMun"))
        cep_raw = re.sub(r"\D", "", _txt(local, "CEP"))
        cep = cep_raw if len(cep_raw) == 8 else ""
        lgr, nro, cpl = _txt(local, "xLgr"), _txt(local, "nro"), _txt(local, "xCpl")
        dest_nome = remetente if coleta else (_txt(grp_entrega, "xNome") or destinatario)
        pedidos.append({
            "id": chave_id(base, tipo), "nf": nf, "tipo": tipo, "chave": chave if chave_ok else "",
            "dest": dest_nome or cidade,
            "remetente": remetente, "destinatario": destinatario,
            "endereco": " - ".join(x for x in [f"{lgr}, {nro}" if lgr and nro else lgr, cpl] if x),
            "bairro": _txt(local, "xBairro"), "uf": _txt(local, "UF"),
            "cidade": cidade, "cep": cep, "geoStatus": "pendente" if cep else "sem_cep",
            "peso": _arred2(peso) if peso else 100, "itens": itens,
            "urgente": False, "agendado": False, "dataAgendada": "", "status": "pendente",
            **_detalhes_nota(inf),
        })
        _medidas_da_obs(pedidos[-1])
    return {"pedidos": pedidos, "sem_peso": sem_peso, "cancelamentos": []}


# ── Pedido em JSON (para sistemas e ERPs) ─────────────────────────────────────

def num_br(v) -> float:
    """'1.250' = 1250; '12,5' ou '12.5' = 12,5 (igual a _numBR na tela)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    t = re.sub(r"\s|kg", "", str(v or ""), flags=re.I)
    if not t:
        return float("nan")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(\.\d{3})+", t):
        t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return float("nan")


def pedido_de_json(d: dict, tipo_padrao: str = "entrega") -> dict:
    """Um pedido enviado em JSON -> pedido no formato do sistema. Levanta ValueError."""
    if not isinstance(d, dict):
        raise ValueError("cada pedido precisa ser um objeto")
    nf = str(d.get("nf") or d.get("numero_nota") or d.get("pedido") or "").strip()
    if not nf:
        raise ValueError("falta 'nf' (número da nota ou do pedido)")
    tipo = str(d.get("tipo") or tipo_padrao).strip().lower()
    if tipo not in TIPOS:
        raise ValueError(f"NF {nf}: 'tipo' deve ser 'entrega' ou 'coleta'")
    cidade_txt = str(d.get("cidade") or "").strip()
    if not cidade_txt:
        raise ValueError(f"NF {nf}: falta 'cidade'")
    cidade = cidade_norm(cidade_txt)
    cep = re.sub(r"\D", "", str(d.get("cep") or ""))
    if cep and len(cep) != 8:
        raise ValueError(f"NF {nf}: 'cep' precisa ter 8 números")
    uf = str(d.get("uf") or "").strip().upper()
    if uf and not re.fullmatch(r"[A-Z]{2}", uf):
        raise ValueError(f"NF {nf}: 'uf' tem 2 letras, como SP")
    peso = num_br(d.get("peso", d.get("peso_kg")))
    if not (peso == peso) or peso <= 0:
        raise ValueError(f"NF {nf}: 'peso' em kg, maior que zero")
    if peso > 100000:
        raise ValueError(f"NF {nf}: peso acima de 100.000 kg")
    try:
        itens = int(d.get("volumes", d.get("itens", 1)) or 1)
    except (TypeError, ValueError):
        raise ValueError(f"NF {nf}: 'volumes' deve ser um número inteiro")
    if itens < 1:
        raise ValueError(f"NF {nf}: 'volumes' a partir de 1")
    endereco = str(d.get("endereco") or "").strip().rstrip(",")
    numero = str(d.get("numero") or "").strip()
    if endereco and numero and not re.search(r",\s*\S", endereco):
        endereco = f"{endereco}, {numero}"
    compl = str(d.get("complemento") or "").strip()
    if endereco and compl:
        endereco = f"{endereco} - {compl}"
    data = str(d.get("data_agendada") or "").strip()
    if data and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", data):
        raise ValueError(f"NF {nf}: 'data_agendada' no formato AAAA-MM-DD")
    hi, hf = str(d.get("hora_inicio") or "").strip(), str(d.get("hora_fim") or "").strip()
    for h in (hi, hf):
        if h and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", h):
            raise ValueError(f"NF {nf}: horário no formato HH:MM")
    chave = re.sub(r"\D", "", str(d.get("chave") or ""))
    chave = chave if len(chave) == 44 else ""
    cliente = str(d.get("cliente") or d.get("dest") or "").strip()
    return {
        "id": chave_id(chave or nf, tipo), "nf": nf, "tipo": tipo, "chave": chave,
        "dest": cliente or cidade, "endereco": endereco, "bairro": str(d.get("bairro") or "").strip(),
        "uf": uf, "cidade": cidade, "cep": cep, "geoStatus": "pendente" if cep else "sem_cep",
        "peso": _arred2(peso), "itens": itens, "urgente": bool(d.get("urgente")),
        "agendado": bool(data), "dataAgendada": data, "horaEntrega": hi, "horaFim": hf,
        "status": "pendente",
    }


# ── Gravar o que chegou ───────────────────────────────────────────────────────

def _chave_de(pid: str, p: dict) -> str:
    if isinstance(p, dict) and p.get("chave"):
        return str(p["chave"])
    m = re.fullmatch(r"(?:C_)?(\d{44})", pid or "")
    return m.group(1) if m else ""


def _id_log(agora_ms: int) -> str:
    return f"{agora_ms:013d}-{secrets.token_hex(3)}"


def receber(banco: Banco, eid: str, pedidos: list, cancelamentos: list, origem: str,
            arquivos: int = 0, erros: list | None = None, sem_peso: int = 0,
            agora_ms: int | None = None) -> dict:
    """Grava pedidos novos e aplica cancelamentos em empresas/<eid>. Devolve o resumo."""
    agora_ms = agora_ms or int(time.time() * 1000)
    erros = list(erros or [])
    if len(pedidos) > MAX_PEDIDOS_POR_ENVIO:
        erros.append(f"{len(pedidos) - MAX_PEDIDOS_POR_ENVIO} pedidos acima do limite de "
                     f"{MAX_PEDIDOS_POR_ENVIO} por envio ficaram de fora")
        pedidos = pedidos[:MAX_PEDIDOS_POR_ENVIO]
    atuais = banco.ler(f"empresas/{eid}/pedidos_rota") or {}
    if not isinstance(atuais, dict):
        atuais = {}
    upd: dict = {}
    novos, existiam = [], []
    for p in pedidos:
        pid = p["id"]
        if pid in atuais or pid in upd:
            existiam.append(p["nf"])
            continue
        reg = {k: v for k, v in p.items() if k != "id"}
        reg["origem"] = origem
        reg["criadoEm"] = agora_ms
        upd[pid] = reg
        novos.append(p["nf"])
    cancelados, canc_em_rota, canc_fora = [], [], []
    for ch in cancelamentos:
        achou = False
        for pid, p in list(atuais.items()) + [(k, v) for k, v in upd.items() if v]:
            if _chave_de(pid, p) != ch:
                continue
            achou = True
            st = (p or {}).get("status") or "pendente"
            nf = str((p or {}).get("nf") or pid)
            if st == "pendente":
                upd[pid] = None
                if nf in novos:
                    novos.remove(nf)
                cancelados.append(nf)
            else:
                canc_em_rota.append(nf)
        if not achou:
            canc_fora.append(ch)
    banco.atualizar(f"empresas/{eid}/pedidos_rota", upd)
    resumo = {
        "em": agora_ms, "origem": origem, "arquivos": arquivos,
        "novos": len(novos), "nfs_novas": novos[:40],
        "ja_existiam": len(existiam), "nfs_existentes": existiam[:20],
        "cancelados": cancelados[:40], "cancelados_em_rota": canc_em_rota[:40],
        "cancelamentos_fora": len(canc_fora), "sem_peso": sem_peso, "erros": erros[:15],
    }
    _registrar(banco, eid, resumo, agora_ms)
    return resumo


def _registrar(banco: Banco, eid: str, resumo: dict, agora_ms: int) -> None:
    try:
        banco.atualizar(f"empresas/{eid}/entrada_log", {_id_log(agora_ms): resumo})
        chaves = banco.ler(f"empresas/{eid}/entrada_log", shallow="true") or {}
        velhas = sorted(chaves)[:-MAX_LOG] if len(chaves) > MAX_LOG else []
        if velhas:
            banco.atualizar(f"empresas/{eid}/entrada_log", {k: None for k in velhas})
    except ErroBanco as e:
        logger.warning("registro de entrada falhou (%s): %s", eid, e)


def ultimos_recebimentos(banco: Banco, eid: str, n: int = 8) -> list:
    dados = banco.ler(f"empresas/{eid}/entrada_log", orderBy='"$key"', limitToLast=n) or {}
    return [dados[k] for k in sorted(dados, reverse=True)] if isinstance(dados, dict) else []


# ── Credenciais por empresa ──────────────────────────────────────────────────

_ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789"   # sem letras e números parecidos


def hash_chave(chave: str) -> str:
    return hashlib.sha256(chave.encode("utf-8")).hexdigest()


def gerar_chave(banco: Banco, eid: str, agora_ms: int | None = None) -> str:
    agora_ms = agora_ms or int(time.time() * 1000)
    atual = banco.ler(f"empresas/{eid}/config/integracao") or {}
    chave = "rv3_" + secrets.token_urlsafe(30)
    h = hash_chave(chave)
    upd = {
        f"integracao_chaves/{h}": {"eid": eid, "em": agora_ms},
        f"empresas/{eid}/config/integracao/chave_hash": h,
        f"empresas/{eid}/config/integracao/chave_inicio": chave[:10],
        f"empresas/{eid}/config/integracao/chave_em": agora_ms,
    }
    if isinstance(atual, dict) and atual.get("chave_hash") and atual["chave_hash"] != h:
        upd[f"integracao_chaves/{atual['chave_hash']}"] = None
    banco.atualizar("", upd)
    return chave


def gerar_codigo_email(banco: Banco, eid: str, agora_ms: int | None = None) -> str:
    agora_ms = agora_ms or int(time.time() * 1000)
    atual = banco.ler(f"empresas/{eid}/config/integracao") or {}
    codigo = "".join(secrets.choice(_ALFABETO) for _ in range(10))
    upd = {
        f"integracao_email/{codigo}": {"eid": eid, "em": agora_ms},
        f"empresas/{eid}/config/integracao/email_codigo": codigo,
        f"empresas/{eid}/config/integracao/email_em": agora_ms,
    }
    if isinstance(atual, dict) and atual.get("email_codigo") and atual["email_codigo"] != codigo:
        upd[f"integracao_email/{atual['email_codigo']}"] = None
    banco.atualizar("", upd)
    return codigo


def eid_da_chave(banco: Banco, chave: str) -> str | None:
    if not re.fullmatch(r"rv3_[A-Za-z0-9_-]{20,80}", chave or ""):
        return None
    reg = banco.ler(f"integracao_chaves/{hash_chave(chave)}")
    return reg.get("eid") if isinstance(reg, dict) else None


def eid_do_codigo(banco: Banco, codigo: str) -> str | None:
    if not re.fullmatch(r"[a-z0-9]{6,20}", codigo or ""):
        return None
    reg = banco.ler(f"integracao_email/{codigo}")
    return reg.get("eid") if isinstance(reg, dict) else None


def eid_do_usuario(banco: Banco, uid: str, admin_uid: str, principal: str) -> str | None:
    if uid == admin_uid:
        return principal
    m = banco.ler(f"membros/{uid}")
    return m if isinstance(m, str) and m else None


def enderecos_email(usuario: str, codigo: str) -> dict:
    """caixa+código@... (entregas) e caixa+código-coleta@... (coletas)."""
    if not usuario or "@" not in usuario or not codigo:
        return {}
    local, dominio = usuario.split("@", 1)
    return {"entregas": f"{local}+{codigo}@{dominio}", "coletas": f"{local}+{codigo}-coleta@{dominio}"}


# ── Limite de uso por empresa (em memória) ────────────────────────────────────

_uso: dict[str, list[float]] = {}
_trava = threading.Lock()


def limitar(eid: str, maximo: int = 600, janela_s: int = 3600) -> bool:
    """True se ainda pode; False se passou de `maximo` envios na última hora."""
    agora = time.time()
    with _trava:
        lst = [t for t in _uso.get(eid, []) if agora - t < janela_s]
        if len(lst) >= maximo:
            _uso[eid] = lst
            return False
        lst.append(agora)
        _uso[eid] = lst
        return True
