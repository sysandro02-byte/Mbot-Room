import { ReactNode, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CirclePlay,
  Home,
  LogOut,
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
  { label: 'Tableau blanc', icon: Sparkles, to: '/app/whiteboard' },
  { label: 'Sondages', icon: BarChart3, to: '/app/polls' },
  { label: 'Paramètres', icon: Settings, to: '/app/settings' },
];

export default function AppShell({ children, title }: AppShellProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const user = authService.getCurrentUser();
  const userName = user?.name || user?.email || 'Utilisateur';

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
          <form className="app-shell-search" onSubmit={(event) => event.preventDefault()}>
            <Search size={18} aria-hidden="true" />
            <input type="search" placeholder="Rechercher une réunion ou un contact..." aria-label="Rechercher" />
          </form>
          <div className="app-shell-header-title">{title}</div>
        </header>
        <div className="app-shell-content">{children}</div>
      </section>
    </main>
  );
}
