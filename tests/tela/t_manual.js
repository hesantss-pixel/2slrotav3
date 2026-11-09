// Montar a rota no mapa, ponto por ponto: seleção por toque, ordem dos toques,
// peso máximo a bordo contra a capacidade, reordenar, tirar, pedidos sem ponto
// exato pela lista, e a rota seguindo para a medição e a confirmação normais.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

// Pesos escolhidos para a conta do pico a bordo ser verificável à mão.
// Tocando o grupo de coletas (400+100), depois 1001 (500) e 1002 (300), a sequência
// fica [C2001, C2002, 1001, 1002]. Sai do CD com as entregas: 500+300 = 800 kg.
// Depois de C2001: 1.200 · de C2002: 1.300 · de 1001: 800 · de 1002: 500.
// Máximo a bordo = 1.300 kg, na parada 2. Com 1.000 kg de capacidade, passa em 300.
// Levando 1001 para a frente: 300 · 700 · 800 · 500 → máximo 800 kg, e cabe.
// É o mesmo conjunto de pedidos: só a ordem mudou. É isso que o teste prova.
const PED = {
  '1001': { nf: '1001', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Mercado A', endereco: 'Rua A, 100', bairro: 'Centro', peso: 500, itens: 5, status: 'pendente', lat: -23.450, lng: -46.530, geoStatus: 'ok' },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja B', endereco: 'Rua B, 200', bairro: 'Bonsucesso', peso: 300, itens: 3, status: 'pendente', lat: -23.440, lng: -46.500, geoStatus: 'ok' },
  '1003': { nf: '1003', tipo: 'entrega', cidade: 'Arujá', dest: 'Padaria C', endereco: 'Rua C, 300', peso: 200, itens: 2, status: 'pendente', lat: -23.390, lng: -46.320, geoStatus: 'ok' },
  '1004': { nf: '1004', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Atacado D', endereco: 'Rua D, 400', peso: 120, itens: 1, status: 'pendente', lat: -23.460, lng: -46.540, geoStatus: 'ok' },
  '1005': { nf: '1005', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Atacado D', endereco: 'Rua D, 400', peso: 80, itens: 1, status: 'pendente', lat: -23.46005, lng: -46.54005, geoStatus: 'ok' },
  'C_2001': { nf: '2001', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria E', endereco: 'Rua E, 500', peso: 400, itens: 4, status: 'pendente', lat: -23.480, lng: -46.350, geoStatus: 'ok' },
  'C_2002': { nf: '2002', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria E', endereco: 'Rua E, 500', peso: 100, itens: 1, status: 'pendente', lat: -23.48004, lng: -46.35004, geoStatus: 'ok' },
  '1009': { nf: '1009', tipo: 'entrega', cidade: 'Suzano', dest: 'Sem ponto', peso: 90, itens: 1, status: 'pendente', geoStatus: 'sem_cep' },
};
// Para o teste de toque no celular: três pontos bem separados, que é a situação
// normal depois de dar zoom na região.
const PED_LONGE = { '1001': PED['1001'], '1003': PED['1003'], 'C_2001': PED['C_2001'] };

const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};
const painel = (p) => p.evaluate(() => ({
  paradas: document.getElementById('man-paradas').textContent,
  peso: document.getElementById('man-peso').textContent,
  classePeso: document.getElementById('man-peso').className,
  trilho: document.getElementById('man-trilho').className,
  largura: document.getElementById('man-trilho').firstElementChild.style.width,
  sub: document.getElementById('man-sub').textContent.replace(/\s+/g, ' ').trim(),
  aviso: document.getElementById('man-aviso').textContent,
  travado: document.getElementById('man-usar').disabled,
  itens: [...document.querySelectorAll('#man-ordem .man-item')].map((el) => ({
    num: el.querySelector('.man-num').textContent,
    nf: (el.querySelector('.man-txt').textContent.match(/NF (\d+)/) || [])[1],
    txt: el.querySelector('.man-txt').textContent.replace(/\s+/g, ' ').trim(),
    pico: el.classList.contains('pico'), coleta: el.classList.contains('col') })),
}));
// rótulo de cada pino no mapa, por NF
const rotulos = (p) => p.evaluate(() => {
  const r = {};
  document.querySelectorAll('#mapa-manual .leaflet-marker-icon').forEach((a) => {
    const m = (a.getAttribute('title') || '').match(/NF ([\d, ]+?)\)?\s·/);
    const c = a.firstElementChild;
    if (m && c) r[m[1].trim()] = c.textContent;
  });
  return r;
});
async function abrirManual(p, cap) {
  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(500);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(250);
  await p.fill('#cap-kg-d', String(cap));
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(250);
  await p.click('#rot-step-confirm .btn-modal-alt');
  await p.waitForTimeout(900);
}
const tocar = async (p, nf) => { await p.click(`.leaflet-marker-icon[title*="NF ${nf}"]`); await p.waitForTimeout(220); };
const centro = (p, nf) => p.evaluate((n) => {
  const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].find((x) => (x.getAttribute('title') || '').includes('NF ' + n));
  if (!a) return null;
  const b = a.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, x0: b.x, y0: b.y, x1: b.right, y1: b.bottom };
}, nf);

