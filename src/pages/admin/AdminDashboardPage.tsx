import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getAppLocale } from '../../lib/appLanguage';
import {
  Activity,
  Ban,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  CirclePlay,
  Clock3,
  Flag,
  FileText,
  Home,
  ImageIcon,
  LogOut,
  Menu,
  MessageCircle,
  MoreVertical,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { socket } from '../../lib/socket';
import { authService } from '../../services/authService';
import {
  AdminActivity,
  AdminDashboardPayload,
  AdminDashboardStat,
  GuestAccessSlide,
  HomeSlide,
  LoginBranding,
  adminDashboardService,
} from '../../services/adminDashboardService';
import { DashboardTip, getMeetingAccessCode, Meeting } from '../../services/meetingService';
import { collaborationService } from '../../services/collaborationService';
import AdminControlCenter from './AdminControlCenter';
import './AdminDashboardPage.css';

type ActivityTone = 'green' | 'blue' | 'orange' | 'red' | 'violet';

type DashboardTipDraft = Pick<DashboardTip, 'title' | 'body' | 'actionLabel' | 'actionPath' | 'isActive'>;

type HomeSlideDraft = Omit<HomeSlide, 'slot' | 'updatedAt'>;
type LoginBrandingDraft = Pick<LoginBranding, 'wordmarkUrl' | 'illustrationUrl'>;

const defaultLoginBrandingDraft: LoginBrandingDraft = {
  wordmarkUrl: '/icons/mboteroom-wordmark.png',
  illustrationUrl: '/images/meeting-black-team.svg',
};

const defaultHomeSlideDraft = (slot: HomeSlide['slot']): HomeSlideDraft => ({
  title: slot === 1
    ? 'Réunions simples, professionnelles et sécurisées'
    : slot === 2
      ? 'Retrouvez votre équipe en quelques secondes'
      : slot === 3
        ? 'Collaborez avec Luna IA'
        : 'Des réunions plus humaines avec MBotéRoom',
  body: slot === 1
    ? 'Créez, planifiez et animez vos réunions depuis un espace pensé pour vos équipes.'
    : slot === 2
      ? 'Rejoignez une réunion par ID ou par lien, avec salle d’attente et contrôles de sécurité.'
      : slot === 3
        ? 'Retrouvez les décisions, points clés, messages et actions importantes de vos réunions.'
        : 'Collaborez, partagez, créez, où que vous soyez.',
  imageUrl: slot === 1
    ? '/images/mboteroom-home-hero.svg'
    : slot === 4
      ? '/images/mboteroom-home-banner.svg'
      : '',
  actionLabel: slot === 1
    ? 'Créer une réunion'
    : slot === 2
      ? 'Rejoindre une réunion'
      : slot === 4
        ? 'Découvrir toutes les fonctionnalités'
        : 'Découvrir mes réunions',
  actionPath: slot === 2 ? '/join' : slot === 4 ? '/fonctionnalites' : '/app/meetings',
  isActive: true,
});

const statIcons: Record<AdminDashboardStat['id'], ReactNode> = {
  users: <UsersRound size={29} />,
  meetings: <CalendarDays size={28} />,
  live: <UsersRound size={28} />,
  hours: <Clock3 size={28} />,
  recordings: <CirclePlay size={28} />,
};

const statTones: Record<AdminDashboardStat['id'], string> = {
  users: 'blue',
  meetings: 'green',
  live: 'orange',
  hours: 'blue',
  recordings: 'violet',
};

const activityIcons: Record<AdminActivity['type'], ReactNode> = {
  user: <UsersRound size={18} />,
  meeting: <CalendarDays size={18} />,
  report: <Flag size={18} />,
  ban: <Ban size={18} />,
  recording: <CirclePlay size={18} />,
};

const activityTones: Record<AdminActivity['type'], ActivityTone> = {
  user: 'green',
  meeting: 'blue',
  report: 'orange',
  ban: 'red',
  recording: 'violet',
};

const periodOptions = [
  { value: '7d', label: '7 derniers jours' },
  { value: '30d', label: '30 derniers jours' },
  { value: 'month', label: 'Mois en cours' },
];

const formatNumber = (value: number) => new Intl.NumberFormat(getAppLocale()).format(value);

const formatRelativeTime = (value: string) => {
  const date = new Date(value);
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return new Intl.DateTimeFormat(getAppLocale(), { dateStyle: 'medium' }).format(date);
};

const formatTime = (value: string) => new Intl.DateTimeFormat(getAppLocale(), {
  hour: '2-digit',
  minute: '2-digit',
}).format(new Date(value));

const getInitials = (value: string) => value
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

const buildPolylinePoints = (values: number[], width: number, height: number) => {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [period, setPeriod] = useState('30d');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dashboard, setDashboard] = useState<AdminDashboardPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeMeetingMenu, setActiveMeetingMenu] = useState<number | null>(null);
  const [dashboardTips, setDashboardTips] = useState<DashboardTip[]>([]);
  const [tipDraft, setTipDraft] = useState({
    title: 'Astuce du jour',
    body: '',
    actionLabel: 'Essayer maintenant',
    actionPath: '/app/whiteboard',
    isActive: true,
  });
  const [editingTipId, setEditingTipId] = useState<string | null>(null);
  const [isSavingTip, setIsSavingTip] = useState(false);
  const [guestSlides, setGuestSlides] = useState<GuestAccessSlide[]>([]);
  const [guestDraft, setGuestDraft] = useState({ title: 'Acc\u00e8s invit\u00e9', body: '', imageUrl: '/meeting-black-team.svg', isActive: true });
  const [editingGuestSlideId, setEditingGuestSlideId] = useState<string | null>(null);
  const [homeSlides, setHomeSlides] = useState<HomeSlide[]>([]);
  const [selectedHomeSlot, setSelectedHomeSlot] = useState<HomeSlide['slot']>(1);
  const [homeSlideDraft, setHomeSlideDraft] = useState<HomeSlideDraft>(() => defaultHomeSlideDraft(1));
  const [isSavingHomeSlide, setIsSavingHomeSlide] = useState(false);
  const [loginBrandingDraft, setLoginBrandingDraft] = useState<LoginBrandingDraft>(defaultLoginBrandingDraft);
  const [isSavingLoginBranding, setIsSavingLoginBranding] = useState(false);
  const [toast, setToast] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadDashboard = async () => {
    setIsLoading(true);
    setError('');
    try {
      const payload = await adminDashboardService.getDashboard(period);
      setDashboard(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Tableau de bord administrateur indisponible.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [period]);

  const loadDashboardTips = async () => {
    try {
      setDashboardTips(await adminDashboardService.getDashboardTips());
    } catch (tipError) {
      setToast(tipError instanceof Error ? tipError.message : 'Astuces indisponibles.');
    }
  };

  useEffect(() => {
    void loadDashboardTips();
  }, []);

  const loadManagedSlides = async () => {
    try {
      const [guestRows, homeRows, loginBranding] = await Promise.all([
        adminDashboardService.getGuestAccessSlides().catch(() => []),
        adminDashboardService.getHomeSlides(),
        adminDashboardService.getLoginBranding().catch(() => null),
      ]);
      setGuestSlides(guestRows);
      setHomeSlides(homeRows);
      if (loginBranding) {
        setLoginBrandingDraft({
          wordmarkUrl: loginBranding.wordmarkUrl,
          illustrationUrl: loginBranding.illustrationUrl,
        });
      }
      const first = homeRows.find((slide) => slide.slot === selectedHomeSlot) || homeRows.find((slide) => slide.slot === 1);
      if (first) {
        setSelectedHomeSlot(first.slot);
        setHomeSlideDraft({
          title: first.title,
          body: first.body,
          imageUrl: first.imageUrl,
          actionLabel: first.actionLabel,
          actionPath: first.actionPath,
          isActive: first.isActive,
        });
      }
    } catch (slideError) {
      setToast(slideError instanceof Error ? slideError.message : 'Slides indisponibles.');
    }
  };

  useEffect(() => {
    void loadManagedSlides();
  }, []);

  const selectHomeSlide = (slot: HomeSlide['slot']) => {
    setSelectedHomeSlot(slot);
    const slide = homeSlides.find((item) => item.slot === slot);
    setHomeSlideDraft(slide ? {
      title: slide.title,
      body: slide.body,
      imageUrl: slide.imageUrl,
      actionLabel: slide.actionLabel,
      actionPath: slide.actionPath,
      isActive: slide.isActive,
    } : defaultHomeSlideDraft(slot));
  };

  const saveHomeSlide = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingHomeSlide(true);
    try {
      await adminDashboardService.saveHomeSlide(selectedHomeSlot, homeSlideDraft);
      const rows = await adminDashboardService.getHomeSlides();
      setHomeSlides(rows);
      const saved = rows.find((item) => item.slot === selectedHomeSlot);
      if (saved) setHomeSlideDraft({
        title: saved.title,
        body: saved.body,
        imageUrl: saved.imageUrl,
        actionLabel: saved.actionLabel,
        actionPath: saved.actionPath,
        isActive: saved.isActive,
      });
      setToast(selectedHomeSlot === 4 ? 'Bannière de l’accueil mise à jour.' : `Slide ${selectedHomeSlot} de l’accueil mis à jour.`);
    } catch (slideError) {
      setToast(slideError instanceof Error ? slideError.message : 'Enregistrement du slide impossible.');
    } finally {
      setIsSavingHomeSlide(false);
    }
  };

  const saveLoginBranding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingLoginBranding(true);
    try {
      const saved = await adminDashboardService.saveLoginBranding(loginBrandingDraft);
      setLoginBrandingDraft({ wordmarkUrl: saved.wordmarkUrl, illustrationUrl: saved.illustrationUrl });
      setToast('Les images de la page de connexion ont été mises à jour.');
    } catch (brandingError) {
      setToast(brandingError instanceof Error ? brandingError.message : 'Mise à jour des images de connexion impossible.');
    } finally {
      setIsSavingLoginBranding(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(searchTerm.trim().toLowerCase()), 280);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  useEffect(() => {
    if (!debouncedSearch) return undefined;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void adminDashboardService.search(debouncedSearch).catch(() => undefined);
    return () => controller.abort();
  }, [debouncedSearch]);

  useEffect(() => {
    const legacyToken = authService.getToken();
    socket.auth = legacyToken ? { token: legacyToken } : {};
    if (!socket.connected) socket.connect();
    const refresh = () => void loadDashboard();
    socket.on('meeting:created', refresh);
    socket.on('meeting:updated', refresh);
    socket.on('meeting:started', refresh);
    socket.on('meeting:cancelled', refresh);
    socket.on('admin:stats-updated', refresh);
    socket.on('admin:report-created', refresh);
    socket.on('admin:user-banned', refresh);
    socket.on('admin:recording-completed', refresh);
    return () => {
      socket.off('meeting:created', refresh);
      socket.off('meeting:updated', refresh);
      socket.off('meeting:started', refresh);
      socket.off('meeting:cancelled', refresh);
      socket.off('admin:stats-updated', refresh);
      socket.off('admin:report-created', refresh);
      socket.off('admin:user-banned', refresh);
      socket.off('admin:recording-completed', refresh);
    };
  }, [period]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const liveMeetings = useMemo(() => {
    const rows = dashboard?.liveMeetings || [];
    if (!debouncedSearch) return rows;
    const normalized = debouncedSearch.replace(/\s+/g, '');
    return rows.filter((meeting) => (
      meeting.title.toLowerCase().includes(debouncedSearch)
      || meeting.host_name.toLowerCase().includes(debouncedSearch)
      || String(meeting.id).includes(normalized)
      || getMeetingAccessCode(meeting).toLowerCase().includes(normalized)
    ));
  }, [dashboard?.liveMeetings, debouncedSearch]);

  const joinAsAdmin = async (meeting: Meeting) => {
    try {
      await adminDashboardService.joinMeeting(meeting.id);
      navigate(`/reunions/${encodeURIComponent(String(meeting.meeting_link))}`, { state: { meeting } });
    } catch (joinError) {
      setToast(joinError instanceof Error ? joinError.message : 'Accès à la réunion refusé.');
    }
  };

  const copyMeetingId = async (meeting: Meeting) => {
    const id = getMeetingAccessCode(meeting);
    try {
      await navigator.clipboard.writeText(id);
      setToast(`ID ${id} copié.`);
    } catch {
      setToast(`ID de réunion : ${id}`);
    }
  };

  const endLiveMeeting = async (meeting: Meeting) => {
    try {
      await collaborationService.endMeeting(meeting.id);
      setActiveMeetingMenu(null);
      setToast('Réunion terminée.');
      await loadDashboard();
    } catch (endError) {
      setToast(endError instanceof Error ? endError.message : 'Impossible de terminer la réunion.');
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!debouncedSearch) return;
    const meeting = liveMeetings[0];
    if (meeting) {
      void joinAsAdmin(meeting);
      return;
    }
    setToast('Aucun résultat administrateur trouvé.');
  };
  const resetTipDraft = () => {
    setTipDraft({
      title: 'Astuce du jour',
      body: '',
      actionLabel: 'Essayer maintenant',
      actionPath: '/app/whiteboard',
      isActive: true,
    });
    setEditingTipId(null);
  };

  const submitDashboardTip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!tipDraft.body.trim()) {
      setToast('Le contenu de l’astuce est obligatoire.');
      return;
    }
    setIsSavingTip(true);
    try {
      if (editingTipId) {
        await adminDashboardService.updateDashboardTip(editingTipId, tipDraft);
        setToast('Astuce mise à jour.');
      } else {
        await adminDashboardService.createDashboardTip(tipDraft);
        setToast('Astuce publiée.');
      }
      resetTipDraft();
      await loadDashboardTips();
    } catch (tipError) {
      setToast(tipError instanceof Error ? tipError.message : 'Enregistrement impossible.');
    } finally {
      setIsSavingTip(false);
    }
  };

  const editDashboardTip = (tip: DashboardTip) => {
    setEditingTipId(tip.id);
    setTipDraft({
      title: tip.title,
      body: tip.body,
      actionLabel: tip.actionLabel,
      actionPath: tip.actionPath,
      isActive: tip.isActive,
    });
  };

  const toggleDashboardTip = async (tip: DashboardTip) => {
    try {
      await adminDashboardService.updateDashboardTip(tip.id, {
        title: tip.title,
        body: tip.body,
        actionLabel: tip.actionLabel,
        actionPath: tip.actionPath,
        isActive: !tip.isActive,
      });
      await loadDashboardTips();
      setToast(!tip.isActive ? 'Astuce activée.' : 'Astuce désactivée.');
    } catch (tipError) {
      setToast(tipError instanceof Error ? tipError.message : 'Mise à jour impossible.');
    }
  };

  const deleteDashboardTip = async (tipId: string) => {
    try {
      await adminDashboardService.deleteDashboardTip(tipId);
      if (editingTipId === tipId) resetTipDraft();
      await loadDashboardTips();
      setToast('Astuce supprimée.');
    } catch (tipError) {
      setToast(tipError instanceof Error ? tipError.message : 'Suppression impossible.');
    }
  };

  if (error && !dashboard) {
    return (
      <main className="admin-access-state">
        <section>
          <ShieldCheck size={42} aria-hidden="true" />
          <h1>Accès administrateur</h1>
          <p role="alert">{error}</p>
          <Link to="/app">Retour au tableau de bord</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-dashboard-page">
      <AdminSidebar userName={currentUser?.name || currentUser?.email || 'Administrateur'} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && <button className="admin-sidebar-overlay" type="button" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}

      <section className="admin-dashboard-workspace">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" type="button" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={23} aria-hidden="true" />
          </button>
          <form className="admin-search" onSubmit={submitSearch}>
            <Search size={18} aria-hidden="true" />
            <input value={searchTerm} type="search" placeholder="Rechercher (utilisateurs, réunions, ID, ...)" aria-label="Rechercher dans l’administration" onChange={(event) => setSearchTerm(event.target.value)} />
            <kbd>Ctrl + K</kbd>
          </form>
          <nav className="admin-topbar-actions" aria-label="Actions administrateur">
            <button className="admin-topbar-icon" type="button" aria-label="Notifications administrateur" onClick={() => navigate('/app/notifications')}>
              <Bell size={22} aria-hidden="true" />
              <span>{dashboard?.recentActivity.length || 0}</span>
            </button>
            <button className="admin-topbar-icon" type="button" aria-label="Aide administrateur" onClick={() => navigate('/aide')}>
              <CircleHelp size={22} aria-hidden="true" />
            </button>
            <button className="admin-new-meeting-button" type="button" onClick={() => navigate('/reunions')}>
              <Plus size={20} aria-hidden="true" />
              Nouvelle réunion
            </button>
          </nav>
        </header>

        <div className="admin-dashboard-content">
          <header className="admin-dashboard-heading">
            <div>
              <h1>Tableau de bord</h1>
              <p>Vue d’ensemble de la plateforme MBotéRoom</p>
            </div>
            <label className="admin-period-selector">
              <CalendarDays size={18} aria-hidden="true" />
              <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Période d’analyse">
                {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
          </header>

          {isLoading && <p className="admin-loading">Chargement des statistiques...</p>}
          {error && dashboard && <p className="admin-inline-error" role="alert">{error}</p>}

          <section className="admin-stat-grid" aria-label="Indicateurs principaux">
            {(dashboard?.stats || []).map((stat) => <StatisticCard key={stat.id} stat={stat} />)}
          </section>

          <section className="admin-main-grid">
            <LiveMeetingsCard
              meetings={liveMeetings}
              activeMenu={activeMeetingMenu}
              onToggleMenu={(meetingId) => setActiveMeetingMenu((current) => (current === meetingId ? null : meetingId))}
              onJoin={(meeting) => void joinAsAdmin(meeting)}
              onCopyId={(meeting) => void copyMeetingId(meeting)}
              onEnd={(meeting) => void endLiveMeeting(meeting)}
            />
            <RecentActivityCard activities={dashboard?.recentActivity || []} />
            <AdminControlCenter />
            <HomeSlidesCard
              slides={homeSlides}
              selectedSlot={selectedHomeSlot}
              draft={homeSlideDraft}
              saving={isSavingHomeSlide}
              onSelect={selectHomeSlide}
              onDraftChange={setHomeSlideDraft}
              onSubmit={saveHomeSlide}
            />
            <LoginBrandingCard
              draft={loginBrandingDraft}
              saving={isSavingLoginBranding}
              onDraftChange={setLoginBrandingDraft}
              onSubmit={saveLoginBranding}
              onReset={() => setLoginBrandingDraft(defaultLoginBrandingDraft)}
            />
            <GuestAccessSlidesCard slides={guestSlides} draft={guestDraft} editingId={editingGuestSlideId} onDraftChange={setGuestDraft} onEdit={(slide) => { setEditingGuestSlideId(slide.id); setGuestDraft({ title: slide.title, body: slide.body, imageUrl: slide.imageUrl, isActive: slide.isActive }); }} onCancel={() => { setEditingGuestSlideId(null); setGuestDraft({ title: 'Acc\u00e8s invit\u00e9', body: '', imageUrl: '/meeting-black-team.svg', isActive: true }); }} onSubmit={async (event) => { event.preventDefault(); try { await adminDashboardService.saveGuestAccessSlide(guestDraft, editingGuestSlideId || undefined); setGuestSlides(await adminDashboardService.getGuestAccessSlides()); setEditingGuestSlideId(null); setGuestDraft({ title: 'Acc\u00e8s invit\u00e9', body: '', imageUrl: '/meeting-black-team.svg', isActive: true }); setToast('Slide enregistre.'); } catch (saveError) { setToast(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.'); } }} onDelete={async (id) => { try { await adminDashboardService.deleteGuestAccessSlide(id); setGuestSlides(await adminDashboardService.getGuestAccessSlides()); setToast('Slide supprime.'); } catch (deleteError) { setToast(deleteError instanceof Error ? deleteError.message : 'Suppression impossible.'); } }} />
            <DashboardTipsCard
              tips={dashboardTips}
              draft={tipDraft}
              editingTipId={editingTipId}
              isSaving={isSavingTip}
              onDraftChange={setTipDraft}
              onSubmit={submitDashboardTip}
              onEdit={editDashboardTip}
              onToggle={(tip) => void toggleDashboardTip(tip)}
              onDelete={(tipId) => void deleteDashboardTip(tipId)}
              onCancel={resetTipDraft}
            />
            <UsageStatisticsCard usage={dashboard?.usage || []} />
            <UserDistributionCard distribution={dashboard?.distribution || { active: 0, guests: 0, inactive: 0, banned: 0 }} />
            <CountriesCard countries={dashboard?.countries || []} />
          </section>
        </div>

        <footer className="admin-dashboard-footer">
          <span>© 2026 MBotéRoom. Tous droits réservés.</span>
          <span>v1.0.0 • Administration sécurisée</span>
        </footer>
      </section>
      {toast && <div className="admin-toast" role="status" aria-live="polite">{toast}</div>}
    </main>
  );
}

function AdminSidebar({ userName, open, onClose }: { userName: string; open: boolean; onClose: () => void }) {
  const menuItems: Array<{
    label: string;
    icon: typeof Home;
    path: string;
    active?: boolean;
    live?: boolean;
    count?: number;
  }> = [
    { label: 'Tableau de bord', icon: Home, path: '/admin', active: true },
    { label: 'Réglages généraux', icon: Settings, path: '/admin#admin-controls' },
    { label: 'Utilisateurs', icon: UsersRound, path: '/admin#admin-users' },
    { label: 'Signalements', icon: Flag, path: '/admin#admin-reports' },
    { label: 'Conditions d’utilisation', icon: FileText, path: '/admin#admin-legal-terms' },
    { label: 'Administrateurs', icon: ShieldCheck, path: '/admin#admin-admin-invites' },
    { label: 'Slider accueil', icon: CirclePlay, path: '/admin#admin-home-slides' },
    { label: 'Page de connexion', icon: ImageIcon, path: '/admin#admin-login-branding' },
    { label: 'Accueil des invités', icon: Video, path: '/admin#admin-guest-slides' },
    { label: 'Conseils d’accueil', icon: CircleHelp, path: '/admin#admin-tips' },
    { label: 'Réunions', icon: CalendarDays, path: '/app/meetings' },
    { label: 'Enregistrements', icon: CirclePlay, path: '/app/recordings' },
    { label: 'Messages', icon: MessageCircle, path: '/app/messages' },
    { label: 'Notifications', icon: Bell, path: '/app/notifications' },
    { label: 'Calendrier', icon: CalendarDays, path: '/app/calendar' },
    { label: 'Tableau blanc', icon: BarChart3, path: '/app/whiteboard' },
    { label: 'Paramètres', icon: Settings, path: '/app/settings' },
    { label: 'Aide', icon: CircleHelp, path: '/aide' },
  ];
  return (
    <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
      <button className="admin-sidebar-close" type="button" aria-label="Fermer le menu" onClick={onClose}><X size={20} /></button>
      <Link className="admin-brand" to="/admin">
        <span><img src="/icons/mboteroom-symbol.png" alt="" /></span>
        <strong>MBoté<span>Room</span><small>Admin</small></strong>
      </Link>
      <nav className="admin-sidebar-nav" aria-label="Navigation administrateur">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link className={item.active ? 'is-active' : ''} to={item.path} key={item.label} onClick={() => { onClose(); if (item.path.startsWith('/admin#')) requestAnimationFrame(() => document.getElementById(item.path.split('#')[1])?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>
              <Icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
              {item.live && <b className="admin-live-badge">LIVE</b>}
              {typeof item.count === 'number' && item.count > 0 && <b className="admin-count-badge">{item.count}</b>}
            </Link>
          );
        })}
      </nav>
      <section className="admin-profile-card">
        <Avatar name={userName} size="large" />
        <div>
          <strong>{userName}</strong>
          <span>Administrateur</span>
          <small><i />En ligne</small>
        </div>
        <button type="button" aria-label="Déconnexion" onClick={() => void authService.logout()}><LogOut size={17} /></button>
      </section>
    </aside>
  );
}

function StatisticCard({ stat }: { stat: AdminDashboardStat }) {
  const points = buildPolylinePoints(stat.points, 210, 44);
  return (
    <article className={`admin-stat-card is-${statTones[stat.id]}`}>
      <div>
        <span>{statIcons[stat.id]}</span>
        <section>
          <small>{stat.label}</small>
          <strong>{formatNumber(stat.value)}{stat.suffix ? ` ${stat.suffix}` : ''}</strong>
          <p>{stat.evolution > 0 && <b>↑ {stat.evolution}%</b>}<em>{stat.helper}</em></p>
        </section>
      </div>
      <svg viewBox="0 0 210 44" preserveAspectRatio="none" role="img" aria-label={`${stat.label}: ${stat.value}`}>
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </article>
  );
}

function LiveMeetingsCard({
  meetings,
  activeMenu,
  onToggleMenu,
  onJoin,
  onCopyId,
  onEnd,
}: {
  meetings: Meeting[];
  activeMenu: number | null;
  onToggleMenu: (meetingId: number) => void;
  onJoin: (meeting: Meeting) => void;
  onCopyId: (meeting: Meeting) => void;
  onEnd: (meeting: Meeting) => void;
}) {
  return (
    <section className="admin-live-meetings-card">
      <header><div><h2>Réunions en direct</h2><span>LIVE</span></div><Link to="/app/meetings">Voir toutes</Link></header>
      <div className="admin-live-table">
        <div className="admin-live-table-head"><span>Titre de la réunion</span><span>Hôte</span><span>Participants</span><span>Début</span><span>Actions</span></div>
        <div>
          {meetings.length ? meetings.map((meeting) => (
            <article className="admin-live-row" key={meeting.id}>
              <div className="admin-live-title"><i /><strong>{meeting.title}</strong></div>
              <div className="admin-live-host"><Avatar name={meeting.host_name} image={meeting.host_avatar} size="small" /><span>{meeting.host_name}</span></div>
              <div className="admin-live-participants">
                {Array.from({ length: Math.min(4, Math.max(1, meeting.participant_count || 1)) }, (_, index) => <Avatar key={index} name={`${meeting.title}-${index}`} image={index === 0 ? meeting.host_avatar : ''} size="tiny" />)}
                {(meeting.participant_count || 1) > 4 && <b>+{(meeting.participant_count || 1) - 4}</b>}
              </div>
              <span>{formatTime(meeting.start_time)}</span>
              <div className="admin-live-actions">
                <button type="button" onClick={() => onJoin(meeting)}>Rejoindre</button>
                <div className="admin-row-menu">
                  <button type="button" aria-label={`Actions pour ${meeting.title}`} aria-expanded={activeMenu === meeting.id} onClick={() => onToggleMenu(meeting.id)}><MoreVertical size={19} /></button>
                  {activeMenu === meeting.id && (
                    <div>
                      <button type="button" onClick={() => onCopyId(meeting)}>Copier l’ID</button>
                      <button type="button" onClick={() => onJoin(meeting)}>Ouvrir la modération</button>
                      <button type="button" onClick={() => onEnd(meeting)}>Terminer la réunion</button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          )) : <p className="admin-empty">Aucune réunion en direct.</p>}
        </div>
      </div>
    </section>
  );
}

function RecentActivityCard({ activities }: { activities: AdminActivity[] }) {
  return (
    <section className="admin-activity-card">
      <header><h2>Activité récente</h2><span>Dernières actions serveur</span></header>
      {activities.length ? activities.map((activity) => (
        <article className={`admin-activity-row is-${activityTones[activity.type]}`} key={activity.id}>
          <span>{activityIcons[activity.type]}</span>
          <div><strong>{activity.title}</strong><small>{activity.description}</small></div>
          <time>{formatRelativeTime(activity.createdAt)}</time>
        </article>
      )) : <p className="admin-empty">Aucune activité récente.</p>}
    </section>
  );
}

function HomeSlidesCard({ slides, selectedSlot, draft, saving, onSelect, onDraftChange, onSubmit }: {
  slides: HomeSlide[];
  selectedSlot: HomeSlide['slot'];
  draft: HomeSlideDraft;
  saving: boolean;
  onSelect: (slot: HomeSlide['slot']) => void;
  onDraftChange: (draft: HomeSlideDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="admin-tips-card admin-home-slides-card" id="admin-home-slides">
      <header>
        <div>
          <h2>Visuels de l’accueil</h2>
          <p>Pilotez les trois slides du hero et la bannière de bas de page. Chaque image peut être modifiée ici sans changer le code.</p>
        </div>
        <span>3 slides + 1 bannière</span>
      </header>
      <div className="admin-home-slide-tabs" role="tablist" aria-label="Slides de l’accueil">
        {([1,2,3,4] as HomeSlide['slot'][]).map((slot) => {
          const item = slides.find((slide) => slide.slot === slot);
          return <button key={slot} type="button" className={selectedSlot === slot ? 'is-active' : ''} onClick={() => onSelect(slot)}>
            <strong>{slot === 4 ? 'Bannière' : `Slide ${slot}`}</strong><small>{item?.isActive === false ? 'Masqué' : 'Actif'}</small>
          </button>;
        })}
      </div>
      <form className="admin-tip-form admin-home-slide-form" onSubmit={onSubmit}>
        <label><span>Titre</span><input value={draft.title} maxLength={120} required onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}/></label>
        <label><span>Message</span><textarea value={draft.body} maxLength={420} rows={4} required onChange={(event) => onDraftChange({ ...draft, body: event.target.value })}/></label>
        <label><span>Image affichée</span><input value={draft.imageUrl} maxLength={1000} placeholder="/images/... ou https://..." onChange={(event) => onDraftChange({ ...draft, imageUrl: event.target.value })}/><small className="admin-field-help">Utilisez une image interne ou une URL HTTPS. La modification est appliquée à l’accueil sans redéploiement du frontend.</small></label>
        <div className="admin-tip-form-grid">
          <label><span>Texte du bouton</span><input value={draft.actionLabel} maxLength={50} onChange={(event) => onDraftChange({ ...draft, actionLabel: event.target.value })}/></label>
          <label><span>Destination interne</span><input value={draft.actionPath} maxLength={300} placeholder="/app/meetings" onChange={(event) => onDraftChange({ ...draft, actionPath: event.target.value })}/></label>
        </div>
        <label className="admin-tip-toggle"><input type="checkbox" checked={draft.isActive} onChange={(event) => onDraftChange({ ...draft, isActive: event.target.checked })}/><span>{selectedSlot === 4 ? 'Afficher la bannière' : 'Afficher ce slide'}</span></label>
        {draft.imageUrl ? <div className="admin-home-slide-preview"><img src={draft.imageUrl} alt={selectedSlot === 4 ? 'Aperçu de la bannière' : `Aperçu du slide ${selectedSlot}`} /></div> : null}
        <div className="admin-tip-actions"><button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : selectedSlot === 4 ? 'Enregistrer la bannière' : `Enregistrer le slide ${selectedSlot}`}</button></div>
      </form>
    </section>
  );
}

function LoginBrandingCard({ draft, saving, onDraftChange, onSubmit, onReset }: {
  draft: LoginBrandingDraft;
  saving: boolean;
  onDraftChange: (draft: LoginBrandingDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
}) {
  return (
    <section className="admin-tips-card admin-login-branding-card" id="admin-login-branding">
      <header>
        <div>
          <h2>Images de la page de connexion</h2>
          <p>Modifiez le logo principal et l’illustration de visioconférence affichés sur la page Login, sur PC comme sur mobile.</p>
        </div>
        <span>Connexion</span>
      </header>
      <form className="admin-tip-form admin-login-branding-form" onSubmit={onSubmit}>
        <div className="admin-login-branding-grid">
          <label>
            <span>Logo / wordmark MBotéRoom</span>
            <input
              value={draft.wordmarkUrl}
              maxLength={1000}
              required
              placeholder="/icons/mboteroom-wordmark.png ou https://..."
              onChange={(event) => onDraftChange({ ...draft, wordmarkUrl: event.target.value })}
            />
            <small className="admin-field-help">Cette image remplace le logo visible en haut de la page de connexion.</small>
            <div className="admin-login-branding-preview is-logo">
              <img src={draft.wordmarkUrl || defaultLoginBrandingDraft.wordmarkUrl} alt="Aperçu du logo de connexion" />
            </div>
          </label>
          <label>
            <span>Illustration de visioconférence</span>
            <input
              value={draft.illustrationUrl}
              maxLength={1000}
              required
              placeholder="/images/meeting-black-team.svg ou https://..."
              onChange={(event) => onDraftChange({ ...draft, illustrationUrl: event.target.value })}
            />
            <small className="admin-field-help">Cette image est utilisée dans le visuel principal de connexion en desktop et en mobile.</small>
            <div className="admin-login-branding-preview">
              <img src={draft.illustrationUrl || defaultLoginBrandingDraft.illustrationUrl} alt="Aperçu de l’illustration de connexion" />
            </div>
          </label>
        </div>
        <div className="admin-login-branding-note">
          <ShieldCheck size={17}/>
          <span>Les modifications sont enregistrées en base de données et appliquées à la page de connexion sans modifier le code. Seuls les chemins internes et les URL HTTPS sont acceptés.</span>
        </div>
        <div className="admin-tip-actions">
          <button type="button" onClick={onReset} disabled={saving}>Valeurs par défaut</button>
          <button type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer les images'}</button>
        </div>
      </form>
    </section>
  );
}

function GuestAccessSlidesCard({ slides, draft, editingId, onDraftChange, onEdit, onCancel, onSubmit, onDelete }: {
  slides: GuestAccessSlide[]; draft: Pick<GuestAccessSlide, 'title' | 'body' | 'imageUrl' | 'isActive'>; editingId: string | null;
  onDraftChange: (draft: Pick<GuestAccessSlide, 'title' | 'body' | 'imageUrl' | 'isActive'>) => void;
  onEdit: (slide: GuestAccessSlide) => void; onCancel: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onDelete: (id: string) => void;
}) {
  return <section className="admin-tips-card" id="admin-guest-slides"><header><div><h2>Slider accès invité</h2><p>Contenu affiché sur la page de participation sans compte.</p></div><span>{slides.filter((slide) => slide.isActive).length} active(s)</span></header>
    <form className="admin-tip-form" onSubmit={onSubmit}><label><span>Titre</span><input value={draft.title} maxLength={80} required onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} /></label><label><span>Message</span><textarea value={draft.body} maxLength={280} rows={3} required onChange={(event) => onDraftChange({ ...draft, body: event.target.value })} /></label><label><span>URL de l'image</span><input value={draft.imageUrl} maxLength={500} onChange={(event) => onDraftChange({ ...draft, imageUrl: event.target.value })} /></label><label className="admin-tip-toggle"><input type="checkbox" checked={draft.isActive} onChange={(event) => onDraftChange({ ...draft, isActive: event.target.checked })} /><span>Slide active</span></label><div className="admin-tip-actions">{editingId && <button type="button" onClick={onCancel}>Annuler</button>}<button type="submit">{editingId ? 'Mettre à jour' : 'Publier'}</button></div></form>
    <div className="admin-tip-list">{slides.map((slide) => <article key={slide.id} className={slide.isActive ? 'is-active' : ''}><div><strong>{slide.title}</strong><p>{slide.body}</p><small>{slide.imageUrl}</small></div><div><button type="button" onClick={() => onEdit(slide)}>Modifier</button><button type="button" className="is-danger" onClick={() => onDelete(slide.id)}>Supprimer</button></div></article>)}</div>
  </section>;
}
function DashboardTipsCard({
  tips,
  draft,
  editingTipId,
  isSaving,
  onDraftChange,
  onSubmit,
  onEdit,
  onToggle,
  onDelete,
  onCancel,
}: {
  tips: DashboardTip[];
  draft: DashboardTipDraft;
  editingTipId: string | null;
  isSaving: boolean;
  onDraftChange: (draft: DashboardTipDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (tip: DashboardTip) => void;
  onToggle: (tip: DashboardTip) => void;
  onDelete: (tipId: string) => void;
  onCancel: () => void;
}) {
  return (
    <section className="admin-tips-card" id="admin-tips">
      <header>
        <div>
          <h2>Astuces du jour</h2>
          <p>Programmez les messages qui défilent sur l’accueil utilisateur.</p>
        </div>
        <span>{tips.filter((tip) => tip.isActive).length} active(s)</span>
      </header>

      <form className="admin-tip-form" onSubmit={onSubmit}>
        <label>
          <span>Titre</span>
          <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} required maxLength={80} />
        </label>
        <label>
          <span>Message</span>
          <textarea value={draft.body} onChange={(event) => onDraftChange({ ...draft, body: event.target.value })} required rows={3} maxLength={220} />
        </label>
        <div className="admin-tip-form-grid">
          <label>
            <span>Bouton</span>
            <input value={draft.actionLabel} onChange={(event) => onDraftChange({ ...draft, actionLabel: event.target.value })} required maxLength={40} />
          </label>
          <label>
            <span>Route</span>
            <input value={draft.actionPath} onChange={(event) => onDraftChange({ ...draft, actionPath: event.target.value })} required placeholder="/app/whiteboard" />
          </label>
        </div>
        <label className="admin-tip-toggle">
          <input type="checkbox" checked={draft.isActive} onChange={(event) => onDraftChange({ ...draft, isActive: event.target.checked })} />
          <span>Astuce active</span>
        </label>
        <div className="admin-tip-actions">
          {editingTipId && <button type="button" onClick={onCancel}>Annuler</button>}
          <button type="submit" disabled={isSaving}>{isSaving ? 'Enregistrement...' : editingTipId ? 'Mettre à jour' : 'Publier'}</button>
        </div>
      </form>

      <div className="admin-tip-list" aria-label="Astuces programmées">
        {tips.length ? tips.map((tip) => (
          <article key={tip.id} className={tip.isActive ? 'is-active' : ''}>
            <div>
              <strong>{tip.title}</strong>
              <p>{tip.body}</p>
              <small>{tip.actionLabel} · {tip.actionPath}</small>
            </div>
            <div>
              <button type="button" onClick={() => onEdit(tip)}>Modifier</button>
              <button type="button" onClick={() => onToggle(tip)}>{tip.isActive ? 'Désactiver' : 'Activer'}</button>
              <button type="button" className="is-danger" onClick={() => onDelete(tip.id)}>Supprimer</button>
            </div>
          </article>
        )) : <p className="admin-empty">Aucune astuce programmée.</p>}
      </div>
    </section>
  );
}
function UsageStatisticsCard({ usage }: { usage: Array<{ label: string; meetings: number; users: number }> }) {
  const meetingPoints = buildPolylinePoints(usage.map((item) => item.meetings), 560, 180);
  const userPoints = buildPolylinePoints(usage.map((item) => item.users), 560, 180);
  return (
    <section className="admin-usage-card">
      <header><h2>Statistiques d’utilisation</h2><span>7 derniers jours</span></header>
      <svg viewBox="0 0 620 230" role="img" aria-label="Courbes réunions et utilisateurs">
        <g className="admin-chart-grid">{[0, 1, 2, 3].map((line) => <line key={line} x1="34" x2="594" y1={30 + line * 48} y2={30 + line * 48} />)}</g>
        <polyline points={meetingPoints} transform="translate(34 24)" fill="none" stroke="#007e83" strokeWidth="3" />
        <polyline points={userPoints} transform="translate(34 24)" fill="none" stroke="#16a365" strokeWidth="3" />
      </svg>
      <div className="admin-usage-labels">{usage.slice(-7).map((item) => <span key={item.label}>{item.label}</span>)}</div>
    </section>
  );
}

function UserDistributionCard({ distribution }: { distribution: { active: number; guests: number; inactive: number; banned: number } }) {
  const total = distribution.active + distribution.guests + distribution.inactive + distribution.banned;
  const rows = [
    ['Utilisateurs actifs', distribution.active, '#16a365'],
    ['Invités', distribution.guests, '#007e83'],
    ['Inactifs', distribution.inactive, '#ff9f2f'],
    ['Bannis', distribution.banned, '#ef5350'],
  ] as const;
  return (
    <section className="admin-distribution-card">
      <h2>Répartition des utilisateurs</h2>
      <div className="admin-distribution-content">
        <div className="admin-donut" style={{ '--active': `${total ? (distribution.active / total) * 100 : 0}%`, '--guests': `${total ? (distribution.guests / total) * 100 : 0}%` } as CSSProperties}>
          <strong>{formatNumber(total)}</strong><span>Total</span>
        </div>
        <div className="admin-distribution-legend">
          {rows.map(([label, value, color]) => <p key={label}><i style={{ background: color }} /><span>{label}</span><strong>{formatNumber(value)}</strong></p>)}
        </div>
      </div>
    </section>
  );
}

function CountriesCard({ countries }: { countries: Array<{ id: string; name: string; flag: string; count: number; percentage: number }> }) {
  return (
    <section className="admin-countries-card">
      <header><h2>Utilisateurs par pays</h2><span>Données disponibles</span></header>
      {countries.length ? countries.map((country) => (
        <article key={country.id}><span>{country.flag}</span><strong>{country.name}</strong><em>{formatNumber(country.count)} ({country.percentage}%)</em></article>
      )) : <p className="admin-empty">Aucune statistique de pays disponible.</p>}
    </section>
  );
}

function Avatar({ name, image, size }: { name: string; image?: string; size: 'tiny' | 'small' | 'large' }) {
  return <span className={`admin-avatar admin-avatar-${size}`}>{image ? <img src={image} alt="" /> : <em>{getInitials(name)}</em>}{size !== 'tiny' && <i />}</span>;
}
