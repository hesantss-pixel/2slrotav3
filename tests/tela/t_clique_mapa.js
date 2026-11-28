// Clicar ou tocar num ponto de qualquer mapa leva ao pedido (27/11/2026).
//  1. Mapa: a bolha de cidade (pedidos com ponto a confirmar) abre a lista; cada um abre o pedido;
//  2. Dashboard: a bolha da cidade leva ao Mapa já mostrando aquela cidade;
//  3. Rotas: a parada abre a janela com a baixa do motorista e a foto; "×2" vira lista;
//     pedido já entregue não tem "Abrir pedido", o que ainda está na lista tem;
//  4. Roteirização: parada de um pedido abre o pedido direto; "×2" vira lista;
//  5. no celular, o toque faz o mesmo e a janela cabe na tela.
// Pontos e nomes inventados.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const FOTO = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, 'canhoto.jpg')).toString('base64');
const agora = Date.now();
const ped = (nf, extra) => ({ nf, tipo: 'entrega', dest: 'Cliente ' + nf, cidade: 'Guarulhos', uf: 'SP', peso: 80, itens: 2, status: 'pendente',
  geoStatus: 'ok', geoPrec: 'numero', endereco: 'Rua Teste, ' + nf.slice(-2), bairro: 'Centro', cep: '07010000', ...extra });
const pedidos = {
  A1: ped('9001', { lat: -23.45, lng: -46.53 }),
  A2: ped('9002', { lat: -23.44, lng: -46.50 }),
  A3: ped('9003', { lat: -23.44, lng: -46.50, tipo: 'coleta' }),   // mesmo ponto do A2
  C1: ped('9201', { cidade: 'Campinas', lat: -22.905, lng: -47.06 }),
  C2: ped('9202', { cidade: 'Campinas', lat: -22.915, lng: -47.05 }),
  M1: ped('9301', { cidade: 'Mogi das Cruzes', geoStatus: 'sem_cep', cep: '', lat: -23.52, lng: -46.19 }),
  M2: ped('9302', { cidade: 'Mogi das Cruzes', geoStatus: 'sem_cep', cep: '', lat: -23.52, lng: -46.19 }),
  M3: ped('9303', { cidade: 'Mogi das Cruzes', geoStatus: 'sem_cep', cep: '', lat: -23.52, lng: -46.19 }),
  E1: ped('9101', { status: 'em_rota', rota_atual: 'R1', lat: -23.41, lng: -46.45 }),
  E2: ped('9102', { status: 'em_rota', rota_atual: 'R1', lat: -23.40, lng: -46.42 }),
  E3: ped('9103', { status: 'em_rota', rota_atual: 'R1', lat: -23.40, lng: -46.42, dest: '<b>Loja</b> <img src=x onerror=window.__xss=1>' }),
};
const parada = (id) => { const o = pedidos[id]; return { id, nf: o.nf, tipo: o.tipo, dest: o.dest, endereco: o.endereco, bairro: o.bairro, cidade: o.cidade, uf: o.uf, cep: o.cep,
  peso: o.peso, itens: o.itens, lat: o.lat, lng: o.lng, chegada_min: 600 }; };
