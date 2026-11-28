// Versão 3.11:
//  1. a rota termina na última parada (sem volta ao CD), a não ser que a pessoa marque "Voltar ao CD";
//  2. agendado para outro dia não aparece no mapa; no dia, aparece em vermelho;
//  3. o CD de cada empresa é definido pelo administrador; o cliente só vê.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const ADMIN = 'PGblgW7V26SJ6W8UYPFj3dqlDGm2';
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };

const seedCliente = (arg) => {
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoje = iso(new Date()), amanha = iso(new Date(Date.now() + 86400e3));
  const base = (nf, extra) => ({ id: nf, nf, tipo: 'entrega', cidade: 'Guarulhos', dest: 'Cliente ' + nf, peso: 100, itens: 1,
    status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', ...extra });
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: arg.cd },
        pedidos_rota: {
          2001: base('2001', { lat: -23.45, lng: -46.53, agendado: true, dataAgendada: hoje, horaEntrega: '09:00', horaFim: '11:00' }),
          2002: base('2002', { lat: -23.44, lng: -46.50, agendado: true, dataAgendada: amanha, horaEntrega: '09:00', horaFim: '11:00' }),
          2003: base('2003', { lat: -23.39, lng: -46.32 }),
          C_2004: base('2004', { id: 'C_2004', tipo: 'coleta', lat: -23.47, lng: -46.45 }),
        } } } } };
  if (arg.volta) { try { localStorage.setItem('rotav3_volta', '1'); } catch (e) {} }
};

const pathsDoMapa = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s + ' path')].map((e) => ({
  fill: e.getAttribute('fill'), stroke: e.getAttribute('stroke'), dash: !!e.getAttribute('stroke-dasharray'),
  n: (e.getAttribute('d').match(/[ML]/g) || []).length })), sel);

async function gerarRota(p) {
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '2000'); await p.fill('#cap-maxped-d', '8');
}

