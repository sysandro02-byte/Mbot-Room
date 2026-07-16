import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { DashboardTip, getMeetingAccessCode, getMeetingJoinUrl, Meeting, meetingService } from '../../services/meetingService';
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

type DashboardNotification = {
  id: string;
  title: string;
  body: string;
  meetingId: number;
};

const DAY_MS = 86_400_000;
const tipStorageKey = 'mboteroom.dashboard.tip.dismissed';
const messageCountStorageKey = 'mboteroom.dashboard.messages.unread';
const readNotificationsStorageKey = 'mboteroom.dashboard.notifications.read';
const fallbackDashboardTip: DashboardTip = {
  id: 'fallback-whiteboard',
  title: 'Astuce du jour',
  body: 'Utilisez le tableau blanc pour collaborer visuellement avec votre équipe en temps réel.',
  actionLabel: 'Essayer maintenant',
  actionPath: '/app/whiteboard',
  isActive: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const loadReadNotifications = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(readNotificationsStorageKey) || '[]');
    return Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};

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

const getGreeting = () => (new Date().getHours() >= 18 ? 'Bonsoir' : 'Bonjour');

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

const isUserMeeting = (meeting: Meeting, user: ReturnType<typeof authService.getCurrentUser>) => {
  const userId = Number(user?.id);
  const userEmail = String(user?.email || '').toLowerCase();
  const participants = (meeting.settings?.participants || []).map((participant) => participant.toLowerCase());
  return (
    (Number.isFinite(userId) && (meeting.host_id === userId || meeting.co_host_id === userId))
    || (userEmail.length > 0 && participants.includes(userEmail))
    || meeting.is_active
  );
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
  const [searchOpen, setSearchOpen] = useState(false);
  const [meetingTab, setMeetingTab] = useState<MeetingTab>('today');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>(loadReadNotifications);
  const [activeMeetingMenu, setActiveMeetingMenu] = useState<number | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [calendarMeetingDate, setCalendarMeetingDate] = useState<Date | null>(null);
  const [scheduleDate, setScheduleDate] = useState<Date | null>(null);
  const [scheduleTitle, setScheduleTitle] = useState('Nouvelle réunion');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDuration, setScheduleDuration] = useState(60);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [messageCount, setMessageCount] = useState(() => {
    const stored = Number(localStorage.getItem(messageCountStorageKey) || 0);
    return Number.isFinite(stored) ? Math.max(0, Math.min(99, stored)) : 0;
  });
  const [toast, setToast] = useState('');
  const [tipVisible, setTipVisible] = useState(() => localStorage.getItem(tipStorageKey) !== new Date().toDateString());
  const [dashboardTips, setDashboardTips] = useState<DashboardTip[]>([fallbackDashboardTip]);
  const [activeTipIndex, setActiveTipIndex] = useState(0);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const calendarClickTimerRef = useRef<number | null>(null);

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
    let cancelled = false;
    const loadDashboardTips = async () => {
      const tips = await meetingService.getDashboardTips().catch(() => []);
      if (!cancelled) {
        setDashboardTips(tips.length ? tips : [fallbackDashboardTip]);
        setActiveTipIndex(0);
      }
    };
    void loadDashboardTips();
    const refreshTips = () => void loadDashboardTips();
    socket.on('dashboard:tips-updated', refreshTips);
    return () => {
      cancelled = true;
      socket.off('dashboard:tips-updated', refreshTips);
    };
  }, []);

  useEffect(() => {
    if (dashboardTips.length <= 1) return undefined;
    const timer = window.setInterval(() => {
      setActiveTipIndex((index) => (index + 1) % dashboardTips.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [dashboardTips.length]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 260);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) setProfileMenuOpen(false);
      if (createMenuRef.current && !createMenuRef.current.contains(target)) setCreateMenuOpen(false);
      if (notificationRef.current && !notificationRef.current.contains(target)) setNotificationPanelOpen(false);
      if (helpMenuRef.current && !helpMenuRef.current.contains(target)) setHelpMenuOpen(false);
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
    const handleNewMessage = () => {
      setMessageCount((count) => Math.min(99, count + 1));
      setToast('Nouveau message reçu.');
    };
    socket.on('notification:new', () => setToast('Nouvelle notification reçue.'));
    socket.on('message:new', handleNewMessage);
    socket.on('calendar:event-updated', refresh);
    return () => {
      socket.off('meeting:created', refresh);
      socket.off('meeting:updated', refresh);
      socket.off('meeting:cancelled', refresh);
      socket.off('meeting:started', refresh);
      socket.off('notification:new');
      socket.off('message:new', handleNewMessage);
      socket.off('calendar:event-updated', refresh);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(messageCountStorageKey, String(messageCount));
  }, [messageCount]);

  useEffect(() => {
    localStorage.setItem(readNotificationsStorageKey, JSON.stringify(readNotifications));
  }, [readNotifications]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setNotificationPanelOpen(false);
        setHelpMenuOpen(false);
        setCreateMenuOpen(false);
        setProfileMenuOpen(false);
        setShortcutsOpen(false);
        setSidebarOpen(false);
        setCalendarMeetingDate(null);
        setScheduleDate(null);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.dashboard-search input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => () => {
    if (calendarClickTimerRef.current) window.clearTimeout(calendarClickTimerRef.current);
  }, []);

  const now = Date.now();
  const userMeetings = useMemo(() => meetings.filter((meeting) => isUserMeeting(meeting, currentUser)), [meetings, currentUser]);
  const upcomingMeetings = useMemo(() => meetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()), [meetings, now]);

  const recentMeetings = useMemo(() => userMeetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 <= now || meeting.is_active)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
    .slice(0, 3), [userMeetings, now]);

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

  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];
    const normalized = debouncedSearch.replace(/\s+/g, '');
    return meetings.filter((meeting) => (
      meeting.title.toLowerCase().includes(debouncedSearch)
      || meeting.host_name.toLowerCase().includes(debouncedSearch)
      || getMeetingAccessCode(meeting).toLowerCase().includes(normalized)
      || String(meeting.id).includes(normalized)
    )).slice(0, 6);
  }, [debouncedSearch, meetings]);

  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth, userMeetings), [calendarMonth, userMeetings]);
  const calendarMeetingsForSelectedDate = useMemo(() => {
    if (!calendarMeetingDate) return [];
    return userMeetings
      .filter((meeting) => sameDay(new Date(meeting.start_time), calendarMeetingDate))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [calendarMeetingDate, userMeetings]);
  const notifications = useMemo<DashboardNotification[]>(() => upcomingMeetings.slice(0, 5).map((meeting) => ({
    id: `meeting-${meeting.id}`,
    title: 'Réunion à venir',
    body: `${meeting.title} · ${formatTime(meeting.start_time)}`,
    meetingId: meeting.id,
  })), [upcomingMeetings]);
  const notificationCount = notifications.filter((notification) => !readNotifications.includes(notification.id)).length;
  const secureLabel = meetings.some((meeting) => meeting.settings?.encryption === false)
    ? 'Vos réunions utilisent les protections activées par chaque hôte.'
    : 'Vos réunions sont protégées selon la configuration de sécurité active.';
  const activeTip = dashboardTips[activeTipIndex % Math.max(1, dashboardTips.length)] || fallbackDashboardTip;

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

  const openCalendarMeetings = (date: Date) => {
    if (calendarClickTimerRef.current) window.clearTimeout(calendarClickTimerRef.current);
    calendarClickTimerRef.current = window.setTimeout(() => {
      setSelectedDate(date);
      setCalendarMeetingDate(date);
      calendarClickTimerRef.current = null;
    }, 220);
  };

  const openScheduleModal = (date: Date) => {
    if (calendarClickTimerRef.current) {
      window.clearTimeout(calendarClickTimerRef.current);
      calendarClickTimerRef.current = null;
    }
    setSelectedDate(date);
    setScheduleDate(date);
    setScheduleTitle('Nouvelle réunion');
    setScheduleTime('09:00');
    setScheduleDuration(60);
  };

  const submitScheduleFromCalendar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!scheduleDate || isScheduling) return;
    const [hours, minutes] = scheduleTime.split(':').map(Number);
    const startDate = new Date(scheduleDate);
    startDate.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    setIsScheduling(true);
    try {
      const meeting = await meetingService.scheduleMeeting({
        title: scheduleTitle.trim() || 'Nouvelle réunion',
        description: 'Réunion programmée depuis le calendrier MBotéRoom.',
        startTime: startDate.toISOString(),
        duration: scheduleDuration,
        settings: {
          waitingRoom: true,
          participantAudio: true,
          participantVideo: true,
          screenShare: true,
          encryption: true,
          chat: true,
          reactions: true,
          linkSharing: true,
        },
      });
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
      setScheduleDate(null);
      setToast('Réunion programmée.');
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Programmation impossible.');
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <main className="user-dashboard">
      <DashboardSidebar
        user={currentUser}
        messageCount={messageCount}
        open={sidebarOpen}
        onMessagesOpened={() => setMessageCount(0)}
        onClose={() => setSidebarOpen(false)}
        onLogout={() => void authService.logout()}
      />
      {sidebarOpen && <button className="dashboard-sidebar-overlay" type="button" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}

      <section className="dashboard-workspace">
        <header className="dashboard-topbar">
          <button className="dashboard-mobile-menu" type="button" aria-label={sidebarOpen ? 'Fermer le menu' : 'Ouvrir le menu'} aria-controls="dashboard-sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>
            {sidebarOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
          </button>
          <form className="dashboard-search" onSubmit={submitSearch}>
            <Search size={19} aria-hidden="true" />
            <input
              type="search"
              value={searchTerm}
              placeholder="Rechercher une réunion ou un contact..."
              aria-label="Rechercher une réunion ou un contact"
              aria-expanded={searchOpen}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSearchOpen(true);
              }}
            />
            {searchOpen && debouncedSearch && (
              <div className="dashboard-search-results" role="listbox">
                <strong>Réunions</strong>
                {searchResults.length ? searchResults.map((meeting) => (
                  <button key={meeting.id} type="button" role="option" onClick={() => {
                    setSearchOpen(false);
                    navigate(`/reunions/${meeting.id}`, { state: { meeting } });
                  }}>
                    <span>{meeting.title}</span>
                    <small>{formatMeetingId(meeting)} · {meeting.host_name}</small>
                  </button>
                )) : <p>Aucun résultat.</p>}
              </div>
            )}
          </form>
          <nav className="dashboard-topbar-actions" aria-label="Actions du tableau de bord">
            <div className="dashboard-panel-menu" ref={notificationRef}>
              <button className="dashboard-icon-button" type="button" aria-label={`${notificationCount} notifications`} aria-expanded={notificationPanelOpen} onClick={() => {
                setHelpMenuOpen(false);
                setCreateMenuOpen(false);
                setSearchOpen(false);
                setNotificationPanelOpen((value) => !value);
              }}>
                <Bell size={22} aria-hidden="true" />
                {notificationCount > 0 && <span>{notificationCount}</span>}
              </button>
              {notificationPanelOpen && (
                <div className="dashboard-notification-panel">
                  <header>
                    <strong>Notifications</strong>
                    <button type="button" onClick={() => setReadNotifications(notifications.map((notification) => notification.id))}>Tout marquer comme lu</button>
                  </header>
                  {notifications.length ? notifications.map((notification) => (
                    <button type="button" key={notification.id} className={readNotifications.includes(notification.id) ? '' : 'is-unread'} onClick={() => {
                      setReadNotifications((current) => [...new Set([...current, notification.id])]);
                      setNotificationPanelOpen(false);
                      navigate(`/reunions/${notification.meetingId}`);
                    }}>
                      <strong>{notification.title}</strong>
                      <small>{notification.body}</small>
                    </button>
                  )) : <p>Aucune notification.</p>}
                </div>
              )}
            </div>
            <div className="dashboard-panel-menu" ref={helpMenuRef}>
              <button className="dashboard-icon-button" type="button" aria-label="Centre d'aide" aria-expanded={helpMenuOpen} onClick={() => {
                setNotificationPanelOpen(false);
                setCreateMenuOpen(false);
                setSearchOpen(false);
                setHelpMenuOpen((value) => !value);
              }}>
                <CircleHelp size={23} aria-hidden="true" />
              </button>
              {helpMenuOpen && (
                <div className="dashboard-help-menu">
                  <button type="button" onClick={() => navigate('/aide')}>Centre d’aide</button>
                  <button type="button" onClick={() => { setHelpMenuOpen(false); setShortcutsOpen(true); }}>Tutoriel et raccourcis</button>
                  <button type="button" onClick={() => navigate('/aide?section=report')}>Signaler un problème</button>
                </div>
              )}
            </div>
            <div className="dashboard-create-menu" ref={createMenuRef}>
              <button className="dashboard-create-button" type="button" aria-label="Créer une réunion" aria-expanded={createMenuOpen} onClick={() => {
                setNotificationPanelOpen(false);
                setHelpMenuOpen(false);
                setSearchOpen(false);
                setCreateMenuOpen((value) => !value);
              }} disabled={isCreating}>
                <Plus size={21} aria-hidden="true" />
                {isCreating ? 'Création...' : 'Créer une réunion'}
                <ChevronDown size={17} aria-hidden="true" />
              </button>
              {createMenuOpen && (
                <div className="dashboard-create-dropdown">
                  <button type="button" onClick={() => void startInstantMeeting()}><Video size={18} />Démarrer maintenant</button>
                  <button type="button" onClick={() => navigate('/app/meetings')}><CalendarDays size={18} />Programmer une réunion</button>
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
                  <Link to="/app/profile">Mon profil</Link>
                  <Link to="/app/settings">Préférences</Link>
                  <button type="button" onClick={() => void authService.logout()}>Déconnexion</button>
                </div>
              )}
            </div>
          </nav>
        </header>
        <div className="dashboard-content">
          <section className="dashboard-main-column">
            <header className="dashboard-welcome">
              <h1>{getGreeting()}, {getFirstName(currentUser?.name || currentUser?.email)} ! <span aria-hidden="true">👋</span></h1>
              <p>{upcomingMeetings.length ? `${upcomingMeetings.length} réunion${upcomingMeetings.length > 1 ? 's' : ''} à venir` : 'Aucune réunion à venir'} · {notificationCount ? `${notificationCount} notification${notificationCount > 1 ? 's' : ''} non lue${notificationCount > 1 ? 's' : ''}` : 'Vous êtes à jour'}.</p>
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
                  <strong>{activeTip.title}</strong>
                  <p>{activeTip.body}</p>
                </div>
                <button className="dashboard-tip-action" type="button" onClick={() => navigate(activeTip.actionPath || '/app')}>{activeTip.actionLabel}</button>
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
                <button type="button" onClick={() => navigate('/app/calendar')}>Voir le calendrier</button>
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
                    aria-label={`${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(cell.date)}. Cliquez pour voir les réunions, double-cliquez pour programmer.`}
                    onClick={() => openCalendarMeetings(cell.date)}
                    onDoubleClick={() => openScheduleModal(cell.date)}
                  >
                    {cell.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="dashboard-card dashboard-recents">
              <header className="dashboard-card-header">
                <h2>Réunions récentes</h2>
                <button type="button" onClick={() => navigate('/app/recordings')}>Voir tout</button>
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

      {shortcutsOpen && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setShortcutsOpen(false)}>
          <section className="dashboard-shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="keyboard-shortcuts-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="keyboard-shortcuts-title">Raccourcis clavier</h2>
              <button type="button" aria-label="Fermer" onClick={() => setShortcutsOpen(false)}><X size={20} /></button>
            </header>
            <ul>
              <li><kbd>Entrée</kbd><span>Ouvrir le premier résultat de recherche</span></li>
              <li><kbd>Échap</kbd><span>Fermer ce panneau</span></li>
            </ul>
          </section>
        </div>
      )}

      {calendarMeetingDate && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setCalendarMeetingDate(null)}>
          <section className="dashboard-day-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-day-modal-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="dashboard-day-modal-title">Réunions programmées</h2>
                <p>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(calendarMeetingDate)}</p>
              </div>
              <button type="button" aria-label="Fermer" onClick={() => setCalendarMeetingDate(null)}><X size={20} /></button>
            </header>
            {calendarMeetingsForSelectedDate.length ? (
              <div className="dashboard-day-meetings">
                {calendarMeetingsForSelectedDate.map((meeting) => (
                  <article key={meeting.id}>
                    <time>{formatTime(meeting.start_time)}</time>
                    <div>
                      <strong>{meeting.title}</strong>
                      <small>ID: {formatMeetingId(meeting)} · {formatDuration(meeting.duration)}</small>
                    </div>
                    <button type="button" onClick={() => navigate(`/reunions/${meeting.id}`, { state: { meeting } })}>Ouvrir</button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="dashboard-empty">Aucune réunion programmée pour cette date.</p>
            )}
          </section>
        </div>
      )}

      {scheduleDate && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setScheduleDate(null)}>
          <form className="dashboard-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="dashboard-schedule-modal-title" onSubmit={submitScheduleFromCalendar} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id="dashboard-schedule-modal-title">Programmer une réunion</h2>
                <p>{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(scheduleDate)}</p>
              </div>
              <button type="button" aria-label="Fermer" onClick={() => setScheduleDate(null)}><X size={20} /></button>
            </header>
            <label>
              <span>Titre</span>
              <input value={scheduleTitle} onChange={(event) => setScheduleTitle(event.target.value)} required maxLength={160} />
            </label>
            <div className="dashboard-schedule-fields">
              <label>
                <span>Heure</span>
                <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} required />
              </label>
              <label>
                <span>Durée</span>
                <select value={scheduleDuration} onChange={(event) => setScheduleDuration(Number(event.target.value))}>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 heure</option>
                  <option value={90}>1 h 30</option>
                  <option value={120}>2 heures</option>
                </select>
              </label>
            </div>
            <button className="dashboard-schedule-submit" type="submit" disabled={isScheduling}>
              {isScheduling ? 'Programmation...' : 'Programmer la réunion'}
            </button>
          </form>
        </div>
      )}

      {toast && <div className="dashboard-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

function DashboardSidebar({
  user,
  messageCount,
  open,
  onMessagesOpened,
  onClose,
  onLogout,
}: {
  user: ReturnType<typeof authService.getCurrentUser>;
  messageCount: number;
  open: boolean;
  onMessagesOpened: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const location = useLocation();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const isAdmin = user?.role === 'admin';

  const navItems = [
    { label: 'Accueil', icon: <Home size={21} />, to: '/app' },
    { label: 'Réunions', icon: <CalendarDays size={21} />, to: '/app/meetings' },
    { label: 'Rejoindre', icon: <SquareArrowOutUpRight size={21} />, to: '/join' },
    { label: 'Calendrier', icon: <CalendarDays size={21} />, to: '/app/calendar' },
    { label: 'Enregistrements', icon: <CirclePlay size={21} />, to: '/app/recordings' },
    { label: 'Messages', icon: <MessageCircle size={21} />, to: '/app/messages', badge: messageCount },
    { label: 'Contacts', icon: <UsersRound size={21} />, to: '/app/contacts' },
    { label: 'Tableau blanc', icon: <Sparkles size={21} />, to: '/app/whiteboard' },
    { label: 'Sondages', icon: <BarChart3 size={21} />, to: '/app/polls' },
    { label: 'Paramètres', icon: <Settings size={21} />, to: '/app/settings' },
  ];

  const isActiveRoute = (path: string) => location.pathname === path
    || (path !== '/app' && location.pathname.startsWith(`${path}/`));

  return (
    <aside className={`dashboard-sidebar ${open ? 'is-open' : ''}`} id="dashboard-sidebar" aria-label="Menu principal">
      <button className="dashboard-sidebar-close" type="button" aria-label="Fermer le menu" onClick={onClose}><X size={22} /></button>
      <Link className="dashboard-logo" to="/app" onClick={onClose}>
        <span><UsersRound size={29} /><Video size={14} /></span>
        <strong>MBoté<span>Room</span><small>Réunions sécurisées</small></strong>
      </Link>
      <nav className="dashboard-sidebar-nav" aria-label="Navigation principale">
        {navItems.map((item) => (
          <Link
            className={isActiveRoute(item.to) ? 'is-active' : ''}
            to={item.to}
            key={item.label}
            aria-current={isActiveRoute(item.to) ? 'page' : undefined}
            onClick={() => {
              if (item.to === '/app/messages') onMessagesOpened();
              onClose();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            {Boolean(item.badge) && <b aria-label={`${item.badge} nouveaux messages`}>{item.badge}</b>}
          </Link>
        ))}
      </nav>
      <section className="dashboard-premium">
        <Crown size={24} aria-hidden="true" />
        <strong>{isAdmin ? 'Console administrateur' : 'Passez au Premium'}</strong>
        <p>{isAdmin ? 'Gérez les utilisateurs, réunions et paramètres de la plateforme.' : 'Plus de fonctionnalités, enregistrements cloud et stockage illimité.'}</p>
        <Link to={isAdmin ? '/admin' : '/fonctionnalites'} onClick={onClose}>{isAdmin ? 'Administrer' : 'Découvrir'}</Link>
      </section>
      <section className="dashboard-sidebar-profile">
        <Link className="dashboard-sidebar-profile-main" to="/app/profile" onClick={onClose} aria-label="Ouvrir mon profil">
          <Avatar name={user?.name || user?.email} image={user?.avatar} size="medium" />
          <div>
            <strong>{user?.name || 'Utilisateur'}</strong>
            <small>{user?.email || 'Compte MBotéRoom'}</small>
            <span className={isOnline ? 'is-online' : 'is-offline'}>{isOnline ? 'En ligne' : 'Hors ligne'}</span>
          </div>
        </Link>
        <button type="button" aria-label="Déconnexion" title="Déconnexion" onClick={onLogout}><LogOut size={18} /></button>
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
