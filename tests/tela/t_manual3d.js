// Montagem no baú ao vivo na rota manual: o 3D aparece ao lado do mapa e se refaz a cada parada
// que entra, sai ou muda de lugar; a cor de cada parada é a mesma no pino, na lista e nas caixas;
// a câmera e o "Empilhar" ficam como a pessoa deixou; o que não cabe fica numa pilha atrás da porta.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;

const med = (c, l, a, q) => ({ m3: Math.round(c * l * a * q / 1e6 * 1e4) / 1e4, medidas: `${c} × ${l} × ${a} cm`, m3Fonte: 'medidas', itens: q });
const PED = {
  '1001': { nf: '1001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Mercado Bom Preço', endereco: 'Rua A, 100', peso: 300, status: 'pendente', lat: -23.450, lng: -46.530, geoStatus: 'ok', ...med(50, 40, 30, 12) },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja Casa & Cia', endereco: 'Rua B, 200', peso: 250, status: 'pendente', lat: -23.440, lng: -46.500, geoStatus: 'ok',
    m3: 0.826, m3Fonte: 'medidas', itens: 5, medidas: '2 de 50 × 50 × 50 cm; 3 de 80 × 60 × 40 cm', cx: [{ c: 50, l: 50, a: 50, q: 2 }, { c: 80, l: 60, a: 40, q: 3 }] },
  '1003': { nf: '1003', tipo: 'entrega', cidade: 'Arujá', dest: 'Padaria Sol', endereco: 'Rua C, 300', peso: 90, status: 'pendente', lat: -23.390, lng: -46.320, geoStatus: 'ok', ...med(60, 40, 40, 6) },
  '1004': { nf: '1004', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Auto Peças Leste', endereco: 'Rua D, 400', peso: 410, status: 'pendente', lat: -23.470, lng: -46.580, geoStatus: 'ok', ...med(80, 60, 40, 5) },
  'C_2001': { nf: '2001', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria E', endereco: 'Rua E, 500', peso: 400, status: 'pendente', lat: -23.480, lng: -46.350, geoStatus: 'ok', ...med(120, 100, 80, 2) },
};
const seed = (ped) => {
  window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } } };
};
async function abrirManual(p, veic, cap, carroc) {
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(500);
  await p.evaluate((v) => window.selVeicD(v), veic); await p.waitForTimeout(250);
  if (carroc) await p.selectOption('#cap-carroc-d', carroc);
  await p.fill('#cap-kg-d', String(cap));
  await p.evaluate(() => window.irConfirmD()); await p.waitForTimeout(250);
  await p.click('#rot-step-confirm .btn-modal-alt'); await p.waitForTimeout(700);
}
const add = async (p, id) => { await p.evaluate((i) => window.manAddUm(i), id); await p.waitForTimeout(260); };
const estado = (p) => p.evaluate(() => ({
  e: window.__c3d(),
  msg: (document.querySelector('#man-3d-in .man-3d-msg') || {}).textContent || '',
  cv: !!document.getElementById('m3d-cv'),
  chips: [...document.querySelectorAll('#m3d-leg .c3d-chip')].map((c) => [+c.querySelector('i').textContent, c.querySelector('i').getAttribute('style'), c.textContent]),
  lista: [...document.querySelectorAll('#man-ordem .man-num')].map((x) => [+x.textContent, x.style.getPropertyValue('--cor')]),
  pinos: [...document.querySelectorAll('#mapa-manual .pino.sel')].map((x) => [x.textContent, x.style.getPropertyValue('--cor')]),
  modos: document.querySelectorAll('#man-3d .c3d-m').length,
  resumo: (document.getElementById('m3d-resumo') || {}).textContent || '',
}));

