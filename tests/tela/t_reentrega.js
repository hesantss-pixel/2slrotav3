// Reentrega com prioridade: o "não realizado" do motorista conta a tentativa e põe o pedido na
// situação certa para o motivo (fila com prioridade, aguarda endereço, aguarda instrução);
// quem espera não entra na roteirização; a fila vai com prioridade para o motor de rotas;
// liberar e corrigir o endereço devolvem para a fila; relatório mostra as reentregas. Dados fictícios.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
const TOK = 'tokReentrega0123456789ab';
const agora = Date.now();
const g = (lat) => ({ cidade: 'Guarulhos', uf: 'SP', geoStatus: 'ok', lat, lng: -46.52, peso: 50, itens: 1 });
const desp = (id, nf, lat, extra) => ({ id, nf, tipo: 'entrega', status: 'despachado', rota_atual: 'R1', dest: 'Cliente ' + nf, endereco: 'Rua Teste, ' + nf, cep: '07000000', ...g(lat), ...(extra || {}) });
const paradas = ['A', 'B', 'C', 'D', 'E'].map((k, i) => ({ id: k, nf: '70' + i, dest: 'Cliente 70' + i, cidade: 'Guarulhos', lat: -23.45 - i / 100, lng: -46.52, peso: 50, tipo: 'entrega' }));
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  rotas_confirmadas: { R1: { id: 'R1', token: TOK, criada_em: new Date(agora - 3600e3).toISOString(), data: new Date().toISOString().slice(0, 10), veiculo: 'VUC', motorista: 'Motorista A', paradas, num_paradas: 5 } },
  pedidos_rota: {
    A: desp('A', '700', -23.45),
    B: desp('B', '701', -23.46),
    C: desp('C', '702', -23.47),
    D: desp('D', '703', -23.48),
    E: desp('E', '704', -23.49, { tentativas: 2 }),          // já falhou 2 vezes: a 3ª vira "aguarda instrução"
    N: { id: 'N', nf: '800', tipo: 'entrega', status: 'pendente', dest: 'Pedido novo', ...g(-23.44) },
  },
  entregador: { [TOK]: { eid: 'emp1', expira: agora + 864e5, baixas: {
    0: { status: 'nao_feito', motivo: 'Cliente ausente', obs: 'ninguém atendeu', hora: agora - 1800e3 },
    1: { status: 'nao_feito', motivo: 'Endereço não encontrado', hora: agora - 1700e3 },
    2: { status: 'nao_feito', motivo: 'Recusado pelo cliente', hora: agora - 1600e3 },
    3: { status: 'nao_feito', motivo: 'Não deu tempo na rota', hora: agora - 1500e3 },
    4: { status: 'nao_feito', motivo: 'Cliente ausente', hora: agora - 1400e3 },
  } } },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const peds = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1.pedidos_rota);

