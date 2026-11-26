// Versão 3.12: o que aconteceu na rua, comparado com o planejado.
//  1. ajuste de tempo da empresa vai para o motor e fica gravado na rota;
//  2. aviso dos pedidos que ficaram na rua certa, sem o número;
//  3. motorista: caminho pelo GPS e GPS da baixa (o km do painel saiu da tela em 18/11);
//  4. escritório: planejado × realizado na rota (km do painel de rotas antigas, km pelo GPS, tempo e ordem);
//  5. relatório: as mesmas medidas, na tela e na planilha;
//  6. pinos aprendidos: duas visitas com GPS bom no mesmo endereço viram o ponto do endereço;
//  7. administrador: ajuste de tempo por empresa, com sugestão tirada das baixas.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const ADMIN = 'PGblgW7V26SJ6W8UYPFj3dqlDGm2';
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOJE = isoDia(new Date());

const seedCliente = (arg) => {
  const base = (nf, extra) => ({ id: nf, nf, tipo: 'entrega', cidade: 'Guarulhos', uf: 'SP', dest: 'Cliente ' + nf, peso: 100, itens: 1,
    status: 'pendente', geoStatus: 'ok', geoPrec: 'numero', ...extra });
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: arg.cd, fator_tempo: 1.25 },
        pedidos_rota: {
          8001: base('8001', { lat: -23.45, lng: -46.53, endereco: 'Rua A, 10', cep: '07010000' }),
          8002: base('8002', { lat: -23.44, lng: -46.50, endereco: 'Avenida Brasil, 500', cep: '07020000', geoPrec: 'rua' }),
          8003: base('8003', { lat: -23.39, lng: -46.32, endereco: 'Rua C, 30', cep: '07030000' }),
        } } } } };
};

