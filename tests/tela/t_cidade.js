const { chromium } = require('playwright');
const { open } = require('./harness');
(async () => {
  const b = await chromium.launch();
  const { p } = await open(b, 'index.html', 800, 600, () => { window.__FAKE = { db: {} }; });
  const src = await p.evaluate(async () => (await (await fetch('index.html')).text()));
  const m = src.match(/function _cidadeNorm\(raw\)\{[\s\S]*?\n\}\n/)[0];
  const fn = new Function(m + '; return _cidadeNorm;')();
  const casos = [['ITUPEVA', 'Itupeva'], ['Itu', 'Itu'], ['SAO PAULO - SP', 'São Paulo'], ['mogi mirim', 'Mogi Mirim'], ['SÃO JOSÉ DOS CAMPOS/SP', 'São José dos Campos'], ['', 'Sem cidade'], ['  santana de parnaiba ', 'Santana de Parnaíba'], ['Embu das Artes', 'Embu das Artes'], ['GUARULHOS', 'Guarulhos']];
  for (const [ent, esp] of casos) { const r = fn(ent); console.log((r === esp ? 'OK   ' : 'FALHA ') + JSON.stringify(ent) + ' → ' + r); }
  await b.close();
})();
