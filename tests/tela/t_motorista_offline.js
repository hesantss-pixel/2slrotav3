// Link do motorista sem sinal: a baixa (com foto) fica guardada no celular e vai sozinha
// quando o sinal volta, mesmo se a página fechar no meio; e a rota abre sem sinal (23/11/2026).
const { chromium } = require('playwright');
const path = require('path');
const { open } = require('./harness');
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const TOKEN = 'tok-offline-motorista-0001';
const FOTO = path.join(__dirname, 'xml', 'canhoto-teste.jpg');

const seed = (a) => {
  const off = localStorage.getItem('teste_sem_sinal') === '1';
  window.__FAKE = {
    user: null, offline: off,
    db: {
      '.info': { connected: !off },
      entregador: { [a.TOKEN]: {
        eid: 'emp1', expira: Date.now() + 864e5,
        info: { veiculo: 'VUC · ABC1D23', motorista: 'Marcos', data: '2026-11-23', saida: 420, deposito: { nome: 'CD Guarulhos' } },
        paradas: [
          { nf: '7001', tipo: 'entrega', dest: 'Mercado Um', endereco: 'Rua A, 10', bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', lat: -23.46, lng: -46.53, peso: 100, itens: 2 },
          { nf: '7002', tipo: 'entrega', dest: 'Loja Dois', endereco: 'Rua B, 20', bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', lat: -23.47, lng: -46.52, peso: 50, itens: 1 },
          { nf: '7003', tipo: 'coleta', dest: 'Fábrica Três', endereco: 'Rua C, 30', bairro: 'Cumbica', cidade: 'Guarulhos', uf: 'SP', lat: -23.43, lng: -46.47, peso: 80, itens: 3 },
        ],
      } },
    },
  };
};
const fila = (p) => p.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('rv3-motorista', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'k' });
  r.onsuccess = () => { const q = r.result.transaction('fila').objectStore('fila').getAll(); q.onsuccess = () => ok(q.result.map((e) => ({ i: e.i, status: e.baixa.status, rec: e.baixa.recebedor || '', foto: !!e.foto }))); };
}));
const semSinal = (p) => p.evaluate(() => { const F = window.__FAKE; F.offline = true; F.db['.info'] = { connected: false }; F.fire(); });

