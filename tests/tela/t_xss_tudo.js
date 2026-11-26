// Segurança: texto que vem de fora não pode virar código em NENHUMA tela de quem está logado.
// "De fora" = a nota fiscal (XML de fornecedor, e-mail, API), o link do motorista (não tem senha:
// quem tiver o link escreve a baixa, o motivo, quem recebeu e as fotos) e os cadastros.
// Cada campo de texto recebe um código que, se rodar, anota o nome do campo em window.__X.
// O teste passa por todas as páginas, abre as janelas e o link do motorista, e cobra __X vazio.
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;

// fecha aspas simples e duplas e a tag: serve para texto solto, atributo "..." e atributo '...'
const X = (t) => `'"><img src=x onerror="(window.__X=window.__X||[]).push('${t}')">`;
// foto "válida" pelo começo, mas com um atributo escondido no fim (o que o link do motorista conseguia gravar)
const FOTO = (t) => `data:image/jpeg;base64,AAAA" onerror="(window.__X=window.__X||[]).push('${t}')" data-x="`;
const agora = Date.now(), hoje = new Date(agora - 3 * 3600e3).toISOString().slice(0, 10);
const TOK = 'tok_' + 'a'.repeat(30);

const campos = (pre) => ({
  nf: X(pre + 'nf'), dest: X(pre + 'dest'), cidade: X(pre + 'cidade'), bairro: X(pre + 'bairro'), endereco: X(pre + 'endereco'),
  numero: X(pre + 'numero'), complemento: X(pre + 'compl'), cep: X(pre + 'cep'), uf: X(pre + 'uf'), fone: X(pre + 'fone'),
  obs: X(pre + 'obs'), obsNota: X(pre + 'obsNota'), coletaObs: X(pre + 'coletaObs'), remetente: X(pre + 'remetente'), localidade: X(pre + 'localidade'),
  medidas: X(pre + 'medidas'), medidasAviso: X(pre + 'medidasAviso'), cteNum: X(pre + 'cte'), vendedor: X(pre + 'vendedor'), contato: X(pre + 'contato'),
  janela_ini: X(pre + 'jini'), horaEntrega: X(pre + 'hora'), dataAgendada: hoje,
  perigoso: { onu: X(pre + 'onu'), risco: X(pre + 'risco'), nome: X(pre + 'perigNome') },
  produtos: [{ d: X(pre + 'prod'), desc: X(pre + 'prodDesc'), q: 1, cm: [30, 20, 10] }],
  ocorrencia: { motivo: X(pre + 'ocMotivo'), obs: X(pre + 'ocObs'), hora: agora },
  baixa: { recebedor: X(pre + 'baixaReceb'), hora: agora },
  peso: 120, itens: 2, m3: 0.5, m3Fonte: 'medidas', geoStatus: 'ok', geoPrec: 'numero', lat: -23.45, lng: -46.53,
});
const PED = {
  p1: { ...campos('e_'), tipo: 'entrega', status: 'pendente', chave: '35261012345678000199550010000999011000000011' },
  C_p2: { ...campos('c_'), tipo: 'coleta', status: 'pendente', lat: -23.47, lng: -46.50 },
  p3: { ...campos('r_'), tipo: 'entrega', status: 'despachado', rota_atual: 'r1', lat: -23.44, lng: -46.55 },
};
const parada = (id, pre, tipo) => ({ id, ...campos(pre), tipo, cx: [{ c: 50, l: 40, a: 30, q: 2 }] });
const SEED = seedEmpresa({
  config: { deposito: { nome: X('cd'), lat: -23.4245, lng: -46.3877 }, locais: { l1: { nome: X('local'), lat: -23.5, lng: -46.6 } } },
  pedidos_rota: PED,
  motoristas: { m1: { id: 'm1', nome: X('motNome'), veiculo_id: 'vuc', veiculo_nome: X('motVeic'), cap_kg: 3000, placa: X('motPlaca'), fone: X('motFone') } },
  produtos: { k1: { d: X('prodCad'), cm: [30, 20, 10], kg: 2, forn: X('prodForn'), cod: X('prodCod') } },
  rotas_confirmadas: { r1: { id: 'r1', data: hoje, saida: 420, veiculo: X('rotaVeic'), placa: X('rotaPlaca'), motorista: X('rotaMot'), status: 'em_rota', token: TOK,
    link_expira: agora + 7 * 864e5, cap_kg: 3000, bau: { c: 4.2, l: 2.05, a: 2.1 }, km: 30, mins: 120,
    paradas: [parada('p3', 'rp_', 'entrega'), parada('p4', 'rq_', 'entrega')] } },
  entregador: { [TOK]: { eid: 'emp1', expira: agora + 7 * 864e5,
    info: { rota_id: 'r1', veiculo: X('linkVeic'), motorista: X('linkMot'), data: hoje, saida: 420, criada_em: X('linkCriada'),
      deposito: { nome: X('linkCd'), lat: -23.4245, lng: -46.3877 } },
    paradas: [parada('p3', 'lp_', 'entrega'), parada('p4', 'lq_', 'coleta')],
    baixas: { 0: { status: 'feito', hora: agora - 6e5, recebedor: X('bReceb'), obs: X('bObs'), temFoto: true, lat: -23.44, lng: -46.55 },
      1: { status: 'nao_feito', hora: agora - 3e5, motivo: X('bMotivo'), obs: X('bObs2') } },
    fotos: { 0: FOTO('foto') }, fotos_hod: { ini: FOTO('fotoHod'), fim: FOTO('fotoHodFim') },
    hodometro: { ini: { km: 1000, hora: agora - 9e5, temFoto: true }, fim: { km: 1040, hora: agora - 1e5, temFoto: true } } } },
}, 'uid-ana', 'emp1');
SEED.empresas.emp1.info = { nome: X('empresa') };
const seed = (d) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@t.com.br', getIdToken: async () => 'T' }, db: d }; };
const rodou = (p) => p.evaluate(() => window.__X || []);

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1366, 900, seed, false, SEED, async (c) => {
    await c.route(/viacep|nominatim/, (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
    // a resposta da IA também é texto de fora (pode ter sido enganada pelo texto de uma nota)
    await c.route(/railway\.app\/chat/, (r) => r.fulfill({ contentType: 'application/json', body: J({ resposta: X('ia'), session_id: 's' }) }));
  });
  p.on('dialog', (d) => d.dismiss());
  await p.waitForTimeout(1200);

  for (const pg of ['dashboard', 'pedidos', 'roteirizacao', 'rotas', 'relatorios', 'motoristas', 'produtos', 'mapa', 'ia']) {
    await p.evaluate((x) => window.irParaPagina(x), pg); await p.waitForTimeout(650);
    ok(!(await rodou(p)).length, `página ${pg}: nenhum texto de fora virou código ` + J(await rodou(p)));
  }

  // pedidos: janela de cada um (entrega, coleta, em rota)
  for (const id of ['p1', 'C_p2', 'p3']) {
    await p.evaluate((i) => window.abrirPedido(i), id); await p.waitForTimeout(350);
    await p.keyboard.press('Escape'); await p.evaluate(() => window.fecharPedido && window.fecharPedido()); await p.waitForTimeout(100);
  }
  ok(!(await rodou(p)).length, 'janela do pedido (entrega, coleta e em rota) ' + J(await rodou(p)));

  // busca: o que se digita e o que ela acha
  await p.evaluate(() => window.irParaPagina('pedidos')); await p.waitForTimeout(300);
  if (await p.$('#busca-notas')) {
    await p.fill('#busca-notas', X('busca')); await p.waitForTimeout(300);
    await p.fill('#busca-notas', 'e_'); await p.waitForTimeout(300);
    await p.fill('#busca-notas', ''); await p.waitForTimeout(150);
  }
  ok(!(await rodou(p)).length, 'busca de notas ' + J(await rodou(p)));

  // rotas confirmadas: fotos do canhoto e do painel, plano de carga em 3D
  await p.evaluate(() => window.irParaPagina('rotas')); await p.waitForTimeout(700);
  await p.evaluate(() => window.verFotoCanhoto('r1', 0)); await p.waitForTimeout(400);
  const fotoCanhoto = await p.evaluate(() => { const i = document.querySelector('#foto-corpo img'); return i ? i.getAttributeNames() : null; });
  await p.evaluate(() => window.fecharFoto()); await p.waitForTimeout(100);
  await p.evaluate(() => window.verFotoCanhoto('r1', 1)); await p.waitForTimeout(400);
  await p.evaluate(() => window.fecharFoto());
  await p.evaluate(() => window.verFotosHod('r1')); await p.waitForTimeout(400);
  const fotoPainel = await p.evaluate(() => [...document.querySelectorAll('#foto-corpo img')].map((i) => i.getAttributeNames()));
  await p.evaluate(() => window.fecharFoto());
  ok(!(await rodou(p)).length, 'fotos do motorista (canhoto e painel): um texto que não é foto não roda nada ' + J([await rodou(p), fotoCanhoto, fotoPainel]));
  ok((!fotoCanhoto || !fotoCanhoto.includes('onerror')) && fotoPainel.every((a) => !a.includes('onerror')), 'e não aparece como imagem com atributo escondido');
  await p.evaluate(() => window.abrirPlanoCargaRota('r1')); await p.waitForTimeout(500);
  for (const c of await p.$$('#modal-plano .c3d-chip')) { await c.click(); await p.waitForTimeout(80); }
  await p.click('#modal-plano .btn-modal-sec').catch(() => {}); await p.evaluate(() => window.fecharPlanoCarga && window.fecharPlanoCarga());
  ok(!(await rodou(p)).length, 'plano de carga da rota, 3D e legenda ' + J(await rodou(p)));

  // roteirização: rota manual com o 3D ao vivo e o plano da rota montada
  await p.evaluate(() => window.irParaPagina('roteirizacao')); await p.waitForTimeout(500);
  await p.evaluate(() => window.selVeicD('vuc')); await p.waitForTimeout(250);
  await p.fill('#cap-kg-d', '3000'); await p.evaluate(() => window.irConfirmD()); await p.waitForTimeout(300);
  await p.click('#rot-step-confirm .btn-modal-alt'); await p.waitForTimeout(800);
  await p.evaluate(() => { window.manAddUm('p1'); window.manAddUm('C_p2'); }); await p.waitForTimeout(500);
  for (const c of await p.$$('#man-3d .c3d-chip')) { await c.click(); await p.waitForTimeout(80); }
  ok(!(await rodou(p)).length, 'rota manual: mapa, lista e 3D ao vivo ' + J(await rodou(p)));
  await p.click('#man-usar'); await p.waitForTimeout(700);
  await p.evaluate(() => window.abrirPlanoCargaD && window.abrirPlanoCargaD(0)); await p.waitForTimeout(400);
  ok(!(await rodou(p)).length, 'resultado da rota e plano de carga ' + J(await rodou(p)));
  await p.evaluate(() => window.fecharPlanoCarga && window.fecharPlanoCarga());

  // assistente: a resposta da IA aparece como texto
  await p.evaluate(() => window.irParaPagina('ia')); await p.waitForTimeout(300);
  await p.fill('#chat-inp', X('pergunta')); await p.evaluate(() => window.enviarChatD()); await p.waitForTimeout(700);
  ok(!(await rodou(p)).length, 'assistente: a pergunta e a resposta da IA ficam como texto ' + J(await rodou(p)));

  // tela do motorista (link sem senha): o que veio da nota não vira código no celular dele
  const m = await ctx.newPage();
  m.on('pageerror', () => {});
  await m.goto('http://127.0.0.1:8771/motorista.html#' + TOK, { waitUntil: 'load' }); await m.waitForTimeout(1200);
  const abrir = await m.$$('button, .parada, [role="button"]');
  for (const el of abrir.slice(0, 6)) { await el.click({ timeout: 800 }).catch(() => {}); await m.waitForTimeout(80); }
  const naTelaMot = await m.evaluate(() => [window.__X || [], document.body.innerText]);
  ok(!naTelaMot[0].length && !/Rota não encontrada|Link incompleto/.test(naTelaMot[1]) && /onerror/.test(naTelaMot[1]),
    'tela do motorista mostra a rota (com o texto estranho como texto) sem rodar nada ' + J([naTelaMot[0], naTelaMot[1].slice(0, 120)]));

  // a foto de verdade (como o celular do motorista gera) continua passando na tela e na regra do banco
  const fotoReal = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 1280; c.height = 960;
    const g = c.getContext('2d'); for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 37 % 360},70%,${30 + i % 50}%)`; g.fillRect((i * 53) % 1280, (i * 97) % 960, 90, 70); }
    const d = c.toDataURL('image/jpeg', 0.62); return { d, ok: window.__fotoOk(d), ataque: window.__fotoOk(d + '" onerror="x') }; });
  const regra = require('../../firebase/database.rules.json').rules.entregador.$token.fotos.$i['.validate'];
  const re = new RegExp(regra.match(/matches\(\/(.*)\/\)/)[1]);
  ok(fotoReal.ok && !fotoReal.ataque && re.test(fotoReal.d) && !re.test(fotoReal.d + '" onerror="x') && fotoReal.d.length < 400000,
    'foto de verdade passa (tela e regra do banco); a com atributo escondido não ' + fotoReal.d.length + ' caracteres');
  const final = await rodou(p);
  ok(!final.length && !(await p.$('img[src="x"]')), 'no fim, nenhum código de fora rodou e nenhuma imagem injetada ficou na tela ' + J(final));
  ok(!errs.length, 'sem erro de JavaScript ' + J(errs.slice(0, 3)));
  await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\nTudo certo.');
  process.exit(falhas ? 1 : 0);
})();
