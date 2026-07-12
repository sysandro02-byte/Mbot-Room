import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CirclePlay,
  Crown,
  Home,
  LogOut,
  Menu,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { socket } from '../../lib/socket';
import { authService } from '../../services/authService';
import { getMeetingAccessCode, getMeetingJoinUrl, Meeting, meetingService } from '../../services/meetingService';
import './UserDashboardPage.css';

type MeetingTab = 'today' | 'tomorrow' | 'week';
type ShortcutVariant = 'purple' | 'blue' | 'green' | 'orange';

type DashboardShortcut = {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  variant: ShortcutVariant;
  action: () => void;
};

type CalendarCell = {
  key: string;
  date: Date;
  label: number;
  currentMonth: boolean;
  hasMeeting: boolean;
};

const DAY_MS = 86_400_000;
const tipStorageKey = 'mboteroom.dashboard.tip.dismissed';

const sameDay = (a: Date, b: Date) => (
  a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate()
);

const formatMeetingId = (meeting: Meeting) => getMeetingAccessCode(meeting).replace(/(.{3})/g, '$1 ').trim();

const formatTime = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const formatDuration = (minutes: number) => {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest}` : `${hours} heure${hours > 1 ? 's' : ''}`;
  }
  return `${Math.max(1, minutes)} min`;
};

const getFirstName = (nameOrEmail?: string) => {
  const fallback = nameOrEmail || 'Utilisateur';
  return fallback.split(/[ .@]/).filter(Boolean)[0] || fallback;
};

const getInitials = (nameOrEmail?: string) => {
  const value = nameOrEmail || 'MBotéRoom';
  return value
    .split(/\s+|@/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

const isMeetingInTab = (meeting: Meeting, tab: MeetingTab) => {
  const start = new Date(meeting.start_time);
  const today = new Date();
  const tomorrow = new Date(Date.now() + DAY_MS);
  if (tab === 'today') return sameDay(start, today);
  if (tab === 'tomorrow') return sameDay(start, tomorrow);
  const weekEnd = new Date(today.getTime() + 7 * DAY_MS);
  return start >= new Date(today.getFullYear(), today.getMonth(), today.getDate()) && start <= weekEnd;
};

const buildCalendarCells = (monthDate: Date, meetings: Meeting[]): CalendarCell[] => {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startOffset);
  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      key: date.toISOString(),
      date,
      label: date.getDate(),
      currentMonth: date.getMonth() === monthDate.getMonth(),
      hasMeeting: meetings.some((meeting) => sameDay(new Date(meeting.start_time), date)),
    };
  });
};

export default function UserDashboardPage() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [meetingTab, setMeetingTab] = useState<MeetingTab>('today');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [activeMeetingMenu, setActiveMeetingMenu] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [isCreating, setIsCreating] = useState(false);
  const [toast, setToast] = useState('');
  const [tipVisible, setTipVisible] = useState(() => localStorage.getItem(tipStorageKey) !== new Date().toDateString());
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  const loadMeetings = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await meetingService.getMeetings();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossible de charger le tableau de bord.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadMeetings();
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 260);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) setProfileMenuOpen(false);
      if (createMenuRef.current && !createMenuRef.current.contains(target)) setCreateMenuOpen(false);
      if (!(event.target as HTMLElement).closest('.dashboard-meeting-menu')) setActiveMeetingMenu(null);
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    if (!authService.getToken()) return undefined;
    if (!socket.connected) socket.connect();
    const refresh = () => void loadMeetings();
    socket.on('meeting:created', refresh);
    socket.on('meeting:updated', refresh);
    socket.on('meeting:cancelled', refresh);
    socket.on('meeting:started', refresh);
    socket.on('notification:new', () => setToast('Nouvelle notification reçue.'));
    socket.on('message:new', () => setToast('Nouveau message reçu.'));
    socket.on('calendar:event-updated', refresh);
    return () => {
      socket.off('meeting:created', refresh);
      socket.off('meeting:updated', refresh);
      socket.off('meeting:cancelled', refresh);
      socket.off('meeting:started', refresh);
      socket.off('notification:new');
      socket.off('message:new');
      socket.off('calendar:event-updated', refresh);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const now = Date.now();
  const upcomingMeetings = useMemo(() => meetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()), [meetings, now]);

  const recentMeetings = useMemo(() => meetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 <= now || meeting.is_active)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, 3), [meetings, now]);

  const visibleUpcomingMeetings = useMemo(() => {
    const byTab = upcomingMeetings.filter((meeting) => isMeetingInTab(meeting, meetingTab));
    if (!debouncedSearch) return byTab.slice(0, 5);
    const normalized = debouncedSearch.replace(/\s+/g, '');
    return byTab.filter((meeting) => (
      meeting.title.toLowerCase().includes(debouncedSearch)
      || meeting.host_name.toLowerCase().includes(debouncedSearch)
      || getMeetingAccessCode(meeting).toLowerCase().includes(normalized)
      || String(meeting.id).includes(normalized)
    )).slice(0, 8);
  }, [debouncedSearch, meetingTab, upcomingMeetings]);

  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth, meetings), [calendarMonth, meetings]);
  const notificationCount = upcomingMeetings.filter((meeting) => sameDay(new Date(meeting.start_time), new Date())).length;
  const messageCount = 0;
  const secureLabel = meetings.some((meeting) => meeting.settings?.encryption === false)
    ? 'Vos réunions utilisent les protections activées par chaque hôte.'
    : 'Vos réunions sont protégées selon la configuration de sécurité active.';

  const startInstantMeeting = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const meeting = await meetingService.scheduleMeeting({
        title: 'Nouvelle réunion',
        description: 'Réunion instantanée créée depuis le tableau de bord MBotéRoom.',
        startTime: new Date().toISOString(),
        duration: 60,
        settings: {
          callType: 'video',
          waitingRoom: true,
          participantAudio: true,
          participantVideo: true,
          screenShare: true,
          encryption: true,
          chat: true,
          reactions: true,
          lunaSummary: true,
          linkSharing: true,
        },
      });
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
      navigate(`/reunions/${encodeURIComponent(String(meeting.id))}`, { state: { meeting } });
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Création de réunion impossible.');
    } finally {
      setIsCreating(false);
      setCreateMenuOpen(false);
    }
  };

  const joinMeeting = async (meeting: Meeting) => {
    const endAt = new Date(meeting.start_time).getTime() + meeting.duration * 60_000;
    if (Number.isFinite(endAt) && Date.now() > endAt && !meeting.is_active) {
      setToast('Cette réunion est terminée.');
      return;
    }
    try {
      const result = await meetingService.requestJoin(meeting.id, Number(currentUser?.id));
      const route = result.status === 'requested'
        ? `/reunions/${encodeURIComponent(String(meeting.id))}/salle-attente`
        : `/reunions/${encodeURIComponent(String(meeting.id))}`;
      navigate(route, { state: { meeting } });
    } catch {
      navigate(`/reunions/${encodeURIComponent(String(meeting.id))}`, { state: { meeting } });
    }
  };

  const copyMeetingLink = async (meeting: Meeting) => {
    await navigator.clipboard.writeText(getMeetingJoinUrl(meeting));
    setToast('Lien de réunion copié.');
    setActiveMeetingMenu(null);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (visibleUpcomingMeetings[0]) {
      void joinMeeting(visibleUpcomingMeetings[0]);
      return;
    }
    setToast(debouncedSearch ? 'Aucun résultat trouvé.' : 'Saisissez une recherche.');
  };

  const shortcuts: DashboardShortcut[] = [
    {
      id: 'new',
      title: 'Nouvelle réunion',
      description: 'Démarrer une réunion immédiatement',
      icon: <Video size={30} />,
      variant: 'purple',
      action: () => void startInstantMeeting(),
    },
    {
      id: 'join',
      title: 'Rejoindre une réunion',
      description: 'Rejoindre avec un ID ou un lien',
      icon: <Plus size={30} />,
      variant: 'blue',
      action: () => navigate('/rejoindre-une-reunion'),
    },
    {
      id: 'schedule',
      title: 'Programmer',
      description: 'Planifier une réunion pour plus tard',
      icon: <CalendarDays size={29} />,
      variant: 'green',
      action: () => navigate('/reunions'),
    },
    {
      id: 'share',
      title: 'Partager un écran',
      description: 'Partager votre écran en réunion',
      icon: <SquareArrowOutUpRight size={29} />,
      variant: 'orange',
      action: () => setToast('Ouvrez une réunion pour partager votre écran.'),
    },
  ];

  const dismissTip = () => {
    localStorage.setItem(tipStorageKey, new Date().toDateString());
    setTipVisible(false);
  };

  return (
    <main className="user-dashboard">
      <DashboardSidebar
        user={currentUser}
        messageCount={messageCount}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={() => void authService.logout()}
      />
      {sidebarOpen && <button className="dashboard-sidebar-overlay" type="button" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}

      <section className="dashboard-workspace">
        <header className="dashboard-topbar">
          <button className="dashboard-mobile-menu" type="button" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={24} aria-hidden="true" />
          </button>
          <form className="dashboard-search" onSubmit={submitSearch}>
            <Search size={19} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              placeholder="Rechercher une réunion ou un contact..."
              aria-label="Rechercher une réunion ou un contact"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </form>
          <nav className="dashboard-topbar-actions" aria-label="Actions du tableau de bord">
            <button className="dashboard-icon-button" type="button" aria-label={`${notificationCount} notifications`} onClick={() => setToast('Centre de notifications à connecter au backend.')}>
              <Bell size={22} aria-hidden="true" />
              {notificationCount > 0 && <span>{notificationCount}</span>}
            </button>
            <button className="dashboard-icon-button" type="button" aria-label="Centre d'aide" onClick={() => navigate('/aide')}>
              <CircleHelp size={23} aria-hidden="true" />
            </button>
            <div className="dashboard-create-menu" ref={createMenuRef}>
              <button className="dashboard-create-button" type="button" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen((value) => !value)} disabled={isCreating}>
                <Plus size={21} aria-hidden="true" />
                {isCreating ? 'Création...' : 'Créer une réunion'}
                <ChevronDown size={17} aria-hidden="true" />
              </button>
              {createMenuOpen && (
                <div className="dashboard-create-dropdown">
                  <button type="button" onClick={() => void startInstantMeeting()}><Video size={18} />Réunion instantanée</button>
                  <button type="button" onClick={() => navigate('/reunions')}><CalendarDays size={18} />Programmer une réunion</button>
                </div>
              )}
            </div>
            <div className="dashboard-user-menu" ref={profileMenuRef}>
              <button type="button" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((value) => !value)}>
                <Avatar name={currentUser?.name || currentUser?.email} image={currentUser?.avatar} size="small" />
                <span>{currentUser?.name || currentUser?.email}</span>
              </button>
              {profileMenuOpen && (
                <div className="dashboard-profile-dropdown">
                  <Link to="/profil">Mon profil</Link>
                  <Link to="/parametres">Paramètres</Link>
                  <button type="button" onClick={() => void authService.logout()}>Déconnexion</button>
                </div>
              )}
            </div>
          </nav>
        </header>

        <div className="dashboard-content">
          <section className="dashboard-main-column">
            <header className="dashboard-welcome">
              <h1>Bonjour, {getFirstName(currentUser?.name || currentUser?.email)} ! <span aria-hidden="true">👋</span></h1>
              <p>Voici un aperçu de vos réunions et activités.</p>
            </header>

            <section className="dashboard-shortcuts" aria-label="Raccourcis de réunion">
              {shortcuts.map((shortcut) => (
                <button className={`dashboard-shortcut dashboard-shortcut-${shortcut.variant}`} type="button" key={shortcut.id} onClick={shortcut.action}>
                  <span className="dashboard-shortcut-icon">{shortcut.icon}</span>
                  <strong>{shortcut.title}</strong>
                  <p>{shortcut.description}</p>
                  <span className="dashboard-shortcut-arrow"><ArrowRight size={18} aria-hidden="true" /></span>
                </button>
              ))}
            </section>

            <section className="dashboard-card upcoming-card">
              <header className="dashboard-card-header">
                <h2>Réunions à venir</h2>
                <button type="button" onClick={() => navigate('/reunions')}>Voir tout</button>
              </header>
              <div className="dashboard-tabs" role="tablist" aria-label="Période des réunions">
                {[
                  ['today', 'Aujourd’hui'],
                  ['tomorrow', 'Demain'],
                  ['week', 'Cette semaine'],
                ].map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={meetingTab === value} onClick={() => setMeetingTab(value as MeetingTab)}>
                    {label}
                  </button>
                ))}
              </div>
              {isLoading ? (
                <p className="dashboard-empty">Chargement des réunions...</p>
              ) : loadError ? (
                <p className="dashboard-empty" role="alert">{loadError}</p>
              ) : visibleUpcomingMeetings.length ? (
                <div className="dashboard-meetings-list">
                  {visibleUpcomingMeetings.map((meeting) => (
                    <UpcomingMeetingRow
                      key={meeting.id}
                      meeting={meeting}
                      menuOpen={activeMeetingMenu === meeting.id}
                      onJoin={() => void joinMeeting(meeting)}
                      onToggleMenu={() => setActiveMeetingMenu((value) => (value === meeting.id ? null : meeting.id))}
                      onCopy={() => void copyMeetingLink(meeting)}
                      onDetails={() => navigate(`/reunions/${meeting.id}`, { state: { meeting } })}
                    />
                  ))}
                </div>
              ) : (
                <p className="dashboard-empty">Aucune réunion trouvée pour cette période.</p>
              )}
              <button className="view-all-meetings-button" type="button" onClick={() => navigate('/reunions')}>Voir toutes mes réunions</button>
            </section>

            {tipVisible && (
              <section className="dashboard-tip-card">
                <span><Star size={25} aria-hidden="true" /></span>
                <div>
                  <strong>Astuce du jour</strong>
                  <p>Utilisez le tableau blanc pour collaborer visuellement avec votre équipe en temps réel.</p>
                </div>
                <button className="dashboard-tip-action" type="button" onClick={() => navigate('/tableau-blanc')}>Essayer maintenant</button>
                <button className="dashboard-tip-close" type="button" aria-label="Fermer l’astuce" onClick={dismissTip}><X size={19} /></button>
              </section>
            )}
          </section>

          <aside className="dashboard-right-column">
            <section className="dashboard-card dashboard-security-card">
              <div className="security-illustration" aria-hidden="true">
                <span><UsersRound size={28} /></span>
                <i><ShieldCheck size={19} /></i>
                <b><ShieldCheck size={24} /></b>
              </div>
              <div>
                <h2>Réunions sécurisées</h2>
                <p>{secureLabel}</p>
                <Link to="/securite">En savoir plus <ChevronRight size={16} /></Link>
              </div>
            </section>

            <section className="dashboard-card dashboard-calendar">
              <header className="dashboard-card-header">
                <h2>Mon calendrier</h2>
                <button type="button" onClick={() => navigate('/calendrier')}>Voir le calendrier</button>
              </header>
              <div className="calendar-month-row">
                <strong>{new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(calendarMonth)}</strong>
                <span>
                  <button type="button" aria-label="Mois précédent" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
                  <button type="button" aria-label="Mois suivant" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
                </span>
              </div>
              <div className="calendar-grid calendar-weekdays">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="calendar-grid">
                {calendarCells.map((cell) => (
                  <button
                    key={cell.key}
                    type="button"
                    className={[
                      !cell.currentMonth ? 'is-muted' : '',
                      sameDay(cell.date, selectedDate) ? 'is-selected' : '',
                      cell.hasMeeting ? 'has-meeting' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedDate(cell.date)}
                  >
                    {cell.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="dashboard-card dashboard-recents">
              <header className="dashboard-card-header">
                <h2>Réunions récentes</h2>
                <button type="button" onClick={() => navigate('/reunions/recentes')}>Voir tout</button>
              </header>
              {recentMeetings.length ? recentMeetings.map((meeting, index) => (
                <article className="recent-meeting-row" key={meeting.id}>
                  <span className={`recent-play recent-${index}`}><CirclePlay size={21} /></span>
                  <div>
                    <strong>{meeting.title}</strong>
                    <small>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(meeting.start_time))} • {formatTime(meeting.start_time)}</small>
                  </div>
                  <em>{formatDuration(meeting.duration)}</em>
                  <button type="button" aria-label={`Actions pour ${meeting.title}`} onClick={() => setToast('Actions de réunion récente à connecter.')}>
                    <MoreVertical size={19} />
                  </button>
                </article>
              )) : <p className="dashboard-empty">Aucune réunion récente.</p>}
            </section>
          </aside>
        </div>
      </section>

      {toast && <div className="dashboard-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

function DashboardSidebar({
  user,
  messageCount,
  open,
  onClose,
  onLogout,
}: {
  user: ReturnType<typeof authService.getCurrentUser>;
  messageCount: number;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const navItems = [
    { label: 'Accueil', icon: <Home size={21} />, to: '/app', active: true },
    { label: 'Réunions', icon: <CalendarDays size={21} />, to: '/reunions' },
    { label: 'Rejoindre', icon: <SquareArrowOutUpRight size={21} />, to: '/rejoindre-une-reunion' },
    { label: 'Calendrier', icon: <CalendarDays size={21} />, to: '/calendrier' },
    { label: 'Enregistrements', icon: <CirclePlay size={21} />, to: '/enregistrements' },
    { label: 'Messages', icon: <MessageCircle size={21} />, to: '/messages', badge: messageCount },
    { label: 'Contacts', icon: <UsersRound size={21} />, to: '/contacts' },
    { label: 'Tableau blanc', icon: <Sparkles size={21} />, to: '/tableau-blanc' },
    { label: 'Sondages', icon: <BarChart3 size={21} />, to: '/sondages' },
    { label: 'Paramètres', icon: <Settings size={21} />, to: '/parametres' },
  ];

  return (
    <aside className={`dashboard-sidebar ${open ? 'is-open' : ''}`}>
      <button className="dashboard-sidebar-close" type="button" aria-label="Fermer le menu" onClick={onClose}><X size={22} /></button>
      <Link className="dashboard-logo" to="/app">
        <span><UsersRound size={29} /><Video size={14} /></span>
        <strong>MBoté<span>Room</span><small>Réunions sécurisées</small></strong>
      </Link>
      <nav className="dashboard-sidebar-nav" aria-label="Navigation principale">
        {navItems.map((item) => (
          <Link className={item.active ? 'is-active' : ''} to={item.to} key={item.label}>
            {item.icon}
            <span>{item.label}</span>
            {Boolean(item.badge) && <b>{item.badge}</b>}
          </Link>
        ))}
      </nav>
      <section className="dashboard-premium">
        <Crown size={24} aria-hidden="true" />
        <strong>Passez au Premium</strong>
        <p>Plus de fonctionnalités, enregistrements cloud et stockage illimité.</p>
        <Link to="/fonctionnalites">Découvrir</Link>
      </section>
      <section className="dashboard-sidebar-profile">
        <Avatar name={user?.name || user?.email} image={user?.avatar} size="medium" />
        <div>
          <strong>{user?.name || 'Utilisateur'}</strong>
          <small>{user?.email || 'Compte MBotéRoom'}</small>
          <span>En ligne</span>
        </div>
        <button type="button" aria-label="Déconnexion" onClick={onLogout}><LogOut size={18} /></button>
      </section>
    </aside>
  );
}

function UpcomingMeetingRow({
  meeting,
  menuOpen,
  onJoin,
  onToggleMenu,
  onCopy,
  onDetails,
}: {
  meeting: Meeting;
  menuOpen: boolean;
  onJoin: () => void;
  onToggleMenu: () => void;
  onCopy: () => void;
  onDetails: () => void;
}) {
  const participantCount = Math.max(1, meeting.participant_count || 1);
  return (
    <article className="dashboard-meeting-row">
      <time>
        <strong>{formatTime(meeting.start_time)}</strong>
        <span>{formatDuration(meeting.duration)}</span>
      </time>
      <div className="meeting-row-main">
        <strong>{meeting.title}</strong>
        <small>ID: {formatMeetingId(meeting)} • Hôte : {meeting.host_name || 'Vous'}</small>
      </div>
      <div className="meeting-row-avatars" aria-label={`${participantCount} participants`}>
        {Array.from({ length: Math.min(4, participantCount) }, (_, index) => (
          <Avatar key={index} name={`${meeting.title}-${index}`} image={index === 0 ? meeting.host_avatar : ''} size="tiny" />
        ))}
        {participantCount > 4 && <span>+{participantCount - 4}</span>}
      </div>
      <button className="meeting-join-button" type="button" onClick={onJoin}>Rejoindre</button>
      <div className="dashboard-meeting-menu">
        <button type="button" aria-label={`Actions pour ${meeting.title}`} aria-expanded={menuOpen} onClick={onToggleMenu}>
          <MoreVertical size={20} />
        </button>
        {menuOpen && (
          <div>
            <button type="button" onClick={onDetails}>Voir les détails</button>
            <button type="button" onClick={onCopy}>Copier le lien</button>
            <button type="button" onClick={onDetails}>Inviter des participants</button>
          </div>
        )}
      </div>
    </article>
  );
}

function Avatar({ name, image, size }: { name?: string; image?: string; size: 'tiny' | 'small' | 'medium' }) {
  return (
    <span className={`dashboard-avatar dashboard-avatar-${size}`}>
      {image ? <img src={image} alt="" /> : <em>{getInitials(name)}</em>}
      {size !== 'tiny' && <i />}
    </span>
  );
}
