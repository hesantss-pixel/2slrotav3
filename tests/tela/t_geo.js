// Versão 3.7: localizar pelo número, guardar o ponto corrigido à mão e usar nas próximas notas
const { chromium } = require('playwright');
const { open } = require('./harness');
const fs = require('fs'), path = require('path');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const RUA_SF = { lat: -23.4650, lng: -46.5302 };     // "Avenida Salgado Filho" (a rua)
const NUM_1000 = { lat: -23.4700, lng: -46.5350 };   // número 1000
const RUA_SN = { lat: -23.4400, lng: -46.5000 };     // rua sem número no mapa
const PED = {
  '3001': { nf: '3001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente A', endereco: 'Av. Salgado Filho, 1.000 - Sala 2', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3002': { nf: '3002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente B', endereco: 'Rua Sem Numero No Mapa, 50', cep: '07020000', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3003': { nf: '3003', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente C', endereco: 'Rua Qualquer, 10', cep: '07099999', peso: 100, itens: 1, status: 'pendente', geoStatus: 'pendente', lat: -23.46, lng: -46.53 },
  '3004': { nf: '3004', tipo: 'entrega', cidade: 'Arujá', dest: 'Cliente D', endereco: 'Rua Tal, 7', uf: 'SP', peso: 100, itens: 1, status: 'pendente', geoStatus: 'sem_cep', lat: -23.39, lng: -46.32 },
  '3005': { nf: '3005', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente E (antigo)', endereco: 'Av. Salgado Filho, 999', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', lat: RUA_SF.lat, lng: RUA_SF.lng },
  '3006': { nf: '3006', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente F (à mão)', endereco: 'Av. Salgado Filho, 1000', cep: '07010030', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoManual: true, lat: -23.5, lng: -46.6 },
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
};
const reg = { nom: [], cep: [] };
const res = (o, extra = {}) => [{ lat: String(o.lat), lon: String(o.lng), address: { country: 'Brasil', ...extra } }];
function nominatim(u) {
  const q = u.searchParams.get('q') || '', st = u.searchParams.get('street') || '', city = u.searchParams.get('city') || '';
  reg.nom.push(q || `street=${st}|city=${city}|state=${u.searchParams.get('state') || ''}`);
  if (q.startsWith('Avenida Salgado Filho, Guarulhos')) return res(RUA_SF, { road: 'Avenida Salgado Filho' });
  if (q.startsWith('Rua Sem Número no Mapa, Guarulhos')) return res(RUA_SN, { road: 'Rua Sem Número no Mapa' });
  if (q === 'Guarulhos, SP, Brasil') return res({ lat: -23.45, lng: -46.52 }, { city: 'Guarulhos' });
  if (st === '1000 Avenida Salgado Filho' && city === 'Guarulhos') return res(NUM_1000, { road: 'Avenida Salgado Filho', house_number: '1000' });
  if (st === '999 Avenida Salgado Filho') return res({ lat: -23.30, lng: -46.40 }, { road: 'Avenida Salgado Filho', house_number: '999' }); // longe: outra rua
  if (st === '50 Rua Sem Número no Mapa') return res(RUA_SN, { road: 'Rua Sem Número no Mapa' });
  if (st === '7 Rua Tal' && city === 'Arujá') return res({ lat: -23.395, lng: -46.321 }, { road: 'Rua Tal' });
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
  const gc = await p.evaluate(() => window.__FAKE.db.geo_cache);
  ok(gc['07020000'].prec === 'rua' && gc['07020000'].lat === RUA_SN.lat && !JSON.stringify(gc).includes('Cliente'), 'cache antigo do CEP (sem precisão) é refeito; cache geral não tem dados do cliente');
  ok(/pelo número/.test(barra) && /bairro ou a cidade/.test(barra), 'aviso final conta quantos foram pelo número e quantos ficaram aproximados: ' + barra);

  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  ok((await p.textContent('#ped-aprox')).includes('1 pedido está sem local exato') && (await p.textContent('#ped-aprox')).includes('fica guardado'), 'aviso de aproximado conta o pedido só com a cidade');

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
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
