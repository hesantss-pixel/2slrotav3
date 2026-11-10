// Firebase Auth simulado (só para testes locais)
const F = (window.__FAKE = window.__FAKE || {});
F.accounts = F.accounts || { 'henrique@rotav3.com.br': 'senha123' };
F.authCbs = F.authCbs || [];
// O uid de verdade do Firebase é só letras e números. Aqui ele sai do e-mail, então os
// sinais (o ponto de "demo.abc123@…") são tirados: com ponto, o caminho acesso/<uid>
// seria recusado pelo banco, e isso seria um defeito do simulado, não do sistema.
const mkUser = (email) => ({ uid: 'uid-' + email.split('@')[0].replace(/[^A-Za-z0-9_-]/g, ''), email, displayName: null, getIdToken: async () => 'token-' + email });
const AUTH = { fake: true, get currentUser() { return F.user || null; } };
const OUTRAS = {};
export function getAuth(app) {
  if (app && app.name && app.name !== '[DEFAULT]') return (OUTRAS[app.name] = OUTRAS[app.name] || { fake: true, secundaria: app.name, currentUser: null });
  return AUTH;
}
export const inMemoryPersistence = 'memory';
export async function createUserWithEmailAndPassword(auth, email, pw) {
  await new Promise((r) => setTimeout(r, 30));
  if (email in F.accounts) throw Object.assign(new Error('auth/email-already-in-use'), { code: 'auth/email-already-in-use' });
  if (!pw || pw.length < 6) throw Object.assign(new Error('auth/weak-password'), { code: 'auth/weak-password' });
  F.accounts[email] = pw;
  const u = mkUser(email);
  F.criados = (F.criados || []).concat([{ email, pw, uid: u.uid, auth: auth.secundaria || 'principal' }]);
  if (auth === AUTH) { F.user = u; notify(); } else auth.currentUser = u;
  return { user: u };
}
export const browserLocalPersistence = 'local';
export async function setPersistence() {}
export function onAuthStateChanged(auth, cb) { F.authCbs.push(cb); setTimeout(() => cb(F.user || null), 10); return () => {}; }
function notify() { for (const cb of F.authCbs) cb(F.user || null); }
export async function signInWithEmailAndPassword(auth, email, pw) {
  await new Promise((r) => setTimeout(r, 50));
  if (!(email in F.accounts)) throw Object.assign(new Error('auth/invalid-credential'), { code: 'auth/invalid-credential' });
  if (F.accounts[email] !== pw) throw Object.assign(new Error('auth/invalid-credential'), { code: 'auth/invalid-credential' });
  F.user = mkUser(email); notify(); return { user: F.user };
}
export async function signOut(auth) { if (auth && auth.secundaria) { auth.currentUser = null; return; } F.user = null; notify(); }
export async function sendPasswordResetEmail(auth, email) { F.resetSent = email; }
