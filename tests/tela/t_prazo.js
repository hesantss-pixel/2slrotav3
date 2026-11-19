// Teste de 3 dias com o sistema inteiro: acesso completo passa a aceitar prazo.
// Antes, prazo só existia para a conta de demonstração — e demonstração não cria link
// real de motorista nem mede km por GPS. Para um teste de verdade o cliente precisa do
// acesso completo, e o acesso completo precisa vencer sozinho (17/11/2026).
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const DIA = 864e5;

async function entrar(b, acesso, demos) {
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (arg) => {
    window.__FAKE = {
      user: { uid: 'uid-cliente', email: 'cliente@transportadora.com.br', getIdToken: async () => 'T' },
      db: { acesso: { 'uid-cliente': arg.acesso }, membros: { 'uid-cliente': 'emp1' },
            ...(arg.demos ? { demos: { 'uid-cliente': arg.demos } } : {}),
            empresas: { emp1: { info: { nome: 'Transportadora Teste' } } } },
    };
  }, false, { acesso, demos });
  await p.waitForTimeout(900);
  return { ctx, p, errs };
}
const estado = async (p) => ({
  dentro: await p.isVisible('.sidebar'),
  barrado: await p.isVisible('#pending-screen'),
  titulo: (await p.textContent('#pend-tit').catch(() => '')) || '',
});

(async () => {
  const b = await chromium.launch();

  // ── 1. teste de 3 dias, dentro do prazo ──────────────────────────────────
  {
    const { ctx, p, errs } = await entrar(b, true, { criado: Date.now(), expira: Date.now() + 3 * DIA, tipo: 'teste' });
    const e = await estado(p);
    ok(e.dentro && !e.barrado, 'acesso completo com prazo em dia: entra no sistema inteiro');
    const demo = await p.evaluate(() => !document.getElementById('faixa-demo').hidden);
    ok(!demo, 'e não é demonstração: sem faixa de dados fictícios, então link de motorista e km por GPS valem');
    // 19/11: o prazo vence com a aba aberta → ao voltar para a aba, o sistema fecha
    await p.evaluate(() => { window.__FAKE.db.demos['uid-cliente'].expira = Date.now() - 1000; document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(500);
    const e2 = await estado(p);
    ok(!e2.dentro && e2.barrado && /terminou/.test(e2.titulo), 'prazo venceu com a aba aberta: ao voltar para a aba, mostra que o teste terminou → ' + e2.titulo);
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ── 2. prazo vencido ─────────────────────────────────────────────────────
  {
    const { ctx, p } = await entrar(b, true, { criado: Date.now() - 10 * DIA, expira: Date.now() - DIA, tipo: 'teste' });
    const e = await estado(p);
    ok(!e.dentro && e.barrado, 'prazo vencido: o sistema não abre');
    ok(/teste terminou/i.test(e.titulo), 'e a tela fala em teste, não em demonstração: ' + e.titulo);
    await p.screenshot({ path: 'prazo-vencido-1440.png' });
    await ctx.close();
  }

  // ── 3. cliente pagante: sem registro de prazo, não vence ─────────────────
  {
    const { ctx, p } = await entrar(b, true, null);
    const e = await estado(p);
    ok(e.dentro && !e.barrado, 'acesso completo sem prazo gravado continua entrando (cliente pagante)');
    await ctx.close();
  }

  // ── 4. prazo zerado pelo "tirar prazo" ───────────────────────────────────
  {
    const { ctx, p } = await entrar(b, true, { criado: Date.now() - 10 * DIA, expira: null, cliente: 'emp1' });
    const e = await estado(p);
    ok(e.dentro && !e.barrado, 'quem virou cliente não herda o vencimento da demonstração');
    await ctx.close();
  }

  // ── 5. demonstração continua vencendo como antes ─────────────────────────
  {
    const { ctx, p } = await entrar(b, 'demo', { criado: Date.now() - 10 * DIA, expira: Date.now() - DIA });
    const e = await estado(p);
    ok(!e.dentro && e.barrado, 'demonstração vencida continua barrada');
    await ctx.close();
  }
  {
    const { ctx, p } = await entrar(b, 'demo', { criado: Date.now(), expira: Date.now() + 7 * DIA });
    const e = await estado(p);
    const demo = await p.evaluate(() => document.getElementById('kpi-pedidos').textContent.trim() === '86');
    ok(e.dentro && demo, 'demonstração no prazo entra, com os 86 pedidos de exemplo');
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
