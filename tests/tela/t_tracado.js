// Traçado pelas ruas: o servidor devolve a linha da rota (polyline6, do OSRM /route) e a
// tela desenha esse caminho no lugar da linha reta. Sem traçado, linha reta tracejada com
// aviso. Cobre a rota gerada, a ajustada, a falha do servidor, a confirmação (traçado
// guardado), a página Rotas (rota antiga recebe o traçado uma vez) e a montagem no mapa.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

// ── polyline6 (mesmo formato do OSRM) ─────────────────────────────────────
function encode6(pts) {
  let out = '', pl = 0, pg = 0;
  const um = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } out += String.fromCharCode(v + 63); };
  for (const [lat, lng] of pts) { const a = Math.round(lat * 1e6), b = Math.round(lng * 1e6); um(a - pl); um(b - pg); pl = a; pg = b; }
  return out;
}
// "Pelas ruas": de um ponto a outro em degraus (anda na latitude, depois na longitude),
// para a linha ter muitos vértices e não ser uma reta.
function degraus(pontos) {
  const linha = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const [a, b] = [pontos[i], pontos[i + 1]];
    for (let k = 0; k < 6; k++) {
      linha.push([a[0] + (b[0] - a[0]) * k / 6, a[1] + (b[1] - a[1]) * k / 6]);
      linha.push([a[0] + (b[0] - a[0]) * (k + 1) / 6, a[1] + (b[1] - a[1]) * k / 6]);
    }
  }
  linha.push(pontos[pontos.length - 1]);
  return linha;
}

const CD = [-23.4245, -46.3877];
const PED = {
  '1001': { nf: '1001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Mercado A', peso: 100, itens: 1, status: 'pendente', lat: -23.45, lng: -46.53, geoStatus: 'ok' },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja B', peso: 100, itens: 1, status: 'pendente', lat: -23.44, lng: -46.50, geoStatus: 'ok' },
  '1003': { nf: '1003', tipo: 'entrega', cidade: 'Arujá', dest: 'Padaria C', peso: 100, itens: 1, status: 'pendente', lat: -23.39, lng: -46.32, geoStatus: 'ok' },
};
// rota confirmada antes do traçado existir (sem o campo "tracado")
const ANTIGA = { id: 'rota_antiga_1', criada_em: '2026-11-01T10:00:00.000Z', data: '2026-11-01', veiculo: 'Fiorino', motorista: 'Bia', status: 'em_rota', km: 20, tempo_min: 60,
  paradas: [{ id: '5001', nf: '5001', tipo: 'entrega', cidade: 'Guarulhos', peso: 50, lat: -23.47, lng: -46.52 }] };
const seed = (arg) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
        pedidos_rota: arg.ped, ...(arg.antiga ? { rotas_confirmadas: { [arg.antiga.id]: arg.antiga } } : {}) } } },
  };
};

const linhaDoMapa = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  return { pontos: (el.getAttribute('d').match(/[ML]/g) || []).length, tracejada: !!el.getAttribute('stroke-dasharray') };
}, sel);

