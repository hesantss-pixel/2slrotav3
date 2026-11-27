// Ver o pedido inteiro pelo pino do mapa de montar a rota: botão direito, tecla V,
// segurar o dedo no celular. A janela só mostra; o toque simples continua sendo
// colocar e tirar da rota. A lista de produtos vem do XML da nota — o mesmo arquivo
// que o backend testa em backend/tests/nfe_produtos.xml, para os dois lerem igual.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { open } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const XML = path.join(__dirname, '..', '..', 'backend', 'tests', 'nfe_produtos.xml');
const CH = '35261111222333000100550010009200011000000027';

// Produtos e campos extras gravados como a importação do XML grava
const PRODS = Array.from({ length: 30 }, (_, i) => ({ d: `Produto número ${i + 1} linha`, q: i + 1.5, u: 'CX' }));
const PED = {
  '1001': { nf: '1001', tipo: 'entrega', cidade: 'Guarulhos', uf: 'SP', cep: '07071000', dest: 'Mercado Exemplo', remetente: 'Fábrica Teste',
    endereco: 'Rua B, 45', bairro: 'Vila Galvão', peso: 332.46, pesoLiq: 310.5, itens: 3, fone: '1124681357',
    volumes: [{ q: 2, esp: 'CAIXA' }, { q: 1, esp: 'PALETE' }], produtos: PRODS, produtosTotal: 32, valor: 1234.5,
    obsNota: 'Entregar no portão 2. Pedido 4471', emissao: '2026-11-17', origem: 'xml',
    status: 'pendente', lat: -23.450, lng: -46.530, geoStatus: 'ok', geoPrec: 'numero' },
  '1002': { nf: '1002', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja B', endereco: 'Rua B, 200', bairro: 'Bonsucesso', peso: 950, itens: 9,
    status: 'pendente', lat: -23.440, lng: -46.500, geoStatus: 'ok', origem: 'planilha' },
  '1006': { nf: '1006', tipo: 'entrega', cidade: 'Guarulhos', dest: 'Loja G', endereco: 'Rua G, 9', peso: 1500, itens: 2, status: 'pendente', lat: -23.455, lng: -46.47, geoStatus: 'ok' },
  '1004': { nf: '1004', tipo: 'entrega', cidade: 'Arujá', dest: 'Atacado D', endereco: 'Rua D, 400', peso: 120, itens: 1, status: 'pendente', lat: -23.390, lng: -46.320, geoStatus: 'ok' },
  '1005': { nf: '1005', tipo: 'entrega', cidade: 'Arujá', dest: 'Atacado D', endereco: 'Rua D, 400', peso: 80, itens: 1, status: 'pendente', lat: -23.39004, lng: -46.32004, geoStatus: 'ok' },
  // texto da nota é dado de fora: não pode virar HTML
  '1003': { nf: '1003', tipo: 'entrega', cidade: 'Guarulhos', dest: '<img src=x onerror="window.__xss=1">', endereco: 'Rua C, 1', peso: 50, itens: 1,
    produtos: [{ d: '<img src=x onerror="window.__xss=2">', q: '<b>9</b>', u: '<i>u</i>' }], volumes: [{ q: '<b>2</b>', esp: '<svg onload="window.__xss=3">' }],
    obsNota: '<script>window.__xss=4</script>', status: 'pendente', lat: -23.47, lng: -46.45, geoStatus: 'ok' },
  'C_2001': { nf: '2001', tipo: 'coleta', cidade: 'Itaquaquecetuba', dest: 'Indústria E', destinatario: 'Cliente F', endereco: 'Rua E, 500', peso: 400, itens: 4,
    status: 'pendente', lat: -23.480, lng: -46.350, geoStatus: 'ok', agendado: true, dataAgendada: '2026-11-01', horaEntrega: '08:00', horaFim: '10:00' },
};
const seed = (ped) => {
  window.__FAKE = {
    user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' },
    db: { acesso: { 'uid-ana': true }, membros: { 'uid-ana': 'emp1' },
      empresas: { emp1: { info: { nome: 'Emp 1' }, config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: ped } } },
  };
};
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
const pino = (nf) => `#mapa-manual .leaflet-marker-icon[title*="NF ${nf}"]`;
const janela = (p) => p.evaluate(() => {
  const m = document.getElementById('modal-ver');
  const t = (s) => { const e = m.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
  return {
    aberta: m.classList.contains('open'),
    titulo: t('#ver-tit'), corpo: t('#ver-corpo'), resumo: t('.ver-resumo'),
    acao: t('#ver-acao'), barra: (m.querySelector('.ver-barra') || {}).className || '',
    linhas: m.querySelectorAll('.ver-prod tbody tr').length,
    primeira: t('.ver-prod tbody tr'),
    notas: m.querySelectorAll('.ver-nota').length,
    fone: (m.querySelector('.ver-dl a[href^="tel:"]') || {}).href || '',
    foco: document.activeElement ? document.activeElement.id : '',
    paradas: document.getElementById('man-paradas').textContent,
  };
});

(async () => {
  const b = await chromium.launch();

  // ── 1. computador: botão direito ──────────────────────────────────────────
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, seed, false, PED);
  await p.waitForTimeout(600);
  await abrirManual(p, 1000);
  const dica = await p.evaluate(() => ({ sub: document.getElementById('man-sub').textContent, nota: document.querySelector('#rot-step-manual .man-dica').textContent }));
  ok(/botão direito/.test(dica.sub), 'antes do primeiro clique, o painel ensina o botão direito → ' + dica.sub);
  ok(/segure o dedo/.test(dica.nota) && /tecla V/.test(dica.nota), 'a dica embaixo do mapa explica o dedo, o botão direito e a tecla V');

  await p.click(pino('1001'), { button: 'right' });
  await p.waitForTimeout(250);
  let j = await janela(p);
  ok(j.aberta, 'botão direito no pino abre a janela do pedido');
  ok(/Nenhuma parada/.test(j.paradas), 'botão direito não coloca o pedido na rota → ' + j.paradas);
  ok(j.titulo === 'Entrega · NF 1001', 'título com o tipo e a nota → ' + j.titulo);
  ok(/332,46 kg/.test(j.resumo) && /líquido 310,5 kg/.test(j.resumo), 'mostra o peso bruto e o líquido → ' + j.resumo.slice(0, 80));
  ok(/3 volumes \(2 × caixa, 1 × palete\)/.test(j.resumo), 'mostra os volumes com a espécie → ' + j.resumo.slice(0, 120));
  ok(/Ocupa 33% da capacidade do Truck Toco \(1\.000 kg\)/.test(j.resumo), 'diz quanto do veículo o pedido ocupa');
  ok(/Sem cubagem: a nota fiscal não traz medida/.test(j.resumo), 'sem m³, avisa com honestidade que a nota não traz a medida e onde informar');
  ok(j.linhas === 30 && /Produtos \(32\)/.test(j.corpo) && /Mostrando 30 de 32/.test(j.corpo), `lista os produtos (${j.linhas} linhas, de 32 na nota)`);
  ok(/Produto número 1 linha/.test(j.primeira) && /1,5 CX/.test(j.primeira), 'cada produto com quantidade e unidade → ' + j.primeira);
  ok(j.fone.startsWith('tel:+551124681357'), 'telefone vira link de ligar → ' + j.fone);
  ok(/R\$\s?1\.234,50/.test(j.corpo) && /17\/11\/2026/.test(j.corpo), 'valor e data de emissão da nota');
  ok(/Remetente\s*Fábrica Teste/.test(j.corpo) && /CEP 07071-000/.test(j.corpo), 'remetente e CEP formatado');
  ok(/Entregar no portão 2/.test(j.corpo), 'mostra a observação da nota');
  ok(/Fora da rota/.test(j.corpo) && j.acao === 'Colocar na rota', 'diz que está fora da rota e oferece colocar');
  ok(j.foco === 'ver-fechar', 'o foco vai para o botão de fechar → ' + j.foco);

  await p.click('#ver-acao');
  await p.waitForTimeout(300);
  j = await janela(p);
  ok(!j.aberta && /1 parada/.test(j.paradas), 'o botão da janela coloca na rota e fecha → ' + j.paradas);
  await p.click(pino('1001'), { button: 'right' });
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(/Parada 1 da rota/.test(j.corpo) && j.acao === 'Tirar da rota', 'aberta de novo, diz a posição na rota e oferece tirar');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  const aposEsc = await p.evaluate(() => ({ aberta: document.getElementById('modal-ver').classList.contains('open'),
    foco: document.activeElement && document.activeElement.classList.contains('leaflet-marker-icon') ? document.activeElement.getAttribute('title') : '' }));
  ok(!aposEsc.aberta, 'Esc fecha a janela');
  ok(/NF 1001/.test(aposEsc.foco), 'ao fechar, o foco volta para o pino');

  // pedido mais pesado que o veículo não aparece no mapa (27/11/2026): fica pendente, com aviso
  ok(!(await p.$(pino('1006'))) && /1 pedido não cabe neste veículo e não aparece no mapa: 1 com mais de 1\.000 kg/.test(await p.textContent('#man-fora')),
    'pedido maior que o veículo fica fora do mapa, com aviso');
  // pedido sem lista de produtos, perto da capacidade
  await p.click(pino('1002'), { button: 'right' });
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(/Ocupa 95% da capacidade/.test(j.resumo) && /quase/.test(j.barra), 'pedido perto da capacidade: avisa (95%) → ' + j.resumo);
  ok(j.linhas === 0 && /vem do XML da nota fiscal/.test(j.corpo), 'sem produtos, explica de onde a lista viria');
  ok(!/Telefone|Valor da nota|Emissão/.test(j.corpo), 'não mostra campo vazio');
  // clicar fora fecha
  await p.mouse.click(30, 450);
  await p.waitForTimeout(200);
  ok(!(await janela(p)).aberta, 'clicar fora da janela fecha');

  // duas notas no mesmo endereço
  await p.click(pino('1004'), { button: 'right' });
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(j.titulo === '2 notas neste endereço' && j.notas === 2, 'pino com 2 notas mostra as duas → ' + j.titulo);
  ok(/200 kg/.test(j.resumo) && /Juntas, ocupam 20%/.test(j.resumo), 'soma o peso das duas e a parte do veículo');
  ok(j.acao === 'Colocar as 2 notas na rota', 'o botão deixa claro que entram as duas → ' + j.acao);
  await p.click('#ver-fechar');
  await p.waitForTimeout(150);

  // coleta agendada para o dia (atrasada), com janela de horário
  await p.click(pino('2001'), { button: 'right' });
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(j.titulo === 'Coleta · NF 2001' && /Coletar em\s*Indústria E/.test(j.corpo) && /Destinatário\s*Cliente F/.test(j.corpo), 'coleta: onde coletar e para quem vai');
  ok(/atrasado/.test(j.corpo) && /chegar entre 08:00 e 10:00/.test(j.corpo), 'mostra o agendamento e a janela de horário');
  await p.click('#ver-fechar');
  await p.waitForTimeout(150);

  await p.click(pino('1003'), { button: 'right' });
  await p.waitForTimeout(250);
  const xss = await p.evaluate(() => ({ marca: window.__xss || 0, tags: document.querySelectorAll('#modal-ver img, #modal-ver svg, #modal-ver script').length,
    txt: document.getElementById('ver-corpo').textContent }));
  ok(!xss.marca && !xss.tags && /<img src=x/.test(xss.txt), 'nome, produto, espécie e observação aparecem como texto, nunca como HTML');
  await p.click('#ver-fechar');
  await p.waitForTimeout(150);

  // tecla V com o pino em foco
  await p.focus(pino('1002'));
  await p.keyboard.press('v');
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(j.aberta && j.titulo === 'Entrega · NF 1002', 'tecla V no pino em foco abre o pedido');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);

  // o pino do CD não abre nada; o clique normal continua escolhendo
  const cd = await p.evaluate(() => { const c = document.querySelector('#mapa-manual .pino.cd'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.click(cd.x, cd.y, { button: 'right' });
  await p.waitForTimeout(200);
  ok(!(await janela(p)).aberta, 'botão direito no CD não abre janela');
  await p.click(pino('1002'));
  await p.waitForTimeout(250);
  j = await janela(p);
  ok(!j.aberta && /2 paradas/.test(j.paradas), 'o clique normal continua colocando na rota → ' + j.paradas);
  const dicaCheia = await p.evaluate(() => document.querySelector(`#mapa-manual .leaflet-marker-icon[title*="NF 1001"]`).getAttribute('title'));
  ok(/tecla V: ver o pedido/.test(dicaCheia), 'o rótulo acessível do pino ensina a tecla V');
  await p.screenshot({ path: path.join(__dirname, 'ver-pedido-1440.png') });
  await ctx.close();

  // ── 2. importar o XML grava o que a janela mostra ─────────────────────────
  const im = await open(b, 'index.html', 1440, 900, seed, false, {});
  im.p.on('dialog', (d) => d.accept());
  await im.p.waitForTimeout(500);
  await im.p.click('.sb-item[data-page="pedidos"]');
  await im.p.waitForTimeout(300);
  await im.p.setInputFiles('#file-input', XML);
  await im.p.waitForTimeout(1500);
  const reg = await im.p.evaluate((ch) => (window.__FAKE.db.empresas.emp1.pedidos_rota || {})[ch] || null, CH);
  ok(!!reg, 'a nota com produtos foi importada');
  if (reg) {
    ok(reg.peso === 332.46 && reg.itens === 3 && reg.pesoLiq === 310.5 && reg.valor === 1234.5 && reg.emissao === '2026-11-17',
      'peso, volumes, líquido, valor e emissão iguais aos do backend → ' + JSON.stringify([reg.peso, reg.itens, reg.pesoLiq, reg.valor, reg.emissao]));
    ok(JSON.stringify(reg.volumes) === JSON.stringify([{ q: 2, esp: 'CAIXA' }, { q: 1, esp: 'PALETE' }]), 'espécie dos volumes igual à do backend');
    ok(Array.isArray(reg.produtos) && reg.produtos.length === 30 && reg.produtosTotal === 32, 'guarda 30 produtos e o total de 32');
    ok(JSON.stringify(reg.produtos[0]) === JSON.stringify({ d: 'Produto número 1 linha', q: 1.5, u: 'CX', c: 'P1' }), 'produto igual ao do backend → ' + JSON.stringify(reg.produtos[0]));
    ok(reg.obsNota === 'Entregar no portão 2. Pedido 4471' && reg.fone === '1124681357', 'observação e telefone da nota');
    const vazios = Object.entries(reg).filter(([, v]) => v === undefined || (typeof v === 'number' && !Number.isFinite(v)));
    ok(!vazios.length, 'nenhum campo undefined ou NaN, que o Firebase recusaria');
  }
  await im.ctx.close();

  // ── 3. celular: segurar o dedo ────────────────────────────────────────────
  const m = await open(b, 'index.html', 390, 844, seed, true, PED);
  await m.p.waitForTimeout(700);
  await abrirManual(m.p, 1000);
  const subCel = await m.p.evaluate(() => document.getElementById('man-sub').textContent);
  ok(/Segure o dedo num ponto/.test(subCel), 'no celular a dica fala em segurar o dedo → ' + subCel);
  const segurar = (nf, ms) => m.p.evaluate(async ([nf, ms]) => {
    const a = [...document.querySelectorAll('#mapa-manual .leaflet-marker-icon')].find((x) => (x.getAttribute('title') || '').includes('NF ' + nf));
    const r = a.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const ev = (t) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y });
    a.firstElementChild.dispatchEvent(ev('pointerdown'));
    await new Promise((res) => setTimeout(res, ms));
    // o Android manda o menu de contexto no toque longo: não pode abrir duas vezes nem selecionar
    if (ms > 500) a.firstElementChild.dispatchEvent(new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch', clientX: x, clientY: y }));
    a.firstElementChild.dispatchEvent(ev('pointerup'));
    a.firstElementChild.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    await new Promise((res) => setTimeout(res, 120));
  }, [nf, ms]);

  await segurar('1001', 700);
  j = await m.p.evaluate(() => ({ aberta: document.getElementById('modal-ver').classList.contains('open'), n: document.querySelectorAll('#modal-ver .ver-nota').length,
    paradas: document.getElementById('man-paradas').textContent, tit: document.getElementById('ver-tit').textContent }));
  ok(j.aberta && j.n === 1 && j.tit === 'Entrega · NF 1001', 'segurar o dedo no pino abre o pedido');
  ok(/Nenhuma parada/.test(j.paradas), 'soltar o dedo depois de segurar não coloca na rota → ' + j.paradas);
  const caixa = await m.p.evaluate(() => {
    const bx = document.querySelector('#modal-ver .modal-box').getBoundingClientRect();
    return { w: Math.round(bx.width), dentro: bx.left >= 0 && bx.right <= window.innerWidth,
      rolaLado: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      alvo: document.getElementById('ver-fechar').getBoundingClientRect().height };
  });
  ok(caixa.dentro && !caixa.rolaLado, `a janela cabe na largura do celular (${caixa.w}px)`);
  ok(caixa.alvo >= 24, `o botão de fechar tem alvo de toque suficiente (${caixa.alvo}px)`);
  await m.p.screenshot({ path: path.join(__dirname, 'ver-pedido-390.png') });
  await m.p.tap('#ver-fechar');
  await m.p.waitForTimeout(200);

  await segurar('1002', 150);
  j = await m.p.evaluate(() => ({ aberta: document.getElementById('modal-ver').classList.contains('open'), paradas: document.getElementById('man-paradas').textContent }));
  ok(!j.aberta && /1 parada/.test(j.paradas), 'toque curto continua escolhendo, sem abrir a janela → ' + j.paradas);
  await m.p.tap(pino('1004'));
  await m.p.waitForTimeout(300);
  j = await m.p.evaluate(() => ({ aberta: document.getElementById('modal-ver').classList.contains('open'), paradas: document.getElementById('man-paradas').textContent }));
  ok(!j.aberta && /3 paradas/.test(j.paradas), 'depois de ver um pedido, o toque normal segue funcionando → ' + j.paradas);
  await m.ctx.close();

  const ruins = errs.concat(im.errs, m.errs).filter((e) => !/net::|Failed to load/.test(e));
  ok(!ruins.length, 'nenhum erro de JavaScript' + (ruins.length ? ' → ' + ruins.slice(0, 3).join(' | ') : ''));
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
