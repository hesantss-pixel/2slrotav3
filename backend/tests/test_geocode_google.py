"""Geocoding do Google: interpretação do resultado, limites e o /geocode (sem rede)."""
import os

import pytest
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import geocode_google as gg  # noqa: E402


def _res(tipo="ROOFTOP", numero="123", rua="Rua Belo Horizonte", cidade="São Paulo", uf="SP"):
    comps = [{"long_name": rua, "short_name": rua, "types": ["route"]},
             {"long_name": "Brás", "short_name": "Brás", "types": ["sublocality_level_1", "sublocality"]},
             {"long_name": cidade, "short_name": cidade, "types": ["administrative_area_level_2"]},
             {"long_name": "São Paulo", "short_name": uf, "types": ["administrative_area_level_1"]},
             {"long_name": "03004-000", "short_name": "03004-000", "types": ["postal_code"]}]
    if numero:
        comps.insert(0, {"long_name": numero, "short_name": numero, "types": ["street_number"]})
    return {"geometry": {"location": {"lat": -23.54, "lng": -46.61}, "location_type": tipo}, "address_components": comps}


PED = {"rua": "Rua Belo Horizonte", "numero": "123", "bairro": "Brás", "cidade": "São Paulo", "uf": "SP", "cep": "03004000"}


def test_numero_exato():
    r = gg.interpretar(_res(), PED)
    assert r["prec"] == "numero" and r["lat"] == -23.54 and r["bairro"] == "Brás" and r["cep"] == "03004000"


def test_numero_interpolado_tambem_vale():
    assert gg.interpretar(_res(tipo="RANGE_INTERPOLATED"), PED)["prec"] == "numero"


def test_outra_cidade_nao_serve():
    assert gg.interpretar(_res(cidade="Mairiporã"), PED) is None


def test_outro_numero_nao_serve():
    assert gg.interpretar(_res(numero="999"), PED) is None


def test_so_a_rua():
    r = gg.interpretar(_res(tipo="GEOMETRIC_CENTER", numero=""), {**PED, "numero": ""})
    assert r["prec"] == "rua"


def test_so_bairro_ou_cidade_nao_volta():
    assert gg.interpretar(_res(tipo="APPROXIMATE", numero="", rua=""), PED) is None


def test_texto_do_endereco():
    assert gg._texto_endereco(PED) == "Rua Belo Horizonte, 123, Brás, São Paulo, SP, 03004-000, Brasil"


class _Resp:
    def __init__(self, dados):
        self.dados = dados

    def json(self):
        return self.dados


def test_consulta_memoria_e_limite(monkeypatch):
    chamadas = []

    def falso_get(url, params=None, timeout=None):
        chamadas.append(params)
        return _Resp({"status": "OK", "results": [_res()]})

    monkeypatch.setenv("GOOGLE_GEOCODING_KEY", "x")
    monkeypatch.setenv("GOOGLE_GEOCODING_LIMITE_DIA", "2")
    monkeypatch.setattr(gg.requests, "get", falso_get)
    gg._CACHE.clear(); gg._uso.update(dia="", n=0)
    assert gg.geocodificar(PED)["prec"] == "numero"
    assert gg.geocodificar(PED)["prec"] == "numero"          # mesmo endereço: memória
    assert len(chamadas) == 1
    assert chamadas[0]["components"] == "country:BR" and chamadas[0]["language"] == "pt-BR"
    gg.geocodificar({**PED, "numero": "125"})
    with pytest.raises(gg.GoogleIndisponivel):              # passou do limite do dia: não é "não achou"
        gg.geocodificar({**PED, "numero": "127"})
    assert len(chamadas) == 2


def test_sem_chave_nao_consulta(monkeypatch):
    monkeypatch.delenv("GOOGLE_GEOCODING_KEY", raising=False)
    monkeypatch.setattr(gg.requests, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("consultou")))
    assert gg.configurado() is False and gg.geocodificar(PED) is None


def test_chave_recusada_nao_quebra(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEOCODING_KEY", "x")
    monkeypatch.setattr(gg.requests, "get", lambda *a, **k: _Resp({"status": "REQUEST_DENIED", "error_message": "API desativada"}))
    gg._CACHE.clear(); gg._uso.update(dia="", n=0); gg._ultimo["erro"] = ""
    with pytest.raises(gg.GoogleIndisponivel):              # recusa não vira "não achou"
        gg.geocodificar(PED)
    assert gg.estado() == "recusada pelo Google (REQUEST_DENIED)"
    assert "x" not in gg.estado().replace("recusada", "")     # nunca mostra a chave
    # o primeiro acerto apaga a recusa
    monkeypatch.setattr(gg.requests, "get", lambda *a, **k: _Resp({"status": "ZERO_RESULTS", "results": []}))
    assert gg.geocodificar({**PED, "numero": "999"}) is None and gg.estado() == "ligada"


def test_sem_resposta_nao_vira_nao_achou(monkeypatch):
    monkeypatch.setenv("GOOGLE_GEOCODING_KEY", "x")
    def cai(*a, **k):
        raise gg.requests.ConnectionError("sem rede")
    monkeypatch.setattr(gg.requests, "get", cai)
    gg._CACHE.clear(); gg._uso.update(dia="", n=0)
    with pytest.raises(gg.GoogleIndisponivel):
        gg.geocodificar(PED)