const seed = seedEmpresa({
  config: { deposito: CD },
  pedidos_rota: pedidos,
  rotas_confirmadas: { R1: { id: 'R1', token: 'tokR1', criada_em: new Date(agora - 3600e3).toISOString(), data: new Date().toISOString().slice(0, 10),
    veiculo: 'VUC · TST4D44', motorista: 'Motorista Teste', km: 12, tempo_min: 90, num_paradas: 3, status: 'em_rota', volta: true,
    paradas: [parada('E1'), parada('E2'), parada('E3')] } },
  entregador: { tokR1: { expira: agora + 864e5,
    baixas: { 0: { status: 'feito', hora: agora - 1800e3, recebedor: 'Maria Souza', temFoto: true }, 1: { status: 'nao_feito', hora: agora - 900e3, motivo: 'Cliente ausente' } },
    fotos: { 0: FOTO } } },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const rotasHttp = async (c) => {
  await c.route(/nominatim|viacep|maps\.googleapis|railway\.app\/(tracado|avaliar|geocode)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await c.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData()), v = body.veiculos[0];
    const leva = ['A1', 'A2', 'A3'].map((id) => body.pedidos.find((x) => x.id === id)).filter(Boolean);
    r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: v.nome, veiculo_id: v.id, pedidos: leva, km: 20, mins: 120 }],
      nao_alocados: body.pedidos.filter((x) => !leva.includes(x)).map((x) => x.id), fonte_distancia: 'OSRM', maior_que_bau: [] }) });
  });
};
const sem = (t) => (t || '').replace(/\s+/g, ' ').trim();
const aberto = (p, id) => p.evaluate((i) => document.getElementById(i).classList.contains('open'), id);
const marcador = (p, mapa, txt) => p.locator(`#${mapa} .leaflet-marker-icon`).filter({ hasText: new RegExp('^' + txt + '$') });
// centro dos caminhos (bolhas e pinos) de um mapa, com o retângulo visível do mapa
const caminhos = (p, mapa, attr, val) => p.evaluate(([m, a, v]) => {
  const box = document.getElementById(m).getBoundingClientRect();
  return { box: { x: box.x, y: box.y, w: box.width, h: box.height },
    itens: [...document.querySelectorAll(`#${m} path.leaflet-interactive`)].filter((e) => e.getAttribute(a) === v)
      .map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }) };
}, [mapa, attr, val]);

