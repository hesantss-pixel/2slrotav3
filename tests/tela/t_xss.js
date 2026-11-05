// Segurança: texto que vem de fora (cidade da nota fiscal, nome do motorista) não pode
// virar HTML na tela de quem está logado. Se alguém tirar o esc(), este teste falha.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const PAYLOAD = (g) => `<img src=x onerror="window.${g}=1">`;
const PED = { p1: { nf: '1001', tipo: 'entrega', cidade: PAYLOAD('__XSS_CIDADE'), dest: 'Cliente',
  endereco: 'Rua A, 10', bairro: 'Centro', uf: 'SP', cep: '07010000', peso: 100, itens: 1,
  status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', lat: -23.43, lng: -46.41 } };
const MOT = { m1: { id: 'm1', nome: PAYLOAD('__XSS_MOTORISTA'), veiculo_id: 'vuc',
  veiculo_nome: PAYLOAD('__XSS_VEICULO'), cap_kg: 3000 } };
const seed = (d) => { window.__FAKE = { user: { uid: 'u', email: 'a@b.c', getIdToken: async () => 'T' },
  db: { acesso: { u: true }, membros: { u: 'emp1' }, empresas: { emp1: { info: { nome: 'E' },
    config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } },
    pedidos_rota: d.ped, motoristas: d.mot } } } }; };

(async () => {
  const b = await chromium.launch();
  const { ctx, p } = await open(b, 'index.html', 1280, 900, seed, false, { ped: PED, mot: MOT });
  await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await p.waitForTimeout(1500);

  const dash = await p.evaluate(() => ({
    executou: !!window.__XSS_CIDADE,
    html: (document.getElementById('reg-list') || {}).innerHTML || '' }));
  ok(!dash.executou, 'cidade da nota não executa script no cartão de regiões');
  ok(dash.html.includes('&lt;img'), 'cidade aparece como texto, escapada: ' + dash.html.slice(0, 80));

  const insight = await p.evaluate(() => (document.getElementById('ia-insights') || {}).innerHTML || '');
  ok(!insight.includes('<img src=x'), 'cidade não vira marcação no texto do insight');

  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(700);
  ok(!(await p.evaluate(() => !!window.__XSS_CIDADE)), 'cidade não executa script no balão do mapa');

  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(700);
  ok(!(await p.evaluate(() => !!window.__XSS_MOTORISTA || !!window.__XSS_VEICULO)),
     'nome do motorista não executa script no atalho da roteirização');

  await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(700);
  ok(!(await p.evaluate(() => !!window.__XSS_MOTORISTA || !!window.__XSS_VEICULO)),
     'nome do motorista não executa script na página Motoristas');

  // a importação também limpa o nome da cidade na entrada
  const limpo = await p.evaluate(() => typeof window._cidadeNorm === 'function'
    ? window._cidadeNorm('<img src=x>Guarulhos') : null);
  if (limpo !== null) ok(!/[<>]/.test(limpo), 'importação tira < > do nome da cidade: ' + limpo);

  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
