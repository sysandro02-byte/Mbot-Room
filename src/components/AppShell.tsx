import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BriefcaseBusiness,
  CalendarDays,
  CirclePlay,
  FolderOpen,
  Home,
  Plus,
  MessageCircle,
  Settings,
  Download,
  MonitorSmartphone,
  Smartphone,
  SquareArrowOutUpRight,
  UsersRound,
  X,
} from 'lucide-react';
import { authService } from '../services/authService';
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

export default function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('mboteroom-sidebar-collapsed') === '1'; }
    catch { return false; }
  });
  const user = authService.getCurrentUser();
  const guestMode = user?.isGuest === true;
  const userName = user?.name || user?.email || 'Utilisateur';
  const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'MB';

  useEffect(() => {
    const handleGlobalMenu = () => {
      if (window.matchMedia('(max-width: 1024px)').matches) {
        setMenuOpen((value) => !value);
        return;
      }
      setSidebarCollapsed((value) => {
        const next = !value;
        try { localStorage.setItem('mboteroom-sidebar-collapsed', next ? '1' : '0'); } catch { /* storage unavailable */ }
        return next;
      });
    };
    window.addEventListener('mboteroom-toggle-sidebar', handleGlobalMenu);
    return () => window.removeEventListener('mboteroom-toggle-sidebar', handleGlobalMenu);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);


  const renderNav = (items: typeof primaryNavItems, ariaLabel: string) => (
    <nav className="app-shell-nav" aria-label={ariaLabel}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to || (item.to !== '/app' && location.pathname.startsWith(item.to));
        return (
          <Link className={active ? 'is-active' : ''} to={item.to} key={item.to} onClick={() => setMenuOpen(false)}>
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''} ${guestMode ? 'is-guest-shell' : ''}`}>
      {!guestMode ? <aside className={`app-shell-sidebar ${menuOpen ? 'is-open' : ''}`}>
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

          <div className="app-shell-sidebar-profile-wrap">
            <section className="app-shell-profile app-shell-profile-static" aria-label="Compte connecté">
              <span>{user?.avatar ? <img src={user.avatar} alt="" /> : initials}</span>
              <div>
                <strong>{userName}</strong>
                <small>{user?.role === 'admin' ? 'Administrateur MBotéRoom' : user?.role === 'guest' ? 'Invité MBotéRoom' : 'Membre MBotéRoom'}</small>
              </div>
            </section>
          </div>
        </div>
      </aside> : null}

      {!guestMode && menuOpen ? <button className="app-shell-overlay" type="button" aria-label="Fermer le menu" onClick={() => setMenuOpen(false)} /> : null}

      <section className="app-shell-workspace">


        <div className="app-shell-content">{children}</div>

        {!guestMode ? <nav className="app-shell-bottom-nav" aria-label="Navigation mobile">
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
        </nav> : null}
      </section>
    </main>
  );
}