(async () => {
  const b = await chromium.launch();
  const { ctx, p, errs } = await open(b, 'motorista.html#' + TOKEN, 390, 844, seed, true, { TOKEN });
  const dialogs = []; p.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await p.waitForTimeout(500);
  ok(/Mercado Um/.test(await p.textContent('#app')), 'rota abriu com sinal');
  ok(await p.evaluate((t) => !!localStorage.getItem('rv3_rota_' + t), TOKEN), 'cópia da rota guardada no celular');

  // ── perde o sinal e dá baixa com foto ──────────────────────────────────────
  await semSinal(p); await p.waitForTimeout(3300);
  ok(await p.isVisible('#offline'), 'aviso de sem internet aparece');
  ok(/mesmo se você fechar a página/.test(await p.textContent('#offline')), 'aviso diz que pode fechar a página: ' + (await p.textContent('#offline')).trim());
  await p.click('#p-0 [data-acao="feito"]'); await p.waitForTimeout(150);
  await p.fill('#p-0 input[name="recebedor"]', 'Ana');
  await p.setInputFiles('#p-0 input[name="foto"]', FOTO);
  await p.click('#p-0 button[type="submit"]'); await p.waitForTimeout(6800);   // espera o GPS (6 s) como no celular
  const f1 = await fila(p);
  ok(f1.length === 1 && f1[0].i === 0 && f1[0].rec === 'Ana' && f1[0].foto, 'baixa com foto guardada na fila do celular: ' + JSON.stringify(f1));
  ok(/Guardada no celular/.test(await p.textContent('#p-0')), 'parada mostra "Guardada no celular"');
  ok(/1 de 3/.test(await p.textContent('.r-prog')), 'progresso conta a baixa guardada (1 de 3)');
  const noBanco = await p.evaluate((t) => !!(window.__FAKE.db.entregador[t].baixas || {})[0], TOKEN);
  ok(!noBanco, 'sem sinal, nada chegou ao banco ainda');

  // ── corrige a baixa ainda sem sinal: vale a última ──────────────────────────
  await p.click('#p-0 [data-acao="corrigir"]'); await p.waitForTimeout(150);
  await p.fill('#p-0 input[name="recebedor"]', 'Ana Paula');
  await p.click('#p-0 button[type="submit"]'); await p.waitForTimeout(6800);
  const f2 = await fila(p);
  ok(f2.length === 1 && f2[0].rec === 'Ana Paula' && f2[0].foto, 'correção sem sinal troca a baixa guardada (uma só na fila) e mantém a foto: ' + JSON.stringify(f2));

  // ── fecha a página (celular desligado) e abre de novo, ainda sem sinal ──────
  await p.evaluate(() => localStorage.setItem('teste_sem_sinal', '1'));
  await p.close();
  const p2 = await ctx.newPage(); p2.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto('http://127.0.0.1:8771/motorista.html#' + TOKEN, { waitUntil: 'load' }); await p2.waitForTimeout(800);
  ok(/Mercado Um/.test(await p2.textContent('#app')) && /Fábrica Três/.test(await p2.textContent('#app')), 'sem sinal, a rota abre com a cópia guardada');
  ok(await p2.isVisible('#offline'), 'e avisa que está sem internet');
  ok(/Guardada no celular/.test(await p2.textContent('#p-0')) && /Ana Paula/.test(await p2.textContent('#p-0')), 'a baixa feita antes de fechar continua lá, guardada');
  ok((await fila(p2)).length === 1, 'fila do celular sobreviveu ao fechamento da página');

  // ── o sinal volta: a baixa vai sozinha ──────────────────────────────────────
  await p2.evaluate(() => window.__FAKE.reconectar()); await p2.waitForTimeout(800);
  const bx = await p2.evaluate((t) => JSON.parse(JSON.stringify(window.__FAKE.db.entregador[t])), TOKEN);
  ok(bx.baixas && bx.baixas[0] && bx.baixas[0].status === 'feito' && bx.baixas[0].recebedor === 'Ana Paula' && bx.baixas[0].temFoto === true, 'sinal voltou: a baixa chegou ao banco');
  ok(bx.fotos && typeof bx.fotos[0] === 'string' && bx.fotos[0].startsWith('data:image/jpeg;base64,'), 'e a foto do canhoto também');
  ok(typeof bx.baixas[0].hora === 'number', 'com a hora da baixa');
  ok((await fila(p2)).length === 0, 'fila do celular esvaziou depois da confirmação do banco');
  ok(!(await p2.isVisible('#offline')) && /foto enviada/.test(await p2.textContent('#p-0')) && !/Guardada/.test(await p2.textContent('#p-0')), 'tela mostra "foto enviada", sem o aviso de guardada');

  // ── com sinal: baixa normal continua igual ──────────────────────────────────
  await p2.evaluate(() => localStorage.removeItem('teste_sem_sinal'));
  await p2.click('#p-1 [data-acao="nao"]'); await p2.waitForTimeout(150);
  await p2.selectOption('#p-1 select[name="motivo"]', 'Cliente ausente');
  await p2.click('#p-1 button[type="submit"]'); await p2.waitForTimeout(6800);
  const b1 = await p2.evaluate((t) => (window.__FAKE.db.entregador[t].baixas || {})[1], TOKEN);
  ok(b1 && b1.status === 'nao_feito' && b1.motivo === 'Cliente ausente', 'com sinal, a baixa vai direto ao banco');
  ok((await fila(p2)).length === 0, 'e não fica nada na fila');

  ok(!dialogs.length, 'sem alertas: ' + JSON.stringify(dialogs));
  ok(!errs.length, 'sem erros: ' + JSON.stringify(errs.slice(0, 3)));
  await b.close();
})();
