import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { isChunkLoadError } from '../lib/lazyWithRetry';
import './AppErrorBoundary.css';

type Props = { children: ReactNode };
type State = { error: Error | null; recovering: boolean };

const RELOAD_MARKER = 'mboteroom-runtime-recovery';

const clearShellCaches = async () => {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith('mboteroom-shell-'))
      .map((key) => caches.delete(key)),
  );
};

const refreshServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  await registration?.update().catch(() => undefined);
};

export default class AppErrorBoundary extends Component<Props, State> {
  declare props: Readonly<Props>;
  declare setState: (state: Partial<State>) => void;

  state: State = { error: null, recovering: false };

  constructor(props: Props) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, recovering: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MBotéRoom] Interface error:', error, info.componentStack);

    if (!isChunkLoadError(error) || !navigator.onLine) return;

    const route = window.location.pathname + window.location.search;
    const marker = sessionStorage.getItem(RELOAD_MARKER);
    if (marker === route) return;

    sessionStorage.setItem(RELOAD_MARKER, route);
    this.setState({ recovering: true });
    void this.recoverAndReload();
  }

  private recoverAndReload = async () => {
    try {
      await Promise.all([clearShellCaches(), refreshServiceWorker()]);
    } finally {
      window.setTimeout(() => window.location.reload(), 120);
    }
  };

  private manualRetry = async () => {
    this.setState({ recovering: true });
    try {
      sessionStorage.removeItem(RELOAD_MARKER);
      await Promise.all([clearShellCaches(), refreshServiceWorker()]);
    } finally {
      window.location.reload();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    if (this.state.recovering) {
      return (
        <main className="app-error-page" role="status" aria-live="polite">
          <section className="app-error-card">
            <span className="app-error-icon is-loading"><RefreshCw /></span>
            <h1>Mise à jour de MBotéRoom…</h1>
            <p>Une nouvelle version de cette page est en cours de chargement.</p>
          </section>
        </main>
      );
    }

    const offline = !navigator.onLine;
    return (
      <main className="app-error-page" role="alert">
        <section className="app-error-card">
          <span className="app-error-icon"><AlertTriangle /></span>
          <h1>Cette page n’a pas pu s’afficher</h1>
          <p>
            {offline
              ? 'La connexion semble indisponible. Reconnectez-vous puis réessayez.'
              : 'MBotéRoom a rencontré une erreur d’affichage. Vos données ne sont pas supprimées.'}
          </p>
          <div className="app-error-actions">
            <button type="button" className="primary" onClick={() => void this.manualRetry()}>
              <RefreshCw /> Réessayer
            </button>
            <button type="button" onClick={() => window.location.assign('/app')}>
              <Home /> Retour à l’accueil
            </button>
          </div>
        </section>
      </main>
    );
  }
}
