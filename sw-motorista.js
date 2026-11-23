// Página do motorista que abre sem sinal (só controla motorista.html, escopo "./motorista").
// Guarda a página, o código do banco (Firebase, endereço com versão) e o logo. A rota em si
// fica guardada pela própria página (localStorage) e as baixas, na fila do aparelho (IndexedDB).
const CACHE = 'rv3-motorista-v1';
const ARQUIVOS = [
  'motorista.html',
  'assets/logo-rotav3.png',
  'assets/favicon.png',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(ARQUIVOS.map((u) => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('rv3-motorista-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const guardar = (req, resp) => { if (resp && resp.ok) { const c = resp.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return resp; };

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // a página: da rede quando há sinal (sempre a versão nova); sem sinal, a guardada
  if (r.mode === 'navigate' && u.pathname.endsWith('/motorista.html')) {
    e.respondWith(fetch(r).then((resp) => guardar('motorista.html', resp)).catch(() => caches.match('motorista.html')));
    return;
  }
  // código do Firebase (não muda nesse endereço), logo e ícone: o guardado primeiro
  const firebase = u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  const asset = u.origin === self.location.origin && u.pathname.includes('/assets/');
  if (firebase || asset) e.respondWith(caches.match(r).then((m) => m || fetch(r).then((resp) => guardar(r, resp))));
});
