"""
entrada_email.py — Lê a caixa de e-mail de entrada e importa os XML das notas
------------------------------------------------------------------------------
Uma caixa Gmail só para receber (ex.: pedidos.rotav3@gmail.com). Cada empresa tem
um endereço com código próprio, que o Gmail entrega na mesma caixa:
    pedidos.rotav3+<código>@gmail.com          -> entregas
    pedidos.rotav3+<código>-coleta@gmail.com   -> coletas
O servidor lê a caixa a cada minuto (IMAP com "senha de app" do Google), pega os
anexos .xml (e .xml dentro de .zip) e grava pelo entrada.receber().

Variáveis de ambiente (Railway):
  ENTRADA_EMAIL_USUARIO   endereço da caixa (ex.: pedidos.rotav3@gmail.com)
  ENTRADA_EMAIL_SENHA     senha de app de 16 letras (Conta Google > Segurança > Senhas de app)
  ENTRADA_EMAIL_IMAP      servidor IMAP (padrão imap.gmail.com)
  ENTRADA_EMAIL_INTERVALO segundos entre leituras (padrão 60)
"""
from __future__ import annotations

import email
import imaplib
import io
import logging
import re
import threading
import time
import zipfile
from email import policy

import entrada

logger = logging.getLogger(__name__)

MAX_ANEXO = 5 * 1024 * 1024        # 5 MB por XML
MAX_XML_POR_EMAIL = 200
MAX_MSGS_POR_LEITURA = 50
DOMINIOS_GMAIL = {"gmail.com", "googlemail.com"}

estado = {"ligado": False, "ultima_leitura": None, "ultimo_erro": None}


def codigo_do_destino(msg, usuario: str) -> str | None:
    """Acha o +código do endereço da caixa nos cabeçalhos (Delivered-To primeiro,
    porque é o que fica quando o e-mail foi encaminhado)."""
    if "@" not in (usuario or ""):
        return None
    local, dominio = usuario.lower().split("@", 1)
    gmail = dominio in DOMINIOS_GMAIL
    base = local.replace(".", "") if gmail else local
    padrao = re.compile(r"([a-z0-9._%-]+)\+([a-z0-9-]+)@([a-z0-9.-]+)", re.I)
    for cab in ("Delivered-To", "X-Original-To", "To", "Cc"):
        for valor in msg.get_all(cab, []) or []:
            for m in padrao.finditer(str(valor)):
                loc, dom = m.group(1).lower(), m.group(3).lower()
                if gmail:
                    ok = loc.replace(".", "") == base and dom in DOMINIOS_GMAIL
                else:
                    ok = loc == base and dom == dominio
                if ok:
                    return m.group(2).lower()
    return None


def anexos_xml(msg) -> tuple[list[tuple[str, bytes]], list[str]]:
    """(nome, conteúdo) de cada .xml anexado, inclusive dentro de .zip; e avisos."""
    achados: list[tuple[str, bytes]] = []
    avisos: list[str] = []
    for parte in msg.walk():
        if parte.is_multipart():
            continue
        nome = parte.get_filename() or ""
        tipo = parte.get_content_type()
        eh_xml = nome.lower().endswith(".xml") or tipo in ("application/xml", "text/xml")
        eh_zip = nome.lower().endswith(".zip") or tipo in ("application/zip", "application/x-zip-compressed")
        if not (eh_xml or eh_zip):
            continue
        dados = parte.get_payload(decode=True) or b""
        if eh_xml:
            if len(dados) > MAX_ANEXO:
                avisos.append(f"{nome or 'anexo'}: maior que 5 MB, não lido")
                continue
            achados.append((nome or "anexo.xml", dados))
        else:
            try:
                with zipfile.ZipFile(io.BytesIO(dados)) as zf:
                    for info in zf.infolist():
                        if info.is_dir() or not info.filename.lower().endswith(".xml"):
                            continue
                        if info.file_size > MAX_ANEXO:
                            avisos.append(f"{info.filename}: maior que 5 MB, não lido")
                            continue
                        if len(achados) >= MAX_XML_POR_EMAIL:
                            break
                        achados.append((info.filename.rsplit("/", 1)[-1], zf.read(info)))
            except zipfile.BadZipFile:
                avisos.append(f"{nome or 'anexo.zip'}: arquivo .zip corrompido")
        if len(achados) >= MAX_XML_POR_EMAIL:
            avisos.append(f"mais de {MAX_XML_POR_EMAIL} XML no e-mail: o resto ficou de fora")
            break
    return achados[:MAX_XML_POR_EMAIL], avisos


