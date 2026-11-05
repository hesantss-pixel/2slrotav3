// Conta de demonstração, página Acessos (administrador) e localização ao vivo do motorista
const { chromium } = require('playwright');
const path = require('path');
const { open } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const ADMIN = 'PGblgW7V26SJ6W8UYPFj3dqlDGm2';
const BASE = 'http://127.0.0.1:8771/';
const usuario = (uid, email) => ({ uid, email, getIdToken: async () => 'T-' + uid });

async function paginaMotorista(b, hash, opts = {}, seed = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ...opts });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ path: path.join(__dirname, 'fakefb', f), contentType: 'text/javascript' }); });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
  await ctx.addInitScript((sd) => { window.__FAKE = { user: null, db: sd }; }, seed);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + 'motorista.html#' + hash); await p.waitForTimeout(600);
  return { ctx, p, errs };
}

(async () => {
  const b = await chromium.launch();

  // ── 1. Administrador: página Acessos ─────────────────────────────────────
  const seedAdm = {
    acesso: { [ADMIN]: true, 'uid-joao': true },
    usuarios: { 'uid-joao': { email: 'joao@empresa.com.br', visto: Date.now() - 864e5 } },
    solicitacoes: { 'uid-pedro': { email: 'pedro@transporte.com.br', em: Date.now() - 3600e3 } },
    pedidos_rota: { '9001': { nf: '9001', cidade: 'Guarulhos', peso: 50, status: 'pendente', lat: -23.45, lng: -46.53 } },
  };
  const A = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'PGblgW7V26SJ6W8UYPFj3dqlDGm2', email: 'henrique@rotav3.com.br', getIdToken: async () => 'T' }, db: sd };
  }, false, seedAdm);
  A.p.on('dialog', (d) => d.accept());
  await A.p.evaluate(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }; });
  await A.p.waitForTimeout(500);
  ok(await A.p.isVisible('#sb-acessos'), 'administrador vê "Acessos" no menu');
  await A.p.click('#sb-acessos'); await A.p.waitForTimeout(400);
  ok((await A.p.textContent('#ac-sol')).includes('pedro@transporte.com.br'), 'pedidos de acesso listados');
  ok((await A.p.textContent('#ac-completos')).includes('joao@empresa.com.br') && (await A.p.textContent('#ac-completos')).includes('você'), 'acesso completo listado (com "você")');
  await A.p.fill('#ac-nome', 'Carlos'); await A.p.fill('#ac-email', 'carlos@transp.com.br');
  await A.p.click('#ac-criar'); await A.p.waitForTimeout(600);
  let F = await A.p.evaluate(() => ({ db: window.__FAKE.db, criados: window.__FAKE.criados, user: window.__FAKE.user && window.__FAKE.user.uid }));
  const criado = (F.criados || [])[0];
  ok(criado && criado.email === 'carlos@transp.com.br' && criado.auth === 'criador-de-acessos' && /^rv3-[a-z2-9]{8}$/.test(criado.pw), 'cria o usuário numa instância separada, com senha gerada: ' + JSON.stringify(criado && [criado.email, criado.pw]));
  ok(F.user === ADMIN, 'o administrador continua conectado depois de criar o acesso');
  ok(F.db.acesso['uid-carlos'] === 'demo' && F.db.demos['uid-carlos'].nome === 'Carlos' && Math.abs(F.db.demos['uid-carlos'].expira - (Date.now() + 7 * 864e5)) < 6e4, 'acesso gravado como "demo" por 7 dias');
  const res = await A.p.textContent('#ac-resultado');
  ok(res.includes('carlos@transp.com.br') && res.includes(criado.pw), 'mostra e-mail e senha para mandar');
  await A.p.click('#ac-resultado .btn-wa'); await A.p.waitForTimeout(100);
  const msg = decodeURIComponent((await A.p.evaluate(() => window.__abertos[0] || '')).split('text=')[1] || '');
  ok(msg.includes('carlos@transp.com.br') && msg.includes(criado.pw) && msg.includes('http://127.0.0.1:8771/') && msg.includes('dados de exemplo') && msg.includes('substituem o exemplo'), 'WhatsApp abre com link do sistema, e-mail, senha e aviso de dados de exemplo');
  await A.p.screenshot({ path: 'acessos-1440.png', fullPage: true });
  await A.p.click('#ac-email'); await A.p.fill('#ac-email', 'carlos@transp.com.br'); await A.p.click('#ac-criar'); await A.p.waitForTimeout(400);
  ok((await A.p.textContent('#ac-msg')).includes('já tem cadastro'), 'e-mail repetido: aviso claro');
  await A.p.click('#ac-sol button:has-text("Liberar demonstração")'); await A.p.waitForTimeout(500);
  F = await A.p.evaluate(() => window.__FAKE.db);
  ok(F.acesso['uid-pedro'] === 'demo' && !(F.solicitacoes || {})['uid-pedro'] && F.demos['uid-pedro'].email === 'pedro@transporte.com.br', 'liberar pedido como demonstração');
  await A.p.click('#ac-demos .ac-row:has-text("carlos@transp.com.br") button:has-text("Encerrar")'); await A.p.waitForTimeout(500);
  F = await A.p.evaluate(() => window.__FAKE.db);
  ok(!F.acesso['uid-carlos'] && F.demos['uid-carlos'].expira <= Date.now(), 'encerrar demonstração tira o acesso');
  ok(!A.errs.length, 'administrador sem erros: ' + JSON.stringify(A.errs.slice(0, 3)));

  // usuário comum não vê Acessos
  const C = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-joao', email: 'joao@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; }, false, seedAdm);
  await C.p.waitForTimeout(500);
  ok(!(await C.p.isVisible('#sb-acessos')), 'usuário comum não vê "Acessos"');
  ok(!(await C.p.isVisible('#faixa-demo')), 'conta real não mostra a faixa de demonstração');

  // ── 2. Conta de demonstração ─────────────────────────────────────────────
  const seedDemo = { acesso: { 'uid-visitante': 'demo' }, demos: { 'uid-visitante': { email: 'v@x.com', criado: Date.now(), expira: Date.now() + 864e5 } }, pedidos_rota: { 'REAL1': { nf: 'REAL1', cidade: 'Guarulhos', peso: 1, status: 'pendente' } } };
  const D = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-visitante', email: 'v@x.com', getIdToken: async () => 'T-demo' }, db: sd }; }, false, seedDemo);
  D.p.on('dialog', (d) => d.accept());
  let solve = null;
  await D.ctx.route(/railway\.app\/solve/, (r) => { solve = JSON.parse(r.request().postData()); const ps = solve.pedidos.slice(0, 5).map((x, i) => ({ ...x, chegada_min: 460 + i * 25 })); r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: ps, km: 42, mins: 180 }], nao_alocados: [], fonte_distancia: 'OSRM', regra_carga: 'so_entregas', salvo: false }) }); });
  await D.p.evaluate(() => { window.__abertos = []; window.open = (u) => { window.__abertos.push(u); return null; }; });
  await D.p.waitForTimeout(600);
  ok(await D.p.isVisible('#faixa-demo') && (await D.p.textContent('#faixa-demo')).includes('dados fictícios'), 'conta de demonstração mostra a faixa "dados fictícios"');
  ok((await D.p.textContent('#kpi-pedidos')) === '86', 'entra com os pedidos fictícios (86), não com os reais');
  const lidos = await D.p.evaluate(() => window.__FAKE.listeners.map((l) => l.path));
  ok(!lidos.includes('pedidos_rota') && !lidos.includes('rotas_confirmadas'), 'não fica ouvindo os dados reais do banco: ' + JSON.stringify(lidos));
  ok(!(await D.p.isVisible('#sb-acessos')), 'demonstração não vê "Acessos"');
  await D.p.click('.sb-item[data-page="pedidos"]'); await D.p.waitForTimeout(300);
  await D.p.setInputFiles('#file-input', path.join(__dirname, 'xml', 'misto.csv')); await D.p.waitForTimeout(800);
  const escritas = await D.p.evaluate(() => window.__FAKE.writes.filter((w) => !/^(usuarios|solicitacoes)/.test(w[1])).map((w) => w[1]));
  const soDaDemo = escritas.every((p) => p.startsWith('empresas/demo_uid-visitante/'));
  ok((await D.p.textContent('#kpi-pedidos')) === '3' && soDaDemo, 'importar na demonstração substitui o exemplo (3 pedidos) e grava só na área da própria demo: ' + JSON.stringify(escritas));
  await D.p.click('.sb-item[data-page="roteirizacao"]'); await D.p.waitForTimeout(200);
  await D.p.click('#veh-grid .veh-card >> nth=1'); await D.p.fill('#cap-kg-d', '3000');
  await D.p.click('text=Continuar →'); await D.p.waitForTimeout(150); await D.p.click('text=Gerar Rota Agora'); await D.p.waitForTimeout(900);
  ok(solve && solve.pedidos.length > 0, 'demonstração gera rota pelo servidor (com os pedidos fictícios)');
  await D.p.click('#btn-confirmar-rota'); await D.p.waitForTimeout(1500);
  ok((await D.p.textContent('#rotas-confirmadas-lista')).includes('Abrir a tela do motorista'), 'rota da demonstração tem "Abrir a tela do motorista"');
  await D.p.waitForTimeout(2200);
  ok((await D.p.$$('#rotas-confirmadas-lista .veic-mk')).length === 1 && (await D.p.textContent('#rotas-confirmadas-lista')).includes('simulação'), 'veículo simulado andando no mapa da rota (avisado como simulação)');
  const nPar = (await D.p.$$('#rotas-confirmadas-lista .parada-chip')).length;
  await D.p.waitForTimeout(21000);
  ok((await D.p.textContent('#rotas-confirmadas-lista')).includes(`1 de ${nPar} paradas com baixa (simulação)`) && (await D.p.$$('#rotas-confirmadas-lista .parada-chip.ok')).length === 1, 'baixa simulada aparece quando o veículo chega na parada');
  await D.p.screenshot({ path: 'demo-rotas.png', fullPage: true });
  await D.p.click('text=Abrir a tela do motorista'); await D.p.waitForTimeout(100);
  const linkDemo = await D.p.evaluate(() => window.__abertos[0] || '');
  ok(/motorista\.html#demo=[A-Za-z0-9_-]+$/.test(linkDemo), 'link do motorista da demonstração leva a rota no próprio link');
  await D.p.click('.sb-item[data-page="mapa"]'); await D.p.waitForTimeout(500);
  ok((await D.p.$$('#mapa-completo .veic-mk')).length === 1 && (await D.p.textContent('#mapa-completo-legenda')).includes('Veículo em rota'), 'mapa mostra o veículo em rota e a legenda');
  const escritas2 = await D.p.evaluate(() => {
    const alvos = [];
    for (const [op, caminho, valor] of window.__FAKE.writes || []) {
      if (caminho) alvos.push(caminho);
      else if (op === 'update' && valor) alvos.push(...Object.keys(valor));   // update na raiz
    }
    return [...new Set(alvos)].filter((p) => !/^(usuarios|solicitacoes)/.test(p));
  });
  ok(escritas2.every((p) => p.startsWith('empresas/demo_uid-visitante/')), 'a demonstração só grava na área dela, nunca na de um cliente: ' + JSON.stringify(escritas2));
  ok(!D.errs.length, 'demonstração sem erros: ' + JSON.stringify(D.errs.slice(0, 3)));

  // tela do motorista com a rota da demonstração
  const M1 = await paginaMotorista(b, linkDemo.split('#')[1]);
  const t1 = await M1.p.textContent('#app');
  ok((await M1.p.textContent('#top-tag')) === 'DEMONSTRAÇÃO' && t1.includes('Rota de exemplo') && (await M1.p.$$('.parada')).length === nPar, 'motorista abre a rota enviada pela demonstração (' + nPar + ' paradas, aviso de exemplo)');
  ok(!(await M1.p.$('.loc')), 'na demonstração não pede localização');
  await M1.p.click('#p-0 [data-acao="feito"]'); await M1.p.fill('#p-0 input[name="recebedor"]', 'Teste'); await M1.p.click('#p-0 button[type="submit"]'); await M1.p.waitForTimeout(400);
  await M1.p.reload(); await M1.p.waitForTimeout(600);
  ok((await M1.p.textContent('#app')).includes(`1 de ${nPar}`) && (await M1.p.textContent('#app')).includes('Teste'), 'baixa da demonstração fica guardada no aparelho');
  const nada = await M1.p.evaluate(() => (window.__FAKE.writes || []).length);
  ok(nada === 0 && !M1.errs.length, 'motorista da demonstração não grava no banco e não tem erros');

  // rota de exemplo fixa (#demo), usada na página de vendas
  const M2 = await paginaMotorista(b, 'demo');
  const t2 = await M2.p.textContent('#app');
  ok((await M2.p.$$('.parada')).length === 6 && t2.includes('Fábrica de Embalagens Sul') && t2.includes('Horário 09:00–10:00'), '#demo abre a rota de exemplo de Guarulhos (6 paradas, uma coleta, um horário marcado)');
  await M2.p.screenshot({ path: 'mot-demo.png', fullPage: true });

  // ── 3. Demonstração vencida e usuário sem liberação ──────────────────────
  const E = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-velho', email: 'velho@x.com', getIdToken: async () => 'T' }, db: sd }; }, false,
    { acesso: { 'uid-velho': 'demo' }, demos: { 'uid-velho': { email: 'velho@x.com', criado: 1, expira: Date.now() - 1000 } } });
  await E.p.waitForTimeout(500);
  ok((await E.p.textContent('#pend-tit')).includes('terminou') && await E.p.isVisible('#pend-wa') && !(await E.p.isVisible('#pend-bloco')), 'demonstração vencida: aviso e botão do WhatsApp');
  const P = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-novo', email: 'novo@x.com', getIdToken: async () => 'T' }, db: sd }; }, false, {});
  await P.p.waitForTimeout(500);
  const dbP = await P.p.evaluate(() => window.__FAKE.db);
  ok(await P.p.isVisible('#pend-bloco') && dbP.solicitacoes['uid-novo'].email === 'novo@x.com' && dbP.usuarios['uid-novo'].email === 'novo@x.com', 'sem liberação: mostra o código e registra o pedido de acesso');

  // ── 4. Localização ao vivo (conta real) ─────────────────────────────────
  const tok = 'TOKENAOVIVO1234567890ab';
  const rota = { id: 'rota_1_1', token: tok, link_expira: Date.now() + 864e5, criada_em: new Date().toISOString(), veiculo: 'VUC', motorista: 'Carlos', status: 'em_rota', paradas: [{ id: '7001', nf: '7001', tipo: 'entrega', cidade: 'Guarulhos', peso: 100, lat: -23.46, lng: -46.53 }] };
  const ent = { info: { veiculo: 'VUC', data: '2026-10-24', saida: 450, deposito: { nome: 'CD' } }, paradas: [{ nf: '7001', tipo: 'entrega', dest: 'Cliente', cidade: 'Guarulhos', lat: -23.46, lng: -46.53, peso: 100, itens: 1 }], expira: Date.now() + 864e5 };
  const seedReal = { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
    empresas: { emp1: { info: { nome: 'Transportadora Exemplo' },
      config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
      pedidos_rota: { '7001': { nf: '7001', cidade: 'Guarulhos', peso: 100, status: 'despachado', rota_atual: 'rota_1_1', lat: -23.46, lng: -46.53 } },
      rotas_confirmadas: { rota_1_1: rota } } },
    entregador: { [tok]: ent } };
  // motorista liga a localização
  const M3 = await paginaMotorista(b, tok, { geolocation: { latitude: -23.4501, longitude: -46.4702 }, permissions: ['geolocation'] }, { entregador: { [tok]: ent } });
  ok((await M3.p.textContent('.loc')).includes('Desligada'), 'motorista vê "Localização ao vivo: desligada" até ligar');
  await M3.p.click('[data-acao="loc"]'); await M3.p.waitForTimeout(800);
  const pos = await M3.p.evaluate((t) => window.__FAKE.db.entregador[t].posicao, tok);
  ok(pos && Math.abs(pos.lat + 23.4501) < 1e-4 && Math.abs(pos.lng + 46.4702) < 1e-4 && typeof pos.hora === 'number' && 'precisao' in pos, 'ligou: posição enviada (lat, lng, precisão, hora)');
  ok((await M3.p.textContent('#loc-status')).includes('Ligada'), 'status mostra "Ligada · enviada às…"');
  await M3.p.reload(); await M3.p.waitForTimeout(900);
  ok((await M3.p.getAttribute('[data-acao="loc"]', 'aria-checked')) === 'true', 'ao reabrir a página, volta a compartilhar sozinho (permissão já dada)');
  await M3.p.click('[data-acao="loc"]'); await M3.p.waitForTimeout(300);
  ok((await M3.p.getAttribute('[data-acao="loc"]', 'aria-checked')) === 'false', 'desligar para de compartilhar');
  ok(!M3.errs.length, 'motorista sem erros: ' + JSON.stringify(M3.errs.slice(0, 3)));
  // escritório vê a posição
  seedReal.entregador[tok].posicao = { lat: -23.4501, lng: -46.4702, precisao: 12, hora: Date.now() - 120000 };
  const R = await open(b, 'index.html', 1440, 900, (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@x.com', getIdToken: async () => 'T' }, db: sd }; }, false, seedReal);
  await R.p.waitForTimeout(500);
  await R.p.click('.sb-item[data-page="rotas"]'); await R.p.waitForTimeout(600);
  ok((await R.p.textContent('#rotas-confirmadas-lista')).includes('Localização ao vivo: há 2 min') && (await R.p.$$('#rotas-confirmadas-lista .veic-mk')).length === 1, 'escritório vê "visto há 2 min" e o veículo no mapa da rota');
  const antes = await R.p.$eval('#rotas-confirmadas-lista .leaflet-marker-icon:has(.veic-mk)', (e) => e.style.transform);
  await R.p.evaluate((t) => { window.__FAKE.setAt('entregador/' + t + '/posicao', { lat: -23.47, lng: -46.5, precisao: 8, hora: Date.now() }); window.__FAKE.fire(); }, tok);
  await R.p.waitForTimeout(300);
  const depois = await R.p.$eval('#rotas-confirmadas-lista .leaflet-marker-icon:has(.veic-mk)', (e) => e.style.transform);
  ok(antes !== depois && (await R.p.textContent('#rotas-confirmadas-lista')).includes('Localização ao vivo: agora'), 'nova posição: o veículo se move no mapa e o texto vira "agora"');
  await R.p.click('.sb-item[data-page="mapa"]'); await R.p.waitForTimeout(500);
  ok((await R.p.$$('#mapa-completo .veic-mk')).length === 1, 'mapa geral mostra o veículo em rota');
  ok(!R.errs.length, 'escritório sem erros: ' + JSON.stringify(R.errs.slice(0, 3)));
  await b.close();
})();
