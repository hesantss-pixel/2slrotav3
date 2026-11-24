// Cubagem, curto prazo (24/11/2026): confiança do m³, peça maior que o baú e carroceria,
// fator de cubagem e peso cubado, ocupação e peso cubado nos Relatórios, m³ pelo XML do CT-e.
// Dados inventados (placas TST, CNPJ 11222333000100 fictício).
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const CH1 = '35261111222333000100550010009200011000000027';
const CH2 = '35261111222333000100550010009999991000000099';
const CH3 = '35261111222333000100550010008888881000000088';
const hoje = new Date(); const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
const g = (lat) => ({ cidade: 'Guarulhos', uf: 'SP', status: 'pendente', geoStatus: 'ok', lat, lng: -46.52, itens: 1 });

const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    L1: { nf: 'L1', tipo: 'entrega', peso: 41, dest: 'Cliente Barras', maiorCm: 600, obsNota: 'BARRAS DE 6 METROS', ...g(-23.45) },
    A1: { nf: 'A1', tipo: 'entrega', peso: 100, dest: 'Cliente Isopor', m3: 2, m3Fonte: 'medidas', medidas: '100 × 100 × 100 cm', ...g(-23.46) },
    A2: { nf: 'A2', tipo: 'entrega', peso: 300, dest: 'Cliente Sem Medida', ...g(-23.47) },
    A3: { nf: 'A3', tipo: 'entrega', peso: 1800, dest: 'Cliente Estranho', m3: 0.5, m3Fonte: 'planilha', ...g(-23.48) },
    [CH1]: { nf: '920001', chave: CH1, tipo: 'entrega', peso: 120, dest: 'Cliente CTe 1', ...g(-23.49) },
    [CH2]: { nf: '999999', chave: CH2, tipo: 'entrega', peso: 360, dest: 'Cliente CTe 2', ...g(-23.50) },
    [CH3]: { nf: '888888', chave: CH3, tipo: 'entrega', peso: 50, dest: 'Cliente CTe 3', m3: 9, m3Fonte: 'digitado', ...g(-23.51) },
  },
  motoristas: {
    mot3: { id: 'mot3', nome: 'Motorista Baú', veiculo_id: 'tres4', veiculo_nome: 'Caminhão 3/4', cap_kg: 5000, placa: 'TST3C33', bau_c: 4.1, bau_l: 2.2, bau_a: 2.4 },
    motA: { id: 'motA', nome: 'Motorista Aberto', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', cap_kg: 8000, placa: 'TST4D44', carroceria: 'aberta' },
  },
  rotas_confirmadas: {
    r1: { id: 'r1', data: iso, criada_em: iso + 'T08:00:00', status: 'ativa', veiculo: '3/4', motorista: 'A', cap_kg: 5000, cap_m3: 18, km: 30,
      paradas: [{ nf: 'R1', tipo: 'entrega', peso: 500, m3: 6, m3Fonte: 'nota', dest: 'Cliente R1' }, { nf: 'R2', tipo: 'entrega', peso: 400, m3: 6, m3Fonte: 'medidas', dest: 'Cliente R2' }] },
    r2: { id: 'r2', data: iso, criada_em: iso + 'T09:00:00', status: 'ativa', veiculo: 'VUC', motorista: 'B', cap_kg: 3000, cap_m3: 15, km: 20,
      paradas: [{ nf: 'R3', tipo: 'entrega', peso: 1200, m3: 1, m3Fonte: 'digitado', dest: 'Cliente R3' }, { nf: 'R4', tipo: 'entrega', peso: 100, dest: 'Cliente R4' }] },
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const emp = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1);

(async () => {
  const b = await chromium.launch();
  let solveReq = null;
  const { p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, async (c) => {
    await c.route(/railway\.app\/solve/, async (r) => {
      solveReq = JSON.parse(r.request().postData());
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: 'x', veiculo_id: 'x', pedidos: solveReq.pedidos, km: 20, mins: 60 }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
    });
  });
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  // ── fator de cubagem ──────────────────────────────────────────────────────
  await p.click('.sb-item[data-page="produtos"]'); await p.waitForTimeout(300);
  ok((await p.inputValue('#prod-fator')) === '300', 'fator de cubagem começa em 300 kg por m³');
  await p.fill('#prod-fator', '5'); await p.click('.prod-fator .btn-sm'); await p.waitForTimeout(150);
  ok(/entre 50 e 1\.000/.test(await p.textContent('#prod-msg')), 'fator fora do razoável é recusado');
  await p.fill('#prod-fator', '250'); await p.click('.prod-fator .btn-sm'); await p.waitForTimeout(250);
  ok(J((await emp(p)).config.cubagem) === J({ fator: 250 }), 'fator gravado na configuração da empresa');
  await p.fill('#prod-fator', '300'); await p.click('.prod-fator .btn-sm'); await p.waitForTimeout(250);

  // ── m³ pelo CT-e ──────────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  await p.setInputFiles('#file-input', __dirname + '/xml/cte-m3.xml'); await p.waitForTimeout(900);
  const msg = await p.textContent('#import-msg-pedidos');
  ok(/2 CT-e lidos: m³ em 2 pedidos; 1 pedido mantido \(m³ digitado ou já em rota\)\./.test(msg), 'importar o CT-e não cria pedido e diz o que fez: ' + msg);
  let d = (await emp(p)).pedidos_rota;
  ok(d[CH1].m3 === 0.625 && d[CH2].m3 === 1.875 && d[CH1].m3Fonte === 'cte' && d[CH1].m3Rateio === true && d[CH1].cteNum === '123',
    'CT-e com 2 notas: 2,5 m³ divididos pelo peso (120 e 360 kg) ' + J([d[CH1].m3, d[CH2].m3]));
  ok(d[CH3].m3 === 9 && d[CH3].m3Fonte === 'digitado', 'm³ digitado não é trocado pelo do CT-e');
  ok(Object.keys(d).length === 7, 'nenhum pedido novo criado pelo CT-e');
  // peso cubado do CT-e (sem m³) vira m³ pelo fator
  await p.evaluate((c) => { const x = window.__FAKE.db.empresas.emp1.pedidos_rota[c]; delete x.m3; delete x.m3Fonte; window.__FAKE.fire(); }, CH3);
  await p.waitForTimeout(150);
  await p.setInputFiles('#file-input', __dirname + '/xml/cte-m3.xml'); await p.waitForTimeout(900);
  d = (await emp(p)).pedidos_rota;
  ok(d[CH3].m3 === 2 && d[CH3].m3DeCubado === true, 'CT-e só com PESO CUBADO 600 kg vira 2 m³ (÷ 300): ' + J([d[CH3].m3]));
  await p.evaluate((c) => window.abrirPedido(c), CH3); await p.waitForTimeout(300);
  const nota = await p.textContent('#ped-m3-nota');
  ok(/Veio do CT-e 124, pelo peso cubado ÷ 300\./.test(nota) && /Peso cubado: 600 kg \(2 m³ × 300\)\. Peso taxado: 600 kg/.test(nota), 'pedido mostra a origem e o peso cubado e taxado: ' + nota);
  await p.evaluate(() => window.fecharPedido());
  await p.evaluate(() => window.abrirPedido('A3')); await p.waitForTimeout(300);
  ok(/3\.600 kg por m³: a medida parece errada\. Confira\./.test(await p.textContent('#ped-m3-nota')), 'medida que não combina com o peso pede conferência');
  await p.evaluate(() => window.fecharPedido());

  // ── rota com baú: peça de 6 m fica fora, com o motivo ───────────────────────
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST3C33")'); await p.waitForTimeout(300);
  ok((await p.inputValue('#cap-carroc-d')) === 'bau' && (await p.inputValue('#cap-m3-d')) === '21,65', 'veículo de baú traz a carroceria e o volume');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq && !solveReq.pedidos.some((x) => x.nf === 'L1') && solveReq.pedidos.length === 6, 'a barra de 6 m não vai para o cálculo de um baú de 4,1 m');
  const res = await p.textContent('#rot-step-results');
  ok(/1 pedido ficou fora porque é maior que o baú \(4,1 m\): NF L1 \(6 m\)/.test(res), 'o resultado diz qual pedido ficou fora e por quê');
  ok(/1 parada não tem medida \(NF A2\)/.test(res), 'avisa a parada sem medida: o volume pode ser maior');
  ok(/Medida que não combina com o peso em NF A3 \(3\.600 kg por m³\)/.test(res), 'avisa a medida estranha');
  const linhas = await p.$$eval('#rota-detail-d .delivery-mini', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
  ok(linhas.some((t) => /NF A1.*2 m³ \(medidas da nota\)/.test(t)) && linhas.some((t) => /NF A2.*sem medida/.test(t)) && linhas.some((t) => /NF 920001.*0,63 m³ \(CT-e\)/.test(t)),
    'cada parada mostra de onde veio o m³');
  await p.click('text=Plano de carga'); await p.waitForTimeout(250);
  ok(/0,63 m³\s*CT-e/.test(await p.textContent('#plano-corpo')), 'o plano de carga também mostra a origem');
  await p.click('#modal-plano .btn-modal-sec');

  // ── carroceria aberta: sem volume nem comprimento ──────────────────────────
  await p.evaluate(() => window.renderVeiculosD()); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST4D44")'); await p.waitForTimeout(300);
  ok((await p.inputValue('#cap-carroc-d')) === 'aberta' && (await p.inputValue('#cap-m3-d')) === '', 'carroceria aberta: o volume vem vazio');
  ok(/Carroceria aberta: o volume e o comprimento do baú não limitam/.test(await p.textContent('#cap-m3-nota')), 'e a tela explica');
  solveReq = null;
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok(/Carroceria: carroceria aberta/.test(await p.textContent('#confirm-details-d')), 'confirmação mostra a carroceria');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq && solveReq.pedidos.some((x) => x.nf === 'L1') && !solveReq.veiculos[0].capM3, 'na aberta a barra de 6 m entra e não há limite de volume');
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(700);
  const rc = Object.values((await emp(p)).rotas_confirmadas).find((r) => r.carroceria);
  ok(rc && rc.carroceria === 'aberta', 'rota confirmada guarda a carroceria');

  // ── cadastro: carroceria ────────────────────────────────────────────────────
  await p.waitForTimeout(800);
  await p.click('.sb-item[data-page="motoristas"]'); await p.waitForTimeout(400);
  ok((await p.textContent('#motoristas-lista')).includes('8.000 kg · carroceria aberta'), 'cartão da frota mostra a carroceria aberta');
  await p.evaluate(() => window.toggleFormMotorista('mot3')); await p.waitForTimeout(200);
  await p.selectOption('#mot-carroc', 'sider'); await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
  ok((await emp(p)).motoristas.mot3.carroceria === 'sider', 'carroceria gravada no veículo');

  // ── Relatórios: ocupação e peso cubado ──────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  const rel = (await p.textContent('#rel-corpo')).replace(/\s+/g, ' ');
  // r1: 900/5000 = 18% peso, 12/18 = 67% vol. r2: 1300/3000 = 43% peso, 1/15 = 7% vol. + a rota confirmada agora (aberta, sem cap_m3)
  ok(/Ocupação dos veículos/.test(rel) && /VOLUME USADO \(MÉDIA\)/.test(rel) && /37%\s*VOLUME USADO/.test(rel), 'ocupação média do volume nas viagens com baú: ' + (rel.match(/\d+%\s*VOLUME USADO/) || [''])[0]);
  ok(/1 de 2\s*O VOLUME ENCHEU ANTES DO PESO/.test(rel), 'conta em quantas viagens o volume encheu antes do peso');
  ok(/25% das paradas com volume do baú não tinham medida/.test(rel), 'mostra quantas paradas não tinham medida');
  ok(/67% vol\./.test(rel), 'a tabela de rotas mostra a ocupação de cada viagem');
  ok(/Peso cubado acima do real/.test(rel) && /NF R1/.test(rel) && /NF R2/.test(rel) && !/NF R3 /.test(rel), 'lista os pedidos com peso cubado acima do real (6 m³ × 300 = 1.800 kg)');
  ok(/\+1\.300 kg/.test(rel) && /\+1\.400 kg/.test(rel), 'mostra a diferença de cada um');
  await p.screenshot({ path: 'cub2-relatorios-1280.png', fullPage: true });

  ok(errs.length === 0, 'sem erros no console: ' + J(errs.slice(0, 3)));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo');
  process.exitCode = falhas ? 1 : 0;
})();
