const CACHE_VERSION = 'mboteroom-shell-v4-brand';
const SHELL = [
  '/',
  '/app',
  '/manifest.webmanifest',
  '/icons/mboteroom-favicon.png',
  '/icons/mboteroom-maskable-512.png',
  '/icons/mboteroom-apple-180.png',
  '/icons/mboteroom-192.png',
  '/icons/mboteroom-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/socket.io/');

const offlineDocument = () => new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d3156"><title>MBotéRoom hors connexion</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f6f8ff;color:#17213c;font-family:system-ui,-apple-system,sans-serif}.c{max-width:420px;text-align:center;background:#fff;padding:28px;border:1px solid #dfe6f3;border-radius:22px;box-shadow:0 18px 50px rgba(20,34,76,.1)}h1{margin:12px 0 8px;font-size:25px}p{color:#68758e;line-height:1.6}button{border:0;border-radius:12px;background:#007e83;color:#fff;padding:12px 18px;font-weight:800}.b{font-size:12px;color:#8994a8;margin-top:18px}</style></head>
<body><section class="c"><div style="font-size:36px">📶</div><h1>Vous êtes hors connexion</h1><p>MBotéRoom reste accessible pour les éléments déjà chargés. Reconnectez-vous pour rejoindre une réunion, synchroniser vos données ou recevoir les dernières mises à jour.</p><button onclick="location.reload()">Réessayer</button><div class="b">MBotéRoom · créée par LoukaTech</div></section></body></html>`, {
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => (await caches.match('/')) || offlineDocument())
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
            }
            return response;
          })
          .catch(() => cached || Response.error());
        return cached || network;
      })
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'MBotéRoom',
    body: 'Vous avez une nouvelle notification.',
    url: '/app/notifications',
    tag: 'mboteroom',
    icon: '/icons/mboteroom-192.png',
    badge: '/icons/mboteroom-192.png',
    data: {},
  };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }
  const data = { ...(payload.data || {}), url: payload.url || payload.data?.url || '/app/notifications' };
  event.waitUntil(self.registration.showNotification(payload.title || 'MBotéRoom', {
    body: payload.body || '',
    icon: payload.icon || '/icons/mboteroom-192.png',
    badge: payload.badge || '/icons/mboteroom-192.png',
    tag: payload.tag || 'mboteroom',
    data,
    renotify: payload.silent !== true,
    silent: payload.silent === true,
    vibrate: Array.isArray(payload.vibrate) ? payload.vibrate : [120, 70, 120],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/notifications', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          if ('navigate' in client) await client.navigate(target).catch(() => undefined);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
