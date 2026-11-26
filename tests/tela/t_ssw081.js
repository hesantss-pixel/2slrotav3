// Relatório de TMS na importação (SSW opção 081 e parecidos): CSV em Windows-1252 com título antes
// do cabeçalho, campo entre aspas com ";" dentro, remetente e destinatário na mesma linha, chave
// da NF-e, CTRC, setor, peso real e peso cubado; colunas que o sistema não reconhece pedem
// "Conferir colunas" e o modelo fica guardado; planilha por cima de nota do XML só completa.
// O layout real da 081 não é público: os cabeçalhos aqui são inventados. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;

// chave de acesso com dígito verificador certo (módulo 11)
function chave(nf, cnpj = '12345678000190') {
  const c43 = '35' + '2411' + cnpj + '55' + '001' + String(nf).padStart(9, '0') + '1' + '12345678';
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += (+c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; return c43 + ((r < 2) ? 0 : 11 - r);
}
const K1 = chave(1001), K2 = chave(1002), K3 = chave(1003);
const dir = '/tmp/ssw081'; fs.mkdirSync(dir, { recursive: true });
const csv081 = [
  'Relatório de entregas por unidade;;;',
  'Unidade: GRU;Emitido em 26/11/2026;;',
  'Setor;CTRC;Valor NF;NF;Chave NF-e;Remetente;Cidade Remetente;CEP Remetente;Destinatário;CNPJ Destinatário;Endereço Destinatário;Nº;Bairro Destinatário;Cidade Destinatário;UF;CEP Destinatário;Peso Real;Peso Cubado;Volumes',
  `GRU-01;GRU 123456-7;"1.234,56";1001;${K1};Fornecedor Teste;Barueri;06401-000;Loja São João;12.345.678/0001-90;"Rua das Flores; bloco B";100;Centro;Guarulhos;SP;07010-000;"120,5";"300,0";3`,
  `GRU-02;GRU 123457-5;"99,90";1002;${K2};Fornecedor Teste;Barueri;06401-000;Mercado Ação Ltda;98.765.432/0001-10;Av. Paulista;1500;Bela Vista;São Paulo;SP;01310-100;"80";"40";1`,
  `GRU-01;GRU 123458-3;"10,00";1003;${K3};Fornecedor Teste;Barueri;06401-000;Padaria Conceição;11.222.333/0001-44;Rua Dom Pedro;20;Vila Galvão;Guarulhos;SP;07071-000;;;2`,
].join('\r\n');
fs.writeFileSync(dir + '/entregas-081.csv', Buffer.from(csv081, 'latin1'));   // Windows-1252, como sai de sistema
// colunas que o sistema não reconhece pelo nome
fs.writeFileSync(dir + '/estranha.csv', 'Doc;Quem;Local;Kg\nA-77;Cliente Sete;Arujá;50\nA-78;Cliente Oito;Poá;60\n');

const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    // a NF 1003 já veio do XML, com produtos e caixas: a planilha só completa
    [K3]: { id: K3, nf: '1003', chave: K3, tipo: 'entrega', origem: 'xml', status: 'pendente', cidade: 'Guarulhos', uf: 'SP', cep: '07071000',
      dest: 'Padaria Conceição', endereco: 'Rua Dom Pedro, 20', bairro: 'Vila Galvão', peso: 42, itens: 2, m3: 0.25, m3Fonte: 'medidas',
      medidas: '50 × 50 × 50 cm', cx: [{ q: 2, c: 50, l: 50, a: 50 }], produtos: [{ d: 'Farinha de trigo 25 kg', q: 2, u: 'SC' }],
      geoStatus: 'ok', lat: -23.45, lng: -46.53 },
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const peds = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota || {});

