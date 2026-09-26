let refreshing = false;
const UPDATE_PENDING_KEY = 'mboteroom-pwa-update-pending';

const isLiveMeetingRoute = () => /^\/reunions\/[^/]+(?:\/luna)?\/?$/.test(window.location.pathname);

const reloadWhenSafe = () => {
  if (sessionStorage.getItem(UPDATE_PENDING_KEY) !== '1' || isLiveMeetingRoute()) return;
  sessionStorage.removeItem(UPDATE_PENDING_KEY);
  window.location.reload();
};

export const registerPwa = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (window.location.hostname === 'appassets.androidplatform.net' || /MBoteRoomAndroid/i.test(navigator.userAgent)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        registration.update().catch(() => undefined);
        window.dispatchEvent(new CustomEvent('mbote-room-pwa-ready', { detail: { registration } }));
        window.setInterval(() => registration.update().catch(() => undefined), 60 * 1000);
        const refreshOnVisible = () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => undefined);
            reloadWhenSafe();
          }
        };
        const refreshOnOnline = () => registration.update().catch(() => undefined);
        document.addEventListener('visibilitychange', refreshOnVisible);
        window.addEventListener('online', refreshOnOnline);
        window.addEventListener('focus', refreshOnVisible);
        window.setInterval(reloadWhenSafe, 2000);

        const notifyUpdate = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('mbote-room-pwa-update-ready', { detail: { registration } }));
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        };

        notifyUpdate(registration.installing);
        registration.addEventListener('updatefound', () => notifyUpdate(registration.installing));
      })
      .catch((error) => {
        console.warn('[MBotéRoom PWA] Service worker registration failed:', error);
      });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    if (isLiveMeetingRoute()) {
      sessionStorage.setItem(UPDATE_PENDING_KEY, '1');
      return;
    }
    refreshing = true;
    window.location.reload();
  });
};

export const activatePwaUpdate = (registration: ServiceWorkerRegistration) => {
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
};
