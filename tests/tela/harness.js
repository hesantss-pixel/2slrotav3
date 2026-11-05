// Abre o sistema com Firebase simulado. Uso: node harness.js <arquivo> <saida.png> [WxH] [cenario]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FAKE = path.join(__dirname, 'fakefb');
// Leaflet servido de dentro do próprio repositório, para o teste não depender da internet
const LEAF = process.env.LEAFLET_DIR || path.join(__dirname, 'vendor', 'leaflet');
async function open(b, file, W, H, init, mob, arg) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: !!mob, hasTouch: !!mob, deviceScaleFactor: mob ? 2 : 1 });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) => {
    const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    r.fulfill({ path: path.join(FAKE, f), contentType: 'text/javascript' });
  });
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/[\d.]+\/(leaflet\.min\.(js|css))/, (r) => {
    const f = r.request().url().match(/leaflet\.min\.(js|css)/)[1];
    r.fulfill({ path: path.join(LEAF, f === 'js' ? 'leaflet.js' : 'leaflet.css'), contentType: f === 'js' ? 'text/javascript' : 'text/css' });
  });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|basemaps|cartocdn|arcgisonline|cdnjs\.cloudflare\.com\/ajax\/libs\/(xlsx|pdf)|railway\.app|viacep|nominatim/, (r) => r.abort());
  if (init) await ctx.addInitScript(init, arg);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto('http://127.0.0.1:8771/' + file, { waitUntil: 'load' });
  await p.waitForTimeout(700);
  return { ctx, p, errs };
}

// Desde a separação por empresa, os dados de um cliente ficam em empresas/<eid>/ e a
// conta precisa de membros/<uid>. Esta função recebe um seed no formato antigo (config,
// pedidos_rota... na raiz) e devolve no formato de hoje.
const DA_EMPRESA = ['config', 'pedidos_rota', 'rotas', 'rotas_confirmadas', 'motoristas'];
function seedEmpresa(seed = {}, uid = 'uid-ana', eid = 'emp1') {
  const raiz = {}, empresa = { info: { nome: 'Transportadora Exemplo' } };
  for (const [k, v] of Object.entries(seed)) {
    if (DA_EMPRESA.includes(k)) empresa[k] = v; else raiz[k] = v;
  }
  return {
    ...raiz,
    acesso: { [uid]: true, ...(raiz.acesso || {}) },
    membros: { [uid]: eid, ...(raiz.membros || {}) },
    empresas: { [eid]: empresa, ...(raiz.empresas || {}) },
  };
}

module.exports = { open, seedEmpresa };
if (require.main === module) {
  (async () => {
    const [, , file, out, size = '1440x900', mob] = process.argv;
    const [W, H] = size.split('x').map(Number);
    const b = await chromium.launch();
    const { p, errs } = await open(b, file, W, H, null, mob === 'mob');
    await p.screenshot({ path: out });
    console.log('errs:', JSON.stringify(errs.slice(0, 5)));
    await b.close();
  })();
}