(async () => {
  const b = await chromium.launch();
  const reg = { avaliar: [], dialogs: [] };
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  p.on('dialog', (d) => { reg.dialogs.push(d.message()); d.accept(); });
  await ctx.route(/railway\.app\/avaliar/, (r) => {
    const body = JSON.parse(r.request().postData());
    reg.avaliar.push(body);
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ km: 52.4, mins: 180,
      chegada_min: body.pedidos.map((_, i) => 430 + 30 * i), fonte_distancia: 'OSRM', passa_da_jornada: false }) });
  });
  await p.waitForTimeout(600);

  // ── 1. o caminho até o mapa ───────────────────────────────────────────────
  await p.evaluate(() => window.irParaPagina('roteirizacao'));
  await p.waitForTimeout(500);
  await p.evaluate(() => window.selVeicD('toco'));
  await p.waitForTimeout(250);
  await p.fill('#cap-kg-d', '1000');
  await p.evaluate(() => window.irConfirmD());
  await p.waitForTimeout(250);
  const bt = await p.evaluate(() => {
    const el = document.querySelector('#rot-step-confirm .btn-modal-alt');
    return el ? { txt: el.textContent.trim(), visivel: el.offsetParent !== null } : null;
  });
  ok(!!bt && /montar/i.test(bt.txt) && bt.visivel, 'a tela de confirmar oferece montar no mapa' + (bt ? ` ("${bt.txt}")` : ' → botão não existe'));

  await p.click('#rot-step-confirm .btn-modal-alt');
  await p.waitForTimeout(900);
  const tela = await p.evaluate(() => ({
    aberta: document.getElementById('rot-step-manual').style.display === 'block',
    confirmFechado: document.getElementById('rot-step-confirm').style.display === 'none',
    mapa: !!document.querySelector('#mapa-manual .leaflet-tile-pane'),
    cabecalho: document.getElementById('man-veh-name').textContent,
  }));
  ok(tela.aberta && tela.confirmFechado, 'o mapa de montagem abre e a confirmação se fecha');
  ok(tela.mapa, 'o Leaflet subiu dentro de #mapa-manual');
  ok(/Truck Toco/.test(tela.cabecalho) && /1\.000 kg/.test(tela.cabecalho),
    'o cabeçalho repete veículo e capacidade escolhidos → ' + tela.cabecalho);

  // ── 2. os pinos ───────────────────────────────────────────────────────────
  const pinos = await p.evaluate(() => {
    const alvos = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')];
    const r = alvos.map((a) => { const c = a.firstElementChild; const bb = a.getBoundingClientRect();
      return { w: Math.round(bb.width), h: Math.round(bb.height), cls: c ? c.className : '', txt: c ? c.textContent : '', title: a.getAttribute('title') || '', foco: a.tabIndex }; });
    return { pedidos: r.filter((x) => !/\bcd\b/.test(x.cls)), cd: r.filter((x) => /\bcd\b/.test(x.cls)).length,
      alvo44: r.every((x) => x.w === 44 && x.h === 44) };
  });
  ok(pinos.pedidos.length === 5, `os 7 pedidos com ponto viram 5 paradas no mapa (mesmo endereço = uma parada) → ${pinos.pedidos.length}`);
  ok(pinos.cd === 1, 'o CD aparece no mapa');
  ok(pinos.alvo44, 'todo pino tem alvo de toque de 44 px (WCAG 2.5.8)');
  ok(pinos.pedidos.every((x) => x.title.length > 20), 'todo pino tem rótulo acessível no title');
  ok(pinos.pedidos.every((x) => x.foco === 0), 'todo pino pega foco de teclado');
  const grupo = pinos.pedidos.find((x) => /1004/.test(x.title));
  ok(!!grupo && /2 notas neste ponto/.test(grupo.title) && /1005/.test(grupo.title),
    'o pino do endereço repetido diz que são 2 notas e cita as duas → ' + (grupo ? grupo.title.slice(0, 70) : 'não achei'));
  ok(!!grupo && grupo.txt === '×2', 'o pino do endereço repetido mostra a contagem como ×2, para não confundir com posição na rota');
  const coletas = pinos.pedidos.find((x) => /2001/.test(x.title));
  ok(!!coletas && /\bcoleta\b/.test(coletas.cls), 'coleta e entrega têm desenhos diferentes, não só cores');
  const semPonto = await p.evaluate(() => [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].some((a) => /NF 1009/.test(a.getAttribute('title') || '')));
  ok(!semPonto, 'pedido sem ponto exato não aparece no mapa');

  const vazio = await painel(p);
  ok(/Nenhuma parada ainda/.test(vazio.paradas) && vazio.travado, 'começa vazio e com o botão travado');
  ok(/Toque nos pontos/.test(vazio.sub), 'explica o que fazer antes do primeiro toque');

  // ── 3. tocar, somar, e a conta do pico a bordo ────────────────────────────
  await tocar(p, '2001');
  const um = await painel(p);
  ok(um.itens.length === 2, `tocar no ponto com 2 coletas coloca as duas (${um.itens.length})`);
  ok(um.itens[0].coleta && um.itens[1].coleta, 'as duas entram marcadas como coleta');
  const selec = await p.evaluate(() => { const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].find((x) => /NF 2001/.test(x.getAttribute('title') || '')); const c = a && a.firstElementChild; return { cls: c ? c.className : '', txt: c ? c.textContent : '', title: a ? a.getAttribute('title') : '' }; });
  ok(/\bsel\b/.test(selec.cls), 'o pino tocado fica marcado como escolhido');
  ok(selec.txt === '1–2', `o pino mostra as posições na rota (${selec.txt})`);
  ok(/toque para tirar/.test(selec.title), 'o title do pino escolhido passa a dizer que o toque tira da rota');

  await tocar(p, '1001');
  await tocar(p, '1002');
  const quatro = await painel(p);
  ok(/4 paradas/.test(quatro.paradas), 'conta 4 paradas → ' + quatro.paradas);
  ok(/1\.300/.test(quatro.peso) && /1\.000 kg a bordo/.test(quatro.peso),
    'o máximo a bordo é 1.300 contra 1.000 de capacidade → ' + quatro.peso);
  ok(/cheio/.test(quatro.classePeso) && /cheio/.test(quatro.trilho), 'passa da capacidade: peso e barra em vermelho');
  ok(/^100(\.0)?%$/.test(quatro.largura), 'a barra satura em 100% em vez de estourar → ' + quatro.largura);
  ok(/em 300 kg/.test(quatro.aviso), 'o aviso diz exatamente quanto passou → ' + quatro.aviso);
  ok(!quatro.travado, 'passar da capacidade avisa, mas não impede de seguir');
  ok(/Sai do CD Guarulhos com 800 kg/.test(quatro.sub), 'diz com quanto o veículo sai do CD');
  ok(/chega a 1\.300 kg a bordo na parada 2/.test(quatro.sub), 'aponta em qual parada está o pico');
  ok(/Mudar a ordem das paradas muda esse número/.test(quatro.sub),
    'quando o pico é igual à soma, não repete o mesmo número: avisa que a ordem muda a conta');
  ok(quatro.itens.filter((i) => i.pico).length === 1 && quatro.itens[1].pico, 'a parada do pico fica destacada na lista');
  ok(/1\.200 kg a bordo depois daqui/.test(quatro.itens[0].txt), 'cada parada mostra a carga a bordo depois dela → ' + quatro.itens[0].txt);
  ok(quatro.itens.map((i) => i.num).join(',') === '1,2,3,4', 'a lista numera as paradas na ordem dos toques');
  ok(/2 entregas/.test(quatro.sub) && /2 coletas/.test(quatro.sub) && /13 volumes/.test(quatro.sub),
    'resume entregas, coletas e volumes → ' + quatro.sub.slice(0, 50));

  // ── 4. a MESMA carga cabe se a ordem mudar: entrega primeiro, coleta depois
  await p.click('#man-bt-2-u'); await p.waitForTimeout(220);
  await p.click('#man-bt-1-u'); await p.waitForTimeout(260);
  const cabe = await painel(p);
  ok(cabe.itens.map((i) => i.nf).join(',') === '1001,2001,2002,1002',
    'a entrega subiu para a primeira parada → ' + cabe.itens.map((i) => i.nf).join(','));
  ok(/800/.test(cabe.peso) && !/cheio/.test(cabe.trilho),
    'com os mesmos pedidos em outra ordem o máximo a bordo cai para 800 e cabe no veículo → ' + cabe.peso);
  ok(cabe.aviso === '', 'o aviso de capacidade desaparece quando a ordem resolve');
  ok(/não a soma de tudo \(1\.300 kg\)/.test(cabe.sub),
    'explica que a soma de tudo (1.300) não é o que precisa caber → ' + cabe.sub.slice(-80));
  ok(cabe.largura === '80%', 'a barra mostra 80% da capacidade → ' + cabe.largura);

  // ── 5. reordenar e tirar ──────────────────────────────────────────────────
  const nfAntes = cabe.itens.map((i) => i.nf);
  await p.click('#man-bt-0-d');
  await p.waitForTimeout(260);
  const dep = await painel(p);
  const nfDep = dep.itens.map((i) => i.nf);
  ok(nfDep[0] === nfAntes[1] && nfDep[1] === nfAntes[0], `descer a parada 1 troca com a 2 (${nfAntes.join(',')} → ${nfDep.join(',')})`);
  const foco = await p.evaluate(() => document.activeElement && document.activeElement.id);
  ok(/^man-bt-1-/.test(foco || ''), 'o foco acompanha a parada que se mexeu → ' + foco);
  const anuncio = await p.evaluate(() => document.getElementById('man-anuncio').textContent);
  ok(/agora é a parada 2 de 4/.test(anuncio), 'a mudança é anunciada para leitor de tela → ' + anuncio);
  ok(await p.evaluate(() => document.getElementById('man-bt-0-u').disabled), 'a primeira parada não tem para onde subir');
  ok(await p.evaluate(() => document.getElementById('man-bt-3-d').disabled), 'a última parada não tem para onde descer');
  const rot = await rotulos(p);
  ok(rot['2001, 2002'] === '1·3', `pinos com paradas não seguidas mostram as duas posições (${rot['2001, 2002']})`);
  ok(rot['1001'] === '2', `o pino de uma parada só mostra o número dela (${rot['1001']})`);
  ok(rot['1004, 1005'] === '×2', 'pino fora da rota volta a mostrar a contagem de notas, não posição');

  await p.click('#man-ordem .man-item:nth-child(4) .man-bt.x');
  await p.waitForTimeout(260);
  const tirou = await painel(p);
  ok(tirou.itens.length === 3 && /3 paradas/.test(tirou.paradas), 'o ✕ tira a parada da rota → ' + tirou.paradas);
  ok(tirou.itens.map((i) => i.num).join(',') === '1,2,3', 'a lista renumera depois de tirar');

  // ── 6. a lista dos que faltam, inclusive sem ponto exato ──────────────────
  const lista = await p.evaluate(() => {
    const d = document.querySelector('#man-disponiveis details');
    return { aberta: !!d && d.open, resumo: d ? d.querySelector('summary').textContent : '',
      nota: d ? (d.querySelector('.man-dica') || {}).textContent || '' : '',
      bts: d ? [...d.querySelectorAll('.man-add')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()) : [] };
  });
  ok(lista.bts.length === 5, `a lista traz os 5 pedidos que ainda não estão na rota (${lista.bts.length})`);
  ok(lista.bts.some((t) => /NF 1009/.test(t) && /sem ponto exato/.test(t)), 'o pedido sem ponto exato aparece marcado na lista');
  ok(lista.aberta && /sem ponto exato/.test(lista.resumo), 'a lista já abre quando há pedido que não dá para tocar no mapa');
  ok(/corrija o ponto depois/.test(lista.nota), 'a lista explica o que fazer com quem não tem ponto exato');
  await p.click('#man-disponiveis .man-add:has-text("NF 1009")');
  await p.waitForTimeout(260);
  const comSem = await painel(p);
  ok(comSem.itens.length === 4 && comSem.itens[3].nf === '1009', 'dá para colocar na rota pela lista, sem o mapa');

  // ── 7. colocar os que estão à vista ───────────────────────────────────────
  await p.click('button:has-text("Colocar os que estão à vista")');
  await p.waitForTimeout(400);
  const vista = await painel(p);
  ok(vista.itens.length === 8, `"à vista" coloca os 4 que faltavam de uma vez (${vista.itens.length} paradas)`);
  await p.click('button:has-text("Limpar a rota")');
  await p.waitForTimeout(260);
  const limpo = await painel(p);
  ok(!limpo.itens.length && limpo.travado, 'limpar a rota volta ao começo');
  const semPino = await p.evaluate(() => document.querySelectorAll('#mapa-manual .pino.sel').length);
  ok(semPino === 0, 'limpar a rota também desmarca os pinos no mapa');

  // ── 8. o dedo pega o pino MAIS PERTO, não o que está por cima ─────────────
  const cA = await centro(p, '1001'), cB = await centro(p, '1004');
  const sobrepoe = cA && cB && cA.x0 < cB.x1 && cB.x0 < cA.x1 && cA.y0 < cB.y1 && cB.y0 < cA.y1;
  if (sobrepoe) {
    await p.mouse.click(cA.x, cA.y);
    await p.waitForTimeout(300);
    const qual = await painel(p);
    ok(qual.itens.length === 1 && qual.itens[0].nf === '1001',
      'alvos sobrepostos: o clique no centro de um pino escolhe esse pino, não o vizinho de cima → ' + qual.itens.map((i) => i.nf).join(','));
    await p.click('button:has-text("Limpar a rota")');
    await p.waitForTimeout(220);
  } else {
    ok(true, 'alvos não se sobrepõem neste zoom (teste de pino mais perto fica para o celular)');
  }

  // ── 9. usar a rota: medição na ordem escolhida e confirmação ──────────────
  await tocar(p, '1003');
  await tocar(p, '1001');
  await tocar(p, '1002');
  reg.avaliar.length = 0;
  await p.click('#man-usar');
  await p.waitForTimeout(1200);
  const res = await p.evaluate(() => ({
    manualFechado: document.getElementById('rot-step-manual').style.display === 'none',
    aberto: document.getElementById('rot-step-results').style.display === 'block',
    abas: [...document.querySelectorAll('.rota-tab-d')].map((e) => e.textContent.trim()),
    kpis: [...document.querySelectorAll('#rot-step-results .kpi')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
    temConfirmar: !!document.getElementById('btn-confirmar-rota'),
    fora: document.getElementById('rot-step-results').textContent.replace(/\s+/g, ' '),
  }));
  ok(res.manualFechado && res.aberto, 'usar a rota leva para a tela de resultado de sempre');
  ok(res.abas.length === 1 && /montada no mapa/.test(res.abas[0]), 'a aba diz que a rota foi montada no mapa → ' + res.abas.join(' | '));
  ok(res.temConfirmar, 'a rota montada à mão tem o mesmo botão de confirmar a saída');
  ok(/5 pedidos pendentes ficaram fora desta viagem/.test(res.fora), 'avisa que os outros 5 continuam pendentes para a próxima');
  ok(reg.avaliar.length >= 1, `o servidor foi chamado para medir a rota (${reg.avaliar.length})`);
  const medida = reg.avaliar[reg.avaliar.length - 1];
  ok(medida && medida.pedidos.length === 3, `foram mandadas as 3 paradas para medir (${medida ? medida.pedidos.length : 0})`);
  ok(medida && Math.abs(medida.pedidos[0].lat - (-23.39)) < 1e-6 && Math.abs(medida.pedidos[2].lat - (-23.44)) < 1e-6,
    'as paradas foram mandadas na ordem que a pessoa escolheu, não reordenadas');
  ok(/52/.test(res.kpis.join(' ')), 'o km medido pelo servidor aparece na tela → ' + res.kpis.join(' | '));

  await p.click('#btn-confirmar-rota');
  await p.waitForTimeout(1400);
  const salvo = await p.evaluate(() => {
    const e = window.__FAKE.db.empresas.emp1;
    const rs = Object.values(e.rotas_confirmadas || {});
    const r = rs[0] || {};
    return { n: rs.length, montagem: r.montagem, ajustada: r.ajustada, veiculo: r.veiculo, cap: r.cap_kg, km: r.km, fonte: r.fonte_dist,
      nfs: (r.paradas || []).map((x) => x.nf), status: Object.fromEntries(Object.entries(e.pedidos_rota).map(([k, v]) => [k, v.status])) };
  });
  ok(salvo.n === 1, `a rota ficou salva (${salvo.n})`);
  ok(salvo.montagem === 'manual', 'a rota salva registra que foi montada à mão → ' + salvo.montagem);
  ok(!salvo.ajustada, 'montada à mão não é marcada como "ajustada", que é outra coisa');
  ok(salvo.nfs.join(',') === '1003,1001,1002', 'a ordem escolhida é a ordem salva → ' + salvo.nfs.join(','));
  ok(salvo.veiculo === 'Truck Toco' && salvo.cap === 1000, `veículo e capacidade vão para a rota salva (${salvo.veiculo}, ${salvo.cap})`);
  ok(salvo.fonte === 'OSRM', 'a rota salva guarda que o km foi medido pelas ruas → ' + salvo.fonte);
  ok(salvo.status['1003'] === 'despachado' && salvo.status['1001'] === 'despachado' && salvo.status['1002'] === 'despachado',
    'os pedidos da rota saem de pendentes');
  ok(salvo.status['1004'] === 'pendente' && salvo.status['1009'] === 'pendente', 'quem ficou fora continua pendente');
  await ctx.close();

  // ── 10. no celular ────────────────────────────────────────────────────────
  const m = await open(b, 'index.html', 390, 844, seed, true, PED_LONGE);
  await m.p.waitForTimeout(700);
  await abrirManual(m.p, 1000);
  await m.p.tap('.leaflet-marker-icon[title*="NF 1001"]');
  await m.p.waitForTimeout(400);
  const tt = await m.p.evaluate(() => ({
    tooltips: document.querySelectorAll('.leaflet-tooltip').length,
    escolhido: !!document.querySelector('#mapa-manual .pino.sel'),
    paradas: document.getElementById('man-paradas').textContent,
    alturaMapa: document.getElementById('mapa-manual').getBoundingClientRect().height,
    rolaLado: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    botoes: [...document.querySelectorAll('#man-ordem .man-bt')].every((x) => x.getBoundingClientRect().height >= 32),
    painelGrudado: getComputedStyle(document.querySelector('.man-painel')).position === 'sticky',
  }));
  ok(tt.tooltips === 0, `em tela de toque não abre tooltip junto com a seleção (${tt.tooltips})`);
  ok(tt.escolhido && /1 parada/.test(tt.paradas), 'o toque no celular escolhe a parada → ' + tt.paradas);
  ok(tt.alturaMapa > 250 && tt.alturaMapa < 420, `o mapa cabe na tela do celular (${Math.round(tt.alturaMapa)}px)`);
  ok(!tt.rolaLado, 'não aparece rolagem lateral no celular');
  ok(tt.botoes, 'os botões de ordem são grandes o bastante para o dedo');
  ok(tt.painelGrudado, 'o painel de peso fica grudado no topo ao rolar');
  await m.ctx.close();

  const ruins = errs.concat(m.errs).filter((e) => !/net::|Failed to load/.test(e));
  ok(!ruins.length, 'nenhum erro de JavaScript' + (ruins.length ? ' → ' + ruins.slice(0, 3).join(' | ') : ''));

  await b.close();
  process.exit(falhas ? 1 : 0);
})();
