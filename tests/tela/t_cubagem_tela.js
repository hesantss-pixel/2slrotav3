// Tela Cubagem (volume), reorganizada: resumo de quantos pendentes têm m³ e de onde ele vem,
// lista dos sem m³ (mais pesados primeiro) com "Informar m³", fontes do m³ com ação, estimativa
// pelo peso, medidas dos produtos só com nota em XML e o fator de cubagem no fim, com exemplo.
// Dados inventados; nada de cliente real.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const g = (lat) => ({ tipo: 'entrega', cidade: 'Guarulhos', status: 'pendente', geoStatus: 'ok', lat, lng: -46.52 });
const CH = '35251112345678000199550010000930011000930015';
const PED = {
  A1: { nf: 'A1', dest: 'Loja CTe', peso: 300, itens: 3, m3: 1.2, m3Fonte: 'cte', ...g(-23.45) },
  A2: { nf: 'A2', dest: 'Loja Planilha', peso: 200, itens: 2, m3: 0.5, m3Fonte: 'planilha', ...g(-23.451) },
  A3: { nf: 'A3', dest: 'Loja Digitada', peso: 100, itens: 1, m3: 0.3, m3Fonte: 'digitado', ...g(-23.452) },
  B1: { nf: 'B1', dest: 'Loja Pesada', peso: 900, itens: 6, ...g(-23.453) },
  B2: { nf: 'B2', dest: 'Loja Leve', peso: 100, itens: 1, ...g(-23.454) },
  [CH]: { nf: '930001', chave: CH, dest: 'Mercado XML', remetente: 'Fábrica Teste', peso: 400, itens: 4, ...g(-23.455),
    produtos: [{ d: 'Caixa de teste', q: 4, u: 'CX', c: 'T1' }] },
  OK1: { nf: 'OK1', dest: 'Já entregue', peso: 50, itens: 1, ...g(-23.456), status: 'entregue' },
};
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const sem = (t) => (t || '').replace(/\s+/g, ' ').trim();

