// O mapa esconde duas coisas sem dizer: pedido sem endereço exato vira bolha de cidade
// em vez de pino, e agendado para outro dia some até o dia. Com poucas coletas, e todas
// sem número na rua, o mapa fica só com os pinos verdes das entregas e parece que a
// coleta sumiu do sistema (17/11/2026). Agora o mapa presta contas do que não mostra.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const amanha = () => { const d = new Date(Date.now() + 864e5); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ped = (nf, tipo, geo, extra = {}) => ({ id: (tipo === 'coleta' ? 'C_' : '') + nf, nf, tipo,
  cidade: 'Guarulhos', uf: 'SP', dest: 'Cliente ' + nf, endereco: 'Rua ' + nf, bairro: 'Centro',
  cep: '07010000', peso: 100, itens: 1, status: 'pendente',
  ...(geo ? { geoStatus: 'ok', geoPrec: 'numero', lat: -23.45 + Math.random() * 0.04, lng: -46.53 + Math.random() * 0.04 }
          : { geoStatus: 'cidade', lat: -23.4628, lng: -46.5333 }), ...extra });

const conta = (p) => p.evaluate(() => { const e = document.getElementById('mapa-conta');
  return e ? { txt: e.textContent.replace(/\s+/g, ' ').trim(), visivel: e.style.display !== 'none' } : null; });
const pinos = (p) => p.evaluate(() => {
  const el = document.getElementById('mapa-completo'); if (!el) return { verdes: -1, azuis: -1 };
  const f = [...el.querySelectorAll('path.leaflet-interactive')].map(x => x.getAttribute('fill'));
  return { verdes: f.filter(c => c === '#16a36a').length, azuis: f.filter(c => c === '#0d1b2e').length };
});

async function abrir(b, pedidos) {
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'a@t.com', getIdToken: async () => 'T' }, db: sd };
  }, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: pedidos }));
  await p.waitForTimeout(800);
  await p.evaluate(() => window.irParaPagina('mapa'));
  await p.waitForTimeout(1200);
  return { ctx, p, errs };
}

(async () => {
  const b = await chromium.launch();

  // ── 1. coletas sem endereço exato: o mapa explica por que não há pino ─────
  {
    const { ctx, p, errs } = await abrir(b, {
      e1: ped('1001', 'entrega', true), e2: ped('1002', 'entrega', true), e3: ped('1003', 'entrega', true),
      c1: ped('2001', 'coleta', false), c2: ped('2002', 'coleta', false),
    });
    const m = await pinos(p);
    ok(m.verdes === 3 && m.azuis === 0, `3 entregas viram pino, as 2 coletas não (verdes ${m.verdes}, azuis ${m.azuis})`);
    const c = await conta(p);
    ok(c && c.visivel, 'a linha de prestação de contas aparece embaixo do mapa');
    ok(/3 pedidos têm pino próprio/.test(c.txt), 'diz quantos têm pino: ' + c.txt);
    ok(/2 pedidos estão sem endereço exato/.test(c.txt), 'e quantos estão sem endereço exato');
    ok(/\(2 coletas\)/.test(c.txt), 'e diz que são as COLETAS que ficaram de fora — era isso que faltava');
    ok(/bolha da cidade/.test(c.txt) && /corrigir/.test(c.txt), 'e diz onde elas estão e como resolver');
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await p.screenshot({ path: 'mapa-coletas-sem-ponto.png' });
    await ctx.close();
  }

  // ── 2. filtrando por Coletas, o mapa fica vazio mas explicado ────────────
  {
    const { ctx, p } = await abrir(b, {
      e1: ped('1001', 'entrega', true), c1: ped('2001', 'coleta', false), c2: ped('2002', 'coleta', false),
    });
    await p.click('#page-mapa [data-filtro] button[data-v="coleta"]');
    await p.waitForTimeout(700);
    const m = await pinos(p), c = await conta(p);
    ok(m.verdes === 0 && m.azuis === 0, 'filtro Coletas: nenhum pino no mapa');
    ok(c.visivel && /0 pedidos têm pino próprio/.test(c.txt) && /2 pedidos estão sem endereço exato/.test(c.txt),
      'e a tela diz exatamente isso em vez de deixar o mapa mudo: ' + c.txt);
    ok(!/\(2 coletas\)/.test(c.txt), 'com o filtro em Coletas não repete "coletas" (já está no filtro)');
    await ctx.close();
  }

  // ── 3. coleta agendada para outro dia ────────────────────────────────────
  {
    const { ctx, p } = await abrir(b, {
      e1: ped('1001', 'entrega', true),
      c1: ped('2001', 'coleta', true, { agendado: true, dataAgendada: amanha() }),
    });
    const m = await pinos(p), c = await conta(p);
    ok(m.verdes === 1 && m.azuis === 0, 'a coleta de amanhã não entra no mapa de hoje');
    ok(c.visivel && /1 está agendado para outro dia/.test(c.txt) && /\(1 coleta\)/.test(c.txt),
      'e o mapa avisa que ela existe e volta no dia: ' + c.txt);
    await ctx.close();
  }

  // ── 4. tudo com endereço exato: nada a explicar, linha some ─────────────
  {
    const { ctx, p } = await abrir(b, {
      e1: ped('1001', 'entrega', true), c1: ped('2001', 'coleta', true), c2: ped('2002', 'coleta', true),
    });
    const m = await pinos(p), c = await conta(p);
    ok(m.verdes === 1 && m.azuis === 2, 'coleta com endereço exato vira pino azul-marinho (verdes 1, azuis 2)');
    ok(!c.visivel, 'e sem nada escondido a linha não polui a tela');
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
