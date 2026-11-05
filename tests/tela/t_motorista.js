// Janela de horário + link do motorista (escritório → motorista → escritório)
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const hoje = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const amanha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

(async () => {
  const b = await chromium.launch();
  const seed = seedEmpresa({
    config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
    pedidos_rota: {
      '6001': { nf: '6001', tipo: 'entrega', cidade: 'Guarulhos', peso: 100, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Mercado <b>Teste</b>', endereco: 'Rua A, 10', bairro: 'Centro', cep: '07010000', uf: 'SP', geoStatus: 'ok' },
      '6002': { nf: '6002', tipo: 'entrega', cidade: 'Arujá', peso: 80, status: 'pendente', lat: -23.39, lng: -46.32, dest: 'Loja Agendada', agendado: true, dataAgendada: hoje, horaEntrega: '10:00', horaFim: '11:00', geoStatus: 'ok' },
      'C_6003': { nf: '6003', tipo: 'coleta', cidade: 'Itaquaquecetuba', peso: 50, status: 'pendente', lat: -23.48, lng: -46.35, dest: 'Fornecedor Z', geoStatus: 'ok' },
      '6004': { nf: '6004', tipo: 'entrega', cidade: 'Guarulhos', peso: 30, status: 'pendente', lat: -23.46, lng: -46.5, dest: 'Amanhã SA', agendado: true, dataAgendada: amanha, horaEntrega: '09:00', geoStatus: 'ok' },
    },
  });
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd };
  }, false, seed);
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  let body = null;
  await ctx.route(/railway\.app\/solve/, async (r) => {
    body = JSON.parse(r.request().postData());
    const ord = ['6001', '6002', '6003'];
    const peds = ord.map((nf) => body.pedidos.find((x) => x.nf === nf)).filter(Boolean).map((x, i) => ({ ...x, chegada_min: [490, 600, 680][i] }));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: peds, km: 61.2, mins: 290 }], nao_alocados: ['7777'], fora_da_janela: [], fonte_distancia: 'OSRM', regra_carga: 'entregas_antes_das_coletas', salvo: false }) });
  });
  await p.waitForTimeout(600);

  // ── Roteirização com data, saída e janela ─────────────────────────────────
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(200);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(150);
  ok((await p.inputValue('#rot-data-d')) === hoje, 'data da viagem já vem com hoje');
  await p.fill('#rot-saida-d', '07:30'); await p.fill('#cap-kg-d', '3000');
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  const conf = await p.textContent('#confirm-details-d');
  ok(conf.includes('07:30') && conf.includes('Com horário marcado: 1') && conf.includes('1 agendado para outro dia fica de fora'), 'confirmação mostra saída, horário marcado e agendado de outro dia: ' + conf.replace(/\s+/g, ' ').slice(0, 220));
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(body && body.hora_saida === 450, '/solve recebe a hora de saída (07:30 = 450 min)');
  ok(body && !body.pedidos.some((x) => x.nf === '6004'), 'agendado para amanhã não vai para a viagem de hoje');
  const ag = body && body.pedidos.find((x) => x.nf === '6002');
  ok(ag && ag.janela_ini === 600 && ag.janela_fim === 660, 'agendado de hoje vai com a janela 10:00–11:00');
  const res = await p.textContent('#rot-step-results');
  ok(res.includes('~08:10') && res.includes('Horário 10:00–11:00'), 'resultado mostra a chegada prevista e o horário marcado');
  ok(res.includes('Esta viagem levou 3 de 4') && res.includes('continuam pendentes'), 'resultado explica quantos ficaram para a próxima viagem e por quê');

  // ── Confirmar: rota + link do motorista ───────────────────────────────────
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1400);
  let db = await p.evaluate(() => window.__FAKE.db);
  const rota = Object.values(db.empresas.emp1.rotas_confirmadas)[0];
  const token = rota.token;
  const ent = db.entregador && db.entregador[token];
  ok(token && token.length >= 22 && /^[A-Za-z0-9_-]+$/.test(token), 'confirmar cria um link do motorista com código longo: ' + token);
  ok(ent && ent.info.saida === 450 && ent.info.data === hoje && ent.paradas.length === 3 && ent.expira > Date.now() + 6 * 864e5, 'dados do motorista gravados (saída, data, 3 paradas, vale 7 dias)');
  ok(ent && ent.paradas.every((x) => !('id' in x)) && ent.paradas[1].janela_ini === 600, 'link não leva as chaves internas; leva o horário marcado');
  ok(['6001', '6002', 'C_6003'].every((k) => db.empresas.emp1.pedidos_rota[k].status === 'despachado' && db.empresas.emp1.pedidos_rota[k].rota_atual === rota.id) && db.empresas.emp1.pedidos_rota['6004'].status === 'pendente', 'pedidos despachados e ligados à rota');

  // ── Página Rotas: enviar pelo WhatsApp ────────────────────────────────────
  await p.evaluate(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }; });
  await p.click('text=Enviar pelo WhatsApp'); await p.waitForTimeout(100);
  const wa = await p.evaluate(() => window.__abertos[0] || '');
  const msgWa = decodeURIComponent(wa.split('text=')[1] || '');
  ok(wa.startsWith('https://wa.me/?text=') && msgWa.includes('/motorista.html#' + token) && msgWa.includes('3 paradas') && msgWa.includes('saída 07:30'), 'WhatsApp abre com a mensagem e o link da rota');
  ok((await p.textContent('#rotas-confirmadas-lista')).includes('0 de 3 paradas com baixa'), 'rota mostra o andamento (0 de 3)');

  // ── Motorista abre o link ─────────────────────────────────────────────────
  const dctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, geolocation: { latitude: -23.4501, longitude: -46.5302 }, permissions: ['geolocation'] });
  const path = require('path');
  await dctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ path: path.join(__dirname, 'fakefb', f), contentType: 'text/javascript' }); });
  await dctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
  await dctx.addInitScript((sd) => { window.__FAKE = { user: null, db: sd }; }, { entregador: db.entregador });
  const m = await dctx.newPage();
  const merrs = [];
  m.on('pageerror', (e) => merrs.push(e.message));
  m.on('console', (x) => { if (x.type() === 'error' && !/net::|Failed to load resource/.test(x.text())) merrs.push(x.text()); });
  await m.goto('http://127.0.0.1:8771/motorista.html#' + token); await m.waitForTimeout(700);
  const txt = await m.textContent('#app');
  ok(txt.includes('VUC') && txt.includes('0 de 3') && txt.includes('saída 07:30') && txt.includes('CD Guarulhos'), 'motorista vê o resumo da rota');
  ok(txt.includes('Previsto ~08:10') && txt.includes('Horário 10:00–11:00') && txt.includes('Rua A, 10, Centro, Guarulhos - SP, CEP 07010-000'), 'motorista vê endereço completo, previsão e horário marcado');
  ok((await m.$$('#p-0.prox')).length === 1 && (await m.$$('.tag.c')).length === 1, 'primeira parada marcada como PRÓXIMA; coleta identificada');
  ok(txt.includes('Mercado <b>Teste</b>') && (await m.$$('.dest b')).length === 0, 'nome vindo da nota aparece como texto');
  const gm = await m.getAttribute('#p-0 a.nav >> nth=0', 'href');
  ok(gm.startsWith('https://www.google.com/maps/dir/?api=1&destination=') && decodeURIComponent(gm).includes('Rua A, 10'), 'botão Google Maps leva ao endereço da parada');
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, 'cabe no celular sem rolagem lateral');
  await m.screenshot({ path: 'mot-1.png', fullPage: true });

  // baixa 1: entregue com recebedor e foto
  await m.click('#p-0 [data-acao="feito"]'); await m.waitForTimeout(150);
  await m.fill('#p-0 input[name="recebedor"]', 'Maria Souza');
  await m.setInputFiles('#p-0 input[name="foto"]', path.join(__dirname, 'canhoto.jpg')); await m.waitForTimeout(300);
  ok((await m.$$('#prev-0 img')).length === 1, 'foto escolhida aparece antes de confirmar');
  await m.screenshot({ path: 'mot-form.png' });
  await m.click('#p-0 button[type="submit"]'); await m.waitForTimeout(1500);
  let mdb = await m.evaluate(() => window.__FAKE.db.entregador);
  const b0 = mdb[token].baixas && mdb[token].baixas[0];
  const f0 = mdb[token].fotos && mdb[token].fotos[0];
  ok(b0 && b0.status === 'feito' && b0.recebedor === 'Maria Souza' && b0.temFoto === true && typeof b0.hora === 'number', 'baixa "entregue" gravada com recebedor, hora e foto');
  ok(f0 && f0.startsWith('data:image/jpeg;base64,') && f0.length < 380000, 'foto de 1,4 MB compactada para ' + Math.round((f0 || '').length / 1024) + ' KB');
  ok(b0 && Math.abs(b0.lat + 23.4501) < 1e-4 && Math.abs(b0.lng + 46.5302) < 1e-4, 'baixa guarda a localização do celular');
  ok(Object.keys(b0 || {}).every((k) => ['status', 'hora', 'motivo', 'obs', 'recebedor', 'temFoto', 'lat', 'lng'].includes(k)), 'baixa só tem os campos que as regras do banco aceitam');

  // baixa 2: não realizado
  await m.click('#p-1 [data-acao="nao"]'); await m.waitForTimeout(150);
  await m.selectOption('#p-1 select[name="motivo"]', 'Cliente ausente');
  await m.fill('#p-1 input[name="obs"]', 'Portão fechado');
  await m.click('#p-1 button[type="submit"]'); await m.waitForTimeout(1200);
  mdb = await m.evaluate(() => window.__FAKE.db.entregador);
  const b1 = mdb[token].baixas[1];
  ok(b1 && b1.status === 'nao_feito' && b1.motivo === 'Cliente ausente' && b1.obs === 'Portão fechado' && !b1.temFoto, 'baixa "não realizado" com motivo e observação');
  const txt2 = await m.textContent('#app');
  ok(txt2.includes('2 de 3') && txt2.includes('✓ Entregue às') && txt2.includes('✗ Não realizado: Cliente ausente'), 'tela do motorista atualiza o andamento');
  ok((await m.$$('#p-2.prox')).length === 1, 'a próxima parada passa a ser a coleta');
  await m.screenshot({ path: 'mot-2.png', fullPage: true });
  await m.click('#p-1 [data-acao="corrigir"]'); await m.waitForTimeout(150);
  ok((await m.inputValue('#p-1 select[name="motivo"]')) === 'Cliente ausente', 'corrigir abre a baixa com o motivo já preenchido');
  await m.click('#p-1 [data-acao="cancelar"]');
  ok(!merrs.length, 'motorista sem erros no console: ' + JSON.stringify(merrs.slice(0, 3)));

  // link encerrado / incompleto
  const x1 = await dctx.newPage();
  await x1.addInitScript(() => { window.__FAKE.denyAll = true; });
  await x1.goto('http://127.0.0.1:8771/motorista.html#' + token); await x1.waitForTimeout(500);
  ok((await x1.textContent('#app')).includes('Link encerrado'), 'link expirado/encerrado: mensagem clara');
  const x2 = await dctx.newPage();
  await x2.goto('http://127.0.0.1:8771/motorista.html#abc'); await x2.waitForTimeout(400);
  ok((await x2.textContent('#app')).includes('Link incompleto'), 'link cortado: pede o link de novo');

  // ── Escritório recebe as baixas ───────────────────────────────────────────
  await p.evaluate((ent) => { window.__FAKE.setAt('entregador', ent); window.__FAKE.fire(); }, mdb);
  await p.waitForTimeout(700);
  db = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  ok(db['6001'].status === 'entregue' && db['6001'].baixa && db['6001'].baixa.recebedor === 'Maria Souza', 'entregue pelo motorista → pedido "entregue" com quem recebeu');
  ok(db['6002'].status === 'pendente' && db['6002'].ocorrencia && db['6002'].ocorrencia.motivo === 'Cliente ausente', 'não realizado → pedido volta para pendente com a ocorrência');
  ok(db['C_6003'].status === 'despachado', 'parada sem baixa continua despachada');
  const lista = await p.textContent('#rotas-confirmadas-lista');
  ok(lista.includes('2 de 3 paradas com baixa') && lista.includes('1 não realizada (voltou'), 'página Rotas mostra o andamento das baixas');
  ok((await p.$$('.parada-chip.ok')).length === 1 && (await p.$$('.parada-chip.nok')).length === 1, 'paradas com baixa ficam verde/vermelho');
  await p.click('.parada-chip.ok button'); await p.waitForTimeout(400);
  ok((await p.$$('#modal-foto.open img')).length === 1 && (await p.textContent('#foto-corpo')).includes('Maria Souza'), 'escritório vê a foto do canhoto e quem recebeu');
  await p.screenshot({ path: 'esc-foto.png' });
  await p.click('#modal-foto .modal-close');
  await p.screenshot({ path: 'esc-rotas.png', fullPage: true });

  // encerrar link e devolver
  await p.click('text=Encerrar link'); await p.waitForTimeout(400);
  db = await p.evaluate(() => window.__FAKE.db);
  ok(db.entregador[token].expira <= Date.now() && db.empresas.emp1.rotas_confirmadas[rota.id].link_expira <= Date.now(), 'encerrar link: o link deixa de valer');
  ok((await p.textContent('#rotas-confirmadas-lista')).includes('Link encerrado'), 'tela mostra "Link encerrado" e a opção de gerar outro');
  await p.click('text=↩ Devolver ao sistema'); await p.waitForTimeout(500);
  db = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  ok(db['6001'].status === 'entregue' && db['C_6003'].status === 'pendente', 'devolver: só volta o que não teve baixa (entregue continua entregue)');

  // agendamento com faixa
  await p.evaluate(() => window.irParaPagina('dashboard')); await p.waitForTimeout(200);
  await p.click('text=+ Agendar'); await p.fill('#ag-search-inp-d', '6003'); await p.waitForTimeout(200);
  await p.click('#ag-search-results-d .search-item >> nth=0');
  await p.fill('#ag-data-d', amanha); await p.fill('#ag-hora-d', '14:00');
  await p.click('text=Salvar Agendamento'); await p.waitForTimeout(400);
  db = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  ok(db['C_6003'].horaEntrega === '14:00' && db['C_6003'].horaFim === '15:00', 'agendar sem "até": faixa de 1 hora (14:00–15:00)');
  ok(!errs.length, 'escritório sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
