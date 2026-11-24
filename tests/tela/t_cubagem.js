// Cubagem: baú do veículo (m³), m³ dos pedidos (digitado, planilha, nota, produtos, estimado),
// volume na roteirização, plano de carga e cadastro das medidas dos produtos.
// Tudo aqui é inventado (placas TST, CNPJ 11222333000100 da nota de teste); nada de cliente real.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const CH = '35261111222333000100550010009200011000000027';   // CNPJ 11222333000100 (fictício)

const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    // m³ digitado
    '9101': { nf: '9101', tipo: 'entrega', cidade: 'Guarulhos', peso: 300, itens: 4, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Cliente A', m3: 6, m3Fonte: 'digitado', geoStatus: 'ok' },
    // m³ escrito na nota
    '9102': { nf: '9102', tipo: 'entrega', cidade: 'Guarulhos', peso: 450, itens: 2, status: 'pendente', lat: -23.46, lng: -46.52, dest: 'Cliente B', m3: 5.5, m3Fonte: 'nota', geoStatus: 'ok' },
    // produtos do XML, sem medida ainda (2 CX do P1 e 3 UN do P2)
    [CH]: { nf: '920001', chave: CH, tipo: 'entrega', cidade: 'Guarulhos', peso: 120, itens: 5, status: 'pendente', lat: -23.47, lng: -46.51, dest: 'Mercado Exemplo',
      remetente: 'Fábrica Teste', geoStatus: 'ok', produtos: [{ d: 'Caixa organizadora 40L', q: 2, u: 'CX', c: 'P1' }, { d: 'Banqueta dobrável', q: 3, u: 'UN', c: 'P2' }] },
    // sem medida nenhuma
    '9104': { nf: '9104', tipo: 'entrega', cidade: 'Guarulhos', peso: 600, itens: 1, status: 'pendente', lat: -23.48, lng: -46.50, dest: 'Cliente D', geoStatus: 'ok' },
    // coleta com m³
    'C_9105': { nf: '9105', tipo: 'coleta', cidade: 'Guarulhos', peso: 200, itens: 3, status: 'pendente', lat: -23.44, lng: -46.49, dest: 'Fornecedor E', m3: 3, m3Fonte: 'planilha', geoStatus: 'ok',
      coletaObs: true, endRemetente: 'RUA DO FORNECEDOR 10, CENTRO, GUARULHOS/SP, 07010-000', endereco: 'R. DO PORTO, 45' },
  },
  motoristas: {
    mot_bau: { id: 'mot_bau', nome: 'Motorista Teste', veiculo_id: 'tres4', veiculo_nome: 'Caminhão 3/4', cap_kg: 5000, modelo: 'Accelo 815', placa: 'TST1A11', bau_c: 4.5, bau_l: 2.3, bau_a: 2.5 },
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const emp = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1);

