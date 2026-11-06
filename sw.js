// Сервис-воркер приложения Divior: быстрый запуск и работа без интернета.
// Страницы всегда берутся из сети (чтобы цены и наличие были свежими); кэш — только запасной вариант.
const V = 'divior-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !k.startsWith(V)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // База, вход, функции сервера — никогда не кэшируем.
  if (url.pathname.startsWith('/.netlify/') || /googleapis\.com|firebase|gstatic\.com\/firebasejs|mc\.yandex|google-analytics|googletagmanager/.test(url.host + url.pathname)) return;

  // Страницы: сначала сеть, без сети — сохранённая копия.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(V).then(c => c.put(url.pathname.startsWith('/product/') ? req : '/', cp)); }
      return r;
    }).catch(async () => (await caches.match(req)) || (await caches.match('/'))));
    return;
  }
  // Фото товаров и шрифты: показываем из кэша сразу, обновляем в фоне.
  if (/cdn-kaspi\.kz|images\.unsplash\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host) || url.pathname.startsWith('/icons/')) {
    const name = V + '-media';
    e.respondWith(caches.open(name).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { c.put(req, r.clone()); trim(name, 400); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
