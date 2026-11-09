// Captura as telas do sistema de verdade rodando, para o vídeo.
// O fundo do mapa é um desenho nosso, em SVG: os blocos do OpenStreetMap não são
// liberados para uso comercial, e aqui eles nem carregariam (rede fechada).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { CD, PEDIDOS, ROTA, TOKEN } = require('./dados.js');
const TELAS = path.join(__dirname, 'telas');
const FAKE = '/home/claude/2slrotav3/tests/tela/fakefb';
const LEAF = '/home/claude/2slrotav3/tests/tela/vendor/leaflet';
const MAPA_B64 = fs.readFileSync(path.join(__dirname, 'mapa-fundo.b64'), 'utf8').trim();

const CSS_MAPA = `
.leaflet-tile-pane{display:none!important}
.leaflet-control-attribution{display:none!important}
.leaflet-container{background-image:url("data:image/svg+xml;base64,${MAPA_B64}")!important;
  background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important}
`;

const seed = (d) => {
  window.__FAKE = {
    user: { uid: 'uid-op', email: 'operacao@exemplo.com.br', getIdToken: async () => 'T' },
    db: {
      acesso: { 'uid-op': true }, membros: { 'uid-op': 'emp1' },
      entregador: { [d.TOKEN]: {
        info: { rota: 'Rota 1', data: '2026-11-09', motorista: 'Marcos A.', veiculo: 'Truck Toco', empresa: 'Transportadora Exemplo', eid: 'emp1' },
        paradas: d.ROTA.paradas, expira: Date.now() + 6 * 86400e3,
        posicao: { lat: -23.4388, lng: -46.4060, em: Date.now() - 120e3 },
        baixas: {
          0: { status: 'feito', hora: Date.now() - 2700e3, recebedor: 'Ana Paula', temFoto: true },
          1: { status: 'feito', hora: Date.now() - 1500e3, recebedor: 'Jonas M.', temFoto: true } } } },
      empresas: { emp1: { info: { nome: 'Transportadora Exemplo' },
        config: { deposito: d.CD }, pedidos_rota: d.PEDIDOS } },
    },
  };
};

async function abrir(b, arquivo, W, H, mob) {
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: !!mob, hasTouch: !!mob, deviceScaleFactor: 2 });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) =>
    r.fulfill({ path: path.join(FAKE, r.request().url().match(/(firebase-[a-z]+\.js)/)[1]), contentType: 'text/javascript' }));
  await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/[\d.]+\/(leaflet\.min\.(js|css))/, (r) => {
    const f = r.request().url().match(/leaflet\.min\.(js|css)/)[1];
    r.fulfill({ path: path.join(LEAF, f === 'js' ? 'leaflet.js' : 'leaflet.css'), contentType: f === 'js' ? 'text/javascript' : 'text/css' });
  });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic|tile\.openstreetmap|basemaps|cartocdn|arcgisonline|cdnjs\.cloudflare\.com\/ajax\/libs\/(xlsx|pdf)|railway\.app|viacep|nominatim/, (r) => r.abort());
  await ctx.route(/railway\.app\/avaliar/, (r) => {
    const body = JSON.parse(r.request().postData());
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 68.4, mins: 262,
      chegada_min: body.pedidos.map((_, i) => 450 + i * 42), fonte_distancia: 'OSRM', passa_da_jornada: false }) });
  });
  await ctx.addInitScript(seed, { CD, PEDIDOS, ROTA, TOKEN });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERRO:', e.message));
  await p.goto('http://127.0.0.1:8771/' + arquivo, { waitUntil: 'load' });
  await p.addStyleTag({ content: CSS_MAPA });
  await p.waitForTimeout(900);
  return { ctx, p };
}
const foto = async (p, nome, el) => {
  const alvo = el ? p.locator(el) : p;
  await alvo.screenshot({ path: path.join(TELAS, nome + '.png') });
  console.log('   ·', nome);
};

