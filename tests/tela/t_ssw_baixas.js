// Volta para o SSW: códigos de ocorrência da empresa (de-para) e a planilha "Baixas para o SSW"
// nos Relatórios, com chave da NF-e, CNPJ do remetente e série (tirados da chave), NF, CTRC,
// situação, motivo e código. Dados fictícios.
const { chromium } = require('playwright');
const fs = require('fs');
const { open, seedEmpresa } = require('./harness');
let falhas = 0; const ok = (c, m) => { if (!c) falhas++; console.log((c ? 'OK   ' : 'FALHA ') + m); };
const J = JSON.stringify;
function chave(nf, cnpj = '12345678000190') {
  const c43 = '35' + '2411' + cnpj + '55' + '002' + String(nf).padStart(9, '0') + '1' + '12345678';
  let soma = 0, peso = 2;
  for (let i = 42; i >= 0; i--) { soma += (+c43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; return c43 + ((r < 2) ? 0 : 11 - r);
}
const K1 = chave(2001), K2 = chave(2002);
const hoje = new Date(); hoje.setHours(10, 5, 0, 0);
const h1 = +hoje, h2 = +hoje + 3600e3, velho = +hoje - 90 * 864e5;
const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
const seed = seedEmpresa({
  config: { deposito: { nome: 'CD Guarulhos', lat: -23.4245, lng: -46.3877 } },
  rotas_confirmadas: { R1: { id: 'R1', data: iso, veiculo: 'VUC · TST1A11', motorista: 'Motorista A', paradas: [{ nf: '2001' }, { nf: '2002' }, { nf: '3003' }], num_paradas: 3 } },
  pedidos_rota: {
    [K1]: { id: K1, nf: '2001', chave: K1, ctrc: 'GRU 555-1', setor: 'GRU-01', tipo: 'entrega', status: 'entregue', cidade: 'Guarulhos', dest: 'Loja Um', peso: 10,
      baixa: { hora: h1, rota: 'R1', recebedor: 'João da Portaria' } },
    [K2]: { id: K2, nf: '2002', chave: K2, tipo: 'entrega', status: 'pendente', cidade: 'Guarulhos', dest: 'Loja Dois; Filial', peso: 10,
      ocorrencia: { motivo: 'Cliente ausente', obs: '=HYPERLINK("http://x")', hora: h2, rota: 'R1' } },
    C_3003: { id: 'C_3003', nf: '3003', tipo: 'coleta', status: 'coletado', cidade: 'Arujá', dest: 'Fornecedor Três', peso: 5,
      baixa: { hora: h2 + 60e3, rota: 'R1', recebedor: '' } },
    V9: { id: 'V9', nf: '9', tipo: 'entrega', status: 'entregue', cidade: 'Guarulhos', dest: 'Antigo', peso: 1, baixa: { hora: velho, rota: 'R0', recebedor: '' } },
  },
});
const init = (sd) => { window.__FAKE = { user: { uid: 'uid-ana', email: 'ana@empresa.com.br', getIdToken: async () => 'T' }, db: sd }; };

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'index.html', 1280, 900, init, false, seed);
  await p.evaluate(() => window.irParaPagina('relatorios')); await p.waitForTimeout(500);
  ok(await p.isVisible('#rel-ssw') && await p.isVisible('#rel-ssw-cod'), 'Relatórios tem "Baixas para o SSW" e "Códigos do SSW"');

  // códigos do SSW
  await p.click('#rel-ssw-cod'); await p.waitForTimeout(300);
  ok(await p.isVisible('#modal-ssw') && (await p.$$('#ssw-lista input')).length === 9, 'a janela lista as 9 situações');
  await p.fill('#ssw-lista input[data-k="ausente"]', '4 6');
  await p.click('#modal-ssw >> text=Salvar códigos'); await p.waitForTimeout(200);
  ok(/só letras e números/.test(await p.textContent('#ssw-erro')) && await p.isVisible('#modal-ssw'), 'código com espaço é recusado com explicação');
  await p.fill('#ssw-lista input[data-k="ausente"]', '46');
  await p.fill('#ssw-lista input[data-k="entregue"]', '01');
  await p.fill('#ssw-lista input[data-k="coletado"]', 'C1');
  await p.click('#modal-ssw >> text=Salvar códigos'); await p.waitForTimeout(400);
  const cod = await p.evaluate(() => window.__FAKE.db.empresas.emp1.config.ssw);
  ok(!(await p.isVisible('#modal-ssw')) && cod && cod.codigos && cod.codigos.entregue === '01' && cod.codigos.ausente === '46' && !('fechado' in cod.codigos),
    'códigos salvos no banco da empresa (só os preenchidos): ' + J(cod));

  // planilha
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#rel-ssw')]);
  const txt = fs.readFileSync(await dl.path(), 'utf8');
  const lin = txt.replace(/^﻿/, '').split('\r\n');
  console.log(lin.join('\n'));
  ok(/^rotav3-baixas-ssw-30-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'nome do arquivo: ' + dl.suggestedFilename());
  ok(lin[0].startsWith('Data;Hora;Situação;Motivo;Código SSW;Chave NF-e;CNPJ do remetente;Série;NF;CT-e / CTRC;Setor;Cliente'), 'cabeçalho');
  ok(lin.length === 4, '3 baixas do período, sem a de 90 dias atrás: ' + (lin.length - 1));
  const c1 = lin[1].split(';');
  ok(c1[1] === '10:05' && c1[2] === 'Entregue' && c1[4] === '01' && c1[5] === `="${K1}"` && c1[6] === '="12345678000190"' && c1[7] === '2' && c1[8] === '2001' && c1[9] === 'GRU 555-1' && c1[10] === 'GRU-01' && c1[13] === 'João da Portaria',
    'entregue: código 01, chave inteira (protegida para o Excel), CNPJ e série tirados da chave, NF, CTRC, setor e quem recebeu');
  ok(/Motorista A$/.test(lin[1]) && /;\d{2}\/\d{2} · VUC · TST1A11;/.test(lin[1]), 'rota e motorista na linha');
  ok(/Não realizado;Cliente ausente;46;/.test(lin[2]) && lin[2].includes('"Loja Dois; Filial"') && lin[2].includes(`"'=HYPERLINK(""http://x"")"`), 'não realizado: motivo, código 46, observação; texto com ";" entre aspas; fórmula vira texto');
  ok(/;Coletado;;C1;;;;3003;/.test(lin[3]), 'coleta sem chave: código C1, colunas da chave vazias');

  // período sem baixa
  await p.click('#rel-periodo button[data-p="mes-1"]'); await p.waitForTimeout(300);
  await p.click('#rel-ssw'); await p.waitForTimeout(400);
  ok(/Nenhuma baixa em mês passado/.test(await p.evaluate(() => document.body.innerText)), 'período sem baixa: avisa e não baixa nada');

  // celular
  await p.setViewportSize({ width: 375, height: 760 });
  await p.click('#rel-ssw-cod'); await p.waitForTimeout(300);
  const larg = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(larg <= 375 && (await p.inputValue('#ssw-lista input[data-k="entregue"]')) === '01', 'janela dos códigos no celular, com os códigos salvos (' + larg + ' px)');
  await p.screenshot({ path: 'ssw-codigos-375.png' });
  ok(!errs.length, 'sem erros no console ' + J(errs.slice(0, 3)));
  await ctx.close(); await b.close();
  console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
  process.exit(falhas ? 1 : 0);
})();