(async () => {
  const b = await chromium.launch();
  // ── notebook ───────────────────────────────────────────────────────────
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotasHttp);
  p.on('dialog', (d) => d.accept());

  // 1. Mapa: bolha de cidade com pedidos sem ponto
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(500);
  let cm = await caminhos(p, 'mapa-completo', 'fill-opacity', '0.4');
  ok(cm.itens.length === 1, 'Mapa: uma bolha de cidade (Mogi, sem ponto): ' + cm.itens.length);
  await p.mouse.click(cm.itens[0].x, cm.itens[0].y); await p.waitForTimeout(250);
  let corpo = sem(await p.textContent('#par-corpo'));
  ok(await aberto(p, 'modal-parada') && sem(await p.textContent('#par-tit')) === 'Mogi das Cruzes', 'Mapa: a bolha abre a lista da cidade');
  ok(/3 pedidos com ponto a confirmar\. Abra um para marcar o ponto no mapa\./.test(corpo) && (await p.$$('#par-corpo .par-item')).length === 3
    && (await p.$$('#par-corpo button:has-text("Abrir pedido completo")')).length === 3, 'Mapa: 3 pedidos na lista, cada um com "Abrir pedido completo"');
  ok((await p.evaluate(() => document.activeElement && document.activeElement.closest('#modal-parada') !== null)), 'o foco vai para a janela (teclado)');
  await p.click('#par-corpo .par-item:nth-child(2) button:has-text("Abrir pedido completo")'); await p.waitForTimeout(250);
  ok(!(await aberto(p, 'modal-parada')) && await aberto(p, 'modal-pedido') && (await p.inputValue('#ped-nf')) === '9302', 'Mapa: "Abrir pedido completo" fecha a lista e abre o pedido certo (NF 9302)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!(await aberto(p, 'modal-pedido')), 'Esc fecha o pedido');
  // pinos de pedido continuam abrindo o pedido direto
  cm = await caminhos(p, 'mapa-completo', 'fill', '#0b9c6a');
  // pino fora da área do mapa: o Leaflet zera o desenho dele (largura 0)
  const dentro = (c) => c.itens.filter((i) => i.w > 0 && i.x > c.box.x && i.x < c.box.x + c.box.w && i.y > c.box.y && i.y < c.box.y + c.box.h);

  // 2. Dashboard: bolha da cidade leva ao Mapa mostrando a cidade
  await p.evaluate(() => window.irParaPagina('dashboard')); await p.waitForTimeout(500);
  const bol = await caminhos(p, 'mapa-dist', 'fill-opacity', '0.35');
  ok(bol.itens.length >= 3, 'Dashboard: bolhas das cidades no mapa: ' + bol.itens.length);
  const camp = bol.itens.slice().sort((x, y) => x.x - y.x)[0];   // Campinas é a mais a oeste
  await p.mouse.click(camp.x, camp.y); await p.waitForTimeout(600);
  ok(await p.evaluate(() => document.getElementById('page-mapa').style.display === 'block'), 'Dashboard: clicar na bolha abre a página Mapa');
  cm = await caminhos(p, 'mapa-completo', 'fill', '#0b9c6a');
  const vis = dentro(cm);
  ok(vis.length === 2, 'Mapa já mostra Campinas: os 2 pinos de lá na tela, os de Guarulhos fora: ' + vis.length + ' de ' + cm.itens.length);

  // 3. Rotas: parada com baixa e foto
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(700);
  const m1 = marcador(p, 'mini-map-rota-R1', '1'), m23 = marcador(p, 'mini-map-rota-R1', '2–3');
  ok(await m1.count() === 1 && await m23.count() === 1, 'Rotas: marcadores "1" e "2–3" no mini mapa');
  await m1.click(); await p.waitForTimeout(250);
  corpo = sem(await p.textContent('#par-corpo'));
  ok(await aberto(p, 'modal-parada') && sem(await p.textContent('#par-tit')) === 'Parada 1' && /VUC · TST4D44 · Motorista Teste/.test(corpo), 'Rotas: a parada 1 abre a janela com veículo e motorista');
  ok(/Entrega · NF 9101/.test(corpo) && /✓ Entregue às \d\d:\d\d · recebido por Maria Souza/.test(corpo) && /Rua Teste, 01, Centro, Guarulhos\/SP/.test(corpo) && /80 kg · 2 volumes · CEP 07010-000 · chega ~10:00/.test(corpo),
    'Rotas: mostra a nota, o endereço, peso, volumes, CEP, horário e a baixa: ' + corpo.slice(0, 200));
  ok((await p.$$('#par-corpo button:has-text("Ver foto")')).length === 1 && (await p.$$('#par-corpo button:has-text("Abrir pedido completo")')).length === 0,
    'Rotas: pedido já entregue tem "Ver foto" e não tem "Abrir pedido" (saiu da lista de pedidos)');
  await p.click('#par-corpo button:has-text("Ver foto")'); await p.waitForTimeout(400);
  const topo = await p.evaluate(() => { const r = document.querySelector('#modal-foto .modal-box').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + 20); return !!e && !!e.closest('#modal-foto'); });
  ok(await aberto(p, 'modal-foto') && (await p.$$('#modal-foto img')).length === 1 && topo, 'Rotas: a foto do canhoto abre por cima da janela da parada');
  await p.click('#modal-foto .modal-close'); await p.waitForTimeout(150);
  ok(await aberto(p, 'modal-parada'), 'fechar a foto volta para a janela da parada');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!(await aberto(p, 'modal-parada')), 'Esc fecha a janela da parada');
  await m23.click(); await p.waitForTimeout(250);
  corpo = sem(await p.textContent('#par-corpo'));
  ok(sem(await p.textContent('#par-tit')) === '2 notas no mesmo ponto' && (await p.$$('#par-corpo .par-item')).length === 2, 'Rotas: o "2–3" abre a lista das 2 notas');
  ok(/✗ Não realizada às \d\d:\d\d · Cliente ausente/.test(corpo) && /Aguardando a baixa do motorista\./.test(corpo), 'Rotas: uma com "não realizada" e o motivo, outra aguardando a baixa');
  ok((await p.$$('#par-corpo button:has-text("Abrir pedido completo")')).length === 2 && (await p.$$('#par-corpo button:has-text("Ver foto")')).length === 0, 'Rotas: as duas ainda na lista têm "Abrir pedido completo"; sem foto, sem botão de foto');
  ok(corpo.includes('<b>Loja</b> <img src=x onerror=window.__xss=1>') && !(await p.evaluate(() => window.__xss)) && (await p.$$('#par-corpo img')).length === 0, 'nome com HTML aparece como texto (sem injeção)');
  await p.click('#par-corpo .par-item:nth-child(2) button:has-text("Abrir pedido completo")'); await p.waitForTimeout(250);
  ok(await aberto(p, 'modal-pedido') && (await p.inputValue('#ped-nf')) === '9103', 'Rotas: abre o pedido certo da lista (NF 9103)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);

  // 4. Roteirização: resultado
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.evaluate(() => window.selVeicD('toco')); await p.waitForTimeout(200);
  await p.fill('#cap-kg-d', '6000'); await p.fill('#cap-maxped-d', '20');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
  const r1 = marcador(p, 'rota-map', '1'), r23 = marcador(p, 'rota-map', '2–3');
  ok(await r1.count() === 1 && await r23.count() === 1, 'Roteirização: marcadores "1" e "2–3" no mapa do resultado');
  await r1.click(); await p.waitForTimeout(250);
  ok(await aberto(p, 'modal-pedido') && !(await aberto(p, 'modal-parada')) && (await p.inputValue('#ped-nf')) === '9001', 'Roteirização: parada de um pedido abre o pedido direto (NF 9001)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  await r23.click(); await p.waitForTimeout(250);
  corpo = sem(await p.textContent('#par-corpo'));
  ok(await aberto(p, 'modal-parada') && /Escolha qual pedido abrir\./.test(corpo) && /Entrega · NF 9002/.test(corpo) && /Coleta · NF 9003/.test(corpo), 'Roteirização: "2–3" abre a lista com entrega e coleta');
  ok((await p.$$('#par-corpo .par-num.c')).length === 1, 'coleta aparece com o número vazado, como no mapa');
  await p.click('#par-corpo .par-item:nth-child(2) button:has-text("Abrir pedido completo")'); await p.waitForTimeout(250);
  ok(await aberto(p, 'modal-pedido') && (await p.inputValue('#ped-nf')) === '9003', 'Roteirização: abre o pedido escolhido (NF 9003)');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(!errs.length, 'notebook sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close();

  // ── celular: toque ─────────────────────────────────────────────────────
  const c2 = await open(b, 'index.html', 390, 844, init, true, seed, rotasHttp);
  const q = c2.p;
  await q.evaluate(() => window.irParaPagina('rotas')); await q.waitForTimeout(700);
  await marcador(q, 'mini-map-rota-R1', '2–3').scrollIntoViewIfNeeded();
  await marcador(q, 'mini-map-rota-R1', '2–3').tap(); await q.waitForTimeout(300);
  const caixa = await q.evaluate(() => { const r = document.querySelector('#modal-parada .modal-box').getBoundingClientRect(); return { l: r.left, r: r.right, sw: document.documentElement.scrollWidth }; });
  ok(await aberto(q, 'modal-parada') && caixa.l >= 0 && caixa.r <= 390 && caixa.sw <= 390, 'celular: o toque na parada abre a janela, que cabe na tela: ' + J(caixa));
  await q.screenshot({ path: path.join(__dirname, 'clique-parada-390.png') });
  await q.tap('#par-corpo .par-item:nth-child(1) button:has-text("Abrir pedido completo")'); await q.waitForTimeout(300);
  ok(await aberto(q, 'modal-pedido') && (await q.inputValue('#ped-nf')) === '9102', 'celular: "Abrir pedido completo" abre o pedido (NF 9102)');
  await q.evaluate(() => window.fecharPedido && window.fecharPedido()); await q.waitForTimeout(150);
  await q.evaluate(() => window.irParaPagina('dashboard')); await q.waitForTimeout(500);
  await q.locator('#mapa-dist').scrollIntoViewIfNeeded(); await q.waitForTimeout(200);
  const bq = await caminhos(q, 'mapa-dist', 'fill-opacity', '0.35');
  const cq = bq.itens.slice().sort((x, y) => x.x - y.x)[0];
  await q.touchscreen.tap(cq.x, cq.y); await q.waitForTimeout(600);
  ok(await q.evaluate(() => document.getElementById('page-mapa').style.display === 'block'), 'celular: tocar na bolha do Dashboard abre o Mapa');
  ok(!c2.errs.length, 'celular sem erros no console ' + J(c2.errs.slice(0, 3)));
  await c2.ctx.close();
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
