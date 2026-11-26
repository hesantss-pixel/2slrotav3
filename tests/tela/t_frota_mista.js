// Vários veículos de uma vez (frota do dia) e carga → rota: quando as caixas não cabem pelo
// formato, a tela refaz a divisão (troca de veículo ou deixa para a próxima viagem).
// O motor de rotas é simulado aqui (distribui na ordem dos veículos, respeitando kg, m³, paradas
// e comprimento do baú); o motor de verdade é testado em backend/tests/test_vrp_frota.py.
// Dados inventados (placas TST); nada de cliente real.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const g = (lat) => ({ cidade: 'Guarulhos', uf: 'SP', status: 'pendente', geoStatus: 'ok', lat, lng: -46.52 });

const PEDIDOS = {
  F1: { nf: 'F1', tipo: 'entrega', peso: 200, itens: 4, dest: 'Loja Um', m3: 0.5, m3Fonte: 'medidas', medidas: '50 × 50 × 50 cm', ...g(-23.45) },
  F2: { nf: 'F2', tipo: 'entrega', peso: 300, itens: 2, dest: 'Loja Dois', ...g(-23.46) },
  // 2,2 m de altura, "este lado para cima": não deita, não entra no VUC (2,1 m), entra no Toco (2,4 m)
  F3: { nf: 'F3', tipo: 'entrega', peso: 400, itens: 1, dest: 'Loja Três', m3: 3.168, m3Fonte: 'medidas', medidas: '120 × 120 × 220 cm', maiorCm: 220, obsNota: 'ESTE LADO PARA CIMA', ...g(-23.47) },
};
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: PEDIDOS,
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };

// motor simulado: cada pedido vai no primeiro veículo (na ordem enviada) que ainda tem espaço
function motor(body) {
  const vs = body.veiculos.map((v) => ({ ...v, kg: 0, m3: 0, ps: [] })), nao = [];
  for (const p of body.pedidos) {
    const m3 = +p.m3 || 0, kg = +p.peso || 0;
    const v = vs.find((x) => x.kg + kg <= x.capKg && (!x.capM3 || x.m3 + m3 <= x.capM3 + 1e-9) && x.ps.length < x.maxPed && !(x.compCm && +p.maiorCm > x.compCm));
    if (v) { v.kg += kg; v.m3 += m3; v.ps.push(p); } else nao.push(String(p.nf));
  }
  return { routes: vs.filter((v) => v.ps.length).map((v) => ({ veiculo: v.nome, veiculo_id: v.id, pedidos: v.ps, km: 10, mins: 40 })),
    nao_alocados: nao, fonte_distancia: 'OSRM', maior_que_bau: [] };
}