(async () => {
  const b = await chromium.launch();

  // ── decodificador contra a resposta de verdade do OSRM ───────────────────
  {
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, '../../backend/tests/dados/osrm_route_guarulhos.json'), 'utf8')).routes[0];
    const { ctx, p } = await open(b, 'index.html', 1200, 800, seed, false, { ped: PED });
    const r = await p.evaluate((geo) => {
      // a mesma função da tela, copiada do código-fonte carregado
      const src = [...document.scripts].map((s) => s.textContent).find((t) => t.includes('function _decodePolyline6'));
      const corpo = src.slice(src.indexOf('function _decodePolyline6'));
      const fn = new Function(corpo.slice(0, corpo.indexOf('\nconst ATRIB_ROTAS')) + '\nreturn _decodePolyline6;')();
      const pts = fn(geo);
      const R = 6371000, rad = (x) => x * Math.PI / 180;
      let m = 0;
      for (let i = 1; i < pts.length; i++) {
        const [a, b2] = [pts[i - 1], pts[i]];
        const h = Math.sin(rad(b2[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b2[0])) * Math.sin(rad(b2[1] - a[1]) / 2) ** 2;
        m += 2 * R * Math.asin(Math.sqrt(h));
      }
      return { n: pts.length, primeiro: pts[0], ultimo: pts[pts.length - 1], m, vazio: fn('').length, lixo: fn(null).length };
    }, real.geometry);
    ok(r.n === 479 && Math.abs(r.primeiro[0] + 23.424479) < 1e-6 && Math.abs(r.primeiro[1] + 46.387623) < 1e-6,
      'lê a geometria real do OSRM: 479 pontos, começando no CD (' + r.n + ')');
    ok(Math.abs(r.m / real.distance - 1) < 0.01, 'comprimento da linha decodificada = distância do OSRM (' + Math.round(r.m) + ' m × ' + Math.round(real.distance) + ' m)');
    ok(r.vazio === 0 && r.lixo === 0, 'texto vazio ou ausente vira linha vazia, sem erro');
    await ctx.close();
  }

  // ── rota gerada, ajustada, falha, confirmação ────────────────────────────
  const reg = { solve: [], avaliar: [], tracado: [], avaliarFalha: false };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, { ped: PED, antiga: ANTIGA });
  await ctx.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.solve.push(body);
    const pedidos = body.pedidos.map((x, i) => ({ ...x, chegada_min: 420 + 20 * (i + 1) }));
    const linha = degraus([CD, ...pedidos.map((x) => [x.lat, x.lng]), CD]);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos, km: 31.5, mins: 140, tracado: encode6(linha) }], nao_alocados: [], fonte_distancia: 'OSRM', salvo: false }) });
  });
  await ctx.route(/railway\.app\/avaliar/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.avaliar.push(body);
    if (reg.avaliarFalha) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"x"}' });
    const linha = degraus([CD, ...body.pedidos.map((x) => [x.lat, x.lng]), CD]);
    setTimeout(() => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 44, mins: 120, chegada_min: body.pedidos.map((_, i) => 430 + 30 * i), fonte_distancia: 'OSRM', passa_da_jornada: false, tracado: encode6(linha) }) }), 400);
  });
  await ctx.route(/railway\.app\/tracado/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.tracado.push(body);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracado: encode6(degraus(body.pontos.map((x) => [x.lat, x.lng]))) }) });
  });

  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '600'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1000);
  const ROTA = '#rota-map path[stroke="#2f6fe4"]';
  let l = await linhaDoMapa(p, ROTA);
  ok(l && l.pontos > 30 && !l.tracejada, 'rota gerada: linha pelas ruas (contínua, ' + (l && l.pontos) + ' vértices em vez de 5)');
  ok((await p.textContent('#rota-map .leaflet-control-attribution')).includes('OSRM'), 'crédito do OSRM no canto do mapa');
  ok(!(await p.$('#rota-map .mapa-legenda')), 'com traçado, sem aviso de linha reta');
  await p.screenshot({ path: 'tracado-rota-1440.png' });

  // ajuste: enquanto mede, linha reta tracejada com "Buscando o caminho"; depois, pelas ruas
  await p.click('[data-foco="ajustar"]'); await p.waitForTimeout(200);
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]'); await p.waitForTimeout(250);
  l = await linhaDoMapa(p, ROTA);
  ok(l && l.tracejada && l.pontos === 5, 'ordem mudou: o traçado antigo some e fica a linha reta tracejada');
  ok((await p.textContent('#rota-map')).includes('Buscando o caminho pelas ruas'), 'aviso "Buscando o caminho pelas ruas…" enquanto mede');
  await p.waitForTimeout(1000);
  l = await linhaDoMapa(p, ROTA);
  ok(l && !l.tracejada && l.pontos > 30, 'medição voltou com o traçado da ordem nova: linha pelas ruas');
  const ordemNova = reg.avaliar[reg.avaliar.length - 1].pedidos.map((x) => [x.lat, x.lng]);

  // servidor falhou: linha reta tracejada com aviso
  reg.avaliarFalha = true;
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]'); await p.waitForTimeout(900);
  l = await linhaDoMapa(p, ROTA);
  ok(l && l.tracejada, 'servidor sem resposta: linha reta tracejada');
  ok((await p.textContent('#rota-map')).includes('Linha reta entre as paradas'), 'aviso de que a linha é reta');
  reg.avaliarFalha = false;
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]'); await p.waitForTimeout(1100);
  const ultimo = reg.avaliar[reg.avaliar.length - 1];

  // confirmar: o traçado vai junto com a rota
  p.on('dialog', (d) => d.accept());
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1500);
  const rotas = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas);
  const nova = Object.values(rotas).find((r) => r.id !== 'rota_antiga_1');
  const esperado = encode6(degraus([CD, ...ultimo.pedidos.map((x) => [x.lat, x.lng]), CD]));
  ok(nova && nova.tracado === esperado, 'rota confirmada guarda o traçado da ordem final');
  ok(ordemNova.length === 3, 'medição recebeu as 3 paradas');

  // ── página Rotas ────────────────────────────────────────────────────────
  // (a lista de rotas é desenhada assim que o banco muda, mesmo com a página fechada)
  const daAntiga = () => reg.tracado.filter((x) => x.pontos.length === 3 && Math.abs(x.pontos[1].lat + 23.47) < 1e-9);
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(1500);
  const novaPath = await linhaDoMapa(p, `#mini-map-rota-${nova.id} path:not([stroke="#fff"])`);
  ok(novaPath && !novaPath.tracejada && novaPath.pontos > 30, 'página Rotas: rota nova desenhada pelas ruas, sem pedir de novo');
  ok(daAntiga().length === 1 && Math.abs(daAntiga()[0].pontos[0].lat - CD[0]) < 1e-9 && Math.abs(daAntiga()[0].pontos[2].lng - CD[1]) < 1e-9,
     'rota antiga (sem traçado): pede uma vez, do CD ao CD: ' + JSON.stringify(reg.tracado.map((x) => x.pontos.length)));
  ok(reg.tracado.length === 1, 'a rota que já tem traçado não pede nada');
  const antigaDb = await p.evaluate(() => window.__FAKE.db.empresas.emp1.rotas_confirmadas.rota_antiga_1);
  ok(antigaDb.tracado && antigaDb.tracado.length > 10 && antigaDb.paradas.length === 1, 'traçado da rota antiga fica guardado nela (o resto da rota não muda)');
  const antigaPath = await linhaDoMapa(p, '#mini-map-rota-rota_antiga_1 path:not([stroke="#fff"])');
  ok(antigaPath && !antigaPath.tracejada && antigaPath.pontos > 10, 'rota antiga redesenhada pelas ruas');
  await p.evaluate(() => window.irParaPagina('dashboard')); await p.waitForTimeout(300);
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(800);
  ok(daAntiga().length === 1 && reg.tracado.length === 1, 'voltar à página não pede o traçado de novo');
  await p.screenshot({ path: 'tracado-rotas-1440.png', fullPage: true });
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();

  // ── montagem no mapa ──────────────────────────────────────────────────────
  {
    const reg2 = { tracado: [] };
    const { ctx: c2, p: p2, errs: e2 } = await open(b, 'index.html', 1440, 900, seed, false, { ped: PED });
    await c2.route(/railway\.app\/tracado/, (r) => {
      const body = JSON.parse(r.request().postData());
      reg2.tracado.push(body);
      r.fulfill({ contentType: 'application/json', body: JSON.stringify({ tracado: encode6(degraus(body.pontos.map((x) => [x.lat, x.lng]))) }) });
    });
    await p2.evaluate(() => window.irParaPagina('roteirizacao')); await p2.waitForTimeout(500);
    await p2.evaluate(() => window.selVeicD('toco')); await p2.waitForTimeout(250);
    await p2.fill('#cap-kg-d', '2000');
    await p2.evaluate(() => window.irConfirmD()); await p2.waitForTimeout(250);
    await p2.click('#rot-step-confirm .btn-modal-alt'); await p2.waitForTimeout(900);
    await p2.click('.leaflet-marker-icon[title*="NF 1001"]'); await p2.waitForTimeout(250);
    await p2.click('.leaflet-marker-icon[title*="NF 1003"]'); await p2.waitForTimeout(250);
    const MAN = '#mapa-manual path[stroke="#0d1b2e"]';
    let m = await linhaDoMapa(p2, MAN);
    ok(m && m.tracejada && m.pontos === 4 && reg2.tracado.length === 0, 'tocando: rascunho em linha reta, sem chamar o servidor a cada toque');
    await p2.waitForTimeout(1600);
    m = await linhaDoMapa(p2, MAN);
    ok(reg2.tracado.length === 1 && reg2.tracado[0].pontos.length === 4, 'parou de tocar: pede o caminho uma vez (CD, 2 paradas, CD)');
    ok(m && !m.tracejada && m.pontos > 20, 'linha do rascunho vira o caminho pelas ruas');
    // desfazer o último toque e refazer: o caminho já conhecido volta sem nova consulta
    await p2.click('#man-desfazer'); await p2.waitForTimeout(1500);
    const n1 = reg2.tracado.length;
    await p2.click('.leaflet-marker-icon[title*="NF 1003"]'); await p2.waitForTimeout(300);
    m = await linhaDoMapa(p2, MAN);
    ok(m && !m.tracejada && reg2.tracado.length === n1, 'mesma sequência de antes: caminho guardado, sem nova consulta');
    await p2.screenshot({ path: 'tracado-manual-1440.png' });
    ok(!e2.length, 'sem erros no console (montagem): ' + JSON.stringify(e2.slice(0, 3)));
    await c2.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
