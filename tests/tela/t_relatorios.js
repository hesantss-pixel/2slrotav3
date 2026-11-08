// Relatórios: números batem com o que está no banco, filtro de período funciona,
// a planilha sai com os dados certos e nada quebra no celular.
const { chromium } = require('playwright');
const { open } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };

const hoje = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const dias = n => iso(new Date(hoje.getTime() - n * 864e5));

// 3 rotas: hoje (2 feitas, 1 não feita), 5 dias atrás (2 feitas), 40 dias atrás (fora de 30 dias)
const rota = (id, data, mot, veic, paradas, km, min, peso, extra) => Object.assign(
  { id, data, motorista: mot, veiculo: veic, num_paradas: paradas, km, tempo_min: min,
    peso_total: peso, status: 'em_rota', criada_em: new Date().toISOString(), paradas: [] }, extra || {});

const ROTAS = {
  r_hoje:  rota('r_hoje',  iso(hoje), 'Carlos Souza', 'Truck Toco', 4, 42.5, 180, 3200),
  r_cinco: rota('r_cinco', dias(5),   'Ana Ribeiro',  'Fiorino',    2, 18.2,  95,  900),
  r_velha: rota('r_velha', dias(40),  'Carlos Souza', 'VUC',        3, 30.0, 120, 1500),
};
// pedidos: a baixa e a ocorrência apontam a rota — é isso que o relatório soma
const PED = {
  p1: { nf:'1', cidade:'Guarulhos', peso:800, status:'entregue', baixa:{rota:'r_hoje',hora:Date.now()} },
  p2: { nf:'2', cidade:'Guarulhos', peso:800, status:'entregue', baixa:{rota:'r_hoje',hora:Date.now()} },
  p3: { nf:'3', cidade:'Arujá', peso:800, status:'pendente',
        ocorrencia:{rota:'r_hoje',motivo:'cliente ausente',hora:Date.now()} },
  p4: { nf:'4', cidade:'Arujá', peso:800, status:'pendente' },                       // sem baixa
  p5: { nf:'5', cidade:'Suzano', peso:450, status:'entregue', baixa:{rota:'r_cinco',hora:Date.now()} },
  p6: { nf:'6', cidade:'Suzano', peso:450, status:'coletado', baixa:{rota:'r_cinco',hora:Date.now()} },
  p7: { nf:'7', cidade:'Mogi', peso:500, status:'pendente',
        ocorrencia:{rota:'r_velha',motivo:'endereço não encontrado',hora:Date.now()} },
};
const seed = () => { window.__FAKE = { user:{uid:'u',email:'a@b.c',getIdToken:async()=>'T'},
  db:{ acesso:{u:true}, membros:{u:'emp1'}, empresas:{ emp1:{ info:{nome:'Transportadora Exemplo'},
    config:{deposito:{nome:'CD',lat:-23.4245,lng:-46.3877}},
    pedidos_rota: JSON.parse(ROTAS_JSON).ped, rotas_confirmadas: JSON.parse(ROTAS_JSON).rotas } } } }; };

