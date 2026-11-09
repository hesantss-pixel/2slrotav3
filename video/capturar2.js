// Segunda passada: só a cena da montagem manual, com um conjunto menor de pedidos,
// para o mapa abrir enquadrando a região da rota em vez dos 22 pedidos do dia todo.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { CD, PEDIDOS } = require('./dados.js');
const TELAS = path.join(__dirname, 'telas');
const FAKE = '/home/claude/2slrotav3/tests/tela/fakefb';
const LEAF = '/home/claude/2slrotav3/tests/tela/vendor/leaflet';
const MAPA_B64 = fs.readFileSync(path.join(__dirname, 'mapa-fundo.b64'), 'utf8').trim();
const CSS_MAPA = `
.leaflet-tile-pane{display:none!important}
.leaflet-control-attribution{display:none!important}
.leaflet-container{background-image:url("data:image/svg+xml;base64,${MAPA_B64}")!important;
  background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}`;

const CHAVES = ['18425', '18428', 'C_21181', '18427', 'C_21182', '18430', '18434', '18424', '18429', 'C_21180', '18439'];
const PEQ = {}; CHAVES.forEach((k) => { if (PEDIDOS[k]) PEQ[k] = PEDIDOS[k]; });

const seed = (d) => {
  window.__FAKE = { user: { uid: 'uid-op', email: 'operacao@exemplo.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-op': true }, membros: { 'uid-op': 'emp1' },
      empresas: { emp1: { info: { nome: 'Transportadora Exemplo' }, config: { deposito: d.CD }, pedidos_rota: d.PEQ } } } };
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1040, height: 1240 }, deviceScaleFactor: 2 });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) =>
    r.fulfill({ path: path.join(FAKE, r.request().url().match(/(firebase-[a-z]+\.js)/)[1]), contentType: 'text/javascript' }));
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/[\d.]+\/(leaflet\.min\.(js|css))/, (r) => {
    const f = r.request().url().match(/leaflet\.min\.(js|css)/)[1];
    r.fulfill({ path: path.join(LEAF, f === 'js' ? 'leaflet.js' : 'leaflet.css'), contentType: f === 'js' ? 'text/javascript' : 'text/css' });
  });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|basemaps|cartocdn|arcgisonline|cdnjs\.cloudflare\.com\/ajax\/libs\/(xlsx|pdf)|railway\.app|viacep|nominatim/, (r) => r.abort());
  await ctx.route(/railway\.app\/avaliar/, (r) => {
    const body = JSON.parse(r.request().postData());
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 29.6, mins: 135,
      chegada_min: body.pedidos.map((_, i) => 450 + i * 22), fonte_distancia: 'OSRM', passa_da_jornada: false }) });
  });
  await ctx.addInitScript(seed, { CD, PEQ });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERRO:', e.message));
  await p.goto('http://127.0.0.1:8771/index.html', { waitUntil: 'load' });
  await p.addStyleTag({ content: CSS_MAPA });
  await p.waitForTimeout(1000);
  await p.evaluate(() => { const s = document.querySelector('.sidebar'); if (s) s.style.display = 'none';
    document.querySelector('.main').style.marginLeft = '0'; });
  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(700);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(400);
  await p.fill('#cap-kg-d', '3000');
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(400);
  await p.click('#rot-step-confirm .btn-modal-alt');
  await p.waitForTimeout(1800);
  const foto = async (n, el) => { await (el ? p.locator(el) : p).screenshot({ path: path.join(TELAS, n + '.png') }); };
  await p.mouse.move(6, 6); await p.waitForTimeout(300);
  await foto('m-mapa-0', '#mapa-manual'); await foto('m-painel-0', '.man-painel');

  const toques = ['18425', '18428', '21181', '18427', '21182', '18430'];
  for (let i = 0; i < toques.length; i++) {
    const c = await p.evaluate((nf) => {
      const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')]
        .find((x) => (x.getAttribute('title') || '').includes('NF ' + nf));
      if (!a) return null; const b = a.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, toques[i]);
    if (!c) { console.log('! não achei', toques[i]); continue; }
    await p.mouse.click(c.x, c.y);
    await p.waitForTimeout(300);
    await p.mouse.move(6, 6); await p.waitForTimeout(160);
    await foto('m-mapa-' + (i + 1), '#mapa-manual');
    await foto('m-painel-' + (i + 1), '.man-painel');
  }
  await foto('m-ordem', '#man-ordem');
  const pontos = await p.evaluate(() => {
    const m = document.getElementById('mapa-manual').getBoundingClientRect();
    return { w: m.width, h: m.height,
      pinos: [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].map((a) => {
        const b = a.getBoundingClientRect(), c = a.firstElementChild;
        return { x: (b.x + b.width / 2 - m.x) / m.width, y: (b.y + b.height / 2 - m.y) / m.height,
          rot: c ? c.textContent : '', sel: !!(c && /\bsel\b/.test(c.className)),
          coleta: !!(c && /coleta/.test(c.className)), cd: !!(c && /\bcd\b/.test(c.className)) }; }) };
  });
  fs.writeFileSync(path.join(TELAS, 'm-pontos.json'), JSON.stringify(pontos, null, 1));
  console.log('ok ·', pontos.pinos.length, 'pinos,', pontos.pinos.filter((x) => x.sel).length, 'na rota');
  await p.click('#man-usar'); await p.waitForTimeout(2400);
  await foto('m-resultado');
  await ctx.close(); await b.close();
})();
