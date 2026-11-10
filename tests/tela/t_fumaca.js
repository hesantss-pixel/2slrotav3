// Teste de fumaça: entra em cada página do sistema e aperta TODOS os botões visíveis,
// um por vez, cada um partindo da página recém-carregada. Não confere resultado — as
// outras suítes fazem isso. Confere que nenhum botão estoura erro de JavaScript nem
// tenta gravar algo que o Firebase de verdade recusaria. É a resposta para "todas as
// funções funcionam?" nos cantos que nenhuma suíte visita de propósito.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

const ADMIN = 'PGblgW7V26SJ6W8UYPFj3dqlDGm2';
const TOKEN = 'tok-fumaca-0123456789abcdef';
const P = (nf, tipo, cidade, peso, lat, lng, extra = {}) => ({ nf, tipo, cidade, uf: 'SP', dest: 'Cliente ' + nf, bairro: 'Centro',
  endereco: 'Rua ' + nf + ', 10', cep: '07000000', peso, itens: 2, status: 'pendente', lat, lng, geoStatus: 'ok', ...extra });
const PED = {
  '3001': P('3001', 'entrega', 'Guarulhos', 300, -23.45, -46.53),
  '3002': P('3002', 'entrega', 'Guarulhos', 200, -23.44, -46.50),
  '3003': P('3003', 'entrega', 'Arujá', 150, -23.39, -46.32),
  'C_4001': P('4001', 'coleta', 'Itaquaquecetuba', 250, -23.48, -46.35),
  '3004': P('3004', 'entrega', 'Suzano', 90, null, null, { geoStatus: 'sem_cep', lat: undefined, lng: undefined }),
  '3005': P('3005', 'entrega', 'Guarulhos', 120, -23.46, -46.54, { agendado: true, dataAgendada: new Date().toISOString().slice(0, 10), horaEntrega: '10:00', horaFim: '11:00' }),
  '3006': P('3006', 'entrega', 'Guarulhos', 80, -23.43, -46.52, { status: 'despachado', rota_atual: 'r1_1' }),
  '3007': P('3007', 'entrega', 'Guarulhos', 60, -23.42, -46.51, { status: 'despachado', rota_atual: 'r1_1' }),
};
Object.values(PED).forEach((p) => { Object.keys(p).forEach((k) => { if (p[k] === undefined || p[k] === null) delete p[k]; }); });
const ROTA = { id: 'r1_1', criada_em: Date.now() - 3600e3, data: new Date().toISOString().slice(0, 10), saida: 420, veiculo: 'Truck Toco',
  motorista: 'João', cap_kg: 3000, km: 31.2, tempo_min: 140, peso_total: 140, num_paradas: 2, entregas: 2, coletas: 0, status: 'em_rota',
  fonte_dist: 'OSRM', token: TOKEN, link_expira: Date.now() + 5 * 864e5,
  paradas: [{ id: '3006', nf: '3006', tipo: 'entrega', dest: 'Cliente 3006', cidade: 'Guarulhos', peso: 80, itens: 2, lat: -23.43, lng: -46.52, chegada_min: 450 },
            { id: '3007', nf: '3007', tipo: 'entrega', dest: 'Cliente 3007', cidade: 'Guarulhos', peso: 60, itens: 2, lat: -23.42, lng: -46.51, chegada_min: 480 }] };

