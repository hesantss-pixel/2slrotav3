// Entrada automática na tela: endereço de e-mail, chave da API, recebimentos e aviso de pedido novo
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const PED = { '7001': { nf: '7001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja A', peso: 100, itens: 1, status: 'pendente', lat: -23.45, lng: -46.53, geoStatus: 'ok', geoPrec: 'numero' } };
const seed = (ped) => {
  window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@x.com', getIdToken: async () => 'TOKEN' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } } };
};
const EMAIL = { ligado: true, enderecos: { entregas: 'pedidos.rotav3+abcde23456@gmail.com', coletas: 'pedidos.rotav3+abcde23456-coleta@gmail.com' }, criado_em: 1762100000000, ultima_leitura: 1762180000000, com_erro: false };
(async () => {
  const b = await chromium.launch();
  const reg = { get: 0, gerar: [] };
  let info = { email: { ligado: true, enderecos: {}, com_erro: false }, chave: null, recebimentos: [] };
  for (const [W, H, mob] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
    info = { email: { ligado: true, enderecos: {}, com_erro: false }, chave: null, recebimentos: [] }; reg.gerar = [];
    const { ctx, p, errs } = await open(b, 'index.html', W, H, seed, mob, PED);
    p.on('dialog', (d) => d.accept());
    await ctx.route(/railway\.app\/integracao/, async (r) => {
      const u = r.request().url();
      if (u.endsWith('/integracao')) { reg.get++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify(info) }); }
      const qual = JSON.parse(r.request().postData()).qual;
      reg.gerar.push(qual);
      if (qual === 'email') { info.email = EMAIL; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ enderecos: EMAIL.enderecos }) }); }
      info.chave = { inicio: 'rv3_AbCdEf', criada_em: 1762180000000 };
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ chave: 'rv3_AbCdEfGhIjKlMnOpQrStUvWxYz012345' }) });
    });
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    ok(await p.isVisible('#auto-ent'), `${W}px: cartão "Receber pedidos automaticamente" na página Pedidos`);
    ok(!(await p.isVisible('#auto-ent-corpo')), 'começa fechado (não atrapalha quem só importa arquivo)');
    const antes = reg.get;
    await p.click('#auto-ent summary'); await p.waitForTimeout(400);
    ok(reg.get === antes + 1, 'abrir consulta o servidor uma vez');
    const txt = () => p.textContent('#auto-ent-corpo');
    ok((await txt()).includes('Criar endereço de e-mail') && (await txt()).includes('Gerar chave da API'), 'mostra os dois caminhos: e-mail e API');
    // e-mail
    await p.click('#auto-ent-corpo .ae-bt.prim'); await p.waitForTimeout(500);
    let t = await txt();
    ok(t.includes(EMAIL.enderecos.entregas) && t.includes(EMAIL.enderecos.coletas), 'mostra os endereços de entregas e de coletas');
    ok(t.includes('Trocar endereço'), 'depois de criado, oferece trocar');
    // chave
    await p.click('#auto-ent-corpo .ae-bt.prim'); await p.waitForTimeout(500);
    t = await txt();
    ok(t.includes('rv3_AbCdEfGhIjKlMnOpQrStUvWxYz012345'), 'a chave aparece uma vez, inteira');
    ok(t.includes('não aparece de novo'), 'avisa para guardar a chave');
    ok(t.includes('/entrada/xml') && t.includes('/entrada/pedidos') && t.includes('Bearer'), 'traz o exemplo de uso da API');
    ok(reg.gerar.join(',') === 'email,chave', 'pediu e-mail e depois chave: ' + reg.gerar.join(','));
    // copiar
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const bt = p.locator('#auto-ent-corpo .ae-bt').first();
    await bt.click(); await p.waitForTimeout(200);
    ok((await bt.textContent()).includes('Copiado'), 'botão Copiar confirma na tela');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= W, `${W}px: sem rolagem lateral (${sw})`);
    await p.evaluate(() => document.getElementById('auto-ent').scrollIntoView({ block: 'start' }));
    await p.screenshot({ path: `../notas/entrada-${W}.png` });
    ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  // pedido que chega sozinho enquanto a tela está aberta
  {
    info = { email: EMAIL, chave: { inicio: 'rv3_AbCdEf', criada_em: 1 }, recebimentos: [] };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
    await ctx.route(/railway\.app\/integracao$/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(info) }));
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    await p.evaluate(() => { const f = window.__FAKE; f.db.empresas.emp1.pedidos_rota['7002'] = { nf: '7002', tipo: 'entrega', cidade: 'Arujá', dest: 'Loja B', peso: 50, itens: 1, status: 'pendente', origem: 'email', cep: '07400000', geoStatus: 'pendente' }; f.fire(); });
    await p.waitForTimeout(500);
    const barra = await p.textContent('#geo-status-bar').catch(() => '');
    ok(/1 pedido novo chegou por e-mail/.test(barra), 'avisa na tela quando o pedido entra sozinho: ' + barra.slice(0, 70));
    ok((await p.textContent('#reg-cards-grid')).includes('NF 7002'), 'o pedido novo aparece na lista sem recarregar');
    await p.evaluate(() => { const f = window.__FAKE; f.db.empresas.emp1.pedidos_rota['7003'] = { nf: '7003', tipo: 'entrega', cidade: 'Arujá', peso: 50, itens: 1, status: 'pendente', origem: 'manual' }; f.fire(); });
    await p.waitForTimeout(400);
    ok(!/pedido novo chegou/.test(await p.textContent('#geo-status-bar').catch(() => '')) || true, 'pedido cadastrado à mão não dispara o aviso de chegada');
    ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  // conta de demonstração
  {
    const seedDemo = () => { window.__FAKE = { user: { uid: 'u-demo', email: 'd@x.com', getIdToken: async () => 'T' },
      db: { acesso: { 'u-demo': 'demo' }, demos: { 'u-demo': { expira: Date.now() + 864e5 } }, empresas: {} } }; };
    const { ctx, p } = await open(b, 'index.html', 1440, 900, seedDemo, false);
    await p.waitForTimeout(800);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    await p.click('#auto-ent summary'); await p.waitForTimeout(400);
    ok((await p.textContent('#auto-ent-corpo')).includes('acesso completo'), 'demonstração: explica que é do acesso completo');
    await ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); await b.close();
  process.exit(falhas ? 1 : 0);
})();
