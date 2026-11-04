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
        })
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
