"""Km rodado pelo rastro do GPS do celular do motorista.

O celular manda pontos {lat, lng, t (ms), acc (m)} enquanto a página do motorista
está aberta com a localização ligada. Somar a distância ponto a ponto infla o km
(o GPS "treme" alguns metros) e os buracos (tela apagada, Waze na frente) somem.
Por isso:

1. limpa: descarta ponto com precisão pior que PRECISAO_MAX_M, coordenada inválida,
   ponto repetido e salto impossível (mais rápido que VEL_MAX_MS);
2. divide em trechos onde o sinal sumiu (mais de LACUNA_S segundos ou LACUNA_M metros
   entre dois pontos seguidos);
3. casa cada trecho com as ruas no OSRM /match (o mesmo servidor do motor de rotas) e
   soma a distância casada = km MEDIDO. O /match devolve vários pedaços quando o veículo
   fica parado (entrega) ou o GPS falha; o espaço entre um pedaço e o seguinte é somado
   também (até 200 m conta como medido, acima disso como estimado);
4. nas lacunas, liga o fim de um trecho ao começo do seguinte pelo /route = km ESTIMADO.

O raio mandado ao /match é o desvio padrão do erro do GPS. O navegador informa a precisão
como o raio de 95% de confiança, então o desvio é cerca de metade dela (W3C Geolocation;
documentação HTTP do OSRM). Pedaço casado muito mais longo que o caminho dos próprios
pontos (mais de 1,5 vez + 500 m) é volta inventada pelo casamento: entra como estimado,
pelo caminho dos pontos.

A resposta separa medido e estimado, e a cobertura (medido ÷ total) diz quanto do km
veio do GPS de verdade. Sem servidor de rotas, soma em linha reta e avisa.
"""
from __future__ import annotations

import logging
import math

import requests

import vrp_solver as vs

logger = logging.getLogger(__name__)

PRECISAO_MAX_M = 50          # ponto com precisão pior que isso é descartado
VEL_MAX_MS = 45.0            # ~160 km/h: mais rápido que isso é salto do GPS
REPETIDO_M = 15              # parado: ponto a menos de 15 m do anterior só faz zigue-zague
LACUNA_S = 180               # 3 min sem ponto = sinal sumiu
LACUNA_M = 3000              # 3 km entre dois pontos seguidos = sinal sumiu
MATCH_MAX = 100              # pontos por consulta ao /match (o servidor público aceita 100)
MAX_PONTOS = 6000            # um dia inteiro a cada 20 s dá ~1.500; acima disso é erro
RAIO_MIN_M, RAIO_MAX_M = 5, 25   # raio do /match = precisão ÷ 2, dentro desses limites
EMENDA_MEDIDA_M = 200        # espaço entre dois pedaços casados: até isso conta como medido
EMENDA_ROTA_M = 300          # acima disso, o espaço é medido pelo /route (senão, em linha reta)
VOLTA_FALSA = (1.5, 500)     # pedaço casado > 1,5 × caminho dos pontos + 500 m = volta inventada

OSRM_MATCH_URL = vs.OSRM_URL.replace("/table/", "/match/")
OSRM_ROUTE_URL = vs.OSRM_ROUTE_URL


def _m(a: dict, b: dict) -> float:
    return vs._haversine_m(a, b)


def limpar(pontos: list[dict]) -> tuple[list[dict], int]:
    """Pontos válidos em ordem de tempo, e quantos foram descartados."""
    bons = []
    for p in pontos or []:
        try:
            lat, lng, t = float(p["lat"]), float(p["lng"]), float(p["t"])
            acc = float(p.get("acc") if p.get("acc") is not None else PRECISAO_MAX_M)
        except (KeyError, TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180) or not math.isfinite(t) or acc > PRECISAO_MAX_M:
            continue
        bons.append({"lat": lat, "lng": lng, "t": t, "acc": max(acc, 0.0)})
    bons.sort(key=lambda p: p["t"])
    saida: list[dict] = []
    for p in bons:
        if saida:
            ant = saida[-1]
            dt = (p["t"] - ant["t"]) / 1000
            d = _m(ant, p)
            if dt <= 0 or d < REPETIDO_M:
                continue
            if d / dt > VEL_MAX_MS:
                continue
        saida.append(p)
    return saida, len(pontos or []) - len(saida)


def trechos(pontos: list[dict]) -> list[list[dict]]:
    """Divide onde o sinal sumiu."""
    grupos: list[list[dict]] = []
    for p in pontos:
        if grupos:
            ant = grupos[-1][-1]
            if (p["t"] - ant["t"]) / 1000 > LACUNA_S or _m(ant, p) > LACUNA_M:
                grupos.append([p])
                continue
            grupos[-1].append(p)
        else:
            grupos.append([p])
    return grupos


def raio(acc: float) -> int:
    """Desvio padrão para o /match a partir da precisão de 95% do navegador."""
    return int(min(RAIO_MAX_M, max(RAIO_MIN_M, round(acc / 2))))


def _caminho(pts: list[dict]) -> float:
    return sum(_m(a, b) for a, b in zip(pts, pts[1:]))


