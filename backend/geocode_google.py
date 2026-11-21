"""Localização de endereço pela Geocoding API do Google.

A chave fica só aqui no servidor (variável GOOGLE_GEOCODING_KEY no Railway). O navegador
pergunta ao /geocode e recebe o ponto já conferido: só volta resultado com número da casa
("numero") ou, sem número, o meio da rua ("rua"). Bairro ou cidade não voltam: para isso o
sistema já tem o CEP.

Regras do Google que valem para o que sai daqui:
- o ponto só pode ser mostrado em mapa do Google (o sistema usa os blocos da Map Tiles API);
- latitude e longitude podem ficar guardadas por no máximo 30 dias (o navegador marca
  geoFonte='google' e geoEm, e procura de novo depois disso).

Limite de gasto: GOOGLE_GEOCODING_LIMITE_DIA consultas por dia neste servidor (padrão 1000).
Endereço repetido no mesmo dia não consulta de novo (memória do processo, nada em disco).
"""
from __future__ import annotations

import logging
import os
import time
import unicodedata

import requests

logger = logging.getLogger("geocode_google")

URL = "https://maps.googleapis.com/maps/api/geocode/json"
_CACHE: dict[str, tuple[float, dict | None]] = {}
_CACHE_SEG = 24 * 3600
_CACHE_MAX = 5000
_uso = {"dia": "", "n": 0}


def chave() -> str:
    return os.getenv("GOOGLE_GEOCODING_KEY", "").strip()


def configurado() -> bool:
    return bool(chave())


def _limite_dia() -> int:
    try:
        return max(0, int(os.getenv("GOOGLE_GEOCODING_LIMITE_DIA", "1000") or 1000))
    except ValueError:
        return 1000


def _sem_acento(t: str) -> str:
    t = unicodedata.normalize("NFD", str(t or "")).encode("ascii", "ignore").decode()
    return " ".join(t.upper().split())


def _texto_endereco(d: dict) -> str:
    rua = (d.get("rua") or "").strip()
    numero = (d.get("numero") or "").strip()
    end = f"{rua}, {numero}" if rua and numero else (rua or (d.get("endereco") or "").strip())
    partes = [end, d.get("bairro") or "", d.get("cidade") or ""]
    uf = (d.get("uf") or "").strip().upper()
    if uf:
        partes.append(uf)
    cep = "".join(c for c in str(d.get("cep") or "") if c.isdigit())
    if len(cep) == 8:
        partes.append(f"{cep[:5]}-{cep[5:]}")
    partes.append("Brasil")
    return ", ".join(p.strip() for p in partes if p and p.strip())


def _componente(comps: list, tipo: str, curto: bool = False) -> str:
    for c in comps or []:
        if tipo in (c.get("types") or []):
            return c.get("short_name" if curto else "long_name") or ""
    return ""


def interpretar(res: dict, pedido: dict) -> dict | None:
    """Primeiro resultado do Google → ponto conferido, ou None se não serve."""
    if not res:
        return None
    geo = res.get("geometry") or {}
    loc = geo.get("location") or {}
    tipo = geo.get("location_type") or ""
    comps = res.get("address_components") or []
    numero = _componente(comps, "street_number")
    rua = _componente(comps, "route")
    cidade = _componente(comps, "administrative_area_level_2") or _componente(comps, "locality")
    uf = _componente(comps, "administrative_area_level_1", curto=True)
    bairro = _componente(comps, "sublocality_level_1") or _componente(comps, "sublocality")
    cep = _componente(comps, "postal_code").replace("-", "")
    try:
        lat, lng = float(loc["lat"]), float(loc["lng"])
    except (KeyError, TypeError, ValueError):
        return None
    # mesma cidade (e mesmo estado, quando o pedido tem) — senão é outro lugar com o mesmo nome
    cid_ped = _sem_acento(pedido.get("cidade") or "")
    if cid_ped and _sem_acento(cidade) != cid_ped:
        return None
    uf_ped = (pedido.get("uf") or "").strip().upper()
    if uf_ped and uf and uf.upper() != uf_ped:
        return None
    num_ped = "".join(c for c in str(pedido.get("numero") or "") if c.isdigit())
    num_g = "".join(c for c in numero if c.isdigit())
    if num_g and num_ped and num_g == num_ped and tipo in ("ROOFTOP", "RANGE_INTERPOLATED"):
        prec = "numero"
    elif rua and tipo in ("ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER") and not num_g:
        prec = "rua"
    else:
        return None
    return {"lat": lat, "lng": lng, "prec": prec, "tipo": tipo, "rua": rua, "numero": numero,
            "bairro": bairro, "cidade": cidade, "uf": uf, "cep": cep}


def geocodificar(pedido: dict) -> dict | None:
    """Consulta o Google (com limite por dia e memória de 24 h por endereço)."""
    k = chave()
    if not k:
        return None
    texto = _texto_endereco(pedido)
    if not texto or not (pedido.get("rua") or pedido.get("endereco")):
        return None
    agora = time.time()
    memo = _CACHE.get(texto)
    if memo and agora - memo[0] < _CACHE_SEG:
        return memo[1]
    hoje = time.strftime("%Y-%m-%d")
    if _uso["dia"] != hoje:
        _uso["dia"], _uso["n"] = hoje, 0
    if _uso["n"] >= _limite_dia():
        logger.warning("geocode: limite do dia atingido (%s)", _uso["n"])
        return None
    _uso["n"] += 1
    try:
        r = requests.get(URL, params={"address": texto, "components": "country:BR", "region": "br",
                                      "language": "pt-BR", "key": k}, timeout=8)
        dados = r.json()
    except Exception as e:  # rede, JSON
        logger.warning("geocode: falha na consulta: %s", e)
        return None
    status = dados.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        # REQUEST_DENIED / OVER_QUERY_LIMIT: chave errada, API desativada ou cota
        logger.warning("geocode: Google respondeu %s: %s", status, dados.get("error_message", ""))
        return None
    resultado = interpretar((dados.get("results") or [None])[0], pedido) if status == "OK" else None
    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.clear()
    _CACHE[texto] = (agora, resultado)
    return resultado
