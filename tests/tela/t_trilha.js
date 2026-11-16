// O caminho gravado pelo celular é o que torna o km rodado um número de verdade.
// Sem ele o servidor só liga uma baixa na outra pelo menor trajeto das ruas, e esse
// número sai IGUAL por qualquer caminho — foi o que confundiu na rua (16/11/2026).
// Aqui: a tela do motorista diz, durante a rota, se o caminho está sendo gravado
// (recusado pelo banco, sem internet, GPS impreciso), e o escritório não mostra mais
// a estimativa entre as baixas como se fosse km rodado.
const { chromium } = require('playwright');
const path = require('path');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const TOKEN = 'tok-trilha-0123456789abcdef';
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const PARADA = (nf, lat, lng) => ({ nf, tipo: 'entrega', dest: 'Cliente ' + nf, endereco: 'Rua ' + nf + ', 10',
  bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', cep: '07010000', lat, lng, peso: 100, itens: 1,
  chegada_min: null, janela_ini: null, janela_fim: null });
const ENTREGADOR = {
  [TOKEN]: { eid: 'emp1', expira: Date.now() + 7 * 864e5,
    info: { rota_id: 'r1', veiculo: 'VUC', motorista: 'João', data: '2026-11-16', saida: 450, criada_em: new Date().toISOString(), deposito: CD },
    paradas: [PARADA('7001', -23.45, -46.53), PARADA('7002', -23.44, -46.50)] },
};

// Abre a página do motorista num celular, com o GPS onde se pede.
async function motorista(b, { deny = [], acc = 8 } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, geolocation: { latitude: -23.4501, longitude: -46.5302, accuracy: acc }, permissions: ['geolocation'] });
  await ctx.route(/gstatic\.com\/firebasejs\/[\d.]+\/(firebase-[a-z]+\.js)/, (r) => {
    const f = r.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    r.fulfill({ path: path.join(__dirname, 'fakefb', f), contentType: 'text/javascript' });
  });
  await ctx.route(/fonts\.googleapis|fonts\.gstatic/, (r) => r.abort());
  await ctx.addInitScript(([sd, dn]) => { window.__FAKE = { user: null, db: { entregador: sd }, deny: dn }; }, [ENTREGADOR, deny]);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (x) => { if (x.type() === 'error' && !/net::|Failed to load resource/.test(x.text())) errs.push(x.text()); });
  await p.goto('http://127.0.0.1:8771/motorista.html#' + TOKEN, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  return { ctx, p, errs };
}
const trilhaTxt = (p) => p.textContent('#trilha-status');
// anda alguns passos de ~220 m para o norte (acima dos 75 m que o celular exige para gravar)
async function andar(ctx, p, n, acc = 8) {
  for (let i = 1; i <= n; i++) {
    await ctx.setGeolocation({ latitude: -23.4501 + i * 0.002, longitude: -46.5302, accuracy: acc });
    await p.waitForTimeout(400);
  }
}

