// Página do motorista abre SEM SINAL na segunda vez (service worker sw-motorista.js).
// Em produção o service worker só liga em https; aqui o teste liga com window.__SW_TESTE.
const { chromium } = require('playwright');
const path = require('path');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const TOKEN = 'tok-sw-motorista-000000001';
const FAKE = path.join(__dirname, 'fakefb');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) =>
    r.fulfill({ path: path.join(FAKE, r.request().url().match(/(firebase-[a-z]+\.js)/)[1]), contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await ctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
  await ctx.addInitScript((T) => {
    window.__SW_TESTE = true;
    const off = !navigator.onLine;
    window.__FAKE = { user: null, offline: off, db: { '.info': { connected: !off }, entregador: { [T]: { eid: 'e', expira: Date.now() + 864e5,
      info: { veiculo: 'VUC', motorista: 'Marcos', data: '2026-11-23', deposito: { nome: 'CD' } },
      paradas: [{ nf: '8101', tipo: 'entrega', dest: 'Mercado SW', endereco: 'Rua A, 1', cidade: 'Guarulhos', uf: 'SP' }] } } } };
  }, TOKEN);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:8771/motorista.html#' + TOKEN, { waitUntil: 'load' });
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800);   // segunda visita: o service worker já guardou tudo
  const sw = await p.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  ok(sw, 'service worker controla a página do motorista');
  const guardados = await p.evaluate(async () => { const c = await caches.open('rv3-motorista-v1'); return (await c.keys()).map((r) => new URL(r.url).pathname.split('/').pop()); });
  ok(guardados.includes('motorista.html') && guardados.includes('firebase-app.js') && guardados.includes('firebase-database.js'), 'página e código do banco guardados: ' + guardados.join(', '));
  const escopo = await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
  ok(/\/motorista$/.test(escopo), 'escopo só da página do motorista (não mexe no sistema): ' + escopo);
  const q = await ctx.newPage(); await q.route(/cdnjs|railway|tile|nominatim|viacep/, (r) => r.abort());
  await q.goto('http://127.0.0.1:8771/index.html', { waitUntil: 'load' }).catch(() => {});
  ok(!(await q.evaluate(() => !!navigator.serviceWorker.controller)), 'o sistema (index.html), no mesmo navegador, não fica sob o service worker');
  await q.close();
  // sem sinal nenhum (nem a página vem da rede)
  await ctx.setOffline(true);
  await p.reload({ waitUntil: 'load' }).catch(() => {}); await p.waitForTimeout(1200);
  const txt = await p.textContent('#app').catch(() => '');
  ok(/Mercado SW/.test(txt), 'sem sinal, a página abre e mostra a rota guardada: ' + txt.replace(/\s+/g, ' ').slice(0, 80));
  ok(await p.isVisible('#offline').catch(() => false), 'com o aviso de sem internet');
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
