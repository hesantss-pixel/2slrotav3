// Avaliador simplificado das regras do Realtime Database (firebase/database.rules.json),
// para testar a lógica das regras sem o emulador do Firebase.
// Cobre: .read/.write em cascata (vale o primeiro true do topo até o caminho),
// .validate em cada nó com valor novo (no caminho gravado, abaixo dele e acima dele),
// variáveis $ e as funções que as regras do ROTAV3 usam.
// NÃO substitui publicar as regras e testar no Firebase de verdade.
const fs = require('fs'), path = require('path');
const REGRAS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../firebase/database.rules.json'), 'utf8')).rules;

// funções de texto que existem nas regras e não no JavaScript
const EXTRA = {
  beginsWith(x) { return String(this).startsWith(x); },
  contains(x) { return String(this).includes(x); },
  matches(re) { return re.test(String(this)); },
};
for (const [n, f] of Object.entries(EXTRA)) if (!String.prototype[n]) Object.defineProperty(String.prototype, n, { value: f });

const segs = (p) => String(p || '').split('/').filter(Boolean);
function noValor(v, ks) {
  for (const k of ks) { if (v == null || typeof v !== 'object') return null; v = v[k]; }
  return v === undefined ? null : v;
}
function gravarEm(raiz, ks, valor) {
  if (!ks.length) return valor;
  let o = raiz;
  for (const k of ks.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
  if (valor === null) delete o[ks.at(-1)]; else o[ks.at(-1)] = valor;
  return raiz;
}
class Snap {
  constructor(v) { this.v = v === undefined ? null : v; }
  val() { return this.v; }
  child(p) { return new Snap(noValor(this.v, segs(p))); }
  exists() { return this.v !== null; }
  hasChild(p) { return this.child(p).exists(); }
  hasChildren(ks) { if (this.v === null || typeof this.v !== 'object') return false; return !ks || ks.every((k) => this.hasChild(k)); }
  isNumber() { return typeof this.v === 'number'; }
  isString() { return typeof this.v === 'string'; }
  isBoolean() { return typeof this.v === 'boolean'; }
}
function avaliar(expr, ctx) {
  if (typeof expr === 'boolean') return expr;
  const nomes = Object.keys(ctx);
  try { return !!new Function(...nomes, `return (${expr});`)(...nomes.map((n) => ctx[n])); }
  catch (e) { return false; }   // regra que dá erro nega, como no Firebase
}
function filhoRegra(no, k, vars) {
  if (!no || typeof no !== 'object') return [null, vars];
  if (Object.prototype.hasOwnProperty.call(no, k)) return [no[k], vars];
  const w = Object.keys(no).find((x) => x.startsWith('$'));
  return w ? [no[w], { ...vars, [w]: k }] : [null, vars];
}

// pode('read'|'write', banco, caminho, valor, { auth: {uid} | null, now })
function pode(op, banco, caminho, valor, { auth = null, now = Date.now() } = {}) {
  const ks = segs(caminho), velho = banco || {};
  const novo = op === 'write' ? gravarEm(JSON.parse(JSON.stringify(velho)), ks, valor === undefined ? null : valor) : velho;
  const root = new Snap(velho);
  const ctx = (kk, vars) => ({ root, data: new Snap(noValor(velho, kk)), newData: new Snap(noValor(novo, kk)), now, auth, ...vars });
  // permissão: um .read/.write true do topo até o caminho
  let no = REGRAS, vars = {}, ok = false;
  for (let i = 0; i <= ks.length && no; i++) {
    if (i > 0) [no, vars] = filhoRegra(no, ks[i - 1], vars);
    if (!no) break;
    const r = no[op === 'read' ? '.read' : '.write'];
    if (r !== undefined && avaliar(r, ctx(ks.slice(0, i), vars))) { ok = true; break; }
  }
  if (!ok || op === 'read') return ok;
  // .validate nos nós acima do caminho (o valor deles muda junto)
  no = REGRAS; vars = {};
  for (let i = 0; i < ks.length; i++) {
    if (i > 0) [no, vars] = filhoRegra(no, ks[i - 1], vars);
    if (!no) return true;
    const v = no['.validate'], kk = ks.slice(0, i);
    if (v !== undefined && noValor(novo, kk) !== null && !avaliar(v, ctx(kk, vars))) return false;
  }
  [no, vars] = ks.length ? filhoRegra(no, ks.at(-1), vars) : [no, vars];
  if (!no) return true;
  // .validate no nó gravado e em cada filho novo
  const desce = (n, vv, kk) => {
    const val = noValor(novo, kk);
    if (val === null) return true;
    if (n['.validate'] !== undefined && !avaliar(n['.validate'], ctx(kk, vv))) return false;
    if (typeof val === 'object') {
      for (const k of Object.keys(val)) {
        const [f, v2] = filhoRegra(n, k, vv);
        if (f && !desce(f, v2, [...kk, k])) return false;
      }
    }
    return true;
  };
  return desce(no, vars, ks);
}

module.exports = { pode, REGRAS };
