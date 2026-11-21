// Empresa de verdade sem nenhuma nota: tela vazia, nunca os pedidos fictícios (21/11/2026).
// A conta de demonstração continua começando no exemplo (coberto em t_demo).
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const sd = seedEmpresa({ config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } },
    rotas_confirmadas: { r1: { id: 'r1', status: 'confirmada', veiculo: 'VUC', paradas: [{ id: 'X1', nf: 'X1', cidade: 'Guarulhos', lat: -23.45, lng: -46.52 }], km: 10, criada_em: Date.now() } } }, 'u');
  const { p, errs } = await open(b, 'index.html', 1440, 900, (s) => { window.__FAKE = { user: { uid: 'u', email: 'a@b.c', getIdToken: async () => 't' }, db: s }; }, false, sd);
  await p.waitForTimeout(800);
  ok((await p.textContent('#kpi-pedidos')).trim() === '0', 'sem notas: o painel mostra 0 pedidos (não os 86 de exemplo)');
  ok(await p.evaluate(() => document.getElementById('hpill-demo').hidden), 'sem a etiqueta de dados de exemplo');
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  const txt = await p.textContent('#page-pedidos');
  ok(/Nenhum pedido pendente/.test(txt) && !/exemplo/i.test(txt), 'página Pedidos: "Nenhum pedido pendente", sem falar em exemplo');
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(400);
  ok(/VUC/.test(await p.textContent('#rotas-confirmadas-lista')), 'as rotas confirmadas da própria empresa continuam aparecendo (antes apareciam as de exemplo)');
  // importar: grava no banco da empresa
  const path = require('path'), fs = require('fs');
  const csv = path.join(__dirname, 'xml', 'vazio.csv');
  fs.writeFileSync(csv, 'NF;Cidade;Peso;Cliente\n5501;Guarulhos;10;Cliente A\n');
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(200);
  await p.setInputFiles('#file-input', csv); await p.waitForTimeout(900);
  fs.unlinkSync(csv);
  const ped = await p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1.pedidos_rota || {})));
  ok(ped['5501'] && ped['5501'].cidade === 'Guarulhos', 'importar grava a nota no banco da empresa');
  ok((await p.textContent('#kpi-pedidos')).trim() === '1', 'e o painel passa a mostrar 1 pedido');
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
