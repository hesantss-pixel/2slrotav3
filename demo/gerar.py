# -*- coding: utf-8 -*-
"""Planilha de pedidos de TESTE para demonstração do ROTAV3.
Endereços reais de São Paulo e região, com CEP conferido no OpenCEP em 16/11/2026.
Clientes, pesos, volumes e telefones são fictícios.
A ordem das linhas é a ordem das notas fiscais (como elas chegam na transportadora):
a geografia fica embaralhada de propósito, para mostrar o que acontece quando
alguém roteiriza "na ordem que as notas chegaram"."""
import csv
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter

# ── endereços conferidos (cep, logradouro, bairro, cidade, zona) ───────────
L = {
 # Centro
 'paulista':   ('01310-100', 'Avenida Paulista',                        'Bela Vista',          'São Paulo', 'centro'),
 'se':         ('01001-000', 'Praça da Sé',                             'Sé',                  'São Paulo', 'centro'),
 'crispin':    ('01037-000', 'Rua Conselheiro Crispiniano',             'República',           'São Paulo', 'centro'),
 'belacintra': ('01415-000', 'Rua Bela Cintra',                         'Consolação',          'São Paulo', 'centro'),
 # Oeste
 'farialima':  ('01451-000', 'Avenida Brigadeiro Faria Lima',           'Jardim Paulistano',   'São Paulo', 'oeste'),
 'matarazzo':  ('05001-000', 'Avenida Francisco Matarazzo',             'Água Branca',         'São Paulo', 'oeste'),
 'guaicurus':  ('05033-000', 'Rua Guaicurus',                           'Água Branca',         'São Paulo', 'oeste'),
 'medeiros':   ('05425-000', 'Rua Eugênio de Medeiros',                 'Pinheiros',           'São Paulo', 'oeste'),
 'lineu':      ('05508-000', 'Avenida Professor Lineu Prestes',         'Butantã',             'São Paulo', 'oeste'),
 # Norte
 'bagatelle':  ('02012-000', 'Praça Campo de Bagatelle',                'Santana',             'São Paulo', 'norte'),
 'marinheiro': ('02303-000', 'Rua Marinheiro',                          'Tucuruvi',            'São Paulo', 'norte'),
 'brazleme':   ('02511-000', 'Avenida Braz Leme',                       'Casa Verde',          'São Paulo', 'norte'),
 'bourroul':   ('02710-000', 'Avenida Professor Celestino Bourroul',    'Limão',               'São Paulo', 'norte'),
 'conego':     ('02212-000', 'Rua Cônego Vicente',                      'Vila Medeiros',       'São Paulo', 'norte'),
 'joaocord':   ('02960-000', 'Rua João Cordeiro',                       'Moinho Velho',        'São Paulo', 'norte'),
 # Leste
 'mooca':      ('03104-000', 'Rua da Mooca',                            'Mooca',               'São Paulo', 'leste'),
 'itapura':    ('03310-000', 'Rua Itapura',                             'Vila Gomes Cardim',   'São Paulo', 'leste'),
 'goncalo':    ('03407-000', 'Rua Gonçalo Nunes',                       'Chácara Califórnia',  'São Paulo', 'leste'),
 'suzano':     ('03502-000', 'Rua Doutor Suzano Brandão',               'Vila Aricanduva',     'São Paulo', 'leste'),
 'aracati':    ('03630-000', 'Rua Aracati',                             'Guaiaúna',            'São Paulo', 'leste'),
 'itaquera':   ('08210-000', 'Rua Campinas do Piauí',                   'Itaquera',            'São Paulo', 'leste'),
 'lamarca':    ('08431-000', 'Rua Emílio Lamarca',                      'Jardim Moreno',       'São Paulo', 'leste'),
 # Sul
 'oscarporto': ('04003-000', 'Rua Coronel Oscar Porto',                 'Paraíso',             'São Paulo', 'sul'),
 'taylor':     ('04218-000', 'Rua Comandante Taylor',                   'Ipiranga',            'São Paulo', 'sul'),
 'taunay':     ('04306-000', "Avenida Affonso D'Escragnolle Taunay",    'Vila Monte Alegre',   'São Paulo', 'sul'),
 'jk':         ('04543-000', 'Avenida Presidente Juscelino Kubitschek', 'Vila Nova Conceição', 'São Paulo', 'sul'),
 'washington': ('04662-000', 'Avenida Washington Luís',                 'Santo Amaro',         'São Paulo', 'sul'),
 'guarapi':    ('04762-000', 'Avenida Guarapiranga',                    'Vila Socorro',        'São Paulo', 'sul'),
 'moscou':     ('04815-000', 'Praça Moscou',                            'Interlagos',          'São Paulo', 'sul'),
 # Região metropolitana
 'osasco':     ('06010-000', 'Rua Dona Primitiva Vianco',               'Centro',              'Osasco',    'metro'),
 'gruCentro':  ('07010-000', 'Praça Presidente Getúlio Vargas',         'Centro',              'Guarulhos', 'metro'),
 'gruHulda':   ('07094-000', 'Avenida Doutor Timóteo Penteado',         'Vila Hulda',          'Guarulhos', 'metro'),
 'santoandre': ('09010-000', 'Rua Coronel Oliveira Lima',               'Centro',              'Santo André','metro'),
 'sbc':        ('09710-000', 'Rua Marechal Deodoro',                    'Centro',              'São Bernardo do Campo','metro'),
 'itaquaq':    ('08577-000', 'Rodovia João Afonso de Souza Castellano', 'Vila Monte Belo',     'Itaquaquecetuba','metro'),
}

