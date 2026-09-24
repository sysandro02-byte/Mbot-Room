import { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { appDataService, type ClientPlatformSettings, type Contact, type Recording } from '../../services/appDataService';
import { HomeSlide, Meeting, meetingService } from '../../services/meetingService';
import { notificationService, RoomNotification } from '../../services/notificationService';
import { socket } from '../../lib/socket';
import HomeHero from './components/HomeHero';
import { HomeQuickActions, HomeStats, type HomeStatsData } from './components/HomeQuickActions';
import { NextMeetingCard, RecentMeetings } from './components/HomeMeetings';
import { HomeFeatureBanner, HomeFooter, HomeQuickAccess, LunaAssistantCard } from './components/HomeExtras';
import { PremiumModal, StorageDataModal } from './components/HomeDashboardModals';
import './RealDashboardPage.css';

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
    try {
      const [meetingRows, contactRows, recordingRows, notificationRows, tipRows, slideRows, platformRows] = await Promise.all([
        meetingService.getMeetings(),
        appDataService.getContacts().catch(() => []),
        appDataService.getRecordings().catch(() => []),
        notificationService.list().catch(() => []),
        meetingService.getDashboardTips().catch(() => []),
        meetingService.getHomeSlides().catch(() => []),
        appDataService.getPlatformSettings().catch(() => null),
      ]);
      setMeetings(Array.isArray(meetingRows) ? meetingRows : []);
      setContacts(Array.isArray(contactRows) ? contactRows : []);
      setRecordings(Array.isArray(recordingRows) ? recordingRows : []);
      setNotifications(Array.isArray(notificationRows) ? notificationRows : []);
      setTips(Array.isArray(tipRows) ? tipRows : []);
      setHomeSlides(Array.isArray(slideRows) ? slideRows : []);
      setPlatformSettings(platformRows);
      setActiveSlide(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger le tableau de bord.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const heroSlides = useMemo(() => homeSlides.filter((slide) => slide.slot >= 1 && slide.slot <= 3 && slide.isActive !== false), [homeSlides]);
  const bannerSlide = useMemo(() => homeSlides.find((slide) => slide.slot === 4 && slide.isActive !== false) || null, [homeSlides]);

  useEffect(() => {
    if (heroSlides.length < 2) return undefined;
    const timer = window.setInterval(() => setActiveSlide((current) => (current + 1) % heroSlides.length), 7000);
    return () => window.clearInterval(timer);
  }, [heroSlides.length]);

  useEffect(() => {
    const refreshSlides = () => void meetingService.getHomeSlides()
      .then((rows) => { setHomeSlides(rows); setActiveSlide(0); })
      .catch(() => undefined);
    if (!socket.connected) socket.connect();
    socket.on('dashboard:slides-updated', refreshSlides);
    return () => { socket.off('dashboard:slides-updated', refreshSlides); };
  }, []);

  const now = Date.now();
  const upcoming = useMemo(() => meetings
    .filter((meeting) => meeting.status !== 'ended' && meeting.status !== 'cancelled' && (meeting.is_active || new Date(meeting.start_time).getTime() + meeting.duration * 60000 >= now))
    .sort((left, right) => new Date(left.start_time).getTime() - new Date(right.start_time).getTime()), [meetings, now]);

  const recent = useMemo(() => meetings
    .filter((meeting) => meeting.status === 'ended')
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
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      navigate('/reunions/' + meeting.meeting_link + '/terminee', { state: { meeting } });
      return;
    }
    const moderator = Number(meeting.host_id) === Number(user?.id) || Number(meeting.co_host_id || 0) === Number(user?.id) || user?.role === 'admin';
    if (moderator && !meeting.is_active) {
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

  const openLunaTarget = (meeting: Meeting) => {
    if (meeting.status === 'ended' || meeting.status === 'cancelled') {
      navigate(`/reunions/${meeting.meeting_link}/terminee`, { state: { meeting } });
      return;
    }
    navigate('/app/meetings');
  };

  if (loading) {
    return <main className="real-dashboard home-dashboard-loading" aria-busy="true">
      <div className="home-skeleton hero"/>
      <div className="home-skeleton actions"/>
      <div className="home-skeleton stats"/>
      <div className="home-skeleton grid"/>
    </main>;
  }

  return <main className="real-dashboard">
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
