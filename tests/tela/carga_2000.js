// Carga: 2.000 pedidos pendentes de uma vez (não entra na suíte; roda à mão: node carga_2000.js).
// Mede quanto a tela leva para abrir cada página e para montar as rotas por cidade, e se
// aparece erro. Cidades da Grande SP com pontos inventados ao redor do centro de cada uma.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const N = +(process.argv[2] || 2000);
const CID = [['Guarulhos', -23.4628, -46.5333, 0.30], ['São Paulo', -23.5505, -46.6333, 0.25], ['Arujá', -23.3965, -46.3207, 0.07],
  ['Itaquaquecetuba', -23.4864, -46.3484, 0.08], ['Suzano', -23.5425, -46.3108, 0.06], ['Mogi das Cruzes', -23.5208, -46.1854, 0.06],
  ['Santo André', -23.6639, -46.5383, 0.06], ['Osasco', -23.5329, -46.7918, 0.05], ['Barueri', -23.5057, -46.879, 0.04], ['Diadema', -23.6861, -46.6228, 0.03]];
let seedR = 7; const rnd = () => (seedR = (seedR * 16807) % 2147483647) / 2147483647;
function cidade() { let x = rnd(); for (const c of CID) { x -= c[3]; if (x <= 0) return c; } return CID[0]; }
const ped = {};
for (let i = 0; i < N; i++) {
  const [nome, la, ln] = cidade(), id = String(500000 + i);
  ped[id] = { nf: id, tipo: rnd() < 0.7 ? 'entrega' : 'coleta', dest: 'Cliente ' + (i % 400), cidade: nome, uf: 'SP', endereco: 'Rua Teste ' + (i % 97) + ', ' + (10 + i % 900),
    peso: Math.round(20 + rnd() * 380), itens: 1 + Math.floor(rnd() * 8), status: 'pendente', geoStatus: 'ok', geoPrec: 'rua',
    lat: la + (rnd() - 0.5) * 0.08, lng: ln + (rnd() - 0.5) * 0.08, ...(rnd() < 0.6 ? { m3: Math.round(rnd() * 800) / 1000 + 0.05, m3Fonte: 'cte' } : {}) };
}
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
// motor simulado como o de verdade: uma viagem por veículo enviado, até maxPed paradas e capKg; o resto fica de fora
function motor(body) {
  const rs = [], fora = [], vs = body.veiculos.map((v) => ({ v, r: { veiculo: v.nome, veiculo_id: v.id, pedidos: [], kg: 0, km: 30, mins: 300 } }));
  for (const p of body.pedidos) {
    const x = vs.find(({ v, r }) => r.pedidos.length < v.maxPed && r.kg + (+p.peso || 0) <= v.capKg);
    if (x) { x.r.pedidos.push(p); x.r.kg += +p.peso || 0; } else fora.push(p);
  }
  vs.forEach(({ r }) => { if (r.pedidos.length) rs.push(r); });
  return { routes: rs, nao_alocados: fora, fonte_distancia: body.pedidos.length > 439 ? 'Haversine:limite' : 'OSRM', maior_que_bau: [] };
}
const t = async (rotulo, fn) => { const a = Date.now(); await fn(); const ms = Date.now() - a; console.log(`${rotulo.padEnd(46)} ${String(ms).padStart(6)} ms`); return ms; };

