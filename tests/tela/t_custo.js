// Custo da rota em reais: km × R$/km + horas × R$/hora + diária, com valores de partida (diesel,
// salário, consumo) e a janela "Custos dos veículos"; custo no resultado, na rota confirmada,
// nos Relatórios (total, por rota, por cliente pelo peso taxado) e na planilha. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const hoje = new Date().toISOString().slice(0, 10);
const g = (lat) => ({ cidade: 'Guarulhos', uf: 'SP', status: 'pendente', geoStatus: 'ok', lat, lng: -46.52, tipo: 'entrega', itens: 1 });
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: { P1: { id: 'P1', nf: '901', dest: 'Loja A', peso: 100, ...g(-23.45) }, P2: { id: 'P2', nf: '902', dest: 'Loja B', peso: 300, ...g(-23.46) } },
  // rota antiga, sem custo guardado: calculado pelo nome do veículo (Truck Toco), 10 km, 60 min
  rotas_confirmadas: { OLD: { id: 'OLD', data: hoje, veiculo: 'Truck Toco', motorista: 'Motorista B', km: 10, tempo_min: 60, num_paradas: 1, status: 'em_rota',
    paradas: [{ id: 'X', nf: '1', dest: 'Loja A', peso: 50, tipo: 'entrega' }] } },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const brl = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const sem = (t) => t.replace(/\s/g, ' ');

(async () => {
  const b = await chromium.launch();
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/solve/, (r) => { const body = JSON.parse(r.request().postData());
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: body.pedidos, km: 20, mins: 120 }], nao_alocados: [], fonte_distancia: 'OSRM' }) }); });
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
  p.on('dialog', (d) => d.accept());
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(150);   // VUC
  await p.fill('#cap-kg-d', '3000');
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1200);
  // VUC: 7,30 ÷ 6,5 = 1,1231/km; 2.956,92 × 1,7 ÷ 220 = 22,849/h → 20 km + 2 h = 22,46 + 45,70 = 68,16
  const rkm = 7.30 / 6.5, rh = 2956.92 * 1.7 / 220, c1 = Math.round((20 * rkm + 2 * rh) * 100) / 100;
  let res = sem(await p.textContent('#rot-step-results'));
  ok(res.includes('CUSTO ESTIMADO') && res.includes(brl(c1)), `custo da rota com os valores de partida: ${brl(c1)} (${(res.match(/CUSTO ESTIMADO[^p]*/) || [''])[0]})`);
  ok(res.includes(brl(c1 / 2) + ' por parada'), 'custo por parada');
  ok(/Faltam pneus e manutenção e a diária do veículo/.test(res), 'avisa o que falta preencher');
  ok(sem(await p.textContent('#rota-detail-d')).includes('💰 ' + brl(c1)), 'o detalhe da rota mostra o custo');

  // preencher pneus/manutenção e diária do VUC
  await p.click('.custo-nota button'); await p.waitForTimeout(300);
  ok(await p.isVisible('#modal-custos') && (await p.inputValue('#cus-diesel')) === '7,30' && (await p.inputValue('#cus-vuc-sal')) === '2956,92', 'a janela abre com os valores de partida');
  ok(/1,12\/km · R\$ 22,85\/hora/.test(sem(await p.textContent('#cus-res-vuc'))), 'mostra R$/km e R$/hora de cada veículo: ' + await p.textContent('#cus-res-vuc'));
  await p.fill('#cus-vuc-manut', 'abc');
  await p.click('#modal-custos >> text=Salvar custos'); await p.waitForTimeout(200);
  ok(/VUC: pneus e manutenção/.test(await p.textContent('#cus-erro')), 'número inválido: diz qual campo');
  await p.fill('#cus-vuc-manut', '0,40');
  await p.fill('#cus-vuc-diaria', '300');
  await p.click('#modal-custos >> text=Salvar custos'); await p.waitForTimeout(500);
  const cfg = await p.evaluate(() => window.__FAKE.db.empresas.emp1.config.custos);
  ok(cfg && cfg.tipos.vuc.manut === 0.4 && cfg.tipos.vuc.diaria === 300 && cfg.diesel === 7.3, 'custos salvos no banco da empresa');
  const c2 = Math.round((20 * (rkm + 0.4) + 2 * rh + 300) * 100) / 100;
  res = sem(await p.textContent('#rot-step-results'));
  ok(res.includes(brl(c2)) && !/Faltam pneus e manutenção e a diária do veículo/.test(res), `o resultado recalcula na hora: ${brl(c2)}`);

  // confirmar: a rota guarda o tipo do veículo e o custo
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1200);
  const rc = Object.values(await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas)).find((r) => r.id !== 'OLD');
  ok(rc && rc.veiculo_tipo === 'vuc' && rc.custo && rc.custo.total === c2 && rc.custo.diaria === 300, 'rota confirmada com veiculo_tipo e custo: ' + J(rc && rc.custo));

  // Relatórios
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  const cOld = Math.round((10 * (7.30 / 4.5) + 1 * rh) * 100) / 100;   // Toco, 10 km, 1 h, sem diária
  const rel = sem(await p.textContent('#rel-corpo'));
  ok(rel.includes(brl(c2 + cOld)), `relatório: custo total ${brl(c2 + cOld)} (rota antiga calculada pelo nome do veículo: ${brl(cOld)})`);
  ok(rel.includes('Custo das rotas') && rel.includes('Loja B') && rel.includes(brl(Math.round(c2 * 300 / 400 * 100) / 100)), 'custo por cliente pelo peso taxado (Loja B, 300 de 400 kg)');
  ok(/Pneus, manutenção ou diária ainda sem valor/.test(rel), 'avisa que ainda falta custo em algum veículo');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rel-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(/;Custo estimado \(R\$\)/.test(csv) && /Custo por cliente \(rateio pelo peso taxado\)/.test(csv) && csv.includes(String(c2).replace('.', ',')), 'planilha do relatório com o custo por rota e por cliente');

  // celular
  await p.setViewportSize({ width: 375, height: 760 });
  await p.click('#rel-custos'); await p.waitForTimeout(300);
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 375 && await p.isVisible('#cus-vuc-diaria'), 'a janela de custos cabe no celular (' + larg + ' px)');
  await p.screenshot({ path: 'custos-375.png' });
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
