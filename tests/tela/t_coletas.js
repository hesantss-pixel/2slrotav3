// Coletas e entregas: importação (XML/CSV), filtro, mapa, roteirização, confirmação e devolução
const { chromium } = require('playwright');
const { open } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const X = (f) => __dirname + '/xml/' + f;
const chave = (n) => ('3526101234567800019955001' + String(n).padStart(9, '0') + '1' + '0'.repeat(44)).slice(0, 44);

(async () => {
  const b = await chromium.launch();
  // desde a separação por empresa, os dados ficam em empresas/<eid>/ e a conta precisa de membros
  const PEDIDOS = {
      '4001': { nf: '4001', cidade: 'Barueri', peso: 100, status: 'pendente', lat: -23.51, lng: -46.87 }, // antigo, sem tipo
      'C_4002': { nf: '4002', tipo: 'coleta', cidade: 'Osasco', peso: 60, status: 'pendente', lat: -23.53, lng: -46.79, dest: 'Fornecedor X' },
      [chave(12345)]: { nf: '12345', tipo: 'entrega', cidade: 'Barueri', peso: 1, status: 'despachado', lat: -23.5, lng: -46.8 },
  };
  const seed = {
    acesso: { 'uid-ana': true },
    membros: { 'uid-ana': 'emp1' },
    empresas: { emp1: { info: { nome: 'Transportadora Exemplo' },
      config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
      pedidos_rota: PEDIDOS } },
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' }, db: sd };
  }, false, seed);
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  let solveReq = null, modoSolve = 'misto';
  await ctx.route(/railway\.app\/solve/, async (r) => {
    solveReq = JSON.parse(r.request().postData());
    const peds = solveReq.pedidos.slice().sort((a, b) => (a.tipo === 'coleta') - (b.tipo === 'coleta')).slice(0, 6);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: peds, km: 30.2, mins: 95 }], nao_alocados: [], fonte_distancia: 'OSRM', regra_carga: modoSolve === 'misto' ? 'entregas_antes_das_coletas' : 'so_coletas', salvo: false }) });
  });
  const db = () => p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  await p.waitForTimeout(600);

  // ── Pedidos: filtro ────────────────────────────────────────────────────
  await p.click('.sb-item[data-page="pedidos"]'); await p.waitForTimeout(300);
  const filtro = await p.$$eval('#page-pedidos [data-filtro] button', (e) => e.map((x) => x.textContent));
  ok(JSON.stringify(filtro) === JSON.stringify(['Todos2', 'Entregas1', 'Coletas1']), 'filtro mostra as contagens (pedido antigo sem tipo conta como entrega): ' + filtro.join(' | '));
  await p.click('#page-pedidos [data-filtro] button[data-v="coleta"]'); await p.waitForTimeout(150);
  let cards = await p.$$eval('#reg-cards-grid .rc-card-name', (e) => e.map((x) => x.textContent));
  ok(cards.length === 1 && cards[0] === 'Osasco', 'filtro Coletas mostra só as coletas: ' + cards.join(','));
  await p.click('#page-pedidos [data-filtro] button[data-v="todos"]'); await p.waitForTimeout(150);

  // ── Importar XML como COLETA (vários arquivos, com erros no meio) ────────
  await p.click('#imp-tipo button[data-tipo="coleta"]');
  ok((await p.textContent('#imp-help')).includes('remetente'), 'escolher Coletas explica que usa o endereço do remetente');
  await p.setInputFiles('#file-input', [X('nfe-12345.xml'), X('nfe-12346.xml'), X('nfe-12347.xml'), X('cte.xml'), X('quebrado.xml')]);
  await p.waitForTimeout(1500);
  let d = await db();
  const c1 = d['C_' + chave(12345)], c2 = d['C_' + chave(12346)], c3 = d['C_' + chave(12347)];
  ok(c1 && c1.tipo === 'coleta' && c1.cidade === 'Guarulhos' && c1.cep === '07180000' && c1.dest === 'Exemplo' && c1.endereco === 'Rua das Indústrias, 100', 'XML como coleta: endereço do remetente (Guarulhos, CEP 07180000): ' + JSON.stringify(c1 && [c1.cidade, c1.cep, c1.dest, c1.endereco]));
  ok(c1 && Math.abs(c1.peso - 120.5) < 0.01 && c1.itens === 3 && c1.nf === '12345', 'XML: peso bruto 120,5 kg, 3 volumes e número da nota');
  ok(c2 && c2.cidade === 'Diadema' && c2.cep === '09950000' && Math.abs(c2.peso - 100.5) < 0.01, 'XML com local de retirada: coleta vai para a retirada (Diadema) e soma os volumes (100,5 kg)');
  ok(c3 && c3.peso === 100 && dialogs.some((m) => m.includes('sem peso')), 'nota sem peso: pergunta antes e entra com 100 kg');
  ok(d[chave(12345)].status === 'despachado' && d[chave(12345)].peso === 1, 'a entrega da mesma nota (já despachada) não foi mexida');
  let msg = await p.textContent('#import-msg-pedidos');
  ok(msg.includes('3 coletas importadas') && msg.includes('cte.xml: é um CT-e') && msg.includes('quebrado.xml: XML inválido'), 'mensagem resume o que entrou e o que não deu para ler: ' + msg);

  // ── Importar XML como ENTREGA (uma já está em rota) ──────────────────────
  await p.click('#imp-tipo button[data-tipo="entrega"]');
  await p.setInputFiles('#file-input', [X('nfe-12345.xml'), X('nfe-12346.xml'), X('nfe-12347.xml')]);
  await p.waitForTimeout(1500);
  d = await db();
  const e2 = d[chave(12346)], e3 = d[chave(12347)];
  ok(e2 && e2.tipo === 'entrega' && e2.cidade === 'Santos' && e2.cep === '11015000' && e2.dest === 'CD do Cliente', 'XML como entrega com local de entrega: vai para Santos, "CD do Cliente"');
  ok(e3 && e3.cidade === 'Barueri' && e3.endereco === 'Avenida Central, 2000 - Galpão 3', 'XML como entrega: endereço do destinatário com complemento');
  ok(d[chave(12345)].status === 'despachado' && d[chave(12345)].peso === 1, 'reimportar nota já despachada não altera nada');
  msg = await p.textContent('#import-msg-pedidos');
  ok(msg.includes('2 entregas importadas') && msg.includes('1 nota já estava em rota'), 'mensagem avisa a nota que já estava em rota: ' + msg);

  // ── CSV com coluna "tipo" ────────────────────────────────────────────────
  await p.setInputFiles('#file-input', X('misto.csv')); await p.waitForTimeout(1000);
  d = await db();
  ok(d['C_7001'] && d['C_7001'].tipo === 'coleta' && d['7002'].tipo === 'entrega' && d['7003'].tipo === 'entrega', 'CSV: coluna tipo vale linha a linha (vazio = o escolhido na tela)');

  // ── Escape de nomes vindos das notas ─────────────────────────────────────
  await p.evaluate(() => document.querySelectorAll('.rc-card').forEach((c) => c.classList.add('exp')));
  await p.waitForTimeout(200);
  const xss = await p.evaluate(() => ({ flag: window.__xss, imgs: document.querySelectorAll('#reg-cards-grid img').length, txt: document.getElementById('reg-cards-grid').textContent.includes('<img src=x') }));
  ok(!xss.flag && xss.imgs === 0 && xss.txt, 'nome com HTML na nota aparece como texto, sem executar nada');
  const chaves = Object.keys(await db()).sort();
  const esperado = ['4001', 'C_4002', chave(12345), 'C_' + chave(12345), 'C_' + chave(12346), 'C_' + chave(12347), chave(12346), chave(12347), 'C_7001', '7002', '7003'].sort();
  ok(JSON.stringify(chaves) === JSON.stringify(esperado), 'nenhum registro solto criado (a busca de endereço grava na chave certa)');
  const f2 = await p.$$eval('#page-pedidos [data-filtro] button', (e) => e.map((x) => x.textContent));
  ok(JSON.stringify(f2) === JSON.stringify(['Todos10', 'Entregas5', 'Coletas5']), 'contagens atualizam depois da importação: ' + f2.join(' | '));
  await p.click('#page-pedidos [data-filtro] button[data-v="todos"]'); await p.waitForTimeout(150);
  await p.screenshot({ path: 'col-pedidos-1440.png', fullPage: true });

  // ── Dashboard e Mapa ─────────────────────────────────────────────────────
  await p.click('.sb-item[data-page="dashboard"]'); await p.waitForTimeout(200);
  ok((await p.textContent('#kpi-split')) === '5 entregas · 5 coletas', 'dashboard mostra a divisão entregas · coletas');
  await p.click('.sb-item[data-page="mapa"]'); await p.waitForTimeout(400);
  await p.click('#page-mapa [data-filtro] button[data-v="coleta"]'); await p.waitForTimeout(250);
  const leg = await p.textContent('#mapa-completo-legenda');
  ok(leg.includes('Entrega') && leg.includes('Coleta') && leg.includes('CD Guarulhos'), 'mapa tem legenda (entrega, coleta, CD)');
  ok((await p.getAttribute('#page-mapa [data-filtro] button[data-v="coleta"]', 'aria-pressed')) === 'true', 'filtro do mapa fica marcado');
  await p.screenshot({ path: 'col-mapa-1440.png' });
  await p.click('#page-mapa [data-filtro] button[data-v="todos"]');

  // ── Roteirização mista ───────────────────────────────────────────────────
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(200);
  ok((await p.getAttribute('#rot-tipo button[data-v="todos"]', 'aria-pressed')) === 'true', 'com os dois tipos pendentes, já vem "Entregas e coletas"');
  ok((await p.textContent('#rot-tipo-nota')).includes('só depois as coletas'), 'explica a regra: entregas primeiro, coletas depois');
  await p.fill('#cap-kg-d', '3000'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok((await p.textContent('#confirm-details-d')).includes('5 entregas e 5 coletas pendentes'), 'confirmação diz o que entra na viagem');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq && solveReq.pedidos.length === 10 && solveReq.pedidos.some((x) => x.tipo === 'coleta') && solveReq.pedidos.every((x) => x.id), '/solve recebe entregas e coletas, cada uma com sua chave');
  const res = await p.textContent('#rot-step-results');
  ok(res.includes('PARADAS') && /\d+ entregas? · \d+ coletas?/.test(res) && res.includes('sai com') && res.includes('a bordo'), 'resultado mostra paradas por tipo e a carga a bordo');
  ok((await p.$$('#rota-detail-d .tipo-tag.c')).length > 0 && (await p.$$('#rota-detail-d .delivery-mini-num.c')).length > 0, 'paradas de coleta marcadas na sequência');
  await p.screenshot({ path: 'col-rota-1440.png', fullPage: true });

  // ── Roteirização só de coletas + confirmar + devolver ───────────────────
  modoSolve = 'coletas';
  await p.click('#rot-step-results .btn-voltar-topo'); await p.waitForTimeout(200);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(200);
  await p.click('#rot-tipo button[data-v="coleta"]');
  ok((await p.textContent('#rot-tipo-nota')).includes('sai vazio'), 'só coletas: veículo sai vazio');
  await p.fill('#cap-kg-d', '3000'); await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq.pedidos.length === 5 && solveReq.pedidos.every((x) => x.tipo === 'coleta'), '/solve recebe só as 5 coletas');
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1400);
  d = await db();
  const col = ['C_4002', 'C_' + chave(12345), 'C_' + chave(12346), 'C_' + chave(12347), 'C_7001'];
  ok(col.every((k) => d[k].status === 'despachado') && d['4001'].status === 'pendente' && d[chave(12346)].status === 'pendente', 'confirmar: só as coletas viram "despachado" (as entregas da mesma nota continuam pendentes)');
  const conf = Object.values(await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas))[0];
  ok(conf && conf.coletas === 5 && conf.entregas === 0 && conf.paradas.every((x) => x.id.startsWith('C_') && x.tipo === 'coleta'), 'rota salva no histórico com chave e tipo de cada parada');
  ok((await p.textContent('#rotas-confirmadas-lista')).includes('Coleta NF'), 'página Rotas mostra "Coleta NF ..."');
  await p.screenshot({ path: 'col-rotas-1440.png' });
  await p.click('text=↩ Devolver ao sistema'); await p.waitForTimeout(500);
  d = await db();
  ok(col.every((k) => d[k].status === 'pendente') && Object.keys(d).length === esperado.length, 'devolver: as coletas voltam a pendentes, sem criar registros novos');
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));

  // ── Celular ──────────────────────────────────────────────────────────────
  const m = await open(b, 'index.html', 390, 844, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 't' }, db: sd };
  }, true, { ...seed, pedidos_rota: d });
  await m.p.waitForTimeout(600);
  await m.p.evaluate(() => window.irParaPagina('pedidos')); await m.p.waitForTimeout(300);
  const larg = await m.p.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 390, 'celular: página Pedidos sem rolagem lateral (' + larg + 'px)');
  await m.p.screenshot({ path: 'col-pedidos-390.png', fullPage: true });
  await m.p.evaluate(() => window.irParaPagina('roteirizacao')); await m.p.waitForTimeout(200);
  await m.p.click('#veh-grid .veh-card >> nth=0'); await m.p.waitForTimeout(200);
  ok(await m.p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'celular: escolha Entregas/Coletas cabe na tela');
  await m.p.screenshot({ path: 'col-rot-390.png' });
  ok(!m.errs.length, 'celular sem erros: ' + JSON.stringify(m.errs.slice(0, 3)));
  await b.close();
})();
