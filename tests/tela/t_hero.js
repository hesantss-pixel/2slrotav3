const { chromium } = require('playwright');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
(async () => {
  const b = await chromium.launch();
  for (const [W, H, mob] of [[1440, 900, false], [1100, 800, false], [820, 1100, true], [390, 844, true], [360, 740, true], [320, 640, true]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    await ctx.route(/fonts\.googleapis|fonts\.gstatic|tile|basemaps|cartocdn|unpkg|jsdelivr|cdnjs/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8772/', { waitUntil: 'load' }); await p.waitForTimeout(900);
    const r = await p.$eval('.hero__pacote', (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.top + scrollY), Math.round(b.bottom + scrollY), getComputedStyle(e).display]; });
    ok(r[2] !== 'none', `${W}px: destaque visível no topo (de ${r[0]} a ${r[1]} px; tela ${H})`);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= W, `${W}px: sem rolagem lateral (${sw})`);
    await p.screenshot({ path: `../notas/hero-${W}.png`, fullPage: false });
    await p.click('.hero__pacote');
    await p.evaluate(async () => { let last = -1, igual = 0; for (let i = 0; i < 60 && igual < 8; i++) { await new Promise((r) => setTimeout(r, 200)); if (scrollY === last) igual++; else { igual = 0; last = scrollY; } } });
    const alvo = await p.evaluate(() => { const s = document.getElementById('rastreamento').getBoundingClientRect(); return Math.round(s.top); });
    ok(Math.abs(alvo) < 200, `${W}px: toque leva à seção do rastreamento (topo a ${alvo} px)`);
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); await b.close();
})();
