// Página Acessos: o administrador precisa ver se a pessoa da demonstração chegou a entrar.
// A tela grava usuarios/<uid>/visto a cada login; aqui conferimos que isso aparece.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const ADMIN = 'PGblgW7V26SJ6W8UYPFj3dqlDGm2';
const seed = () => {
  const dia = 86400e3, agora = Date.now();
  window.__FAKE = {
  user: { uid: 'PGblgW7V26SJ6W8UYPFj3dqlDGm2', email: 'henrique@rotav3.com.br', getIdToken: async () => 'T' },
  db: {
    acesso: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: true, d1: 'demo', d2: 'demo', d3: 'demo', c1: true },
    membros: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: 'principal', c1: 'emp9' },
    empresas: { principal: { info: { nome: 'ROTAV3' } }, emp9: { info: { nome: 'Via Verde' } } },
    demos: {
      d1: { email: 'quenuncaentrou@transp.com.br', nome: 'Nunca Entrou', criado: agora - 5 * dia, expira: agora + 10 * dia },
      d2: { email: 'entrouontem@transp.com.br', nome: 'Entrou Ontem', criado: agora - 3 * dia, expira: agora + 12 * dia },
      d3: { email: 'sumiu@transp.com.br', nome: 'Sumiu', criado: agora - 40 * dia, expira: agora - 10 * dia } },
    usuarios: {
      // d1 de propósito ausente: conta criada e ninguém entrou
      d2: { email: 'entrouontem@transp.com.br', visto: agora - 1 * dia },
      d3: { email: 'sumiu@transp.com.br', visto: agora - 30 * dia },
      c1: { email: 'cliente@viaverde.com.br', visto: agora - 2 * 3600e3 } } } }; };

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 960, seed, false);
  await p.waitForTimeout(1000);
  await p.evaluate(() => window.irParaPagina('acessos'));
  await p.waitForTimeout(1200);

  const linhas = await p.evaluate(() => [...document.querySelectorAll('#ac-demos .ac-row')]
    .map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
  const nunca = linhas.find((t) => t.includes('Nunca Entrou')) || '';
  const ontem = linhas.find((t) => t.includes('Entrou Ontem')) || '';
  const sumiu = linhas.find((t) => t.includes('Sumiu')) || '';
  ok(linhas.length === 3, 'as três demonstrações aparecem (' + linhas.length + ')');
  ok(nunca.includes('nunca entrou'), 'demo sem registro de login é marcada como "nunca entrou": ' + nunca.slice(0, 110));
  ok(/entrou há 1 dia/.test(ontem), 'demo que entrou ontem mostra quando foi: ' + ontem.slice(0, 110));
  ok(/entrou há 30 dia/.test(sumiu), 'demo antiga mostra o último acesso: ' + sumiu.slice(0, 110));
  ok(!ontem.includes('nunca entrou') && !sumiu.includes('nunca entrou'), 'quem entrou não é marcado como "nunca entrou"');

  const alerta = await p.evaluate(() => {
    const r = [...document.querySelectorAll('#ac-demos .ac-row')].find((x) => x.textContent.includes('Nunca Entrou'));
    const t = r && r.querySelector('.ac-tag.alerta');
    return t ? getComputedStyle(t).color : null; });
  ok(alerta && alerta !== 'rgb(100, 116, 139)', 'o aviso "nunca entrou" tem destaque próprio: ' + alerta);

  const comp = await p.evaluate(() => (document.getElementById('ac-completos') || {}).textContent || '');
  ok(comp.includes('você') && !/você.*nunca entrou/s.test(comp), 'a linha do próprio administrador não cobra acesso dele mesmo');
  ok(/entrou há 2 h/.test(comp), 'cliente com acesso completo mostra o último acesso: ' + comp.replace(/\s+/g, ' ').slice(0, 140));

  ok(!errs.length, 'sem erros no console ' + JSON.stringify(errs.slice(0, 2)));
  await ctx.close();
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