(async () => {
  const b = await chromium.launch();

  // ── 1. tudo certo: o caminho é gravado e a tela diz quantos pontos ────────
  {
    const { ctx, p, errs } = await motorista(b);
    ok((await trilhaTxt(p)).includes('só é gravado com a localização ligada'), 'com a localização desligada a tela avisa que o caminho não sai: ' + (await trilhaTxt(p)));
    await p.click('[data-acao="loc"]'); await p.waitForTimeout(400);
    await andar(ctx, p, 4);
    const t = await trilhaTxt(p);
    ok(/Caminho: \d+ pontos gravados\./.test(t), 'com a localização ligada a tela mostra quantos pontos foram gravados: ' + t);
    const pts = await p.evaluate((tk) => Object.values((window.__FAKE.db.entregador[tk].trilha) || {}), TOKEN);
    ok(pts.length >= 3, `o caminho vai mesmo para o banco (${pts.length} pontos)`);
    ok(pts.every((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng) && Number.isFinite(x.t) && x.acc <= 50), 'cada ponto leva posição, hora e precisão');
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await p.screenshot({ path: 'trilha-ok.png' });
    await ctx.close();
  }

  // ── 2. o banco recusa (regras não publicadas): avisa e para de tentar ─────
  {
    const { ctx, p, errs } = await motorista(b, { deny: ['entregador/' + TOKEN + '/trilha'] });
    await p.click('[data-acao="loc"]'); await p.waitForTimeout(400);
    await andar(ctx, p, 4);
    const t = await trilhaTxt(p);
    ok(t.includes('não está sendo gravado') && t.includes('permissão'), 'recusa do banco vira aviso na tela do motorista: ' + t);
    ok(t.includes('km pelo GPS não sai'), 'e o aviso diz a consequência: o km pelo GPS não sai nesta rota');
    const semTrilha = await p.evaluate((tk) => !window.__FAKE.db.entregador[tk].trilha, TOKEN);
    ok(semTrilha, 'nada foi gravado');
    const temPos = await p.evaluate((tk) => !!window.__FAKE.db.entregador[tk].posicao, TOKEN);
    ok(temPos, 'a localização ao vivo continua funcionando: é só o caminho que está bloqueado (foi isso que enganou)');
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await p.screenshot({ path: 'trilha-bloqueada.png' });
    await ctx.close();
  }

  // ── 3. GPS impreciso demais: nenhum ponto serve, e a tela explica ─────────
  {
    const { ctx, p, errs } = await motorista(b, { acc: 140 });
    await p.click('[data-acao="loc"]'); await p.waitForTimeout(400);
    await andar(ctx, p, 4, 140);
    const t = await trilhaTxt(p);
    ok(t.includes('impreciso') && /±\d+ m/.test(t), 'GPS ruim: a tela diz que o caminho não está sendo gravado e mostra a precisão: ' + t);
    const semTrilha = await p.evaluate((tk) => !window.__FAKE.db.entregador[tk].trilha, TOKEN);
    ok(semTrilha, 'ponto com precisão pior que 50 m não entra no caminho');
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await ctx.close();
  }

  // ── 4. escritório: estimativa entre as baixas não é km rodado ─────────────
  {
    const rota = (id, kmGps) => ({ id, criada_em: new Date().toISOString(), data: '2026-11-16', veiculo: 'VUC',
      motorista: 'João', km: 30, tempo_min: 120, peso_total: 200, num_paradas: 2, entregas: 2, coletas: 0,
      status: 'em_rota', fonte_dist: 'OSRM', token: 'tk' + id, link_expira: Date.now() + 864e5,
      paradas: [PARADA('7001', -23.45, -46.53), PARADA('7002', -23.44, -46.50)], km_gps: kmGps });
    const seed = seedEmpresa({
      config: { deposito: CD },
      // sem pedidos a tela entra no modo demonstração e o bloco "planejado × realizado" não aparece
      pedidos_rota: { 7003: { id: '7003', nf: '7003', tipo: 'entrega', cidade: 'Guarulhos', uf: 'SP', dest: 'Cliente 7003',
        endereco: 'Rua C, 30', cep: '07030000', peso: 100, itens: 1, status: 'pendente', geoStatus: 'ok', lat: -23.46, lng: -46.52 } },
      rotas_confirmadas: {
        r_sem: rota('r_sem', { km_total: 31.2, km_medido: 0, km_estimado: 31.2, cobertura: 0, so_baixas: true, pontos: 0, em: Date.now() }),
        r_com: rota('r_com', { km_total: 37.4, km_medido: 33.2, km_estimado: 4.2, cobertura: 0.89, pontos: 180, em: Date.now() }),
      },
    });
    const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
      window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' }, db: sd };
    }, false, seed);
    await p.waitForTimeout(700);
    await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(1200);
    const todas = await p.textContent('#rotas-confirmadas-lista');
    ok(/Sem km pelo GPS nesta rota/.test(todas), 'rota sem caminho gravado ganha um aviso, não um número de km');
    ok(/sai igual por qualquer trajeto/.test(todas), 'e o aviso explica por que o número não serve: ' + (todas.match(/Sem km pelo GPS[^]{0,160}/) || [''])[0].replace(/\s+/g, ' '));
    ok((await p.$$('.rz-aviso')).length === 1, 'só a rota sem caminho leva o aviso (a outra não)');
    ok(/GPS <?b?>?\s*37,4 km|37,4 km/.test(todas) && /89% medido/.test(todas) && /180 pontos/.test(todas), 'rota com caminho gravado mostra o km pelo GPS, a cobertura e quantos pontos');
    ok(!/31,2 km/.test(todas.replace(/Sem km pelo GPS[^]*?não mede o que foi rodado\./, '')), 'o número da estimativa não aparece junto dos km da rota');
    ok(errs.length === 0, 'sem erro de JavaScript: ' + JSON.stringify(errs.slice(0, 2)));
    await p.screenshot({ path: 'km-sem-caminho-1440.png' });
    await ctx.close();
  }

  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
