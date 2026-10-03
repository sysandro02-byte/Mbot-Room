import { Home, MessageCircle, Radio, UserRound, Video } from 'lucide-react';
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
    || location.pathname === '/join'
    || location.pathname.startsWith('/join/')
    || /^\/reunions\/[^/]+(?:\/salle-attente|\/terminee|\/luna)?$/.test(location.pathname)
    || /^\/app\/live\/[^/]+$/.test(location.pathname);
  if (hidden) return null;

  const items = [
    { label: 'Accueil', path: '/app', icon: Home },
    { label: 'Réunions', path: '/app/meetings', icon: Video },
    { label: 'Live', path: '/app/live', icon: Radio },
    { label: 'Messages', path: '/app/messages', icon: MessageCircle },
    { label: 'Profil', path: '/app/profile', icon: UserRound },
  ];

  return <nav className="android-native-bottom-nav" aria-label="Navigation Android MBotéRoom">
    {items.map(({ label, path, icon: Icon }) => <button
      key={path}
      type="button"
      className={activeFor(location.pathname, path) ? 'is-active' : ''}
      aria-current={activeFor(location.pathname, path) ? 'page' : undefined}
      onClick={() => navigate(path)}
    >
      <span className="android-native-nav-icon"><Icon size={22}/></span>
      <span className="android-native-nav-label">{label}</span>
    </button>)}
  </nav>;
}