(async () => {
  const b = await chromium.launch();
  const reg = { solve: [], km: [] };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seedCliente, false, { cd: CD });
  await ctx.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData()); reg.solve.push(body);
    const ordem = ['8001', '8002', '8003'];
    const pedidos = ordem.map((nf) => body.pedidos.find((x) => x.nf === nf)).filter(Boolean).map((x, i) => ({ ...x, chegada_min: [490, 520, 560][i] }));
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos, km: 40, mins: 150, volta: false, tracado: null }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
  });
  await ctx.route(/railway\.app\/(avaliar|tracado)/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  await ctx.route(/railway\.app\/km-rastro/, (r) => {
    const body = JSON.parse(r.request().postData()); reg.km.push(body);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km_total: 41.2, km_medido: 33, km_estimado: 8.2, cobertura: 0.8, pontos_usados: body.pontos.length, pontos_descartados: 0, trechos: 1, casado: true }) });
  });
  const dialogos = [];
  p.on('dialog', (d) => { dialogos.push(d.message()); d.accept(); });
  await p.waitForTimeout(800);

  // ── 2. pedido na rua certa, sem o número ──────────────────────────────────
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(500);
  // 21/11/2026: ponto na rua é ponto bom; nada de etiqueta nem aviso "sem o número"
  ok((await p.$$('.semnum')).length === 0 && !/sem o número/.test(await p.textContent('#page-pedidos')), 'pedido que ficou na rua não ganha etiqueta nem aviso "sem o número"');
  const aviso = await p.textContent('#ped-aprox');
  ok(aviso.trim() === '', 'sem faixa de aviso em Pedidos');

  // ── 1. ajuste de tempo: confirmação, motor e rota ─────────────────────────
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '2000'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  let conf = await p.textContent('#confirm-details-d');
  ok(conf.includes('Tempos ajustados ao trânsito: ×1,25'), 'confirmação mostra o ajuste de tempo da empresa (×1,25)');
  ok(!/sem o número|aproximad/.test(conf), 'a confirmação não fala em "sem o número" nem em "aproximado"');
  // o administrador muda o ajuste com a página do cliente aberta
  await p.evaluate(() => { window.__FAKE.setAt('empresas/emp1/config/fator_tempo', 1.3); window.__FAKE.fire(); });
  await p.click('#rot-step-confirm >> text=← Voltar'); await p.waitForTimeout(150);
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  conf = await p.textContent('#confirm-details-d');
  ok(conf.includes('×1,3'), 'mudança feita pelo administrador vale na hora, sem recarregar (×1,3)');
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1000);
  ok(reg.solve.length === 1 && reg.solve[0].fator_tempo === 1.3, 'o motor recebe fator_tempo 1.3');
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1500);
  let db = await p.evaluate(() => window.__FAKE.db);
  const rota = Object.values(db.empresas.emp1.rotas_confirmadas || {})[0];
  ok(rota && rota.fator_tempo === 1.3, 'a rota guarda o ajuste usado (para calibrar depois)');
  const token = rota && rota.token;

  // ── 3. motorista ──────────────────────────────────────────────────────────
  const dctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    geolocation: { latitude: -23.4300, longitude: -46.4000, accuracy: 10 }, permissions: ['geolocation'] });
  await dctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) => { const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1]; r.fulfill({ path: path.join(__dirname, 'fakefb', f), contentType: 'text/javascript' }); });
  await dctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
  await dctx.addInitScript((sd) => { window.__FAKE = { user: null, db: sd }; }, { entregador: db.entregador });
  const m = await dctx.newPage();
  const merrs = [], mdialogos = [];
  m.on('pageerror', (e) => merrs.push(e.message));
  m.on('console', (x) => { if (x.type() === 'error' && !/net::|Failed to load resource/.test(x.text())) merrs.push(x.text()); });
  m.on('dialog', (d) => { mdialogos.push(d.message()); d.accept(); });
  await m.goto('http://127.0.0.1:8771/motorista.html#' + token); await m.waitForTimeout(800);
  ok((await m.$$('section.hod')).length === 0 && !(await m.content()).includes('Km do painel'),
    'o km do painel saiu da tela do motorista (18/11): ele não digita nada antes de sair');
  const ent = () => m.evaluate((t) => window.__FAKE.db.entregador[t], token);

  // O escritório continua lendo hodometro de rotas antigas, que já têm o dado gravado.
  // Como não há mais tela que produza isso, o teste grava direto no banco simulado.
  await m.evaluate((t) => {
    window.__FAKE.db.entregador[t].hodometro = {
      ini: { km: 123456, hora: Date.now() - 36e5, temFoto: false },
      fim: { km: 123498.5, hora: Date.now(), temFoto: true },
    };
    window.__FAKE.db.entregador[t].fotos_hod = { fim: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  }, token);
  let e = await ent();
  ok(e.hodometro.fim.km - e.hodometro.ini.km === 42.5, 'rota antiga com km do painel: 42,5 km rodados');

  // caminho pelo GPS: liga a localização e anda
  await m.click('[data-acao="loc"]'); await m.waitForTimeout(700);
  for (const [la, lo] of [[-23.4330, -46.4040], [-23.4360, -46.4080], [-23.4390, -46.4120]]) {
    await dctx.setGeolocation({ latitude: la, longitude: lo, accuracy: 12 }); await m.waitForTimeout(500);
  }
  await dctx.setGeolocation({ latitude: -23.4391, longitude: -46.4121, accuracy: 120 }); await m.waitForTimeout(400);
  e = await ent();
  const trilha = Object.values(e.trilha || {});
  ok(trilha.length >= 3, 'caminho gravado enquanto o motorista anda: ' + trilha.length + ' pontos');
  ok(trilha.every((x) => Object.keys(x).every((k) => ['lat', 'lng', 't', 'acc', 'v'].includes(k)) && Number.isFinite(x.t) && x.acc <= 50),
    'cada ponto tem só lat, lng, hora e precisão; leitura com precisão ruim (120 m) fica de fora');

  // baixa: a posição vai com a precisão em gps/
  await m.click('#p-0 [data-acao="feito"]'); await m.waitForTimeout(150);
  await m.click('#p-0 button[type="submit"]'); await m.waitForTimeout(1500);
  e = await ent();
  ok(e.baixas && e.baixas[0] && e.baixas[0].status === 'feito' && !('precisao' in e.baixas[0]), 'baixa gravada sem campo a mais');
  ok(e.gps && e.gps[0] && Number.isFinite(e.gps[0].lat) && Number.isFinite(e.gps[0].precisao), 'GPS da baixa gravado com a precisão: ' + JSON.stringify(e.gps && e.gps[0]));
  ok((await m.$$('details.dados')).length === 1 && (await m.textContent('details.dados')).includes('Quem vê é a transportadora'), 'motorista vê o que a página grava e quem vê');
  ok(!merrs.length, 'motorista sem erros no console: ' + JSON.stringify(merrs.slice(0, 3)));

  // ── 4. escritório: planejado × realizado ──────────────────────────────────
  // baixas: parada 1 às T0, a 3 às T0+20 min, a 2 às T0+50 min (fora da ordem, e o
  // trecho 1→2 levou 35 min de estrada contra 15 previstos)
  const T0 = Date.now() - 3 * 3600e3;
  e.baixas = { 0: { ...e.baixas[0], hora: T0 }, 1: { status: 'feito', hora: T0 + 50 * 60e3 }, 2: { status: 'feito', hora: T0 + 20 * 60e3 } };
  await p.evaluate(([t, v]) => { window.__FAKE.setAt('entregador/' + t, v); window.__FAKE.fire(); }, [token, e]);
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(1500);
  const bloco = await p.textContent('#rotas-confirmadas-lista .realizado');
  ok(/planejado 40,0 km/.test(bloco) && /painel 42,5 km/.test(bloco), 'rota mostra km planejado e do painel: ' + bloco.replace(/\s+/g, ' ').slice(0, 120));
  ok(!bloco.includes('diferença grande'), 'diferença pequena (6%) não gera alerta');
  ok(reg.km.length === 1 && reg.km[0].pontos.length === trilha.length + 1, 'rota concluída: o km pelo GPS é calculado sozinho, com os pontos do caminho e a posição da baixa');
  const pb = reg.km[0] && reg.km[0].pontos.at(-1);
  ok(pb && pb.t === T0 && pb.acc === e.gps[0].precisao && pb.lat === e.gps[0].lat, 'a posição da baixa vai com a hora da baixa e a precisão dela');
  ok(/GPS 41,2 km/.test(bloco) && /80% medido/.test(bloco), 'e aparece: GPS 41,2 km (80% medido)');
  ok(/Tempo entre as paradas: 2,3× o planejado/.test(bloco), 'tempo entre as paradas: 2,3× o planejado');
  ok(/1 parada feita fora da ordem/.test(bloco), 'e 1 parada feita fora da ordem');
  db = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas);
  const rr = db[rota.id];
  ok(rr.km_painel && rr.km_painel.km === 42.5 && rr.km_painel.ini === 123456 && rr.km_painel.fotos === false, 'km do painel guardado na rota (o link expira, o relatório não)');
  ok(rr.km_gps && rr.km_gps.km_total === 41.2 && rr.km_gps.cobertura === 0.8, 'km pelo GPS guardado na rota');
  await p.click('#rotas-confirmadas-lista .realizado button.lk >> text=ver fotos'); await p.waitForTimeout(500);
  const fotos = await p.textContent('#foto-corpo');
  ok((await p.$$('#modal-foto.open #foto-corpo img')).length === 1 && /123\.456/.test(fotos), 'ver fotos: mostra a foto da chegada e o km da saída sem foto');
  await p.click('#modal-foto .modal-close');
  await p.screenshot({ path: 'km-realizado-1440.png', fullPage: true });

  // ── 5. relatório ──────────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  const rel = (await p.textContent('#rel-corpo')).replace(/\s+/g, ' ');
  ok(rel.includes('Planejado × realizado') && rel.includes('Km do painel: 42,5 km') && rel.includes('O planejado para essas mesmas rotas era 40,0 km') && rel.includes('+6%'),
    'relatório compara o km do painel com o planejado das mesmas rotas');
  ok(rel.includes('Km pelo GPS: 41,2 km') && rel.includes('Tempo entre as paradas: 2,3× o planejado') && rel.includes('1 parada feita fora da ordem planejada'), 'relatório traz GPS, tempo e ordem');
  const linha = await p.evaluate(() => [...document.querySelectorAll('#rel-corpo table.rel-tab')[0].querySelectorAll('tbody tr td')].map((t) => t.textContent.trim()));
  // as últimas colunas são Ocupação e Custo (26/11/2026)
  ok(linha.slice(-6, -2).join('|') === '42,5|41,2|2,3×|1', 'tabela de rotas com km painel, km GPS, tempo real e fora da ordem: ' + linha.slice(-6, -2).join('|'));
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rel-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  const cab = csv.split('\r\n').find((l) => l.startsWith('Data;'));
  ok(cab && cab.endsWith('Km painel;Km GPS;% do GPS casado com as ruas;Tempo real ÷ planejado;Paradas fora da ordem;Custo estimado (R$)'), 'planilha tem as colunas novas');
  ok(csv.includes(';42,5;41,2;80;2,33;1'), 'e os números da rota (2,33 com duas casas, para conta)');
  ok(!errs.length, 'escritório sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close(); await dctx.close();

  // ── 6. pinos aprendidos ───────────────────────────────────────────────────
  {
    const seedPinos = () => {
      const agora = Date.now(), criada = new Date(agora - 864e5).toISOString();
      const isoDia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const end = { endereco: 'Rua das Flores, 100', cep: '07010000', cidade: 'Guarulhos', uf: 'SP' };
      const par = (id) => ({ id, nf: id, tipo: 'entrega', ...end, lat: -23.4500, lng: -46.5300, peso: 10, itens: 1, chegada_min: 500 });
      const rotaDe = (n, ped, tok) => ({ id: 'r' + n, data: isoDia(new Date()), criada_em: criada, status: 'em_rota', token: tok, km: 10, fonte_dist: 'OSRM', paradas: [par(ped)] });
      const entDe = (ped, g) => ({ eid: 'emp1', expira: agora + 864e5, paradas: [{ nf: ped }], baixas: { 0: { status: 'feito', hora: agora - 3600e3 } }, gps: { 0: g } });
      const ped = (id, extra) => ({ id, nf: id, tipo: 'entrega', ...end, lat: -23.4500, lng: -46.5300, geoStatus: 'ok', geoPrec: 'rua', peso: 10, itens: 1, ...extra });
      const outro = { endereco: 'Rua Longe, 5', cep: '07099000', cidade: 'Guarulhos', uf: 'SP' };
      window.__FAKE = {
        user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
        db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
          entregador: {
            tokUmUmUmUmUmUmUmUmUmUm: entDe('9001', { lat: -23.45102, lng: -46.53011, precisao: 12 }),
            tokDoisDoisDoisDoisDoi: entDe('9002', { lat: -23.45106, lng: -46.53017, precisao: 8 }),
            tokTresTresTresTresTre: entDe('9004', { lat: -23.4600, lng: -46.5400, precisao: 80 }),
            tokQuatroQuatroQuatroQ: { eid: 'emp1', expira: agora + 864e5, paradas: [{ nf: '9101' }, { nf: '9102' }],
              baixas: { 0: { status: 'feito', hora: agora - 7200e3 }, 1: { status: 'feito', hora: agora - 5400e3 } },
              gps: { 0: { lat: -23.40, lng: -46.50, precisao: 9 }, 1: { lat: -23.41, lng: -46.48, precisao: 11 } } },
          },
          empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } },
            rotas_confirmadas: { r1: rotaDe(1, '9001', 'tokUmUmUmUmUmUmUmUmUmUm'), r2: rotaDe(2, '9002', 'tokDoisDoisDoisDoisDoi'),
              r3: { ...rotaDe(3, '9004', 'tokTresTresTresTresTre'), paradas: [{ ...par('9004'), ...outro, lat: -23.46, lng: -46.54 }] },
              r4: { ...rotaDe(4, '9101', 'tokQuatroQuatroQuatroQ'), paradas: [
                { ...par('9101'), endereco: 'Rua Nova, 1', cep: '07050000', lat: -23.40, lng: -46.50 },
                { ...par('9102'), endereco: 'Rua Nova, 2', cep: '07050000', lat: -23.41, lng: -46.48, chegada_min: 540 }] } },
            pedidos_rota: {
              9001: ped('9001', { status: 'despachado', rota_atual: 'r1' }),
              9002: ped('9002', { status: 'despachado', rota_atual: 'r2' }),
              9003: ped('9003', { status: 'pendente' }),
              9004: ped('9004', { ...outro, lat: -23.46, lng: -46.54, status: 'despachado', rota_atual: 'r3' }),
            } } } } };
    };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seedPinos, false);
    const kmPedidos = [];
    await ctx.route(/railway\.app/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await ctx.route(/railway\.app\/km-rastro/, (r) => { kmPedidos.push(JSON.parse(r.request().postData()));
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km_total: 2.6, km_medido: 0, km_estimado: 2.6, cobertura: 0, pontos_usados: 2, casado: true }) }); });
    await p.reload(); await p.waitForTimeout(1800);   // de novo, já com o servidor simulado no lugar
    const emp = await p.evaluate(() => window.__FAKE.db.empresas.emp1);
    const locais = emp.config.locais || {};
    const aprendidos = Object.entries(locais).filter(([, v]) => v.p === 'aprendido');
    ok(aprendidos.length === 1, 'duas visitas com GPS bom (12 m e 8 m) no mesmo endereço viram ponto aprendido: ' + aprendidos.map(([k]) => k).join(','));
    const [, ap] = aprendidos[0] || [, {}];
    ok(Math.abs(ap.lat + 23.45104) < 2e-5 && Math.abs(ap.lng + 46.53014) < 2e-5, 'o ponto é a mediana das visitas: ' + ap.lat + ', ' + ap.lng);
    ok(Object.values(ap.amostras || {}).length === 2, 'guarda as amostras (uma por rota)');
    ok(ap.antes && ap.antes.lat === -23.45 && ap.antes.lng === -46.53 && ap.antes.p === 'rua', 'guarda o ponto que estava antes: ' + JSON.stringify(ap.antes));
    const p3 = emp.pedidos_rota['9003'];
    ok(p3.geoPrec === 'aprendido' && p3.lat === ap.lat && p3.lng === ap.lng, 'pedido pendente do mesmo endereço passa a usar o ponto aprendido');
    ok(!Object.values(locais).some((v) => (v.amostras && Object.values(v.amostras).some((a) => a.a > 30))), 'GPS com 80 m de precisão não entra no aprendizado');
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(400);
    await p.evaluate(() => window.abrirPedido('9003')); await p.waitForTimeout(500);
    const st = await p.evaluate(() => document.getElementById('ped-geo-st')?.textContent || '');
    ok(st.startsWith('Ponto aprendido nas entregas'), 'o pedido diz de onde veio o ponto: ' + st.slice(0, 80));
    // rota sem o caminho gravado, mas com a posição das baixas: km estimado entre as paradas
    await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(1500);
    const r4 = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas.r4.km_gps);
    ok(kmPedidos.some((k) => k.pontos.length === 2) && r4 && r4.so_baixas === true && r4.km_total === 2.6, 'sem o caminho, o km sai da posição das baixas e fica marcado como só das baixas');
    const txt4 = await p.evaluate(() => [...document.querySelectorAll('#rotas-confirmadas-lista .realizado')].map((x) => x.textContent).join(' | '));
    const lim4 = txt4.replace(/\s+/g, ' ');
    ok(/Sem km pelo GPS nesta rota/.test(lim4) && /\(2,6 km\)/.test(lim4) && /sai igual por qualquer trajeto/.test(lim4),
      'e a rota avisa que não há km pelo GPS, em vez de mostrar os 2,6 km como km rodado (16/11)');
    ok(!errs.length, 'sem erros no console (pinos): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // ── 7. administrador: ajuste de tempo por empresa ─────────────────────────
  {
    const seedAdmin = () => {
      const agora = Date.now(), dia = isoD(new Date(agora - 2 * 864e5));
      function isoD(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
      // 3 rotas de 8 paradas medidas pelas ruas: cada trecho levou 1,4× o previsto
      const rotas = {}, peds = {};
      for (let r = 0; r < 3; r++) {
        const rid = 'rr' + r, paradas = [], t0 = agora - (3 - r) * 864e5;
        for (let i = 0; i < 8; i++) {
          const id = `p${r}${i}`;
          paradas.push({ id, nf: id, tipo: 'entrega', cidade: 'Guarulhos', lat: -23.45, lng: -46.5, chegada_min: 480 + 30 * i });
          peds[id] = { id, nf: id, status: 'entregue', baixa: { rota: rid, hora: t0 + i * (15 + 15 * 1.4) * 60e3 } };
        }
        rotas[rid] = { id: rid, data: dia, status: 'concluida', fonte_dist: 'OSRM', fator_tempo: 1, paradas };
      }
      window.__FAKE = {
        user: { uid: 'PGblgW7V26SJ6W8UYPFj3dqlDGm2', email: 'henrique@rotav3.com.br', getIdToken: async () => 'T' },
        db: { acesso: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: true, c1: true, c2: true }, membros: { PGblgW7V26SJ6W8UYPFj3dqlDGm2: 'principal', c1: 'emp9', c2: 'emp8' },
          empresas: { principal: { info: { nome: 'ROTAV3' } },
            emp9: { info: { nome: 'Via Verde' }, rotas_confirmadas: rotas, pedidos_rota: peds },
            emp8: { info: { nome: 'Transporte Pequeno' }, config: { fator_tempo: 1.2 } },
            demo_x: { info: { nome: 'Demonstração' } } },
          usuarios: { c1: { email: 'cliente@viaverde.com.br' } } } };
    };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 1100, seedAdmin, false);
    await p.waitForTimeout(1000);
    await p.evaluate(() => window.irParaPagina('acessos')); await p.waitForTimeout(1200);
    const linhaDe = (nome) => p.evaluate((n) => [...document.querySelectorAll('#ac-fatores .ac-row')].find((x) => x.textContent.includes(n))?.textContent.replace(/\s+/g, ' ') || '', nome);
    const vv = await linhaDe('Via Verde');
    ok(vv.includes('Agora: sem ajuste (×1)') && vv.includes('Sugestão pelas baixas: ×1,40 (21 trechos em 3 rotas)'), 'sugestão tirada das baixas: ×1,40 com 21 trechos: ' + vv.slice(0, 160));
    const tp = await linhaDe('Transporte Pequeno');
    ok(tp.includes('Agora: ×1,20') && tp.includes('Sem sugestão ainda: 0 trechos medidos'), 'empresa sem dados: mostra o ajuste atual e que ainda não há sugestão');
    ok(!(await linhaDe('Demonstração')), 'demonstração fica de fora (dados fictícios)');
    const inp = await p.$('#ac-fatores input[data-ft="emp9"]');
    ok((await inp.inputValue()) === '1,4', 'campo já vem com a sugestão');
    await p.click('#ac-fatores .ac-row:has(input[data-ft="emp9"]) >> text=Aplicar'); await p.waitForTimeout(500);
    let f = await p.evaluate(() => window.__FAKE.db.empresas.emp9.config && window.__FAKE.db.empresas.emp9.config.fator_tempo);
    ok(f === 1.4, 'aplicar grava o ajuste da empresa: ' + f);
    ok((await linhaDe('Via Verde')).includes('Agora: ×1,40'), 'a linha mostra o ajuste novo');
    await p.fill('#ac-fatores input[data-ft="emp8"]', '5');
    await p.click('#ac-fatores .ac-row:has(input[data-ft="emp8"]) >> text=Aplicar'); await p.waitForTimeout(300);
    ok((await p.textContent('[data-ft-msg="emp8"]')).includes('de 0,5 a 3'), 'valor fora da faixa: explica a faixa aceita');
    await p.click('#ac-fatores .ac-row:has(input[data-ft="emp8"]) >> text=Tirar o ajuste'); await p.waitForTimeout(500);
    f = await p.evaluate(() => window.__FAKE.db.empresas.emp8.config.fator_tempo);
    ok(f === undefined, 'tirar o ajuste apaga o valor (volta a 1)');
    await p.screenshot({ path: 'acessos-fator-1440.png', fullPage: true });
    ok(!errs.length, 'sem erros no console (administrador): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `${falhas} falha(s)` : 'tudo certo');
})();
