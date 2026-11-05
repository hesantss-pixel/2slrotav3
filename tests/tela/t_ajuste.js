// Pedido à mão (cadastrar, editar, excluir, corrigir local) e ajuste manual da rota
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 };
const PED = {
  '1001': { nf: '1001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Mercado A', peso: 200, itens: 2, status: 'pendente', lat: -23.45, lng: -46.53, geoStatus: 'ok', cep: '07010000' },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja B', peso: 150, itens: 1, status: 'pendente', lat: -23.44, lng: -46.50, geoStatus: 'ok', chave: '35261012345678000199550010000010021000000001', remetente: 'Fábrica X' },
  '1003': { nf: '1003', tipo: 'entrega', cidade: 'Arujá', dest: 'Padaria C', peso: 300, itens: 3, status: 'pendente', lat: -23.39, lng: -46.32, geoStatus: 'ok' },
  'C_2001': { nf: '2001', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria D', peso: 100, itens: 1, status: 'pendente', lat: -23.48, lng: -46.35, geoStatus: 'sem_cep' },
  '9009': { nf: '9009', tipo: 'entrega', cidade: 'Guarulhos', peso: 50, itens: 1, status: 'entregue', lat: -23.45, lng: -46.53, geoStatus: 'ok' },
};
const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'TOKEN-ANA' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' }, empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};
const db = (p) => p.evaluate(() => JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1)));

async function mockServicos(ctx, reg) {
  await ctx.route(/viacep\.com\.br\/ws\/(\d+)/, (r) => {
    const cep = r.request().url().match(/ws\/(\d+)/)[1];
    reg.viacep.push(cep);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(cep === '07010000' ? { logradouro: 'Rua Teste', bairro: 'Centro', localidade: 'Guarulhos', uf: 'SP' } : { erro: true }) });
  });
  await ctx.route(/nominatim\.openstreetmap\.org/, (r) => {
    const u = new URL(r.request().url()), st = u.searchParams.get('street') || '';
    reg.nom.push(u.searchParams.get('q') || `${st}, ${u.searchParams.get('city') || ''}`);
    const casa = (st.match(/^(\d+) /) || [])[1];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ lat: '-23.4612', lon: '-46.5311', address: { road: 'Rua Teste', ...(casa ? { house_number: casa } : {}) } }]) });
  });
  await ctx.route(/railway\.app\/solve/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.solve.push(body);
    let pedidos = body.pedidos.slice();
    // 1ª chamada (gerar): leva as 3 primeiras; "otimizar": devolve ao contrário
    if (reg.solve.length === 1) pedidos = pedidos.slice(0, 3); else pedidos = pedidos.reverse();
    pedidos = pedidos.map((p, i) => ({ ...p, chegada_min: 420 + 20 * (i + 1) }));
    const nao = body.pedidos.filter((p) => !pedidos.find((x) => x.id === p.id)).map((p) => p.nf);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ routes: [{ veiculo: 'Fiorino', veiculo_id: 'fiorino', pedidos, km: 31.5, mins: 140 }], nao_alocados: nao, fonte_distancia: 'OSRM', regra_carga: 'entregas_antes_das_coletas', salvo: false }) });
  });
  await ctx.route(/railway\.app\/avaliar/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.avaliar.push(body);
    if (reg.avaliarFalha) return r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"x"}' });
    const n = body.pedidos.length;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 40 + n, mins: 100 + n, chegada_min: body.pedidos.map((_, i) => 430 + 30 * i), fonte_distancia: 'OSRM', passa_da_jornada: false }) });
  });
}

