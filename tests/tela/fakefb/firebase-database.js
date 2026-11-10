// Firebase Realtime Database simulado (só para testes locais)
const F = (window.__FAKE = window.__FAKE || {});
F.db = F.db || {};
F.listeners = F.listeners || [];
F.writes = F.writes || [];
const parts = (p) => (p || '').split('/').filter(Boolean);
function getAt(path) { let o = F.db; for (const k of parts(path)) { if (o == null) return null; o = o[k]; } return o === undefined ? null : o; }
function setAt(path, val) {
  const ks = parts(path); if (!ks.length) { F.db = val; return; }
  let o = F.db; for (const k of ks.slice(0, -1)) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
  if (val === null) delete o[ks.at(-1)]; else o[ks.at(-1)] = val;
}
function denied(path) { return F.denyAll || (F.user == null && F.requireAuth) || (F.deny || []).some((p) => (path || '').startsWith(p)); }
function fire() { for (const l of F.listeners) { if (denied(l.path)) continue; l.cb(snap(l.path)); } }
F.fire = () => fire(); F.setAt = (p, v) => setAt(p, v);
const snap = (path) => ({ val: () => JSON.parse(JSON.stringify(getAt(path))), exists: () => getAt(path) != null });
// ── As mesmas recusas do SDK de verdade ─────────────────────────────────────
// O Firebase real NÃO grava (e estoura na hora, antes de devolver a promessa) quando
// o valor tem undefined, NaN ou função, quando uma chave tem . # $ / [ ] e quando um
// update manda um caminho e um filho dele juntos. Sem isto, um erro desses passava em
// todos os testes e só aparecia em produção.
const RUIM = /[.#$\[\]\x00-\x1f\x7f]/;
function validarChave(k, fn, onde) {
  if (k === '.sv' || k === '.value' || k === '.priority') return;
  if (typeof k !== 'string' || !k.length || RUIM.test(k) || k.includes('/') || new TextEncoder().encode(k).length > 768)
    throw new Error(`${fn} failed: value argument contains an invalid key (${k}) in property '${onde}'.  Keys must be non-empty strings and can't contain ".", "#", "$", "/", "[", or "]"`);
}
function validarValor(v, fn, onde) {
  if (v === undefined) throw new Error(`${fn} failed: value argument contains undefined in property '${onde}'`);
  if (typeof v === 'function') throw new Error(`${fn} failed: value argument contains a function in property '${onde}'`);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`${fn} failed: value argument contains ${v} in property '${onde}'`);
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { validarChave(k, fn, onde); validarValor(x, fn, onde + '.' + k); }
}
function validarCaminho(p, fn) {
  if (typeof p !== 'string') throw new Error(`${fn} failed: path argument was an invalid path`);
  const semInfo = p.replace(/^\/?\.info(\/|$)/, '/');
  if (RUIM.test(semInfo)) throw new Error(`${fn} failed: path argument was an invalid path = "${p}". Paths must be non-empty strings and can't contain ".", "#", "$", "[", or "]"`);
}
function validarUpdate(obj, base) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('update failed: values argument must be an object containing the children to replace.');
  const caminhos = Object.keys(obj).map((k) => { validarCaminho(k, 'update'); validarValor(obj[k], 'update', (base ? base + '/' : '') + k); return parts(k).join('/'); }).sort();
  for (let i = 1; i < caminhos.length; i++)
    if (caminhos[i] === caminhos[i - 1] || caminhos[i].startsWith(caminhos[i - 1] + '/'))
      throw new Error(`update failed: values argument contains a path /${caminhos[i - 1]} that is ancestor of another path /${caminhos[i]}`);
}
F.recusas = F.recusas || [];
// Além de estourar, avisa o coletor da bateria (coletor.js): um erro engolido por
// try/catch no código da tela continua aparecendo no resumo do rodar.sh.
const recusar = (e) => {
  F.recusas.push(e.message);
  try { navigator.sendBeacon('http://127.0.0.1:8779/recusa', location.pathname + ' :: ' + e.message); } catch (_) {}
  throw e;
};

export function getDatabase() { return { fake: true }; }
export function ref(db, path = '') { try { validarCaminho(path, 'ref'); } catch (e) { recusar(e); } return { path }; }
export function onValue(r, cb, err) {
  const l = { path: r.path, cb, err }; F.listeners.push(l);
  setTimeout(() => { if (denied(r.path)) { err && err(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); } else cb(snap(r.path)); }, 20);
  return () => { F.listeners = F.listeners.filter((x) => x !== l); };
}
export function off() {}
export function set(r, val) {
  try { validarValor(val, 'set', r.path); } catch (e) { recusar(e); }
  return (async () => { if (denied(r.path)) throw new Error('PERMISSION_DENIED'); F.writes.push(['set', r.path, val]); setAt(r.path, val); fire(); })();
}
export function update(r, obj) {
  try { validarUpdate(obj, r.path); } catch (e) { recusar(e); }
  return (async () => {
    if (denied(r.path)) throw new Error('PERMISSION_DENIED');
    F.writes.push(['update', r.path, obj]);
    for (const [k, v] of Object.entries(obj)) setAt((r.path ? r.path + '/' : '') + k, v);
    fire();
  })();
}
export async function remove(r) { F.writes.push(['remove', r.path]); setAt(r.path, null); fire(); }
export async function get(r) { if (denied(r.path)) throw Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' }); return snap(r.path); }
export function serverTimestamp() { return Date.now(); }
export function push(r, val) { if (val !== undefined) { try { validarValor(val, 'push', r.path); } catch (e) { recusar(e); } } const id = 'k' + Date.now() + Math.floor(Math.random() * 1e4); const p = (r.path ? r.path + '/' : '') + id; if (val !== undefined) setAt(p, val); fire(); const ref_ = { path: p, key: id }; const pr = Promise.resolve({ path: p, key: id }); ref_.then = pr.then.bind(pr); ref_.catch = pr.catch.bind(pr); return ref_; }
