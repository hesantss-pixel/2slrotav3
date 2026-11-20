// Leitura da "Ordem de Coleta de Cargas" em PDF — 20/11/2026.
//
// É o documento que a transportadora emite para cada coleta (não é DANFE):
// "RÓTULO: valor" na mesma linha e duas vias da mesma ordem por página.
// O sistema lê o número da ordem, o remetente (onde se coleta), endereço,
// bairro, CEP, cidade/UF, a quantidade de volumes e o peso, e o pedido entra
// sempre como coleta, com os volumes preenchidos sozinhos.
//
// Dados fictícios (pdf/gerar_ordem_coleta.py): o repositório é público.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const pags = JSON.parse(fs.readFileSync(path.join(__dirname, 'pdf', 'ordem-coleta-exemplo.json'), 'utf8'));

(async () => {
  const b = await chromium.launch();
  const { p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'a@t.com', getIdToken: async () => 'T' }, db: sd };
  }, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: {} }));
  await p.waitForTimeout(800);

  const ler = (itens) => p.evaluate((it) => {
    const l = window.__danfe.linhas(it);
    const c = window.__danfe.ordem(l);
    return { eh: window.__danfe.ehOrdem(l), campos: c, pedido: window.__danfe.pedido(c, 'coleta') };
  }, itens);

  // ── 1. campos da ordem ──────────────────────────────────────────────────
  {
    const { eh, campos: c, pedido: o } = await ler(pags[0]);
    ok(eh, 'reconhece a Ordem de Coleta de Cargas');
    ok(c.ordem === 'SP3 000101', 'lê o número da ordem');
    ok(c.nome === 'TRANSPORTES EXEMPLO ALFA LTDA', 'lê o remetente sem o contato');
    ok(c.endereco === 'RUA DAS FLORES 120', 'lê o endereço');
    ok(c.bairro === 'CENTRO', 'lê o bairro sem a cidade da mesma linha');
    ok(c.cep === '07010000', 'lê o CEP');
    ok(c.cidade === 'GUARULHOS' && c.uf === 'SP', 'lê a cidade e a UF do remetente, não a do destinatário');
    ok(c.volumes === 12, 'lê a quantidade de volumes');
    ok(c.peso === 1250.5, 'lê o peso com milhar e decimal');
    ok(c.nf === '4521', 'lê a nota fiscal quando vem');
    ok(o && o.tipo === 'coleta' && o.itens === 12 && o.peso === 1250.5, 'o pedido sai com os volumes e o peso');
    ok(o && o.cep === '07010000' && o.geoStatus === 'pendente', 'o pedido vai para o mapa pelo CEP');
    ok(o && o.ordemColeta === 'SP3 000101', 'o pedido guarda o número da ordem');
  }

  // ── 2. ordem sem nota fiscal e com "CONTATO:NOME" grudado ───────────────
  {
    const { campos: c, pedido: o } = await ler(pags[1]);
    ok(c.nome === 'INDUSTRIA EXEMPLO GAMA SA', 'remetente certo com o contato grudado no rótulo');
    ok(c.endereco === 'AV PAULISTA 1000 SALA 5' && c.cidade === 'SAO PAULO', 'endereço e cidade da 2ª ordem');
    ok(c.volumes === 3 && c.peso === 80, 'volumes e peso da 2ª ordem');
    ok(c.nf === '', 'sem nota fiscal, o campo fica vazio');
    ok(o && o.nf === 'OC SP3 000102', 'sem nota, o pedido usa o número da ordem');
  }

  // ── 3. importação pela tela: 2 vias por página viram 1 pedido cada ──────
  p.on('dialog', (d) => d.accept());
  await p.evaluate((pags) => {
    window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: pags.length,
      getPage: async (n) => ({ getTextContent: async () => ({ items: pags[n - 1].map((i) => ({ str: i.s, transform: [1, 0, 0, 1, i.x, i.y], height: i.h })) }) }) }) }) };
  }, pags);
  await p.setInputFiles('#file-input', { name: 'ordens.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const o = Object.values(window.__FAKE.db.empresas.emp1.pedidos_rota || {});
    return { n: o.length, tipos: [...new Set(o.map((x) => x.tipo))], itens: o.map((x) => x.itens).sort((a, b) => a - b),
             msg: document.getElementById('import-msg-pedidos').textContent };
  });
  ok(r.n === 2, 'cada ordem entra uma vez só (a 2ª via é ignorada)');
  ok(r.tipos.length === 1 && r.tipos[0] === 'coleta', 'entra como coleta mesmo com a importação em "entregas"');
  ok(r.itens.join(',') === '3,12', 'a quantidade de volumes entra sozinha');
  ok(/2 coletas importadas/.test(r.msg), 'a mensagem conta as coletas');

  ok(!errs.length, 'sem erro de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
