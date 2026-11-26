// Rota confirmada com o km estimado em linha reta: o aviso é neutro (não fala de servidor) e
// "Medir pelas ruas" refaz a conta na mesma ordem e corrige km, tempo, horários e custo no banco.
// Rota com mais de 100 paradas não tem o botão (o cálculo pelas ruas mede até 100).
// Dados inventados; nada de cliente real.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const hoje = new Date().toISOString().slice(0, 10);
const par = (nf, lat, ch) => ({ id: 'p' + nf, nf, tipo: 'entrega', dest: 'Loja ' + nf, peso: 100, lat, lng: -46.52, chegada_min: ch });
const rota = (id, extra) => ({ id, data: hoje, veiculo: 'VUC', motorista: 'Motorista ' + id, km: 20, tempo_min: 60, saida: 420, volta: true, fator_tempo: 1,
  status: 'concluida', peso_total: 200, num_paradas: 2, paradas: [par('1' + id, -23.45, 440), par('2' + id, -23.46, 460)], ...extra });
const muitas = Array.from({ length: 101 }, (_, i) => par('M' + i, -23.4 - i / 1000, 430 + i));
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  rotas_confirmadas: {
    R1: rota('R1', { fonte_dist: 'Haversine:indisponivel', custo: { total: 100, km: 40, hora: 60, diaria: 0 } }),
    R2: rota('R2', { fonte_dist: 'Haversine:limite', paradas: muitas, num_paradas: 101, km: 50 }),
    R3: rota('R3', { fonte_dist: 'OSRM', km: 15 }),
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };

(async () => {
  const b = await chromium.launch();
  const reg = { avaliar: [], falha: true };
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis|railway\.app\/tracado/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/avaliar/, (r) => {
      const body = JSON.parse(r.request().postData()); reg.avaliar.push(body);
      if (reg.falha) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"x"}' });
      r.fulfill({ contentType: 'application/json', body: J({ km: 32.5, mins: 90, chegada_min: [445, 470], fonte_distancia: 'OSRM', passa_da_jornada: false }) });
    });
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
  p.on('dialog', (d) => d.accept());
  const db = () => p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas);
  const texto = (sel) => p.textContent(sel).then((t) => t.replace(/\s+/g, ' '));

  // ── Relatórios: aviso neutro ──────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  let rel = await texto('#rel-corpo');
  ok(/📏 70,0 dos 85,0 km deste relatório \(2 rotas\) estão estimados em linha reta\. Pelas ruas, o km costuma ser maior\./.test(rel), 'aviso diz quanto do km é estimado: ' + (rel.match(/📏[^.]*\./) || [''])[0]);
  ok(!/servidor|fora do ar|sem resposta/i.test(rel) && !(await p.$('#rel-corpo .rel-alerta:not(.leve)')), 'sem falar de servidor e sem a caixa amarela de alerta');
  ok(await p.isVisible('#rel-reta >> text=Medir pelas ruas'), 'oferece "Medir pelas ruas"');

  // sem resposta: avisa e não muda nada
  await p.click('#rel-reta >> text=Medir pelas ruas'); await p.waitForTimeout(800);
  ok(/Não deu para medir pelas ruas agora/.test(await texto('body')) && (await db()).R1.km === 20 && (await db()).R1.fonte_dist === 'Haversine:indisponivel',
    'sem resposta: avisa para tentar depois e a rota fica como estava');
  ok(reg.avaliar.length === 1 && reg.avaliar[0].pedidos.length === 2 && reg.avaliar[0].hora_saida === 420 && reg.avaliar[0].volta === true && reg.avaliar[0].pedidos[0].lat === -23.45,
    'mede só a rota que cabe (2 paradas), na mesma ordem, com a saída e a volta dela: ' + J(reg.avaliar.map((x) => x.pedidos.length)));

  // com resposta: km, tempo, horários e custo corrigidos
  reg.falha = false;
  await p.waitForTimeout(3500);   // o aviso anterior some
  await p.click('#rel-reta >> text=Medir pelas ruas'); await p.waitForTimeout(1200);
  const r1 = (await db()).R1;
  ok(r1.km === 32.5 && r1.tempo_min === 90 && r1.fonte_dist === 'OSRM' && r1.km_reta === 20 && !!r1.medida_ruas_em,
    'rota corrigida: 32,5 km pelas ruas (o estimado, 20 km, fica guardado): ' + J({ km: r1.km, t: r1.tempo_min, f: r1.fonte_dist, antes: r1.km_reta }));
  ok(r1.paradas[0].chegada_min === 445 && r1.paradas[1].chegada_min === 470, 'os horários previstos das paradas também');
  ok(r1.custo.km === 65 && r1.custo.hora === 90 && r1.custo.total === 155, 'custo refeito com as mesmas taxas: R$ 40 × 32,5/20 + R$ 60 × 90/60 = R$ 155: ' + J(r1.custo));
  ok(/1 rota medida pelas ruas/.test(await texto('body')), 'avisa quantas rotas foram medidas');
  rel = await texto('#rel-corpo');
  ok(/📏 50,0 dos 97,5 km deste relatório \(1 rota\)/.test(rel) && !(await p.isVisible('#rel-reta >> text=Medir pelas ruas')),
    'o relatório atualiza; a rota de 101 paradas continua estimada, sem botão: ' + (rel.match(/📏[^.]*\./) || [''])[0]);

  // ── Rotas: selo neutro ────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(500);
  const selos = await p.$$eval('.rc-reta', (s) => s.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(selos.length === 1 && selos[0] === 'km estimado', 'em Rotas, só a rota de 101 paradas tem o selo "km estimado", sem ⚠️: ' + J(selos));
  ok(!(await texto('#page-rotas')).match(/servidor|fora do ar/i), 'Rotas não fala de servidor');
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
