# Gera os desenhos dos veículos (assets/veic/*.svg) a partir dos ícones da frota.
#
# Os ícones vieram num PDF (21/11/2026). Daqui usamos só o desenho dos três que servem para a
# roteirização, sem nomes, selos ou placas escritas:
#   fiorino.svg  ← "Fiorino Endurance" (furgão compacto)
#   vuc.svg      ← "Baú pequeno" (caminhão leve com baú curto)
#   tres4.svg    ← "Baú grande" (caminhão leve com baú comprido)
# Truck toco, bitruck e carreta são montados com as mesmas peças (cabine, baú e rodas do
# "Baú grande"), para a frota inteira ficar no mesmo estilo.
#
# Todos têm a mesma altura e a mesma escala; o comprimento cresce do Fiorino à carreta.
#
# Uso:  python3 gerar.py ARQUIVO.pdf      (precisa do pdftocairo, do poppler)
#       python3 gerar.py                  (usa os SVG já extraídos nesta pasta)
import os
import re
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.dirname(AQUI)
PAGINAS = {'fiorino': 4, 'bau-pequeno': 6, 'bau-grande': 7}


# ---------- leitura dos ícones ----------
def extrair_do_pdf(pdf):
    for nome, pag in PAGINAS.items():
        destino = os.path.join(AQUI, nome + '.svg')
        subprocess.run(['pdftocairo', '-svg', '-f', str(pag), '-l', str(pag), pdf, destino], check=True)


def elementos(nome):
    """Peças do desenho do veículo, na ordem em que são pintadas, sem fundo, textos e placa."""
    s = open(os.path.join(AQUI, nome + '.svg'), encoding='utf-8').read()
    corpo = s[s.index('</defs>') + 7:]
    els = re.findall(r'<(?:path|rect)[^>]*?/>|<g [^>]*>.*?</g>', corpo, re.S)
    pecas = []
    for i, e in enumerate(els):
        if i < 7 or '<use' in e:               # fundo, círculo, títulos, selo, sombra; textos
            continue
        d = re.search(r' d="([^"]*)"', e)
        if not d:
            continue
        x0, y0, x1, y1 = caixa(d.group(1))
        if y0 >= 600:                         # cartão de baixo, com o nome
            continue
        if 'fill="rgb(21.568298%, 25.489807%, 31.764221%)"' in e and (x1 - x0) < 70 and (y1 - y0) < 30:
            continue                           # plaquinha da porta, onde ia o número
        pecas.append({'i': i, 'e': e.strip()})
    return pecas


