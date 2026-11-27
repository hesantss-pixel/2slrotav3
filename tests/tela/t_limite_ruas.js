// Dia grande: mais de 439 pedidos pendentes e uma viagem que leva no máximo 20. Vão ao cálculo só
// os 439 mais perto do CD (reentregas primeiro), para o km sair pelas ruas; o resumo conta todos.
// Com 439 ou menos, vão todos. Pontos inventados.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const ped = {};
for (let i = 0; i < 600; i++) {   // em linha para o norte, cada um mais longe do CD
  const r = 0.01 + i * 0.0004, a = 0;
  ped['N' + i] = { nf: String(700000 + i), tipo: 'entrega', dest: 'Cliente ' + i, cidade: 'Guarulhos', peso: 50, itens: 1, status: 'pendente', geoStatus: 'ok',
    lat: CD.lat + r * Math.cos(a), lng: CD.lng + r * Math.sin(a) };
}
// duas reentregas longe (entre as últimas): entram mesmo assim
ped.N598 = { ...ped.N598, tentativas: 1, reentrega: { sit: 'fila', prio: 2, resp: 'dest', motivo: 'Cliente ausente', desde: Date.now() } };
ped.N599 = { ...ped.N599, tentativas: 1, reentrega: { sit: 'fila', prio: 2, resp: 'dest', motivo: 'Cliente ausente', desde: Date.now() } };
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
(async () => {
  const b = await chromium.launch();
  const reg = [];
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis|railway\.app\/(tracado|avaliar|geocode)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/solve/, (r) => {
      const body = JSON.parse(r.request().postData()); reg.push(body);
      const v = body.veiculos[0], leva = body.pedidos.slice(0, v.maxPed);
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: v.nome, veiculo_id: v.id, pedidos: leva, km: 20, mins: 240 }],
        nao_alocados: body.pedidos.slice(v.maxPed).map((p) => p.id), fonte_distancia: body.pedidos.length > 439 ? 'Haversine:limite' : 'OSRM', maior_que_bau: [] }) });
    });
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: ped }), rotas);
  p.on('dialog', (d) => d.accept());
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.evaluate(() => window.selVeicD('toco')); await p.waitForTimeout(200);
  const nota = (await p.textContent('#rot-cidade-nota')).replace(/\s+/g, ' ');
  ok(/600 pedidos pendentes em Guarulhos\. O km pelas ruas é medido com até 439 por vez, então o cálculo usa os 439 mais perto do CD/.test(nota) && !/servidor|⚠️/.test(nota), 'a nota explica o recorte, sem alarme: ' + nota.slice(0, 150));
  await p.fill('#cap-kg-d', '6000'); await p.fill('#cap-maxped-d', '20');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
  const env = reg[0].pedidos;
  const ids = new Set(env.map((x) => x.id));
  ok(env.length === 439, 'vão ao cálculo 439 pedidos, não 600: ' + env.length);
  ok(ids.has('N598') && ids.has('N599'), 'as duas reentregas entram, mesmo longe do CD');
  ok(ids.has('N0') && ids.has('N436') && !ids.has('N437') && !ids.has('N597'), 'os outros são os mais perto do CD (437 mais as 2 reentregas)');
  const res = (await p.textContent('#rot-step-results')).replace(/\s+/g, ' ');
  ok(/Esta viagem levou 20 de 600 pedidos/.test(res) && /Os outros 580 continuam pendentes/.test(res) && /considerou os 439 mais perto do CD/.test(res),
    'o resumo conta os 600 e diz o recorte: ' + (res.match(/Esta viagem levou[^]*?CD\./) || [''])[0]);
  ok(!/estimad|linha reta/.test(res), 'com 439, o km sai pelas ruas (sem aviso de estimado)');
  // com 439 ou menos, vão todos
  await p.click('text=Gerar outra rota'); await p.waitForTimeout(300);
  await p.evaluate(() => { for (let i = 0; i < 200; i++) window.__FAKE.setAt(`empresas/emp1/pedidos_rota/N${i}/status`, 'entregue'); window.__FAKE.fire(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => window.selVeicD('toco')); await p.waitForTimeout(200);
  await p.fill('#cap-kg-d', '6000'); await p.fill('#cap-maxped-d', '20');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
  ok(reg[reg.length - 1].pedidos.length === 400 && !/considerou os 439/.test(await p.textContent('#rot-step-results')), 'com 400 pendentes, vão todos e não há recorte: ' + reg[reg.length - 1].pedidos.length);
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