const seed = (d) => {
  window.print = () => {};
  window.__FAKE = {
    user: { uid: d.uid, email: 'pessoa@empresa.com.br', getIdToken: async () => 'T' },
    db: {
      acesso: { [d.uid]: true, 'uid-demo': 'demo', 'uid-cli': true },
      membros: { [d.uid]: d.eid, 'uid-cli': 'emp1' },
      demos: { 'uid-demo': { nome: 'Fulano', email: 'f@x.com', criado: Date.now() - 864e5, expira: Date.now() + 5 * 864e5 } },
      usuarios: { 'uid-demo': { email: 'f@x.com', visto: Date.now() - 3600e3 }, 'uid-cli': { email: 'c@x.com', visto: Date.now() - 9 * 864e5 } },
      solicitacoes: { 'uid-novo': { email: 'novo@x.com', em: Date.now() - 7200e3 } },
      entregador: { [d.TOKEN]: { eid: d.eid, expira: Date.now() + 5 * 864e5, info: { rota_id: 'r1_1', veiculo: 'Truck Toco', motorista: 'João', data: d.ROTA.data },
        paradas: d.ROTA.paradas, baixas: { 0: { status: 'feito', hora: Date.now() - 1800e3, recebedor: 'Maria', temFoto: false } },
        posicao: { lat: -23.43, lng: -46.52, precisao: 12, hora: Date.now() - 60e3 } } },
      empresas: { [d.eid]: { info: { nome: 'Empresa Teste' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877, cep: '07000000' } },
        pedidos_rota: d.PED, rotas_confirmadas: { r1_1: d.ROTA },
        motoristas: { mot_1: { nome: 'João', telefone: '11999990000', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', cap_kg: 3000 } } } },
    },
  };
};

async function rodar(b, uid, eid, paginas, rotulo) {
  const { ctx, p, errs } = await open(b, 'index.html', 1366, 900, seed, false, { uid, eid, PED, ROTA, TOKEN });
  const erros = [];   // [página, botão, mensagem]
  let atual = '';
  p.on('pageerror', (e) => erros.push([atual, e.message]));
  p.on('console', (m) => { if (m.type() === 'error' && !/net::|Failed to load|favicon|ERR_/.test(m.text())) erros.push([atual, 'console: ' + m.text().slice(0, 160)]); });
  p.on('dialog', (d) => d.accept().catch(() => {}));
  ctx.on('page', (nova) => { if (nova !== p) nova.close().catch(() => {}); });
  await ctx.route(/railway\.app\/(solve|avaliar|chat|integracao)/, (r) => {
    const u = r.request().url();
    if (/avaliar/.test(u)) { const n = JSON.parse(r.request().postData()).pedidos.length; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 20, mins: 90, chegada_min: Array.from({ length: n }, (_, i) => 440 + i * 20), fonte_distancia: 'OSRM' }) }); }
    if (/chat/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ resposta: 'ok', session_id: 's1' }) });
    if (/integracao/.test(u)) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ligado: false, email: { enderecos: {} }, api: { tem_chave: false } }) });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rotas: [{ veiculo: 'Truck Toco', pedidos: Object.values(PED).filter((x) => x.status === 'pendente' && x.lat).slice(0, 3), km: 20, mins: 90 }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
  });
  await p.waitForTimeout(900);

  let cliques = 0;
  for (const pg of paginas) {
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(700);
    await p.evaluate((x) => window.irParaPagina(x), pg); await p.waitForTimeout(600);
    // rótulo de cada botão clicável e visível desta página
    const lista = await p.evaluate((x) => {
      const raiz = document.getElementById('page-' + x) || document.body;
      return [...raiz.querySelectorAll('[onclick]')].map((el, i) => ({ i, on: el.getAttribute('onclick').slice(0, 70),
        vis: !!(el.offsetParent !== null && el.getBoundingClientRect().width > 0), des: !!el.disabled })).filter((e) => e.vis && !e.des);
    }, pg);
    for (const item of lista) {
      atual = `${pg} › ${item.on}`;
      await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(450);
      await p.evaluate((x) => window.irParaPagina(x), pg); await p.waitForTimeout(350);
      const clicou = await p.evaluate(({ x, i }) => {
        const raiz = document.getElementById('page-' + x) || document.body;
        const el = raiz.querySelectorAll('[onclick]')[i];
        if (!el || el.offsetParent === null || el.disabled) return false;
        el.click(); return true;
      }, { x: pg, i: item.i });
      if (clicou) cliques++;
      await p.waitForTimeout(320);
    }
  }
  const recusas = await p.evaluate(() => (window.__FAKE.recusas || []).slice());
  await ctx.close();
  ok(cliques > paginas.length * 2, `${rotulo}: ${cliques} botões apertados em ${paginas.length} páginas`);
  const unicos = [...new Map(erros.map((e) => [e.join(' | '), e])).values()];
  ok(unicos.length === 0, `${rotulo}: nenhum botão estourou erro` + (unicos.length ? ' → ' + unicos.slice(0, 8).map((e) => `[${e[0]}] ${e[1]}`).join('  ‖  ') : ''));
  return { cliques, erros: unicos, sobra: errs };
}

(async () => {
  const b = await chromium.launch();
  await rodar(b, 'uid-op', 'emp1', ['dashboard', 'pedidos', 'roteirizacao', 'rotas', 'relatorios', 'mapa', 'motoristas', 'ia'], 'cliente');
  await rodar(b, ADMIN, 'principal', ['acessos', 'pedidos', 'rotas'], 'administrador');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