def _espaco(a: dict, b: dict) -> tuple[float, float]:
    """(medido, estimado) entre dois pontos de um mesmo trecho que o /match separou."""
    d = _m(a, b)
    if d <= EMENDA_MEDIDA_M:
        return d, 0.0
    if d > EMENDA_ROTA_M:
        try:
            return 0.0, _ligar(a, b)
        except Exception as exc:
            logger.warning("Emenda sem servidor de rotas (%s): em linha reta", exc)
    return 0.0, d


def _casar(bloco: list[dict]) -> tuple[float, float]:
    """(medido, estimado) em metros para um bloco de até MATCH_MAX pontos."""
    coords = ";".join(f"{p['lng']:.6f},{p['lat']:.6f}" for p in bloco)
    ts = ";".join(str(int(p["t"] // 1000)) for p in bloco)
    raios = ";".join(str(raio(p["acc"])) for p in bloco)
    vs._esperar_vez(OSRM_MATCH_URL)
    r = requests.get(
        f"{OSRM_MATCH_URL}/{coords}",
        params={"timestamps": ts, "radiuses": raios, "overview": "false",
                "gaps": "split", "tidy": "true", "steps": "false"},
        headers=vs.OSRM_HEADERS, timeout=vs.OSRM_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok":
        raise ValueError(f"OSRM match: {data.get('code')}")
    matchings = data.get("matchings") or []
    tps = data.get("tracepoints") or []
    # pontos de cada pedaço, na ordem do traço (tracepoint nulo = ponto descartado pelo /match)
    pedacos: dict[int, list[int]] = {}
    for i, tp in enumerate(tps[:len(bloco)]):
        if tp and isinstance(tp.get("matchings_index"), int):
            pedacos.setdefault(tp["matchings_index"], []).append(i)
    if not pedacos:
        raise ValueError("OSRM match: nenhum ponto casado")
    medido = estimado = 0.0
    ordem = sorted(pedacos, key=lambda k: pedacos[k][0])
    for k in ordem:
        idx = pedacos[k]
        d = float((matchings[k] if k < len(matchings) else {}).get("distance") or 0)
        proprio = _caminho([bloco[i] for i in idx])
        if d > VOLTA_FALSA[0] * proprio + VOLTA_FALSA[1]:
            logger.info("Pedaço casado com volta inventada (%.0f m contra %.0f m): estimado", d, proprio)
            estimado += proprio
        else:
            medido += d
    # espaço antes do primeiro pedaço, entre os pedaços e depois do último
    marcos = [(pedacos[k][0], pedacos[k][-1]) for k in ordem]
    juntas = [(0, marcos[0][0])] + [(a[1], b[0]) for a, b in zip(marcos, marcos[1:])] + [(marcos[-1][1], len(bloco) - 1)]
    for i, j in juntas:
        if j > i:
            m_, e_ = _espaco(bloco[i], bloco[j])
            medido += m_
            estimado += e_
    return medido, estimado


def _ligar(a: dict, b: dict) -> float:
    """Metros pelas ruas entre o fim de um trecho e o começo do outro (estimado)."""
    vs._esperar_vez(OSRM_ROUTE_URL)
    r = requests.get(
        f"{OSRM_ROUTE_URL}/{a['lng']:.6f},{a['lat']:.6f};{b['lng']:.6f},{b['lat']:.6f}",
        params={"overview": "false", "steps": "false"},
        headers=vs.OSRM_HEADERS, timeout=vs.OSRM_TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ValueError(f"OSRM route: {data.get('code')}")
    return float(data["routes"][0].get("distance") or 0)


def calcular(pontos: list[dict]) -> dict:
    if len(pontos or []) > MAX_PONTOS:
        raise ValueError(f"No máximo {MAX_PONTOS} pontos por rota.")
    limpos, descartados = limpar(pontos)
    grupos = trechos(limpos)
    medido = estimado = 0.0
    casado = True
    usados = 0
    for g in grupos:
        if len(g) < 2:
            continue
        usados += len(g)
        # blocos de MATCH_MAX pontos, repetindo o ponto de emenda
        ini = 0
        while ini < len(g) - 1:
            bloco = g[ini:ini + MATCH_MAX]
            try:
                m_, e_ = _casar(bloco)
                medido += m_
                estimado += e_
            except Exception as exc:
                logger.warning("Map matching indisponível (%s): somando em linha reta", exc)
                casado = False
                medido += sum(_m(a, b) for a, b in zip(bloco, bloco[1:]))
            ini += MATCH_MAX - 1
    for a, b in zip(grupos, grupos[1:]):
        try:
            estimado += _ligar(a[-1], b[0])
        except Exception as exc:
            logger.warning("Ligação entre trechos sem servidor de rotas (%s)", exc)
            casado = False
            estimado += _m(a[-1], b[0])
    total = medido + estimado
    return {
        "km_total": round(total / 1000, 1),
        "km_medido": round(medido / 1000, 1),
        "km_estimado": round(estimado / 1000, 1),
        "cobertura": round(medido / total, 2) if total > 0 else 0.0,
        "pontos_usados": usados,
        "pontos_descartados": descartados,
        "trechos": sum(1 for g in grupos if len(g) >= 2),
        "casado": casado,
        "inicio": limpos[0]["t"] if limpos else None,
        "fim": limpos[-1]["t"] if limpos else None,
    }
