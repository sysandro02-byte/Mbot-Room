import { useEffect, useState } from 'react';
import { conversationService } from '../services/conversationService';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import { FolderOpen, Home, MessageCircle, Radio, UserRound, Video } from 'lucide-react';
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
  const [unreadMessages, setUnreadMessages] = useState(0);
  const nativeUser = isNativeAndroidApp() && !authService.getCurrentUser()?.isGuest;
  useEffect(() => {
    if (!nativeUser) return;
    let active = true;
    const refresh = () => {
      void conversationService.getConversations()
        .then((conversations) => {
          if (active) setUnreadMessages(conversations.reduce((total, item) => total + Math.max(0, item.unreadCount || 0), 0));
        }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    socket.on('conversation:message', refresh);
    const onFocus = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      socket.off('conversation:message', refresh);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [nativeUser, location.pathname]);
  if (!nativeUser) return null;

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
    location.pathname.startsWith('/app/files')
      ? { label: 'Fichiers', path: '/app/files', icon: FolderOpen }
      : { label: 'Profil', path: '/app/profile', icon: UserRound },
  ];

  return <nav className="android-native-bottom-nav" aria-label="Navigation Android MBotéRoom">
    {items.map(({ label, path, icon: Icon }) => <button
      key={path}
      type="button"
      className={activeFor(location.pathname, path) ? 'is-active' : ''}
      aria-current={activeFor(location.pathname, path) ? 'page' : undefined}
      onClick={() => navigate(path)}
    >
      <span className="android-native-nav-icon" style={{ position: 'relative' }}>
        <Icon size={22}/>
        {path === '/app/messages' && unreadMessages > 0 && <span
          aria-label={unreadMessages + ' messages non lus'}
          style={{ position: 'absolute', top: -7, right: -11, display: 'grid', placeItems: 'center', minWidth: 18, height: 18, padding: '0 4px', borderRadius: 99, border: '2px solid white', background: '#f34356', color: 'white', fontSize: 10, fontWeight: 800, lineHeight: 1 }}>
          {unreadMessages > 9 ? '9+' : unreadMessages}
        </span>}
      </span>
      <span className="android-native-nav-label">{label}</span>
    </button>)}
  </nav>;
}
