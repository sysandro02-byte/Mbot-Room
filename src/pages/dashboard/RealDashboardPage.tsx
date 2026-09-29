import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { appDataService, type ClientPlatformSettings, type Contact, type Recording } from '../../services/appDataService';
import { getMeetingPhase, HomeSlide, Meeting, meetingService } from '../../services/meetingService';
import { notificationService, RoomNotification } from '../../services/notificationService';
import { socket } from '../../lib/socket';
import { apiUrl } from '../../lib/api';
import { readCachedApiResponse } from '../../lib/offline';
import HomeHero from './components/HomeHero';
import { HomeQuickActions, HomeStats, type HomeStatsData } from './components/HomeQuickActions';
import { NextMeetingCard, RecentMeetings } from './components/HomeMeetings';
import { HomeFeatureBanner, HomeFooter, HomeQuickAccess, LunaAssistantCard } from './components/HomeExtras';
import { PremiumModal, StorageDataModal } from './components/HomeDashboardModals';
import './RealDashboardPage.css';
import AndroidHome from './components/AndroidHome';
import { isNativeAndroidApp } from '../../lib/nativePlatform';

const readCachedJson = async <T,>(path: string): Promise<T | null> => {
  const response = await readCachedApiResponse(apiUrl(path));
  if (!response) return null;
  return response.json().catch(() => null) as Promise<T | null>;
};