(async () => {
  const b = await chromium.launch();

  // ── cliente, sem volta (padrão) ──────────────────────────────────────────
  {
    const reg = { solve: [], avaliar: [], tracado: [] };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seedCliente, false, { cd: CD });
    await ctx.route(/railway\.app\/solve/, (r) => {
      const body = JSON.parse(r.request().postData()); reg.solve.push(body);
      const pedidos = body.pedidos.map((x, i) => ({ ...x, chegada_min: 430 + 20 * i }));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos, km: 20, mins: 90, volta: body.volta, tracado: null }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
    });
    await ctx.route(/railway\.app\/avaliar/, (r) => { reg.avaliar.push(JSON.parse(r.request().postData())); r.fulfill({ status: 500, body: '{}' }); });
    await ctx.route(/railway\.app\/tracado/, (r) => { reg.tracado.push(JSON.parse(r.request().postData())); r.fulfill({ contentType: 'application/json', body: '{"tracado":null}' }); });
    await p.waitForTimeout(800);

    // CD: o cliente vê, mas não troca
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
    const cdTxt = await p.evaluate(() => document.getElementById('cd-linha')?.textContent || '');
    ok(cdTxt.includes('CD Cumbica') && cdTxt.includes('fale com a ROTAV3'), 'cliente vê o CD e que a troca é com a ROTAV3: ' + cdTxt.trim());
    ok(!(await p.$('#cd-linha input')), 'cliente não tem campo para trocar o CD pelo CEP');
    ok(!(await p.evaluate(() => typeof window.definirCd)).includes('function'), 'a troca de CD pelo cliente não existe mais');

    // mapa: agendado de amanhã some; o de hoje fica vermelho
    await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(700);
    const pins = (await pathsDoMapa(p, '#mapa-completo')).filter((x) => x.fill !== '#e09c12' && !x.dash);
    ok(pins.length === 3, 'mapa mostra 3 pedidos (o agendado para amanhã fica de fora): ' + pins.length);
    ok(pins.filter((x) => x.fill === '#d64545').length === 1, 'o agendado de hoje aparece em vermelho');
    ok(pins.filter((x) => x.fill === '#0b9c6a').length === 1 && pins.filter((x) => x.fill === '#16181d').length === 1, 'os outros seguem verde (entrega) e azul (coleta)');
    const leg = await p.textContent('#mapa-completo-legenda');
    ok(leg.includes('Agendado: sai hoje (1)') && leg.includes('1 agendado para outro dia não aparece'), 'legenda explica o vermelho e o que ficou de fora: ' + leg.replace(/\s+/g, ' ').slice(0, 200));

    // roteirização sem volta
    await gerarRota(p);
    ok(!(await p.isChecked('#rot-volta-d')), '"Voltar ao CD" vem desmarcado');
    await p.click('text=Continuar →'); await p.waitForTimeout(200);
    const conf = await p.textContent('#confirm-details-d');
    ok(conf.includes('Fim: na última parada'), 'confirmação diz que a rota termina na última parada');

    // montagem no mapa: o agendado do dia em vermelho
    await p.click('#rot-step-confirm .btn-modal-alt'); await p.waitForTimeout(900);
    const vermelhos = await p.$$eval('#mapa-manual .pino.hoje', (e) => e.length);
    ok(vermelhos === 1, 'montagem no mapa: o agendado do dia é o ponto vermelho (' + vermelhos + ')');
    const titulo = await p.getAttribute('.leaflet-marker-icon[title*="NF 2001"]', 'title');
    ok(/Agendado: sai hoje · chegar entre 09:00 e 11:00/.test(titulo || ''), 'e o ponto diz o horário: ' + titulo);
    ok(!(await p.$('.leaflet-marker-icon[title*="NF 2002"]')), 'o agendado de amanhã não está no mapa da viagem de hoje');
    await p.click('#rot-step-manual >> text=← Voltar'); await p.waitForTimeout(300);

    await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1000);
    ok(reg.solve.length === 1 && reg.solve[0].volta === false, 'o motor recebe volta: false');
    const linha = (await pathsDoMapa(p, '#rota-map')).find((x) => x.stroke === '#2f6fe4');
    ok(linha && linha.n === 4, 'desenho: CD + 3 paradas, sem voltar ao CD (' + (linha && linha.n) + ' pontos)');
    p.on('dialog', (d) => d.accept());
    await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1500);
    const rotas = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas || {});
    const rota = Object.values(rotas)[0];
    ok(rota && rota.volta === false, 'rota confirmada guarda volta: false');
    ok(reg.avaliar.every((x) => x.volta === false), 'medição da rota também sem volta');

    // página Rotas: o traçado pedido vai do CD à última parada
    await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(1200);
    const t = reg.tracado.find((x) => x.pontos.length >= 2);
    ok(t && t.pontos.length === 4 && Math.abs(t.pontos[0].lat - CD.lat) < 1e-9 && Math.abs(t.pontos[3].lat - CD.lat) > 1e-3,
      'página Rotas pede o caminho do CD até a última parada, sem volta: ' + (t && t.pontos.length));
    ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // ── cliente que marcou "Voltar ao CD" ────────────────────────────────────
  {
    const reg = { solve: [] };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seedCliente, false, { cd: CD, volta: true });
    await ctx.route(/railway\.app\/solve/, (r) => {
      const body = JSON.parse(r.request().postData()); reg.solve.push(body);
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos: body.pedidos, km: 25, mins: 100, volta: true, tracado: null }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
    });
    await p.waitForTimeout(800);
    await gerarRota(p);
    ok(await p.isChecked('#rot-volta-d'), 'a escolha "Voltar ao CD" fica lembrada');
    await p.click('text=Continuar →'); await p.waitForTimeout(200);
    ok((await p.textContent('#confirm-details-d')).includes('Fim: volta ao CD'), 'confirmação diz que volta ao CD');
    await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1000);
    ok(reg.solve[0] && reg.solve[0].volta === true, 'o motor recebe volta: true');
    const linha = (await pathsDoMapa(p, '#rota-map')).find((x) => x.stroke === '#2f6fe4');
    ok(linha && linha.n === 5, 'desenho: CD + 3 paradas + volta ao CD (' + (linha && linha.n) + ' pontos)');
    ok(!errs.length, 'sem erros no console (com volta): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // ── administrador define o CD de cada empresa ────────────────────────────
  {
    const seedAdmin = () => {
      window.__FAKE = {
        user: { uid: 'PGblgW7V26SJ6W8UYPFj3dqlDGm2', email: 'henrique@rotav3.com.br', getIdToken: async () => 'T' },
        db: { acesso: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: true, c1: true }, membros: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: 'principal', c1: 'emp9' },
          empresas: { principal: { info: { nome: 'ROTAV3' } }, emp9: { info: { nome: 'Via Verde' } } },
          usuarios: { c1: { email: 'cliente@viaverde.com.br' } } } };
    };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 960, seedAdmin, false);
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.irParaPagina('acessos')); await p.waitForTimeout(1200);
    const linhas = await p.$$eval('#ac-cds .ac-row', (rs) => rs.map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
    ok(linhas.length === 2 && linhas[0].startsWith('Sua operação') && linhas[1].includes('Via Verde') && linhas[1].includes('padrão (Guarulhos)'),
      'Acessos lista o CD de cada empresa: ' + JSON.stringify(linhas).slice(0, 220));
    await p.fill('[data-cd-coord="emp9"]', 'rua das flores 10');
    await p.click('#ac-cds .ac-row >> nth=1 >> text=Definir'); await p.waitForTimeout(500);
    ok((await p.textContent('[data-cd-msg="emp9"]')).includes('formato'), 'coordenada mal escrita é recusada com o formato certo');
    await p.fill('[data-cd-coord="emp9"]', '-23.5012, -46.6034');
    await p.fill('[data-cd-nome="emp9"]', 'CD Via Verde Vila Maria');
    await p.click('#ac-cds .ac-row >> nth=1 >> text=Definir'); await p.waitForTimeout(800);
    const dep = await p.evaluate(() => window.__FAKE.db.empresas.emp9.config && window.__FAKE.db.empresas.emp9.config.deposito);
    ok(dep && dep.lat === -23.5012 && dep.lng === -46.6034 && dep.nome === 'CD Via Verde Vila Maria' && dep.exato === true,
      'CD da empresa gravado em empresas/emp9/config/deposito: ' + JSON.stringify(dep));
    const linha2 = await p.$$eval('#ac-cds .ac-row', (rs) => rs[1].textContent.replace(/\s+/g, ' '));
    ok(linha2.includes('Agora: CD Via Verde Vila Maria · ponto exato'), 'a lista mostra o CD novo');
    // o da própria operação muda o CD da tela na hora
    await p.fill('[data-cd-coord="principal"]', '-23.43, -46.40');
    await p.fill('[data-cd-nome="principal"]', 'CD Guarulhos Centro');
    await p.click('#ac-cds .ac-row >> nth=0 >> text=Definir'); await p.waitForTimeout(800);
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
    const cdAdm = await p.evaluate(() => document.getElementById('cd-linha')?.textContent || '');
    ok(cdAdm.includes('CD Guarulhos Centro') && cdAdm.includes('trocar em Acessos'), 'CD da operação trocado na hora; o administrador vê onde trocar: ' + cdAdm.trim());
    ok(!errs.length, 'sem erros no console (administrador): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
