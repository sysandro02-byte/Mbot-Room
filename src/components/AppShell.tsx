import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CalendarDays,
  CirclePlay,
  Home,
  LogOut,
  ChevronDown,
  UserRound,
  ShieldCheck,
  WifiOff,
  Menu,
  MessageCircle,
  Search,
  Settings,
  Sparkles,
  SquareArrowOutUpRight,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { authService } from '../services/authService';
import './AppShell.css';

type AppShellProps = {
  children: ReactNode;
  title?: string;
};

const navItems = [
  { label: 'Accueil', icon: Home, to: '/app' },
  { label: 'Réunions', icon: CalendarDays, to: '/app/meetings' },
  { label: 'Rejoindre', icon: SquareArrowOutUpRight, to: '/join' },
  { label: 'Calendrier', icon: CalendarDays, to: '/app/calendar' },
  { label: 'Enregistrements', icon: CirclePlay, to: '/app/recordings' },
  { label: 'Messages', icon: MessageCircle, to: '/app/messages' },
  { label: 'Contacts', icon: UsersRound, to: '/app/contacts' },
  { label: 'Notifications', icon: Bell, to: '/app/notifications' },
  { label: 'Tableau blanc', icon: Sparkles, to: '/app/whiteboard' },
  { label: 'Sondages', icon: BarChart3, to: '/app/polls' },
  { label: 'Paramètres', icon: Settings, to: '/app/settings' },
];

const mobileNavItems = [
  { label: 'Accueil', icon: Home, to: '/app' },
  { label: 'Réunions', icon: CalendarDays, to: '/app/meetings' },
  { label: 'Rejoindre', icon: SquareArrowOutUpRight, to: '/join', primary: true },
  { label: 'Messages', icon: MessageCircle, to: '/app/messages' },
  { label: 'Alertes', icon: Bell, to: '/app/notifications' },
];

export default function AppShell({ children, title }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const user = authService.getCurrentUser();
  const userName = user?.name || user?.email || 'Utilisateur';
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MB';

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handlePointer = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setProfileOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileOpen(false);
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
    navigate(path);
  };

  return (
    <main className="app-shell">
      <aside className={`app-shell-sidebar ${menuOpen ? 'is-open' : ''}`}>
        <button className="app-shell-close" type="button" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)}>
          <X size={22} aria-hidden="true" />
        </button>
        <Link className="app-shell-logo" to="/app" onClick={() => setMenuOpen(false)}>
          <span><UsersRound size={28} /><Video size={13} /></span>
          <strong>MBoté<span>Room</span><small>Réunions sécurisées</small></strong>
        </Link>
        <nav className="app-shell-nav" aria-label="Navigation principale">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = location.pathname === item.to || (item.to !== '/app' && location.pathname.startsWith(item.to));
            return (
              <Link className={active ? 'is-active' : ''} to={item.to} key={item.to} onClick={() => setMenuOpen(false)}>
                <Icon size={21} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="app-shell-creator">MBotéRoom · créée par <strong>LoukaTech</strong></div>
        <section className="app-shell-profile">
          <b>{userName.slice(0, 2).toUpperCase()}</b>
          <div>
            <strong>{userName}</strong>
            <small>En ligne</small>
          </div>
          <button type="button" aria-label="Déconnexion" onClick={() => void authService.logout()}>
            <LogOut size={18} aria-hidden="true" />
          </button>
        </section>
      </aside>
      {menuOpen && <button className="app-shell-overlay" type="button" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} />}
      <section className="app-shell-workspace">
        <header className="app-shell-header">
          <button className="app-shell-menu-button" type="button" aria-label="Ouvrir le menu" onClick={() => setMenuOpen(true)}>
            <Menu size={24} aria-hidden="true" />
          </button>
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
              placeholder="Rechercher une réunion ou un contact..."
              aria-label="Rechercher"
            />
          </form>
          <div className="app-shell-header-actions">
            <div className="app-shell-header-title">{title}</div>
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
