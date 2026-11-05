// Conferência visual do sistema: sem rolagem lateral, imagens carregando, desenho dos
// veículos certo e sem erro de console. (Os emoji voltaram por decisão do projeto —
// esta suíte não cobra mais ausência de emoji.)
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const PED = {}; for (let i = 1; i <= 8; i++) PED['80' + i] = { nf: '80' + i, tipo: i % 3 ? 'entrega' : 'coleta',
  cidade: ['Guarulhos','São Paulo','Arujá'][i % 3], dest: 'Cliente ' + i, endereco: 'Rua A, ' + i,
  bairro: 'Centro', uf: 'SP', cep: '0701000' + i, peso: 90 * i, itens: i, status: 'pendente',
  geoStatus: 'ok', geoPrec: 'numero', lat: -23.42 - i * 0.01, lng: -46.4 - i * 0.012 };
const MOT = { m1: { id: 'm1', nome: 'Carlos Souza', veiculo_id: 'toco', veiculo_nome: 'Truck Toco', cap_kg: 8000 } };
const seed = (d) => { window.__FAKE = { user: { uid: 'u', email: 'a@b.com', getIdToken: async () => 'T' },
  db: { acesso: { u: true }, membros: { u: 'emp1' }, empresas: { emp1: { info: { nome: 'Transportadora Exemplo' },
    config: { deposito: { nome: 'CD', lat: -23.4245, lng: -46.3877 } }, pedidos_rota: d.ped, motoristas: d.mot } } } }; };

(async () => {
  const b = await chromium.launch();
  for (const [W, H, mob] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
    const { ctx, p, errs } = await open(b, 'index.html', W, H, seed, mob, { ped: PED, mot: MOT });
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.waitForTimeout(800);
    for (const pg of ['dashboard', 'pedidos', 'roteirizacao', 'rotas', 'mapa', 'motoristas']) {
      await p.evaluate((x) => window.irParaPagina(x), pg); await p.waitForTimeout(450);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= W, `${W}px ${pg}: sem rolagem lateral (${sw})`);
      const quebradas = await p.evaluate(() => [...document.images]
        .filter((i) => !/^https?:/.test(i.getAttribute('src') || ''))      // blocos de mapa são externos
        .filter((i) => i.getClientRects().length && (!i.complete || i.naturalWidth === 0))
        .map((i) => i.getAttribute('src')));
      ok(!quebradas.length, `${W}px ${pg}: todas as imagens carregam` + (quebradas.length ? ' → ' + quebradas.join(', ') : ''));
    }
    ok(!errs.length, `${W}px: sem erros no console ` + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // Veículos: cinco desenhos diferentes e o tamanho cresce do Fiorino para a carreta
  {
    const { ctx, p } = await open(b, 'index.html', 1440, 900, seed, false, { ped: PED, mot: MOT });
    await ctx.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(800);
    const cartoes = await p.evaluate(() => [...document.querySelectorAll('#veh-grid .veh-card')]
      .map((c) => [c.querySelector('.veh-card-name')?.textContent || '', c.querySelector('img')?.getAttribute('src') || '']));
    const nomes = cartoes.map((x) => x[0]).join(',');
    ok(new Set(cartoes.map((x) => x[1])).size === 5, 'os cinco veículos têm desenhos diferentes: ' + JSON.stringify(cartoes.map((x) => x[1])));
    ok(nomes.startsWith('Fiorino') && nomes.endsWith('Carreta'), 'ordem dos veículos preservada: ' + nomes);
    // largura do desenho dentro da caixa de 120 unidades: tem que crescer
    const larguras = await p.evaluate(async () => {
      const arquivos = [...document.querySelectorAll('#veh-grid .veh-card img')].map((i) => i.getAttribute('src'));
      const medidas = [];
      for (const a of arquivos) {
        const txt = await (await fetch(a)).text();
        const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:-9999px';
        d.innerHTML = txt; document.body.appendChild(d);
        const svg = d.querySelector('svg');
        const caixa = [...svg.querySelectorAll('ellipse')][0];            // a sombra acompanha o comprimento
        medidas.push(Math.round(caixa.getBBox().width));
        d.remove();
      }
      return medidas;
    });
    const cresce = larguras.every((v, i) => i === 0 || v > larguras[i - 1]);
    ok(cresce, 'o desenho cresce do menor para o maior veículo: ' + JSON.stringify(larguras));
    await ctx.close();
  }

  // Página do motorista
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://127.0.0.1:8771/motorista.html#demo', { waitUntil: 'load' });
    await p.waitForTimeout(900);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 390, 'motorista: sem rolagem lateral (' + sw + ')');
    ok(!errs.length, 'motorista: sem erros no console ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK'); await b.close();
  process.exit(falhas ? 1 : 0);
})();