def processar_mensagem(bruto: bytes, usuario: str, banco: entrada.Banco) -> dict | None:
    """Importa um e-mail. Devolve o resumo gravado, ou None se o e-mail não é de
    nenhuma empresa. Levanta entrada.ErroBanco se o banco falhar (tentar de novo)."""
    msg = email.message_from_bytes(bruto, policy=policy.default)
    codigo = codigo_do_destino(msg, usuario)
    if not codigo:
        logger.info("e-mail sem código de empresa no endereço: ignorado")
        return None
    tipo = "entrega"
    if codigo.endswith("-coleta"):
        codigo, tipo = codigo[: -len("-coleta")], "coleta"
    eid = entrada.eid_do_codigo(banco, codigo)
    if not eid:
        logger.info("e-mail para código desconhecido: ignorado")
        return None
    arquivos, erros = anexos_xml(msg)
    pedidos, canc, sem_peso = [], [], 0
    for nome, dados in arquivos:
        try:
            r = entrada.ler_xml_nfe(dados, tipo)
        except ValueError as e:
            erros.append(f"{nome}: {e}")
            continue
        pedidos += r["pedidos"]
        sem_peso += r["sem_peso"]
        canc += [c for c in r["cancelamentos"] if c not in canc]
    if not arquivos and not erros:
        erros.append("e-mail sem anexo XML")
    return entrada.receber(banco, eid, pedidos, canc, "email", arquivos=len(arquivos),
                           erros=erros, sem_peso=sem_peso)


def conectar_imap(usuario: str, senha: str, servidor: str = "imap.gmail.com"):
    im = imaplib.IMAP4_SSL(servidor, 993, timeout=30)
    im.login(usuario, senha)
    im.select("INBOX")
    return im


def processar_caixa(conectar, usuario: str, banco: entrada.Banco) -> int:
    """Lê os e-mails não lidos. Só marca como lido o que foi processado (ou
    ignorado); se o banco falhar, o e-mail fica para a próxima leitura."""
    im = conectar()
    feitos = 0
    try:
        typ, dados = im.search(None, "UNSEEN")
        if typ != "OK":
            return 0
        for num in (dados[0] or b"").split()[:MAX_MSGS_POR_LEITURA]:
            typ, partes = im.fetch(num, "(BODY.PEEK[])")
            bruto = next((p[1] for p in partes if isinstance(p, tuple) and len(p) > 1), None)
            if typ != "OK" or bruto is None:
                continue
            try:
                processar_mensagem(bruto, usuario, banco)
            except entrada.ErroBanco as e:
                logger.warning("banco indisponível, e-mail fica para depois: %s", e)
                break
            except Exception:
                logger.exception("e-mail com problema: marcado como lido para não travar a fila")
            im.store(num, "+FLAGS", "\\Seen")
            feitos += 1
    finally:
        try:
            im.logout()
        except Exception:
            pass
    return feitos


def iniciar(usuario: str, senha: str, servidor: str, banco: entrada.Banco, intervalo: int = 60) -> bool:
    """Liga a leitura em segundo plano (uma linha de execução). False se faltar configuração."""
    if not (usuario and senha and banco.ligado()):
        return False

    def laco():
        while True:
            try:
                processar_caixa(lambda: conectar_imap(usuario, senha, servidor), usuario, banco)
                estado["ultima_leitura"] = int(time.time() * 1000)
                estado["ultimo_erro"] = None
            except Exception as e:      # senha errada, IMAP fora do ar...
                estado["ultimo_erro"] = type(e).__name__
                logger.warning("leitura da caixa de entrada falhou: %s", e)
            time.sleep(max(20, intervalo))

    threading.Thread(target=laco, name="entrada-email", daemon=True).start()
    estado["ligado"] = True
    return True