export default function RealDashboardPage() {
  const navigate = useNavigate();
  const user = authService.getCurrentUser();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [notifications, setNotifications] = useState<RoomNotification[]>([]);
  const [tips, setTips] = useState<Array<{id:string;title:string;body:string;actionLabel:string;actionPath:string}>>([]);
  const [homeSlides, setHomeSlides] = useState<HomeSlide[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<ClientPlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');

    // Affiche immédiatement les dernières données disponibles pendant que le réseau se met à jour.
    const [cachedMeetings, cachedContacts, cachedRecordings, cachedNotifications, cachedTips, cachedSlides, cachedPlatform] = await Promise.all([
      readCachedJson<Meeting[]>('/api/meetings'),
      readCachedJson<Contact[]>('/api/contacts'),
      readCachedJson<Recording[]>('/api/recordings'),
      readCachedJson<RoomNotification[]>('/api/notifications'),
      readCachedJson<Array<{id:string;title:string;body:string;actionLabel:string;actionPath:string}>>('/api/dashboard/tips'),
      readCachedJson<HomeSlide[]>('/api/dashboard/slides'),
      readCachedJson<ClientPlatformSettings>('/api/platform/settings'),
    ]);

    if (Array.isArray(cachedMeetings)) setMeetings(cachedMeetings);
    if (Array.isArray(cachedContacts)) setContacts(cachedContacts);
    if (Array.isArray(cachedRecordings)) setRecordings(cachedRecordings);
    if (Array.isArray(cachedNotifications)) setNotifications(cachedNotifications);
    if (Array.isArray(cachedTips)) setTips(cachedTips);
    if (Array.isArray(cachedSlides)) {
      setHomeSlides(cachedSlides);
      setActiveSlide(0);
    }
    if (cachedPlatform) setPlatformSettings(cachedPlatform);

    const jobs = [
      meetingService.getMeetings(10_000)
        .then((rows) => setMeetings(Array.isArray(rows) ? rows : [])),
      appDataService.getContacts(10_000)
        .then((rows) => setContacts(Array.isArray(rows) ? rows : [])),
      appDataService.getRecordings(10_000)
        .then((rows) => setRecordings(Array.isArray(rows) ? rows : [])),
      notificationService.list(10_000)
        .then((rows) => setNotifications(Array.isArray(rows) ? rows : [])),
      meetingService.getDashboardTips(10_000)
        .then((rows) => setTips(Array.isArray(rows) ? rows : [])),
      meetingService.getHomeSlides(10_000)
        .then((rows) => {
          setHomeSlides(Array.isArray(rows) ? rows : []);
          setActiveSlide(0);
        }),
      appDataService.getPlatformSettings(10_000)
        .then((rows) => setPlatformSettings(rows)),
    ];

    const results = await Promise.allSettled(jobs);
    if (results[0]?.status === 'rejected' && !cachedMeetings?.length) {
      const cause = results[0].reason;
      setError(cause instanceof Error ? cause.message : 'Impossible de charger les réunions.');
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const refreshMeetings = () => void meetingService.getMeetings(8_000)
      .then((rows) => setMeetings(Array.isArray(rows) ? rows : []))
      .catch(() => undefined);
    const onVisible = () => { if (document.visibilityState === 'visible') refreshMeetings(); };
    const timer = window.setInterval(refreshMeetings, 30_000);
    ['meeting:created','meeting:updated','meeting:started','meeting:ended','meeting:cancelled','meeting:restarted']
      .forEach((eventName) => socket.on(eventName, refreshMeetings));
    window.addEventListener('focus', refreshMeetings);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      ['meeting:created','meeting:updated','meeting:started','meeting:ended','meeting:cancelled','meeting:restarted']
        .forEach((eventName) => socket.off(eventName, refreshMeetings));
      window.removeEventListener('focus', refreshMeetings);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const heroSlides = useMemo(() => homeSlides.filter((slide) => slide.slot >= 1 && slide.slot <= 3 && slide.isActive !== false), [homeSlides]);
  const bannerSlide = useMemo(() => homeSlides.find((slide) => slide.slot === 4 && slide.isActive !== false) || null, [homeSlides]);

  useEffect(() => {
    if (heroSlides.length < 2) return undefined;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % heroSlides.length), 7000);
    return () => window.clearInterval(timer);
  }, [heroSlides.length]);

  useEffect(() => {
    const refreshSlides = () => void meetingService.getHomeSlides(8_000)
      .then((rows) => { setHomeSlides(rows); setActiveSlide(0); })
      .catch(() => undefined);
    if (!socket.connected) socket.connect();
    socket.on('dashboard:slides-updated', refreshSlides);
    return () => { socket.off('dashboard:slides-updated', refreshSlides); };
  }, []);

  const now = Date.now();
  const upcoming = useMemo(() => meetings
    .filter((meeting) => getMeetingPhase(meeting, now) !== 'ended')
    .sort((left, right) => {
      const leftPhase = getMeetingPhase(left, now);
      const rightPhase = getMeetingPhase(right, now);
      if (leftPhase !== rightPhase) return leftPhase === 'live' ? -1 : 1;
      return new Date(left.start_time).getTime() - new Date(right.start_time).getTime();
    }), [meetings, now]);

  const recent = useMemo(() => meetings
    .filter((meeting) => getMeetingPhase(meeting, now) === 'ended')
    .sort((left, right) => new Date(right.start_time).getTime() - new Date(left.start_time).getTime())
    .slice(0, 3), [meetings]);

  const monthlyMinutes = useMemo(() => {
    const date = new Date();
    return meetings
      .filter((meeting) => {
        if (meeting.status !== 'ended') return false;
        const start = new Date(meeting.start_time);
        return start.getFullYear() === date.getFullYear() && start.getMonth() === date.getMonth();
      })
      .reduce((sum, meeting) => sum + Math.max(0, Number(meeting.duration || 0)), 0);
  }, [meetings]);

  const stats: HomeStatsData = {
    upcomingMeetings: upcoming.length,
    contacts: contacts.length,
    recordings: recordings.length,
    monthlyMinutes,
  };

  const unreadNotifications = notifications.filter((notification) => !notification.readAt).length;
  const nextMeeting = upcoming[0] || null;
  const lunaTarget = recent[0] || nextMeeting;
  const firstName = (user?.name || user?.username || 'Utilisateur').trim().split(/\s+/)[0] || 'Utilisateur';

  const canManage = (meeting: Meeting | null) => Boolean(meeting && user && (
    Number(meeting.host_id) === Number(user.id) ||
    user.role === 'admin'
  ));

  const openMeeting = async (meeting: Meeting) => {
    const phase = getMeetingPhase(meeting);
    if (phase === 'ended') {
      navigate('/reunions/' + meeting.meeting_link + '/terminee', { state: { meeting } });
      return;
    }
    const moderator = Number(meeting.host_id) === Number(user?.id) || Number(meeting.co_host_id || 0) === Number(user?.id) || user?.role === 'admin';
    if (moderator && phase === 'upcoming') {
      try {
        const result = await meetingService.startMeetingAndNotify(meeting.id);
        navigate('/reunions/' + meeting.meeting_link, { state: { meeting: result.meeting || meeting } });
        return;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Démarrage impossible.');
        return;
      }
    }
    try {
      const numericUserId = Number(user?.id);
      const access = await meetingService.requestJoin(meeting.id, Number.isFinite(numericUserId) ? numericUserId : undefined);
      if (access.status === 'requested') {
        navigate('/reunions/' + meeting.meeting_link + '/salle-attente', { state: { meeting } });
        return;
      }
      navigate('/reunions/' + meeting.meeting_link, { state: { meeting } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Accès impossible.');
    }
  };

  const manageMeeting = (meeting?: Meeting | null) => {
    if (meeting?.id) navigate(`/app/meetings?edit=${meeting.id}`);
    else navigate('/app/meetings');
  };

  const openRecording = async (recording: Recording) => {
    try {
      const access = await appDataService.getRecordingAccess(recording.id);
      const opened = window.open(access.url, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.assign(access.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Accès à l’enregistrement impossible.');
    }
  };

  const openLunaTarget = (meeting: Meeting) => {
    if (getMeetingPhase(meeting) === 'ended') {
      navigate(`/reunions/${meeting.meeting_link}/terminee`, { state: { meeting } });
      return;
    }
    navigate('/app/meetings');
  };

  if (isNativeAndroidApp()) return <AndroidHome
    firstName={firstName}
    meetings={upcoming}
    loading={loading}
    unreadNotifications={unreadNotifications}
    onCreate={() => navigate('/app/meetings?new=1')}
    onPlan={() => navigate('/app/meetings?new=1&mode=schedule')}
    onOpen={(meeting) => void openMeeting(meeting)}
    onAll={() => navigate('/app/meetings')}
    onNotifications={() => navigate('/app/notifications')}
    onLive={() => navigate('/app/live')}
  />;

  return <main className="real-dashboard" aria-busy={loading}>
    {loading ? <div className="home-data-progress" aria-hidden="true"><span/></div> : null}
    <HomeHero
      firstName={firstName}
      slides={heroSlides}
      activeSlide={activeSlide}
      onSlideChange={setActiveSlide}
      onCreate={() => navigate('/app/meetings?new=1')}
      onJoin={() => navigate('/join')}
    />

    {error ? <div className="real-dashboard-error">{error}</div> : null}

    <HomeQuickActions
      premiumAvailable={Boolean(platformSettings?.premiumCheckoutReady)}
      onPremium={() => setPremiumOpen(true)}
      onCreateGroup={() => navigate('/app/groups?new=1')}
      onStorageData={() => setStorageOpen(true)}
      onShareScreen={() => navigate('/app/meetings?new=1&intent=screen-share')}
    />

    <HomeStats data={stats}/>

    <section className="home-main-grid">
      <div className="home-main-column">
        <NextMeetingCard
          meeting={nextMeeting}
          canManage={canManage(nextMeeting)}
          onOpen={(meeting) => void openMeeting(meeting)}
          onManage={manageMeeting}
          onPlan={() => navigate('/app/meetings?new=1&mode=schedule')}
        />
        <RecentMeetings
          meetings={recent}
          recordings={recordings}
          onOpen={openLunaTarget}
          onOpenRecording={(recording) => void openRecording(recording)}
          onManage={manageMeeting}
          canManage={(meeting) => canManage(meeting)}
          onAll={() => navigate('/app/meetings')}
        />
      </div>

      <div className="home-side-column">
        <LunaAssistantCard
          targetMeeting={lunaTarget}
          onOpenMeeting={openLunaTarget}
          onAllMeetings={() => navigate('/app/meetings')}
        />
        <HomeQuickAccess
          onMessages={() => navigate('/app/messages')}
          onContacts={() => navigate('/app/contacts')}
          onCalendar={() => navigate('/app/calendar')}
          onFiles={() => navigate('/app/files')}
          onPolls={() => navigate('/app/polls')}
          onWhiteboard={() => navigate('/app/whiteboard')}
        />
      </div>
    </section>

    {unreadNotifications > 0 ? <button className="home-notification-callout" type="button" onClick={() => navigate('/app/notifications')}>
      Vous avez <strong>{unreadNotifications}</strong> notification{unreadNotifications > 1 ? 's' : ''} non lue{unreadNotifications > 1 ? 's' : ''}.
    </button> : null}

    <HomeFeatureBanner
      imageUrl={bannerSlide?.imageUrl}
      title={bannerSlide?.title}
      body={bannerSlide?.body}
      actionLabel={bannerSlide?.actionLabel}
      onDiscover={() => navigate(bannerSlide?.actionPath || '/fonctionnalites')}
    />

    {tips.length ? <section className="home-admin-tips">
      {tips.map((tip) => <article key={tip.id}><span><Sparkles size={16}/></span><div><strong>{tip.title}</strong><p>{tip.body}</p>{tip.actionLabel && tip.actionPath ? <button type="button" onClick={() => navigate(tip.actionPath)}>{tip.actionLabel}</button> : null}</div></article>)}
    </section> : null}

    <HomeFooter
      onPrivacy={() => navigate('/confidentialite')}
      onTerms={() => navigate('/conditions')}
      onHelp={() => navigate('/aide')}
    />

    <PremiumModal
      open={premiumOpen}
      paymentReady={Boolean(platformSettings?.premiumCheckoutReady)}
      checkoutUrl={platformSettings?.premiumCheckoutUrl || ''}
      onClose={() => setPremiumOpen(false)}
    />
    <StorageDataModal open={storageOpen} onClose={() => setStorageOpen(false)}/>
  </main>;
}
