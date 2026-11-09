// Linha do tempo do filme. Nada de animação de CSS: tudo é calculado em render(t),
// então cada quadro é exatamente reprodutível e o vídeo sai sem tremer.
const DUR = 37.5;
const $ = (s) => document.querySelector(s);
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const k = (t, a, b) => cl((t - a) / (b - a));                 // 0→1 entre a e b
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

const MAPA = 'mapa-fundo.svg';
const cena = $('#cena'), texto = $('#texto'), abre = $('#abre');

// ── material ──────────────────────────────────────────────────────────────
let PONTOS = null, MPONTOS = null;
const cards = {};
function card(nome, arq, larg, classe = 'card') {
  const d = document.createElement('div');
  d.className = classe; d.style.width = larg + 'px'; d.style.opacity = '0';
  const i = document.createElement('img'); i.src = 'telas/' + arq + '.png'; d.appendChild(i);
  cena.appendChild(d); cards[nome] = d; return d;
}
// troca a imagem de um card sem recriá-lo (os passos da montagem)
function passo(nome, arq) { const i = cards[nome].querySelector('img'); const s = 'telas/' + arq + '.png'; if (!i.src.endsWith(s)) i.src = s; }

const linhas = [];
function escreverTexto(titulo, sub) {
  const chave = titulo + '|' + (sub || '');
  if (texto.dataset.chave === chave) return;
  texto.dataset.chave = chave;
  texto.innerHTML = '';
  linhas.length = 0;
  titulo.split('\n').forEach((l) => {
    const d = document.createElement('div'); d.className = 'lin tit';
    const s = document.createElement('span'); s.textContent = l; d.appendChild(s);
    texto.appendChild(d); linhas.push(s);
  });
  if (sub) {
    const d = document.createElement('div'); d.className = 'lin sub';
    const s = document.createElement('span'); s.textContent = sub; d.appendChild(s);
    texto.appendChild(d); linhas.push(s);
  }
}
function animarTexto(t, inicio, fim) {
  linhas.forEach((s, i) => {
    const e = easeOut(k(t, inicio + i * 0.12, inicio + i * 0.12 + 0.62));
    const sai = k(t, fim - 0.42, fim);
    s.style.transform = `translateY(${(1 - e) * 112 - sai * 34}px)`;
    s.style.opacity = (e * (1 - sai)).toFixed(3);
  });
}
function mostrar(nome, t, inicio, fim, y, { desloca = 68, escala = 1 } = {}) {
  const d = cards[nome]; if (!d) return;
  const e = easeOut(k(t, inicio, inicio + 0.62));
  const sai = easeInOut(k(t, fim - 0.5, fim));
  const op = e * (1 - sai);
  d.style.opacity = op.toFixed(3);
  if (op <= 0.001) { d.style.transform = 'translate(-50%,-4000px)'; return; }
  const dy = y + (1 - e) * desloca - sai * 46;
  d.style.transform = `translate(-50%, ${dy}px) scale(${(0.985 + e * 0.015) * escala})`;
}

// ── abertura: os pedidos do dia caindo no mapa ────────────────────────────
let pinosAbre = [];
function montarAbertura() {
  const ps = PONTOS.pinos;
  // espalha os pontos pelo quadro inteiro, mantendo o desenho relativo real
  const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  ps.forEach((p) => {
    const d = document.createElement('div');
    d.className = 'pino' + (p.coleta ? ' c' : '') + (p.cd ? ' cd' : '');
    d.style.left = (118 + ((p.x - x0) / (x1 - x0)) * 844) + 'px';
    d.style.top = (560 + ((p.y - y0) / (y1 - y0)) * 880) + 'px';
    abre.appendChild(d); pinosAbre.push(d);
  });
}
function animarAbertura(t, inicio, fim) {
  const vivo = t >= inicio - 0.2 && t <= fim + 0.2;
  abre.style.display = vivo ? 'block' : 'none';
  if (!vivo) return;
  const sai = easeInOut(k(t, fim - 0.55, fim));
  pinosAbre.forEach((d, i) => {
    const t0 = inicio + 0.42 + i * 0.072;
    const e = easeBack(k(t, t0, t0 + 0.42));
    d.style.opacity = (cl(k(t, t0, t0 + 0.18)) * (1 - sai)).toFixed(3);
    d.style.transform = `scale(${(e * (1 - sai * 0.4)).toFixed(3)})`;
  });
}

