// Buscar notas, excluir em lote (com Desfazer) e XML de cancelamento da NF-e
const { chromium } = require('playwright');
const { open } = require('./harness');
const fs = require('fs'), path = require('path');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CH1 = '35261012345678000199550010000010011000000017';  // chave da NF 1001
const CH5 = '35261012345678000199550010000050051000000050';  // chave da NF 5005 (em rota)
const PED = {
  [CH1]: { nf: '1001', tipo: 'entrega', chave: CH1, cidade: 'Guarulhos', dest: 'Mercado Ação', peso: 200, itens: 2, status: 'pendente', lat: -23.45, lng: -46.53, geoStatus: 'ok', cep: '07010000', remetente: 'Fábrica X' },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja B', peso: 150, itens: 1, status: 'pendente', lat: -23.44, lng: -46.50, geoStatus: 'ok' },
  '1003': { nf: '001003', tipo: 'entrega', cidade: 'Arujá', dest: 'Padaria C', peso: 300, itens: 3, status: 'pendente', lat: -23.39, lng: -46.32, geoStatus: 'ok' },
  'C_2001': { nf: '2001', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria D', peso: 100, itens: 1, status: 'pendente', lat: -23.48, lng: -46.35, geoStatus: 'ok' },
  [CH5]: { nf: '5005', tipo: 'entrega', chave: CH5, cidade: 'Guarulhos', dest: 'Cliente Em Rota', peso: 80, itens: 1, status: 'despachado', rota_atual: 'rota_1', lat: -23.45, lng: -46.53, geoStatus: 'ok' },
  '10010': { nf: '10010', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Outro', peso: 10, itens: 1, status: 'pendente', lat: -23.45, lng: -46.53, geoStatus: 'ok' },
};
const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};
const db = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1.pedidos_rota || {})));
const evento = (ch, tp) => `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID${tp}${ch}01"><cOrgao>35</cOrgao><tpAmb>1</tpAmb><CNPJ>12345678000199</CNPJ><chNFe>${ch}</chNFe><dhEvento>2026-11-01T10:00:00-03:00</dhEvento><tpEvento>${tp}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${tp === '110111' ? 'Cancelamento' : 'Carta de Correcao'}</descEvento><nProt>135260000000001</nProt><xJust>Erro na emissao da nota</xJust></detEvento></infEvento></evento><retEvento versao="1.00"><infEvento><tpAmb>1</tpAmb><cStat>135</cStat><chNFe>${ch}</chNFe><tpEvento>${tp}</tpEvento></infEvento></retEvento></procEventoNFe>`;
const DIR = path.join(__dirname, 'xml-canc'); fs.mkdirSync(DIR, { recursive: true });
const arq = (nome, txt) => { const f = path.join(DIR, nome); fs.writeFileSync(f, txt); return f; };

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  p.on('pageerror', (e) => console.log('STACK', (e.stack || '').split('\n').slice(0, 5).join(' | ')));
  const dialogs = []; let resposta = true;
  p.on('dialog', (d) => { dialogs.push(d.message()); resposta ? d.accept() : d.dismiss(); });
  await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await p.waitForTimeout(700);
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  ok(await p.isVisible('#busca-notas'), 'Pedidos: campo "Buscar notas" visível');
  const nomes = () => p.$$eval('#busca-res .bi-nf', (els) => els.map((e) => e.textContent.match(/NF (\d+)/)[1]));

  await p.fill('#busca-notas', '1001'); await p.waitForTimeout(150);
  let r = await nomes();
  ok(r[0] === '1001' && r.includes('10010'), 'busca por número: a nota exata vem primeiro (' + r.join(',') + ')');
  ok(await p.isHidden('#reg-cards-grid') && await p.isHidden('#ped-filtro-row'), 'buscando: esconde as regiões e o filtro');
  await p.fill('#busca-notas', 'acao'); await p.waitForTimeout(150);
  ok(JSON.stringify(await nomes()) === '["1001"]', 'busca sem acento acha "Mercado Ação"');
  await p.fill('#busca-notas', 'aruja'); await p.waitForTimeout(150);
  ok(JSON.stringify(await nomes()) === '["001003"]'.replace('001003', '001003'), 'busca pela cidade (Arujá)');
  await p.fill('#busca-notas', CH1.slice(-12)); await p.waitForTimeout(150);
  ok(JSON.stringify(await nomes()) === '["1001"]', 'busca por parte da chave de acesso');
  await p.fill('#busca-notas', '1002, 1003  7777;2001'); await p.waitForTimeout(150);
  r = await nomes();
  ok(r.length === 3 && r.includes('1002') && r.includes('001003') && r.includes('2001'), 'lista de números: acha 1002, 1003 (gravada 001003) e 2001');
  ok((await p.textContent('#busca-res .busca-faltou')).includes('7777'), 'lista: mostra o número que não foi encontrado');
  await p.fill('#busca-notas', '5005'); await p.waitForTimeout(150);
  ok(await p.isDisabled('#busca-res .busca-item >> nth=0 >> input') && (await p.textContent('#busca-res')).includes('em rota') && (await p.textContent('#busca-res')).includes('devolva a rota'), 'nota em rota: aparece, mas não dá para marcar (explica o motivo)');

  // excluir em lote
  await p.fill('#busca-notas', '1002 1003 2001'); await p.waitForTimeout(150);
  ok(!(await p.$('.busca-acoes')), 'sem seleção: barra de excluir escondida');
  await p.check('#busca-todas'); await p.waitForTimeout(150);
  ok((await p.textContent('.busca-acoes')).includes('3 notas selecionadas'), '"Selecionar todas" marca as 3');
  await p.uncheck('#busca-res .busca-item >> nth=2 >> input'); await p.waitForTimeout(100);
  ok((await p.textContent('.busca-acoes')).includes('2 notas selecionadas'), 'desmarcar uma: 2 selecionadas');
  resposta = false; dialogs.length = 0;
  await p.click('#btn-excluir-sel'); await p.waitForTimeout(300);
  ok(dialogs[0] && dialogs[0].includes('Excluir 2 notas') && Object.keys(await db(p)).length === 6, 'pede confirmação; cancelar não apaga nada');
  resposta = true;
  await p.click('#btn-excluir-sel'); await p.waitForTimeout(400);
  let d = await db(p);
  const sel = ['1002', '1003', 'C_2001'].filter((k) => !d[k]);
  ok(sel.length === 2 && Object.keys(d).length === 4, 'confirmar: as 2 selecionadas saem do banco (' + sel.join(',') + ')');
  ok((await p.textContent('#busca-msg')).includes('2 notas excluídas') && await p.isVisible('#busca-msg .btn-lk'), 'mensagem "2 notas excluídas" com "Desfazer"');
  ok((await nomes()).length === 1, 'resultado da busca atualiza (sobra 1)');
  await p.click('#busca-msg .btn-lk'); await p.waitForTimeout(400);
  d = await db(p);
  ok(Object.keys(d).length === 6 && d['1003'].nf === '001003' && d['1003'].dest === 'Padaria C', 'Desfazer: as notas voltam com todos os dados');
  ok((await p.textContent('#busca-msg')).includes('Exclusão desfeita'), 'avisa que a exclusão foi desfeita');

  // limpar a busca volta às regiões
  await p.fill('#busca-notas', ''); await p.waitForTimeout(150);
  ok(await p.isVisible('#reg-cards-grid') && !(await p.textContent('#busca-res')).trim(), 'busca vazia: volta às regiões');

  // busca do topo (computador) usa a mesma busca
  await p.evaluate(() => window.irParaPagina('dashboard')); await p.waitForTimeout(200);
  await p.fill('#top-search', '2001'); await p.waitForTimeout(300);
  ok(await p.isVisible('#page-pedidos') && (await p.inputValue('#busca-notas')) === '2001' && JSON.stringify(await nomes()) === '["2001"]', 'busca do topo abre Pedidos com o resultado');
  await p.fill('#top-search', ''); await p.waitForTimeout(150);

  // excluir pelo pedido aberto também tem Desfazer
  await p.evaluate(() => window.abrirPedido('10010')); await p.waitForTimeout(300);
  await p.click('#ped-excluir'); await p.waitForTimeout(400);
  ok(!(await db(p))['10010'] && (await p.textContent('#busca-msg')).includes('NF 10010 excluído') && await p.isVisible('#busca-msg .btn-lk'), 'excluir pelo pedido aberto: mensagem com "Desfazer"');
  await p.click('#busca-msg .btn-lk'); await p.waitForTimeout(300);
  ok(!!(await db(p))['10010'], 'Desfazer devolve o pedido');

  // XML de cancelamento
  dialogs.length = 0;
  await p.setInputFiles('#file-input', arq('canc-1001.xml', evento(CH1, '110111'))); await p.waitForTimeout(700);
  ok(dialogs.some((m) => m.includes('Esta nota foi cancelada') && m.includes('NF 1001')), 'XML de cancelamento: mostra a nota cancelada e pergunta');
  d = await db(p);
  ok(!d[CH1] && (await p.textContent('#busca-msg')).includes('1 nota cancelada saiu'), 'confirmando: a nota cancelada sai dos pendentes');
  ok((await p.textContent('#import-msg-pedidos')).includes('cancelamento de NF-e lido'), 'importação avisa que leu um cancelamento');
  await p.click('#busca-msg .btn-lk'); await p.waitForTimeout(300);
  ok(!!(await db(p))[CH1], 'Desfazer também vale para o cancelamento');
  dialogs.length = 0;
  await p.setInputFiles('#file-input', arq('canc-5005.xml', evento(CH5, '110111'))); await p.waitForTimeout(600);
  ok(!dialogs.length && (await db(p))[CH5] && (await p.textContent('#busca-msg')).includes('já está em rota'), 'cancelamento de nota em rota: não apaga e explica (devolver a rota)');
  await p.setInputFiles('#file-input', arq('canc-fora.xml', evento('35261099999999000199550010000099991000000099', '110111'))); await p.waitForTimeout(600);
  ok((await p.textContent('#busca-msg')).includes('não está nos pendentes'), 'cancelamento de nota que não está no sistema: avisa');
  await p.setInputFiles('#file-input', arq('cce.xml', evento(CH1, '110110'))); await p.waitForTimeout(600);
  ok((await p.textContent('#import-msg-pedidos')).includes('carta de correção'), 'carta de correção: recusada com mensagem clara');

  // pedido apagado enquanto o mapa o localizava não volta
  await ctx.unroute(/viacep|nominatim/);
  await ctx.route(/viacep/, (rr) => rr.fulfill({ contentType: 'application/json', body: JSON.stringify({ logradouro: 'Rua X', bairro: 'B', localidade: 'Guarulhos', uf: 'SP' }) }));
  // o mapa demora a responder: dá tempo de excluir no meio da localização
  await ctx.route(/nominatim/, (rr) => setTimeout(() => rr.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '-23.46', lon: '-46.53', address: { road: 'Rua X' } }]) }).catch(() => {}), 1500));
  await p.click('#btn-novo-pedido'); await p.waitForTimeout(250);
  await p.fill('#ped-nf', '8888'); await p.fill('#ped-cidade', 'Guarulhos'); await p.fill('#ped-cep', '07099999'); await p.fill('#ped-peso', '20');
  await p.click('#ped-salvar'); await p.waitForTimeout(150);
  ok((await db(p))['8888'] && (await db(p))['8888'].geoStatus === 'pendente', 'pedido com CEP entra na fila do mapa');
  await p.fill('#busca-notas', '8888'); await p.waitForTimeout(150);
  await p.check('#busca-res .busca-item >> nth=0 >> input'); await p.click('#btn-excluir-sel'); await p.waitForTimeout(3500);
  ok(!(await db(p))['8888'], 'excluído durante a localização: o mapa não recria o pedido');
  await p.screenshot({ path: 'bu-1440.png' });
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();

  // celular
  {
    const { ctx, p, errs } = await open(b, 'index.html', 390, 844, seed, true, PED);
    p.on('dialog', (dd) => dd.accept());
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    ok(await p.isVisible('#busca-notas'), 'celular: busca visível (a do topo some no celular)');
    await p.fill('#busca-notas', '1001 1002 1003 2001 5005'); await p.waitForTimeout(200);
    await p.tap('#busca-todas'); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('.busca-box').scrollIntoView());
    await p.screenshot({ path: 'bu-390.png' });
    const bar = await p.$eval('.busca-acoes', (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.bottom), innerHeight, getComputedStyle(e).position]; });
    ok(bar[2] === 'sticky' && bar[0] <= bar[1], 'celular: barra "Excluir" fica presa embaixo da tela ' + JSON.stringify(bar));
    for (const w of [390, 360, 320]) {
      await p.setViewportSize({ width: w, height: 760 }); await p.waitForTimeout(200);
      const s = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(s <= w, `celular ${w}px: sem rolagem para o lado (${s})`);
    }
    await p.screenshot({ path: 'bu-320.png' });
    ok(!errs.length, 'sem erros no console (celular): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // dados de exemplo (banco vazio): busca e exclusão só na tela
  {
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, null);
    p.on('dialog', (dd) => dd.accept());
    await p.waitForTimeout(800);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    await p.fill('#busca-notas', '300000 300001'); await p.waitForTimeout(200);
    const n0 = await p.evaluate(() => window.__FAKE.writes.length);
    await p.check('#busca-todas'); await p.click('#btn-excluir-sel'); await p.waitForTimeout(300);
    const n1 = await p.evaluate(() => window.__FAKE.writes.filter((w) => JSON.stringify(w).includes('pedidos_rota')).length);
    ok(n1 === 0 && (await p.textContent('#busca-msg')).includes('2 notas excluídas') && (await p.textContent('#busca-res')).includes('Nenhuma nota encontrada'), 'exemplo: exclui só na tela, nada vai para o banco');
    await p.click('#busca-msg .btn-lk'); await p.waitForTimeout(200);
    ok((await p.$$('#busca-res .busca-item')).length === 2, 'exemplo: Desfazer devolve as 2');
    ok(!errs.length && n0 >= 0, 'sem erros no console (exemplo): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
})();
