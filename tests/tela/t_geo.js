// Versão 3.7: localizar pelo número, guardar o ponto corrigido à mão e usar nas próximas notas
const { chromium } = require('playwright');
const { open } = require('./harness');
const fs = require('fs'), path = require('path');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const RUA_SF = { lat: -23.4650, lng: -46.5302 };     // "Avenida Salgado Filho" (a rua)
const NUM_1000 = { lat: -23.4700, lng: -46.5350 };   // número 1000
const RUA_SN = { lat: -23.4400, lng: -46.5000 };     // rua sem número no mapa
const UMBU_ERRADA_LAT = -23.4453;
const PED = {
  '3001': { nf: '3001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente A', endereco: 'Av. Salgado Filho, 1.000 - Sala 2', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3002': { nf: '3002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente B', endereco: 'Rua Sem Numero No Mapa, 50', cep: '07020000', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3003': { nf: '3003', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente C', endereco: 'Rua Qualquer, 10', cep: '07099999', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3004': { nf: '3004', tipo: 'entrega', cidade: 'Arujá', dest: 'Cliente D', endereco: 'Rua Tal, 7', uf: 'SP', peso: 100, itens: 1, status: 'pendente', geoStatus: 'sem_cep', lat: -23.39, lng: -46.32 },
  '3005': { nf: '3005', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente E (antigo)', endereco: 'Av. Salgado Filho, 999', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', lat: RUA_SF.lat, lng: RUA_SF.lng },
  '3006': { nf: '3006', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente F (à mão)', endereco: 'Av. Salgado Filho, 1000', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoManual: true, lat: -23.5, lng: -46.6 },
  // 19/11: o que o Nominatim devolve de outra rua ou de outra cidade não vale
  '3008': { nf: '3008', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente G', endereco: 'Rua Umbuzeiro, 123', cep: '07224010', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3009': { nf: '3009', tipo: 'entrega', cidade: 'Arujá', dest: 'Cliente H', endereco: 'Rua Longe, 5', uf: 'SP', peso: 100, itens: 1, status: 'pendente', geoStatus: 'sem_cep', lat: -23.39, lng: -46.32 },
  // localizado antes da conferência: ponto em outra cidade (Rio) com a etiqueta "rua" → refeito
  '3012': { nf: '3012', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente I', endereco: 'Av. Salgado Filho', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', lat: -22.90, lng: -43.20 },
  // antes da conferência, mas perto do bairro achado agora: fica no lugar, marcado como aproximado
  '3013': { nf: '3013', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente J', endereco: 'Rua Umbuzeiro, 200', cep: '07224010', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', lat: UMBU_ERRADA_LAT, lng: -46.5279 },
  // ponto lembrado (marcado à mão antes) e pedido já em rota: não são mexidos
  '3014': { nf: '3014', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente K', endereco: 'Av. Salgado Filho, 5', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'lembrado', lat: -23.48, lng: -46.54 },
  '3015': { nf: '3015', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente L', endereco: 'Av. Salgado Filho', cep: '07010030', peso: 100, itens: 1, status: 'em_rota', geoStatus: 'ok', geoPrec: 'rua', lat: -22.90, lng: -43.20 },
  '3007': { nf: '3007', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente B', endereco: 'R. Sem Numero no Mapa, 50 - fundos', cep: '07020-000', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
};
const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, geo_cache: { '07020000': { lat: 1, lng: 1, bairro: 'Velho', cidade: 'Guarulhos', uf: 'SP' } },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};
const VIACEP = {
  '07010030': { logradouro: 'Avenida Salgado Filho', bairro: 'Centro', localidade: 'Guarulhos', uf: 'SP' },
  '07020000': { logradouro: 'Rua Sem Número no Mapa', bairro: 'Vila B', localidade: 'Guarulhos', uf: 'SP' },
  '07099999': { logradouro: '', bairro: '', localidade: 'Guarulhos', uf: 'SP' },
  '07224010': { logradouro: 'Rua Umbuzeiro', bairro: 'Cidade Industrial Satélite de São Paulo', localidade: 'Guarulhos', uf: 'SP' },
};
const reg = { nom: [], cep: [] };
// resposta como a do Nominatim de verdade: endereço com a cidade e o estado (BR-SP)
const res = (o, extra = {}, cidade = 'Guarulhos') => [{ lat: String(o.lat), lon: String(o.lng), address: { country: 'Brasil', city: cidade, state: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP', ...extra } }];
const UMBU_ERRADA = { lat: -23.4453, lng: -46.5279 };   // "Rua São Sebastião do Umbuzeiro": outra rua, 5 km dali
function nominatim(u) {
  const q = u.searchParams.get('q') || '', st = u.searchParams.get('street') || '', city = u.searchParams.get('city') || '';
  reg.nom.push(q || `street=${st}|city=${city}|state=${u.searchParams.get('state') || ''}`);
  if (st === 'Avenida Salgado Filho' && city === 'Guarulhos') return res(RUA_SF, { road: 'Avenida Salgado Filho' });
  if (st === 'Rua Sem Número no Mapa' && city === 'Guarulhos') return res(RUA_SN, { road: 'Rua Sem Número no Mapa' });
  // o "mais parecido" do Nominatim: rua de outro nome (conferido ao vivo em 19/11) e rua de outra cidade
  if (st === 'Rua Umbuzeiro' && city === 'Guarulhos') return res(UMBU_ERRADA, { road: 'Rua São Sebastião do Umbuzeiro' });
  if (q.startsWith('Cidade Industrial Satélite')) return [];
  if (st === '5 Rua Longe' && city === 'Arujá') return res({ lat: -22.90, lng: -43.20 }, { road: 'Rua Longe', house_number: '5' }, 'Rio de Janeiro');
  if (st === 'Rua Longe' && city === 'Arujá') return res({ lat: -22.90, lng: -43.20 }, { road: 'Rua Longe' }, 'Rio de Janeiro');
  if (!q && !st && city === 'Arujá') return res({ lat: -23.396, lng: -46.320 }, {}, 'Arujá');
  if (q === 'Guarulhos, SP, Brasil') return res({ lat: -23.45, lng: -46.52 }, { city: 'Guarulhos' });
  if (st === '1000 Avenida Salgado Filho' && city === 'Guarulhos') return res(NUM_1000, { road: 'Avenida Salgado Filho', house_number: '1000' });
  if (st === '999 Avenida Salgado Filho') return res({ lat: -23.30, lng: -46.40 }, { road: 'Avenida Salgado Filho', house_number: '999' }); // longe: outra rua
  if (st === '50 Rua Sem Número no Mapa') return res(RUA_SN, { road: 'Rua Sem Número no Mapa' });
  if (st === '7 Rua Tal' && city === 'Arujá') return res({ lat: -23.395, lng: -46.321 }, { road: 'Rua Tal' }, 'Arujá');
  if (st === '12 Rua Nova' && city === 'Guarulhos') return [];
  if (st === 'Rua Nova' && city === 'Guarulhos') return [];
  if (!q && !st && city === 'Guarulhos') return res({ lat: -23.45, lng: -46.52 }, { city: 'Guarulhos' });
  return [];
}
const emp = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1)));

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  p.on('pageerror', (e) => console.log('STACK', (e.stack || '').split('\n').slice(0, 5).join(' | ')));
  p.on('dialog', (d) => d.accept());
  await ctx.route(/viacep\.com\.br\/ws\/(\d+)\/json/, (r) => {
    const cep = r.request().url().match(/ws\/(\d+)\//)[1]; reg.cep.push(cep);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(VIACEP[cep] || { erro: true }) });
  });
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(nominatim(new URL(r.request().url()))) }));
  // a fila começa 4 s depois de abrir; ~1,1 s por consulta ao Nominatim
  await p.waitForFunction(() => { const e = document.getElementById('geo-status-bar'); return e && /Mapa atualizado/.test(e.textContent); }, null, { timeout: 40000 });
  const barra = await p.textContent('#geo-status-bar');
  let e = await emp(p); let d = e.pedidos_rota;
  ok(d['3001'].geoPrec === 'numero' && d['3001'].lat === NUM_1000.lat && d['3001'].geoStatus === 'ok', 'com número no mapa: ponto do número ("1.000" lido como mil)');
  ok(reg.nom.some((q) => q.includes('street=1000 Avenida Salgado Filho|city=Guarulhos|state=São Paulo')), 'busca o número com o nome oficial da rua (pelo CEP) e o estado por extenso');
  ok(d['3002'].geoPrec === 'rua' && d['3002'].lat === RUA_SN.lat, 'número fora do mapa: fica na rua (precisão "rua")');
  ok(d['3003'].geoPrec === 'cidade' && d['3003'].geoStatus === 'ok', 'CEP só da cidade: ponto da cidade, marcado como aproximado');
  ok(d['3004'].geoPrec === 'rua' && d['3004'].lat === -23.395, 'sem CEP, com endereço: acha a rua pela cidade (antes ficava sem local)');
  ok(d['3005'].geoPrec === 'rua' && d['3005'].lat === RUA_SF.lat, 'antigo: número achado longe da rua do CEP é recusado; ponto continua o mesmo');
  ok(d['3006'].lat === -23.5 && !d['3006'].geoPrec, 'ponto marcado à mão não é mexido');
  ok(d['3007'].geoPrec === 'rua' && d['3007'].lat === RUA_SN.lat, 'mesma rua escrita diferente ("R." e "fundos"): mesmo endereço');
  ok(reg.nom.filter((q) => q.startsWith('street=50 ')).length === 1, 'mesmo endereço em duas notas: uma consulta só (' + reg.nom.filter((q) => q.startsWith('street=50 ')).length + ')');
  ok(e.config.locais && Object.keys(e.config.locais).some((k) => k.startsWith('07010030_1000_')), 'resultado com número fica guardado na área da empresa');
  ok(Object.keys(e.config.locais).every((k) => /^[a-z0-9_-]+$/.test(k)), 'chaves válidas no Firebase: ' + Object.keys(e.config.locais).join(' '));
  ok(d['3008'].geoPrec === 'cidade' && d['3008'].lat !== UMBU_ERRADA.lat,
    'rua de outro nome ("São Sebastião do Umbuzeiro" no lugar de "Umbuzeiro") é recusada: fica aproximado, não no lugar errado com cara de certo');
  ok(d['3009'].geoPrec === 'cidade' && Math.abs(d['3009'].lat - (-23.396)) < 1e-9, 'rua achada em outra cidade é recusada: fica na cidade certa, como aproximado');
  ok(d['3012'].lat === RUA_SF.lat && d['3012'].geoPrec === 'rua' && d['3012'].geoV === 2, 'ponto antigo em outra cidade é refeito com a busca conferida');
  ok(d['3013'].lat === UMBU_ERRADA.lat && d['3013'].geoPrec === 'cidade' && d['3013'].geoV === 2,
    'ponto antigo sem confirmação, na mesma região: continua, mas passa a aparecer como aproximado para corrigir');
  ok(d['3014'].lat === -23.48 && d['3014'].geoPrec === 'lembrado' && !d['3014'].geoV, 'ponto lembrado não é mexido');
  ok(d['3015'].lat === -22.90 && !d['3015'].geoV, 'pedido que já saiu em rota não é mexido');
  ok(d['3001'].geoV === 2 && d['3002'].geoV === 2, 'pedido localizado agora fica marcado como conferido (não é refeito)');
  const gc = await p.evaluate(() => window.__FAKE.db.geo_cache);
  ok(Object.values(gc).every((x) => x.v === 2), 'cache dos CEPs gravado com a versão conferida');
  ok(gc['07020000'].prec === 'rua' && gc['07020000'].lat === RUA_SN.lat && !JSON.stringify(gc).includes('Cliente'), 'cache antigo do CEP (sem precisão) é refeito; cache geral não tem dados do cliente');
  ok(/pelo número/.test(barra) && /bairro ou a cidade/.test(barra), 'aviso final conta quantos foram pelo número e quantos ficaram aproximados: ' + barra);

  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  const aproxTxt = await p.textContent('#ped-aprox');
  ok(aproxTxt.includes('4 pedidos estão sem local exato') && aproxTxt.includes('fica guardado'), 'aviso de aproximado conta os pedidos só com a cidade (inclusive os recusados de outra rua ou cidade) → ' + aproxTxt.slice(0, 80));

  // corrigir à mão: guarda e aplica aos outros pedidos do mesmo endereço
  await p.evaluate(() => window.abrirPedido('3002')); await p.waitForTimeout(350);
  ok((await p.textContent('#ped-geo-st')).includes('não o número'), 'pedido achado só pela rua: avisa que o número não está no mapa');
  await p.click('#ped-mapa', { position: { x: 180, y: 100 } }); await p.waitForTimeout(150);
  ok((await p.textContent('#ped-geo-st')).includes('guarda este ponto'), 'ao marcar: avisa que o ponto fica guardado para o endereço');
  await p.click('#ped-salvar'); await p.waitForTimeout(500);
  e = await emp(p); d = e.pedidos_rota;
  const k = Object.keys(e.config.locais).find((x) => x.startsWith('07020000_50_'));
  const L = e.config.locais[k];
  ok(L && L.p === 'manual' && L.lat === d['3002'].lat && d['3002'].geoManual === true, 'ponto marcado à mão guardado para o endereço (' + k + ')');
  ok(d['3007'].geoPrec === 'lembrado' && d['3007'].lat === d['3002'].lat && d['3007'].lng === d['3002'].lng, 'outro pedido pendente do mesmo endereço recebe o ponto');
  ok((await p.textContent('#geo-status-bar')).includes('1 outro pedido'), 'aviso: "o ponto também foi usado em 1 outro pedido"');

  // nota nova do mesmo endereço (planilha): usa o ponto guardado sem consultar o mapa
  const antes = reg.nom.length;
  const csv = path.join(__dirname, 'xml', 'geo37.csv');
  fs.writeFileSync(csv, 'NF;Cliente;Endereço;Número;Bairro;Cidade;UF;CEP;Peso\n3010;Cliente B;Rua Sem Número no Mapa;50;Vila B;Guarulhos;SP;07020-000;80\n3011;Cliente Novo;Rua Nova;12;;Guarulhos;SP;;30\n');
  await p.setInputFiles('#file-input', csv); await p.waitForTimeout(800);
  await p.waitForFunction(() => { const x = window.__FAKE.db.empresas.emp1.pedidos_rota; return x['3010'] && x['3010'].geoPrec && x['3011'] && x['3011'].geoStatus !== 'sem_cep'; }, null, { timeout: 20000 });
  d = (await emp(p)).pedidos_rota;
  ok(d['3010'].endereco === 'Rua Sem Número no Mapa, 50' && d['3010'].bairro === 'Vila B' && d['3010'].uf === 'SP' && d['3010'].dest === 'Cliente B', 'planilha: colunas endereço + número, bairro, UF e cliente');
  ok(d['3010'].geoPrec === 'lembrado' && d['3010'].lat === d['3002'].lat, 'nota nova do mesmo endereço já sai no ponto marcado à mão');
  ok(!reg.nom.slice(antes).some((q) => q.includes('Sem Número')), 'sem consultar o mapa de novo para esse endereço');
  ok(d['3011'].geoPrec === 'cidade', 'planilha sem CEP e rua fora do mapa: fica na cidade (aproximado)');

  // pedido novo à mão com o mesmo endereço: "Buscar" acha o ponto guardado
  await p.evaluate(() => window.novoPedido()); await p.waitForTimeout(300);
  await p.fill('#ped-nf', '3020'); await p.fill('#ped-cep', '07020000'); await p.fill('#ped-end', 'Rua Sem Numero no Mapa, 50');
  await p.fill('#ped-cidade', 'Guarulhos'); await p.fill('#ped-uf', 'SP'); await p.fill('#ped-peso', '10');
  await p.click('#ped-buscar'); await p.waitForTimeout(400);
  ok((await p.textContent('#ped-geo-st')).includes('já tinha marcado'), 'buscar no cadastro: usa o ponto já marcado para o endereço');
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  d = (await emp(p)).pedidos_rota;
  ok(d['3020'].geoPrec === 'lembrado' && d['3020'].lat === d['3002'].lat && !d['3020'].geoManual, 'salvo com o ponto guardado');

  // mapa: tooltip diz de onde veio o ponto
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(500);
  const tips = await p.evaluate(() => { const out = []; document.querySelectorAll('#mapa-completo path.leaflet-interactive'); return out; });
  ok(errs.length === 0, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  // serviço de endereços fora do ar: ponto antigo fica, nada é marcado como conferido, e não insiste
  {
    const PED2 = {
      '4001': { nf: '4001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Antigo', endereco: 'Rua X', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', lat: -23.47, lng: -46.51 },
      '4003': { nf: '4003', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Antigo 2', endereco: 'Rua Y', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'rua', lat: -23.48, lng: -46.52 },
      '4002': { nf: '4002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Novo', endereco: 'Rua X', cep: '07010030', peso: 10, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
    };
    const seed2 = (ped) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' },
      db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, geo_cache: { '07010030': { lat: -23.4650, lng: -46.5302, bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', rua: 'Avenida Salgado Filho', prec: 'rua' } },
        empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } } }; };
    const o2 = await open(b, 'index.html', 1440, 900, seed2, false, PED2);
    let consultas = 0;
    await o2.ctx.route(/viacep|nominatim/, (r) => { consultas++; r.fulfill({ status: 503, body: 'fora' }); });
    await o2.p.waitForFunction(() => /Mapa atualizado/.test(document.getElementById('geo-status-bar')?.textContent || ''), null, { timeout: 30000 });
    const barra2 = await o2.p.textContent('#geo-status-bar');
    const d2 = await o2.p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1.pedidos_rota)));
    ok(d2['4001'].lat === -23.47 && d2['4001'].geoPrec === 'rua' && !d2['4001'].geoV && !d2['4003'].geoV,
      'serviço fora: ponto antigo fica como estava e NÃO é marcado como conferido');
    ok(d2['4002'].geoStatus === 'ok' && d2['4002'].lat === -23.4650 && !d2['4002'].geoV,
      'pedido novo usa o cache antigo do CEP para não ficar sem ponto, mas fica para conferir depois');
    ok(/fica para depois/.test(barra2) && !/sem localização/.test(barra2), 'aviso diz que a conferência ficou para depois, sem chamar de "sem localização" → ' + barra2);
    const antes2 = consultas;
    await o2.p.evaluate(() => window.__FAKE.set && 0);   // nada: só deixa a tela parada
    await o2.p.waitForTimeout(2500);
    ok(consultas === antes2, `não insiste enquanto o serviço está fora (${antes2} consultas, nenhuma depois)`);
    ok(!o2.errs.length, 'sem erros no console (serviço fora): ' + JSON.stringify(o2.errs.slice(0, 2)));
    await o2.ctx.close();
  }
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
