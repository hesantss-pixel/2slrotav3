// Subir de novo uma nota que já está no sistema (20/11/2026).
//
// A chave é o número da nota/ordem: a mesma nota nunca vira duas. Se ela ainda
// não saiu, os dados vêm do arquivo, mas o que só existe no sistema fica: o ponto
// corrigido no mapa, o agendamento e a urgência. Já coletada/entregue ou numa rota
// rodando, não é mexida. O aviso separa as novas das que já existiam.
//
// Dados fictícios (pdf/gerar_ordem_coleta.py): o repositório é público.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { open, seedEmpresa } = require('./harness');
let falhas = 0;
const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const pags = JSON.parse(fs.readFileSync(path.join(__dirname, 'pdf', 'ordem-coleta-exemplo.json'), 'utf8'));
const CD = { nome: 'CD Cumbica', lat: -23.4245, lng: -46.3877 };
const ini = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'a@t.com', getIdToken: async () => 'T' }, db: sd }; };
const mock = (pags) => { window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: pags.length,
  getPage: async (n) => ({ getTextContent: async () => ({ items: pags[n - 1].map((i) => ({ str: i.s, transform: [1, 0, 0, 1, i.x, i.y], height: i.h })) }) }) }) }) }; };
const todosErros = [];

async function importar(b, ped) {
  const { p, ctx, errs } = await open(b, 'index.html', 1440, 900, ini, false, seedEmpresa({ config: { deposito: CD }, pedidos_rota: ped }));
  const geo = [];
  p.on('request', (r) => { if (/viacep|nominatim/.test(r.url())) geo.push(r.url()); });
  await p.waitForTimeout(900);
  p.on('dialog', (d) => d.accept());
  await p.evaluate(mock, pags);
  geo.length = 0;
  await p.setInputFiles('#file-input', { name: 'ordens.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => ({ db: JSON.parse(JSON.stringify(window.__FAKE.db.empresas.emp1.pedidos_rota || {})),
    msg: document.getElementById('import-msg-pedidos').textContent.trim() }));
  todosErros.push(...errs);
  await ctx.close();
  return { ...r, geo: geo.length };
}

(async () => {
  const b = await chromium.launch();

  // 1. primeira vez: duas coletas novas
  const r1 = await importar(b, {});
  const [A, B] = Object.keys(r1.db).sort();
  ok(Object.keys(r1.db).length === 2 && /2 coletas importadas/.test(r1.msg), '1ª importação: 2 coletas novas → ' + r1.msg);

  // 2. mesma PDF de novo, sem mexer em nada: continua 2, aviso diz que já existiam
  const r2 = await importar(b, r1.db);
  ok(Object.keys(r2.db).length === 2, 'subir de novo não duplica');
  ok(/^Nenhuma nota nova\. 2 notas já estavam no sistema e foram atualizadas, sem duplicar\. 2 notas vieram com o m³ no arquivo\.$/.test(r2.msg), 'aviso: nenhuma nova, 2 já estavam → ' + r2.msg);

  // 3. A já coletada; B pendente com ponto corrigido à mão, agendada e urgente
  const s3 = JSON.parse(JSON.stringify(r1.db));
  s3[A].status = 'coletado';
  Object.assign(s3[B], { peso: 1, lat: -23.5012, lng: -46.6034, geoStatus: 'ok', geoPrec: 'manual', geoManual: true, geoV: 3,
    agendado: true, dataAgendada: '2026-11-25', horaEntrega: '09:00', horaFim: '10:00', horaSaidaSugerida: '08:10', urgente: true });
  const r3 = await importar(b, s3);
  const b3 = r3.db[B];
  ok(Object.keys(r3.db).length === 2 && r3.db[A].status === 'coletado', 'coletada não é mexida e nada duplica');
  ok(b3.lat === -23.5012 && b3.lng === -46.6034 && b3.geoManual === true && b3.geoPrec === 'manual' && b3.geoStatus === 'ok', 'o ponto corrigido à mão continua');
  ok(b3.agendado === true && b3.dataAgendada === '2026-11-25' && b3.horaEntrega === '09:00' && b3.horaFim === '10:00' && b3.horaSaidaSugerida === '08:10', 'o agendamento continua');
  ok(b3.urgente === true, 'a urgência continua');
  ok(b3.peso !== 1 && b3.status === 'pendente' && b3.itens === r1.db[B].itens, 'peso e volumes vêm do arquivo');
  ok(!('_localMantido' in b3), 'nenhum campo interno vai para o banco');
  ok(r3.geo === 0, 'com o ponto mantido, não procura o endereço de novo (' + r3.geo + ' consultas)');
  ok(/Nenhuma nota nova\. 1 nota já estava no sistema e foi atualizada, sem duplicar\. 1 nota já foi concluída \(entregue ou coletada\) e não foi alterada\./.test(r3.msg), 'aviso separa a atualizada da concluída → ' + r3.msg);

  // 4. no banco, B estava com outro endereço: o ponto antigo não serve mais
  const s4 = JSON.parse(JSON.stringify(s3));
  s4[A].status = 'pendente';
  Object.assign(s4[B], { endereco: 'RUA QUE MUDOU 999' });
  const r4 = await importar(b, s4);
  ok(r4.db[B].geoStatus !== 'ok' || r4.db[B].lat !== -23.5012, 'endereço diferente: o ponto é refeito');
  ok(r4.db[B].agendado === true, 'mesmo assim o agendamento continua');
  ok(r4.geo > 0, 'e o endereço novo é procurado (' + r4.geo + ' consultas)');
  ok(/1 nota veio com outro endereço no arquivo e vai ser localizada de novo no mapa\./.test(r4.msg), 'aviso do endereço diferente → ' + r4.msg);

  // 5. metade nova, metade já existente (o caso de subir 30 com 5 repetidas)
  const s5 = { [B]: JSON.parse(JSON.stringify(r1.db[B])) };
  const r5 = await importar(b, s5);
  ok(Object.keys(r5.db).length === 2 && /^✅ 1 coleta importada\. 1 nota já estava no sistema e foi atualizada, sem duplicar\. 2 notas vieram com o m³ no arquivo\.$/.test(r5.msg), 'aviso: 1 nova e 1 que já estava → ' + r5.msg);

  ok(!todosErros.length, 'sem erro de JavaScript' + (todosErros.length ? ': ' + todosErros.join(' | ') : ''));
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  await b.close();
  process.exit(falhas ? 1 : 0);
})();
