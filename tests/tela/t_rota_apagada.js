// Notas de uma rota APAGADA — 20/11/2026.
//
// "Apagar rota" deixava as notas como despachadas para sempre: não dava para excluir
// ("devolva a rota", mas a rota apagada some da lista) nem importar de novo ("já estava
// em rota e não foi alterada"). Agora a nota despachada numa rota apagada ou devolvida
// volta a valer: a importação a traz de novo como pendente e a busca deixa excluir.
// A nota numa rota que ainda existe, ou já entregue/coletada, continua travada.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const pags = JSON.parse(fs.readFileSync(path.join(__dirname, 'pdf', 'ordem-coleta-exemplo.json'), 'utf8'));

const seed = (st) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } },
        pedidos_rota: st.ped || {}, ...(st.rotas ? { rotas_confirmadas: st.rotas } : {}) } } },
  };
};
const db = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1)));
const stubPdf = (p) => p.evaluate((pags) => {
  window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: pags.length,
    getPage: async (n) => ({ getTextContent: async () => ({ items: pags[n - 1].map((i) => ({ str: i.s, transform: [1, 0, 0, 1, i.x, i.y], height: i.h })) }) }) }) }) };
}, pags);
async function abrir(b, st) {
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, st);
  p.on('dialog', (d) => d.accept());
  await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await p.waitForTimeout(700);
  await stubPdf(p);
  return { p, errs };
}
const importar = async (p) => {
  await p.setInputFiles('#file-input', { name: 'ordens.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await p.waitForTimeout(1500);
  return p.textContent('#import-msg-pedidos');
};

(async () => {
  const b = await chromium.launch();
  // 1. importa as 2 ordens (só para ter os pedidos como o sistema grava)
  let { p, errs } = await abrir(b, {});
  await importar(p);
  const ped = (await db(p)).pedidos_rota;
  const [a, c] = Object.keys(ped);
  ok(!!a && !!c, 'importou as 2 ordens');
  const todosErros = [...errs];

  // 2. uma saiu numa rota que depois foi APAGADA; a outra está numa rota ativa
  const rotas = {
    R_APAGADA: { id: 'R_APAGADA', status: 'apagada', data: '2026-11-20', paradas: [{ id: a }] },
    R_ATIVA: { id: 'R_ATIVA', status: 'confirmada', data: '2026-11-20', paradas: [{ id: c }] },
  };
  const presos = JSON.parse(JSON.stringify(ped));
  Object.assign(presos[a], { status: 'despachado', rota_atual: 'R_APAGADA', peso: 1 });
  Object.assign(presos[c], { status: 'despachado', rota_atual: 'R_ATIVA' });

  // 3. importa de novo: a da rota apagada volta como pendente; a da rota ativa fica
  ({ p, errs } = await abrir(b, { ped: presos, rotas }));
  const msg = await importar(p);
  const e = (await db(p)).pedidos_rota;
  ok(e[a].status === 'pendente' && !e[a].rota_atual, 'nota da rota APAGADA volta como pendente ao importar de novo');
  ok(e[a].peso !== 1, 'e é regravada com os dados do PDF');
  ok(e[c].status === 'despachado' && e[c].rota_atual === 'R_ATIVA', 'nota de rota que ainda existe não é mexida');
  ok(/1 nota de rota apagada voltou para os pendentes/.test(msg) && /1 nota já estava em rota/.test(msg) && !/importada/.test(msg), 'mensagem: 1 voltou da rota apagada, 1 em rota → ' + msg);
  todosErros.push(...errs);

  // 4. busca: a nota presa em rota apagada pode ser excluída; a da rota ativa não
  ({ p, errs } = await abrir(b, { ped: presos, rotas }));
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  await p.fill('#busca-notas', 'exemplo'); await p.waitForTimeout(250);
  const itens = await p.$$eval('#busca-res .busca-item', (els) => els.map((el) => ({ t: el.textContent, dis: el.querySelector('input').disabled })));
  const presa = itens.find((x) => /rota apagada/.test(x.t));
  ok(presa && !presa.dis, 'busca: a nota da rota apagada aparece como "rota apagada" e pode ser marcada');
  ok(itens.some((x) => x.dis && /devolva a rota/.test(x.t)), 'busca: a da rota ativa continua sem poder excluir');
  await p.check('#busca-res .busca-item input:not([disabled])');
  await p.click('#btn-excluir-sel'); await p.waitForTimeout(500);
  const d = (await db(p)).pedidos_rota;
  ok(!d[a] && !!d[c], 'excluir: sai a da rota apagada, fica a da rota ativa');
  todosErros.push(...errs);

  ok(!todosErros.length, 'sem erro de JavaScript' + (todosErros.length ? ': ' + todosErros.join(' | ') : ''));
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
