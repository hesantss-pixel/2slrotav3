// Mapa do Google (Map Tiles API) e geocodificação do Google pelo servidor (/geocode).
// Tudo simulado: a sessão do mapa, os blocos, o texto de direitos e o servidor.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const DIA = 864e5;
const G_NUM = { lat: -23.46711, lng: -46.53322 };   // "Av. Salgado Filho, 1000" pelo Google
const G_1500 = { lat: -23.47001, lng: -46.53999 };
const G_RENOVA = { lat: -23.48888, lng: -46.54444 };
const agora = Date.now();
const PED = {
  // novo, com CEP e número: o Google acha o número
  '4001': { nf: '4001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'A', endereco: 'Av. Salgado Filho, 1000', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  // aproximado (bairro), já conferido antes: passa uma vez pelo Google
  '4002': { nf: '4002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'B', endereco: 'Av. Salgado Filho, 1500', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'bairro', geoV: 3, lat: -23.45, lng: -46.52 },
  // ponto do Google com 31 dias: procurado de novo
  '4003': { nf: '4003', tipo: 'entrega', cidade: 'Guarulhos', dest: 'C', endereco: 'Rua Renova, 30', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', geoV: 3, geoFonte: 'google', geoEm: agora - 31 * DIA, lat: -23.40, lng: -46.40 },
  // ponto do Google com 5 dias: não é mexido
  '4004': { nf: '4004', tipo: 'entrega', cidade: 'Guarulhos', dest: 'D', endereco: 'Rua Nova, 40', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', geoV: 3, geoFonte: 'google', geoEm: agora - 5 * DIA, lat: -23.41, lng: -46.41 },
  // o Google não confirma: segue pelo OpenStreetMap
  '4005': { nf: '4005', tipo: 'entrega', cidade: 'Guarulhos', dest: 'E', endereco: 'Rua Sem Google, 9', cep: '07020000', peso: 10, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  // aproximado: o Google não melhora → o ponto fica e o pedido não é revisado de novo
  '4007': { nf: '4007', tipo: 'entrega', cidade: 'Guarulhos', dest: 'G', endereco: 'Rua Sem Google, 77', cep: '07020000', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', geoV: 3, lat: -23.4321, lng: -46.5021 },
  // aproximado já tentado no Google: não volta
  '4006': { nf: '4006', tipo: 'entrega', cidade: 'Guarulhos', dest: 'F', endereco: 'Rua Tentada, 1', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', geoV: 3, geoG: 1, lat: -23.44, lng: -46.51 },
};
const seed = (a) => {
  window.__GMAPS_KEY = 'CHAVE-TESTE';
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: a.ped } } },
  };
  if (a.semSessao) localStorage.removeItem('rv3_gtiles');
};
const VIACEP = {
  '07010030': { logradouro: 'Avenida Salgado Filho', bairro: 'Centro', localidade: 'Guarulhos', uf: 'SP' },
  '07020000': { logradouro: 'Rua Sem Google', bairro: 'Vila B', localidade: 'Guarulhos', uf: 'SP' },
};
const res = (o, extra = {}) => [{ lat: String(o.lat), lon: String(o.lng), address: { country: 'Brasil', city: 'Guarulhos', state: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP', ...extra } }];
function nominatim(u) {
  const st = u.searchParams.get('street') || '', q = u.searchParams.get('q') || '';
  if (st === 'Avenida Salgado Filho') return res({ lat: -23.465, lng: -46.530 }, { road: 'Avenida Salgado Filho' });
  if (st === 'Rua Sem Google') return res({ lat: -23.430, lng: -46.500 }, { road: 'Rua Sem Google' });
  if (st === '9 Rua Sem Google') return res({ lat: -23.431, lng: -46.501 }, { road: 'Rua Sem Google', house_number: '9' });
  if (q.startsWith('Centro, Guarulhos') || q.startsWith('Vila B, Guarulhos')) return res({ lat: -23.46, lng: -46.52 }, { suburb: 'Centro' });
  if (!q && !st) return res({ lat: -23.45, lng: -46.52 });
  return [];
}
// servidor: o que o Google devolveria (já conferido lá)
function geocode(b) {
  const r = (o, prec) => ({ configurado: true, resultado: { ...o, prec, tipo: 'ROOFTOP', rua: b.rua, numero: b.numero, bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', cep: '' } });
  if (b.numero === '1000') return r(G_NUM, 'numero');
  if (b.numero === '1500') return r(G_1500, 'numero');
  if (b.numero === '30') return r(G_RENOVA, 'numero');
  return { configurado: true, resultado: null };
}

async function cenario(b, opt) {
  const reg = { sessao: 0, blocos: [], viewport: 0, geo: [], auth: [] };
  const rotas = async (ctx) => {
  await ctx.route(/tile\.googleapis\.com\/v1\/createSession/, (r) => {
    reg.sessao++; reg.sessaoBody = r.request().postData(); reg.sessaoUrl = r.request().url();
    if (opt.sessaoRecusada) return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"code":403}}' });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: 'SESS-1', expiry: String(Math.floor(Date.now() / 1000) + 14 * 86400), tileWidth: 256, tileHeight: 256, imageFormat: 'png' }) });
  });
  await ctx.route(/tile\.googleapis\.com\/v1\/2dtiles\//, (r) => { reg.blocos.push(r.request().url()); r.fulfill({ contentType: 'image/png', body: PNG }); });
  await ctx.route(/tile\.googleapis\.com\/tile\/v1\/viewport/, (r) => { reg.viewport++; r.fulfill({ contentType: 'application/json', body: JSON.stringify({ copyright: 'Dados do mapa ©2026 Google' }) }); });
  await ctx.route(/developers\.google\.com\/.*google_on_non_white\.png/, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route(/tile\.openstreetmap\.org/, (r) => { reg.osm = (reg.osm || 0) + 1; r.fulfill({ contentType: 'image/png', body: PNG }); });
  await ctx.route(/railway\.app\/geocode/, (r) => {
    const body = JSON.parse(r.request().postData()); reg.geo.push(body); reg.auth.push(r.request().headers()['authorization']);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(opt.semChave ? { configurado: false, resultado: null } : geocode(body)) });
  });
  await ctx.route(/viacep\.com\.br\/ws\/(\d+)\/json/, (r) => { const cep = r.request().url().match(/ws\/(\d+)\//)[1]; r.fulfill({ contentType: 'application/json', body: JSON.stringify(VIACEP[cep] || { erro: true }) }); });
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(nominatim(new URL(r.request().url()))) }));
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, { ped: JSON.parse(JSON.stringify(PED)), semSessao: true }, rotas);
  p.on('pageerror', (e) => console.log('STACK', (e.stack || '').split('\n').slice(0, 5).join(' | ')));
  return { ctx, p, errs, reg };
}
const emp = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1)));
const fimFila = (p) => p.waitForFunction(() => { const e = document.getElementById('geo-status-bar'); return e && /Mapa atualizado/.test(e.textContent); }, null, { timeout: 40000 });

(async () => {
  const b = await chromium.launch();

  // ── 1) chave do mapa e do servidor funcionando ─────────────────────────────
  {
    const { p, errs, reg } = await cenario(b, {});
    await fimFila(p);
    const d = (await emp(p)).pedidos_rota;
    const e = await emp(p);
    ok(d['4001'].geoPrec === 'numero' && d['4001'].lat === G_NUM.lat && d['4001'].geoFonte === 'google' && d['4001'].geoG === 1, 'nota nova: cai no número exato pelo Google (fonte marcada)');
    ok(typeof d['4001'].geoEm === 'number' && Date.now() - d['4001'].geoEm < 60000, 'guarda quando o ponto do Google foi achado (regra dos 30 dias)');
    const b1 = reg.geo.find((x) => x.numero === '1000');
    ok(b1 && b1.cidade === 'Guarulhos' && b1.uf === 'SP' && b1.cep === '07010030' && b1.rua === 'Avenida Salgado Filho' && b1.bairro === 'Centro', 'servidor recebe rua oficial do CEP, número, bairro, cidade, UF e CEP');
    ok(reg.auth.every((a) => a === 'Bearer TOKEN-ANA'), 'chamada ao servidor vai com o login da pessoa');
    ok(!JSON.stringify(reg.geo).includes('CHAVE-TESTE') && !reg.geo.some((x) => 'key' in x), 'a chave do Google de geocodificação não sai do navegador (fica no servidor)');
    ok(d['4002'].geoPrec === 'numero' && d['4002'].lat === G_1500.lat && d['4002'].geoFonte === 'google', 'pedido aproximado passa pelo Google uma vez e vai para o número');
    ok(d['4003'].lat === G_RENOVA.lat && Date.now() - d['4003'].geoEm < 60000, 'ponto do Google com mais de 30 dias é procurado de novo');
    ok(d['4004'].lat === -23.41 && d['4004'].geoEm < Date.now() - 4 * DIA, 'ponto do Google com 5 dias não é mexido');
    ok(d['4005'].geoPrec === 'numero' && d['4005'].lat === -23.431 && !d['4005'].geoFonte && d['4005'].geoG === 1, 'Google não confirmou: segue pelo OpenStreetMap, sem marca do Google');
    ok(d['4006'].lat === -23.44 && !reg.geo.some((x) => x.numero === '1' && /Tentada/.test(x.endereco)), 'aproximado que já passou pelo Google não é consultado de novo');
    ok(d['4007'].lat === -23.4321 && d['4007'].geoG === 1 && !d['4007'].geoFonte, 'aproximado que o Google não melhorou: ponto fica e não é revisado de novo');
    const L = Object.entries(e.config.locais || {}).find(([k]) => k.startsWith('07010030_1000_'));
    ok(L && L[1].f === 'g' && L[1].p === 'numero', 'ponto do Google guardado para o endereço com a marca "g" (vale 30 dias, não 90)');

    // mapa
    await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(1500);
    ok(reg.sessao === 1, 'uma sessão do mapa só (' + reg.sessao + ')');
    ok(JSON.parse(reg.sessaoBody || '{}').mapType === 'roadmap' && JSON.parse(reg.sessaoBody).language === 'pt-BR' && JSON.parse(reg.sessaoBody).region === 'BR', 'sessão pede mapa de ruas em português do Brasil');
    ok(reg.blocos.length > 0 && reg.blocos.every((u) => /\/v1\/2dtiles\/\d+\/\d+\/\d+\?session=SESS-1&key=CHAVE-TESTE$/.test(u)), 'blocos do mapa vêm do Google com a sessão e a chave: ' + reg.blocos.length);
    ok(!reg.osm, 'nenhum bloco do OpenStreetMap');
    const cred = await p.textContent('#mapa-completo .leaflet-control-attribution');
    ok(cred.includes('Dados do mapa ©2026 Google'), 'texto de direitos do Google aparece: ' + cred);
    ok(reg.viewport > 0, 'texto de direitos pedido para a área visível');
    const logo = await p.$eval('#mapa-completo .g-logo img', (i) => ({ alt: i.alt, src: i.src, w: i.getBoundingClientRect().width })).catch(() => null);
    ok(logo && logo.alt === 'Google' && /google_on_non_white\.png$/.test(logo.src) && logo.w > 0, 'logo do Google visível no canto do mapa');
    await p.screenshot({ path: 'google-mapa.png' });
    // outra tela com mapa: reaproveita a sessão
    await p.evaluate(() => window.abrirPedido('4001')); await p.waitForTimeout(900);
    ok(reg.sessao === 1 && (await p.$('#ped-mapa .g-logo img')) !== null, 'mapa do pedido usa a mesma sessão e também mostra o logo');
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
    await p.context().close();
  }

  // ── 2) Google recusou o mapa: volta ao OpenStreetMap e não usa o Google ───────
  {
    const { p, errs, reg } = await cenario(b, { sessaoRecusada: true });
    await fimFila(p);
    const d = (await emp(p)).pedidos_rota;
    ok(reg.geo.length === 0, 'sem o mapa do Google, o servidor não é consultado (o ponto dele não poderia ser mostrado)');
    ok(d['4001'].geoPrec && !d['4001'].geoFonte, 'pedido localizado pelo caminho de sempre: ' + d['4001'].geoPrec);
    await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(1200);
    ok(reg.osm > 0 && reg.blocos.length === 0, 'fundo do mapa volta ao OpenStreetMap');
    ok((await p.textContent('#mapa-completo .leaflet-control-attribution')).includes('© OpenStreetMap') && !(await p.$('#mapa-completo .g-logo')), 'crédito do OpenStreetMap, sem logo do Google');
    ok(reg.sessao === 1, 'não insiste na sessão a cada mapa (' + reg.sessao + ')');
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
    await p.context().close();
  }

  // ── 3) servidor sem a chave (GOOGLE_GEOCODING_KEY vazia) ───────────────────
  {
    const { p, errs, reg } = await cenario(b, { semChave: true });
    await fimFila(p);
    const d = (await emp(p)).pedidos_rota;
    ok(reg.geo.length === 1, 'servidor sem chave: pergunta uma vez e para (' + reg.geo.length + ')');
    ok(d['4001'].geoPrec && !d['4001'].geoFonte && d['4005'].lat === -23.431, 'pedidos localizados pelo OpenStreetMap');
    ok(d['4007'].lat === -23.4321 && !d['4007'].geoG, 'sem o Google, a revisão não acontece (nem gasta consulta ao OpenStreetMap)');
    ok(d['4002'].lat === -23.45 && d['4002'].geoPrec === 'bairro', 'aproximado fica como estava (nada melhor para pôr)');
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
    await p.context().close();
  }

  await b.close();
  process.exitCode = falhas ? 1 : 0;
})();
