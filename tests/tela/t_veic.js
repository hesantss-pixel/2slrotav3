// Desenho dos cinco veículos: carregam, são diferentes entre si e aparecem nos quatro
// lugares onde a frota é mostrada (roteirização, atalho dos motoristas fixos, página
// Motoristas e cadastro de motorista).
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const PED = {};
for (let i = 1; i <= 14; i++) PED['90' + i] = { nf: '90' + i, tipo: i % 4 === 0 ? 'coleta' : 'entrega',
  cidade: ['Guarulhos','São Paulo','Arujá','Itaquaquecetuba','Mogi das Cruzes'][i % 5],
  dest: 'Cliente ' + i, endereco: 'Avenida Tiradentes, ' + (100 * i), bairro: 'Centro', uf: 'SP',
  cep: '0701000' + (i % 10), peso: 80 * i, itens: i, status: 'pendente', geoStatus: 'ok',
  geoPrec: 'numero', lat: -23.42 - i * 0.01, lng: -46.4 - i * 0.012 };
const MOT = { m1: { id: 'm1', nome: 'Carlos Souza', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', cap_kg: 8000 },
              m2: { id: 'm2', nome: 'Ana Ribeiro', veiculo_id: 'fiorino', veiculo_nome: 'Fiorino', cap_kg: 1500 } };
const seed = (d) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
  db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
    empresas: { emp1: { info: { nome: 'Transportadora Exemplo' },
      config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
      pedidos_rota: d.ped, motoristas: d.mot } } } }; };

(async () => {
  const b = await chromium.launch();
  for (const [W, H, mob, tag] of [[1440, 900, false, '1440px'], [390, 844, true, '390px'], [320, 740, true, '320px']]) {
    const { ctx, p, errs } = await open(b, 'index.html', W, H, seed, mob, { ped: PED, mot: MOT });
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.waitForTimeout(900);
    await p.evaluate(() => window.irParaPagina('roteirizacao'));
    await p.waitForTimeout(800);
    const r = await p.evaluate(() => {
      const imgs = [...document.querySelectorAll('.veh-img, .veh-img-mini')];
      return { total: imgs.length,
        quebradas: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
        distintos: [...new Set([...document.querySelectorAll('#veh-grid img')].map((i) => i.getAttribute('src')))].length };
    });
    ok(r.total > 0, `${tag}: a roteirização mostra os desenhos (${r.total})`);
    ok(!r.quebradas.length, `${tag}: todos os desenhos carregam` + (r.quebradas.length ? ' → ' + r.quebradas.join(', ') : ''));
    ok(r.distintos === 5, `${tag}: os cinco veículos têm desenhos diferentes (${r.distintos})`);

    await p.evaluate(() => window.irParaPagina('motoristas'));
    await p.waitForTimeout(600);
    const m = await p.evaluate(() => {
      const i = [...document.querySelectorAll('.rc-card-veic img')];
      return { n: i.length, ok: i.every((x) => x.complete && x.naturalWidth > 0), src: i.map((x) => x.getAttribute('src')) };
    });
    ok(m.n === 2 && m.ok, `${tag}: cada motorista aparece com o desenho do veículo dele (${m.n})`);
    ok(m.src[0] !== m.src[1], `${tag}: motoristas de veículos diferentes não usam o mesmo desenho: ` + JSON.stringify(m.src));

    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(over <= 1, `${tag}: sem rolagem lateral (${over}px)`);
    ok(!errs.length, `${tag}: sem erros no console ` + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // cadastro de motorista: a grade de escolha também mostra os cinco
  {
    const { ctx, p } = await open(b, 'index.html', 1280, 900, seed, false, { ped: PED, mot: {} });
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.waitForTimeout(800);
    await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(500);
    await p.evaluate(() => window.toggleFormMotorista()); await p.waitForTimeout(600);
    const f = await p.evaluate(() => {
      const i = [...document.querySelectorAll('#mot-veh-grid img')];
      return { n: i.length, ok: i.every((x) => x.complete && x.naturalWidth > 0),
               distintos: new Set(i.map((x) => x.getAttribute('src'))).size };
    });
    ok(f.n === 5 && f.ok && f.distintos === 5, 'cadastro de motorista mostra os cinco desenhos: ' + JSON.stringify(f));
    await ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