(async () => {
  const b = await chromium.launch();
  const { p, errs } = await open(b, 'index.html', 1680, 950, seed, false, PED);
  await p.waitForTimeout(600);
  await abrirManual(p, 'vuc', 3000);

  // ── antes de tocar ─────────────────────────────────────────────────────────
  let s = await estado(p);
  ok(!s.cv && /^Toque nos pontos do mapa: as caixas de cada parada aparecem aqui, no baú de [\d,]+ × [\d,]+ × [\d,]+ m/.test(s.msg),
    'sem parada: o painel explica que as caixas aparecem ali ' + s.msg);
  const lado = await p.evaluate(() => { const m = document.getElementById('mapa-manual').getBoundingClientRect(), t = document.getElementById('man-3d').getBoundingClientRect();
    return [Math.round(m.top), Math.round(t.top), t.left > m.right]; });
  ok(lado[2] && Math.abs(lado[0] - lado[1]) < 40, 'em tela larga o 3D fica ao lado do mapa ' + J(lado));

  // ── entra uma parada, depois outras: o 3D se refaz sozinho ──────────────────
  await add(p, '1001');
  s = await estado(p);
  ok(s.cv && s.e && s.e.pre === 'm3d' && s.chips.length === 1 && /1 parada desenhada, 12 volumes/.test(s.resumo), 'a primeira parada já aparece no 3D: ' + s.resumo.slice(0, 60));
  await add(p, '1002'); await add(p, '1003');
  s = await estado(p);
  ok(s.chips.length === 3 && /3 paradas desenhadas, 23 volumes/.test(s.resumo), 'cada parada que entra aparece no 3D ' + J(s.chips.map((c) => c[2])));
  const cor = (n) => s.e.cores[n - 1];
  ok(s.chips.every(([n, st]) => st === 'background:' + cor(n)) && s.lista.every(([n, c]) => c === cor(n)) && s.pinos.length === 3 && s.pinos.every(([t, c]) => c === cor(+t)),
    'a cor de cada parada é a mesma no pino do mapa, na lista e nas caixas ' + J([s.pinos, s.lista]));
  ok(s.e.naPos.every((k) => s.e.marcadas.includes(k)), 'toda parada desenhada tem o número no desenho ' + J([s.e.naPos, s.e.marcadas]));

  // ── a câmera e o empilhar ficam como a pessoa deixou ────────────────────────
  await p.click('#man-3d .c3d-v[data-v="cima"]'); await p.waitForTimeout(80);
  await p.uncheck('#m3d-emp'); await p.waitForTimeout(80);
  await add(p, '1004');
  s = await estado(p);
  const vis = await p.evaluate(() => [document.querySelector('#man-3d .c3d-v[data-v="cima"]').getAttribute('aria-pressed'), document.getElementById('m3d-emp').checked]);
  ok(s.chips.length === 4 && Math.abs(s.e.pitch - 1.55) < 1e-9 && vis[0] === 'true' && vis[1] === false && s.e.empilhar === false,
    'com mais uma parada, a vista "De cima" e o "Empilhar" desligado continuam ' + J(vis));
  await p.check('#m3d-emp'); await p.click('#man-3d .c3d-v[data-v="3d"]'); await p.waitForTimeout(80);

  // ── tirar e mudar de lugar ──────────────────────────────────────────────────
  await p.evaluate(() => window.manTirar(0)); await p.waitForTimeout(260);
  s = await estado(p);
  ok(s.chips.length === 3 && /^1Loja Casa & Cia/.test(s.chips[0][2]) && s.lista[0][1] === s.e.cores[0], 'tirar a parada 1 renumera e recolore o 3D junto com a lista ' + J(s.chips.map((c) => c[2])));
  await p.evaluate(() => window.manMover(2, -1)); await p.waitForTimeout(260);
  s = await estado(p);
  ok(/^2Auto Peças Leste/.test(s.chips[1][2]) && s.pinos.every(([t, c]) => c === s.e.cores[+t - 1]), 'mudar a ordem muda a cor e o número no 3D e no pino ' + J(s.chips.map((c) => c[2])));

  // ── coleta na rota: aparecem os dois momentos ───────────────────────────────
  await add(p, 'C_2001');
  s = await estado(p);
  ok(s.modos === 2 && s.chips.length === 3, 'com coleta, o 3D oferece "Na saída do CD" e "Ao longo da viagem" ' + s.modos);
  await p.click('#man-3d .c3d-m[data-m="viagem"]'); await p.waitForTimeout(100);
  await p.evaluate(() => window.manMover(3, -1)); await p.waitForTimeout(260);
  s = await estado(p);
  ok(s.e.modo === 'viagem' && s.chips.length === 4 && /Esta rota faz coleta antes de entrega/.test(s.resumo), 'continua "Ao longo da viagem" e avisa a coleta antes da entrega ' + s.resumo.slice(0, 90));

  // ── painel fechado não refaz; ao abrir, mostra o atual ──────────────────────
  await p.evaluate(() => { document.getElementById('man-3d').open = false; }); await p.waitForTimeout(80);
  await p.evaluate(() => window.manTirar(0)); await p.waitForTimeout(260);
  await p.evaluate(() => { document.getElementById('man-3d').open = true; }); await p.waitForTimeout(260);
  s = await estado(p);
  ok(s.chips.length === 3, 'fechar o painel e abrir de novo mostra a rota de agora ' + s.chips.length);

  // ── usar a rota: o 3D da montagem sai de cena ───────────────────────────────
  await p.click('#man-usar'); await p.waitForTimeout(400);
  s = await estado(p);
  ok(!s.e || s.e.pre !== 'm3d', 'depois de "Usar esta rota" o 3D da montagem deixa de ser o ativo');

  // ── Fiorino que não comporta: pilha atrás da porta, não uma fila ────────────
  const f = await open(b, 'index.html', 390, 844, seed, false, PED);
  await f.p.waitForTimeout(600);
  await abrirManual(f.p, 'fiorino', 650);
  for (const id of ['1001', '1002', '1003']) await add(f.p, id);
  s = await estado(f.p);
  ok(/Não couberam pelo formato: parada 1/.test(s.resumo) && s.e.foraAte > s.e.bau.c && s.e.foraAte - s.e.bau.c < 1.6,
    'na Fiorino, o que não coube fica numa pilha atrás da porta (até ' + (s.e.foraAte - s.e.bau.c).toFixed(2) + ' m depois dela)');
  const larg = await f.p.evaluate(() => [document.scrollingElement.scrollWidth, innerWidth, document.getElementById('m3d-cv').clientWidth]);
  ok(larg[0] <= larg[1] && larg[2] > 280, 'no celular o 3D cabe na largura da tela, sem rolar de lado ' + J(larg));

  // ── carroceria aberta: diz por que não tem 3D (e, em tela de notebook, o 3D vem embaixo do mapa) ──
  const a = await open(b, 'index.html', 1366, 768, seed, false, PED);
  await a.p.waitForTimeout(600);
  await abrirManual(a.p, 'toco', 6000, 'aberta');
  const emb = await a.p.evaluate(() => { const m = document.getElementById('mapa-manual').getBoundingClientRect(), t = document.getElementById('man-3d').getBoundingClientRect();
    return [Math.round(m.width), t.top > m.bottom]; });
  ok(emb[0] >= 760 && emb[1], 'em tela de notebook o mapa fica largo e o 3D vem logo abaixo ' + J(emb));
  await add(a.p, '1001');
  s = await estado(a.p);
  ok(!s.cv && /^Sem o 3D: carroceria aberta não tem baú para desenhar\./.test(s.msg), 'carroceria aberta: o painel diz por que não tem 3D ' + s.msg);

  const todosErros = [...errs, ...f.errs, ...a.errs];
  ok(!todosErros.length, 'sem erro no console ' + J(todosErros));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
