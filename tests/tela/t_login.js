// Fluxo de entrada: carregando → login → (sem acesso → tela de liberação) → sistema
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
const res = []; const ok = (c, m) => console.log((c ? 'OK   ' : 'FALHA ') + m);
(async () => {
  const b = await chromium.launch();
  // 1) sem usuário: aparece o login, sistema escondido
  let { ctx, p, errs } = await open(b, 'index.html', 1440, 900, () => { window.__FAKE = { db: {} }; });
  ok(await p.isVisible('#auth-screen') && !(await p.isVisible('.sidebar')), 'sem login: mostra a tela de entrar e esconde o sistema');
  await p.screenshot({ path: 'login-1440.png' });
  await p.click('#login-btn'); await p.waitForTimeout(150);
  ok((await p.textContent('#login-msg')).includes('Preencha'), 'enviar vazio pede e-mail e senha');
  await p.fill('#login-email', 'henrique@rotav3.com.br'); await p.fill('#login-senha', 'errada'); await p.click('#login-btn'); await p.waitForTimeout(300);
  ok((await p.textContent('#login-msg')).includes('incorretos'), 'senha errada: "E-mail ou senha incorretos."');
  await p.click('#login-reset'); await p.waitForTimeout(200);
  ok((await p.textContent('#login-msg')).includes('link para criar uma senha nova') && (await p.evaluate(() => window.__FAKE.resetSent)) === 'henrique@rotav3.com.br', 'esqueci a senha: envia o link para o e-mail digitado');
  // 2) login certo, mas sem acesso liberado → tela de liberação com o código
  await p.fill('#login-senha', 'senha123'); await p.click('#login-btn'); await p.waitForTimeout(500);
  ok(await p.isVisible('#pending-screen') && (await p.textContent('#pend-uid')) === 'uid-henrique' && !(await p.isVisible('.sidebar')), 'sem liberação: mostra o código do usuário e não abre o sistema');
  await p.screenshot({ path: 'pendente-1440.png' });
  // 3) administrador libera → "tentar de novo" entra no sistema
  await p.evaluate(() => {
    window.__FAKE.db.acesso = { 'uid-henrique': true };
    window.__FAKE.db.membros = { 'uid-henrique': 'emp1' };
    window.__FAKE.db.empresas = { emp1: { info: { nome: 'Transportadora Exemplo' } } };
  });
  await p.click('#pend-retry'); await p.waitForTimeout(900);
  ok(await p.isVisible('.sidebar') && !(await p.isVisible('#pending-screen')), 'depois de liberado: abre o sistema');
  ok((await p.textContent('#user-nome')) === 'henrique@rotav3.com.br', 'mostra o e-mail de quem entrou');
  ok((await p.textContent('#kpi-pedidos')).trim() !== '—', 'dashboard carrega os pedidos');
  ok(await p.isVisible('#hpill-demo'), 'banco vazio: aviso "Dados de demonstração" aparece');
  await p.screenshot({ path: 'dash-1440.png' });
  // 4) sair volta para o login
  const vis = await p.isVisible('#user-sair');   await p.click('#user-sair'); await p.waitForTimeout(1200);
  ok(await p.isVisible('#auth-screen'), 'sair volta para a tela de entrar');
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
  // 5) já logado e liberado, com pedidos reais → entra direto, sem aviso de demonstração
  ({ ctx, p, errs } = await open(b, 'index.html', 390, 844, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 't' }, db: sd };
  }, true, seedEmpresa({ config: { deposito: { nome: 'CD Barueri', lat: -23.511, lng: -46.876 } },
    pedidos_rota: { '1001': { cidade: 'Barueri', peso: 120, status: 'pendente', lat: -23.51, lng: -46.87 }, '1002': { cidade: 'Osasco', peso: 80, status: 'pendente', lat: -23.53, lng: -46.79 }, '1003': { cidade: 'Barueri', peso: 50, status: 'pendente', lat: -23.50, lng: -46.88 }, '1004': { cidade: 'Campinas', peso: 300, status: 'pendente', lat: -22.90, lng: -47.06 } } })));
  await p.waitForTimeout(800);
  ok(await p.isVisible('.main') && (await p.textContent('#kpi-pedidos')).trim() === '4', 'sessão salva: entra direto e mostra 4 pedidos');
  ok(!(await p.isVisible('#hpill-demo')), 'com pedidos reais não mostra aviso de demonstração');
  const regs = await p.$$eval('#reg-list .reg-name', (e) => e.map((x) => x.textContent));
  ok(regs[0] === 'Barueri' && regs.includes('Osasco') && regs.includes('Campinas'), 'regiões vêm dos próprios pedidos: ' + regs.join(', '));
  const alerts = await p.textContent('#alert-list');
  ok(/1\s*$|a mais de 70 km/.test(alerts) && alerts.includes('70 km'), 'Campinas (≈90 km do CD Barueri) entra como pedido distante');
  await p.screenshot({ path: 'dash-390.png', fullPage: true });
  ok(!errs.length, 'celular sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
  await b.close();
  console.log(res.join('\n'));
})();
