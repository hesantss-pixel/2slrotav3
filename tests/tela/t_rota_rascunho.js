// Rota gerada e não confirmada não some ao trocar de tela (23/11/2026)
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const seed = seedEmpresa({
    config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
    pedidos_rota: {
      '6001': { nf: '6001', tipo: 'entrega', cidade: 'Guarulhos', peso: 100, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Mercado Um', geoStatus: 'ok' },
      '6002': { nf: '6002', tipo: 'entrega', cidade: 'Arujá', peso: 80, status: 'pendente', lat: -23.39, lng: -46.32, dest: 'Loja Dois', geoStatus: 'ok' },
      'C_6003': { nf: '6003', tipo: 'coleta', cidade: 'Itaquaquecetuba', peso: 50, status: 'pendente', lat: -23.48, lng: -46.35, dest: 'Fornecedor Três', geoStatus: 'ok' },
    },
  });
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd };
  }, false, seed);
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.type()); d.accept(); });
  await ctx.route(/railway\.app\/solve/, async (r) => {
    const body = JSON.parse(r.request().postData());
    const peds = body.pedidos.map((x, i) => ({ ...x, chegada_min: 480 + i * 40 }));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: peds, km: 61.2, mins: 290 }], nao_alocados: [], fonte_distancia: 'OSRM', salvo: false }) });
  });
  await ctx.route(/railway\.app\/avaliar/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 50, mins: 200, chegada_min: [480, 520], fonte_distancia: 'OSRM', passa_da_jornada: false }) }));
  await p.waitForTimeout(600);
  const vis = (id) => p.evaluate((x) => { const e = document.getElementById(x); return !!e && getComputedStyle(e).display !== 'none'; }, id);

  // escolhe o veículo e troca de tela no meio
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(200);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '3000');
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(200);
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(200);
  ok(await vis('rot-step-cap') && (await p.inputValue('#cap-kg-d')) === '3000', 'no meio da escolha: volta onde parou, com a capacidade digitada');

  // gera a rota e troca de tela
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(await vis('rot-step-results'), 'rota gerada aparece');
  const antes = (await p.textContent('#rot-step-results')).replace(/\s+/g, ' ');
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(400);
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
  ok(await vis('rot-step-results') && !(await vis('rot-step-veiculo')), 'trocou de tela e voltou: a rota gerada continua lá');
  const depois = (await p.textContent('#rot-step-results')).replace(/\s+/g, ' ');
  ok(antes === depois && /Mercado Um/.test(depois), 'com as mesmas paradas');

  // fechar a página com rota não confirmada pede confirmação
  ok(await p.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === false), 'fechar ou recarregar com rota não confirmada avisa antes');

  // confirma: a próxima visita começa do zero
  await p.click('text=Confirmar saída do veículo'); await p.waitForTimeout(1800);
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(200);
  ok(await vis('rot-step-veiculo') && !(await vis('rot-step-results')), 'depois de confirmar, a Roteirização começa uma rota nova');
  ok(await p.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })) === true), 'e fechar a página não avisa mais');
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
