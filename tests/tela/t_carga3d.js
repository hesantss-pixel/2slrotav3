// Carga em 3D: arrumação das caixas no baú (ordem de carregar, empilhar, o que não cabe),
// produto perigoso (ONU) e tipo de carga. Tudo aqui é inventado (placas TST); nada de cliente real.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;

const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  pedidos_rota: {
    // caixas escritas na ordem: 8 × 50 × 40 × 30 cm
    A1: { nf: '7001', tipo: 'entrega', cidade: 'Guarulhos', peso: 96, itens: 8, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Loja A', m3: 0.48, m3Fonte: 'medidas', medidas: '50 × 40 × 30 cm', geoStatus: 'ok' },
    // produto perigoso nas observações, 4 bombonas grandes
    A2: { nf: '7002', tipo: 'entrega', cidade: 'Guarulhos', peso: 1900, itens: 4, status: 'pendente', lat: -23.46, lng: -46.52, dest: 'Indústria B', m3: 3.174, m3Fonte: 'medidas', medidas: '115 × 115 × 60 cm',
      obsNota: 'QUIMICO CLASSIFICADO (ONU 3082 RISCO 90) URGENTISSIMO > LEVAR PLACA E KIT', geoStatus: 'ok' },
    // só o m³
    A3: { nf: '7003', tipo: 'entrega', cidade: 'Guarulhos', peso: 40, itens: 3, status: 'pendente', lat: -23.47, lng: -46.51, dest: 'Mercado C', m3: 1.2, m3Fonte: 'digitado', geoStatus: 'ok' },
    // sem medida
    A4: { nf: '7004', tipo: 'entrega', cidade: 'Guarulhos', peso: 300, itens: 2, status: 'pendente', lat: -23.48, lng: -46.50, dest: 'Oficina D', geoStatus: 'ok' },
    // barras compridas
    A5: { nf: '7005', tipo: 'entrega', cidade: 'Guarulhos', peso: 300, itens: 20, status: 'pendente', lat: -23.49, lng: -46.49, dest: 'Serralheria E', m3: 1.2, m3Fonte: 'medidas', medidas: '400 × 15 × 10 cm', maiorCm: 400, geoStatus: 'ok' },
    C_A6: { nf: '7006', tipo: 'coleta', cidade: 'Guarulhos', peso: 200, itens: 3, status: 'pendente', lat: -23.44, lng: -46.49, dest: 'Fornecedor F', m3: 1, m3Fonte: 'planilha', geoStatus: 'ok' },
  },
  motoristas: {
    mot_bau: { id: 'mot_bau', nome: 'Motorista Teste', veiculo_id: 'tres4', veiculo_nome: 'Caminhão 3/4', cap_kg: 5000, modelo: 'Accelo 815', placa: 'TST3D11', bau_c: 4.5, bau_l: 2.3, bau_a: 2.5 },
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };
const emp = (p) => p.evaluate(() => window.__FAKE.db.empresas.emp1);

// confere uma arrumação: dentro do baú, sem sobrepor, com apoio, e nenhuma parada mais para o
// fundo que a frente das que entraram antes (nada fica atrás de carga que sai depois)
function confere(bau, res, empilhar) {
  const E = 1e-6, prob = [];
  res.pos.forEach((b, i) => {
    if (b.x < -E || b.y < -E || b.z < -E || b.x + b.dx > bau.c + E || b.y + b.dy > bau.l + E || b.z + b.dz > bau.a + E) prob.push('fora do baú ' + i);
    if (!empilhar && b.z > E) prob.push('empilhou sem poder ' + i);
    res.pos.forEach((c, j) => { if (j <= i) return;
      if (b.x < c.x + c.dx - E && c.x < b.x + b.dx - E && b.y < c.y + c.dy - E && c.y < b.y + b.dy - E && b.z < c.z + c.dz - E && c.z < b.z + b.dz - E) prob.push(`sobrepõe ${i}/${j}`); });
    if (b.z > E) { let a = 0;
      res.pos.forEach((c) => { if (Math.abs(c.z + c.dz - b.z) > 1e-4) return;
        const ix = Math.min(b.x + b.dx, c.x + c.dx) - Math.max(b.x, c.x), iy = Math.min(b.y + b.dy, c.y + c.dy) - Math.max(b.y, c.y);
        if (ix > E && iy > E) a += ix * iy; });
      if (a < b.dx * b.dy * 0.7 - E) prob.push('sem apoio ' + i); }
    const antes = res.pos.filter((c) => c.g < b.g);
    if (antes.length && b.x < Math.max(...antes.map((c) => c.x)) - E) prob.push(`parada ${b.g} atrás da ${antes.find((c) => c.x > b.x).g}`);
  });
  return prob;
}

(async () => {
  const b = await chromium.launch();
  let solveReq = null;
  const { p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed, async (c) => {
    await c.route(/railway\.app\/solve/, async (r) => {
      solveReq = JSON.parse(r.request().postData());
      const ent = solveReq.pedidos.filter((x) => x.tipo !== 'coleta'), col = solveReq.pedidos.filter((x) => x.tipo === 'coleta');
      r.fulfill({ contentType: 'application/json', body: J({ routes: [{ veiculo: '3/4', veiculo_id: 'tres4', pedidos: ent.concat(col), km: 22, mins: 80 }],
        nao_alocados: [], fonte_distancia: 'OSRM', regra_carga: 'entregas_antes_das_coletas' }) });
    });
  });
  const dialogs = [];
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

  // ── produto perigoso escrito no texto ──────────────────────────────────────
  const pg = await p.evaluate(() => [
    'QUIMICO CLASSIFICADO (ONU 3082 RISCO 90) URGENTISSIMO', 'Nº ONU: 1263 - tinta', 'UN 1993 classe 3', 'UN 1993',
    'PRODUTO PERIGOSO, manusear com cuidado', 'Mercadoria não classificada como perigosa', 'Não transportamos produtos perigosos',
    'Produto não perigoso', 'Caixa 50X50X50', ''].map((t) => window.__perigosoDoTexto(t)));
  ok(J(pg) === J([{ onu: '3082', risco: '90' }, { onu: '1263' }, { onu: '1993' }, null, { onu: '' }, null, null, null, null, null]),
    'produto perigoso: ONU com risco, Nº ONU, UN só com classe, frase sem número; negação e "UN" solto não marcam ' + J(pg));

  // ── arrumação ─────────────────────────────────────────────────────────────
  const bau = { c: 4.5, l: 2.3, a: 2.5 };
  const g1 = [{ caixas: [{ c: 1.15, l: 1.15, a: 0.6, q: 4 }] }, { caixas: [{ c: 0.5, l: 0.4, a: 0.3, q: 8 }] }, { caixas: [{ aprox: true, m3: 1.2 }] }];
  let r1 = await p.evaluate(([bau, g]) => window.__arrumarCarga(bau, g, true), [bau, g1]);
  ok(r1.fora.length === 0 && r1.pos.reduce((s, x) => s + (x.q || 0), 0) === 12, 'empilhando: as 12 caixas e o bloco do m³ cabem: ' + J([r1.pos.length, r1.fora.length]));
  ok(confere(bau, r1, true).length === 0, 'sem sobrepor, dentro do baú, com apoio e na ordem de carregar ' + J(confere(bau, r1, true)));
  ok(r1.pos.filter((x) => x.g === 0).every((x) => x.x < 1.2), 'a primeira a carregar fica no fundo (perto da cabine)');
  ok(r1.pos.some((x) => x.g === 0 && x.z > 0.5), 'bombonas de 60 cm empilham quando o chão daquela parede enche');
  let r2 = await p.evaluate(([bau, g]) => window.__arrumarCarga(bau, g, false), [bau, g1]);
  ok(confere(bau, r2, false).length === 0 && r2.pos.every((x) => x.z < 1e-6), 'sem empilhar: tudo no chão ' + J(confere(bau, r2, false)));
  const grande = await p.evaluate(([bau]) => window.__arrumarCarga(bau, [{ caixas: [{ c: 3, l: 2.2, a: 2.4, q: 1 }] }, { caixas: [{ c: 2, l: 2, a: 2, q: 1 }] }, { caixas: [{ c: 6, l: 0.2, a: 0.2, q: 1 }] }], true), [bau]);
  ok(grande.pos.length === 1 && J(grande.fora.map((f) => f.g)) === J([1, 2]), 'o que não cabe pelo formato fica de fora (2 m depois de 3 m num baú de 4,5 m; peça de 6 m) ' + J(grande.fora.map((f) => f.g)));
  const muitas = await p.evaluate(([bau]) => { const t = performance.now(); const r = window.__arrumarCarga(bau, [{ caixas: [{ c: 0.3, l: 0.2, a: 0.2, q: 380 }] }, { caixas: [{ c: 0.4, l: 0.3, a: 0.25, q: 150 }] }], true); return { r, ms: performance.now() - t }; }, [bau]);
  ok(confere(bau, muitas.r, true).length === 0 && muitas.r.pos.reduce((s, x) => s + x.q, 0) + muitas.r.fora.reduce((s, x) => s + x.q, 0) === 530 && muitas.ms < 1500,
    `530 caixas viram pilhas e fileiras, sem perder nenhuma, em ${Math.round(muitas.ms)} ms`);

  // ── peso por volume, frágil, "não empilhar", centro de gravidade ──────────
  const rg = await p.evaluate(() => [['FRÁGIL', ''], ['Cuidado com o portão', ''], ['NÃO EMPILHAR. ESTE LADO PARA CIMA', ''], ['Produto não frágil', ''], ['', 'LIMPA VIDROS 500ML'], ['', 'JOGO DE PORCELANA 12 PCS'], ['Caixa 50X50X50', 'PARAFUSO']]
    .map(([o, d]) => window.__regrasDoTexto(o, d)));
  ok(J(rg) === J([{ fragil: true }, null, { naoEmp: true, ladoCima: true }, null, null, { fragil: true }, null]), 'cuidados lidos do texto (negação e "limpa vidros" não contam) ' + J(rg));
  const b1 = { c: 0.5, l: 1, a: 1 }, cx2 = [{ c: 0.5, l: 0.5, a: 0.5, q: 2 }];
  const pesLeve = await p.evaluate(([b, cx]) => window.__arrumarCarga(b, [{ caixas: cx, kg: 4 }, { caixas: cx, kg: 400 }], true), [b1, cx2]);
  const levPes = await p.evaluate(([b, cx]) => window.__arrumarCarga(b, [{ caixas: cx, kg: 400 }, { caixas: cx, kg: 4 }], true), [b1, cx2]);
  ok(pesLeve.fora.length === 2 && levPes.fora.length === 0 && levPes.pos.filter((x) => x.g === 1).every((x) => x.z > 0.4), 'pesado (200 kg cada) não vai em cima do leve (2 kg cada); leve vai em cima do pesado');
  const fr = await p.evaluate(([b, cx]) => window.__arrumarCarga(b, [{ caixas: cx, kg: 40, regras: { fragil: true } }, { caixas: cx, kg: 4 }], true), [b1, cx2]);
  ok(fr.fora.length === 2 && J(fr.pos.map((x) => x.z)) === J([0, 0]), 'nada vai em cima do frágil');
  const cg = await p.evaluate(() => { const r = window.__arrumarCarga({ c: 4, l: 2, a: 2 }, [{ caixas: [{ c: 1, l: 1, a: 1, q: 1 }], kg: 300 }, { caixas: [{ c: 1, l: 1, a: 1, q: 1 }], kg: 100 }], false);
    return r.pos.map((b) => [b.x, b.y, Math.round(b.kg)]); });
  ok(J(cg) === J([[0, 0, 300], [0, 1, 100]]), 'peso do pedido vai para os volumes dele ' + J(cg));
  const fRota = await p.evaluate(() => window.__formatoRota([{ id: 'x1', nf: '1', tipo: 'entrega', peso: 50, m3: 8, cx: [{ c: 300, l: 220, a: 240, q: 1 }] }, { id: 'x2', nf: '2', tipo: 'entrega', peso: 900, m3: 2.4, cx: [{ c: 400, l: 15, a: 10, q: 20 }] }], { c: 4.5, l: 2.3, a: 2.5 }));
  ok(fRota && J(fRota.fora) === J([{ n: 1, nf: '1', q: 1 }]) && fRota.cg.x > 1.9 && fRota.cg.x < 2.1, 'conferência da rota: o cubo de 3 m não cabe sobre as barras (o m³ cabia) ' + J(fRota && fRota.fora));

  // ── caixas de cada pedido ─────────────────────────────────────────────────
  const cx = await p.evaluate(() => ['A1', 'A2', 'A3', 'A4', 'A5'].map((id) => window.__caixasDe({ id, ...window.__FAKE.db.empresas.emp1.pedidos_rota[id] })));
  ok(J(cx) === J([[{ c: 0.5, l: 0.4, a: 0.3, q: 8 }], [{ c: 1.15, l: 1.15, a: 0.6, q: 4 }], [{ aprox: true, m3: 1.2 }], [], [{ c: 4, l: 0.15, a: 0.1, q: 20 }]]),
    'caixas do pedido: medidas × volumes; só m³ vira bloco; sem medida, nada ' + J(cx));
  const T2 = [{ c: 50, l: 50, a: 50, q: 2 }, { c: 80, l: 60, a: 40, q: 3 }];
  // pedidos gravados no banco com os tamanhos lidos das observações (o pedido na memória não leva o cx)
  await p.evaluate((T2) => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota, b = { tipo: 'entrega', cidade: 'Guarulhos', peso: 60, itens: 5, status: 'cancelado', m3Fonte: 'medidas', medidas: '2 de 50 × 50 × 50 cm; 3 de 80 × 60 × 40 cm' };
    d.Z1 = { ...b, nf: 'Z1', m3: 0.826, cx: T2 }; d.Z2 = { ...b, nf: 'Z2', m3: 2, m3Fonte: 'cte', cx: T2 }; d.Z3 = { ...b, nf: 'Z3', m3: 0.826 }; window.__FAKE.fire(); }, T2);
  await p.waitForTimeout(250);
  const cxV = await p.evaluate(() => [window.__caixasDe({ id: 'Z1', m3: 0.826 }), window.__caixasDe({ id: 'Z2', m3: 2 }), window.__caixasDe({ id: 'Z3', m3: 0.826, itens: 5 })]);
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; delete d.Z1; delete d.Z2; delete d.Z3; window.__FAKE.fire(); }); await p.waitForTimeout(250);
  ok(J(cxV) === J([[{ c: 0.5, l: 0.5, a: 0.5, q: 2 }, { c: 0.8, l: 0.6, a: 0.4, q: 3 }], [{ aprox: true, m3: 2 }], [{ aprox: true, m3: 0.826 }]]),
    'pedido com 2 tamanhos vira caixas de cada tamanho; com o m³ trocado depois, ou sem os tamanhos guardados, não inventa o formato ' + J(cxV));
  const bauF = { c: 1.87, l: 1.29, a: 1.25 };
  const fiV = await p.evaluate(([b, cx]) => window.__arrumarCarga(b, [{ caixas: cx, kg: 60 }], true), [bauF, cxV[0]]);
  const formas = fiV.pos.map((x) => [x.dx, x.dy, x.dz].map((v) => Math.round(v * 100)).sort((a, b) => a - b).join('×')).sort();
  ok(fiV.fora.length === 0 && J(formas) === J(['40×60×80', '40×60×80', '40×60×80', '50×50×50', '50×50×50']) && confere(bauF, fiV, true).length === 0,
    'na Fiorino, cada caixa é desenhada com o tamanho dela (2 de 50 cm e 3 de 80 × 60 × 40) ' + J(formas));
  const tipos = await p.evaluate(() => ['A1', 'A2', 'A3', 'A5'].map((id) => window.__tipoCarga({ id, ...window.__FAKE.db.empresas.emp1.pedidos_rota[id] })));
  ok(J(tipos) === J(['comum (200 kg por m³)', 'comum (599 kg por m³)', 'leve e volumosa (33 kg por m³)', 'comprida (250 kg por m³)']), 'tipo de carga pelo formato e pelo peso por m³ ' + J(tipos));

  // ── roteirização e plano de carga em 3D ───────────────────────────────────
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST3D11")'); await p.waitForTimeout(300);
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  const det = (await p.textContent('#rota-detail-d')).replace(/\s+/g, ' ');
  ok(/Produto perigoso na parada \d \(NF 7002, ONU 3082\): confira rótulos e placas, kit de emergência, documento fiscal com os dados do produto e motorista com curso MOPP/.test(det), 'resultado da rota avisa o produto perigoso, com o que conferir');
  ok((await p.$$eval('#rota-detail-d .perig-tag', (e) => e.map((x) => x.textContent))).includes('⚠ ONU 3082'), 'a parada mostra a marca ⚠ ONU 3082');
  await p.click('text=Plano de carga'); await p.waitForTimeout(400);
  const pl = await p.evaluate(() => ({
    abas: [...document.querySelectorAll('.plano-aba')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')),
    cv: (() => { const c = document.getElementById('c3d-cv'); return c && [c.clientWidth > 300, c.clientHeight >= 250, c.width > 0]; })(),
    lado: document.getElementById('plano-plado').hidden,
    chips: [...document.querySelectorAll('.c3d-chip')].map((x) => x.textContent),
    resumo: document.getElementById('c3d-resumo').textContent,
    tab: document.querySelector('#plano-corpo .plano-tab').textContent.replace(/\s+/g, ' '),
    corpo: document.getElementById('plano-corpo').textContent.replace(/\s+/g, ' '),
    passo: document.getElementById('c3d-ate-txt').textContent,
  }));
  ok(J(pl.abas) === J(['Em 3D:true', 'De lado (m³):false']) && J(pl.cv) === J([true, true, true]) && pl.lado, 'plano abre em 3D, com o desenho de lado na outra aba ' + J([pl.abas, pl.cv]));
  ok(pl.chips.length === 5 && pl.chips.some((t) => /^\dIndústria B ⚠/.test(t)) && pl.chips.some((t) => /sem medida/.test(t)) && J(pl.chips.map((t) => +t[0])) === J([1, 2, 3, 4, 5]),
    'uma legenda por entrega, em ordem de parada, com o número, o nome, ⚠ no perigoso e "sem medida" ' + J(pl.chips));
  const c3a = await p.evaluate(() => ({ e: window.__c3d(), chips: [...document.querySelectorAll('.c3d-chip i')].map((i) => [+i.textContent, i.getAttribute('style')]) }));
  ok(c3a.chips.every(([n, st]) => st === 'background:' + c3a.e.cores[n - 1]) && c3a.e.naPos.every((k) => c3a.e.marcadas.includes(k)),
    'cada parada tem a cor da posição dela na rota, e toda parada desenhada tem o número no desenho ' + J([c3a.chips, c3a.e.naPos, c3a.e.marcadas]));
  ok(/4 paradas desenhadas, 32 volumes/.test(pl.resumo) && /Só com o m³.*parada \d/.test(pl.resumo) && /Sem medida, fora do desenho: parada \d/.test(pl.resumo), 'resumo diz o que foi desenhado, o que é só m³ e o que ficou fora: ' + pl.resumo);
  ok(/NF 7002⚠ ONU 3082/.test(pl.tab) && /carga comprida/.test(pl.tab) && /carga leve e volumosa/.test(pl.tab), 'tabela marca o perigoso e o tipo de carga');
  ok(/⚠ Produto perigoso na parada \d \(ONU 3082\)/.test(pl.corpo) && pl.passo === 'tudo carregado', 'plano avisa o perigoso; passo começa com tudo carregado');
  ok(/Centro de gravidade da carga \(marca dourada ao lado do baú\): a [\d,]+ m da cabine \(\d+% do baú\)/.test(pl.resumo), 'plano mostra o centro de gravidade da carga');
  await p.click('.c3d-chip:has-text("⚠")'); await p.waitForTimeout(150);
  let info = (await p.textContent('#c3d-info')).replace(/\s+/g, ' ');
  ok(/Parada \d \(\d+º a carregar\) · NF 7002 · Indústria B · 4 volumes de 115 × 115 × 60 cm · 3,17 m³ · 1\.900 kg · carga comum .* ⚠ Produto perigoso ONU 3082, risco 90/.test(info), 'tocar na parada mostra o pedido: ' + info);
  // tocar numa caixa no desenho
  await p.click('.c3d-chip:has-text("⚠")'); await p.waitForTimeout(100);
  const box = await p.$eval('#c3d-cv', (c) => { const r = c.getBoundingClientRect(); return [r.width, r.height]; });
  let achou = '';
  for (const [fx, fy] of [[0.5, 0.5], [0.4, 0.55], [0.6, 0.5], [0.45, 0.45], [0.55, 0.6], [0.35, 0.5], [0.65, 0.55]]) {
    await p.click('#c3d-cv', { position: { x: box[0] * fx, y: box[1] * fy } }); await p.waitForTimeout(80);
    achou = await p.textContent('#c3d-info'); if (/^Parada/.test(achou)) break;
  }
  ok(/^Parada \d/.test(achou), 'tocar numa caixa do desenho mostra de qual parada ela é: ' + achou.slice(0, 60));
  // girar arrastando e vistas prontas
  const antes = await p.evaluate(() => document.getElementById('c3d-cv').toDataURL());
  await p.mouse.move(400, 300); const cvb = await p.$eval('#c3d-cv', (c) => { const r = c.getBoundingClientRect(); return [r.x, r.y]; });
  await p.mouse.move(cvb[0] + 200, cvb[1] + 150); await p.mouse.down(); await p.mouse.move(cvb[0] + 320, cvb[1] + 170, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(100);
  const depois = await p.evaluate(() => document.getElementById('c3d-cv').toDataURL());
  ok(antes !== depois && (await p.$$eval('.c3d-v[aria-pressed="true"]', (e) => e.length)) === 0, 'arrastar gira o desenho (e solta a vista pronta)');
  await p.click('.c3d-v[data-v="porta"]'); await p.waitForTimeout(100);
  ok((await p.getAttribute('.c3d-v[data-v="porta"]', 'aria-pressed')) === 'true', 'vista "Pela porta"');
  await p.focus('#c3d-cv'); const k0 = await p.evaluate(() => document.getElementById('c3d-cv').toDataURL());
  await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(60);
  ok(k0 !== await p.evaluate(() => document.getElementById('c3d-cv').toDataURL()), 'setas do teclado giram o desenho');
  await p.click('.c3d-v[data-v="3d"]'); await p.waitForTimeout(100);
  if (process.env.FOTOS) await p.screenshot({ path: 'c3d-plano-1280.png' });
  // passo a passo do carregamento
  await p.fill('#c3d-ate', '1'); await p.dispatchEvent('#c3d-ate', 'input'); await p.waitForTimeout(100);
  ok(/^1º: parada \d$/.test(await p.textContent('#c3d-ate-txt')), 'passo a passo: mostra só a primeira parada a carregar');
  await p.fill('#c3d-ate', '5'); await p.dispatchEvent('#c3d-ate', 'input'); await p.waitForTimeout(80);
  // sem empilhar
  await p.uncheck('#c3d-emp'); await p.waitForTimeout(150);
  ok(/Não couberam sem empilhar pelo formato: parada \d/.test(await p.textContent('#c3d-resumo')) || /paradas desenhadas/.test(await p.textContent('#c3d-resumo')), 'desligar "Empilhar" arruma de novo: ' + (await p.textContent('#c3d-resumo')).slice(0, 120));
  await p.check('#c3d-emp'); await p.waitForTimeout(100);
  // coletas: o mesmo baú na volta, na ordem em que são feitas
  ok(J(await p.$$eval('.c3d-m', (e) => e.map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')))) === J(['Na saída do CD:true', 'Ao longo da viagem:false']), 'rota com entregas e coletas: escolhe o momento da viagem');
  await p.click('.c3d-m[data-m="viagem"]'); await p.waitForTimeout(150);
  const mc = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.c3d-chip')].map((x) => x.textContent), res: document.getElementById('c3d-resumo').textContent,
    passo: document.querySelector('.c3d-passo').hidden, lbl: document.querySelector('.c3d-passo label').textContent, max: document.getElementById('c3d-ate').max, txt: document.getElementById('c3d-ate-txt').textContent }));
  const c3b = await p.evaluate(() => [...document.querySelectorAll('.c3d-chip i')].map((i) => [+i.textContent, i.getAttribute('style')]));
  ok(c3a.chips.every(([n, st]) => c3b.some(([m, s2]) => m === n && s2 === st)), 'a parada fica com a mesma cor "Na saída do CD" e "Ao longo da viagem" ' + J(c3b));
  ok(mc.chips.length === 6 && mc.chips[5] === '6Fornecedor F · coleta' && /^1\D/.test(mc.chips[0]) && !mc.passo && mc.lbl === 'Viagem' && mc.max === '6',
    '"Ao longo da viagem": todas as paradas na ordem, com o passo por parada ' + J(mc.chips));
  ok(/^Ao longo da viagem: cada entrega tira as caixas dela; cada coleta entra no espaço livre/.test(mc.res) && /Agora: [\d,]+ m³ a bordo na saída do CD .*O momento mais cheio é na saída do CD/.test(mc.res) && /saída do CD · mais cheio/.test(mc.txt),
    'começa no momento mais cheio (aqui, a saída: as entregas saem antes da coleta) ' + mc.res.slice(0, 200));
  await p.fill('#c3d-ate', '6'); await p.dispatchEvent('#c3d-ate', 'input'); await p.waitForTimeout(120);
  const fim = await p.evaluate(() => ({ txt: document.getElementById('c3d-ate-txt').textContent, res: document.getElementById('c3d-resumo').textContent }));
  ok(fim.txt === 'depois da parada 6 (coleta)' && /Agora: 1 m³ a bordo depois da parada 6/.test(fim.res), 'no fim da viagem só a coleta está a bordo ' + J(fim));
  await p.click('.c3d-m[data-m="saida"]'); await p.waitForTimeout(100);
  ok((await p.$$eval('.c3d-chip', (e) => e.length)) === 5 && (await p.textContent('#c3d-ate-txt')) === 'tudo carregado', 'volta para a saída do CD');
  await p.click('.plano-aba[data-aba="lado"]'); await p.waitForTimeout(80);
  ok(!(await p.isVisible('#c3d-cv')) && (await p.isVisible('#plano-plado svg')), 'aba "De lado" mostra o desenho por m³');
  await p.click('.plano-aba[data-aba="3d"]'); await p.waitForTimeout(80);
  // imprimir leva a imagem do 3D
  await p.evaluate(() => { window.__impr = ''; window.open = () => ({ document: { write: (h) => { window.__impr += h; }, close() {} }, focus() {}, print() {} }); });
  await p.click('#modal-plano >> text=Imprimir'); await p.waitForTimeout(400);
  const impr = await p.evaluate(() => window.__impr);
  ok(/<img class="plano-3d" src="data:image\/png;base64,/.test(impr) && !/c3d-cv/.test(impr) && /<svg class="plano-svg"/.test(impr), 'impressão leva a imagem do 3D e o desenho de lado, sem os botões');
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(150);
  ok(errs.length === 0, 'sem erro na tela até aqui ' + J(errs.slice(0, 3)));

  // ── confirmar: a rota guarda o formato das caixas e o perigoso ────────────
  await p.click('text=Confirmar saída do veículo'); await p.waitForTimeout(800);
  const rc = Object.values((await emp(p)).rotas_confirmadas || {})[0];
  const par = (nf) => rc && rc.paradas.find((x) => x.nf === nf);
  ok(rc && J(par('7001').cx) === J([{ c: 50, l: 40, a: 30, q: 8 }]) && J(par('7002').perigoso) === J({ onu: '3082', risco: '90' }) && !par('7003').cx && !par('7004').perigoso,
    'rota confirmada guarda as caixas (cm) e o produto perigoso da parada: ' + J(rc && [par('7001').cx, par('7002').perigoso]));
  ok(rc && J(rc.bau) === J({ c: 4.5, l: 2.3, a: 2.5 }), 'e as medidas do baú');
  // plano da rota confirmada continua em 3D mesmo sem o pedido no banco
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; delete d.A1; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(300);
  await p.click('#rotas-confirmadas-lista >> text=Plano de carga'); await p.waitForTimeout(350);
  const rc3 = await p.evaluate(() => ({ cv: !!document.getElementById('c3d-cv'), chips: document.querySelectorAll('.c3d-chip').length, res: document.getElementById('c3d-resumo').textContent }));
  ok(rc3.cv && rc3.chips === 5 && /4 paradas desenhadas, 32 volumes/.test(rc3.res), 'plano da rota confirmada abre em 3D com o que ela guardou: ' + J(rc3));
  await p.click('#modal-plano .btn-modal-sec');

  // ── rota com caixa que não cabe pelo formato: avisa antes de confirmar ─────
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; Object.values(d).forEach((x) => { x.status = 'pendente'; x.rota_atual = ''; });
    d.A1 = d.A1 || { nf: '7001', tipo: 'entrega', cidade: 'Guarulhos', peso: 96, itens: 8, status: 'pendente', lat: -23.45, lng: -46.53, dest: 'Loja A', m3: 0.48, m3Fonte: 'medidas', medidas: '50 × 40 × 30 cm', geoStatus: 'ok' };
    Object.assign(d.A3, { m3: 15.84, m3Fonte: 'medidas', medidas: '300 × 220 × 240 cm', itens: 1, obsNota: 'FRÁGIL' }); });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(300);
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST3D11")'); await p.waitForTimeout(300);
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  const det2 = (await p.textContent('#rota-detail-d')).replace(/\s+/g, ' ');
  ok(/Pelo formato das caixas, 1 volume não cabe no baú \(parada \d, NF 7003\), mesmo empilhando/.test(det2), 'resultado avisa o volume que não cabe pelo formato: ' + (det2.match(/Pelo formato[^.]*\./) || [''])[0]);
  dialogs.length = 0;
  await p.click('text=Confirmar saída do veículo'); await p.waitForTimeout(600);
  ok(dialogs.some((t) => /Pelo formato das caixas/.test(t)), 'confirmar pede confirmação quando não cabe pelo formato');
  const rc2 = Object.values((await emp(p)).rotas_confirmadas || {}).find((x) => x.paradas.some((y) => y.nf === '7003' && y.cx));
  ok(rc2 && J(rc2.paradas.find((y) => y.nf === '7003').regras) === J({ fragil: true }), 'a parada guarda o cuidado "frágil" na rota confirmada ' + J(rc2 && rc2.paradas.find((y) => y.nf === '7003')) + J(Object.keys((await emp(p)).rotas_confirmadas || {})));

  // ── rota só de coletas (como a ordem de coleta da Via Verde) ───────────────
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1; d.rotas_confirmadas = d.rotas_confirmadas || {};
    d.rotas_confirmadas.rota_col_1 = { id: 'rota_col_1', data: '2026-11-25', saida: 420, veiculo: 'Caminhão 3/4', status: 'em_rota', cap_kg: 5000, cap_m3: 21.99, bau_m3: 25.88, bau: { c: 4.5, l: 2.3, a: 2.5 },
      paradas: [{ id: 'C1', nf: '8101', tipo: 'coleta', dest: 'Fornecedor X', cidade: 'Guarulhos', peso: 1900, itens: 4, m3: 3.174, m3Fonte: 'medidas', cx: [{ c: 115, l: 115, a: 60, q: 4 }], perigoso: { onu: '3082', risco: '90' } },
        { id: 'C2', nf: '8102', tipo: 'coleta', dest: 'Fornecedor Y', cidade: 'Cotia', peso: 80, itens: 6, m3: 0.36, m3Fonte: 'medidas', cx: [{ c: 50, l: 40, a: 30, q: 6 }] }] };
    d.rotas_confirmadas.rota_velha_1 = { id: 'rota_velha_1', data: '2026-11-20', saida: 420, veiculo: 'VUC', status: 'em_rota', paradas: [{ id: 'V1', nf: '8201', tipo: 'entrega', dest: 'Cliente Z', cidade: 'Guarulhos', peso: 50, itens: 1, m3: 0.5 }] }; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(300);
  await p.evaluate(() => window.abrirPlanoCargaRota('rota_col_1')); await p.waitForTimeout(350);
  const so = await p.evaluate(() => ({ abas: document.querySelectorAll('.plano-aba').length, modos: document.querySelectorAll('.c3d-m').length, cv: !!document.getElementById('c3d-cv'),
    chips: [...document.querySelectorAll('.c3d-chip')].map((x) => x.textContent), passo: document.getElementById('c3d-ate-txt').textContent,
    corpo: document.getElementById('plano-corpo').textContent.replace(/\s+/g, ' ') }));
  ok(so.cv && so.abas === 0 && so.modos === 0 && J(so.chips) === J(['1Fornecedor X · coleta ⚠', '2Fornecedor Y · coleta']) && so.passo === 'depois da parada 2 (coleta) · mais cheio',
    'rota só de coletas abre direto o 3D das coletas, na ordem: ' + J([so.chips, so.passo]));
  ok(/só tem coletas: o veículo sai vazio e o 3D mostra como as coletas entram no baú/.test(so.corpo) && /Ordem das coletas\s*A primeira coleta entra primeiro e vai para o fundo/.test(so.corpo) && /1ª\s*1\s*NF 8101⚠ ONU 3082/.test(so.corpo) && !/junto à cabine/.test(so.corpo) && /Coletas: 3,53 m³ de 25,88 m³ do baú/.test(so.corpo),
    'tabela "Ordem das coletas" e o volume das coletas no baú ' + so.corpo.slice(-900));
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(100);
  // Fiorino com coleta antes de entrega: a coleta entra na frente da entrega que ainda está a bordo
  const fio = { c: 1.87, l: 1.29, a: 1.25 };
  const ev = await p.evaluate(([b]) => window.__estadosViagem(b, [
    { id: 'm1', nf: 'M1', tipo: 'coleta', peso: 60, m3: 0.576, cx: [{ c: 60, l: 40, a: 40, q: 6 }] },
    { id: 'm2', nf: 'M2', tipo: 'coleta', peso: 60, m3: 0.576, cx: [{ c: 60, l: 40, a: 40, q: 6 }] },
    { id: 'm3', nf: 'M3', tipo: 'entrega', peso: 380, m3: 0.96, cx: [{ c: 60, l: 40, a: 40, q: 10 }] }]).map((e) => ({ apos: e.apos, n: e.pos.length, fora: e.fora.length,
      colX: Math.min(...e.pos.filter((x) => x.g !== 2).map((x) => x.x).concat([9])), vol: Math.round(e.vol * 1000) / 1000 })), [fio]);
  ok(J(ev.map((e) => e.apos)) === J([0, 1, 2, 3]) && ev[0].n === 10 && ev[1].n === 16 && ev[2].n === 22 && ev[3].n === 12 && ev[1].colX >= 0.6 - 1e-9 && ev.every((e) => e.fora === 0),
    'viagem: sai com a entrega; as coletas entram na frente dela (x ≥ 0,6 m); a entrega sai na parada 3 ' + J(ev));
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1; d.rotas_confirmadas.rota_mist_1 = { id: 'rota_mist_1', data: '2026-11-25', saida: 420, veiculo: 'Fiorino', status: 'em_rota', cap_kg: 650, bau: { c: 1.87, l: 1.29, a: 1.25 },
    paradas: [{ id: 'm1', nf: 'M1', tipo: 'coleta', dest: 'Rem 1', peso: 60, itens: 6, m3: 0.576, cx: [{ c: 60, l: 40, a: 40, q: 6 }] }, { id: 'm2', nf: 'M2', tipo: 'coleta', dest: 'Rem 2', peso: 60, itens: 6, m3: 0.576, cx: [{ c: 60, l: 40, a: 40, q: 6 }] },
      { id: 'm3', nf: 'M3', tipo: 'entrega', dest: 'Cli 3', peso: 380, itens: 10, m3: 0.96, cx: [{ c: 60, l: 40, a: 40, q: 10 }] }] }; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(250);
  await p.evaluate(() => window.abrirPlanoCargaRota('rota_mist_1')); await p.waitForTimeout(300);
  await p.click('.c3d-m[data-m="viagem"]'); await p.waitForTimeout(150);
  const mi = await p.evaluate(() => ({ res: document.getElementById('c3d-resumo').textContent, txt: document.getElementById('c3d-ate-txt').textContent }));
  ok(/Esta rota faz coleta antes de entrega: a carga coletada entra na frente das entregas que ainda vão sair/.test(mi.res) && mi.txt === 'depois da parada 2 (coleta) · mais cheio' && /2,11 m³ a bordo depois da parada 2/.test(mi.res),
    'rota mista na Fiorino: mostra o momento mais cheio (coletas + entrega a bordo) e avisa a coleta antes da entrega ' + J(mi));
  if (process.env.FOTOS) { await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200); await p.evaluate(() => { const m = document.getElementById('modal-plano'); m.scrollTop = 0; const bx = m.querySelector('.modal-box'); if (bx) bx.scrollTop = 0; }); await p.screenshot({ path: 'c3d-fiorino-390.png' }); await p.setViewportSize({ width: 1280, height: 900 }); }
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(100);
  await p.evaluate(() => window.abrirPlanoCargaRota('rota_velha_1')); await p.waitForTimeout(250);
  ok(/Sem o 3D: esta rota foi confirmada sem as medidas do baú/.test(await p.textContent('#plano-corpo')) && !(await p.$('#c3d-cv')), 'rota antiga sem medidas do baú diz por que não tem 3D');
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(100);
  // pedido com dois tamanhos de caixa: o desenho e o texto mostram cada um
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1; d.rotas_confirmadas.rota_var_1 = { id: 'rota_var_1', data: '2026-11-25', saida: 420, veiculo: 'Fiorino', status: 'em_rota', cap_kg: 650, bau: { c: 1.87, l: 1.29, a: 1.25 },
    paradas: [{ id: 'v1', nf: 'V1', tipo: 'entrega', dest: 'Cli V', peso: 60, itens: 5, m3: 0.826, m3Fonte: 'medidas', medidas: '2 de 50 × 50 × 50 cm; 3 de 80 × 60 × 40 cm', cx: [{ c: 50, l: 50, a: 50, q: 2 }, { c: 80, l: 60, a: 40, q: 3 }] }] }; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(250);
  await p.evaluate(() => window.abrirPlanoCargaRota('rota_var_1')); await p.waitForTimeout(300);
  await p.click('.c3d-chip'); await p.waitForTimeout(120);
  const vInfo = (await p.textContent('#c3d-info')).replace(/\s+/g, ' '), vRes = await p.textContent('#c3d-resumo');
  ok(/NF V1 · Cli V · 2 de 50 × 50 × 50 cm e 3 de 80 × 60 × 40 cm · 0,83 m³/.test(vInfo) && /1 parada desenhada, 5 volumes/.test(vRes), 'plano da rota mostra os dois tamanhos da parada: ' + vInfo.slice(0, 120));
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(100);
  // volume digitado à mão diferente do baú
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; Object.values(d).forEach((x) => { x.status = 'pendente'; x.rota_atual = ''; }); });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(300);
  await p.click('.sb-item[data-page="roteirizacao"]'); await p.waitForTimeout(300);
  await p.click('#motoristas-atalho .veh-card:has-text("TST3D11")'); await p.waitForTimeout(300);
  await p.fill('#cap-m3-d', '30');
  await p.click('text=Continuar →'); await p.waitForTimeout(200);
  await p.click('text=Gerar Rota Agora'); await p.waitForTimeout(900);
  await p.click('text=Plano de carga'); await p.waitForTimeout(300);
  ok(/Sem o 3D: o volume do baú foi digitado à mão \(30 m³\) e não bate com as medidas do veículo \(25,88 m³\)/.test(await p.textContent('#plano-corpo')), 'volume digitado à mão: diz por que não tem 3D e como resolver');
  await p.click('#modal-plano .btn-modal-sec'); await p.waitForTimeout(100);

  // ── pedido: calculadora guarda as medidas; lista marca o perigoso ─────────
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; d.A4.status = 'pendente'; d.A4.rota_atual = ''; });
  await p.evaluate(() => window.__FAKE.fire()); await p.waitForTimeout(200);
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  await p.evaluate(() => window.abrirPedido('A4')); await p.waitForTimeout(300);
  await p.click('#ped-calc summary');
  await p.fill('#ped-cc', '60'); await p.fill('#ped-cl', '40'); await p.fill('#ped-ca', '50');
  await p.click('#ped-calc .btn-sm');
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  let o = (await emp(p)).pedidos_rota.A4;
  ok(o.m3 === 0.24 && o.medidas === '60 × 40 × 50 cm', 'calculadora grava as medidas junto com o m³ (o 3D usa o formato): ' + J([o.m3, o.medidas]));
  await p.evaluate(() => window.abrirPedido('A4')); await p.waitForTimeout(250);
  await p.fill('#ped-m3', '0,5'); await p.click('#ped-salvar'); await p.waitForTimeout(400);
  o = (await emp(p)).pedidos_rota.A4;
  ok(o.m3 === 0.5 && o.medidas == null, 'm³ digitado à mão depois apaga as medidas antigas (não batem mais)');
  // pedido com 2 tamanhos lidos das observações: a nota mostra os dois; m³ digitado apaga os tamanhos
  await p.evaluate(() => { const d = window.__FAKE.db.empresas.emp1.pedidos_rota; Object.assign(d.A4, { m3: 0.826, m3Fonte: 'medidas', itens: 5, medidas: '2 de 50 × 50 × 50 cm; 3 de 80 × 60 × 40 cm',
    cx: [{ c: 50, l: 50, a: 50, q: 2 }, { c: 80, l: 60, a: 40, q: 3 }] }); window.__FAKE.fire(); }); await p.waitForTimeout(250);
  await p.evaluate(() => window.abrirPedido('A4')); await p.waitForTimeout(250);
  const notaV = await p.textContent('#ped-m3-nota');
  ok(/^Veio das observações: 2 de 50 × 50 × 50 cm; 3 de 80 × 60 × 40 cm\. Confira\./.test(notaV), 'pedido mostra os dois tamanhos lidos das observações: ' + notaV);
  await p.click('#ped-salvar'); await p.waitForTimeout(400);
  o = (await emp(p)).pedidos_rota.A4;
  ok(o.cx && o.cx.length === 2 && o.m3 === 0.826, 'salvar sem mexer no m³ guarda os tamanhos');
  await p.evaluate(() => window.abrirPedido('A4')); await p.waitForTimeout(250);
  await p.fill('#ped-m3', '1,2'); await p.click('#ped-salvar'); await p.waitForTimeout(400);
  o = (await emp(p)).pedidos_rota.A4;
  ok(o.m3 === 1.2 && o.cx == null && o.medidas == null, 'm³ digitado à mão apaga os tamanhos lidos (não batem mais) ' + J([o.m3, o.cx, o.medidas]));

  // ── tela do motorista mostra o produto perigoso ───────────────────────────
  const d = { i: { v: '3/4', m: 'Teste', d: '2026-11-24', s: 480, c: 'CD' }, p: [['7002', 0, 'Indústria B', 'Rua Teste, 1', 'Centro', 'Guarulhos', 'SP', '07000000', -23.46, -46.52, 1900, 4, 500, null, null, '3082'], ['7001', 0, 'Loja A', 'Rua Teste, 2', 'Centro', 'Guarulhos', 'SP', '07000000', -23.45, -46.53, 96, 8, 520, null, null, null]] };
  const b64 = Buffer.from(JSON.stringify(d)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const m = await open(b, 'motorista.html#demo=' + b64, 390, 844, null, true);
  await m.p.waitForTimeout(500);
  const chips = await m.p.$$eval('.chip.perig', (e) => e.map((x) => x.textContent));
  ok(J(chips) === J(['⚠ Produto perigoso · ONU 3082']), 'motorista vê "Produto perigoso · ONU 3082" só na parada dele ' + J(chips));
  ok(m.errs.length === 0, 'tela do motorista sem erro ' + J(m.errs.slice(0, 2)));

  // ── celular ───────────────────────────────────────────────────────────────
  if (process.env.FOTOS) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('.sb-item[data-page="rotas"]').catch(() => {}); await p.waitForTimeout(300);
    await p.evaluate(() => { const r = Object.values(window.__FAKE.db.empresas.emp1.rotas_confirmadas)[0]; window.abrirPlanoCargaRota(r.id); }); await p.waitForTimeout(400);
    await p.evaluate(() => { const m = document.getElementById('modal-plano'); m.scrollTop = 0; const bx = m.querySelector('.modal-box'); if (bx) bx.scrollTop = 0; });
    await p.waitForTimeout(150);
    await p.screenshot({ path: 'c3d-plano-390.png' });
    await m.p.screenshot({ path: 'c3d-motorista-390.png' });
  }

  ok(errs.length === 0, 'sem erro na tela ' + J(errs.slice(0, 3)));
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