# ── pedidos: (local, numero, cliente, peso, volumes, tipo, tem_telefone) ────
# peso: None = coluna vazia (pegadinha); str = formato brasileiro com milhar
# numero: None = endereço sem número (pegadinha)
P = {
 'centro': [
  ('paulista', 1000, 'Loja Casa & Cor', 180, 6, 'entrega', 1),
  ('paulista', 1000, 'Loja Casa & Cor', 95, 3, 'entrega', 1),      # mesma porta, 2ª nota
  ('paulista', 1000, 'Loja Casa & Cor', 40, 2, 'entrega', 1),      # mesma porta, 3ª nota
  ('paulista', 1200, 'Óptica Visão Clara', 12, 1, 'entrega', 0),
  ('se', 95, 'Papelaria Lápis Azul', 220, 9, 'entrega', 1),
  ('se', 140, 'Mercearia do Largo', 310, 12, 'entrega', 0),
  ('se', 210, 'Ferragens União', 480, 8, 'entrega', 1),
  ('crispin', 120, 'Lanchonete Ponto Certo', 65, 4, 'entrega', 1),
  ('crispin', 288, 'Eletro Center Luz', 540, 7, 'entrega', 0),
  ('crispin', 350, 'Distribuidora Aurora', 150, 5, 'coleta', 1),
  ('belacintra', 200, 'Confeitaria Doce Encanto', 85, 5, 'entrega', 1),
  ('belacintra', 400, 'Clínica Bem Estar', 30, 2, 'entrega', 1),
  ('belacintra', 520, 'Academia Corpo Ativo', 410, 4, 'entrega', 0),
  ('belacintra', 460, 'Pet Shop Patinhas', 25, 40, 'entrega', 1),  # muito volume, pouco peso
 ],
 'oeste': [
  ('farialima', 2232, 'Papelaria Lápis Azul — Faria Lima', 70, 3, 'entrega', 1),
  ('farialima', 2232, 'Café Grão Fino', 45, 2, 'entrega', 1),      # mesmo prédio, outro cliente
  ('farialima', 2800, 'Loja do Bebê Sonho', 120, 6, 'entrega', 0),
  ('matarazzo', 400, 'Supermercado Vila Nova', 760, 18, 'entrega', 1),
  ('matarazzo', 700, 'Hortifruti Folha Verde', 390, 14, 'entrega', 1),
  ('matarazzo', 900, 'Autopeças Ferreira', 1250, 11, 'entrega', 0),  # peso com milhar
  ('guaicurus', 200, 'Material de Construção Rocha', 1500, 10, 'entrega', 1),
  ('guaicurus', 350, 'Gráfica Letra Viva', 260, 7, 'coleta', 1),
  ('guaicurus', 480, 'Mercado Bom Preço — Água Branca', 520, 16, 'entrega', 0),
  ('medeiros', 150, 'Restaurante Sabor Caseiro', 140, 6, 'entrega', 1),
  ('medeiros', 300, 'Padaria Pão Dourado', 95, 5, 'entrega', 1),
  ('medeiros', 220, 'Farmácia Vida Plena', 35, 3, 'entrega', 0),
  ('lineu', 580, 'Laboratório Alfa Análises', 60, 4, 'entrega', 1),
  ('lineu', 1300, 'Livraria Página Nova', 310, 13, 'entrega', 0),
  ('lineu', 2242, 'Cantina Dona Rosa', 180, 8, 'coleta', 1),
  ('lineu', 760, 'Ótica Lentes & Cia', 18, 1, 'entrega', 1),
 ],
 'norte': [
  ('bagatelle', 50, 'Mercado Bom Preço — Santana', 680, 20, 'entrega', 1),
  ('bagatelle', 118, 'Açaí do Bairro', 90, 6, 'entrega', 1),
  ('bagatelle', 230, 'Pizzaria Forno a Lenha', 150, 7, 'entrega', 0),
  ('marinheiro', 75, 'Padaria Pão Dourado — Tucuruvi', 110, 5, 'entrega', 1),
  ('marinheiro', 160, 'Autopeças Ferreira — Tucuruvi', 870, 9, 'entrega', 0),
  ('marinheiro', 240, 'Papelaria Estrela', 55, 4, 'entrega', 1),
  ('brazleme', 800, 'Distribuidora Aurora — Casa Verde', 1800, 22, 'entrega', 1),
  ('brazleme', 1200, 'Hortifruti Folha Verde — Casa Verde', 430, 15, 'entrega', 1),
  ('brazleme', 1500, 'Marmoraria Pedra Clara', 1200, 6, 'coleta', 0),
  ('bourroul', 300, 'Mercearia São Jorge', 240, 10, 'entrega', 1),
  ('bourroul', 450, 'Bicicletaria Pedal Livre', 160, 8, 'entrega', 0),
  ('bourroul', 520, 'Sorveteria Gelo Bom', 75, 5, 'entrega', 1),
  ('conego', 88, 'Lava-Rápido Brilho', 45, 3, 'entrega', 1),
  ('conego', 340, 'Loja Casa & Cor — Vila Medeiros', 390, 12, 'entrega', 0),
  ('conego', 612, 'Oficina Motor Forte', 520, 5, 'coleta', 1),
  ('joaocord', 125, 'Armazém do Zé', 280, 11, 'entrega', 1),
  ('joaocord', 330, 'Papelaria Lápis Azul — Moinho Velho', 70, 4, 'entrega', 0),
  ('joaocord', 455, 'Farmácia Vida Plena — Moinho Velho', 28, 2, 'entrega', 1),
  ('joaocord', 540, 'Pet Shop Patinhas — Norte', 130, 9, 'entrega', 1),
  ('joaocord', 680, 'Depósito de Bebidas Gelado', 950, 24, 'entrega', 0),
 ],
 'leste': [
  ('mooca', 1700, 'Supermercado Vila Nova — Mooca', 1450, 28, 'entrega', 1),
  ('mooca', 1900, 'Cantina Dona Rosa — Mooca', 210, 9, 'entrega', 1),
  ('mooca', 2100, 'Ferragens União — Mooca', 640, 7, 'entrega', 0),
  ('mooca', 1820, 'Tapeçaria Conforto', 180, 4, 'coleta', 1),
  ('itapura', 310, 'Mercado Bom Preço — Tatuapé', 720, 19, 'entrega', 1),
  ('itapura', 480, 'Padaria Pão Dourado — Tatuapé', 125, 6, 'entrega', 1),
  ('itapura', 1250, 'Loja do Bebê Sonho — Tatuapé', 90, 5, 'entrega', 0),
  ('itapura', 905, 'Clínica Bem Estar — Tatuapé', 40, 3, 'entrega', 1),
  ('itapura', 1430, 'Eletro Center Luz — Tatuapé', 480, 8, 'entrega', 0),
  ('goncalo', 45, 'Mercearia do Bairro', 260, 10, 'entrega', 1),
  ('goncalo', 170, 'Restaurante Sabor Caseiro — Califórnia', 175, 7, 'entrega', 0),
  ('goncalo', 320, 'Materiais Elétricos Fio Novo', 580, 9, 'entrega', 1),
  ('goncalo', 260, 'Doceria Açúcar Mascavo', 60, 4, 'entrega', 1),
  ('suzano', 90, 'Material de Construção Rocha — Aricanduva', 2100, 14, 'entrega', 1),
  ('suzano', 215, 'Pet Shop Patinhas — Aricanduva', 85, 6, 'entrega', 0),
  ('suzano', 430, 'Academia Corpo Ativo — Aricanduva', 350, 5, 'entrega', 1),
  ('suzano', 560, 'Sacolão Preço Bom', 410, 16, 'entrega', 1),
  ('aracati', 150, 'Autopeças Ferreira — Guaiaúna', 690, 8, 'entrega', 0),
  ('aracati', 380, 'Lanchonete Ponto Certo — Guaiaúna', 55, 3, 'entrega', 1),
  ('aracati', 520, 'Papelaria Estrela — Guaiaúna', None, 6, 'entrega', 1),   # peso em branco
  ('aracati', 640, 'Loja de Tintas Cor Viva', 480, 12, 'entrega', 0),
  ('itaquera', 120, 'Supermercado Vila Nova — Itaquera', 1600, 30, 'entrega', 1),
  ('itaquera', 275, 'Farmácia Vida Plena — Itaquera', 32, 2, 'entrega', 1),
  ('itaquera', 410, 'Padaria Pão Dourado — Itaquera', 140, 7, 'entrega', 0),
  ('itaquera', 530, 'Pizzaria Forno a Lenha — Itaquera', 165, 8, 'entrega', 1),
  ('itaquera', 680, 'Depósito Bebidas Geladinho', 880, 22, 'entrega', 0),
  ('lamarca', 60, 'Mercearia São Jorge — Jd. Moreno', 230, 9, 'entrega', 1),
  ('lamarca', 185, 'Ferragens União — Jd. Moreno', 540, 6, 'entrega', 0),
  ('lamarca', 310, 'Hortifruti Folha Verde — Jd. Moreno', 375, 14, 'entrega', 1),
  ('lamarca', 425, 'Oficina Motor Forte — Jd. Moreno', 620, 5, 'coleta', 1),
 ],
 'sul': [
  ('oscarporto', 100, 'Clínica Bem Estar — Paraíso', 48, 3, 'entrega', 1),
  ('oscarporto', 180, 'Café Grão Fino — Paraíso', 70, 4, 'entrega', 1),
  ('oscarporto', 155, 'Livraria Página Nova — Paraíso', 290, 12, 'entrega', 0),
  ('oscarporto', 205, 'Floricultura Pétala', 35, 5, 'entrega', 1),
  ('taylor', 70, 'Mercado Bom Preço — Ipiranga', 640, 18, 'entrega', 1),
  ('taylor', 195, 'Autopeças Ferreira — Ipiranga', 780, 9, 'entrega', 0),
  ('taylor', 320, 'Padaria Pão Dourado — Ipiranga', 120, 6, 'entrega', 1),
  ('taylor', 450, 'Papelaria Lápis Azul — Ipiranga', 65, 4, 'entrega', 1),
  ('taunay', 140, 'Restaurante Sabor Caseiro — Monte Alegre', 155, 7, 'entrega', 0),
  ('taunay', 290, 'Pet Shop Patinhas — Monte Alegre', 95, 6, 'entrega', 1),
  ('taunay', 410, 'Farmácia Vida Plena — Monte Alegre', 40, 3, 'entrega', 1),
  ('taunay', 530, 'Sorveteria Gelo Bom — Monte Alegre', 80, 5, 'entrega', 0),
  ('jk', 1200, 'Loja Casa & Cor — Vila Nova Conceição', 210, 8, 'entrega', 1),
  ('jk', 1600, 'Óptica Visão Clara — Vila Nova Conceição', 15, 1, 'entrega', 1),
  ('jk', 2000, 'Confeitaria Doce Encanto — V. N. Conceição', 90, 5, 'entrega', 0),
  ('jk', 1455, 'Academia Corpo Ativo — V. N. Conceição', 430, 6, 'entrega', 1),
  ('washington', 300, 'Mercado Bom Preço — Santo Amaro', 710, 20, 'entrega', 1),
  ('washington', 500, 'Distribuidora Aurora — Santo Amaro', 1350, 17, 'entrega', 0),
  ('washington', 420, 'Materiais Elétricos Fio Novo — Sto. Amaro', 560, 9, 'entrega', 1),
  ('washington', 180, 'Gráfica Letra Viva — Santo Amaro', 240, 7, 'coleta', 1),
  ('guarapi', 455, 'Sacolão Preço Bom — Vila Socorro', 480, 15, 'entrega', 1),
  ('guarapi', 801, 'Depósito de Bebidas Gelado — V. Socorro', 920, 23, 'entrega', 0),
  ('guarapi', None, 'Marmoraria Pedra Clara — V. Socorro', 1100, 5, 'entrega', 1),  # sem número
  ('guarapi', 655, 'Lanchonete Ponto Certo — V. Socorro', 60, 4, 'entrega', 1),
  ('moscou', 30, 'Mercearia São Jorge — Interlagos', 250, 10, 'entrega', 0),
  ('moscou', 85, 'Padaria Pão Dourado — Interlagos', 135, 6, 'entrega', 1),
  ('moscou', 160, 'Pet Shop Patinhas — Interlagos', 70, 5, 'entrega', 1),
  ('moscou', 240, 'Oficina Motor Forte — Interlagos', 390, 4, 'coleta', 0),
 ],
 'metro': [
  ('osasco', 201, 'Supermercado Vila Nova — Osasco', 1250, 26, 'entrega', 1),
  ('osasco', 405, 'Farmácia Vida Plena — Osasco', 38, 3, 'entrega', 1),
  ('gruCentro', 110, 'Mercado Bom Preço — Guarulhos Centro', 580, 17, 'entrega', 1),
  ('gruCentro', 260, 'Papelaria Estrela — Guarulhos', 75, 4, 'entrega', 0),
  ('gruHulda', 900, 'Autopeças Ferreira — Vila Hulda', 820, 10, 'entrega', 1),
  ('gruHulda', 1500, 'Hortifruti Folha Verde — Vila Hulda', 360, 13, 'coleta', 1),
  ('santoandre', 150, 'Eletro Center Luz — Santo André', 640, 8, 'entrega', 1),
  ('santoandre', 380, 'Restaurante Sabor Caseiro — Santo André', 145, 7, 'entrega', 0),
  ('sbc', 400, 'Material de Construção Rocha — São Bernardo', 1750, 12, 'entrega', 1),
  ('sbc', 600, 'Clínica Bem Estar — São Bernardo', 42, 3, 'entrega', 1),
  ('itaquaq', 1200, 'Distribuidora Aurora — Itaquaquecetuba', 2800, 30, 'entrega', 1),  # longe + pesado
  ('itaquaq', 2450, 'Mercearia do Bairro — Itaquaquecetuba', 185, 8, 'entrega', 0),
 ],
}

