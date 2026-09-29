import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './styles/ui-unified.css';
import './styles/brand.css';
import './styles/responsive-hardening.css';
import './styles/android-native.css';
import { registerPwa } from './lib/pwa';
import { initOfflineMode } from './lib/offline';
import { isChunkLoadError } from './lib/lazyWithRetry';

registerPwa();
initOfflineMode();

const recoverFromChunkFailure = async (reason: unknown) => {
  if (!isChunkLoadError(reason) || !navigator.onLine) return;
  const key = 'mboteroom-global-chunk-recovery';
  const route = window.location.pathname + window.location.search;
  if (sessionStorage.getItem(key) === route) return;
  sessionStorage.setItem(key, route);
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((name) => name.startsWith('mboteroom-shell-')).map((name) => caches.delete(name)));
    }
    const registration = await navigator.serviceWorker?.getRegistration?.('/');
    await registration?.update().catch(() => undefined);
  } finally {
    window.location.reload();
  }
};

window.addEventListener('unhandledrejection', (event) => {
  void recoverFromChunkFailure(event.reason);
});
window.addEventListener('error', (event) => {
  void recoverFromChunkFailure(event.error || event.message);
});
window.setTimeout(() => sessionStorage.removeItem('mboteroom-global-chunk-recovery'), 5000);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
