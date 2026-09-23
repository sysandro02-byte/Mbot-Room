import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CircleHelp,
  CirclePlay,
  FolderOpen,
  Home,
  LogOut,
  ChevronDown,
  MoreVertical,
  Plus,
  UserRound,
  ShieldCheck,
  WifiOff,
  Menu,
  MessageCircle,
  Search,
  Settings,
  Download,
  MonitorSmartphone,
  Smartphone,
  SquareArrowOutUpRight,
  UsersRound,
  X,
} from 'lucide-react';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import { socket } from '../lib/socket';
import { readCachedPreferences } from '../lib/userPreferences';
import './AppShell.css';

type AppShellProps = {
  children: ReactNode;
  title?: string;
};

const primaryNavItems = [
  { label: 'Accueil', icon: Home, to: '/app' },
  { label: 'Réunions', icon: CalendarDays, to: '/app/meetings' },
  { label: 'Rejoindre', icon: SquareArrowOutUpRight, to: '/join' },
  { label: 'Calendrier', icon: CalendarDays, to: '/app/calendar' },
  { label: 'Messages', icon: MessageCircle, to: '/app/messages' },
  { label: 'Contacts', icon: UsersRound, to: '/app/contacts' },
  { label: 'Groupes', icon: BriefcaseBusiness, to: '/app/groups' },
];

const secondaryNavItems = [
  { label: 'Notifications', icon: Bell, to: '/app/notifications' },
  { label: 'Enregistrements', icon: CirclePlay, to: '/app/recordings' },
  { label: 'Fichiers', icon: FolderOpen, to: '/app/files' },
  { label: 'Paramètres', icon: Settings, to: '/app/settings' },
];

const mobileNavItems = [
  { label: 'Accueil', icon: Home, to: '/app' },
  { label: 'Réunions', icon: CalendarDays, to: '/app/meetings' },
  { label: 'Rejoindre', icon: Plus, to: '/join', primary: true },
  { label: 'Messages', icon: MessageCircle, to: '/app/messages' },
  { label: 'Paramètres', icon: Settings, to: '/app/settings' },
];