(async () => {
  const b = await chromium.launch();
  const errs2 = [];
  let enviados = 0;
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis|railway\.app\/(tracado|avaliar|geocode)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/solve/, (r) => { const body = JSON.parse(r.request().postData()); enviados = body.pedidos.length; r.fulfill({ contentType: 'application/json', body: JSON.stringify(motor(body)) }); });
  };
  const seed = seedEmpresa({ config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped });
  let ctx, p, errs;
  console.log(`${N} pedidos\n`);
  await t('abrir o sistema (até o painel)', async () => { ({ ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas)); });
  p.on('pageerror', (e) => errs2.push(String(e)));
  p.on('dialog', (d) => d.accept());
  const pag = async (nome, sel) => t(`página ${nome}`, async () => { await p.evaluate((n) => window.irParaPagina(n), nome); await p.waitForSelector(sel, { state: 'visible', timeout: 60000 }); await p.waitForTimeout(50); });
  await pag('pedidos', '#page-pedidos');
  console.log('  cartões de pedido na página:', await p.$$eval('#page-pedidos .ped-card, #page-pedidos [data-ped], #page-pedidos .rc-card', (e) => e.length));
  await t('busca na lista (digitar "500123")', async () => { const s = await p.$('#page-pedidos input[type=search], #ped-busca'); if (s) { await s.fill('500123'); await p.waitForTimeout(300); } });
  await pag('mapa', '#page-mapa');
  await p.waitForTimeout(1500);
  console.log('  marcadores no mapa:', await p.$$eval('#page-mapa .leaflet-marker-icon, #page-mapa .leaflet-interactive', (e) => e.length));
  await pag('produtos', '#cub-resumo');
  console.log('  resumo da cubagem:', (await p.textContent('#cub-resumo')).replace(/\s+/g, ' ').slice(0, 110));
  await pag('relatorios', '#page-relatorios');
  await pag('roteirizacao', '#page-roteirizacao');
  await p.waitForTimeout(500);
  await t('escolher o veículo (toco)', async () => { await p.evaluate(() => window.selVeicD('toco')); await p.waitForTimeout(100); });
  console.log('  nota da cidade:', (await p.textContent('#rot-cidade-nota').catch(() => '')).replace(/\s+/g, ' ').slice(0, 170));
  // todas as cidades de uma vez (passa do limite) e depois só Guarulhos
  const MAXPED = +(process.argv[3] || 20);
  await p.fill('#cap-kg-d', '6000'); await p.fill('#cap-maxped-d', String(MAXPED));
  for (const cid of ['todas', 'Guarulhos', 'Arujá']) {
    await t(`escolher a cidade (${cid})`, async () => { await p.selectOption('#rot-cidade-d', cid); await p.waitForTimeout(100); });
    console.log(`  [${cid}] nota:`, (await p.textContent('#rot-cidade-nota')).replace(/\s+/g, ' ').slice(0, 150));
    await p.click('text=Continuar →', { timeout: 5000 }).catch((e) => console.log('  (Continuar não clicou: ' + String(e).slice(0, 80) + ')')); await p.waitForTimeout(300);
    if (!(await p.isVisible('text=Gerar Rota Agora'))) { await p.screenshot({ path: '/tmp/carga-passo.png' }); console.log('  tela atual:', (await p.textContent('#page-roteirizacao')).replace(/\s+/g, ' ').slice(0, 400)); }
    await t(`gerar rotas (${cid})`, async () => { await p.click('text=Gerar Rota Agora'); await p.waitForSelector('.rota-tab-d', { timeout: 120000 }); });
    console.log(`  enviados ao motor: ${enviados}; viagens: ${await p.$$eval('.rota-tab-d', (e) => e.length)}; paradas na 1ª: ${await p.$$eval('#rota-detail-d .parada, #rota-detail-d [data-parada], #rota-detail-d li', (e) => e.length)}`);
    await p.screenshot({ path: `/tmp/carga-${cid}.png` });
    if (await p.$('.rota-tab-d >> nth=1')) await t('trocar de viagem (abrir a 2ª)', async () => { await p.click('.rota-tab-d >> nth=1'); await p.waitForTimeout(100); });
    const voltar = await p.$('text=Gerar outra rota'); if (voltar) { await voltar.click(); await p.waitForTimeout(400); }
    await p.evaluate(() => window.selVeicD('toco')); await p.waitForTimeout(200);
    await p.fill('#cap-kg-d', '6000'); await p.fill('#cap-maxped-d', String(MAXPED));
  }
  const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  console.log('\nmemória JS usada:', mem, 'MB');
  console.log('erros:', JSON.stringify([...errs, ...errs2].slice(0, 5)));
  await ctx.close(); await b.close();
})();
