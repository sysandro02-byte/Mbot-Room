import { CalendarDays, Home, MessageCircle, Settings, Video } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeAndroidApp } from '../lib/nativePlatform';

const activeFor = (pathname: string, target: string) => {
  if (target === '/app') return pathname === '/app';
  if (target === '/app/meetings') return pathname.startsWith('/app/meetings') || pathname === '/reunions';
  return pathname.startsWith(target);
};

export default function AndroidNativeBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  if (!isNativeAndroidApp()) return null;

  const hidden = location.pathname.startsWith('/admin')
    || location.pathname.startsWith('/login')
    || location.pathname.startsWith('/connexion')
    || location.pathname.startsWith('/inscription')
    || location.pathname.startsWith('/mot-de-passe-oublie')
    || location.pathname.startsWith('/rejoindre-une-reunion')
    || /^\/reunions\/[^/]+(?:\/salle-attente|\/terminee|\/luna)?$/.test(location.pathname)
    || /^\/app\/live\/[^/]+$/.test(location.pathname);
  if (hidden) return null;

  const items = [
    { label: 'Accueil', path: '/app', icon: Home },
    { label: 'Réunions', path: '/app/meetings', icon: Video },
    { label: 'Rejoindre', path: '/join', icon: Video, join: true },
    { label: 'Messages', path: '/app/messages', icon: MessageCircle },
    { label: 'Paramètres', path: '/app/settings', icon: Settings },
  ];

  return <nav className="android-native-bottom-nav" aria-label="Navigation Android MBotéRoom">
    {items.map(({ label, path, icon: Icon, join }) => <button
      key={path}
      type="button"
      className={`${activeFor(location.pathname, path) ? 'is-active' : ''}${join ? ' is-join' : ''}`}
      aria-current={activeFor(location.pathname, path) ? 'page' : undefined}
      onClick={() => navigate(path)}
    >
      <Icon size={20}/><span>{label}</span>
    </button>)}
  </nav>;
}