(async () => {
  const b = await chromium.launch();
  let solveReq = null;
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, async (c) => {
    await c.route(/viacep\.com\.br\/ws\/09910000/, (r) => r.fulfill({ contentType: 'application/json', body: J({ cep: '09910-000', logradouro: 'Rua do Porto', bairro: 'Centro', localidade: 'Diadema', uf: 'SP' }) }));
    await c.route(/railway\.app\/solve/, async (r) => {
      solveReq = JSON.parse(r.request().postData());
      const ent = solveReq.pedidos.filter((x) => x.tipo !== 'coleta'), col = solveReq.pedidos.filter((x) => x.tipo === 'coleta');
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: '3/4', veiculo_id: 'tres4', pedidos: ent.concat(col), km: 22, mins: 80 }],
        nao_alocados: [], fonte_distancia: 'OSRM', regra_carga: 'entregas_antes_das_coletas' }) });
    });
  });
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  // ── leitura do m³ no texto da nota: igual ao servidor (backend/tests/test_entrada.py) ──
  const casos = await p.evaluate(() => [
    'Cubagem: 1,250 m3', 'CUBAGEM TOTAL 0,85 M3', 'M3: 2,5', 'Volume (m³): 3', 'metros cúbicos = 12', 'Cubagem: 1.250',
    'Parafuso M3X10', 'Pedido 4471', 'Cubagem: 0'].map((t) => window.__m3DoTexto(t))
    .concat([window.__m3DoTexto('Carga com 4,2 m3 no total'), window.__m3DoTexto('Carga com 4,2 m3 no total', true)]));
  ok(J(casos) === J([1.25, 0.85, 2.5, 3, 12, 0, 0, 0, 0, 0, 4.2]), 'm³ escrito na nota: mesma leitura do servidor ' + J(casos));

  // ── medidas escritas à mão nas observações (formatos de ordens de coleta reais, sem os dados) ──
  const medCasos = JSON.parse(require('fs').readFileSync(__dirname + '/xml/medidas-casos.json', 'utf8'));
  const medRes = await p.evaluate((cs) => cs.map(([t]) => { const r = window.__medidasDoTexto(t); return r ? (r.cm || r.maiorCm) : null; }), medCasos);
  const medErr = medCasos.filter(([t, e], i) => J(medRes[i]) !== J(e)).map(([t], i) => t);
  ok(!medErr.length, `medidas de um volume nas observações: ${medCasos.length - medErr.length} de ${medCasos.length} formatos, igual ao servidor ` + J(medErr));
  const oc = JSON.parse(require('fs').readFileSync(__dirname + '/pdf/ordem-coleta-exemplo.json', 'utf8'))[0];
  const ocP = await p.evaluate((it) => { const l = window.__danfe.linhas(it); return window.__danfe.pedido(window.__danfe.ordem(l), 'coleta'); }, oc);
  ok(ocP.m3 === 1.5 && ocP.m3Fonte === 'medidas' && ocP.medidas === '50 × 50 × 50 cm' && ocP.maiorCm === 50 && ocP.itens === 12,
    'ordem de coleta: "MED 50X50X50 CM" × 12 volumes = 1,5 m³ ' + J([ocP.m3, ocP.m3Fonte, ocP.medidas, ocP.itens]));
  ok(ocP.obsNota === 'MED 50X50X50 CM', 'as observações da ordem ficam no pedido: ' + J(ocP.obsNota));

  // ── endereço de coleta escrito nas observações (formatos reais, endereços inventados) ──
  const colCasos = [
    ['COLETAR>R. DO PORTO, 112>COTIA > 06713-140 NFS MED < 10*15*330 METROS < PECA', { endereco: 'R. DO PORTO, 112', cep: '06713140', cidade: 'COTIA', uf: '' }],
    ['RUA DAS PALMEIRAS, N°65 09623-000 ABC 60 CM . 30 CM . 5M 20CM/TUBOS', { endereco: 'RUA DAS PALMEIRAS, 65', cep: '09623000', cidade: '', uf: '' }],
    ['ENDEREÇO DE COLETA: ROD. DOS EXEMPLOS, 22 - - SP, 09823-000 ( 60 X 90 X 60/PEDIDO 1', { endereco: 'ROD. DOS EXEMPLOS, 22', cep: '09823000', cidade: '', uf: 'SP' }],
    ['COLETAR>R. JOSE DA SILVA, 158> CEP 09961-720 30X40X60/FERRAGENS', { endereco: 'R. JOSE DA SILVA, 158', cep: '09961720', cidade: '', uf: '' }],
    ['MED 50X50X50 CM', null], ['SEXTA ATE AS 16H', null], ['ENTREGAR NA RUA DO CLIENTE, 10 CEP 01001-000', null],
    ['PALETE PADRAO 1 POR 1,20 > URGENTE <', null],
  ];
  const colRes = await p.evaluate((cs) => cs.map(([t]) => window.__coletaDasObs(t)), colCasos);
  const colErr = colCasos.filter(([t, e], i) => J(colRes[i]) !== J(e)).map(([t], i) => [t, colRes[colCasos.findIndex((c) => c[0] === t)]]);
  ok(!colErr.length, `endereço de coleta nas observações: ${colCasos.length - colErr.length} de ${colCasos.length} casos ` + J(colErr));
  const ocOutro = oc.map((it) => (it.s === 'MED 50X50X50 CM' ? { ...it, s: 'COLETAR>R. DO PORTO, 45>DIADEMA > 09910-000 MED 50X50X50 CM' } : it));
  const ocO = await p.evaluate((it) => { const l = window.__danfe.linhas(it); return window.__danfe.pedido(window.__danfe.ordem(l), 'coleta'); }, ocOutro);
  ok(ocO.coletaObs && ocO.endereco === 'R. DO PORTO, 45' && ocO.cep === '09910000' && ocO.cidade === 'Diadema' && ocO.bairro === '',
    'ordem com "COLETAR>" vai para o endereço das observações: ' + J([ocO.endereco, ocO.cep, ocO.cidade]));
  ok(ocO.endRemetente === 'RUA DAS FLORES 120, CENTRO, GUARULHOS/SP, 07010-000' && ocO.dest === 'TRANSPORTES EXEMPLO ALFA LTDA' && ocO.id === ocP.id,
    'o endereço do remetente fica guardado, o nome e a chave do pedido não mudam: ' + J([ocO.endRemetente, ocO.dest]));
  ok(ocO.obsNota === 'COLETAR R. DO PORTO, 45 DIADEMA 09910-000 MED 50X50X50 CM', 'observação fica legível (sem os sinais < >): ' + J(ocO.obsNota));
  // sem a cidade escrita, a cidade sai do CEP já na importação
  const semCid = await p.evaluate((it) => { const l = window.__danfe.linhas(it); return window.__danfe.pedido(window.__danfe.ordem(l), 'coleta'); },
    oc.map((it) => (it.s === 'MED 50X50X50 CM' ? { ...it, s: 'COLETAR>R. DO PORTO, 45> CEP 09910-000' } : it)));
  ok(semCid.cidade === 'Sem cidade', 'sem a cidade escrita, o pedido sai do arquivo sem cidade');
  const comCid = await p.evaluate((o) => window.__cidadeDaColeta(o), semCid);
  ok(comCid.cidade === 'Diadema' && comCid.uf === 'SP', 'e a cidade vem do CEP (ViaCEP) antes de gravar: ' + J([comCid.cidade, comCid.uf]));

  // ── Frota: baú ───────────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(300);
  ok((await p.textContent('#motoristas-lista')).includes('5.000 kg · 25,88 m³'), 'cartão do veículo mostra o m³ do baú medido (4,5 × 2,3 × 2,5)');
  await p.click('text=+ Adicionar veículo'); await p.waitForTimeout(150);
  await p.click('#mot-veh-grid .veh-card >> nth=1');   // VUC
  ok(J([await p.inputValue('#mot-bau-c'), await p.inputValue('#mot-bau-l'), await p.inputValue('#mot-bau-a')]) === J(['4,2', '2,05', '2,1']), 'escolher o tipo preenche a medida típica do baú');
  ok(/18,08 m³ de baú\. Medida típica de VUC/.test(await p.textContent('#mot-bau-nota')), 'avisa que é medida típica e mostra o m³: ' + await p.textContent('#mot-bau-nota'));
  await p.click('#mot-veh-grid .veh-card >> nth=2');   // troca para 3/4: medida típica acompanha
  ok((await p.inputValue('#mot-bau-c')) === '4,1', 'trocar o tipo troca a medida típica (que ninguém editou)');
  await p.fill('#mot-modelo', 'Teste'); await p.fill('#mot-placa', 'TST2B22'); await p.fill('#mot-cap-kg', '6000');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
  let f = Object.values((await emp(p)).motoristas).find((m) => m.placa === 'TST2B22');
  ok(f && f.bau_c === undefined, 'medida típica não é gravada: o veículo segue a do tipo');
  ok((await p.textContent('#motoristas-lista')).includes('21,65 m³ (típico)'), 'cartão marca o m³ típico');
  await p.click(`.rc-card[data-mot="${f.id}"] >> text=Editar`); await p.waitForTimeout(150);
  await p.fill('#mot-bau-a', '2,6'); await p.fill('#mot-bau-c', 'x');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(200);
  ok(/Baú: preencha/.test(dialogs.pop() || ''), 'medida inválida não salva');
  await p.fill('#mot-bau-c', '4,1');
  await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
  f = Object.values((await emp(p)).motoristas).find((m) => m.placa === 'TST2B22');
  ok(f.bau_c === 4.1 && f.bau_l === 2.2 && f.bau_a === 2.6, 'medida própria é gravada: ' + J([f.bau_c, f.bau_l, f.bau_a]));

  // ── Produtos: medida pelo código do produto no fornecedor ─────────────────
  await p.click('.sb-item[data-page="produtos"]'); await p.waitForTimeout(300);
  const pend = await p.$$eval('#prod-pend .prod-item b', (e) => e.map((x) => x.textContent));
  ok(J(pend.sort()) === J(['Banqueta dobrável', 'Caixa organizadora 40L']), 'lista os produtos sem medida das notas pendentes: ' + J(pend));
  ok((await p.textContent('#prod-pend')).includes('Cód. P1 · 1 CX · Fábrica Teste · em 1 pedido'), 'mostra código, unidade, fornecedor e em quantos pedidos');
  const linha = (txt) => `#prod-pend .prod-item:has(b:text-is("${txt}"))`;
  await p.fill(linha('Caixa organizadora 40L') + ' input >> nth=0', '50');
  await p.fill(linha('Caixa organizadora 40L') + ' input >> nth=1', '40');
  await p.click(linha('Caixa organizadora 40L') + ' >> text=Salvar'); await p.waitForTimeout(200);
  ok(/Informe comprimento, largura e altura/.test(await p.textContent('#prod-msg')), 'sem as três medidas não salva');
  await p.fill(linha('Caixa organizadora 40L') + ' input >> nth=2', '30');
  await p.click(linha('Caixa organizadora 40L') + ' >> text=Salvar'); await p.waitForTimeout(300);
  let prods = (await emp(p)).produtos || {};
  let reg = Object.values(prods)[0];
  ok(reg && J(reg.cm) === J([50, 40, 30]) && reg.c === 'P1' && reg.f === '11222333000100' && reg.u === 'CX', 'medida gravada em empresas/emp1/produtos com fornecedor = CNPJ da chave: ' + J(reg));
  ok(/0,06 m³ cada\)\. Entra no m³ de 1 pedido pendente/.test(await p.textContent('#prod-msg')), 'confirma e diz quantos pedidos usam: ' + await p.textContent('#prod-msg'));
  ok((await p.$$eval('#prod-pend .prod-item', (e) => e.length)) === 1 && (await p.textContent('#prod-lista')).includes('Caixa organizadora 40L'), 'o produto sai da lista de pendentes e vai para os cadastrados');
  await p.fill(linha('Banqueta dobrável') + ' input >> nth=0', '45');
  await p.fill(linha('Banqueta dobrável') + ' input >> nth=1', '40');
  await p.fill(linha('Banqueta dobrável') + ' input >> nth=2', '10');
  await p.click(linha('Banqueta dobrável') + ' >> text=Salvar'); await p.waitForTimeout(300);
  // 2 × 0,06 + 3 × 0,018 = 0,174
  const m3xml = await p.evaluate((ch) => { const o = window.__pedidosDaViagem().find((x) => x.id === ch); return o && [o.m3, o.m3Fonte, o.m3Ok]; }, CH);
  ok(J(m3xml) === J([0.174, 'produtos', true]), 'pedido do XML soma quantidade × medida de cada produto: ' + J(m3xml));
  await p.screenshot({ path: 'cub-produtos-1280.png', fullPage: true });

  // ── Pedido: m³ digitado e pela calculadora ────────────────────────────────
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  await p.evaluate(() => window.abrirPedido('9104')); await p.waitForTimeout(300);
  ok((await p.inputValue('#ped-m3')) === '', 'pedido sem medida abre com o m³ vazio');
  await p.fill('#ped-itens', '4');
  await p.click('#ped-calc summary');
  await p.fill('#ped-cc', '120'); await p.fill('#ped-cl', '80'); await p.fill('#ped-ca', '100');
  await p.click('#ped-calc .btn-sm');
  ok((await p.inputValue('#ped-m3')) === '3,84' && /120 × 80 × 100 cm × 4 volumes = 3,84 m³/.test(await p.textContent('#ped-calc-nota')), 'calculadora: medidas da caixa × volumes');
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  let o = (await emp(p)).pedidos_rota['9104'];
  ok(o.m3 === 3.84 && o.m3Fonte === 'digitado' && o.maiorCm === 120, 'pedido grava m³, origem e o maior lado: ' + J([o.m3, o.m3Fonte, o.maiorCm]));
  await p.evaluate(() => window.abrirPedido('9102')); await p.waitForTimeout(300);
  ok((await p.inputValue('#ped-m3')) === '5,5' && (await p.textContent('#ped-m3-nota')).includes('escrito na nota'), 'm³ que veio da nota aparece com a origem');
  await p.fill('#ped-m3', '999'); await p.click('#ped-salvar'); await p.waitForTimeout(200);
  ok(/Cubagem em m³/.test(await p.textContent('#ped-msg')), 'm³ fora do razoável é recusado');
  await p.fill('#ped-m3', '5,5'); await p.click('#ped-salvar'); await p.waitForTimeout(400);
  await p.evaluate(() => window.abrirPedido('C_9105')); await p.waitForTimeout(300);
  ok((await p.isVisible('#ped-end-nota')) && /tirado das observações da ordem\. O do remetente é RUA DO FORNECEDOR 10/.test(await p.textContent('#ped-end-nota')),
    'pedido de coleta mostra que o endereço veio das observações e qual é o do remetente');
  await p.evaluate(() => window.fecharPedido && window.fecharPedido());
  await p.evaluate(() => window.abrirPedido('9101')); await p.waitForTimeout(200);
  ok(!(await p.isVisible('#ped-end-nota')), 'pedido comum não mostra esse aviso');
  await p.evaluate(() => window.fecharPedido && window.fecharPedido());
  ok((await emp(p)).pedidos_rota['9102'].m3Fonte === 'nota', 'salvar sem mudar o m³ mantém a origem (nota)');

  // ── Roteirização com o baú ─────────────────────────────────────────────────
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST1A11")'); await p.waitForTimeout(300);
  ok((await p.inputValue('#cap-m3-d')) === '25,88', 'veículo da frota traz o m³ do baú dele');
  ok((await p.inputValue('#cap-aprov-d')) === '85', 'aproveitamento padrão: 85% do baú');
  ok(/usa até 21,99 m³ \(85% de 25,88 m³\)/.test(await p.textContent('#cap-m3-nota')), 'explica quanto do baú a rota usa: ' + await p.textContent('#cap-m3-nota'));
  const cob = await p.textContent('#cap-cob-nota');
  ok(/5 de 5 pedidos|Todos os 5 pedidos/.test(cob), 'conta quantos pedidos da viagem têm m³: ' + cob);
  await p.screenshot({ path: 'cub-cap-1280.png', fullPage: true });
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok(/Volume: 21,99 m³ \(85% do baú de 25,88 m³\)/.test(await p.textContent('#confirm-details-d')), 'confirmação mostra o volume');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq && solveReq.veiculos[0].capM3 === 21.99 && solveReq.veiculos[0].capKg === 5000, 'o motor de rotas recebe o volume (capM3) além do peso');
  const pm = Object.fromEntries(solveReq.pedidos.map((x) => [x.nf, x.m3]));
  ok(pm['9101'] === 6 && pm['9102'] === 5.5 && pm['920001'] === 0.174 && pm['9104'] === 3.84 && pm['9105'] === 3, 'cada pedido vai com o m³ resolvido: ' + J(pm));
  if (process.env.FOTOS) await p.screenshot({ path: 'cub-result-1280.png', fullPage: true });
  const carga = await p.textContent('.carga-box');
  ok(/Volume.*15,51.*21,99 m³/.test(carga.replace(/\s+/g, ' ')), 'resultado mostra o volume a bordo contra o da viagem: ' + carga.replace(/\s+/g, ' '));
  await p.click('text=Plano de carga'); await p.waitForTimeout(300);
  const ordem = await p.$$eval('#plano-corpo table >> nth=0 >> tbody tr', (r) => r.map((x) => x.children[2].textContent));
  ok(J(ordem) === J(['NF 920001', 'NF 9104', 'NF 9102', 'NF 9101']), 'plano de carga: carrega da última entrega para a primeira: ' + J(ordem));
  ok((await p.$$eval('#plano-corpo svg rect', (r) => r.length)) >= 5, 'desenho do baú com uma parte por entrega');
  ok((await p.textContent('#plano-corpo')).includes('Coletas na volta'), 'coletas aparecem à parte, no espaço que as entregas liberam');
  await p.screenshot({ path: 'cub-plano-1280.png' });
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(150);

  // passar do volume vira aviso, como o peso
  await p.click('text=Confirmar saída do veículo'); await p.waitForTimeout(700);
  const rc = Object.values((await emp(p)).rotas_confirmadas || {})[0];
  ok(rc && rc.cap_m3 === 21.99 && rc.bau_m3 === 25.88 && Math.abs(rc.m3_total - 18.514) < 1e-6, 'rota confirmada guarda o volume da viagem e o m³ total: ' + J(rc && [rc.cap_m3, rc.bau_m3, rc.m3_total]));
  ok(rc && rc.paradas.find((x) => x.nf === '9101').m3 === 6, 'cada parada guarda o m³');
  await p.waitForTimeout(300);
  ok((await p.textContent('#rotas-confirmadas-lista')).includes('18,51 m³ de 21,99'), 'tela Rotas mostra o m³ da viagem');
  await p.click('#rotas-confirmadas-lista >> text=Plano de carga'); await p.waitForTimeout(250);
  ok((await p.$$eval('#plano-corpo table >> nth=0 >> tbody tr', (r) => r.length)) === 4 && (await p.textContent('#plano-corpo')).includes('TST1A11'), 'plano de carga também abre de uma rota já confirmada');
  await p.click('#modal-plano .btn-modal-sec');

  // ── Volume pequeno: aviso e estimativa pelo peso ────────────────────────────
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; Object.values(d).forEach((x) => { x.status = 'pendente'; x.rota_atual = ''; }); });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(200);
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(200);   // VUC, sem frota
  ok((await p.inputValue('#cap-m3-d')) === '18,08' && /Medida típica de VUC/.test(await p.textContent('#cap-m3-nota')), 'tipo sem cadastro usa a medida típica e avisa');
  await p.fill('#cap-kg-d', '3000');
  await p.fill('#cap-m3-d', '');
  ok(/limita só pelo peso/.test(await p.textContent('#cap-m3-nota')), 'sem volume, só o peso limita');
  await p.fill('#cap-m3-d', '10');
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota['9104']; delete d.m3; delete d.m3Fonte; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(200);
  await p.check('#cap-estimar-d'); await p.waitForTimeout(100);
  ok(await p.isVisible('#cap-dens-wrap'), 'ligar a estimativa mostra a densidade');
  await p.fill('#cap-dens-d', '200'); await p.waitForTimeout(100);
  solveReq = null;
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  // montar no mapa: o volume soma junto com o peso
  await p.click('#rot-step-confirm .btn-modal-alt'); await p.waitForTimeout(700);
  ok(await p.isVisible('#man-vol'), 'montar no mapa mostra o medidor de volume');
  await p.click('button:has-text("Colocar os que estão à vista")'); await p.waitForTimeout(400);
  const man = await p.evaluate(() => ({ m3: document.getElementById('man-m3').textContent, cls: document.getElementById('man-m3').className, aviso: document.getElementById('man-aviso').textContent }));
  // 14,67 m³ de entregas + 3 m³ da coleta, se ela vier antes de alguma entrega (como o peso)
  ok(/(14,67|17,67) \/ 8,5 m³/.test(man.m3) && /cheio/.test(man.cls) && /Passa do volume em (6,17|9,17) m³/.test(man.aviso), 'medidor de volume passa do limite e avisa: ' + J(man));
  await p.screenshot({ path: 'cub-manual-1280.png' });
  await p.click('#rot-step-manual .btn-modal-sec'); await p.waitForTimeout(300);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  const est = solveReq && solveReq.pedidos.find((x) => x.nf === '9104');
  ok(solveReq && solveReq.veiculos[0].capM3 === 8.5, 'volume digitado × 85%: ' + (solveReq && solveReq.veiculos[0].capM3));
  ok(est && (est.m3 === 3 || est.m3 === 3.84) && (est.m3Fonte === 'estimado' || est.m3Fonte === 'digitado'), 'pedido sem medida vai estimado pelo peso (600 kg ÷ 200 kg/m³): ' + J(est && [est.m3, est.m3Fonte]));
  const avisos = await p.textContent('#rota-detail-d');
  ok(/Passa do volume: chega a .* m³ a bordo, e a viagem usa até 8,5 m³/.test(avisos), 'rota acima do volume avisa, como o peso');
  await p.evaluate(() => { localStorage.removeItem('rotav3_cubagem'); });

  if (process.env.FOTOS) {   // telas de celular para conferir o visual
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('text=Ajustar') .catch(() => {});
    await p.evaluate(() => window.abrirPlanoCargaD(0)); await p.waitForTimeout(300);
    await p.screenshot({ path: 'cub-plano-390.png' });
    await p.evaluate(() => window.fecharPlanoCarga());
    await p.evaluate(() => window.irParaPagina('produtos')); await p.waitForTimeout(300);
    await p.screenshot({ path: 'cub-produtos-390.png', fullPage: true });
    await p.evaluate(() => window.abrirPedido('9101')); await p.waitForTimeout(300);
    await p.click('#ped-calc summary');
    await p.screenshot({ path: 'cub-pedido-390.png', fullPage: false });
  }
  ok(errs.length === 0, 'sem erros no console: ' + J(errs.slice(0, 3)));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exitCode = falhas ? 1 : 0;
})();
