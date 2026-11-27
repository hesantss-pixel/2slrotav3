// Custo de cada veículo do cadastro: combustível conforme o tipo (o leve pode ser gasolina, etanol
// ou diesel; caminhão só diesel), consumo da placa (em branco, a estimativa do tipo; etanol rende 70%)
// e agregado (valor por saída e por km, sem combustível nem salário). O custo da rota usa o veículo
// dela, a rota confirmada guarda, e o relatório soma por placa com o km realizado.
// Placas TST e lojas inventadas; nada de cliente real.
const { chromium } = require('playwright');
const fs = require('fs');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const hoje = new Date().toISOString().slice(0, 10);
const g = (lat) => ({ cidade: 'Guarulhos', uf: 'SP', status: 'pendente', geoStatus: 'ok', lat, lng: -46.52, tipo: 'entrega', itens: 1 });
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    P1: { id: 'P1', nf: '801', dest: 'Loja Leve', peso: 500, ...g(-23.45) },
    P2: { id: 'P2', nf: '802', dest: 'Loja Média', peso: 2000, ...g(-23.46) },
    P3: { id: 'P3', nf: '803', dest: 'Loja Grande', peso: 2500, ...g(-23.47) },
  },
  motoristas: {
    mF: { id: 'mF', nome: 'Motorista F', veiculo_id: 'fiorino', veiculo_nome: 'Fiorino', placa: 'TST3C33', cap_kg: 650, comb: 'etanol' },
    mV: { id: 'mV', nome: 'Motorista V', veiculo_id: 'vuc', veiculo_nome: 'VUC', modelo: 'Delivery', placa: 'TST4D44', cap_kg: 3000, cons: 8 },
    mT: { id: 'mT', nome: 'Motorista T', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', placa: 'TST5E55', cap_kg: 8000, vinculo: 'agregado', ag_saida: 350, ag_km: 1.2 },
  },
  // viagem antiga do VUC, com o km pelo GPS
  rotas_confirmadas: { OLD: { id: 'OLD', data: hoje, veiculo: 'Delivery · TST4D44', placa: 'TST4D44', veiculo_tipo: 'vuc', motorista: 'Motorista V', km: 10, tempo_min: 60,
    custo: { total: 50, km: 9, hora: 41, diaria: 0 }, km_gps: { km_total: 12, cobertura: 0.9 }, num_paradas: 1, status: 'concluida',
    paradas: [{ id: 'X', nf: '1', dest: 'Loja Média', peso: 50, tipo: 'entrega' }] } },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const sem = (t) => t.replace(/\s/g, ' ');
const c2 = (x) => Math.round(x * 100) / 100;

// motor simulado: cada pedido no primeiro veículo (na ordem enviada) com espaço; 10 km e 60 min por viagem
function motor(body) {
  const vs = body.veiculos.map((v) => ({ ...v, kg: 0, ps: [] }));
  for (const p of body.pedidos) { const v = vs.find((x) => x.kg + (+p.peso || 0) <= x.capKg); if (v) { v.kg += +p.peso || 0; v.ps.push(p); } }
  return { routes: vs.filter((v) => v.ps.length).map((v) => ({ veiculo: v.nome, veiculo_id: v.id, pedidos: v.ps, km: 10, mins: 60 })),
    nao_alocados: [], fonte_distancia: 'OSRM', maior_que_bau: [] };
}

let ultimo = null;
(async () => {
  const b = await chromium.launch();
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/solve/, (r) => { const body = JSON.parse(r.request().postData()); ultimo = body; r.fulfill({ contentType: 'application/json', body: J(motor(body)) }); });
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  const db = () => p.evaluate(() => window.__FAKE.db.empresas.emp1);
  const card = (id) => p.textContent(`.rc-card.frota[data-mot="${id}"]`).then(sem);

  // ── cadastro: o resumo do custo em cada veículo ───────────────────────────
  await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(300);
  ok(/Próprio · etanol · 7,0 km\/l \(estimado\) · R\$ 0,59\/km/.test(await card('mF')), 'Fiorino a etanol sem consumo: 70% dos 10 km/l da gasolina, R$ 4,15 ÷ 7 = R$ 0,59/km: ' + (await card('mF')).slice(-60));
  ok(/Próprio · diesel · 8,0 km\/l · R\$ 0,91\/km/.test(await card('mV')), 'VUC com o consumo da placa (8 km/l): ' + (await card('mV')).slice(-50));
  ok(/Agregado · R\$ 350,00 por saída \+ R\$ 1,20\/km/.test(await card('mT')), 'agregado mostra o valor combinado');

  // ── formulário: combustível conforme o tipo ───────────────────────────────
  await p.click('text=+ Adicionar veículo'); await p.waitForTimeout(200);
  await p.click('#mot-veh-grid .veh-card >> nth=0'); await p.waitForTimeout(100);   // Fiorino
  let ops = await p.$$eval('#mot-comb option', (o) => o.map((x) => x.value));
  ok(J(ops) === J(['gasolina', 'etanol', 'diesel']) && !(await p.isDisabled('#mot-comb')) && (await p.inputValue('#mot-comb')) === 'gasolina',
    'utilitário leve: gasolina (padrão), etanol ou diesel: ' + J(ops));
  ok((await p.getAttribute('#mot-cons', 'placeholder')) === '10,0' && /Em branco, a conta usa 10,0 km\/l/.test(await p.textContent('#mot-cons-nota')), 'consumo em branco: mostra a estimativa do tipo');
  await p.selectOption('#mot-comb', 'etanol'); await p.waitForTimeout(80);
  ok(/7,0 km\/l, a estimativa para Fiorino com etanol/.test(await p.textContent('#mot-cons-nota')) && (await p.getAttribute('#mot-cons', 'placeholder')) === '7,0', 'etanol: a estimativa cai para 70%');
  await p.click('#mot-veh-grid .veh-card >> nth=1'); await p.waitForTimeout(100);   // VUC
  ops = await p.$$eval('#mot-comb option', (o) => o.map((x) => x.value));
  ok(J(ops) === J(['diesel']) && await p.isDisabled('#mot-comb'), 'VUC: só diesel (não oferece etanol para caminhão)');
  await p.selectOption('#mot-vinc', 'agregado'); await p.waitForTimeout(80);
  ok(await p.isVisible('#mot-agreg-box') && !(await p.isVisible('#mot-proprio-box')), 'agregado: troca combustível e consumo pelo valor combinado');
  await p.fill('#mot-placa', 'TST7G77');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(200);
  ok(/Agregado: informe o valor por saída, o valor por km ou os dois/.test(dialogs.pop() || ''), 'agregado sem valor não salva');
  await p.fill('#mot-ag-saida', '280,00');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(300);
  let novo = Object.values((await db()).motoristas).find((m) => m.placa === 'TST7G77');
  ok(novo && novo.vinculo === 'agregado' && novo.ag_saida === 280 && novo.ag_km === undefined && novo.comb === undefined && novo.cons === undefined,
    'agregado salvo com o valor por saída, sem combustível: ' + J(novo));
  await p.click(`.rc-card.frota[data-mot="${novo.id}"] >> text=Excluir`); await p.waitForTimeout(300);   // tira da frota do teste

  // editar: o combustível salvo volta marcado; consumo inválido não salva
  await p.click('.rc-card.frota[data-mot="mF"] >> text=Editar'); await p.waitForTimeout(200);
  ok((await p.inputValue('#mot-comb')) === 'etanol' && (await p.inputValue('#mot-vinc')) === 'proprio', 'ao editar, o combustível salvo (etanol) volta marcado');
  await p.fill('#mot-cons', 'abc');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(200);
  ok(/Consumo: em km por litro/.test(dialogs.pop() || ''), 'consumo que não é número não salva');
  await p.fill('#mot-cons', '7,5');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(300);
  const mF = (await db()).motoristas.mF;
  ok(mF.comb === 'etanol' && mF.cons === 7.5 && mF.placa === 'TST3C33', 'consumo da placa salvo: ' + J(mF));
  ok(/etanol · 7,5 km\/l · R\$ 0,55\/km/.test(await card('mF')), 'o cartão mostra o consumo real (sem "estimado")');

  // ── rotas: cada viagem com o custo do veículo dela ────────────────────────
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
  await p.click('#btn-frota-d'); await p.waitForTimeout(200);
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  ok(/preferência aos próprios, e depois aos menores; o agregado entra quando os próprios não dão conta/.test(sem(await p.textContent('#confirm-details-d'))), 'a confirmação diz que o agregado só entra quando os próprios não dão conta');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1500);
  const cf = Object.fromEntries(ultimo.veiculos.map((v) => [v.id, v.custoFixo]));
  ok(cf.m_mT >= 20000 + cf.m_mV && cf.m_mV < 10000 && cf.m_mF < 10000, 'no motor, o agregado custa bem mais para entrar que os próprios: ' + J(cf));
  const rh = (sal) => sal * 1.7 / 220;
  const cF = c2(10 * 4.15 / 7.5 + rh(2660.40)), cV = c2(10 * 7.30 / 8 + rh(2956.92)), cT = c2(350 + 10 * 1.2);
  const res = sem(await p.textContent('#rot-step-results'));
  const tabs = await p.$$eval('.rota-tab-d', (t) => t.map((x) => x.textContent));
  ok(tabs.length === 3, 'três viagens, uma por veículo: ' + J(tabs));
  ok(res.includes('CUSTO ESTIMADO') && res.includes(brl(c2(cF + cV + cT))), `custo total = Fiorino ${brl(cF)} + VUC ${brl(cV)} + agregado ${brl(cT)} = ${brl(c2(cF + cV + cT))}`);
  ok(/Veículos próprios: combustível, mão de obra/.test(res) && /Agregado: o valor combinado no cadastro/.test(res), 'a nota separa próprio e agregado: ' + (res.match(/Veículos próprios[^]*?saída e por km\)\./) || [''])[0]);
  const det = async (i) => { await p.click(`.rota-tab-d >> nth=${i}`); await p.waitForTimeout(150); return sem(await p.textContent('#rota-detail-d')); };
  let d0 = await det(0);
  ok(d0.includes('💰 ' + brl(cF)) && /por parada · etanol/.test(d0), 'viagem do Fiorino: custo com etanol a 7,5 km/l: ' + (d0.match(/💰[^🛣]*/) || [''])[0].slice(0, 60));
  const dica = await p.getAttribute('#rota-detail-d span[title*="mão de obra"]', 'title');
  ok(/etanol a 7,5 km\/l/.test(dica || ''), 'a dica do custo diz o combustível e o consumo: ' + dica);
  const d2 = await det(2);
  ok(d2.includes('💰 ' + brl(cT)) && /· agregado/.test(d2), 'viagem do agregado: R$ 350 + 10 km × R$ 1,20');
  ok(sem(await det(1)).includes('💰 ' + brl(cV)), 'viagem do VUC com o consumo da placa');

  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1200);
  const rc = Object.values((await db()).rotas_confirmadas).filter((r) => r.id !== 'OLD');
  const rT = rc.find((r) => r.placa === 'TST5E55'), rF = rc.find((r) => r.placa === 'TST3C33');
  ok(rT && rT.custo.total === cT && rT.custo.agregado === true && rF && rF.custo.total === cF && rF.custo.comb === 'etanol',
    'rota confirmada guarda o custo do veículo (agregado marcado, combustível do próprio): ' + J(rc.map((r) => ({ p: r.placa, c: r.custo }))));

  // ── relatório: custo por veículo, com o km realizado ─────────────────────
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  const linhas = await p.$$eval('#rel-corpo table', (ts) => {
    const t = ts.find((x) => /Km realizado/.test(x.textContent));
    return t ? [...t.querySelectorAll('tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')) : [];
  });
  const lV = linhas.find((l) => /TST-?4D44/.test(l)) || '', lT = linhas.find((l) => /TST5E55/.test(l)) || '';
  ok(linhas.length === 3, 'tabela por veículo com as três placas: ' + J(linhas));
  ok(lV.startsWith('Delivery · TST4D44 | 2 | 20 | 12 (1 de 2 viagens) | ' + brl(c2(50 + cV))), 'VUC: 2 viagens, 20 km planejados, 12 km pelo GPS em 1 delas, custo somado, placa uma vez só: ' + lV);
  ok(/\(agregado\)/.test(lT) && lT.includes(brl(cT)), 'agregado marcado na tabela: ' + lT);
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rel-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/Custo por veículo;Placa;Vínculo;Viagens;Km planejado;Km realizado \(painel ou GPS\)/.test(csv) && /;TST5E55;agregado;1;10,0;;0;362,00/.test(csv) && /;TST4D44;próprio;2;20,0;12,0;1;81,97/.test(csv),
    'planilha com o custo por veículo: ' + (csv.match(/Custo por veículo[^]*?\r\n\r\n/) || [''])[0].replace(/\r\n/g, ' | ').slice(0, 300));

  // ── preço do etanol na janela de custos ───────────────────────────────────
  await p.click('#rel-custos'); await p.waitForTimeout(300);
  ok((await p.inputValue('#cus-etanol')) === '4,15' && /etanol hidratado R\$ 4,15\/l/.test(await p.textContent('#modal-custos')), 'a janela tem o etanol (R$ 4,15, ANP) e a fonte');
  await p.fill('#cus-etanol', '0');
  await p.click('#modal-custos >> text=Salvar custos'); await p.waitForTimeout(200);
  ok(/Etanol: informe o preço do litro/.test(await p.textContent('#cus-erro')), 'preço zero não salva');
  await p.fill('#cus-etanol', '4,50');
  await p.click('#modal-custos >> text=Salvar custos'); await p.waitForTimeout(400);
  const cfg = (await db()).config.custos;
  ok(cfg && cfg.etanol === 4.5 && cfg.gasolina === 6.47, 'etanol salvo para a empresa: ' + J(cfg && { e: cfg.etanol, g: cfg.gasolina }));

  // ── celular: o formulário cabe ────────────────────────────────────────────
  await p.setViewportSize({ width: 375, height: 760 });
  await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(300);
  await p.click('.rc-card.frota[data-mot="mT"] >> text=Editar'); await p.waitForTimeout(300);
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 375 && await p.isVisible('#mot-ag-saida') && (await p.inputValue('#mot-ag-saida')) === '350,00' && (await p.inputValue('#mot-ag-km')) === '1,20',
    'no celular o formulário cabe e o agregado volta com os valores (' + larg + ' px)');
  await p.$eval('#mot-vinc', (e) => e.scrollIntoView({ block: 'start' }));
  await p.screenshot({ path: 'custo-veiculo-375.png' });
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
