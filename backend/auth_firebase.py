"""
auth_firebase.py — confere o login (Firebase Authentication) em cada chamada.

Como funciona
-------------
A tela manda o token do usuário no cabeçalho `Authorization: Bearer <token>`.
O servidor pergunta ao próprio Firebase se esse token pode ler `acesso/<uid>`
(GET .../acesso/<uid>.json?auth=<token>):

  - token falso, vencido ou de outro projeto → o Firebase responde 401;
  - usuário sem liberação → o valor não é `true` (ou as regras negam: 403);
  - usuário liberado → `true`.

Assim uma única consulta confere a assinatura do token e a liberação do
usuário, sem precisar de chave secreta nem de bibliotecas extras. O resultado
fica guardado por alguns minutos para não consultar o Firebase a cada chamada.

Variáveis de ambiente
---------------------
FIREBASE_URL         URL do Realtime Database (padrão: projeto atual).
FIREBASE_PROJECT_ID  ID do projeto (padrão: slog-pedidos).
AUTH_REQUIRED        "0" desliga a conferência (só para testes locais).
"""

from __future__ import annotations

import base64
import json
import os
import time
import threading

import requests

FIREBASE_URL = os.getenv("FIREBASE_URL", "https://slog-pedidos-default-rtdb.firebaseio.com").rstrip("/")
PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "slog-pedidos")
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "1") != "0"
CACHE_SEGUNDOS = 300

_cache: dict[str, tuple[str, float]] = {}
_lock = threading.Lock()


class AuthError(Exception):
    def __init__(self, mensagem: str, status: int = 401):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status


def _claims_sem_verificar(token: str) -> dict:
    """Lê o conteúdo do token (sem conferir a assinatura — quem confere é o Firebase)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception as e:  # token malformado
        raise AuthError("Sessão inválida. Saia e entre de novo.") from e


def verificar(authorization: str | None) -> str:
    """Retorna o uid do usuário liberado ou levanta AuthError."""
    if not AUTH_REQUIRED:
        return "teste-local"
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("Faça login para usar o sistema.")
    token = authorization[7:].strip()
    if not token:
        raise AuthError("Faça login para usar o sistema.")

    agora = time.time()
    with _lock:
        hit = _cache.get(token)
        if hit and hit[1] > agora:
            return hit[0]

    claims = _claims_sem_verificar(token)
    uid = claims.get("user_id") or claims.get("sub")
    if not uid or claims.get("aud") != PROJECT_ID or claims.get("iss") != f"https://securetoken.google.com/{PROJECT_ID}":
        raise AuthError("Sessão inválida. Saia e entre de novo.")
    exp = float(claims.get("exp", 0))
    if exp <= agora:
        raise AuthError("Sua sessão expirou. Saia e entre de novo.")

    try:
        r = requests.get(f"{FIREBASE_URL}/acesso/{uid}.json", params={"auth": token}, timeout=6)
    except requests.RequestException as e:
        raise AuthError("Não foi possível conferir o login agora. Tente de novo.", 503) from e

    if r.status_code == 401:
        raise AuthError("Sessão inválida. Saia e entre de novo.")
    if r.status_code == 403:
        raise AuthError("Este usuário ainda não foi liberado.", 403)
    if not r.ok:
        raise AuthError("Não foi possível conferir o login agora. Tente de novo.", 503)
    try:
        liberado = r.json() is True
    except ValueError:
        liberado = False
    if not liberado:
        raise AuthError("Este usuário ainda não foi liberado.", 403)

    with _lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[token] = (uid, min(exp, agora + CACHE_SEGUNDOS))
    return uid
