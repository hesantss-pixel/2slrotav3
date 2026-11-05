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
export function getDatabase() { return { fake: true }; }
export function ref(db, path = '') { return { path }; }
export function onValue(r, cb, err) {
  const l = { path: r.path, cb, err }; F.listeners.push(l);
  setTimeout(() => { if (denied(r.path)) { err && err(Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' })); } else cb(snap(r.path)); }, 20);
  return () => { F.listeners = F.listeners.filter((x) => x !== l); };
}
export function off() {}
export async function set(r, val) { if (denied(r.path)) throw new Error('PERMISSION_DENIED'); F.writes.push(['set', r.path, val]); setAt(r.path, val); fire(); }
export async function update(r, obj) {
  if (denied(r.path)) throw new Error('PERMISSION_DENIED');
  F.writes.push(['update', r.path, obj]);
  for (const [k, v] of Object.entries(obj)) setAt((r.path ? r.path + '/' : '') + k, v);
  fire();
}
export async function remove(r) { F.writes.push(['remove', r.path]); setAt(r.path, null); fire(); }
export async function get(r) { if (denied(r.path)) throw Object.assign(new Error('permission_denied'), { code: 'PERMISSION_DENIED' }); return snap(r.path); }
export function serverTimestamp() { return Date.now(); }
export function push(r, val) { const id = 'k' + Date.now() + Math.floor(Math.random() * 1e4); const p = (r.path ? r.path + '/' : '') + id; if (val !== undefined) setAt(p, val); fire(); const ref_ = { path: p, key: id }; const pr = Promise.resolve({ path: p, key: id }); ref_.then = pr.then.bind(pr); ref_.catch = pr.catch.bind(pr); return ref_; }
