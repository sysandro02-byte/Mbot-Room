import { Bell, CheckCheck, CircleCheck, Clock3 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import AppShell from '../components/AppShell';
import { notificationService, type RoomNotification } from '../services/notificationService';
import { getAppLocale } from '../lib/appLanguage';
import './UtilityPages.css';

const formatDate = (value: string) => new Intl.DateTimeFormat(getAppLocale(), {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export default function NotificationsPage() {
  const [items, setItems] = useState<RoomNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const unread = useMemo(() => items.filter((item) => !item.readAt).length, [items]);

  useEffect(() => {
    let cancelled = false;
    notificationService.list()
      .then((rows) => {
        if (!cancelled) setItems(Array.isArray(rows) ? rows : []);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Notifications indisponibles.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const markRead = async (notification: RoomNotification) => {
    if (notification.readAt) return;
    try {
      const updated = await notificationService.markRead(notification.id);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mise à jour impossible.');
    }
  };

  const markAllRead = async () => {
    try {
      await notificationService.markAllRead();
      const now = new Date().toISOString();
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Mise à jour impossible.');
    }
  };

  return <AppShell title="Notifications">
    <main className="utility-page">
      <header className="utility-page-head">
        <div>
          <h1>Centre de notifications</h1>
          <p>{unread ? `${unread} notification${unread > 1 ? 's' : ''} non lue${unread > 1 ? 's' : ''}` : 'Tout est à jour.'}</p>
        </div>
        {unread > 0 ? <button type="button" onClick={() => void markAllRead()}><CheckCheck size={17}/> Tout lire</button> : null}
      </header>

      {error ? <div className="utility-error">{error}</div> : null}
      {loading ? <div className="utility-empty">Chargement des notifications…</div> : null}
      {!loading && !items.length ? <section className="utility-card utility-empty"><Bell size={28}/><p>Aucune notification.</p></section> : null}

      {!loading && items.length ? <section className="utility-card">
        <div className="utility-notification-list">
          {items.map((notification) => <button
            type="button"
            key={notification.id}
            className={`utility-notification-row ${notification.readAt ? 'is-read' : 'is-unread'}`}
            onClick={() => void markRead(notification)}
          >
            <span className="utility-notification-icon">{notification.readAt ? <CircleCheck size={18}/> : <Bell size={18}/>}</span>
            <span className="utility-notification-copy">
              <strong>{notification.title}</strong>
              {notification.body ? <p>{notification.body}</p> : null}
              <small><Clock3 size={13}/>{formatDate(notification.createdAt)}</small>
            </span>
            {!notification.readAt ? <b>Non lue</b> : null}
          </button>)}
        </div>
      </section> : null}
    </main>
  </AppShell>;
}
