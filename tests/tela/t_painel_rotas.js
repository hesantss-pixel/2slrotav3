// Painel: os cartões ROTAS e KM DAS ROTAS só contam rota CONFIRMADA.
// Antes, qualquer roteirização aberta na tela (sem confirmar) já era gravada no
// Firebase e aparecia no painel como se a rota estivesse pronta — e nunca saía de lá.
// Agora: sem rota confirmada o painel fica em zero; devolver ou apagar volta para zero.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };

const seed = (arg) => {
  const base = (nf, lat, lng) => ({ id: nf, nf, tipo: 'entrega', cidade: 'Guarulhos', uf: 'SP', dest: 'Cliente ' + nf,
    endereco: 'Rua ' + nf + ', 10', cep: '07010000', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', lat, lng });
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: arg.cd },
        pedidos_rota: { 9001: base('9001', -23.45, -46.53), 9002: base('9002', -23.44, -46.50), 9003: base('9003', -23.39, -46.32) } } } } };
};

const painel = (p) => p.evaluate(() => ({
  rotas: document.getElementById('kpi-rotas').textContent.trim(),
  rotasSub: document.getElementById('kpi-rotas-d').textContent.trim(),
  km: document.getElementById('kpi-tempo').textContent.trim(),
  kmSub: document.getElementById('kpi-tempo-d').textContent.trim(),
}));

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, { cd: CD });
  await ctx.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData());
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos: body.pedidos, km: 31.2, mins: 120, volta: false, tracado: null }],
      nao_alocados: [], fonte_distancia: 'OSRM' }) });
  });
  await ctx.route(/railway\.app\/(avaliar|tracado|km-rastro)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  p.on('dialog', (d) => d.accept());
  await p.waitForTimeout(800);

  // ── 1. nada roteirizado ainda ─────────────────────────────────────────────
  let v = await painel(p);
  ok(v.rotas === '0', 'sem rota: o cartão ROTAS mostra 0 (e não uma estimativa) — ' + v.rotas);
  ok(v.rotasSub === 'nenhuma rota confirmada', 'e explica: nenhuma rota confirmada — ' + v.rotasSub);
  ok(v.km === '0 km', 'sem rota: KM DAS ROTAS mostra 0 km — ' + v.km);
  ok(v.kmSub === 'confirme uma rota para ver', 'e explica: confirme uma rota para ver — ' + v.kmSub);

  // ── 2. roteirização gerada, mas NÃO confirmada ────────────────────────────
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '2000'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1200);
  ok(await p.$('#btn-confirmar-rota') !== null, 'a rota foi montada e está na tela, esperando confirmação');
  v = await painel(p);
  ok(v.rotas === '0' && v.km === '0 km', 'rota montada e não confirmada NÃO entra no painel: ' + v.rotas + ' / ' + v.km);
  const semGravar = await p.evaluate(() => !window.__FAKE.db.empresas.emp1.rotas);
  ok(semGravar, 'e nada é gravado no banco enquanto o veículo não sai (a prévia não é mais salva)');

  // ── 3. confirmada: agora sim ──────────────────────────────────────────────
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1500);
  v = await painel(p);
  ok(v.rotas === '1', 'rota confirmada: o cartão ROTAS mostra 1 — ' + v.rotas);
  ok(v.rotasSub === 'rota confirmada', 'no singular: rota confirmada — ' + v.rotasSub);
  ok(v.km === '31,2 km', 'e o km planejado dessa rota: 31,2 km — ' + v.km);
  ok(v.kmSub === 'km planejado das rotas confirmadas', 'com a explicação certa — ' + v.kmSub);
  const rid = await p.evaluate(() => Object.keys(window.__FAKE.db.empresas.emp1.rotas_confirmadas)[0]);

  // ── 4. devolvida: volta para zero ─────────────────────────────────────────
  await p.evaluate((id) => window.devolverRotaD(id), rid); await p.waitForTimeout(900);
  v = await painel(p);
  ok(v.rotas === '0' && v.km === '0 km', 'rota devolvida sai do painel: ' + v.rotas + ' / ' + v.km);
  ok(v.rotasSub === 'nenhuma rota confirmada', 'e a explicação volta ao começo — ' + v.rotasSub);

  await p.screenshot({ path: 'painel-rotas-1440.png' });
  ok(errs.length === 0, 'nenhum erro de JavaScript na tela: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
