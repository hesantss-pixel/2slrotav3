// Cadastro da frota: tipo, modelo, placa, capacidade e motorista (opcional).
// Placas daqui são inventadas (começam com TST); nada de dado real de cliente no repositório.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    '8101': { nf: '8101', tipo: 'entrega', cidade: 'Guarulhos', peso: 900, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Cliente A', endereco: 'Rua A, 10', bairro: 'Centro', cep: '07010000', uf: 'SP', geoStatus: 'ok' },
    '8102': { nf: '8102', tipo: 'entrega', cidade: 'Guarulhos', peso: 700, status: 'pendente', lat: -23.46, lng: -46.52, dest: 'Cliente B', endereco: 'Rua B, 20', bairro: 'Centro', cep: '07010000', uf: 'SP', geoStatus: 'ok' },
  },
  // cadastro antigo: só nome, tipo e capacidade — tem que continuar aparecendo
  motoristas: { mot_antigo: { id: 'mot_antigo', nome: 'Motorista Antigo', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', cap_kg: 8000 } },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const frota = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1.motoristas || {});

async function preencher(p, { tipo, modelo = '', placa = '', cap = '', nome = '' }) {
  await p.click('#mot-veh-grid .veh-card >> nth=' + tipo);
  await p.fill('#mot-modelo', modelo); await p.fill('#mot-placa', placa);
  await p.fill('#mot-cap-kg', String(cap)); await p.fill('#mot-nome', nome);
  await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
}

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed);
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.evaluate(() => window.irParaPagina('motoristas')); await p.waitForTimeout(400);

  ok((await p.textContent('#motoristas-lista')).includes('Motorista Antigo'), 'cadastro antigo (sem modelo e placa) continua aparecendo');

  // ── tipos ────────────────────────────────────────────────────────────────
  await p.click('text=+ Adicionar veículo'); await p.waitForTimeout(250);
  const tipos = await p.$$eval('#mot-veh-grid .veh-card', (c) => c.map((x) => x.querySelector('.veh-card-name').textContent + ' ' + x.querySelector('.veh-card-tag').textContent));
  ok(tipos.length === 6 && tipos[2] === 'Caminhão 3/4 até 6t', 'seis tipos, com o Caminhão 3/4 entre o VUC e o toco: ' + JSON.stringify(tipos));
  ok(tipos[0] === 'Fiorino até 650 kg', 'Fiorino mostra a carga de fábrica (650 kg): ' + tipos[0]);
  await p.click('#mot-veh-grid .veh-card >> nth=2');
  ok(/Accelo 815, 1016, 915C/.test(await p.textContent('#mot-veh-desc')), 'ao escolher o tipo, aparece o que ele é (exemplos de modelo)');
  ok(await p.$eval('#mot-veh-grid .veh-card >> nth=2', (e) => e.classList.contains('on')), 'o tipo escolhido fica marcado');

  // ── validações ───────────────────────────────────────────────────────────
  await preencher(p, { tipo: 2, modelo: 'Accelo 1016', placa: 'AB12', cap: 6000 });
  ok(/Placa inválida/.test(dialogs.pop() || ''), 'placa em formato errado é recusada');
  await preencher(p, { tipo: 2, modelo: 'Accelo 1016', placa: '', cap: 6000, nome: '' });
  ok(/placa do veículo ou o nome/.test(dialogs.pop() || ''), 'sem placa e sem motorista não salva');
  ok(Object.keys(await frota(p)).length === 1, 'nada foi gravado nas tentativas recusadas');

  // ── cadastrar ────────────────────────────────────────────────────────────
  await preencher(p, { tipo: 2, modelo: 'Accelo 1016', placa: 'tst1a23', cap: 6000 });
  let f = Object.values(await frota(p));
  const accelo = f.find((m) => m.modelo === 'Accelo 1016');
  ok(accelo && accelo.placa === 'TST1A23' && accelo.veiculo_id === 'tres4' && accelo.cap_kg === 6000 && accelo.nome === '', 'veículo sem motorista grava placa em maiúsculas, tipo e capacidade: ' + JSON.stringify(accelo));
  ok(!(await p.isVisible('#form-motorista-box')), 'o formulário fecha depois de salvar');

  await p.click('text=+ Adicionar veículo'); await p.waitForTimeout(150);
  ok((await p.inputValue('#mot-modelo')) === '' && (await p.inputValue('#mot-placa')) === '', 'formulário novo abre vazio');
  await preencher(p, { tipo: 0, modelo: 'Fiorino', placa: 'TST2B34', cap: 650, nome: 'Motorista Teste' });
  await p.click('text=+ Adicionar veículo'); await p.waitForTimeout(150);
  await preencher(p, { tipo: 2, modelo: '915C', placa: 'TST-1A23', cap: 5000 });
  ok(/TST1A23 já está cadastrada \(Accelo 1016 · TST1A23\)/.test(dialogs.pop() || ''), 'placa repetida é recusada e diz qual veículo já tem');
  await p.fill('#mot-placa', 'TST1234'); await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
  f = Object.values(await frota(p));
  ok(f.length === 4 && f.some((m) => m.placa === 'TST1234' && m.modelo === '915C'), 'placa no formato antigo também é aceita');

  // ── cartões ──────────────────────────────────────────────────────────────
  const cards = await p.$$eval('#motoristas-lista .rc-card', (c) => c.map((x) => ({
    nome: x.querySelector('.rc-card-name').textContent, sub: x.querySelector('.rc-card-sub').textContent,
    mot: x.querySelector('.frota-mot').textContent, placa: x.querySelector('.placa-num')?.textContent || '',
    antiga: !!x.querySelector('.placa.antiga'), img: x.querySelector('img').getAttribute('src') })));
  ok(cards.map((c) => c.nome).join(',') === 'Fiorino,915C,Accelo 1016,Truck Toco', 'cartões em ordem do menor para o maior veículo: ' + cards.map((c) => c.nome).join(','));
  const ca = cards.find((c) => c.nome === 'Accelo 1016');
  ok(ca && ca.placa === 'TST1A23' && ca.sub === 'Caminhão 3/4 · 6.000 kg · 21,65 m³ (típico)' && ca.mot === 'Sem motorista definido' && ca.img.endsWith('tres4.svg'), 'cartão mostra modelo, placa, tipo, capacidade, m³ típico do baú e que falta motorista: ' + JSON.stringify(ca));
  const cf = cards.find((c) => c.nome === 'Fiorino');
  ok(cf && cf.mot === 'Motorista: Motorista Teste' && cf.img.endsWith('fiorino.svg') && !cf.antiga, 'Fiorino com o desenho de furgão e o motorista');
  ok(cards.find((c) => c.nome === '915C').placa === 'TST-1234' && cards.find((c) => c.nome === '915C').antiga, 'placa antiga aparece com hífen, no estilo cinza');
  ok(cards.find((c) => c.nome === 'Truck Toco').mot === 'Motorista: Motorista Antigo', 'cadastro antigo vira cartão com o tipo no lugar do modelo');

  // ── editar ───────────────────────────────────────────────────────────────
  await p.click(`.rc-card[data-mot="${accelo.id}"] >> text=Editar`); await p.waitForTimeout(250);
  ok((await p.textContent('#mot-form-tit')) === 'Editar veículo' && (await p.inputValue('#mot-modelo')) === 'Accelo 1016' && (await p.inputValue('#mot-placa')) === 'TST1A23' && (await p.inputValue('#mot-cap-kg')) === '6000', 'editar abre o formulário preenchido');
  ok(await p.$eval('#mot-veh-grid .veh-card >> nth=2', (e) => e.classList.contains('on')), 'editar já marca o tipo do veículo');
  await p.fill('#mot-nome', 'Motorista Dois'); await p.click('text=Salvar veículo'); await p.waitForTimeout(250);
  f = await frota(p);
  ok(Object.keys(f).length === 4 && f[accelo.id].nome === 'Motorista Dois' && f[accelo.id].placa === 'TST1A23', 'editar muda o mesmo registro, sem duplicar');

  // ── excluir ──────────────────────────────────────────────────────────────
  const id915 = Object.values(f).find((m) => m.modelo === '915C').id;
  await p.click(`.rc-card[data-mot="${id915}"] >> text=Excluir`); await p.waitForTimeout(250);
  ok(/Excluir 915C · TST-1234 do cadastro\?/.test(dialogs.pop() || ''), 'excluir pede confirmação dizendo qual veículo');
  f = await frota(p);
  ok(!f[id915] && Object.keys(f).length === 3, 'excluído some do cadastro');

  // ── roteirização: atalho e rota gravada com a placa ──────────────────────
  let body = null;
  await ctx.route(/railway\.app\/solve/, (r) => {
    body = JSON.parse(r.request().postData());
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Caminhão 3/4', veiculo_id: 'tres4', pedidos: body.pedidos.map((x, i) => ({ ...x, chegada_min: 480 + i * 20 })), km: 12, mins: 60 }], nao_alocados: [], fonte_distancia: 'OSRM', salvo: false }) });
  });
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  const atalho = await p.textContent('#motoristas-atalho');
  ok(atalho.includes('Veículos cadastrados') && atalho.includes('TST1A23') && atalho.includes('Accelo 1016') && atalho.includes('Motorista: Motorista Dois'), 'roteirização lista a frota com modelo, placa e motorista');
  ok((await p.$$('#motoristas-atalho .placa')).length === 2, 'cada veículo com placa mostra a placa no atalho');
  await p.click('#motoristas-atalho .veh-card:has-text("TST1A23")'); await p.waitForTimeout(200);
  ok((await p.textContent('#cap-veh-name')) === 'Accelo 1016 · TST1A23 — Motorista Dois' && (await p.inputValue('#cap-kg-d')) === '6000', 'usar o veículo preenche nome, placa e capacidade');
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  const vs = body && body.veiculos && body.veiculos[0];
  ok(vs && vs.capKg === 6000 && vs.id === 'tres4', '/solve recebe o tipo e a capacidade do veículo cadastrado: ' + JSON.stringify(vs));
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1200);
  const rota = Object.values((await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas)) || {})[0];
  ok(rota && rota.veiculo === 'Accelo 1016 · TST1A23' && rota.placa === 'TST1A23' && rota.motorista === 'Motorista Dois', 'rota confirmada guarda modelo, placa e motorista: ' + JSON.stringify(rota && { v: rota.veiculo, p: rota.placa, m: rota.motorista }));
  ok(!errs.length, 'sem erros no console ' + JSON.stringify(errs.slice(0, 2)));
  await ctx.close();

  // ── celular: nada passa da tela ──────────────────────────────────────────
  for (const [W, H] of [[390, 844], [320, 740]]) {
    const s2 = JSON.parse(JSON.stringify(seed));
    s2.empresas.emp1.motoristas = {
      a: { id: 'a', nome: '', modelo: 'Accelo 1016', placa: 'TST1A23', veiculo_id: 'tres4', veiculo_nome: 'Caminhão 3/4', cap_kg: 6000 },
      b: { id: 'b', nome: 'Motorista Com Nome Bem Comprido', modelo: 'Fiorino', placa: 'TST2B34', veiculo_id: 'fiorino', veiculo_nome: 'Fiorino', cap_kg: 650 } };
    const m = await open(b, 'index.html', W, H, init, true, s2);
    await m.p.evaluate(() => window.irParaPagina('motoristas')); await m.p.waitForTimeout(400);
    await m.p.evaluate(() => window.toggleFormMotorista('a')); await m.p.waitForTimeout(400);
    const r = await m.p.evaluate(() => {
      const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const fora = [...document.querySelectorAll('#motoristas-lista .placa')].filter((pl) => {
        const c = pl.closest('.rc-card').getBoundingClientRect(), q = pl.getBoundingClientRect();
        return q.right > c.right + 0.5 || q.left < c.left - 0.5; }).length;
      return { over, fora };
    });
    ok(r.over <= 1 && r.fora === 0, `${W}px: sem rolagem lateral e placas dentro dos cartões ` + JSON.stringify(r));
    await m.p.screenshot({ path: `frota-${W}.png`, fullPage: false });
    await m.p.evaluate(() => window.irParaPagina('roteirizacao')); await m.p.waitForTimeout(400);
    const o2 = await m.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(o2 <= 1, `${W}px: roteirização com a frota sem rolagem lateral (${o2}px)`);
    ok(!m.errs.length, `${W}px: sem erros no console ` + JSON.stringify(m.errs.slice(0, 2)));
    await m.ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
