const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA ') + m);
(async () => {
  const b = await chromium.launch();
  const seed = seedEmpresa({ pedidos_rota: { '4001': { cidade: 'Barueri', peso: 100, status: 'pendente', lat: -23.51, lng: -46.87 } } });
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 't' }, db: sd }; }, false, seed);
  await p.waitForTimeout(600);
  // Pedidos + importação CSV
  await p.click('.sb-item[data-page="pedidos"]'); await p.waitForTimeout(300);
  await p.setInputFiles('#file-input', 'notas.csv'); await p.waitForTimeout(1200);
  const db = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);
  const cid = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, v.cidade]));
  ok(cid['5001'] === 'Barueri' && cid['5002'] === 'Itupeva' && cid['5003'] === 'São Paulo', 'importar CSV grava os pedidos com a cidade certa: ' + JSON.stringify(cid));
  ok(Math.abs(db['5001'].peso - 120.5) < 0.01, 'peso com vírgula (120,5) entra certo');
  const cards = await p.$$eval('.rc-card-name', (e) => e.map((x) => x.textContent));
  ok(cards.includes('Barueri') && cards.includes('Itupeva') && cards.includes('São Paulo'), 'página Pedidos agrupa pelas cidades dos pedidos: ' + cards.join(', '));
  await p.screenshot({ path: 'pg-pedidos.png' });
  // Motoristas
  await p.click('.sb-item[data-page="motoristas"]'); await p.waitForTimeout(300);
  await p.click('text=+ Adicionar Motorista'); await p.fill('#mot-nome', 'João Teste');
  await p.click('#mot-veh-grid .veh-card >> nth=0'); await p.fill('#mot-cap-kg', '650');
  await p.click('text=Salvar Motorista'); await p.waitForTimeout(500);
  const mots = await p.evaluate(() => window.__FAKE.db.empresas.emp1.motoristas);
  ok(mots && Object.values(mots).some((m) => m.nome === 'João Teste'), 'cadastrar motorista grava em motoristas/');
  await p.screenshot({ path: 'pg-motoristas.png' });
  // Mapa e Rotas e IA abrem sem erro
  for (const pg of ['mapa', 'rotas', 'ia', 'dashboard']) { await p.click(`.sb-item[data-page="${pg}"]`); await p.waitForTimeout(400); ok(await p.isVisible('#page-' + pg), `página ${pg} abre`); if (pg !== 'dashboard') await p.screenshot({ path: `pg-${pg}.png` }); }
  // Agendar entrega
  await p.click('text=+ Agendar'); await p.fill('#ag-search-inp-d', '5002'); await p.waitForTimeout(200);
  await p.click('#ag-search-results-d .search-item >> nth=0'); await p.fill('#ag-data-d', '2026-10-30'); await p.fill('#ag-hora-d', '14:00');
  await p.click('text=Salvar Agendamento'); await p.waitForTimeout(500);
  const ag = await p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota['5002']);
  ok(ag.agendado === true && ag.dataAgendada === '2026-10-30', 'agendar entrega grava data e hora no pedido');
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
