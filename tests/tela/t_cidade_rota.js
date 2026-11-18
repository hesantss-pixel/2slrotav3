// Roteirizar por cidade (18/11/2026).
//
// O servidor de rotas mede pelas ruas até um certo número de pontos de uma vez;
// acima disso o km sai em linha reta. Com 200 notas de dez cidades, toda rota
// saía assim. Agora a viagem pode ser de uma cidade só — que é como a operação
// pensa — e o cálculo fica abaixo do limite.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const amanha = () => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const ped = (nf, cidade, tipo, ex = {}) => ({
  id: (tipo === 'coleta' ? 'C_' : '') + nf, nf, tipo, cidade, uf: 'SP', dest: 'Cliente ' + nf,
  endereco: 'Rua ' + nf, bairro: 'Centro', cep: '07010000', peso: 100, itens: 1,
  status: 'pendente', geoStatus: 'ok', geoPrec: 'numero',
  lat: -23.45 + Math.random() * 0.05, lng: -46.5 + Math.random() * 0.05, ...ex });

const pedidos = {};
for (let i = 0; i < 12; i++) pedidos['G' + i] = ped('10' + i, 'Guarulhos', 'entrega');
for (let i = 0; i < 5; i++) pedidos['S' + i] = ped('20' + i, 'Santos', 'entrega');
for (let i = 0; i < 3; i++) pedidos['A' + i] = ped('30' + i, 'Arujá', 'entrega');
pedidos.C1 = ped('401', 'Santos', 'coleta');
pedidos.AG = ped('501', 'Itu', 'entrega', { agendado: true, dataAgendada: amanha(), horaEntrega: '09:00', horaFim: '11:00' });

const opcoes = (p) => p.evaluate(() => [...document.querySelectorAll('#rot-cidade-d option')]
  .map((o) => ({ v: o.value, t: o.textContent, sel: o.selected })));
const nota = (p) => p.evaluate(() => document.getElementById('rot-cidade-nota').textContent.replace(/\s+/g, ' ').trim());
const quantos = (p) => p.evaluate(() => window.__viagem().length);

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 1000, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'a@t.com', getIdToken: async () => 'T' }, db: sd };
  }, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: pedidos }));
  await ctx.route(/nominatim|viacep|railway\.app/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await p.waitForTimeout(900);
  await p.evaluate(() => { window.__viagem = () => window.__pedidosDaViagem ? window.__pedidosDaViagem() : []; });

  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(300);

  // ── 1. a lista de cidades ────────────────────────────────────────────────
  const op = await opcoes(p);
  ok(op.length === 4, `lista traz "todas" mais as 3 cidades com pedido do dia → ${op.length}`);
  ok(op[0].v === 'todas' && /\(21\)/.test(op[0].t),
    `"Todas as cidades" conta os 21 que entram hoje (o agendado de amanhã fica de fora) → ${op[0].t}`);
  ok(/Guarulhos \(12\)/.test(op[1].t), `a cidade com mais pedidos vem primeiro → ${op[1].t}`);
  ok(/Santos \(6\)/.test(op[2].t), `Santos soma as 5 entregas e a coleta → ${op[2].t}`);
  ok(!op.some((o) => /Itu/.test(o.t)), 'cidade só com pedido agendado para outro dia não aparece');
  ok(/21 pedidos entram neste cálculo, de 3 cidades/.test(await nota(p)), 'a nota diz quantos entram → ' + await nota(p));

  // ── 2. escolher a cidade corta o que entra no cálculo ───────────────────
  ok(await quantos(p) === 21, 'sem escolher cidade, entram todos os 21');
  await p.selectOption('#rot-cidade-d', 'Santos');
  await p.waitForTimeout(250);
  ok(await quantos(p) === 6, `escolhendo Santos entram 6 → ${await quantos(p)}`);
  ok(/Só os 6 pedidos de Santos/.test(await nota(p)), 'a nota explica o recorte → ' + await nota(p));

  // ── 3. o tipo e a cidade se combinam ────────────────────────────────────
  await p.click('#rot-tipo button[data-v="coleta"]');
  await p.waitForTimeout(250);
  ok(await quantos(p) === 1, `Santos + só coletas = 1 pedido → ${await quantos(p)}`);
  const so = await opcoes(p);
  ok(so.length === 2 && /Santos \(1\)/.test(so[1].t), 'a lista passa a contar só as coletas → ' + JSON.stringify(so.map((x) => x.t)));

  // ── 4. a cidade escolhida sobrevive à troca de tipo, ou volta para todas ─
  await p.click('#rot-tipo button[data-v="entrega"]');
  await p.waitForTimeout(250);
  ok(await quantos(p) === 5, `Santos continua escolhida ao voltar para entregas: 5 → ${await quantos(p)}`);
  await p.selectOption('#rot-cidade-d', 'Arujá');
  await p.waitForTimeout(200);
  await p.click('#rot-tipo button[data-v="coleta"]');
  await p.waitForTimeout(250);
  const voltou = await p.evaluate(() => document.getElementById('rot-cidade-d').value);
  ok(voltou === 'todas', `Arujá não tem coleta: a escolha volta para "todas" em vez de zerar a viagem → ${voltou}`);
  ok(await quantos(p) === 1, `e a viagem fica com a única coleta → ${await quantos(p)}`);
  await p.click('#rot-tipo button[data-v="entrega"]');
  await p.waitForTimeout(250);

  // ── 5. a tela de confirmar repete a cidade ──────────────────────────────
  await p.selectOption('#rot-cidade-d', 'Arujá');
  await p.waitForTimeout(200);
  await p.fill('#cap-kg-d', '2000');
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(300);
  const conf = await p.evaluate(() => document.getElementById('confirm-details-d').textContent.replace(/\s+/g, ' '));
  ok(/Só de: Arujá/.test(conf), 'a confirmação diz de qual cidade é a viagem → ' + conf.slice(0, 90));
  ok(/3 entregas pendentes/.test(conf), 'e conta só os pedidos daquela cidade → ' + conf.slice(0, 120));

  ok(errs.length === 0, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