(async () => {
  const b = await chromium.launch();
  const reqs = [];
  const rotas = async (c) => c.route(/railway\.app\/solve/, async (r) => {
    const body = JSON.parse(r.request().postData()); reqs.push(body);
    r.fulfill({ contentType: 'application/json', body: J(motor(body)) });
  });

  // ── um veículo só: a caixa alta fica para a próxima viagem ───────────────
  {
    const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
    const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
    await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(150);   // VUC
    await p.fill('#cap-kg-d', '3000');
    ok(!(await p.isVisible('#cap-frota-d')) && await p.isVisible('#cap-kg-d'), 'com um veículo, a tela mostra capacidade e baú dele');
    await p.click('text=Continuar →'); await p.waitForTimeout(150);
    ok(await p.isVisible('text=Montar eu mesmo no mapa'), 'com um veículo, dá para montar no mapa');
    await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
    ok(reqs.length === 2, 'a carga não coube pelo formato: o motor foi chamado de novo (' + reqs.length + ' chamadas)');
    ok(reqs[0] && reqs[0].analise === false && reqs[0].time_limit_s === 30 && reqs[1] && reqs[1].time_limit_s === 15, 'sem texto da IA (analise:false); a segunda conta é mais curta');
    ok(reqs[0] && reqs[0].veiculos.length === 1 && !reqs[0].veiculos[0].custoFixo && reqs[0].veiculos[0].compCm === 420, 'um veículo: sem custo de uso, com o comprimento do baú: ' + J(reqs[0] && reqs[0].veiculos[0]));
    ok(reqs[1] && reqs[1].veiculos[0].capM3 === 0.5 && reqs[0].veiculos[0].capM3 === 15.36, 'na segunda conta o volume do VUC cai para o que coube (0,5 m³): ' + (reqs[1] && reqs[1].veiculos[0].capM3));
    const res = await p.textContent('#rot-step-results');
    ok(/Pelo formato das caixas, a primeira divisão não cabia no baú\. O sistema refez a conta: NF F3 ficou para a próxima viagem\./.test(res), 'mostra o que mudou: ' + (res.match(/Pelo formato[^]*?viagem\./) || [''])[0]);
    ok(/Esta viagem levou 2 de 3/.test(res), 'a viagem sai com 2 de 3 pedidos');
    ok(!/não cabe(m)? no baú \(parada/.test(res), 'depois de refazer, a rota não tem mais caixa que não cabe');
    await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1200);
    const rc = Object.values((await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas)) || {});
    ok(rc.length === 1 && rc[0].veiculo === 'VUC' && rc[0].cap_kg === 3000 && rc[0].cap_m3 === 15.36 && rc[0].bau && rc[0].bau.a === 2.1 && rc[0].paradas.length === 2,
      'rota confirmada com o volume da viagem (não o reduzido) e o baú: ' + J(rc.map((r) => ({ v: r.veiculo, kg: r.cap_kg, m3: r.cap_m3, n: r.paradas.length }))));
    ok(!dialogs.length, 'nada a confirmar: a rota cabe ' + J(dialogs));
    ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 2)));
    await ctx.close();
  }

  // ── vários veículos: VUC e Toco ───────────────────────────────────────────
  reqs.length = 0;
  const seed2 = seedEmpresa({
    config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
    pedidos_rota: { ...PEDIDOS, L1: { nf: 'L1', tipo: 'entrega', peso: 41, itens: 1, dest: 'Barras', maiorCm: 800, obsNota: 'BARRAS DE 8 METROS', ...g(-23.48) } },
  });
  {
    const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed2, rotas);
    const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
    ok(await p.isVisible('#btn-frota-d'), 'a escolha do veículo tem "Vários veículos de uma vez"');
    await p.click('#btn-frota-d'); await p.waitForTimeout(200);
    ok(await p.isVisible('#cap-frota-d') && !(await p.isVisible('#cap-kg-d')) && !(await p.isVisible('#cap-m3-d')), 'vários veículos: mostra a frota e esconde a capacidade de um veículo só');
    ok((await p.inputValue('#cap-maxped-d')) === '8' && /por veículo/.test(await p.textContent('#cap-maxped-lbl')), 'máximo de paradas é por veículo');
    ok((await p.textContent('#fm-n-fiorino')) === '1' && (await p.textContent('#fm-n-vuc')) === '1', 'sem veículo cadastrado, começa com um Fiorino e um VUC');
    await p.click('button[aria-label="Um Fiorino a menos"]');
    await p.click('button[aria-label="Um Truck Toco a mais"]');
    ok((await p.textContent('#fm-n-fiorino')) === '0' && (await p.textContent('#fm-n-toco')) === '1', 'os botões − e + mudam a quantidade');
    ok(/2 veículos escolhidos, que juntos levam até 11\.000 kg/.test(await p.textContent('#fm-resumo')), 'resumo da frota: ' + await p.textContent('#fm-resumo'));
    ok(/Cada veículo usa até/.test(await p.textContent('#cap-m3-nota')), 'o aproveitamento vale para cada baú');
    await p.click('text=Continuar →'); await p.waitForTimeout(150);
    const conf = await p.textContent('#confirm-details-d');
    ok(/VUC · 3\.000 kg · 15,36 m³/.test(conf) && /Truck Toco · 8\.000 kg/.test(conf) && /usa só os que precisar/.test(conf), 'a confirmação lista os veículos: ' + conf.slice(0, 160));
    ok(!(await p.isVisible('text=Montar eu mesmo no mapa')), 'com vários veículos, a montagem no mapa (de um veículo só) some');
    await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
    const v0 = reqs[0] && reqs[0].veiculos;
    ok(v0 && v0.length === 2 && v0[0].id === 'vuc_1' && v0[1].id === 'toco_1' && v0[0].custoFixo < v0[1].custoFixo && v0[0].compCm === 420 && v0[1].compCm === 690,
      'o motor recebe os dois veículos, o maior com custo de uso maior e o comprimento de cada baú: ' + J(v0));
    ok(reqs[0] && !reqs[0].pedidos.some((x) => x.nf === 'L1') && reqs[0].pedidos.find((x) => x.nf === 'F3').maiorCm === 220, 'barra de 8 m fica de fora (maior que todos os baús); o maior lado vai em cada pedido');
    ok(reqs.length === 2 && reqs[1].veiculos[0].capM3 === 0.5 && reqs[1].veiculos[1].capM3 === reqs[0].veiculos[1].capM3, 'refez a divisão só reduzindo o VUC: ' + J(reqs.map((r) => r.veiculos.map((v) => v.capM3))));
    const res = await p.textContent('#rot-step-results');
    ok(/Pelo formato das caixas, a primeira divisão não cabia nos baús\. O sistema refez a conta: NF F3 mudou de veículo: VUC → Truck Toco\./.test(res), 'F3 passou para o Toco: ' + (res.match(/Pelo formato[^]*?\.\s/) || [''])[0]);
    ok(/(é maior|são maiores) que o maior baú escolhido \(6,9 m, medida típica\): NF L1/.test(res), 'avisa a barra maior que todos os baús: ' + (res.match(/fora porque[^.]*/) || [''])[0]);
    const tabs = await p.$$eval('.rota-tab-d', (t) => t.map((x) => x.textContent));
    ok(tabs.length === 2 && /Rota 1 · VUC · 2 paradas/.test(tabs[0]) && /Rota 2 · Truck Toco · 1 parada$/.test(tabs[1]), 'cada rota mostra o veículo: ' + J(tabs));
    const kp = (await p.textContent('#rot-step-results .kpis')).replace(/\s+/g, ' ');
    ok(/VEÍCULOS ?2 ?de 2 escolhidos/.test(kp), 'resumo conta os veículos usados: ' + kp.slice(0, 60));
    ok(!/não cabe(m)? no baú \(parada/.test(res), 'nenhuma rota fica com caixa que não cabe');
    // o detalhe de cada rota usa o veículo dela
    await p.click('.rota-tab-d >> nth=1'); await p.waitForTimeout(200);
    const det = await p.textContent('#rota-detail-d');
    ok(/Truck Toco/.test(det) && /\/ 8\.000 kg/.test(det), 'a carga da Rota 2 é contra o Toco (8.000 kg): ' + (det.match(/Peso[^%]*%/) || [''])[0]);
    await p.click('#rota-detail-d >> text=Plano de carga'); await p.waitForTimeout(500);
    ok(/^Truck Toco ·/.test(await p.textContent('.plano-cab')) && await p.isVisible('#c3d-cv'), 'o plano de carga é do Toco, em 3D');
    await p.click('#modal-plano .modal-close'); await p.waitForTimeout(150);
    await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1200);
    const rc = Object.values((await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas)) || {}).sort((a, b) => a.id.localeCompare(b.id));
    ok(rc.length === 2 && rc[0].veiculo === 'VUC' && rc[0].cap_kg === 3000 && rc[1].veiculo === 'Truck Toco' && rc[1].cap_kg === 8000 && rc[1].bau && rc[1].bau.c === 6.9 && rc[1].paradas[0].nf === 'F3',
      'cada rota confirmada guarda o próprio veículo: ' + J(rc.map((r) => ({ v: r.veiculo, kg: r.cap_kg, m3: r.cap_m3, nfs: r.paradas.map((x) => x.nf) }))));
    ok(!dialogs.length, 'nada a confirmar ' + J(dialogs));
    ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 2)));
    await ctx.close();
  }

  // ── veículos cadastrados: entram marcados, com motorista, placa e baú real ─
  reqs.length = 0;
  const seed3 = seedEmpresa({
    config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
    pedidos_rota: { ...PEDIDOS, L1: { nf: 'L1', tipo: 'entrega', peso: 41, itens: 1, dest: 'Barras', maiorCm: 800, ...g(-23.48) } },
    motoristas: {
      mA: { id: 'mA', nome: 'Motorista A', veiculo_id: 'vuc', veiculo_nome: 'VUC', modelo: 'Delivery 9.170', placa: 'TST1A11', cap_kg: 3500, bau_c: 4.3, bau_l: 2.1, bau_a: 2.15 },
      mB: { id: 'mB', nome: 'Motorista B', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', modelo: 'Atego 1719', placa: 'TST2B22', cap_kg: 8000, carroceria: 'aberta' },
    },
  });
  {
    const { ctx, p, errs } = await open(b, 'index.html', 390, 844, init, true, seed3, rotas);
    p.on('dialog', (d) => d.accept());
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
    await p.tap('#btn-frota-d'); await p.waitForTimeout(200);
    const marc = await p.$$eval('#cap-frota-d input[type=checkbox]', (c) => c.map((x) => x.checked));
    ok(marc.length === 2 && marc.every(Boolean) && (await p.textContent('#fm-n-vuc')) === '0', 'com frota cadastrada, começa com os veículos cadastrados marcados');
    const lista = await p.textContent('#cap-frota-d');
    ok(/Delivery 9\.170 · TST1A11/.test(lista) && /Motorista A/.test(lista) && /carroceria aberta/.test(lista), 'lista mostra modelo, placa, motorista e carroceria');
    const larg = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(larg <= 390, 'no celular nada passa da tela (' + larg + ' px)');
    await p.screenshot({ path: 'frota-mista-390.png', fullPage: false });
    await p.tap('text=Continuar →'); await p.waitForTimeout(150);
    await p.tap('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
    const v0 = reqs[0] && reqs[0].veiculos;
    ok(v0 && v0[0].id === 'm_mA' && v0[0].capKg === 3500 && v0[0].compCm === 430 && v0[1].id === 'm_mB' && !v0[1].capM3 && !v0[1].compCm,
      'cadastrados vão com a capacidade e o baú reais; aberta sem limite de volume nem comprimento: ' + J(v0));
    ok(reqs[0] && reqs[0].pedidos.some((x) => x.nf === 'L1'), 'com uma carroceria aberta na frota, a barra de 8 m entra na conta');
    const tabs = await p.$$eval('.rota-tab-d', (t) => t.map((x) => x.textContent));
    ok(tabs.some((t) => /Delivery 9\.170 · TST1A11 · Motorista A/.test(t)), 'a aba mostra veículo e motorista: ' + J(tabs));
    await p.screenshot({ path: 'frota-mista-res-390.png', fullPage: false });
    await p.tap('#btn-confirmar-rota'); await p.waitForTimeout(1200);
    const rc = Object.values((await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas)) || {});
    const a = rc.find((r) => r.placa === 'TST1A11'), bb = rc.find((r) => r.placa === 'TST2B22');
    ok(a && a.motorista === 'Motorista A' && a.cap_kg === 3500 && a.bau && a.bau.c === 4.3 && bb && bb.motorista === 'Motorista B' && bb.carroceria === 'aberta' && !bb.bau,
      'cada rota confirmada sai com o motorista, a placa e o baú do próprio veículo: ' + J(rc.map((r) => ({ v: r.veiculo, p: r.placa, m: r.motorista, c: r.carroceria }))));
    ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 2)));
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
