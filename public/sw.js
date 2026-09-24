const CACHE_VERSION = 'mboteroom-shell-v7-resilient-offline';
const SHELL = [
  '/',
  '/app',
  '/app/meetings',
  '/app/calendar',
  '/app/messages',
  '/app/contacts',
  '/app/files',
  '/app/settings',
  '/app/notifications',
  '/join',
  '/manifest.webmanifest',
  '/icons/mboteroom-symbol.png',
  '/icons/mboteroom-install.svg',
  '/icons/mboteroom-install-maskable.svg',
  '/icons/mboteroom-favicon.png',
  '/icons/mboteroom-maskable-512.png',
  '/icons/mboteroom-apple-180.png',
  '/icons/mboteroom-192.png',
  '/icons/mboteroom-512.png',
];

const isApiRequest = (url) =>
  url.pathname.startsWith('/api/') ||
  url.pathname.startsWith('/socket.io/');

const putIfUsable = async (cache, request, response) => {
  if (!response || !response.ok || response.type === 'opaque') return response;
  await cache.put(request, response.clone()).catch(() => undefined);
  return response;
};

const precacheBuildAssets = async (cache) => {
  try {
    const response = await fetch('/', { cache: 'reload' });
    if (!response.ok) return;
    await cache.put('/', response.clone());
    const html = await response.text();
    const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter(Boolean);
    const urls = [...new Set(refs.map((value) => {
      try {
        return new URL(value, self.location.origin);
      } catch {
        return null;
      }
    }).filter((url) => url && url.origin === self.location.origin && url.pathname.startsWith('/assets/'))
      .map((url) => url.href))];
    await Promise.all(urls.map(async (url) => {
      try {
        const asset = await fetch(url, { cache: 'reload' });
        await putIfUsable(cache, url, asset);
      } catch {}
    }));
  } catch {}
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(SHELL.map(async (path) => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        await putIfUsable(cache, path, response);
      } catch {}
    }));
    await precacheBuildAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('mboteroom-shell-') && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const offlineDocument = () => new Response(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d3156"><title>MBotéRoom hors connexion</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#f6f8ff;color:#17213c;font-family:system-ui,-apple-system,sans-serif}.c{max-width:440px;text-align:center;background:#fff;padding:28px;border:1px solid #dfe6f3;border-radius:22px;box-shadow:0 18px 50px rgba(20,34,76,.1)}img{width:96px;height:96px;object-fit:contain}h1{margin:12px 0 8px;font-size:25px}p{color:#68758e;line-height:1.6}button{border:0;border-radius:12px;background:#007e83;color:#fff;padding:12px 18px;font-weight:800}.b{font-size:12px;color:#8994a8;margin-top:18px}</style></head>
<body><section class="c"><img src="/icons/mboteroom-symbol.png" alt=""><h1>MBotéRoom hors connexion</h1><p>L’interface et les données déjà synchronisées restent disponibles. Les réunions en direct, appels et nouvelles données seront repris automatiquement dès le retour d’Internet.</p><button onclick="location.reload()">Ouvrir l’application</button><div class="b">MBotéRoom · LoukaTech</div></section></body></html>`, {
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

const cachedNavigation = async (request, url) => {
  const cache = await caches.open(CACHE_VERSION);
  return (await cache.match(request, { ignoreSearch: true }))
    || (await cache.match(url.pathname, { ignoreSearch: true }))
    || (await cache.match('/app', { ignoreSearch: true }))
    || (await cache.match('/', { ignoreSearch: true }))
    || offlineDocument();
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isApiRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await putIfUsable(cache, request, response);
          if (url.pathname.startsWith('/app') || url.pathname.startsWith('/reunions') || url.pathname.startsWith('/join')) {
            await putIfUsable(cache, url.pathname, response);
          }
        }
        return response;
      } catch {
        return cachedNavigation(request, url);
      }
    })());
    return;
  }

  const staticAsset = url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || url.pathname === '/manifest.webmanifest';

  if (staticAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) {
        event.waitUntil(
          fetch(request)
            .then((response) => putIfUsable(cache, request, response))
            .catch(() => undefined)
        );
        return cached;
      }
      try {
        const response = await fetch(request);
        await putIfUsable(cache, request, response);
        return response;
      } catch {
        return Response.error();
      }
    })());
  }
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'MBotéRoom',
    body: 'Vous avez une nouvelle notification.',
    url: '/app/notifications',
    tag: 'mboteroom',
    icon: '/icons/mboteroom-symbol.png',
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
    icon: payload.icon || '/icons/mboteroom-symbol.png',
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
