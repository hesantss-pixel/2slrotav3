// Regras do banco (firebase/database.rules.json) para o que entrou na 3.12:
// km do painel com foto, caminho pelo GPS, GPS da baixa e o ajuste de tempo por empresa.
// Usa o avaliador simplificado de regras.js (sem o emulador do Firebase).
const { pode } = require('./regras');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

const now = Date.now();
const ADMIN = { uid: 'PGblgW7V26SJ6W8UYPFj3dqlDGm2' }, ANA = { uid: 'uid-ana' }, BIA = { uid: 'uid-bia' };
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv', VENCIDO = 'ZyXwVuTsRqPoNmLkJiHgFe';
const banco = {
  acesso: { [ADMIN.uid]: true, 'uid-ana': true, 'uid-bia': true },
  membros: { [ADMIN.uid]: 'principal', 'uid-ana': 'emp1', 'uid-bia': 'emp2' },
  empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD', lat: -23.4, lng: -46.4 } } }, emp2: { info: { nome: 'Emp 2' } } },
  entregador: {
    [TOKEN]: { eid: 'emp1', expira: now + 3600e3, paradas: [{ nf: '1' }, { nf: '2' }], trilha: { k0: { lat: -23.4, lng: -46.4, t: now - 60e3 } } },
    [VENCIDO]: { eid: 'emp1', expira: now - 1000, paradas: [{ nf: '1' }] },
  },
};
const W = (caminho, valor, auth = null) => pode('write', banco, caminho, valor, { auth, now });
const R = (caminho, auth = null) => pode('read', banco, caminho, undefined, { auth, now });
const E = (s) => `entregador/${TOKEN}/${s}`;
const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(1000);

// ── km do painel ──────────────────────────────────────────────────────────
ok(W(E('hodometro/ini'), { km: 123456, hora: now, temFoto: true }), 'motorista (sem login) grava o km da saída pelo link');
ok(W(E('hodometro/fim'), { km: 123500.5, hora: now, temFoto: false }), 'e o km da chegada, com decimal');
ok(!W(E('hodometro/meio'), { km: 1, hora: now }), 'só "ini" e "fim" existem');
ok(!W(E('hodometro/ini'), { km: -1, hora: now }), 'km negativo é recusado');
ok(!W(E('hodometro/ini'), { km: '123', hora: now }), 'km em texto é recusado');
ok(!W(E('hodometro/ini'), { km: 1 }), 'sem a hora é recusado');
ok(!W(E('hodometro/ini'), { km: 1, hora: now, nome: 'x' }), 'campo a mais é recusado');
ok(!W(E('hodometro/ini'), { km: 1, hora: now + 3600e3 }), 'hora no futuro é recusada');
ok(!W(`entregador/${VENCIDO}/hodometro/ini`, { km: 1, hora: now }), 'link vencido não grava km');
ok(W(E('fotos_hod/ini'), jpeg), 'foto do painel em JPEG é aceita');
ok(!W(E('fotos_hod/ini'), 'data:image/png;base64,AAAA'), 'foto que não é JPEG é recusada');
ok(!W(E('fotos_hod/ini'), 'data:image/jpeg;base64,' + 'A'.repeat(400000)), 'foto grande demais é recusada');
ok(!W(E('fotos_hod/x'), jpeg), 'foto só de "ini" ou "fim"');

// ── caminho pelo GPS ──────────────────────────────────────────────────────
const pt = { lat: -23.45, lng: -46.53, t: now, acc: 12, v: 8.3 };
ok(W(E('trilha/k1'), pt), 'ponto do caminho é aceito');
ok(W(E('trilha/k2'), { lat: -23.45, lng: -46.53, t: now - 5 * 60e3 }), 'sem precisão e velocidade também (são opcionais)');
ok(!W(E('trilha/k0'), pt), 'ponto já gravado não pode ser trocado (só acrescenta)');
ok(!W(E('trilha/k0'), null), 'nem apagado pelo link');
ok(!W(E('trilha/k3'), { ...pt, t: now + 20 * 60e3 }), 'hora 20 min no futuro é recusada');
ok(W(E('trilha/k3'), { ...pt, t: now + 5 * 60e3 }), 'relógio do celular 5 min adiantado ainda passa');
ok(!W(E('trilha/k3'), { ...pt, t: now - 3 * 864e5 }), 'ponto de 3 dias atrás é recusado');
ok(!W(E('trilha/k3'), { ...pt, lat: 95 }), 'latitude impossível é recusada');
ok(!W(E('trilha/k3'), { ...pt, extra: 1 }), 'campo a mais é recusado');
ok(!W(E('trilha/k3'), { lat: -23.4, lng: -46.4 }), 'sem a hora é recusado');
ok(!W(`entregador/${VENCIDO}/trilha/k1`, pt), 'link vencido não grava caminho');