(async () => {
  fs.mkdirSync(TELAS, { recursive: true });
  const b = await chromium.launch();

  // ── telas do escritório, em formato retrato para caber no vídeo vertical
  console.log('escritório:');
  const { ctx, p } = await abrir(b, 'index.html', 1040, 1240, false);
  await p.evaluate(() => { const s = document.querySelector('.sidebar'); if (s) s.style.display = 'none';
    document.querySelector('.main').style.marginLeft = '0'; });

  await p.evaluate(() => window.irParaPagina('pedidos'));
  await p.waitForTimeout(1200);
  await foto(p, '01-pedidos');

  await p.evaluate(() => window.irParaPagina('mapa'));
  await p.waitForTimeout(1800);
  await p.mouse.move(6, 6);
  await foto(p, '02-mapa-tudo');
  await foto(p, '02b-mapa', '#mapa-completo');
  await foto(p, '02c-legenda', '#mapa-completo-legenda').catch(() => {});

  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(700);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(400);
  await p.fill('#cap-kg-d', '3000');
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(400);
  await foto(p, '03-confirmar');
  await p.click('#rot-step-confirm .btn-modal-alt');
  await p.waitForTimeout(1600);
  await foto(p, '04-manual-vazio');

  const toques = ['18425', '18428', '21181', '18427', '21182', '18430'];
  // o mapa e o painel a cada toque: é com estes passos que o vídeo mostra a barra
  // de peso enchendo de verdade, em vez de fingir
  await foto(p, 'passo-mapa-0', '#mapa-manual');
  await foto(p, 'passo-painel-0', '.man-painel');
  for (let i = 0; i < toques.length; i++) {
    const cx = await p.evaluate((nf) => {
      const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')]
        .find((x) => (x.getAttribute('title') || '').includes('NF ' + nf));
      if (!a) return null;
      const b = a.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, toques[i]);
    if (cx) await p.mouse.click(cx.x, cx.y); else console.log('   ! não achei NF', toques[i]);
    await p.waitForTimeout(340);
    if (i === 1) await foto(p, '05-manual-2');
    if (i === 3) await foto(p, '06-manual-4');
    await p.mouse.move(6, 6);
    await p.waitForTimeout(140);
    await foto(p, 'passo-mapa-' + (i + 1), '#mapa-manual');
    await foto(p, 'passo-painel-' + (i + 1), '.man-painel');
  }
  await p.mouse.move(6, 6);
  await p.waitForTimeout(600);
  await foto(p, '07-manual-6');
  await foto(p, '07b-painel', '.man-painel');
  await foto(p, '07c-mapa', '#mapa-manual');
  await foto(p, '07d-ordem', '#man-ordem');
  // posição de cada pino dentro do mapa, normalizada: é com isso que a linha da
  // rota se desenha exatamente por cima da imagem, no vídeo
  const pontos = await p.evaluate(() => {
    const m = document.getElementById('mapa-manual').getBoundingClientRect();
    const pinos = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].map((a) => {
      const b = a.getBoundingClientRect(), c = a.firstElementChild;
      return { x: (b.x + b.width / 2 - m.x) / m.width, y: (b.y + b.height / 2 - m.y) / m.height,
        rot: c ? c.textContent : '', sel: !!(c && /\bsel\b/.test(c.className)),
        coleta: !!(c && /coleta/.test(c.className)), cd: !!(c && /\bcd\b/.test(c.className)) };
    });
    return { w: m.width, h: m.height, pinos };
  });
  fs.writeFileSync(path.join(TELAS, 'pontos.json'), JSON.stringify(pontos, null, 1));
  console.log('   · pontos.json (' + pontos.pinos.length + ' pinos, ' + pontos.pinos.filter((x) => x.sel).length + ' na rota)');
  await p.evaluate(() => document.querySelector('#man-ordem').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(500);
  await foto(p, '08-manual-lista');

  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#man-usar');
  await p.mouse.move(6, 6);
  await p.waitForTimeout(2200);
  await foto(p, '09-resultado');
  await foto(p, '09b-kpis', '#rot-step-results .kpis, #rot-step-results .kpi-row, #rot-step-results').catch(() => {});

  await p.click('#btn-confirmar-rota').catch(() => {});
  await p.waitForTimeout(2200);
  await p.evaluate(() => window.irParaPagina('rotas'));
  await p.waitForTimeout(1600);
  await p.mouse.move(6, 6);
  await foto(p, '10-rotas');

  await p.evaluate(() => window.irParaPagina('mapa'));
  await p.waitForTimeout(1800);
  await p.mouse.move(6, 6);
  await foto(p, '11-mapa-ao-vivo');
  await foto(p, '11b-mapa', '#mapa-completo');

  await p.evaluate(() => window.irParaPagina('relatorios'));
  await p.waitForTimeout(1400);
  await foto(p, '12-relatorios');
  await foto(p, '12b-corpo', '#rel-corpo').catch(() => {});
  await ctx.close();

  // ── celular do motorista
  console.log('motorista:');
  const m = await abrir(b, 'motorista.html#' + TOKEN, 390, 844, true);
  await m.p.waitForTimeout(1600);
  await foto(m.p, '13-motorista');
  await m.p.evaluate(() => window.scrollBy(0, 520));
  await m.p.waitForTimeout(700);
  await foto(m.p, '14-motorista-baixa');
  await m.ctx.close();

  await b.close();
  console.log('pronto:', fs.readdirSync(TELAS).length, 'telas');
})();