# ── ordem das linhas: rodízio entre as zonas (notas chegam fora de ordem) ──
ordem_zonas = ['leste', 'sul', 'norte', 'centro', 'oeste', 'metro']
filas = {z: list(P[z]) for z in ordem_zonas}
linhas, i = [], 0
while any(filas.values()):
    z = ordem_zonas[i % len(ordem_zonas)]
    if filas[z]:
        linhas.append(filas[z].pop(0))
    i += 1

assert len(linhas) == 120, len(linhas)

# Pesos acima são a "carga cheia" de cada cliente; para o perfil de distribuição
# urbana fracionada (120 notas num dia, veículos de até 3 t) a planilha sai com
# 35% disso. Duas notas ficam fora da conta de propósito: a de 2.800 kg
# (uma só enche um VUC) e a escrita no formato "1.050,50".
ESCALA = 0.35
FIXOS = {'Distribuidora Aurora — Itaquaquecetuba': 2800,
         'Autopeças Ferreira': '1.050,50'}

# ── monta as linhas da planilha ────────────────────────────────────────────
CAB = ['NF', 'Tipo', 'Cliente', 'Endereco', 'Bairro', 'Cidade', 'UF', 'CEP', 'Peso', 'Volumes', 'Telefone']
rows, nf = [], 45001
for n, (chave, numero, cliente, peso, vols, tipo, tem_fone) in enumerate(linhas):
    cep, rua, bairro, cidade, _ = L[chave]
    end = rua if numero is None else f'{rua}, {numero}'
    # pegadinhas pontuais
    if chave == 'aracati' and numero == 150:
        cep = ''                      # nota antiga, sem CEP
    if chave == 'moscou' and numero == 30:
        cep = '0481500'               # CEP digitado com 7 dígitos
    if chave == 'itapura' and numero == 310:
        cidade = 'SAO PAULO'          # cidade em maiúsculas, sem acento
    if chave == 'taunay' and numero == 140:
        cidade = 'sao paulo'          # cidade em minúsculas
    fone = f'(11) 90000-{n+1:04d}' if tem_fone else ''
    if cliente in FIXOS:
        peso_final = FIXOS[cliente]
    elif peso is None:
        peso_final = ''
    else:
        peso_final = max(5, round(float(peso) * ESCALA))
    rows.append([str(nf), tipo, cliente, end, bairro, cidade, 'SP', cep,
                 peso_final, vols, fone])
    nf += 1

