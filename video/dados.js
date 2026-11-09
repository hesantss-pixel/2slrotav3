// Dados de demonstração para as capturas do vídeo: uma transportadora pequena de
// Guarulhos, com entregas e coletas no Alto Tietê. Nenhum cliente real.
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const P = (nf, tipo, dest, bairro, cidade, peso, itens, lat, lng, extra = {}) =>
  ({ nf, tipo, dest, bairro, cidade, uf: 'SP', peso, itens, status: 'pendente', lat, lng, geoStatus: 'ok', ...extra });
const LISTA = [
  P('18422', 'entrega', 'Mercado São Jorge', 'Centro', 'Guarulhos', 480, 6, -23.4612, -46.5330),
  P('18423', 'entrega', 'Padaria Vila Galvão', 'Vila Galvão', 'Guarulhos', 120, 2, -23.4380, -46.5510),
  P('18424', 'entrega', 'Farmácia Bonsucesso', 'Bonsucesso', 'Guarulhos', 65, 1, -23.4010, -46.4120),
  P('18425', 'entrega', 'Atacado Cumbica', 'Cumbica', 'Guarulhos', 940, 11, -23.4388, -46.4060),
  P('18426', 'entrega', 'Loja Taboão', 'Taboão', 'Guarulhos', 210, 3, -23.4705, -46.4890),
  P('18427', 'entrega', 'Mercadinho Pimentas', 'Pimentas', 'Guarulhos', 330, 4, -23.4520, -46.4240),
  P('18428', 'entrega', 'Depósito Jd. Presidente', 'Jd. Presidente Dutra', 'Guarulhos', 560, 7, -23.4150, -46.4480),
  P('18429', 'entrega', 'Casa de Carnes Itaquá', 'Vila Virgínia', 'Itaquaquecetuba', 275, 3, -23.4860, -46.3480),
  P('18430', 'entrega', 'Mercado Scaffid', 'Scaffid', 'Itaquaquecetuba', 410, 5, -23.4790, -46.3610),
  P('18431', 'entrega', 'Padaria Arujá', 'Centro', 'Arujá', 95, 2, -23.3960, -46.3210),
  P('18432', 'entrega', 'Conveniência Barreto', 'Barreto', 'Arujá', 140, 2, -23.3820, -46.3050),
  P('18433', 'entrega', 'Supermercado Suzano', 'Vila Urupês', 'Suzano', 620, 8, -23.5420, -46.3120),
  P('18434', 'entrega', 'Loja Jd. Cumbica', 'Jd. Cumbica', 'Guarulhos', 180, 2, -23.4290, -46.3680),
  P('18435', 'entrega', 'Mercearia Bananal', 'Bananal', 'Guarulhos', 90, 1, -23.4480, -46.5120),
  P('18436', 'entrega', 'Restaurante Macedo', 'Macedo', 'Guarulhos', 155, 2, -23.4530, -46.5420),
  P('18437', 'entrega', 'Distribuidora Ponte Grande', 'Ponte Grande', 'Guarulhos', 720, 9, -23.4700, -46.5600),
  P('21180', 'coleta', 'Indústria Scaffid', 'Scaffid', 'Itaquaquecetuba', 380, 4, -23.4772, -46.3585),
  P('21181', 'coleta', 'Metalúrgica Cumbica', 'Cumbica', 'Guarulhos', 240, 3, -23.4350, -46.4005),
  P('21182', 'coleta', 'Confecção Pimentas', 'Pimentas', 'Guarulhos', 110, 2, -23.4560, -46.4190),
  P('21183', 'coleta', 'Gráfica Vila Augusta', 'Vila Augusta', 'Guarulhos', 165, 2, -23.4410, -46.5190),
  P('18438', 'entrega', 'Pet Shop Jd. Rosa', 'Jd. Santa Rosa', 'Guarulhos', 70, 1, -23.4120, -46.5280, { geoStatus: 'cep', geoPrec: 'bairro' }),
  P('18439', 'entrega', 'Mercado Água Chata', 'Água Chata', 'Guarulhos', 290, 4, -23.4060, -46.4760),
];
const PEDIDOS = {};
LISTA.forEach((p) => { PEDIDOS[(p.tipo === 'coleta' ? 'C_' : '') + p.nf] = p; });

const TOKEN = 'demo-video-token-rotav3x';
const ROTA = {
  id: 'r-video-1', data: '2026-11-09', veiculo: 'Truck Toco', cap_kg: 3000,
  motorista: 'Marcos A.', km: 68.4, mins: 262, fonte_dist: 'OSRM', montagem: 'manual',
  criada: Date.now() - 3600e3, status: 'ativa', token: TOKEN,
  paradas: ['18425', '18428', 'C_21181', '18427', 'C_21182', '18430'].map((nf, i) => ({
    nf, ordem: i + 1, ...(PEDIDOS[nf] ? { dest: PEDIDOS[nf].dest, cidade: PEDIDOS[nf].cidade, bairro: PEDIDOS[nf].bairro,
      peso: PEDIDOS[nf].peso, itens: PEDIDOS[nf].itens, tipo: PEDIDOS[nf].tipo, lat: PEDIDOS[nf].lat, lng: PEDIDOS[nf].lng } : {}),
    chegada_min: 450 + i * 42 })),
};
module.exports = { CD, PEDIDOS, ROTA, TOKEN };