def numeros(d):
    return [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', d)]


def caixa(d):
    n = numeros(d)
    xs, ys = n[0::2], n[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def caixa_pecas(pecas):
    cs = [caixa(re.search(r' d="([^"]*)"', p['e']).group(1)) for p in pecas]
    return min(c[0] for c in cs), min(c[1] for c in cs), max(c[2] for c in cs), max(c[3] for c in cs)


def mover(p, fx, fy=None):
    """Aplica fx(x) (e fy(y), se houver) aos pontos do caminho (só M, L, C e Z absolutos)."""
    fy = fy or (lambda y: y)
    def troca(m):
        d = m.group(1)
        partes = re.split(r'(-?\d+(?:\.\d+)?)', d)
        out, k = [], 0
        for t in partes:
            if re.fullmatch(r'-?\d+(?:\.\d+)?', t):
                out.append(f'{fx(float(t)):.3f}' if k % 2 == 0 else f'{fy(float(t)):.3f}')
                k += 1
            else:
                out.append(t)
        return ' d="' + ''.join(out) + '"'
    return {'i': p['i'], 'e': re.sub(r' d="([^"]*)"', troca, p['e'])}


def desloca(pecas, dx):
    return [mover(p, lambda x: x + dx) for p in pecas]


def estica(pecas, x0, x1_antigo, x1_novo):
    k = (x1_novo - x0) / (x1_antigo - x0)
    return [mover(p, lambda x: x0 + (x - x0) * k) for p in pecas]


# ---------- montagem ----------
def faixa(pecas, a, b):
    return [p for p in pecas if a <= p['i'] <= b]


def montar():
    fio = elementos('fiorino')
    peq = elementos('bau-pequeno')
    gde = elementos('bau-grande')
    # peças do "Baú grande" (índices na ordem do PDF)
    chassi = faixa(gde, 7, 8)          # longarinas
    roda_f = faixa(gde, 9, 12)         # roda dianteira
    roda_t = faixa(gde, 13, 20)        # traseira, rodado duplo
    bau = faixa(gde, 21, 28)           # baú, frisos e refletor
    cabine = faixa(gde, 29, 60)        # cabine, vidros, faróis, porta
    BAU_X0, BAU_X1 = 359.0, 692.0
    CH_X1 = 690.0

    v = {}
    v['fiorino'] = fio
    v['vuc'] = peq
    v['tres4'] = gde

    # truck toco: baú mais comprido, um eixo traseiro mais para trás
    v['toco'] = (estica(chassi, 355, CH_X1, 820) + roda_f + desloca(roda_t, 128)
                 + estica(bau, BAU_X0, BAU_X1, 822) + cabine)

    # bitruck: baú ainda maior e dois eixos traseiros
    v['bitruck'] = (estica(chassi, 355, CH_X1, 905) + roda_f + desloca(roda_t, 150) + desloca(roda_t, 248)
                    + estica(bau, BAU_X0, BAU_X1, 908) + cabine)

    # carreta: cavalo (cabine + eixo de tração) e semirreboque mais alto, separado da cabine,
    # apoiado no cavalo na frente, com o pé de apoio e três eixos no fim
    k = (1122 - 412) / (BAU_X1 - BAU_X0)
    semi = [mover(p, lambda x: 412 + (x - BAU_X0) * k, lambda y: 166 + (y - 188) * (222 / 210)) for p in bau]
    COR = 'rgb(19.999695%, 25.489807%, 33.332825%)'
    pe = [{'i': 0, 'e': f'<path fill="{COR}" d="M 600 388 L 612 388 L 612 446 L 600 446 Z"/>'},
          {'i': 0, 'e': f'<path fill="{COR}" d="M 590 446 L 622 446 L 622 454 L 590 454 Z"/>'}]
    engate = [{'i': 0, 'e': f'<path fill="{COR}" d="M 392 384 L 470 384 L 470 396 L 392 396 Z"/>'}]
    v['carreta'] = (estica(chassi, 355, CH_X1, 520) + [mover(p, lambda x: 640 + (x - 355) * ((1116 - 640) / (CH_X1 - 355))) for p in chassi]
                    + roda_f + desloca(roda_t, -122) + engate
                    + desloca(roda_t, 340) + desloca(roda_t, 420) + desloca(roda_t, 500)
                    + semi + pe + cabine)
    return v


TITULOS = {
    'fiorino': 'Fiorino — furgão leve',
    'vuc': 'VUC — veículo urbano de carga',
    'tres4': 'Caminhão 3/4 — caminhão leve',
    'toco': 'Truck toco — 2 eixos',
    'bitruck': 'Bitruck — 3 eixos',
    'carreta': 'Carreta — articulada',
}
# Mesma escala para todos os caminhões (a cabine é a mesma; muda o comprimento do baú e os
# eixos) e o Fiorino menor, na proporção de verdade. Cada arquivo é recortado no comprimento
# do próprio veículo, com a mesma altura: na tela, todos aparecem na mesma escala e o que
# muda é o comprimento, do Fiorino à carreta.
ESCALA = {'fiorino': 0.83, 'vuc': 1.0, 'tres4': 1.0, 'toco': 1.0, 'bitruck': 1.0, 'carreta': 1.0}
CHAO, ALT, MARGEM = 330, 362, 26


def escrever(nome, pecas):
    x0, y0, x1, y1 = caixa_pecas(pecas)
    s = ESCALA[nome]
    larg = (x1 - x0) * s
    assert (y1 - y0) * s <= CHAO - 20, nome
    W = larg + 2 * MARGEM
    tx = MARGEM - x0 * s
    ty = CHAO - y1 * s
    t = TITULOS[nome]
    corpo = '\n'.join(p['e'] for p in pecas)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.0f} {ALT}" role="img" aria-label="{t}">'
           f'<title>{t}</title>'
           f'<ellipse cx="{W / 2:.1f}" cy="{CHAO + 12}" rx="{larg / 2 + 16:.1f}" ry="14" fill="#cbd5e1" opacity=".75"/>'
           f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f})">\n{corpo}\n</g></svg>\n')
    with open(os.path.join(SAIDA, nome + '.svg'), 'w', encoding='utf-8') as f:
        f.write(svg)
    print(f'{nome}.svg  {W:.0f} x {ALT}  {len(svg) // 1024} KB')


if __name__ == '__main__':
    if len(sys.argv) > 1:
        extrair_do_pdf(sys.argv[1])
    for nome, pecas in montar().items():
        escrever(nome, pecas)