(async () => {
  const b = await chromium.launch();
  const seed = (d) => { window.__FAKE = { user:{uid:'u',email:'a@b.c',getIdToken:async()=>'T'},
    db:{ acesso:{u:true}, membros:{u:'emp1'}, empresas:{ emp1:{ info:{nome:'Transportadora Exemplo'},
      config:{deposito:{nome:'CD',lat:-23.4245,lng:-46.3877}},
      pedidos_rota:d.ped, rotas_confirmadas:d.rotas } } } }; };
  const { ctx, p: p2, errs: erros2 } = await open(b, 'index.html', 1440, 1000, seed, false,
    { ped: PED, rotas: ROTAS });
  await ctx.route(/viacep|nominatim/, r => r.fulfill({ contentType:'application/json', body:'[]' }));
  await p2.waitForTimeout(1300);
  await p2.evaluate(() => window.irParaPagina('relatorios'));
  await p2.waitForTimeout(700);

  const v = await p2.evaluate(() => {
    const k = [...document.querySelectorAll('#rel-corpo .kpi')].map(e => ({
      lbl: e.querySelector('.kpi-lbl').textContent.trim(), val: e.querySelector('.kpi-val').textContent.trim() }));
    const linhas = [...document.querySelectorAll('#rel-corpo .rel-sec table tbody tr')].map(tr =>
      [...tr.children].map(td => td.textContent.trim()));
    return { kpis: k, nLinhas: linhas.length, texto: document.getElementById('rel-corpo').textContent };
  });
  const kv = n => (v.kpis.find(x => x.lbl.includes(n)) || {}).val;
  ok(kv('ROTAS') === '2', '30 dias traz 2 rotas e deixa a de 40 dias fora (achei ' + kv('ROTAS') + ')');
  ok(kv('PARADAS PLANEJADAS') === '6', 'soma as paradas planejadas: 4+2=6 (achei ' + kv('PARADAS PLANEJADAS') + ')');
  ok(kv('ENTREGUES / COLETADOS') === '4', 'conta as baixas das 2 rotas: 2+2=4 (achei ' + kv('ENTREGUES / COLETADOS') + ')');
  ok(kv('NÃO REALIZADOS') === '1', 'conta só a ocorrência dentro do período (achei ' + kv('NÃO REALIZADOS') + ')');
  ok(kv('SUCESSO NAS BAIXAS') === '80%', '4 de 5 baixas = 80% (achei ' + kv('SUCESSO NAS BAIXAS') + ')');
  ok(kv('KM PLANEJADO') === '60,7', 'soma o km: 42,5+18,2 (achei ' + kv('KM PLANEJADO') + ')');
  ok(/cliente ausente/.test(v.texto), 'mostra o motivo do não realizado');
  ok(!/endereço não encontrado/.test(v.texto), 'não traz motivo de rota fora do período');
  ok(/odômetro/.test(v.texto), 'avisa que o km é o planejado, não o do odômetro');

  // período: hoje
  await p2.evaluate(() => { document.querySelector('#rel-periodo button[data-p="0"]').click(); });
  await p2.waitForTimeout(400);
  const hojeK = await p2.evaluate(() => [...document.querySelectorAll('#rel-corpo .kpi')]
    .map(e => e.querySelector('.kpi-lbl').textContent.trim() + '=' + e.querySelector('.kpi-val').textContent.trim()));
  ok(hojeK.some(x => x === 'ROTAS=1'), 'filtro "Hoje" deixa só a rota de hoje: ' + JSON.stringify(hojeK[0]));

  // período sem rota nenhuma
  await p2.evaluate(() => { document.querySelector('#rel-periodo button[data-p="mes-1"]').click(); });
  await p2.waitForTimeout(400);
  const vazio = await p2.evaluate(() => document.getElementById('rel-corpo').textContent);
  ok(/Nenhuma rota confirmada/.test(vazio), 'período sem rota mostra aviso em vez de tabela vazia');

  // planilha
  await p2.evaluate(() => { document.querySelector('#rel-periodo button[data-p="30"]').click(); });
  await p2.waitForTimeout(400);
  const res = await p2.evaluate(async () => {
    let capturado = null;
    const origem = URL.createObjectURL;
    URL.createObjectURL = b => { capturado = b; return 'blob:fake'; };
    const a0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function(){};
    document.getElementById('rel-csv').click();
    HTMLAnchorElement.prototype.click = a0; URL.createObjectURL = origem;
    if(!capturado) return null;
    const txt = await capturado.text();
    const bytes = new Uint8Array(await capturado.arrayBuffer()).slice(0,3);
    return { txt, bom: bytes[0]===0xEF && bytes[1]===0xBB && bytes[2]===0xBF };
  });
  const csv = res && res.txt;
  ok(csv && csv.includes('Carlos Souza') && csv.includes('cliente ausente'),
     'a planilha traz as rotas e os motivos');
  ok(csv && /TOTAL;;;6;4;1/.test(csv), 'a planilha fecha com a linha de total: ' +
     (csv ? (csv.split('\r\n').find(l => l.startsWith('TOTAL')) || '(sem TOTAL)') : 'sem csv'));
  ok(res && res.bom, 'a planilha começa com BOM, para o Excel abrir os acentos certos');

  // celular
  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.waitForTimeout(400);
  const over = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(over <= 1, 'sem rolagem lateral no celular (' + over + 'px)');
  ok(!erros2.length, 'sem erros no console ' + JSON.stringify(erros2.slice(0, 2)));

  await b.close();
  console.log(falhas ? falhas + ' FALHA(S)' : 'TUDO OK');
  process.exit(falhas ? 1 : 0);
})();
