// Planilha de pedidos: a de demonstração (demo/pedidos-teste-sao-paulo-120.csv), que é
// a mesma mandada para o cliente. Cobre o que a importação precisa acertar: formato
// brasileiro de peso ("1.050,50" = 1050,5 kg e não 1,05), telefone do destinatário,
// coluna tipo (entrega/coleta), nome de cidade padronizado, nota sem peso avisada,
// endereço sem número, CEP inválido e NF repetida.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const seed = () => { window.__FAKE = {
  user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
  db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
    empresas: { emp1: { info: { nome: 'Transportadora Teste' },
      config: { deposito: { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 } } } } } }; };
(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false);
  await ctx.route(/nominatim|viacep|railway\.app/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  const dialogos = [];
  p.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await p.waitForTimeout(900);
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(400);
  await p.setInputFiles('#file-input', '../../demo/pedidos-teste-sao-paulo-120.csv');
  await p.waitForTimeout(4000);
  const d = await p.evaluate(() => {
    const o = window.__FAKE.db.empresas.emp1.pedidos_rota || {};
    const v = Object.values(o);
    return { n: v.length,
      pesoTotal: Math.round(v.reduce((s, x) => s + (+x.peso || 0), 0)),
      comFone: v.filter(x => x.fone).length,
      foneEx: (v.find(x => x.fone) || {}).fone,
      coletas: v.filter(x => x.tipo === 'coleta').length,
      cidades: [...new Set(v.map(x => x.cidade))].sort(),
      semPeso: v.filter(x => !x.peso).length,
      milhar: (v.find(x => x.dest === 'Autopeças Ferreira') || {}).peso,
      semNum: v.filter(x => x.endereco && !/\d/.test(x.endereco)).map(x => x.endereco),
      semCep: v.filter(x => !x.cep).length,
      volMax: Math.max(...v.map(x => +x.itens || 0)),
      msg: (document.getElementById('import-msg') || {}).textContent || '' };
  });
  console.log(JSON.stringify(d, null, 1));
  ok(d.n === 119, `119 pedidos no banco (a NF repetida virou um só): ${d.n}`);
  ok(d.pesoTotal > 18000 && d.pesoTotal < 21000, `peso total ~19 t: ${d.pesoTotal} kg`);
  ok(d.milhar === 1050.5, `peso "1.050,50" lido como 1050.5: ${d.milhar}`);
  ok(d.comFone >= 80 && /^11900000/.test(d.foneEx), `telefone guardado: ${d.comFone} pedidos, ex. ${d.foneEx}`);
  ok(d.coletas === 10, `10 coletas: ${d.coletas}`);
  ok(d.cidades.filter(c => /^s.o paulo$/i.test(c)).length === 1, `cidade padronizada: ${JSON.stringify(d.cidades)}`);
  ok(d.semPeso === 0, `nota sem peso entra com 100 kg (e a tela avisa): ${d.semPeso}`);
  ok(d.semNum.length === 1, `1 endereço sem número: ${JSON.stringify(d.semNum)}`);
  ok(d.semCep === 2, `2 notas sem CEP válido: ${d.semCep}`);
  ok(d.volMax === 40, `volume máximo 40: ${d.volMax}`);
  ok(dialogos.some(x => /1 nota está sem peso/.test(x) && /100 kg/.test(x)), 'avisa a nota sem peso: ' + JSON.stringify(dialogos));
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await p.screenshot({ path: 'planilha-120.png', fullPage: false });
  await b.close();
  console.log(falhas ? `${falhas} falha(s)` : 'importação ok');
})();