(async () => {
  const b = await chromium.launch();
  const rotas = async (c) => c.route(/nominatim|viacep|maps\.googleapis/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seedEmpresa({ config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: PED }), rotas);
  p.on('dialog', (d) => d.accept());
  ok(sem(await p.textContent('.sb-item[data-page="produtos"]')) === 'Cubagem', 'o menu chama a tela de "Cubagem"');
  await p.evaluate(() => window.irParaPagina('produtos')); await p.waitForTimeout(400);
  ok(sem(await p.textContent('#page-produtos .page-title')) === 'Cubagem (volume)', 'título novo');

  // resumo
  let res = sem(await p.textContent('#cub-resumo'));
  ok(/Dos 6 pedidos pendentes, 3 têm m³ \(2 m³ ao todo\) e 3 estão sem\./.test(res), 'resumo: 3 com m³ (1,2 + 0,5 + 0,3) e 3 sem; o entregue não conta: ' + res.slice(0, 90));
  ok(/Com m³: 3/.test(res) && /Sem m³: 3/.test(res) && await p.$('#cub-resumo .cub-barra .com'), 'barra e legenda');
  const sems = await p.$$eval('#cub-sem .cub-ped b', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(J(sems) === J(['NF B1 · Loja Pesada', 'NF 930001 · Mercado XML', 'NF B2 · Loja Leve']), 'sem m³, do mais pesado para o mais leve: ' + J(sems));
  ok(/falta a medida de 1 produto/.test(sem(await p.textContent('#cub-sem'))), 'o pedido do XML diz que falta medir 1 produto');

  // de onde vem o m³
  const n = (gp) => p.textContent(`.cub-or[data-or="${gp}"] .n`).then(sem);
  ok((await n('sistema')) === '2 pedidos' && (await n('digitado')) === '1 pedido' && (await n('produtos')) === '0 pedidos', 'cada fonte diz quantos pedidos usam');
  ok(await p.isVisible('.cub-or[data-or="sistema"] >> text=Importar arquivos') && await p.isVisible('.cub-or[data-or="produtos"] >> text=Medir produtos'), 'CT-e/planilha leva à importação; com nota em XML, "Medir produtos"');
  ok(await p.isVisible('#cub-sec-prod') && /Caixa de teste/.test(await p.textContent('#prod-pend')), 'medidas dos produtos aparecem (há nota em XML)');

  // informar o m³ no pedido mais pesado
  await p.click('#cub-sem .cub-ped >> nth=0 >> text=Informar m³'); await p.waitForTimeout(400);
  ok(await p.isVisible('#modal-pedido') && /B1/.test(await p.textContent('#ped-tit')), 'abre o pedido NF B1');
  await p.fill('#ped-m3', '0,8');
  await p.click('#ped-salvar'); await p.waitForTimeout(600);
  res = sem(await p.textContent('#cub-resumo'));
  ok(/Dos 6 pedidos pendentes, 4 têm m³ \(2,8 m³ ao todo\) e 2 estão sem\./.test(res) && (await n('digitado')) === '2 pedidos', 'o resumo atualiza: 4 com m³ (2,8 m³): ' + res.slice(0, 80));

  // estimar pelo peso
  await p.check('#cub-estimar'); await p.fill('#cub-dens', '20');
  await p.click('.cub-or[data-or="estimado"] >> text=Salvar'); await p.waitForTimeout(200);
  ok(await p.getAttribute('#cub-dens', 'aria-invalid') === 'true', 'densidade fora de 50 a 2.000 não salva');
  await p.fill('#cub-dens', '250');
  await p.click('.cub-or[data-or="estimado"] >> text=Salvar'); await p.waitForTimeout(300);
  res = sem(await p.textContent('#cub-resumo'));
  const cfg = await p.evaluate(() => JSON.parse(localStorage.getItem('rotav3_cubagem') || '{}'));
  ok(/Dos 6 pedidos pendentes, 4 têm m³ \(2,8 m³ ao todo\) e 2 estão estimados pelo peso\./.test(res) && !(await p.$('#cub-sem .cub-ped')), 'com a estimativa ligada, os 2 sem medida passam a estimados: ' + res.slice(0, 100));
  ok(cfg.estimar === true && cfg.dens === 250, 'a escolha vale também para a Roteirização (mesma configuração): ' + J(cfg));
  await p.uncheck('#cub-estimar'); await p.click('.cub-or[data-or="estimado"] >> text=Salvar'); await p.waitForTimeout(300);
  ok(/2 estão sem/.test(sem(await p.textContent('#cub-resumo'))), 'desligar a estimativa volta a mostrar os sem m³');

  // fator de cubagem no fim, com o exemplo
  const secs = await p.$$eval('#page-produtos .prod-sec .prod-h', (h) => h.map((x) => x.textContent.trim()));
  ok(secs[secs.length - 1] === 'Fator de cubagem (frete)', 'o fator fica no fim: ' + J(secs));
  ok(/10 caixas de 50 × 40 × 30 cm = 0,6 m³\. Com 300 kg por m³, são 180 kg cubados/.test(sem(await p.textContent('#cub-exemplo'))), 'exemplo com o fator atual');
  await p.fill('#prod-fator', '250'); await p.click('.prod-fator .btn-sm'); await p.waitForTimeout(400);
  ok(/são 150 kg cubados/.test(sem(await p.textContent('#cub-exemplo'))), 'o exemplo acompanha o fator salvo');
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close();

  // sem nota em XML: a parte dos produtos some e o cartão explica
  {
    const ped = Object.fromEntries(Object.entries(PED).filter(([k]) => k !== CH));
    const { ctx: c2, p: q, errs: e2 } = await open(b, 'index.html', 375, 760, init, true, seedEmpresa({ config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped }), rotas);
    await q.evaluate(() => window.irParaPagina('produtos')); await q.waitForTimeout(400);
    ok(!(await q.isVisible('#cub-sec-prod')) && /Aparece quando chegar pedido pelo XML da nota/.test(await q.textContent('.cub-or[data-or="produtos"]')),
      'sem nota em XML e sem produto medido: a seção de produtos não aparece');
    const larg = await q.evaluate(() => document.documentElement.scrollWidth);
    ok(larg <= 375, 'no celular nada passa da tela (' + larg + ' px)');
    await q.screenshot({ path: 'cubagem-375.png', fullPage: true });
    ok(!e2.length, 'sem erros no console ' + J(e2.slice(0, 3)));
    await c2.close();
  }
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
