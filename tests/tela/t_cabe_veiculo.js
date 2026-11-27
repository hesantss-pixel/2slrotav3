// Só o que cabe no veículo (27/11/2026): com um veículo só, fica fora da viagem o pedido que
// sozinho passa do limite de volumes, do peso ou do m³. O limite de volumes fica guardado por tipo.
// Vale para "Gerar rota" e para "Montar eu mesmo no mapa". Dados inventados.
const { chromium } = require('playwright');
const path = require('path');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const ped = (nf, lat, lng, extra) => ({ nf, tipo: 'entrega', dest: 'Cliente ' + nf, cidade: 'Guarulhos', uf: 'SP', status: 'pendente',
  geoStatus: 'ok', geoPrec: 'numero', cep: '07010000', endereco: 'Rua Teste, ' + nf, lat, lng, ...extra });
const seed = seedEmpresa({
  config: { deposito: CD },
  pedidos_rota: {
    P1: ped('5001', -23.45, -46.53, { itens: 5, peso: 100 }),
    P2: ped('5002', -23.43, -46.50, { itens: 30, peso: 200 }),
    P3: ped('5003', -23.41, -46.47, { itens: 250, peso: 300 }),   // mais de 200 volumes
    P4: ped('5004', -23.47, -46.44, { itens: 2, peso: 900 }),     // mais pesado que a Fiorino
    P5: ped('5005', -23.39, -46.52, { peso: 50 }),                // nota sem volume
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
let enviados = [];
const rotasHttp = async (c) => {
  await c.route(/nominatim|viacep|maps\.googleapis|railway\.app\/(tracado|avaliar|geocode)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await c.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData()), v = body.veiculos[0];
    enviados = body.pedidos.map((x) => x.id);
    r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: v.nome, veiculo_id: v.id, pedidos: body.pedidos, km: 20, mins: 120 }],
      nao_alocados: [], fonte_distancia: 'OSRM', maior_que_bau: [] }) });
  });
};
const sem = (t) => (t || '').replace(/\s+/g, ' ').trim();
const aberto = (p, id) => p.evaluate((i) => document.getElementById(i).classList.contains('open'), id);

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotasHttp);
  const alertas = []; p.on('dialog', (d) => { alertas.push(d.message()); d.accept(); });
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.evaluate(() => window.selVeicD('fiorino')); await p.waitForTimeout(250);

  // campo e botões
  ok((await p.inputValue('#cap-volmax-d')) === '' && (await p.$$('#cap-volmax-chips button')).length === 6, 'Fiorino: campo de volumes vazio e 6 botões (até 10, 20, 40, 60, 200, sem limite)');
  ok((await p.getAttribute('#cap-volmax-chips button[data-v="0"]', 'aria-pressed')) === 'true' && /Sem limite: entra pedido de qualquer tamanho/.test(await p.textContent('#cap-volmax-nota')), 'sem limite marcado e explicado');
  await p.click('#cap-volmax-chips button:has-text("até 200")'); await p.waitForTimeout(100);
  let nota = sem(await p.textContent('#cap-volmax-nota'));
  ok((await p.inputValue('#cap-volmax-d')) === '200' && (await p.getAttribute('#cap-volmax-chips button[data-v="200"]', 'aria-pressed')) === 'true', '"até 200" preenche 200 e fica marcado');
  ok(nota === 'De 5 pedidos, 1 tem mais de 200 volumes e fica fora desta viagem. Continua pendente para a próxima. 1 pedido não traz o volume na nota e conta como 1.', 'a nota conta na hora quem fica fora: ' + nota);
  await p.fill('#cap-volmax-d', '40'); await p.waitForTimeout(100);
  ok(/^De 5 pedidos, 1 tem mais de 40 volumes/.test(sem(await p.textContent('#cap-volmax-nota'))) && (await p.getAttribute('#cap-volmax-chips button[data-v="40"]', 'aria-pressed')) === 'true', 'digitar 40 marca o botão 40 e refaz a conta');
  await p.fill('#cap-volmax-d', '12.5'); await p.waitForTimeout(100);
  ok(/Escreva um número inteiro de volumes/.test(await p.textContent('#cap-volmax-nota')), 'número quebrado: pede um inteiro');
  await p.fill('#cap-kg-d', '650'); await p.fill('#cap-maxped-d', '10');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok(alertas.some((a) => /Volumes por pedido: escreva um número inteiro/.test(a)) && await p.isVisible('#rot-step-cap'), 'Continuar com número quebrado avisa e não segue');
  // os kg de um botão de peso não desmarcam o de volume
  await p.fill('#cap-volmax-d', '200');
  await p.click('#presets-row-d .preset-chip >> nth=2'); await p.waitForTimeout(100);
  ok((await p.getAttribute('#cap-volmax-chips button[data-v="200"]', 'aria-pressed')) === 'true' && await p.evaluate(() => document.querySelector('#cap-volmax-chips button[data-v="200"]').classList.contains('on')), 'escolher o peso pelos botões não apaga a marca do volume');
  ok((await p.inputValue('#cap-kg-d')) === '650', 'botão de peso preenche 650 kg');

  // confirmação
  await p.click('text=Continuar →'); await p.waitForTimeout(250);
  const conf = sem(await p.textContent('#confirm-details-d'));
  ok(/Nesta viagem: 3 entregas pendentes/.test(conf), 'confirmação conta só os 3 que cabem: ' + conf.slice(0, 160));
  ok(/2 pedidos não cabem neste veículo: 1 com mais de 650 kg, 1 com mais de 200 volumes\. Continuam pendentes para a próxima viagem\. Ver quais/.test(conf), 'confirmação diz quantos ficam fora e por quê');
  ok(J(await p.evaluate(() => JSON.parse(localStorage.getItem('rotav3_volmax')))) === '{"fiorino":200}', 'o limite fica guardado para a Fiorino');
  await p.click('#confirm-details-d button:has-text("Ver quais")'); await p.waitForTimeout(200);
  let corpo = sem(await p.textContent('#par-corpo'));
  ok(await aberto(p, 'modal-parada') && sem(await p.textContent('#par-tit')) === '2 pedidos não cabem neste veículo' && (await p.$$('#par-corpo .par-item')).length === 2, '"Ver quais" abre a lista dos 2');
  ok(/NF 5004.*900 kg, mais que os 650 kg do veículo/.test(corpo) && /NF 5003.*250 volumes, mais que o limite de 200/.test(corpo) && (await p.$$('#par-corpo button:has-text("Abrir pedido completo")')).length === 2,
    'cada um com o motivo e "Abrir pedido completo"');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);

  // gerar rota: só os que cabem vão ao cálculo
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
  ok(J(enviados.sort()) === J(['P1', 'P2', 'P5']), 'o cálculo recebe só os 3 que cabem: ' + J(enviados));
  const res = sem(await p.textContent('#rot-step-results'));
  ok(/2 pedidos não cabem neste veículo: 1 com mais de 650 kg, 1 com mais de 200 volumes/.test(res) && /3 entregas/.test(res), 'o resultado repete quem ficou fora: ' + res.slice(0, 200));

  // lembra por tipo
  await p.evaluate(() => window.renderVeiculosD()); await p.waitForTimeout(200);
  await p.evaluate(() => window.selVeicD('vuc')); await p.waitForTimeout(150);
  ok((await p.inputValue('#cap-volmax-d')) === '', 'VUC: começa sem limite (o 200 é da Fiorino)');
  await p.evaluate(() => window.renderVeiculosD()); await p.waitForTimeout(200);
  await p.evaluate(() => window.selVeicD('fiorino')); await p.waitForTimeout(150);
  ok((await p.inputValue('#cap-volmax-d')) === '200', 'Fiorino de novo: volta com 200');

  // montar no mapa: só os que cabem aparecem
  await p.fill('#cap-kg-d', '650'); await p.fill('#cap-maxped-d', '10');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Montar eu mesmo no mapa'); await p.waitForTimeout(700);
  const pinos = await p.$$eval('#mapa-manual .leaflet-marker-icon .pino:not(.cd)', (l) => l.length);
  ok(pinos === 3, 'Montar no mapa: só os 3 que cabem viram ponto: ' + pinos);
  const mf = sem(await p.textContent('#man-fora'));
  ok(await p.isVisible('#man-fora') && /2 pedidos não cabem neste veículo e não aparecem no mapa: 1 com mais de 650 kg, 1 com mais de 200 volumes/.test(mf), 'o mapa avisa quem não aparece: ' + mf);
  const titulo = await p.getAttribute('#mapa-manual .leaflet-marker-icon >> nth=1', 'title');
  ok(/kg · \d+ volumes? ·/.test(titulo || ''), 'o ponto mostra os volumes: ' + (titulo || '').slice(0, 120));

  // nenhum cabe: avisa e não segue
  await p.evaluate(() => window.renderVeiculosD()); await p.waitForTimeout(200);
  await p.evaluate(() => window.selVeicD('fiorino')); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '40'); await p.fill('#cap-volmax-d', '1'); await p.fill('#cap-maxped-d', '10');
  alertas.length = 0;
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok(alertas.some((a) => /^Nenhum pedido desta viagem cabe neste veículo: 5 com mais de 40 kg\. Escolha um veículo maior\.$/.test(a)) && await p.isVisible('#rot-step-cap'),
    'nenhum cabe: avisa e fica na tela: ' + J(alertas));

  await p.fill('#cap-kg-d', '650'); await p.fill('#cap-volmax-d', '1');
  await p.evaluate(() => { window.__FAKE.setAt('empresas/emp1/pedidos_rota/P5/itens', 3); window.__FAKE.fire(); });
  await p.waitForTimeout(300); alertas.length = 0;
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok(alertas.some((a) => /: 1 com mais de 650 kg, 4 com mais de 1 volumes\. Escolha um veículo maior ou aumente o limite de volumes\.$/.test(a)), 'com volume no meio, sugere aumentar o limite: ' + J(alertas));
  // vários veículos: o limite não aparece (por enquanto é de um veículo só)
  await p.evaluate(() => window.renderVeiculosD()); await p.waitForTimeout(200);
  await p.evaluate(() => window.selFrotaD()); await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.getElementById('cap-vol-wrap').hidden), 'vários veículos: o campo de volumes some');
  ok(!errs.length, 'notebook sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close();

  // celular
  const c2 = await open(b, 'index.html', 390, 844, init, true, seed, rotasHttp);
  const q = c2.p;
  await q.evaluate(() => window.irParaPagina('roteirizacao')); await q.waitForTimeout(400);
  await q.evaluate(() => window.selVeicD('fiorino')); await q.waitForTimeout(250);
  await q.tap('#cap-volmax-chips button:has-text("até 200")'); await q.waitForTimeout(150);
  await q.locator('#cap-vol-wrap').scrollIntoViewIfNeeded();
  const lay = await q.evaluate(() => { const w = document.getElementById('cap-vol-wrap').getBoundingClientRect(); return { r: w.right, sw: document.documentElement.scrollWidth,
    alt: Math.min(...[...document.querySelectorAll('#cap-volmax-chips button')].map((x) => x.getBoundingClientRect().height)) }; });
  ok(lay.r <= 390 && lay.sw <= 390 && lay.alt >= 24, 'celular: campo e botões cabem na tela, botões com 24 px ou mais: ' + J(lay));
  await q.screenshot({ path: path.join(__dirname, 'volumes-390.png') });
  ok(!c2.errs.length, 'celular sem erros no console ' + J(c2.errs.slice(0, 3)));
  await c2.ctx.close();
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