export default function AppShell({ children, title }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const sidebarProfileRef = useRef<HTMLDivElement | null>(null);
  const user = authService.getCurrentUser();
  const userName = user?.name || user?.email || 'Utilisateur';
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MB';

  useEffect(() => {
    const refreshUnread = () => void notificationService.list()
      .then((rows) => setUnreadNotifications(rows.filter((item) => !item.readAt).length))
      .catch(() => undefined);
    const feedback = () => {
      const preferences = readCachedPreferences();
      if (preferences.vibration === true && 'vibrate' in navigator) navigator.vibrate([90, 45, 90]);
      if (preferences.notificationSounds !== false) {
        try {
          const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioContextCtor) {
            const context = new AudioContextCtor();
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.frequency.value = 720;
            gain.gain.setValueAtTime(.0001, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(.08, context.currentTime + .015);
            gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .18);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start();
            oscillator.stop(context.currentTime + .2);
            oscillator.addEventListener('ended', () => void context.close());
          }
        } catch {
          // Browser audio feedback can be blocked until the user interacts with the page.
        }
      }
    };
    const onNotification = () => { refreshUnread(); feedback(); };
    refreshUnread();
    if (!socket.connected) socket.connect();
    socket.on('notification:new', onNotification);
    window.addEventListener('focus', refreshUnread);
    return () => {
      socket.off('notification:new', onNotification);
      window.removeEventListener('focus', refreshUnread);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handlePointer = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false);
      if (sidebarProfileRef.current && !sidebarProfileRef.current.contains(event.target as Node)) setSidebarProfileOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setSidebarProfileOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  const goFromProfile = (path: string) => {
    setProfileOpen(false);
    setSidebarProfileOpen(false);
    navigate(path);
  };

  const renderNav = (items: typeof primaryNavItems, ariaLabel: string) => (
    <nav className="app-shell-nav" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to || (item.to !== '/app' && location.pathname.startsWith(item.to));
        return (
          <Link className={active ? 'is-active' : ''} to={item.to} key={item.to} onClick={() => setMenuOpen(false)}>
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
            {item.to === '/app/notifications' && unreadNotifications > 0 ? <b className="app-shell-nav-badge">{Math.min(99, unreadNotifications)}</b> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <main className="app-shell">
      <aside className={`app-shell-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <button className="app-shell-close" type="button" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)}>
          <X size={22} aria-hidden="true" />
        </button>

        <Link className="app-shell-logo" to="/app" onClick={() => setMenuOpen(false)} aria-label="Accueil MBotéRoom">
          <img className="app-shell-logo-wordmark" src="/icons/mboteroom-wordmark.png" alt="MBotéRoom" />
          <small>Se réunir. Avancer. Ensemble.</small>
        </Link>

        <div className="app-shell-sidebar-main">{renderNav(primaryNavItems, 'Navigation principale')}</div>
        <div className="app-shell-sidebar-secondary">{renderNav(secondaryNavItems, 'Navigation secondaire')}</div>

        <div className="app-shell-sidebar-bottom">
          <section className="app-shell-pwa-card">
            <div className="app-shell-pwa-visual" aria-hidden="true"><MonitorSmartphone size={34}/><Smartphone size={23}/></div>
            <strong>Toujours connecté</strong>
            <p>Accédez à vos réunions depuis tous vos appareils.</p>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('mboteroom-install-request'))}><Download size={15}/> Installer l’application</button>
          </section>

          <div className="app-shell-sidebar-profile-wrap" ref={sidebarProfileRef}>
            <section className="app-shell-profile">
              <span>{user?.avatar ? <img src={user.avatar} alt="" /> : initials}</span>
              <div>
                <strong>{userName}</strong>
                <small>{user?.role === 'admin' ? 'Administrateur MBotéRoom' : user?.role === 'guest' ? 'Invité MBotéRoom' : 'Membre MBotéRoom'}</small>
              </div>
              <button type="button" aria-label="Options du profil" aria-expanded={sidebarProfileOpen} onClick={() => setSidebarProfileOpen((value) => !value)}>
                <MoreVertical size={18} aria-hidden="true" />
              </button>
            </section>
            {sidebarProfileOpen ? <div className="app-shell-sidebar-profile-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => goFromProfile('/app/profile')}><UserRound size={16}/> Mon profil</button>
              <button type="button" role="menuitem" onClick={() => goFromProfile('/app/settings')}><Settings size={16}/> Paramètres</button>
              <button className="is-danger" type="button" role="menuitem" onClick={() => void authService.logout()}><LogOut size={16}/> Se déconnecter</button>
            </div> : null}
          </div>
        </div>
      </aside>

      {menuOpen ? <button className="app-shell-overlay" type="button" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} /> : null}

      <section className="app-shell-workspace">
        <header className="app-shell-header">
          <button className="app-shell-menu-button" type="button" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(true)}>
            <Menu size={23} aria-hidden="true" />
          </button>

          <Link className="app-shell-mobile-brand" to="/app" aria-label="Accueil MBotéRoom">
            <img src="/icons/mboteroom-wordmark.png" alt="MBotéRoom" />
          </Link>

          <form className="app-shell-search" onSubmit={(event) => {
            event.preventDefault();
            const query = searchTerm.trim();
            if (query) navigate(`/app/search?q=${encodeURIComponent(query)}`);
          }}>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Rechercher une réunion, un contact ou un fichier..."
              aria-label="Rechercher"
            />
            <span className="app-shell-search-shortcut" aria-hidden="true">Ctrl K</span>
          </form>

          <div className="app-shell-header-actions">
            {title && location.pathname !== '/app' ? <span className="app-shell-header-title">{title}</span> : null}
            <button className="app-shell-header-icon" type="button" aria-label="Notifications" onClick={() => navigate('/app/notifications')}>
              <Bell size={20}/>
              {unreadNotifications > 0 ? <b>{Math.min(99, unreadNotifications)}</b> : null}
            </button>
            <button className="app-shell-header-icon app-shell-help-button" type="button" aria-label="Aide" onClick={() => navigate('/aide')}>
              <CircleHelp size={20}/>
            </button>

            <div className="app-shell-profile-menu" ref={profileMenuRef}>
              <button
                className="app-shell-header-avatar"
                type="button"
                aria-label="Ouvrir le menu du profil"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((current) => !current)}
              >
                <span className="app-shell-header-avatar-image">
                  {user?.avatar ? <img src={user.avatar} alt="" /> : <b>{initials}</b>}
                  <i className={online ? 'is-online' : 'is-offline'} aria-hidden="true" />
                </span>
                <span className="app-shell-header-user">
                  <strong>{userName}</strong>
                  <small>{online ? 'En ligne' : 'Mode hors ligne'}</small>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>

              {profileOpen ? (
                <div className="app-shell-profile-dropdown" role="menu">
                  <div className="app-shell-profile-dropdown-head">
                    <span>{user?.avatar ? <img src={user.avatar} alt="" /> : initials}</span>
                    <div><strong>{userName}</strong><small>{user?.email}</small></div>
                  </div>
                  {!online ? <div className="app-shell-offline-status"><WifiOff size={15}/><span>Vos données déjà chargées restent disponibles. La synchronisation reprendra automatiquement.</span></div> : null}
                  <button type="button" role="menuitem" onClick={() => goFromProfile('/app/profile')}><UserRound size={17}/><span><strong>Mon profil</strong><small>Identité, avatar et organisation</small></span></button>
                  <button type="button" role="menuitem" onClick={() => goFromProfile('/app/notifications')}><Bell size={17}/><span><strong>Notifications</strong><small>Alertes et activité</small></span></button>
                  <button type="button" role="menuitem" onClick={() => goFromProfile('/app/settings')}><Settings size={17}/><span><strong>Paramètres</strong><small>Appareil, application et préférences</small></span></button>
                  <button type="button" role="menuitem" onClick={() => goFromProfile('/securite')}><ShieldCheck size={17}/><span><strong>Sécurité</strong><small>Code de sécurité et protection du compte</small></span></button>
                  <div className="app-shell-profile-dropdown-brand">MBotéRoom · créée par <b>LoukaTech</b></div>
                  <button className="is-danger" type="button" role="menuitem" onClick={() => void authService.logout()}><LogOut size={17}/><span><strong>Se déconnecter</strong></span></button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="app-shell-content">{children}</div>

        <nav className="app-shell-bottom-nav" aria-label="Navigation mobile">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to || (item.to !== '/app' && location.pathname.startsWith(item.to));
            return (
              <Link className={`${active ? 'is-active' : ''} ${item.primary ? 'is-primary' : ''}`.trim()} to={item.to} key={item.to}>
                <span><Icon size={item.primary ? 24 : 21} aria-hidden="true" /></span>
                <small>{item.label}</small>
              </Link>
            );
          })}
        </nav>
      </section>
    </main>
  );
}
