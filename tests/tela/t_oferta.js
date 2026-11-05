const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const seed = (uid) => { window.__FAKE = { user: { uid, email: 'x@y.com', getIdToken: async () => 'T' },
  db: { acesso: { [uid]: true }, membros: { [uid]: uid === 'PGblgW7V26SJ6W8UYPFj3dqlDGm2' ? 'principal' : 'emp1' }, empresas: { emp1: { config: { deposito: { nome: 'CD', lat: -23.42, lng: -46.38 } } }, principal: { config: { deposito: { nome: 'CD', lat: -23.42, lng: -46.38 } } } } } }; };
(async () => {
  const b = await chromium.launch();
  for (const [W, H, mob] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
    const { ctx, p, errs } = await open(b, 'index.html', W, H, seed, mob, 'uid-ana');
    await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(600);
    ok(await p.isVisible('#rastr-oferta'), `${W}px: cliente vê a oferta do rastreador no Mapa`);
    const href = await p.getAttribute('#rastr-oferta a', 'href');
    ok(href.startsWith('https://wa.me/5511955914618?text=') && decodeURIComponent(href).includes('rastreador 4G'), 'botão abre o WhatsApp da ROTAV3 com mensagem pronta');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= W, `${W}px: sem rolagem lateral (${sw})`);
    await p.evaluate(() => document.getElementById('rastr-oferta').scrollIntoView({ block: 'center' }));
    await p.screenshot({ path: `../notas/oferta-sis-${W}.png` });
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  const { ctx, p } = await open(b, 'index.html', 1440, 900, seed, false, 'PGblgW7V26SJ6W8UYPFj3dqlDGm2');
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(600);
  ok(!(await p.isVisible('#rastr-oferta')), 'administrador (ROTAV3) não vê a oferta');
  await ctx.close();
  // página de vendas
  for (const [W, H, mob] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    await ctx.route(/fonts\.googleapis|fonts\.gstatic|tile|basemaps|cartocdn|unpkg|jsdelivr|cdnjs/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8772/', { waitUntil: 'load' }); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelector('.rastreio__card--rastreador').scrollIntoView({ block: 'start' })); await p.waitForTimeout(900);
    await p.screenshot({ path: `../notas/oferta-site-${W}.png` });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= W, `site ${W}px: sem rolagem lateral (${sw})`);
    ok((await p.textContent('.rastreio__card--rastreador')).includes('Sua frota ainda não tem rastreador?'), 'site: cartão do pacote sistema + rastreador');
    await p.click('.rastreio__card--rastreador .btn'); await p.waitForTimeout(300);
    ok((await p.textContent('#modal-agendar')).includes('pacote sistema + rastreador 4G'), 'site: botão abre o formulário falando do pacote');
    await p.keyboard.press('Escape');
    const faq = await p.$$eval('#perguntas summary', (x) => x.map((e) => e.textContent.trim()));
    ok(faq.some((t) => t.startsWith('Minha frota não tem rastreador')), 'site: pergunta nova nas perguntas frequentes');
    ok(!errs.length, 'site sem erros: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); await b.close();
})();
