// Pedido agendado: a bolinha vermelha e o que acontece em cada tela.
// Regra (3.11): agendado para outro dia sai do mapa e volta, em vermelho, no dia dele.
// Desde 16/11 a lista de Pedidos e as buscas também mostram a marca 📅, as telas se
// atualizam na hora em que o pedido é agendado e dá para tirar o agendamento.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const VERMELHO = '#d64545';
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOJE = iso(new Date()), AMANHA = iso(new Date(Date.now() + 864e5));

const seed = (a) => {
  const base = (nf, ex) => ({ id: nf, nf, tipo: 'entrega', cidade: 'Guarulhos', uf: 'SP', dest: 'Cliente ' + nf,
    peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', geoPrec: 'numero',
    lat: -23.45, lng: -46.5, endereco: 'Rua A, ' + nf, cep: '07010000',
    agendado: false, dataAgendada: '', horaEntrega: '', horaFim: '', ...ex });
  window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'T' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } },
        pedidos_rota: {
          7001: base('7001'),                                                                                     // comum
          7002: base('7002', { agendado: true, dataAgendada: a.hoje, horaEntrega: '09:00', horaFim: '11:00', lat: -23.46, lng: -46.52 }),   // sai hoje
          7003: base('7003', { agendado: true, dataAgendada: a.amanha, horaEntrega: '14:00', horaFim: '16:00', lat: -23.47, lng: -46.54 }), // outro dia
          7004: base('7004', { agendado: true, dataAgendada: '2026-01-05', horaEntrega: '08:00', horaFim: '10:00', lat: -23.44, lng: -46.49 }), // atrasado
        } } } } };
};

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 1000, seed, false, { hoje: HOJE, amanha: AMANHA });
  await ctx.route(/nominatim|viacep|railway\.app/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  p.on('dialog', (d) => d.accept());
  await p.waitForTimeout(900);
  const vermelhos = () => p.evaluate((c) => document.querySelectorAll(`#mapa-completo path[fill="${c}"]`).length, VERMELHO);

  // ── mapa grande ───────────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(1200);
  ok(await vermelhos() === 2, 'mapa: o que sai hoje e o atrasado ficam vermelhos (2)');
  ok(await p.evaluate(() => document.querySelectorAll('#mapa-completo path[fill="#0b9c6a"]').length) === 1, 'mapa: o pedido comum fica verde');
  const leg = await p.textContent('#mapa-completo-legenda');
  ok(/Agendado: sai hoje \(2\)/.test(leg), 'legenda conta os que saem hoje: ' + leg.slice(0, 80));
  ok(/1 agendado para outro dia não aparece até o dia/.test(leg), 'legenda explica o que foi guardado para outro dia');

  // ── lista da página Pedidos ───────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(600);
  const itens = await p.evaluate(() => {
    document.querySelectorAll('.rc-card-head').forEach((h) => h.click());
    const t = (nf) => [...document.querySelectorAll('.nf-mini')].find((b) => b.textContent.includes('NF ' + nf));
    const chip = (nf) => { const el = t(nf); const c = el && el.querySelector('.ag-chip');
      return c ? { txt: c.textContent.trim(), hoje: c.classList.contains('hoje'), title: c.getAttribute('title') } : null; };
    return { c7001: chip('7001'), c7002: chip('7002'), c7003: chip('7003'), c7004: chip('7004'),
      sub: [...document.querySelectorAll('.rc-card-sub')].map((x) => x.textContent).join(' | ') };
  });
  ok(itens.c7001 === null, 'pedido comum não ganha marca de agendamento');
  ok(itens.c7002 && itens.c7002.hoje && /sai hoje 09:00–11:00/.test(itens.c7002.txt), 'na lista, o que sai hoje fica vermelho: ' + JSON.stringify(itens.c7002));
  ok(itens.c7003 && !itens.c7003.hoje && /\d{2}\/\d{2} 14:00–16:00/.test(itens.c7003.txt), 'o de outro dia mostra a data, sem vermelho: ' + JSON.stringify(itens.c7003));
  ok(itens.c7003.title.includes('Só entra no mapa e na roteirização no dia'), 'e explica que só entra no dia');
  ok(itens.c7004 && itens.c7004.hoje && /atrasado/.test(itens.c7004.txt), 'o atrasado fica vermelho e diz que está atrasado');
  ok(/2 saem hoje/.test(itens.sub), 'o cartão da região conta quantos saem hoje: ' + itens.sub.slice(0, 90));

  // ── busca ─────────────────────────────────────────────────────────────────
  await p.fill('#busca-notas', '7002'); await p.waitForTimeout(700);
  ok(await p.evaluate(() => !!document.querySelector('.busca-item .ag-chip.hoje')), 'a busca de notas também mostra a marca');

  // ── agendar pela tela: as telas atualizam sozinhas ────────────────────────
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(900);
  const antes = await vermelhos();
  await p.evaluate(() => { window.abrirModalAgendar(); window.selecionarNFAgendarD('7001'); });
  await p.waitForTimeout(300);
  await p.evaluate((h) => { document.getElementById('ag-data-d').value = h; document.getElementById('ag-hora-d').value = '10:00'; }, HOJE);
  await p.evaluate(() => window.salvarAgendamentoD()); await p.waitForTimeout(900);
  ok(await vermelhos() === antes + 1, `agendar para hoje já pinta o pino de vermelho, sem recarregar (${antes} → ${await vermelhos()})`);
  const salvo = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota['7001']);
  ok(salvo.agendado === true && salvo.dataAgendada === HOJE && salvo.horaFim === '11:00', 'agendamento salvo com a faixa de 1 h quando o fim fica em branco: ' + JSON.stringify([salvo.dataAgendada, salvo.horaEntrega, salvo.horaFim]));

  // ── reabrir e tirar o agendamento ─────────────────────────────────────────
  await p.evaluate(() => { window.abrirModalAgendar(); window.selecionarNFAgendarD('7001'); });
  await p.waitForTimeout(300);
  const reabre = await p.evaluate(() => ({ data: document.getElementById('ag-data-d').value,
    hora: document.getElementById('ag-hora-d').value, tirar: document.getElementById('ag-desagendar-d').style.display }));
  ok(reabre.data === HOJE && reabre.hora === '10:00' && reabre.tirar === 'block', 'reabrir um pedido agendado traz a data, a hora e o botão de tirar: ' + JSON.stringify(reabre));
  await p.evaluate(() => window.desagendarD()); await p.waitForTimeout(900);
  const depois = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota['7001']);
  ok(depois.agendado === false && !depois.dataAgendada, 'tirar o agendamento limpa a data e a hora');
  ok(await vermelhos() === antes, 'e o pino volta ao normal na hora');
  await p.evaluate(() => { window.abrirModalAgendar(); window.selecionarNFAgendarD('7001'); });
  await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.getElementById('ag-desagendar-d').style.display) === 'none', 'pedido sem agendamento não mostra o botão de tirar');
  await p.evaluate(() => window.fecharModalAgendar());

  // ── montagem manual: entrar e sair da rota não apaga o vermelho (18/11) ───
  // _manIcone desenhava o pino com a classe "hoje"; _manPintar, que repinta só o
  // pino tocado, remontava a classe sem ela — tirar da rota deixava o agendado verde.
  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(500);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(250);
  await p.fill('#cap-kg-d', '2000');
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(250);
  await p.click('#rot-step-confirm .btn-modal-alt');
  await p.waitForTimeout(900);
  const pinoMan = () => p.evaluate(() => {
    const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')]
      .find((x) => /NF 7002/.test(x.getAttribute('title') || ''));
    return a && a.firstElementChild ? a.firstElementChild.className : 'não achei';
  });
  const tocarMan = () => p.evaluate(() => {
    const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')]
      .find((x) => /NF 7002/.test(x.getAttribute('title') || ''));
    if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  ok(/\bhoje\b/.test(await pinoMan()), 'montagem manual: o agendado de hoje começa vermelho');
  await tocarMan(); await p.waitForTimeout(350);
  const dentro = await pinoMan();
  ok(/\bsel\b/.test(dentro) && /\bhoje\b/.test(dentro),
    'na rota ele fica escolhido e continua agendado: ' + dentro);
  await tocarMan(); await p.waitForTimeout(350);
  const fora = await pinoMan();
  ok(/\bhoje\b/.test(fora) && !/\bsel\b/.test(fora),
    'tirando da rota ele volta vermelho, não verde: ' + fora);

  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await p.screenshot({ path: 'agendado-1440.png', fullPage: false });
  await b.close();
  console.log(falhas ? `${falhas} falha(s)` : 'tudo certo');
})();
