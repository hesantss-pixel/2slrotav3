const { chromium } = require('playwright');
const { open } = require('./harness');
const path = require('path'), fs = require('fs');
const N = path.join(__dirname, '..', 'notas');
const M = JSON.parse(fs.readFileSync(path.join(N, 'mock.json'), 'utf8'));
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const seed = () => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@x.com', getIdToken: async () => 'T' },
  db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, empresas: { emp1: { info: { nome: 'E' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } } } } } }; };
(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 390, 844, seed, true);
  p.on('dialog', (d) => d.accept());
  let k = 0;
  await ctx.route(/viacep\.com\.br\/ws\/(\d+)\/json/, (r) => { const c = r.request().url().match(/ws\/(\d+)\//)[1]; r.fulfill({ contentType: 'application/json', body: JSON.stringify(M.via[c] || { erro: true }) }); });
  await ctx.route(/nominatim/, (r) => {
    const u = new URL(r.request().url()), st = u.searchParams.get('street'), q = u.searchParams.get('q');
    k++; const d = 0.001 * (k % 7);
    if (st && M.achados.includes(st)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: String(-23.46 - d), lon: '-46.52', address: { road: 'x', house_number: st.split(' ')[0] } }]) });
    if (q) return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: String(-23.46 + d), lon: '-46.50', address: { road: q.split(',')[0] } }]) });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(st && st.includes('Hunnicutt') ? [] : [{ lat: '-23.45', lon: '-46.5', address: { road: 'x' } }]) });
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.irParaPagina('pedidos'));
  await p.setInputFiles('#file-input', path.join(N, 'rotav3-25-notas-teste.xml')); await p.waitForTimeout(800);
  ok((await p.textContent('#import-msg-pedidos')).includes('25 entregas importadas'), 'arquivo único: ' + (await p.textContent('#import-msg-pedidos')).trim());
  const d = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  const a = Object.values(d);
  const n7 = a.find((o) => o.nf === '900007'), n23 = a.find((o) => o.nf === '900023');
  ok(a.length === 25 && a.every((o) => o.cep && o.endereco && o.peso > 0 && o.chave.length === 44), '25 notas com CEP, endereço, peso e chave');
  ok(n7.endereco === 'Avenida Monteiro Lobato, 3050 - Galpão 3' && n7.peso === 850 && n7.itens === 22 && n7.dest.includes('(TESTE)'), 'nota 900007: endereço com complemento, 850 kg, 22 volumes');
  ok(n23.endereco === 'Avenida Paris, S/N - Quadra B', 'nota S/N lida');
  await p.waitForFunction(() => /Mapa atualizado/.test(document.getElementById('geo-status-bar')?.textContent || ''), null, { timeout: 90000 });
  const msg = await p.textContent('#geo-status-bar');
  const d2 = Object.values(await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota));
  const cont = d2.reduce((s, o) => (s[o.geoPrec] = (s[o.geoPrec] || 0) + 1, s), {});
  ok(cont.numero === 7 && cont.rua === 18, 'resultado esperado: ' + JSON.stringify(cont) + ' | ' + msg);
  console.log('CIDADE', JSON.stringify(d2.filter(o=>o.geoPrec!=='numero'&&o.geoPrec!=='rua').map(o=>[o.nf,o.cep,o.endereco,o.geoPrec])));
  await p.screenshot({ path: path.join(N, 'import-390.png') });
  // arquivo separado também
  await p.setInputFiles('#file-input', path.join(N, 'rotav3-notas-teste', 'NF-900001-teste.xml')); await p.waitForTimeout(600);
  ok((await p.textContent('#import-msg-pedidos')).includes('1 entrega importada'), 'arquivo separado: ' + (await p.textContent('#import-msg-pedidos')).trim());
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); await b.close();
})();
