// Rua com o mesmo nome em outro bairro da mesma cidade — 20/11/2026.
//
// Caso real: "Rua Belo Horizonte, 233 — Brás, São Paulo" (CEP 03052-040) apareceu no
// mapa na divisa com Mairiporã. São Paulo tem mais de uma rua com esse nome e o
// Nominatim devolveu a primeira que achou: mesma cidade, mesmo nome de rua, então a
// conferência antiga deixava passar. Agora a rua tem de ficar perto do bairro do CEP.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

const BRAS = { lat: -23.5430, lng: -46.6160 };        // centro do bairro
const RUA_BRAS = { lat: -23.5405, lng: -46.6172 };    // a Rua Belo Horizonte do Brás
const RUA_NORTE = { lat: -23.4105, lng: -46.6020 };   // outra Rua Belo Horizonte, divisa com Mairiporã
const NUM_NORTE = { lat: -23.4108, lng: -46.6024 };   // o 233 dessa outra rua
const SP = { lat: -23.5505, lng: -46.6333 };

const PED = {
  // importado agora (ordem de coleta)
  '5001': { nf: '5001', tipo: 'coleta', cidade: 'São Paulo', dest: 'Remetente A', endereco: 'RUA BELO HORIZONTE 233', bairro: 'BRAS',
            cep: '03052040', uf: 'SP', peso: 50, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.56, lng: -46.65 },
  // localizado antes da correção, no lugar errado (pelo número da outra rua)
  '5002': { nf: '5002', tipo: 'coleta', cidade: 'São Paulo', dest: 'Remetente B', endereco: 'RUA BELO HORIZONTE 233', bairro: 'BRAS',
            cep: '03052040', uf: 'SP', peso: 50, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', geoV: 2,
            lat: NUM_NORTE.lat, lng: NUM_NORTE.lng },
  // bairro que o mapa não acha e duas ruas com o nome: não dá para saber qual → aproximado
  '5003': { nf: '5003', tipo: 'coleta', cidade: 'São Paulo', dest: 'Remetente C', endereco: 'RUA DUPLICADA 10', bairro: 'SUMIDO',
            cep: '03000001', uf: 'SP', peso: 50, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.56, lng: -46.65 },
};
const VIACEP = {
  '03052040': { logradouro: 'Rua Belo Horizonte', bairro: 'Brás', localidade: 'São Paulo', uf: 'SP' },
  '03000001': { logradouro: 'Rua Duplicada', bairro: 'Bairro Sumido', localidade: 'São Paulo', uf: 'SP' },
};
const item = (o, extra = {}) => ({ lat: String(o.lat), lon: String(o.lng),
  address: { country: 'Brasil', city: 'São Paulo', state: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP', ...extra } });
const reg = [];
function nominatim(u) {
  const q = u.searchParams.get('q') || '', st = u.searchParams.get('street') || '', city = u.searchParams.get('city') || '';
  reg.push(q || `street=${st}|limit=${u.searchParams.get('limit')}`);
  if (q === 'Brás, São Paulo, SP, Brasil') return [item(BRAS, { suburb: 'Brás' })];
  // como o Nominatim de verdade: a outra rua vem PRIMEIRO
  if (st === 'Rua Belo Horizonte' && city === 'São Paulo')
    return [item(RUA_NORTE, { road: 'Rua Belo Horizonte', suburb: 'Tremembé' }), item(RUA_BRAS, { road: 'Rua Belo Horizonte', suburb: 'Brás' })];
  if (st === '233 Rua Belo Horizonte' && city === 'São Paulo')
    return [item(NUM_NORTE, { road: 'Rua Belo Horizonte', house_number: '233', suburb: 'Tremembé' })];
  if (st === 'Rua Duplicada' && city === 'São Paulo')
    return [item({ lat: -23.45, lng: -46.70 }, { road: 'Rua Duplicada' }), item({ lat: -23.65, lng: -46.55 }, { road: 'Rua Duplicada' })];
  if (!q && !st && city === 'São Paulo') return [item(SP)];
  return [];
}
const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, geo_cache: {},
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  p.on('dialog', (d) => d.accept());
  await ctx.route(/viacep\.com\.br\/ws\/(\d+)\/json/, (r) => {
    const cep = r.request().url().match(/ws\/(\d+)\//)[1];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(VIACEP[cep] || { erro: true }) });
  });
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(nominatim(new URL(r.request().url()))) }));
  await p.waitForFunction(() => { const e = document.getElementById('geo-status-bar'); return e && /Mapa atualizado/.test(e.textContent); }, null, { timeout: 60000 });
  const d = await p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1.pedidos_rota)));
  const km = (a, c) => { const R = 6371, dl = (c.lat - a.lat) * Math.PI / 180, dg = (c.lng - a.lng) * Math.PI / 180;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(c.lat * Math.PI / 180) * Math.sin(dg / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

  ok(d['5001'].lat === RUA_BRAS.lat && d['5001'].lng === RUA_BRAS.lng && d['5001'].geoPrec === 'rua',
    'duas ruas com o mesmo nome na cidade: fica a do bairro do CEP (Brás), não a 1ª que o mapa devolve');
  ok(km(d['5001'], RUA_NORTE) > 10, 'o pino não vai para a divisa com Mairiporã (' + km(d['5001'], RUA_NORTE).toFixed(1) + ' km dela)');
  ok(d['5001'].geoPrec !== 'numero', 'o número achado na outra rua é recusado (fica a rua certa, sem o número)');
  ok(reg.some((q) => q === 'street=Rua Belo Horizonte|limit=5'), 'pede mais de um resultado da rua para poder escolher');
  ok(d['5002'].lat === RUA_BRAS.lat && d['5002'].geoV === 3, 'ponto antigo no lugar errado é refeito e vai para o Brás');
  ok(d['5003'].geoPrec === 'cidade' && d['5003'].lat === SP.lat,
    'duas ruas com o nome e sem como saber o bairro: não escolhe uma no chute, fica aproximado na cidade');
  const gc = await p.evaluate(() => window.__FAKE.db.geo_cache);
  ok(gc['03052040'] && gc['03052040'].lat === RUA_BRAS.lat && gc['03052040'].v === 3, 'o cache do CEP guarda a rua certa');
  ok(!errs.length, 'sem erro de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