# NF repetida: a nota 45033 entra duas vezes, com endereços diferentes
rows[91][0] = '45033'

# ── .xlsx ─────────────────────────────────────────────────────────────────
wb = Workbook(); ws = wb.active; ws.title = 'Pedidos'
ws.append(CAB)
for r in rows:
    ws.append(r)
az = PatternFill('solid', fgColor='0B1B33')
for c in ws[1]:
    c.font = Font(bold=True, color='FFFFFF'); c.fill = az
    c.alignment = Alignment(horizontal='center')
larg = [9, 10, 44, 46, 22, 24, 5, 11, 9, 9, 16]
for i, w in enumerate(larg, 1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = 'A2'
wb.save('/home/claude/demo/pedidos-teste-sao-paulo-120.xlsx')

# ── .csv (ponto e vírgula, com BOM, abre no Excel em português) ───────────
with open('/home/claude/demo/pedidos-teste-sao-paulo-120.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.writer(f, delimiter=';')
    w.writerow(CAB); w.writerows(rows)

# ── conferência ──────────────────────────────────────────────────────────
from collections import Counter
zc = Counter(L[k][4] for k, *_ in linhas)
tc = Counter(t for *_, t, _ in linhas)
pesos = [float(str(r[8]).replace('.', '').replace(',', '.')) for r in rows if r[8] != '']
print('linhas:', len(rows), '| NFs distintas:', len(set(r[0] for r in rows)))
print('por zona:', dict(zc))
print('tipos:', dict(tc))
print('peso total: %.0f kg | sem peso: %d | com telefone: %d'
      % (sum(pesos), sum(1 for r in rows if r[8] == ''), sum(1 for r in rows if r[10])))
print('cidades:', dict(Counter(r[5] for r in rows)))
print('sem CEP ou CEP inválido:', sum(1 for r in rows if len(str(r[7]).replace('-', '')) != 8))