// ── toques e linha da rota sobre o mapa da montagem ───────────────────────
let toques = [], svgRota = null, pathRota = null, compRota = 0, caminhao = null;
const TOQUE_EM = [10.1, 11.15, 12.2, 13.25, 14.3, 15.35];   // quando cada parada entra
function montarRota() {
  const mapa = cards.mmapa;
  const sel = MPONTOS.pinos.filter((p) => p.sel).sort((a, b) => parseInt(a.rot) - parseInt(b.rot));
  const cd = MPONTOS.pinos.find((p) => p.cd) || { x: .5, y: .5 };
  const L = 1000, H = L * (MPONTOS.h / MPONTOS.w);
  sel.forEach((p) => {
    const d = document.createElement('div'); d.className = 'toque';
    d.style.left = (p.x * L) + 'px'; d.style.top = (p.y * H) + 'px'; d.style.opacity = '0';
    mapa.appendChild(d); toques.push(d);
  });
  svgRota = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgRota.id = 'svg-rota'; svgRota.setAttribute('width', L); svgRota.setAttribute('height', H);
  pathRota = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const pts = [cd, ...sel, cd].map((p) => [p.x * L, p.y * H]);
  pathRota.setAttribute('d', 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L'));
  svgRota.appendChild(pathRota); mapa.appendChild(svgRota);
  compRota = pathRota.getTotalLength();
  pathRota.style.strokeDasharray = compRota; pathRota.style.strokeDashoffset = compRota;
  caminhao = document.createElement('div'); caminhao.className = 'caminhao';
  caminhao.textContent = '🚚'; caminhao.style.opacity = '0'; mapa.appendChild(caminhao);
}
function animarToques(t) {
  toques.forEach((d, i) => {
    const t0 = TOQUE_EM[i];
    const e = k(t, t0, t0 + 0.55);
    d.style.opacity = (e < 1 ? (1 - e) : 0).toFixed(3);
    d.style.transform = `scale(${(0.35 + e * 1.9).toFixed(3)})`;
  });
}
function animarLinha(t, inicio, fim) {
  if (!pathRota) return;
  const e = easeInOut(k(t, inicio, fim));
  pathRota.style.strokeDashoffset = (compRota * (1 - e)).toFixed(1);
  svgRota.style.opacity = t >= inicio - 0.1 ? '1' : '0';
}
function animarCaminhao(t, inicio, fim) {
  if (!caminhao) return;
  const vivo = t >= inicio && t <= fim;
  caminhao.style.opacity = vivo ? cl(k(t, inicio, inicio + 0.3)) * (1 - k(t, fim - 0.3, fim)) : 0;
  if (!vivo) return;
  const p = pathRota.getPointAtLength(compRota * easeInOut(k(t, inicio + 0.2, fim - 0.2)));
  caminhao.style.left = p.x + 'px'; caminhao.style.top = p.y + 'px';
}

// ── o filme ───────────────────────────────────────────────────────────────
function render(t) {
  // fundo: deriva lenta o filme inteiro, é o que costura as cenas
  const f = t / DUR;
  $('#fundo').style.transform = `translate(${(-26 + f * 52).toFixed(1)}px, ${(34 - f * 68).toFixed(1)}px) scale(${(1.1 - f * 0.06).toFixed(4)})`;
  $('#fundo').style.opacity = (0.5 - 0.18 * easeInOut(k(t, 4.2, 6.5))).toFixed(3);

  const marca = $('#marca');
  marca.style.opacity = (0.9 * cl(k(t, 1.6, 2.4)) * (1 - k(t, 33.4, 34.0))).toFixed(3);

  // ─ cena 1: os pedidos do dia caindo no mapa
  if (t < 4.6) { escreverTexto('Suas entregas\ne suas coletas.', 'Todas num mapa só.'); animarTexto(t, 0.5, 4.4); }
  animarAbertura(t, 0.0, 4.5);

  // ─ cena 2: a tela de verdade
  if (t >= 4.6 && t < 8.6) { escreverTexto('Importe o XML\nda nota fiscal.', 'Cada nota vira um ponto no mapa.'); animarTexto(t, 4.8, 8.5); }
  mostrar('mapa22', t, 4.8, 8.7, 150);

  // ─ cena 3: montar a rota tocando no mapa (o destaque)
  if (t >= 8.6 && t < 16.0) { escreverTexto('Monte a rota\ntocando no mapa.', 'A ordem dos toques é a ordem das paradas.'); animarTexto(t, 8.8, 19.6); }
  else if (t >= 16.0 && t < 19.6) { escreverTexto('O peso soma\nenquanto você escolhe.', 'Contra a capacidade do veículo, ao vivo.'); animarTexto(t, 16.1, 19.6); }
  mostrar('mpainel', t, 8.9, 19.7, 0);
  mostrar('mmapa', t, 9.1, 23.6, 232);
  mostrar('mordem', t, 16.6, 19.7, 758);
  { // os passos reais: mapa e painel trocam logo depois de cada toque
    let n = 0; TOQUE_EM.forEach((x) => { if (t >= x + 0.2) n++; });
    passo('mmapa', 'm-mapa-' + n); passo('mpainel', 'm-painel-' + n);
  }
  animarToques(t);

  // ─ cena 4: a rota se desenhando, na ordem escolhida
  if (t >= 19.6 && t < 23.6) { escreverTexto('A ordem é sua.', 'O sistema mede os quilômetros e o horário de cada parada.'); animarTexto(t, 19.8, 23.5); }
  animarLinha(t, 19.9, 22.3);
  animarCaminhao(t, 22.2, 23.5);

  // ─ cena 5: a rota automática existe também
  if (t >= 23.6 && t < 26.6) { escreverTexto('Confira e mande\npara a rua.', 'Km, horário de cada parada e peso, antes de confirmar.'); animarTexto(t, 23.8, 26.5); }
  mostrar('resultado', t, 23.9, 26.7, 60, { escala: 1 });

  // ─ cena 6: o motorista
  if (t >= 26.6 && t < 32.2) { escreverTexto('O motorista recebe\npelo WhatsApp.', 'Baixa com foto do canhoto e localização ao vivo.'); animarTexto(t, 26.8, 32.1); }
  mostrar('vivo', t, 26.9, 32.3, 0);
  mostrar('fone', t, 27.4, 32.3, 300, { desloca: 120 });

  // ─ cena 7: relatório
  if (t >= 32.2 && t < 34.2) { escreverTexto('E o relatório do dia,\npronto.', 'O que saiu, o que foi entregue, o que não foi.'); animarTexto(t, 32.3, 34.1); }
  mostrar('relatorio', t, 32.4, 34.3, 120);

  // ─ cena 8: a marca
  const fim = $('#fim');
  const ef = easeOut(k(t, 34.0, 34.7));
  fim.style.opacity = ef.toFixed(3);
  fim.style.transform = `scale(${(0.985 + ef * 0.015).toFixed(4)})`;
  if (t >= 34.0) texto.style.opacity = (1 - ef).toFixed(3); else texto.style.opacity = '1';
}

// ── preparar ──────────────────────────────────────────────────────────────
async function preparar() {
  const b64 = await (await fetch('mapa-fundo.b64')).text();
  $('#fundo').style.backgroundImage = `url("data:image/svg+xml;base64,${b64.trim()}")`;
  PONTOS = await (await fetch('telas/pontos.json')).json();
  MPONTOS = await (await fetch('telas/m-pontos.json')).json();
  montarAbertura();
  card('mapa22', '02b-mapa', 1000);
  const pa = card('mpainel', 'm-painel-0', 1000);
  pa.style.height = '182px';
  card('mmapa', 'm-mapa-0', 1000);
  card('mordem', 'm-ordem', 1000);
  card('resultado', 'm-resultado', 1000);
  card('vivo', '11b-mapa', 1000);
  card('fone', '13-motorista', 392, 'fone');
  card('relatorio', '12b-corpo', 1000);
  cards.mordem.style.height = '336px';
  cards.resultado.style.height = '660px';
  cards.resultado.querySelector('img').style.marginTop = '-132px';
  cards.vivo.style.height = '404px';
  cards.relatorio.style.height = '560px';
  montarRota();
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
  render(0);
}
window.__dur = DUR;
window.__render = render;
window.__pronto = preparar();