// ── GPS da baixa ──────────────────────────────────────────────────────────
ok(W(E('gps/0'), { lat: -23.45, lng: -46.53, precisao: 12 }), 'GPS da baixa com a precisão é aceito');
ok(!W(E('gps/5'), { lat: -23.45, lng: -46.53, precisao: 12 }), 'só para paradas que existem na rota');
ok(!W(E('gps/0'), { lat: -23.45, lng: -46.53 }), 'sem a precisão é recusado');
ok(!W(E('gps/0'), { lat: -23.45, lng: -46.53, precisao: -3 }), 'precisão negativa é recusada');

// ── o que já existia continua valendo ─────────────────────────────────────
ok(W(E('baixas/0'), { status: 'feito', hora: now, lat: -23.45, lng: -46.53 }), 'baixa continua aceita');
ok(!W(E('baixas/0'), { status: 'feito', hora: now, precisao: 10 }), 'baixa continua sem aceitar campo a mais (a precisão vai em gps/)');
ok(W(E('posicao'), { lat: -23.45, lng: -46.53, precisao: 10, hora: now }), 'posição ao vivo continua aceita');

// ── escritório lê o que o motorista mandou ────────────────────────────────
ok(R(E('trilha'), ANA), 'escritório da empresa lê o caminho');
ok(R(`entregador/${VENCIDO}/hodometro`, ANA), 'e lê o km mesmo depois que o link venceu');
ok(!R(`entregador/${VENCIDO}/hodometro`, BIA), 'outra empresa não lê o link vencido');
ok(!R(`entregador/${VENCIDO}/hodometro`), 'nem quem não entrou no sistema');

// ── ajuste de tempo e CD: só o administrador ─────────────────────────────
ok(!W('empresas/emp1/config/fator_tempo', 1.3, ANA), 'cliente não muda o ajuste de tempo da própria empresa');
ok(W('empresas/emp1/config/fator_tempo', 1.3, ADMIN), 'administrador muda o ajuste de tempo');
ok(R('empresas/emp1/config/fator_tempo', ANA), 'cliente lê o ajuste de tempo');
ok(!R('empresas/emp1/config/fator_tempo', BIA), 'outra empresa não lê');
ok(!W('empresas/emp1/config/deposito', { nome: 'X', lat: 0, lng: 0 }, ANA), 'cliente não troca o CD');
ok(W('empresas/emp1/config/locais/rua-a-10', { lat: -23.4, lng: -46.4, p: 'aprendido' }, ANA), 'cliente grava pino aprendido em config/locais');
ok(W('empresas/emp1/rotas_confirmadas/r1/km_painel', { ini: 1, fim: 2, km: 1 }, ANA), 'cliente guarda o km do painel na rota');
ok(!W('empresas/emp2/rotas_confirmadas/r1/km_painel', { ini: 1, fim: 2, km: 1 }, ANA), 'mas não na rota de outra empresa');

// ── app de separação (2sl-pedidos): pasta pedidos, só para conta liberada ──
ok(R('pedidos', ANA) && W('pedidos/123', { nf: '123' }, ANA), 'conta liberada lê e grava em pedidos (app de separação)');
ok(!R('pedidos') && !W('pedidos/123', { nf: '123' }), 'sem login não lê nem grava em pedidos');
ok(!R('pedidos', { uid: 'uid-demo' }), 'conta não liberada não lê pedidos');
ok(!R('pedidos_side', ANA), 'pedidos_side continua fechada');

console.log(falhas ? `${falhas} falha(s)` : 'regras ok');
