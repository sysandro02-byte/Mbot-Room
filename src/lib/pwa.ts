let refreshing = false;

export const registerPwa = () => {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        registration.update().catch(() => undefined);
        window.dispatchEvent(new CustomEvent('mbote-room-pwa-ready', { detail: { registration } }));
        window.setInterval(() => registration.update().catch(() => undefined), 60 * 60 * 1000);

        const notifyUpdate = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              window.dispatchEvent(new CustomEvent('mbote-room-pwa-update-ready', { detail: { registration } }));
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
    refreshing = true;
    window.location.reload();
  });
};

export const activatePwaUpdate = (registration: ServiceWorkerRegistration) => {
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
};
