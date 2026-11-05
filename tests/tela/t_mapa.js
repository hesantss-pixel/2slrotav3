// Paradas sem endereço exato no mesmo ponto: um marcador só, aviso e fundo do OpenStreetMap
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const ped = {};
  for (let i = 1; i <= 8; i++) ped['PED-0004' + i] = { nf: 'PED-0004' + i, cidade: 'Guarulhos', peso: 50 + i, status: 'pendente', lat: -23.4566, lng: -46.5055, dest: 'Cliente ' + i, geoStatus: 'sem_cep' };
  ped['X1'] = { nf: 'X1', cidade: 'Arujá', peso: 10, status: 'pendente', lat: -23.39, lng: -46.32, dest: 'Com CEP', geoStatus: 'ok' };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'u', email: 'a@b.c', getIdToken: async () => 't' }, db: sd }; }, false,
    seedEmpresa({ config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped }, 'u'));
  const tiles = [];
  ctx.on('request', (r) => { if (/tile\.openstreetmap|cartocdn/.test(r.url())) tiles.push(r.url()); });
  await ctx.route(/railway\.app\/solve/, (r) => { const q = JSON.parse(r.request().postData()); const ps = q.pedidos.filter((x) => x.nf !== 'X1').slice(0, 6).concat(q.pedidos.filter((x) => x.nf === 'X1')).map((x, i) => ({ ...x, chegada_min: 444 + i * 15 })); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos: ps, km: 39, mins: 140 }], nao_alocados: ['PED-00047', 'PED-00048'], fora_da_janela: [], fonte_distancia: 'OSRM', regra_carga: 'so_entregas', salvo: false }) }); });
  await p.waitForTimeout(600);
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(200);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.fill('#cap-kg-d', '800'); await p.fill('#cap-maxped-d', '7');
  await p.click('text=Continuar →'); await p.waitForTimeout(150); await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1200);
  const marcas = await p.$$eval('#rota-map .leaflet-marker-icon', (e) => e.map((x) => x.textContent.trim()));
  ok(JSON.stringify(marcas) === JSON.stringify(['1–6', '7']), 'paradas no mesmo ponto viram um marcador "1–6"; a outra fica "7": ' + JSON.stringify(marcas));
  ok((await p.textContent('#rota-detail-d')).includes('6 paradas estão sem endereço exato'), 'aviso explica as paradas sem endereço exato');
  const nAprox = (await p.$$('#rota-detail-d .aprox-bt')).length;
  ok(nAprox === 6, 'cada parada sem endereço exato tem a etiqueta "local aproximado" (achei ' + nAprox + ')');
  ok((await p.textContent('#rot-step-results')).includes('Esta viagem levou 7 de 9'), 'explica quantos pedidos a viagem levou');
  ok((await p.textContent('#rota-map .leaflet-control-attribution')).includes('© OpenStreetMap'), 'mapa mostra o crédito do OpenStreetMap');
  ok(tiles.length > 0 && tiles.every((u) => u.startsWith('https://tile.openstreetmap.org/')), 'fundo do mapa vem do OpenStreetMap (sem CARTO): ' + tiles.length + ' blocos');
  await p.evaluate(() => { const g = document.getElementById('geo-status-bar'); if (g) g.remove(); });
  await p.screenshot({ path: 'mapa-agrupado.png', fullPage: true });
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