(async () => {
  const b = await chromium.launch();
  const reqs = [];
  const rotas = async (c) => {
    await c.route(/nominatim|viacep|maps\.googleapis/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await c.route(/railway\.app\/solve/, async (r) => {
      const body = JSON.parse(r.request().postData()); reqs.push(body);
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: 'VUC', veiculo_id: 'vuc', pedidos: body.pedidos, km: 12, mins: 90 }], nao_alocados: [], fonte_distancia: 'OSRM' }) });
    });
  };
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, rotas);
  p.on('dialog', (d) => d.accept());
  await p.waitForTimeout(1500);   // as baixas da rota chegam e são aplicadas
  let d = await peds(p);
  ok(d.A.status === 'pendente' && d.A.tentativas === 1 && d.A.reentrega && d.A.reentrega.sit === 'fila' && d.A.reentrega.prio === 2 && d.A.reentrega.resp === 'dest',
    'cliente ausente: volta para a fila com prioridade, 1ª tentativa contada: ' + J(d.A.reentrega));
  ok(d.B.reentrega && d.B.reentrega.sit === 'endereco', 'endereço não encontrado: aguarda correção do endereço');
  ok(d.C.reentrega && d.C.reentrega.sit === 'instrucao' && !d.C.reentrega.limite, 'recusado: aguarda instrução do embarcador');
  ok(d.D.reentrega && d.D.reentrega.sit === 'fila' && d.D.reentrega.prio === 3 && d.D.reentrega.resp === 'transp', 'não deu tempo: prioridade máxima, responsabilidade da transportadora');
  ok(d.E.tentativas === 3 && d.E.reentrega.sit === 'instrucao' && d.E.reentrega.limite === true, '3ª tentativa sem sucesso: para e aguarda instrução, mesmo sendo "cliente ausente"');
  ok(d.A.ocorrencia && d.A.ocorrencia.motivo === 'Cliente ausente' && d.A.ocorrencia.obs === 'ninguém atendeu', 'a ocorrência continua guardada');

  // Pedidos: marcas
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelectorAll('.rc-card').forEach((c) => c.classList.add('exp')));
  const txt = await p.textContent('#reg-cards-grid');
  ok(/2ª tentativa/.test(txt) && /Aguarda endereço/.test(txt) && /Aguarda instrução/.test(txt), 'a lista de pedidos marca reentrega e espera');

  // abrir B, corrigir o endereço: libera
  await p.evaluate(() => window.abrirPedido('B')); await p.waitForTimeout(500);
  ok(await p.isVisible('#ped-reent') && /Endereço não encontrado: corrija o endereço/.test(await p.textContent('#ped-reent')), 'o pedido explica o que fazer');
  await p.fill('#ped-end', 'Rua Corrigida, 99');
  await p.click('#ped-salvar'); await p.waitForTimeout(800);
  d = await peds(p);
  ok(d.B.reentrega.sit === 'fila', 'corrigir o endereço devolve para a fila: ' + J(d.B.reentrega));
  // abrir E (limite) e liberar
  await p.evaluate(() => window.abrirPedido('E')); await p.waitForTimeout(500);
  ok(/3 tentativas sem sucesso/.test(await p.textContent('#ped-reent')) && await p.isVisible('#ped-liberar'), 'no limite, mostra as tentativas e o botão Liberar');
  await p.click('#ped-liberar'); await p.waitForTimeout(500);
  d = await peds(p);
  ok(d.E.reentrega.sit === 'fila' && d.E.reentrega.liberado === true && !d.E.reentrega.limite, 'Liberar põe na fila (mais uma tentativa)');
  await p.evaluate(() => window.fecharPedido && window.fecharPedido());

  // Roteirização: C (aguarda instrução) fica de fora; fila vai com prioridade
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(400);
  await p.click('#veh-grid .veh-card >> nth=1'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '3000');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  const conf = await p.textContent('#confirm-details-d');
  ok(/Reentregas: 4/.test(conf) && /1 pedido aguarda endereço ou instrução e fica de fora/.test(conf), 'confirmação: reentregas e quem fica de fora: ' + (conf.match(/Reentregas[^]*/) || [''])[0]);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(1200);
  const ped = reqs[0] && reqs[0].pedidos;
  const pr = ped ? Object.fromEntries(ped.map((x) => [x.id, x.prioridade || 0])) : {};
  ok(ped && !('C' in pr) && pr.A === 2 && pr.B === 2 && pr.D === 3 && pr.E === 2 && pr.N === 0, 'o motor recebe a prioridade de cada reentrega e não recebe quem espera: ' + J(pr));
  ok(/2ª tentativa/.test(await p.textContent('#rot-step-results')), 'a rota mostra a marca de reentrega nas paradas');

  // Relatórios
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(400);
  const rel = await p.textContent('#rel-corpo');
  ok(/Reentregas/.test(rel) && /1 aguarda instrução do embarcador/.test(rel) && /5 tentativas sem sucesso/.test(rel) && /4 por motivo do destinatário ou do embarcador/.test(rel) && /1 da transportadora/.test(rel),
    'relatório: o que espera agora e as tentativas do período por responsável: ' + (rel.match(/Reentregas[^]*?contrato prevê\./) || [''])[0].slice(0, 300));
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