(async () => {
  const b = await chromium.launch();
  const reg = { viacep: [], nom: [], solve: [], avaliar: [], dialogs: [] };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  await mockServicos(ctx, reg);
  let resposta = true;
  p.on('pageerror', (e) => console.log('STACK', (e.stack||'').split('\n').slice(0,7).join(' | ')));
  p.on('dialog', (d) => { reg.dialogs.push(d.message()); resposta ? d.accept() : d.dismiss(); });
  await p.waitForTimeout(700);

  // ── A. Pedido à mão ──────────────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  ok(await p.isVisible('#btn-novo-pedido'), 'Pedidos: botão "Novo pedido" ao lado de "Importar notas"');
  ok((await p.textContent('#ped-aprox')).includes('1 pedido está sem local exato (no mapa, fica no centro do bairro ou da cidade)'), 'aviso: 1 pedido sem local exato (C_2001, sem CEP)');
  await p.click('#btn-novo-pedido'); await p.waitForTimeout(250);
  ok(await p.isVisible('#modal-pedido'), 'modal "Novo pedido" abre');
  ok(await p.evaluate(() => document.activeElement.id === 'ped-nf'), 'foco vai para o campo da nota');
  await p.click('#ped-salvar'); await p.waitForTimeout(100);
  ok((await p.textContent('#ped-msg')).includes('Informe o número') && (await p.getAttribute('#ped-nf', 'aria-invalid')) === 'true', 'sem número: erro claro e campo marcado');
  await p.click('#ped-tipo button[data-t="coleta"]');
  ok((await p.textContent('#ped-dest-lbl')).includes('Remetente'), 'tipo coleta: rótulo vira "Remetente"');
  await p.fill('#ped-nf', '5005');
  await p.fill('#ped-cep', '07010000'); await p.press('#ped-cep', 'Tab'); await p.waitForTimeout(300);
  ok((await p.inputValue('#ped-cidade')) === 'Guarulhos' && (await p.inputValue('#ped-bairro')) === 'Centro' && (await p.inputValue('#ped-uf')) === 'SP' && (await p.inputValue('#ped-end')).startsWith('Rua Teste'), 'CEP completa rua, bairro, cidade e UF');
  ok((await p.inputValue('#ped-cep')) === '07010-000', 'CEP fica formatado');
  await p.fill('#ped-end', 'Rua Teste, 55');
  await p.fill('#ped-peso', '1.250'); await p.fill('#ped-itens', '2');
  await p.fill('#ped-uf', 'S'); await p.click('#ped-salvar'); await p.waitForTimeout(100);
  ok((await p.textContent('#ped-msg')).includes('UF tem 2 letras'), 'UF errada: erro');
  await p.fill('#ped-uf', 'SP');
  await p.click('#ped-buscar');
  await p.waitForFunction(() => !/Procurando/.test(document.getElementById('ped-geo-st').textContent), null, { timeout: 8000 });
  ok(reg.nom.some((q) => q.includes('55 Rua Teste') && q.includes('Guarulhos')), 'buscar pelo endereço consulta rua + número + cidade');
  ok((await p.textContent('#ped-geo-st')).includes('Achamos pelo número') && (await p.$('#ped-mapa .ped-pino')) !== null, 'pino aparece no mapa com aviso para conferir');
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  let d = await db(p);
  const c5 = d.pedidos_rota['C_5005'];
  ok(c5 && c5.tipo === 'coleta' && c5.peso === 1250 && c5.itens === 2 && c5.geoStatus === 'ok' && Math.abs(c5.lat + 23.4612) < 1e-6 && c5.origem === 'manual' && c5.status === 'pendente' && c5.criadoEm, 'coleta gravada como C_5005 (1.250 kg, local do endereço, origem manual)');
  ok(!(await p.isVisible('#modal-pedido')), 'modal fecha depois de salvar');
  ok((await p.textContent('#reg-cards-grid')).includes('NF 5005'), 'novo pedido aparece na lista');

  // corrigir o local de um pedido aproximado tocando no mapa
  await p.evaluate(() => window.abrirPedido('C_2001')); await p.waitForTimeout(350);
  ok((await p.textContent('#ped-geo-st')).includes('Ainda sem local exato'), 'pedido sem CEP: avisa que o pino está no centro da cidade');
  await p.click('#ped-mapa', { position: { x: 160, y: 90 } }); await p.waitForTimeout(150);
  ok((await p.textContent('#ped-geo-st')).includes('marcado por você'), 'toque no mapa marca o ponto');
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  d = await db(p);
  ok(d.pedidos_rota['C_2001'].geoStatus === 'ok' && d.pedidos_rota['C_2001'].geoManual === true && d.pedidos_rota['C_2001'].lat !== -23.48, 'local corrigido à mão fica salvo (geoManual)');
  ok(!(await p.textContent('#ped-aprox')).includes('sem local exato'), 'aviso de local aproximado some');

  // editar só o nome não mexe no local
  await p.evaluate(() => window.abrirPedido('1003')); await p.waitForTimeout(300);
  await p.fill('#ped-dest', 'Padaria Nova'); await p.click('#ped-salvar'); await p.waitForTimeout(350);
  d = await db(p);
  ok(d.pedidos_rota['1003'].dest === 'Padaria Nova' && d.pedidos_rota['1003'].lat === -23.39 && d.pedidos_rota['1003'].geoStatus === 'ok', 'mudar só o cliente mantém o local salvo');

  // trocar o tipo move a chave e preserva os outros campos da nota
  await p.evaluate(() => window.abrirPedido('1002')); await p.waitForTimeout(300);
  await p.click('#ped-tipo button[data-t="coleta"]'); await p.click('#ped-salvar'); await p.waitForTimeout(400);
  d = await db(p);
  ok(!d.pedidos_rota['1002'] && d.pedidos_rota['C_1002'] && d.pedidos_rota['C_1002'].tipo === 'coleta' && d.pedidos_rota['C_1002'].chave === PED['1002'].chave && d.pedidos_rota['C_1002'].remetente === 'Fábrica X', 'entrega → coleta: vira C_1002 e guarda a chave e o remetente da nota');

  // número repetido: pergunta antes de trocar
  resposta = false; reg.dialogs.length = 0;
  await p.click('#btn-novo-pedido'); await p.waitForTimeout(250);
  await p.fill('#ped-nf', '1003'); await p.fill('#ped-cidade', 'Arujá'); await p.fill('#ped-peso', '10');
  await p.click('#ped-salvar'); await p.waitForTimeout(300);
  d = await db(p);
  ok(reg.dialogs.some((m) => m.includes('Já existe uma entrega pendente com o número 1003')) && d.pedidos_rota['1003'].peso === 300, 'NF repetida: pergunta e, se cancelar, nada muda');
  await p.fill('#ped-nf', '9009'); await p.click('#ped-salvar'); await p.waitForTimeout(200);
  ok((await p.textContent('#ped-msg')).includes('já saiu em rota'), 'NF que já foi entregue: não deixa cadastrar por cima');
  await p.click('#modal-pedido .modal-close');
  resposta = true;

  // excluir
  await p.evaluate(() => window.abrirPedido('C_5005')); await p.waitForTimeout(300);
  ok(await p.isVisible('#ped-excluir'), 'pedido pendente: botão "Excluir pedido"');
  await p.click('#ped-excluir'); await p.waitForTimeout(350);
  d = await db(p);
  ok(!d.pedidos_rota['C_5005'], 'excluir tira o pedido do banco');
  await p.screenshot({ path: 'aj-pedidos-1440.png' });

  // Mapa: tocar no pino abre o pedido
  await p.evaluate(() => window.irParaPagina('mapa')); await p.waitForTimeout(500);
  const pin = await p.$('#mapa-completo path.leaflet-interactive[fill="#16a36a"]');
  if (pin) { await pin.click({ force: true }); await p.waitForTimeout(300); }
  ok(pin && await p.isVisible('#modal-pedido') && (await p.textContent('#ped-tit')).startsWith('Pedido NF'), 'Mapa: tocar no pino abre o pedido para editar');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#modal-pedido')), 'Esc fecha o modal');

  // ── B. Ajuste manual da rota ─────────────────────────────────────────────
  // pendentes agora: 1001 (E 200), 1003 (E 300), C_1002 (C 150), C_2001 (C 100)
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
  await p.click('#veh-grid .veh-card >> nth=0'); await p.waitForTimeout(150);
  await p.fill('#cap-kg-d', '480'); await p.fill('#cap-maxped-d', '8');
  await p.click('text=Continuar →'); await p.waitForTimeout(150);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  const seq = () => p.$$eval('#rota-detail-d .delivery-mini .dm-txt > div:first-child', (els) => els.map((e) => e.textContent.match(/NF (\d+)/)[1]));
  const ordem0 = await seq();
  ok(ordem0.length === 3, 'rota gerada com 3 paradas (1 ficou de fora): ' + ordem0.join(','));
  ok((await p.textContent('#rota-detail-d')).includes('Passa da capacidade'), 'rota acima de 480 kg: aviso de capacidade');
  ok(!(await p.$('#rota-detail-d .dm-acoes')), 'sem ajuste: setas escondidas');
  await p.click('[data-foco="ajustar"]'); await p.waitForTimeout(200);
  ok((await p.$$('#rota-detail-d .dm-acoes')).length === 3, '"Ajustar a rota": cada parada ganha subir, descer e tirar');
  ok(await p.isDisabled('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Subir"]'), 'primeira parada não sobe');
  reg.avaliar.length = 0;
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]'); await p.waitForTimeout(100);
  let ordem1 = await seq();
  ok(ordem1[0] === ordem0[1] && ordem1[1] === ordem0[0], 'descer troca a 1ª com a 2ª');
  ok((await p.textContent('#rota-detail-d')).includes('Recalculando'), 'mostra "Recalculando" enquanto mede a rota nova');
  ok(await p.evaluate(() => document.activeElement && (document.activeElement.dataset.foco || '').endsWith('|down')), 'foco continua no botão "descer" da mesma parada');
  await p.waitForTimeout(700);
  ok(reg.avaliar.length === 1 && reg.avaliar[0].pedidos.length === 3 && reg.avaliar[0].hora_saida === 420 && reg.avaliar[0].deposito.nome === 'CD Guarulhos', '/avaliar recebe a rota na ordem nova, a saída e o CD');
  ok((await p.textContent('#rota-detail-d .card')).includes('43.0') && (await p.textContent('#rota-detail-d')).includes('~07:10'), 'km e chegadas vêm do servidor (43 km, 1ª parada ~07:10)');
  ok((await p.textContent('#rota-tabs-d')).includes('ajustada'), 'aba mostra "ajustada"');
  // várias mudanças rápidas: uma medição só, da ordem final
  reg.avaliar.length = 0;
  await p.click('#rota-detail-d .delivery-mini >> nth=1 >> [aria-label^="Descer"]');
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]');
  await p.waitForTimeout(800);
  ok(reg.avaliar.length === 1, 'mudanças seguidas: uma medição só (a da ordem final)');
  // tirar e adicionar
  const antesTirar = await seq();
  await p.click('#rota-detail-d .delivery-mini >> nth=2 >> [aria-label^="Tirar"]'); await p.waitForTimeout(150);
  ok((await seq()).length === 2, 'tirar: rota fica com 2 paradas');
  ok((await p.textContent('.add-parada')).includes('2 pedidos pendentes'), 'parada tirada volta para a lista de pendentes da viagem');
  await p.fill('#add-busca', antesTirar[2]); await p.waitForTimeout(100);
  ok((await p.$$('#add-lista .add-item')).length === 1, 'busca filtra os pendentes');
  await p.click('#add-lista .add-item button'); await p.waitForTimeout(200);
  const depoisAdd = await seq();
  ok(depoisAdd.length === 3 && depoisAdd[2] === antesTirar[2], 'adicionar põe o pedido no fim da rota');
  await p.waitForTimeout(600);
  // servidor sem resposta: estimativa em linha reta, com aviso
  reg.avaliarFalha = true;
  await p.click('#rota-detail-d .delivery-mini >> nth=2 >> [aria-label^="Subir"]'); await p.waitForTimeout(800);
  ok((await p.textContent('#rota-detail-d')).includes('Servidor de rotas sem resposta'), '/avaliar falhou: avisa que km e horários são estimados em linha reta');
  reg.avaliarFalha = false;
  // otimizar a ordem (motor recebe só estas paradas, com capacidade para todas)
  const antesOt = await seq();
  await p.click('[data-foco="otimizar"]'); await p.waitForTimeout(700);
  const ot = reg.solve[reg.solve.length - 1];
  ok(reg.solve.length === 2 && ot.pedidos.length === 3 && ot.veiculos[0].maxPed === 3 && ot.veiculos[0].capKg >= 480, '"Otimizar a ordem" chama o motor só com as paradas da rota');
  ok(JSON.stringify(await seq()) === JSON.stringify(antesOt.slice().reverse()), 'ordem otimizada aparece na tela');
  // desfazer volta ao que o sistema montou
  await p.click('[data-foco="desfazer"]'); await p.waitForTimeout(300);
  ok(JSON.stringify(await seq()) === JSON.stringify(ordem0) && !(await p.textContent('#rota-tabs-d')).includes('ajustada'), '"Desfazer ajustes" volta à rota original');
  // ajusta de novo e confirma
  await p.click('#rota-detail-d .delivery-mini >> nth=0 >> [aria-label^="Descer"]'); await p.waitForTimeout(100);
  await p.screenshot({ path: 'aj-rota-1440.png', fullPage: true });
  reg.dialogs.length = 0;
  await p.click('#btn-confirmar-rota'); await p.waitForTimeout(1600);
  ok(reg.dialogs.some((m) => m.includes('Passa da capacidade') && m.includes('Confirmar a saída mesmo assim')), 'confirmar com rota acima da capacidade: pede confirmação listando o problema');
  d = await db(p);
  const rc = Object.values(d.rotas_confirmadas || {})[0];
  const final = [ordem0[1], ordem0[0], ordem0[2]];
  ok(rc && rc.ajustada === true && JSON.stringify(rc.paradas.map((x) => x.nf)) === JSON.stringify(final), 'rota salva na ordem ajustada, marcada como ajustada');
  ok(rc && rc.paradas[0].chegada_min === 430 && rc.paradas[2].chegada_min === 490 && rc.km === 43, 'rota salva com km e chegadas da medição da ordem nova');
  const st = Object.fromEntries(Object.entries(d.pedidos_rota).map(([k, v]) => [k, v.status]));
  ok(rc && rc.paradas.every((x) => st[x.id] === 'despachado') && Object.values(st).filter((s) => s === 'pendente').length === 1, 'só as paradas da rota viram "despachado"; o que ficou fora continua pendente');
  ok(rc && rc.token && d && (await p.evaluate((t) => !!window.__FAKE.db.entregador[t] && window.__FAKE.db.entregador[t].paradas.length === 3, rc.token)), 'link do motorista criado com as paradas na ordem ajustada');
  ok(!errs.length, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();

  // ── C. Pedido excluído enquanto a rota era ajustada ──────────────────────
  {
    const reg2 = { viacep: [], nom: [], solve: [], avaliar: [], dialogs: [] };
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
    await mockServicos(ctx, reg2);
    p.on('dialog', (dd) => { reg2.dialogs.push(dd.message()); dd.accept(); });
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
    await p.click('#veh-grid .veh-card >> nth=1'); await p.fill('#cap-kg-d', '3000');
    await p.click('text=Continuar →'); await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
    const ids = await p.evaluate(() => window.__FAKE.db.empresas.emp1 && Object.keys(window.__FAKE.db.empresas.emp1.pedidos_rota));
    // outra aba despacha a 1ª parada
    await p.evaluate(() => { const r = window.__FAKE.db.empresas.emp1.pedidos_rota; const k = Object.keys(r).find((x) => r[x].status === 'pendente'); r[k].status = 'despachado'; window.__FAKE.fire(); });
    await p.waitForTimeout(200);
    await p.click('#btn-confirmar-rota'); await p.waitForTimeout(500);
    const dd = await db(p);
    ok(reg2.dialogs.some((m) => m.includes('não estão mais pendentes')) && !dd.rotas_confirmadas, 'pedido que saiu em outra rota: avisa e não confirma');
    ok(!errs.length && ids, 'sem erros no console (cenário C): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // ── D. Celular (390 px): modal e ajuste sem rolagem para o lado ──────────
  {
    const reg3 = { viacep: [], nom: [], solve: [], avaliar: [], dialogs: [] };
    const { ctx, p, errs } = await open(b, 'index.html', 390, 844, seed, true, PED);
    await mockServicos(ctx, reg3);
    p.on('dialog', (dd) => dd.accept());
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    await p.screenshot({ path: 'aj-pedidos-390.png', fullPage: true });
    await p.tap('#btn-novo-pedido'); await p.waitForTimeout(400);
    await p.screenshot({ path: 'aj-modal-390.png' });
    const sw1 = await p.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('#modal-pedido .modal-box').getBoundingClientRect().right]);
    ok(sw1[0] <= 390 && sw1[1] <= 390, 'celular: modal cabe na tela, sem rolagem para o lado ' + JSON.stringify(sw1));
    await p.evaluate(() => { document.querySelector('#modal-pedido .modal-box').scrollIntoView(); });
    await p.tap('#modal-pedido .modal-close'); await p.waitForTimeout(200);
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(300);
    await p.tap('#veh-grid .veh-card >> nth=1'); await p.fill('#cap-kg-d', '3000');
    await p.tap('text=Continuar →'); await p.tap('text=Gerar Rota Agora'); await p.waitForTimeout(900);
    await p.tap('[data-foco="ajustar"]'); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('.ajuste-barra').scrollIntoView());
    await p.screenshot({ path: 'aj-rota-390.png' });
    await p.evaluate(() => document.querySelector('.add-parada').scrollIntoView());
    await p.screenshot({ path: 'aj-rota-390b.png' });
    const sw2 = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw2 <= 390, 'celular: ajuste da rota sem rolagem para o lado (' + sw2 + ')');
    const alvo = await p.$eval('#rota-detail-d .dm-acoes button', (e) => e.getBoundingClientRect().height);
    ok(alvo >= 34, 'botões do ajuste com área de toque de pelo menos 34 px (' + alvo + ')');
    for (const w of [360, 320]) {
      await p.setViewportSize({ width: w, height: 760 }); await p.waitForTimeout(250);
      const s = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(s <= w, `celular ${w}px: sem rolagem para o lado (${s})`);
    }
    await p.screenshot({ path: 'aj-rota-320.png' });
    ok(!errs.length, 'sem erros no console (celular): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }

  // ── E. Dados de exemplo (banco vazio): editar não grava nada ─────────────
  {
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, null);
    await mockServicos(ctx, { viacep: [], nom: [], solve: [], avaliar: [], dialogs: [] });
    p.on('dialog', (dd) => dd.accept());
    await p.waitForTimeout(800);
    const id = await p.evaluate(() => document.querySelector('#reg-cards-grid') && null);
    await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
    await p.click('#reg-cards-grid .rc-card >> nth=0 >> .rc-card-head'); await p.waitForTimeout(150);
    await p.click('#reg-cards-grid .rc-card >> nth=0 >> button.nf-mini >> nth=0'); await p.waitForTimeout(300);
    ok((await p.textContent('#ped-aviso')).includes('Dados de exemplo'), 'exemplo: avisa que a mudança fica só na tela');
    const nWrites = await p.evaluate(() => window.__FAKE.writes.filter((w) => JSON.stringify(w).includes('pedidos_rota')).length);
    await p.fill('#ped-peso', '77'); await p.click('#ped-salvar'); await p.waitForTimeout(300);
    const nWrites2 = await p.evaluate(() => window.__FAKE.writes.filter((w) => JSON.stringify(w).includes('pedidos_rota')).length);
    ok(nWrites2 === nWrites && (await p.textContent('#reg-cards-grid')).includes('77 kg'), 'exemplo: peso muda na tela e nada vai para o banco');
    // "Mostrar todos" aparece nas regiões com mais de 10 pedidos
    const mais = await p.$('#reg-cards-grid .rc-mais');
    if (mais) { const card = await mais.evaluateHandle((e) => e.closest('.rc-card')); if (!(await card.evaluate((c) => c.classList.contains('exp')))) await (await card.$('.rc-card-head')).click(); await mais.click(); }
    ok(mais && await p.evaluate(() => [...document.querySelectorAll('.rc-card.todos .nf-mini.extra')].some((e) => e.offsetParent !== null)), '"Mostrar todos" mostra os pedidos além dos 10 primeiros');
    ok(!errs.length && id === null, 'sem erros no console (exemplo): ' + JSON.stringify(errs.slice(0, 3)));
    await ctx.close();
  }
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK');
})();
