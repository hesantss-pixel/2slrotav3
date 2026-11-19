// Leitura do PDF da nota (DANFE) — 18/11/2026.
//
// Antes, o leitor de PDF criava um pedido para cada número de 5 a 9 dígitos que
// achasse no texto, sem endereço, e jogava num ponto sorteado perto do CD.
// Agora lê pela posição na página: nome, endereço, bairro, CEP, município, UF,
// volumes e peso, e quem não tem CEP nem município não entra.
//
// O pdf.js vem de CDN e a bateria roda sem internet, então o teste usa o texto
// com a posição de cada pedaço (pdf/*.json), gerado de DANFEs de verdade por
// pdf/gerar_danfe.py — é exatamente o que o pdf.js entrega ao navegador.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const pags = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'pdf', n + '.json'), 'utf8'));

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1440, 900, (sd) => {
    window.__FAKE = { user: { uid: 'uid-ana', email: 'a@t.com', getIdToken: async () => 'T' }, db: sd };
  }, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: {} }));
  await p.waitForTimeout(800);

  const ler = (itens, tipo) => p.evaluate(([it, t]) => {
    const l = window.__danfe.linhas(it);
    const c = window.__danfe.campos(l, t);
    return { campos: c, pedido: window.__danfe.pedido(c, t) };
  }, [itens, tipo]);

  ok(await p.evaluate(() => !!(window.__danfe && window.__danfe.campos)), 'o leitor de DANFE está na página');

  // ── 1. entrega: os campos saem da caixa do destinatário ──────────────────
  const ex = pags('danfe-exemplo');
  {
    const { campos: c, pedido: o } = await ler(ex[0], 'entrega');
    ok(c.nome === 'SUPERMERCADO BOM PRECO LTDA', 'lê o nome do cliente');
    ok(c.endereco === 'RUA DAS ACACIAS, 457', 'lê a rua com o número');
    ok(c.bairro === 'JARDIM SAO PAULO', 'lê o bairro');
    ok(c.cep === '07095420', 'lê o CEP (só os dígitos)');
    ok(c.cidade === 'GUARULHOS' && c.uf === 'SP', 'lê o município e a UF');
    ok(c.volumes === 12, 'lê a quantidade de volumes');
    ok(c.peso === 1250.5, 'lê o peso bruto no formato brasileiro (1.250,500 kg)');
    ok(c.chave.length === 44, 'lê a chave de acesso inteira (44 dígitos)');
    ok(c.nf === '12345', 'tira o número da nota da chave de acesso');
    // o DANFE repete NOME, ENDEREÇO, MUNICÍPIO e UF na parte do transportador:
    // o endereço do cliente não pode vir trocado pelo da transportadora
    ok(!/TRANSPORTES|BARUERI|TRANSPORTADORES/.test(c.nome + c.endereco + c.cidade),
      'não confunde o destinatário com o transportador, que tem as mesmas caixas');
    ok(o && o.cep === '07095420' && o.geoStatus === 'pendente',
      'o pedido entra para ser localizado pelo CEP, como no XML');
    ok(o && o.geoStatus !== 'ok', 'e não entra como ponto exato antes de ser localizado');
    ok(o && o.peso === 1250.5 && o.itens === 12 && o.dest === 'SUPERMERCADO BOM PRECO LTDA',
      'peso, volumes e nome chegam no pedido');
    ok(o && o.origem === 'pdf' && o.tipo === 'entrega' && o.status === 'pendente', 'marca a origem do pedido');
  }

  // ── 1b. chave impressa sem espaço, ou em dois pedaços, e sem o "Nº" (19/11) ──
  {
    const semEsp = ex[0].filter((i) => !/^Nº/.test(i.s)).map((i) => /^\d{4} \d{4}/.test(i.s) ? { ...i, s: i.s.replace(/\s/g, '') } : i);
    const { campos: c1 } = await ler(semEsp, 'entrega');
    ok(c1.chave.length === 44 && c1.nf === '12345', 'chave impressa sem espaço: acha a chave e o número da nota');
    const pedacos = ex[0].filter((i) => !/^Nº/.test(i.s)).flatMap((i) => /^\d{4} \d{4}/.test(i.s)
      ? [{ ...i, s: i.s.replace(/\s/g, '').slice(0, 20) }, { ...i, x: i.x + 90, s: i.s.replace(/\s/g, '').slice(20) }] : [i]);
    const { campos: c2 } = await ler(pedacos, 'entrega');
    ok(c2.chave.length === 44 && c2.nf === '12345', 'chave em dois pedaços na mesma linha: junta e confere');
    const falsa = ex[0].filter((i) => !/^Nº/.test(i.s) && !/^\d{4} \d{4}/.test(i.s)).concat([{ s: '12345678901234567890123456789012345678901234', x: 30, y: 300, h: 7 }]);
    const { campos: c3 } = await ler(falsa, 'entrega');
    ok(c3.chave === '', '44 dígitos quaisquer (sem o dígito verificador certo) não viram chave');
  }

  // ── 2. segunda via da mesma nota não vira dois pedidos ───────────────────
  {
    const a = await ler(ex[0], 'entrega'), d = await ler(ex[1], 'entrega');
    ok(a.pedido.id === d.pedido.id && a.campos.chave === d.campos.chave,
      'a 2ª via da mesma nota cai no mesmo pedido (mesma chave, mesmo id)');
  }

  // ── 3. município e UF na mesma caixa, e nota sem peso ───────────────────
  {
    const { campos: c, pedido: o } = await ler(ex[2], 'entrega');
    ok(c.cidade === 'SAO PAULO' && c.uf === 'SP', '"SAO PAULO - SP" numa só caixa sai separado');
    ok(c.nf === '67890' && c.nome === 'PADARIA DOIS IRMAOS ME', 'lê a segunda nota do mesmo arquivo');
    ok(c.peso === 0, 'nota sem peso volta zero (o sistema avisa e põe 100 kg)');
    ok(o && o.peso === 100, 'e o pedido entra com os 100 kg de sempre');
    ok(c.endereco === 'AVENIDA PAULISTA, 1500 - CONJ 42', 'lê o complemento junto do endereço');
  }

  // ── 4. coleta: o ponto é o do emitente, não o do destinatário ───────────
  {
    const { campos: c, pedido: o } = await ler(ex[0], 'coleta');
    ok(c.nome === 'INDUSTRIA EXEMPLO LTDA', 'na coleta lê quem emitiu a nota');
    ok(c.cep === '07140000' && c.cidade === 'GUARULHOS', 'e o CEP e a cidade do emitente');
    ok(c.endereco === 'AVENIDA INDUSTRIAL, 1200 - GALPAO 3', 'e o endereço de retirada');
    ok(o && o.tipo === 'coleta' && o.id.startsWith('C_'), 'o pedido entra como coleta');
    ok(o && o.remetente === 'INDUSTRIA EXEMPLO LTDA', 'guarda o remetente da coleta');
  }

  // ── 5. sem CEP e sem município não entra (era o ponto inventado) ────────
  {
    const { campos: c, pedido: o } = await ler(pags('danfe-sem-endereco')[0], 'entrega');
    ok(c.nf === '99999' && c.nome === 'CLIENTE SEM ENDERECO', 'acha a nota mesmo sem endereço');
    ok(c.cep === '' && c.cidade === '', 'e não inventa CEP nem município');
    ok(o === null, 'nota sem CEP e sem município NÃO vira pedido (nada de ponto sorteado)');
  }

  // ── 6. a tela avisa o que o PDF lê ──────────────────────────────────────
  {
    const t = await p.evaluate(() => document.getElementById('imp-help').textContent);
    ok(/CEP/.test(t) && /DANFE/.test(t), 'a ajuda da importação diz o que o PDF lê');
  }

  ok(errs.length === 0, 'sem erros no console: ' + JSON.stringify(errs.slice(0, 3)));
  await ctx.close();
  await b.close();
  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo');
  process.exit(falhas ? 1 : 0);
})();