(async () => {
  const b = await chromium.launch();
  const rotas = async (c) => c.route(/nominatim|viacep|railway\.app|maps\.googleapis/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(400);
  ok(/opção 081/.test(await p.textContent('#imp-help')), 'a ajuda da importação fala do SSW (opção 081)');

  // ── 1. relatório reconhecido sozinho ────────────────────────────────────
  await p.setInputFiles('#file-input', dir + '/entregas-081.csv'); await p.waitForTimeout(1500);
  ok(!(await p.isVisible('#modal-colunas')), 'colunas reconhecidas pelo nome: não pede conferência');
  let d = await peds(p);
  const a = d[K1], b2 = d[K2], c = d[K3];
  ok(a && a.nf === '1001' && a.chave === K1 && a.ctrc === 'GRU 123456-7' && a.setor === 'GRU-01', 'pedido pela chave da NF-e, com NF, CTRC e setor: ' + J(a && { nf: a.nf, ctrc: a.ctrc, setor: a.setor }));
  ok(a && a.dest === 'Loja São João' && a.cidade === 'Guarulhos' && a.cep === '07010000' && a.bairro === 'Centro', 'entrega usa o destinatário (nome, cidade, CEP, bairro), não o remetente; acentos certos: ' + J(a && { dest: a.dest, cidade: a.cidade, cep: a.cep }));
  ok(a && a.endereco === 'Rua das Flores; bloco B, 100', 'campo entre aspas com ";" dentro fica inteiro: ' + (a && a.endereco));
  ok(a && a.peso === 120.5 && a.pesoCubado === 300 && Math.abs(a.m3 - 1) < 1e-9 && a.m3DeCubado === true && a.itens === 3, 'peso real 120,5 kg; peso cubado 300 kg vira 1 m³ (÷ 300): ' + J(a && { peso: a.peso, m3: a.m3 }));
  ok(b2 && b2.peso === 80 && !b2.m3 && b2.pesoCubado === 40 && b2.dest === 'Mercado Ação Ltda' && b2.cidade === 'São Paulo', 'peso cubado menor que o real não vira m³ (pode ser o taxado)');
  ok(Object.keys(d).length === 3, 'nada duplicado (3 pedidos): ' + Object.keys(d).length);
  ok(c && c.produtos && c.produtos.length === 1 && c.cx && c.m3 === 0.25 && c.m3Fonte === 'medidas' && c.peso === 42 && c.origem === 'xml',
    'nota do XML continua com produtos, caixas, m³ e peso (a planilha veio sem peso): ' + J(c && { peso: c.peso, m3: c.m3, origem: c.origem }));
  ok(c && c.setor === 'GRU-01' && c.ctrc === 'GRU 123458-3' && c.lat === -23.45, 'e ganhou setor e CTRC, sem perder o ponto no mapa');
  ok(!dialogs.some((x) => /sem peso/.test(x)), 'não pergunta do peso: a nota sem peso na planilha já tinha peso do XML ' + J(dialogs));
  const cols = await p.textContent('#imp-colunas');
  ok(/Cliente: Destinatário/.test(cols) && /Cidade: Cidade Destinatário/.test(cols) && /Peso real \(kg\): Peso Real/.test(cols) && await p.isVisible('#btn-conferir-colunas'),
    'mostra as colunas usadas e o botão Conferir colunas: ' + cols.slice(0, 120));

  // ── 2. conferir colunas e importar de novo ───────────────────────────────
  await p.click('#btn-conferir-colunas'); await p.waitForTimeout(300);
  ok(await p.isVisible('#modal-colunas'), 'Conferir colunas abre a janela');
  ok((await p.inputValue('select[data-campo="dest"]')) === '8' && (await p.inputValue('select[data-campo="cidade"]')) === '13', 'a janela vem com as colunas que o sistema usou');
  await p.selectOption('select[data-campo="dest"]', '5');      // usar o Remetente como cliente (só para testar a troca)
  await p.click('#modal-colunas >> text=Importar com estas colunas'); await p.waitForTimeout(1200);
  d = await peds(p);
  ok(d[K1].dest === 'Fornecedor Teste', 'importou de novo com a coluna escolhida: ' + d[K1].dest);
  const mod = await p.evaluate(() => window.__FAKE.db.empresas.emp1.config.modelos_planilha);
  ok(mod && Object.keys(mod).length === 1 && JSON.parse(Object.values(mod)[0]).i.dest === 5, 'o modelo ficou guardado no banco da empresa: ' + J(mod));
  await p.setInputFiles('#file-input', dir + '/entregas-081.csv'); await p.waitForTimeout(1200);
  ok(!(await p.isVisible('#modal-colunas')) && (await peds(p))[K1].dest === 'Fornecedor Teste' && /as que você conferiu antes/.test(await p.textContent('#imp-colunas')),
    'a próxima planilha igual usa o modelo guardado, sem perguntar');

  // ── 3. colunas desconhecidas: pede para escolher ─────────────────────────
  await p.setInputFiles('#file-input', dir + '/estranha.csv'); await p.waitForTimeout(600);
  ok(await p.isVisible('#modal-colunas'), 'sem coluna de nota nem de cidade, abre Conferir colunas');
  ok(/Não achei a coluna da nota/.test(await p.textContent('#col-intro')), 'explica o que faltou: ' + await p.textContent('#col-intro'));
  ok(/ex\.: A-77/.test(await p.textContent('select[data-campo="nf"]')), 'cada coluna aparece com um exemplo do arquivo');
  await p.click('#modal-colunas >> text=Importar com estas colunas'); await p.waitForTimeout(200);
  ok(/Falta escolher a coluna da nota/.test(await p.textContent('#col-erro')) && await p.isVisible('#modal-colunas'), 'sem escolher, não importa e diz o que falta');
  await p.selectOption('select[data-campo="nf"]', '0');
  await p.selectOption('select[data-campo="dest"]', '1');
  await p.selectOption('select[data-campo="cidade"]', '2');
  await p.selectOption('select[data-campo="peso"]', '3');
  await p.click('#modal-colunas >> text=Importar com estas colunas'); await p.waitForTimeout(1200);
  d = await peds(p);
  ok(d['A-77'] && d['A-77'].dest === 'Cliente Sete' && d['A-77'].cidade === 'Arujá' && d['A-77'].peso === 50, 'importou com as colunas escolhidas: ' + J(d['A-77'] && { dest: d['A-77'].dest, cidade: d['A-77'].cidade }));
  // cancelar não importa
  await p.evaluate(() => { const db = window.__FAKE.db.empresas.emp1; delete db.config.modelos_planilha; });
  await p.evaluate(() => localStorage.clear());
  await p.setInputFiles('#file-input', dir + '/estranha.csv'); await p.waitForTimeout(600);
  await p.click('#modal-colunas >> text=Cancelar'); await p.waitForTimeout(400);
  ok(/cancelada na conferência das colunas/.test(await p.textContent('#import-msg-pedidos')), 'Cancelar não importa e avisa: ' + await p.textContent('#import-msg-pedidos'));

  // ── 4. celular ──────────────────────────────────────────────────────────
  await p.setViewportSize({ width: 375, height: 760 });
  await p.setInputFiles('#file-input', dir + '/estranha.csv'); await p.waitForTimeout(600);
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 375 && await p.isVisible('#modal-colunas'), 'a janela cabe no celular (' + larg + ' px)');
  await p.screenshot({ path: 'ssw081-colunas-375.png' });
  await p.click('#modal-colunas >> text=Cancelar');

  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
