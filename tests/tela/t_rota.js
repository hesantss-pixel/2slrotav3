// Roteirização e chat: chamadas ao servidor levam o login; a prévia é salva; confirmar despacha
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA ') + m);
(async () => {
  const b = await chromium.launch();
  const ped = { '2001': { cidade: 'Barueri', peso: 120, status: 'pendente', lat: -23.51, lng: -46.87 }, '2002': { cidade: 'Osasco', peso: 80, status: 'pendente', lat: -23.53, lng: -46.79 }, '2003': { cidade: 'Barueri', peso: 60, status: 'pendente', lat: -23.50, lng: -46.88 } };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' }, db: sd };
  }, false, seedEmpresa({ config: { deposito: { nome: 'CD Barueri', lat: -23.511, lng: -46.876 } }, pedidos_rota: ped }));
  let solveReq = null, chatReq = null;
  await ctx.route(/railway\.app\/solve/, async (r) => {
    solveReq = { headers: r.request().headers(), body: JSON.parse(r.request().postData()) };
    const pedidos = solveReq.body.pedidos;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos, km: 18.4, mins: 52, coords: [] }], nao_alocados: [], fonte_distancia: 'OSRM', solver_status: 'ok', analise_ia: 'ok', salvo: false }) });
  });
  await ctx.route(/railway\.app\/chat/, async (r) => {
    chatReq = { headers: r.request().headers(), body: JSON.parse(r.request().postData()) };
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ resposta: 'Barueri concentra 2 pedidos.', session_id: 's1' }) });
  });
  await p.waitForTimeout(600);
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
  await p.click('.veh-card >> nth=0'); await p.waitForTimeout(200);
  await p.fill('#cap-kg-d', '650'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  ok((await p.textContent('#confirm-details-d')).includes('CD Barueri'), 'confirmação mostra o CD da conta (config/deposito)');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  ok(solveReq && solveReq.headers['authorization'] === 'Bearer TOKEN-ANA', '/solve vai com o login (Authorization: Bearer …)');
  ok(solveReq && solveReq.body.deposito && solveReq.body.deposito.nome === 'CD Barueri' && Math.abs(solveReq.body.deposito.lat + 23.511) < 1e-6, '/solve leva o centro de distribuição da conta');
  ok(solveReq && solveReq.body.pedidos.length === 3, '/solve leva os 3 pedidos pendentes');
  ok(await p.isVisible('#btn-confirmar-rota'), 'resultado aparece com o botão de confirmar saída');
  const rotas = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas);
  ok(rotas && Object.keys(rotas).length === 1 && Object.values(rotas)[0].rotas[0].pedidos.length === 3, 'servidor sem chave: a tela salva a prévia em rotas/');
  await p.screenshot({ path: 'rota-1440.png' });
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1400);
  ok(await p.isVisible('#page-rotas') && (await p.textContent('#rotas-confirmadas-lista')).length > 20, 'depois de confirmar abre a página Rotas com a rota');
  const st = await p.evaluate(() => Object.values(window.__FAKE.db.empresas.emp1.pedidos_rota).map((x) => x.status));
  const conf = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas);
  ok(st.every((x) => x === 'despachado') && conf && Object.keys(conf).length === 1, 'confirmar saída: pedidos viram "despachado" e a rota vai para o histórico');
  await p.evaluate(() => window.irParaPagina('ia')); await p.waitForTimeout(200);
  await p.fill('#chat-inp', 'Onde tem mais pedido?'); await p.press('#chat-inp', 'Enter'); await p.waitForTimeout(600);
  ok(chatReq && chatReq.headers['authorization'] === 'Bearer TOKEN-ANA' && Array.isArray(chatReq.body.pedidos), '/chat vai com o login e com os pedidos');
  ok((await p.textContent('#chat-msgs')).includes('Barueri concentra 2 pedidos.'), 'resposta da IA aparece no chat');
  // servidor recusando o login → mensagem clara
  await ctx.unroute(/railway\.app\/chat/);
  await ctx.route(/railway\.app\/chat/, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"x"}' }));
  await p.fill('#chat-inp', 'teste'); await p.press('#chat-inp', 'Enter'); await p.waitForTimeout(500);
  ok((await p.textContent('#chat-msgs')).includes('sessão expirou'), 'login recusado pelo servidor: avisa para sair e entrar de novo');
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
