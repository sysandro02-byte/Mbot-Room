import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ElementType, FormEvent, MouseEvent, SyntheticEvent } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CalendarDays,
  Captions,
  Check,
  ChevronRight,
  CircleDot,
  Clock3,
  Globe2,
  Hand,
  Image as ImageIcon,
  Link2,
  List,
  Lock,
  MessageCircle,
  Mic2,
  Pencil,
  MoreVertical,
  Monitor,
  ScreenShare,
  Share2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { getMeetingJoinUrl, meetingService, Meeting, MeetingParticipantSuggestion, ScheduleMeetingPayload } from '../services/meetingService';
import { authService } from '../services/authService';
import { defaultPublicSettings, publicSettingsService, MeetingAdSlide } from '../services/publicSettingsService';
import MeetingRoom from './MeetingRoom';
import './MeetingList.css';

type UpcomingMeeting = {
  id: string;
  day: string;
  month: string;
  title: string;
  time: string;
  participants: string;
  meeting?: Meeting;
};

type RecentMeeting = {
  id: string;
  title: string;
  date: string;
  duration: string;
  count: string;
  image?: string;
  meeting?: Meeting;
};

type MeetingLaunchPreview = {
  meeting: Meeting;
  status: 'ready' | 'too-early' | 'ended' | 'forbidden';
  title: string;
  message: string;
  startLabel: string;
  endLabel: string;
  participantLabel: string;
  isOrganizer: boolean;
  isParticipant: boolean;
  canCopyLink: boolean;
  primaryAction: 'launch' | 'join';
};

type MeetingType = 'video' | 'audio';
type MeetingCreateAction = 'save' | 'launch' | 'message' | 'actus' | 'status' | 'device';
type MeetingShareAction = Exclude<MeetingCreateAction, 'save' | 'launch'>;

const MEETING_DRAFTS_STORAGE_KEY = 'mbote.meeting.drafts';
const MAX_MEETING_PREVIEW_CARDS = 3;

type NewMeetingSettings = {
  waitingRoom: boolean;
  coverImage: string;
  timeZone: string;
  participantAudio: boolean;
  participantVideo: boolean;
  screenShare: boolean;
  password: string;
  encryption: boolean;
  joinBeforeHost: boolean;
  chat: boolean;
  reactions: boolean;
  lunaSummary: boolean;
  linkSharing: boolean;
  externalAccess: boolean;
  participantCapacity: number;
  meetingAccessId: string;
};

type MeetingTimeZoneOption = {
  value: string;
  label: string;
};

const meetingTimeZoneOptions: MeetingTimeZoneOption[] = [
  { value: 'Africa/Brazzaville', label: '(GMT+1) Brazzaville' },
  { value: 'Europe/Paris', label: '(GMT+1/+2) Paris' },
  { value: 'Africa/Kinshasa', label: '(GMT+1) Kinshasa' },
  { value: 'Africa/Lagos', label: '(GMT+1) Lagos' },
  { value: 'Africa/Johannesburg', label: '(GMT+2) Johannesburg' },
  { value: 'Africa/Abidjan', label: '(GMT+0) Abidjan' },
  { value: 'America/New_York', label: '(GMT-5/-4) New York' },
];

const getDefaultMeetingTimeZone = () => {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return meetingTimeZoneOptions.some((option) => option.value === browserTimeZone)
    ? browserTimeZone
    : 'Africa/Brazzaville';
};

const formatMeetingTimeZone = (value: string) => (
  meetingTimeZoneOptions.find((option) => option.value === value)?.label || value
);

const toDateInputValue = (date: Date) => {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toTimeInputValue = (date: Date) => {
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const getRoundedMeetingStartDate = () => {
  const now = new Date();
  const rounded = new Date(now);
  const minutes = Math.ceil(now.getMinutes() / 5) * 5;
  rounded.setMinutes(minutes >= 60 ? 0 : minutes, 0, 0);
  if (minutes >= 60) rounded.setHours(rounded.getHours() + 1);
  return rounded;
};
const generateMeetingAccessId = () => {
  const digits = Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join('');
  return digits.replace(/^0/, '9');
};

const saveMeetingDraft = (payload: {
  type: MeetingType;
  title: string;
  description: string;
  startTime: string;
  duration: number;
  participants: string[];
  settings: NewMeetingSettings;
}) => {
  const currentDrafts = JSON.parse(localStorage.getItem(MEETING_DRAFTS_STORAGE_KEY) || '[]');
  const nextDraft = {
    id: `meeting-draft-${Date.now()}`,
    savedAt: new Date().toISOString(),
    ...payload,
  };
  localStorage.setItem(MEETING_DRAFTS_STORAGE_KEY, JSON.stringify([nextDraft, ...(Array.isArray(currentDrafts) ? currentDrafts : [])].slice(0, 30)));
  return nextDraft;
};

const meetingFeatures = [
  { label: 'Sous-titres', icon: Captions, tone: 'purple' },
  { label: 'Enregistrement', icon: CircleDot, tone: 'pink' },
  { label: 'Partager écran', icon: ScreenShare, tone: 'green' },
  { label: 'Levée de main', icon: Hand, tone: 'violet' },
  { label: 'Salles de sous-groupe', icon: UsersRound, tone: 'blue' },
  { label: 'Sondages', icon: BarChart3, tone: 'amber' },
  { label: 'Chat', icon: MessageCircle, tone: 'purple' },
];

const formatMeeting = (meeting: Meeting): UpcomingMeeting => {
  const start = new Date(meeting.start_time);
  const end = new Date(start.getTime() + meeting.duration * 60_000);
  const participantCount = Math.max(1, meeting.participant_count || 1);

  return {
    id: String(meeting.id),
    day: format(start, 'dd', { locale: fr }),
    month: format(start, 'MMM', { locale: fr }).replace('.', '').toUpperCase(),
    title: meeting.title,
    time: `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`,
    participants: `${participantCount} participant${participantCount > 1 ? 's' : ''}`,
    meeting,
  };
};

const formatMeetingDuration = (minutes: number) => {
  const safeMinutes = Math.max(1, Number(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  if (hours <= 0) return `${safeMinutes} min`;
  return rest > 0 ? `${hours} h ${rest}` : `${hours} h`;
};

const getMeetingCoverImage = (meeting: Meeting) => {
  const coverImage = String(meeting.settings?.coverImage || '').trim();
  return coverImage || undefined;
};

const formatRecentMeeting = (meeting: Meeting): RecentMeeting => {
  const duration = Number(meeting.duration || 0);
  return {
    id: String(meeting.id),
    title: meeting.title,
    date: format(new Date(meeting.start_time), 'dd MMM yyyy', { locale: fr }),
    duration: formatMeetingDuration(duration),
    count: String(Math.max(1, meeting.participant_count || 1)),
    image: getMeetingCoverImage(meeting),
    meeting,
  };
};

const formatLaunchDateTime = (date: Date) => (
  Number.isNaN(date.getTime()) ? 'Date inconnue' : format(date, "dd MMM yyyy 'a' HH:mm", { locale: fr })
);

const buildMeetingLaunchPreview = (meeting: Meeting, currentUserId?: string | number): MeetingLaunchPreview => {
  const startAt = new Date(meeting.start_time);
  const duration = Math.max(15, Number(meeting.duration || 30));
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  const participantCount = Math.max(1, meeting.participant_count || 1);
  const userId = String(currentUserId || '');
  const participantIds = (meeting.settings?.participants || []).map((participantId) => String(participantId));
  const isOrganizer = String(meeting.host_id) === userId || String(meeting.co_host_id || '') === userId;
  const isParticipant = isOrganizer || participantIds.includes(userId);
  const now = Date.now();
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  const isFutureMeeting = Number.isFinite(startMs) && now < startMs;
  const canCopyLink = Boolean(
    meeting.is_active
    || isParticipant
    || isOrganizer
    || meeting.settings?.linkSharing
    || meeting.settings?.externalAccess
    || isFutureMeeting
  );
  const participantLabel = `${participantCount} participant${participantCount > 1 ? 's' : ''}`;
  const base = {
    meeting,
    startLabel: formatLaunchDateTime(startAt),
    endLabel: formatLaunchDateTime(endAt),
    participantLabel,
    isOrganizer,
    isParticipant,
    canCopyLink,
  };

  if (!isOrganizer && meeting.is_active && isParticipant) {
    return {
      ...base,
      status: 'ready',
      title: 'Pret a rejoindre',
      message: 'La réunion est en cours. Vous pouvez rejoindre la salle maintenant.',
      primaryAction: 'join',
    };
  }

  if (!isOrganizer) {
    return {
      ...base,
      status: isFutureMeeting ? 'too-early' : 'forbidden',
      title: isFutureMeeting ? 'Réunion programmée' : 'Accès hôte requis',
      message: isFutureMeeting
        ? 'Cette réunion est programmée. Le lien reste disponible selon les autorisations de partage.'
        : "Seul l'hôte ou le co-hôte peut lancer cette réunion programmée.",
      primaryAction: 'join',
    };
  }

  if (isFutureMeeting) {
    const minutes = Math.max(1, Math.ceil((startMs - now) / 60_000));
    return {
      ...base,
      status: 'too-early',
      title: 'Reunion pas encore disponible',
      message: `Cette réunion commence dans ${minutes} min. MBote la lancera à l'heure prévue.`,
      primaryAction: 'launch',
    };
  }

  if (Number.isFinite(endMs) && now > endMs && !meeting.is_active) {
    return {
      ...base,
      status: 'ended',
      title: 'Creneau termine',
      message: 'Le créneau de cette réunion est déjà terminé. Planifiez une nouvelle session pour notifier les participants.',
      primaryAction: 'launch',
    };
  }

  return {
    ...base,
    status: 'ready',
    title: 'Pret a lancer',
    message: 'Le créneau est ouvert. Les participants seront notifiés avant votre entrée dans la salle.',
    primaryAction: 'launch',
  };
};

export default function MeetingList() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [pendingScheduleStartTime, setPendingScheduleStartTime] = useState<string | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [adSlides, setAdSlides] = useState<MeetingAdSlide[]>(defaultPublicSettings.meetingAdSlides);
  const [activeAdIndex, setActiveAdIndex] = useState(0);
  const [launchPreview, setLaunchPreview] = useState<MeetingLaunchPreview | null>(null);
  const [launchError, setLaunchError] = useState('');
  const [recentMenuId, setRecentMenuId] = useState<string | null>(null);
  const [pendingDeleteMeeting, setPendingDeleteMeeting] = useState<Meeting | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [editingMeetingBusy, setEditingMeetingBusy] = useState(false);
  const [deletingMeetingId, setDeletingMeetingId] = useState<number | null>(null);
  const upcomingRef = useRef<HTMLDivElement | null>(null);
  const recentRef = useRef<HTMLDivElement | null>(null);
  const currentUser = authService.getCurrentUser();

  const openNewMeetingModal = () => {
    setPendingScheduleStartTime(null);
    setShowNewMeeting(true);
  };

  const fetchMeetings = async () => {
    try {
      const data = await meetingService.getMeetings();
      setMeetings(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch meetings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
    publicSettingsService.getPublicSettings().then((settings) => {
      const slides = settings.meetingAdSlides.filter((slide) => slide.active);
      setAdSlides(slides.length > 0 ? slides : defaultPublicSettings.meetingAdSlides);
    });
  }, []);

  useEffect(() => {
    if (adSlides.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveAdIndex((index) => (index + 1) % adSlides.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [adSlides.length]);

  useEffect(() => {
    const openSchedule = () => {
      setPendingScheduleStartTime(null);
      setShowSchedule(true);
    };
    window.addEventListener('open-schedule-meeting', openSchedule);
    return () => window.removeEventListener('open-schedule-meeting', openSchedule);
  }, []);

  const upcomingMeetings = useMemo(() => {
    const now = Date.now();
    const apiMeetings = meetings
      .filter((meeting) => new Date(meeting.start_time).getTime() >= now - 3_600_000)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .map(formatMeeting);

    return showAllUpcoming ? apiMeetings : apiMeetings.slice(0, MAX_MEETING_PREVIEW_CARDS);
  }, [meetings, showAllUpcoming]);

  const recentMeetingCards = useMemo(() => {
    const now = Date.now();
    const apiRecents = meetings
      .filter((meeting) => new Date(meeting.start_time).getTime() < now - 3_600_000 || meeting.is_active)
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
      .map(formatRecentMeeting);
    return showAllRecent ? apiRecents : apiRecents.slice(0, MAX_MEETING_PREVIEW_CARDS);
  }, [meetings, showAllRecent]);
  const recentMeetingCount = useMemo(() => {
    const now = Date.now();
    return meetings.filter((meeting) => new Date(meeting.start_time).getTime() < now - 3_600_000 || meeting.is_active).length;
  }, [meetings]);
  const hasMoreRecentMeetings = recentMeetingCount > MAX_MEETING_PREVIEW_CARDS;

  useEffect(() => {
    if (!hasMoreRecentMeetings && showAllRecent) {
      setShowAllRecent(false);
    }
  }, [hasMoreRecentMeetings, showAllRecent]);

  const canShareMeeting = (meeting?: Meeting) => {
    if (!meeting) return false;
    const userId = String(currentUser?.id || '');
    const isOrganizer = String(meeting.host_id) === userId || String(meeting.co_host_id || '') === userId;
    return isOrganizer || Boolean(meeting.settings?.linkSharing) || Boolean(meeting.settings?.externalAccess);
  };
  const canManageMeeting = (meeting?: Meeting) => {
    if (!meeting) return false;
    const userId = String(currentUser?.id || '');
    return String(meeting.host_id) === userId || String(meeting.co_host_id || '') === userId;
  };

  const activeHeroSlide = adSlides[activeAdIndex] || adSlides[0] || defaultPublicSettings.meetingAdSlides[0];
  const handleHeroImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.dataset.fallbackApplied === 'true') return;
    image.dataset.fallbackApplied = 'true';
    image.src = '/mbote-login-watermark.png';
    image.classList.add('is-fallback');
  };

  const copyMeetingLink = async (meeting?: Meeting) => {
    if (meeting && !canShareMeeting(meeting)) {
      setCopiedId('blocked');
      window.setTimeout(() => setCopiedId(null), 1800);
      return;
    }
    const value = meeting ? getMeetingJoinUrl(meeting) : `${window.location.origin}/app`;
    await navigator.clipboard.writeText(value);
    setCopiedId(meeting ? String(meeting.id) : 'page');
    window.setTimeout(() => setCopiedId(null), 1800);
  };

  const startInstantMeeting = async () => {
    if (!currentUser || isStarting) {
      setShowNewMeeting(true);
      return;
    }

    setIsStarting(true);
    try {
      const instantMeeting = await meetingService.scheduleMeeting({
        title: 'Réunion instantanée',
        description: 'Réunion lancée depuis MBoté.',
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
        },
      });

      setMeetings((current) => [instantMeeting, ...current]);
      setActiveMeeting(instantMeeting);
    } catch (error) {
      console.error('Failed to start instant meeting:', error);
      setShowNewMeeting(true);
    } finally {
      setIsStarting(false);
    }
  };

  const joinWithLink = () => {
    const codeOrLink = window.prompt('Collez le lien ou le code de réunion');
    const value = codeOrLink?.trim();
    if (!value) return;

    if (value.startsWith('http')) {
      window.location.href = value;
      return;
    }

    window.location.href = `/join/${encodeURIComponent(value)}`;
  };

  const handleJoin = (meeting?: Meeting) => {
    if (meeting) {
      setActiveMeeting(meeting);
      return;
    }

    startInstantMeeting();
  };

  const openScheduledMeeting = (meeting?: Meeting) => {
    if (!meeting) {
      startInstantMeeting();
      return;
    }
    setRecentMenuId(null);
    setLaunchError('');
    setLaunchPreview(buildMeetingLaunchPreview(meeting, currentUser?.id));
  };

  const toggleRecentMenu = (event: MouseEvent<HTMLButtonElement>, recentId: string) => {
    event.stopPropagation();
    setRecentMenuId((current) => (current === recentId ? null : recentId));
  };

  const requestDeleteRecentMeeting = (meeting?: Meeting) => {
    if (!meeting || deletingMeetingId) return;
    setRecentMenuId(null);
    setPendingDeleteMeeting(meeting);
  };
  const requestEditRecentMeeting = (meeting?: Meeting) => {
    if (!meeting || !canManageMeeting(meeting)) return;
    setRecentMenuId(null);
    setEditingMeeting(meeting);
  };

  const updateRecentMeeting = async (meeting: Meeting, payload: ScheduleMeetingPayload) => {
    if (editingMeetingBusy || !canManageMeeting(meeting)) return;
    setEditingMeetingBusy(true);
    try {
      const updatedMeeting = await meetingService.updateMeeting(meeting.id, payload);
      setMeetings((current) => current.map((item) => (item.id === updatedMeeting.id ? { ...item, ...updatedMeeting } : item)));
      setEditingMeeting(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Modification de réunion impossible.';
      window.alert(message);
    } finally {
      setEditingMeetingBusy(false);
    }
  };

  const deleteRecentMeeting = async () => {
    const meeting = pendingDeleteMeeting;
    if (!meeting || deletingMeetingId) return;

    setRecentMenuId(null);
    setDeletingMeetingId(meeting.id);
    try {
      await meetingService.deleteMeeting(meeting.id);
      setMeetings((current) => current.filter((item) => item.id !== meeting.id));
      setPendingDeleteMeeting(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Suppression de réunion impossible.';
      window.alert(message);
    } finally {
      setDeletingMeetingId(null);
    }
  };

  const launchScheduledMeeting = async () => {
    if (!launchPreview || launchPreview.status !== 'ready' || isStarting) return;
    if (launchPreview.primaryAction === 'join') {
      setActiveMeeting(launchPreview.meeting);
      setLaunchPreview(null);
      return;
    }

    setIsStarting(true);
    setLaunchError('');
    try {
      const result = await meetingService.startMeetingAndNotify(launchPreview.meeting.id);
      const nextMeeting = result.meeting || { ...launchPreview.meeting, is_active: true };
      setMeetings((current) => current.map((meeting) => (
        meeting.id === nextMeeting.id ? { ...meeting, ...nextMeeting } : meeting
      )));
      setLaunchPreview(null);
      setActiveMeeting(nextMeeting);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Demarrage impossible.';
      setLaunchError(message);
      setLaunchPreview((current) => current ? {
        ...current,
        status: message.toLowerCase().includes('termine') ? 'ended' : message.toLowerCase().includes('commence') ? 'too-early' : current.status,
        title: message.toLowerCase().includes('termine') ? 'Creneau termine' : current.title,
        message,
      } : current);
    } finally {
      setIsStarting(false);
    }
  };

  const openJoinPage = () => {
    window.location.href = '/join';
  };

  const closeTitleMenu = () => setTitleMenuOpen(false);

  const handleTitleJoin = () => {
    closeTitleMenu();
    openJoinPage();
  };

  const handleTitlePlan = () => {
    closeTitleMenu();
    setPendingScheduleStartTime(null);
    setShowSchedule(true);
  };

  if (activeMeeting) {
    return <MeetingRoom meeting={activeMeeting} onLeave={() => setActiveMeeting(null)} />;
  }

  return (
    <div className="meeting-page-shell">
      <main className="meeting-page" aria-label="Réunion MBoté">
        <div className="meeting-titlebar">
          <h1>Réunion</h1>
          <div className="meeting-title-menu">
            <button
              type="button"
              className="meeting-title-menu-button"
              aria-label="Options de réunion"
              aria-haspopup="menu"
              aria-expanded={titleMenuOpen}
              onClick={() => setTitleMenuOpen((value) => !value)}
            >
              <MoreVertical size={23} strokeWidth={3} />
            </button>
            {titleMenuOpen && (
              <>
                <button
                  type="button"
                  className="meeting-title-menu-backdrop"
                  aria-label="Fermer le menu des réunions"
                  onClick={closeTitleMenu}
                />
                <div className="meeting-title-menu-panel" role="menu">
                  <button type="button" role="menuitem" onClick={handleTitleJoin}>
                    <Link2 size={18} strokeWidth={2.8} />
                    Rejoindre
                  </button>
                  <button type="button" role="menuitem" onClick={handleTitlePlan}>
                    <CalendarDays size={18} strokeWidth={2.8} />
                    Planifier
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <section className="meeting-hero" aria-label="Démarrer une réunion">
          <div className="meeting-hero-copy">
            <div className="meeting-video-badge">
              <Video size={31} fill="currentColor" strokeWidth={0} />
            </div>
            <h2>Démarrer une réunion</h2>
            <p>Lancez une réunion instantanée et invitez vos contacts.</p>
            <button
              className="meeting-new-button"
              type="button"
              onClick={openNewMeetingModal}
              onPointerUp={openNewMeetingModal}
              aria-haspopup="dialog"
              aria-expanded={showNewMeeting}
            >
              <Video size={24} fill="currentColor" strokeWidth={0} />
              {isStarting ? 'Création...' : 'Nouvelle réunion'}
            </button>
          </div>

          <div className="meeting-hero-slider" aria-label="Images de réunion">
            {adSlides.map((slide, index) => (
              <img
                key={`${slide.title}-${index}`}
                src={slide.imageUrl || activeHeroSlide.imageUrl || '/mbote-login-watermark.png'}
                alt=""
                className={index === activeAdIndex ? 'is-active' : ''}
                onError={handleHeroImageError}
              />
            ))}
            <div className="meeting-hero-slider-copy">
              <span>{activeHeroSlide.title}</span>
            </div>
            <div className="meeting-hero-slider-dots">
              {adSlides.map((slide, index) => (
                <button
                  type="button"
                  key={`hero-${slide.title}-${index}`}
                  className={index === activeAdIndex ? 'is-active' : ''}
                  onClick={() => setActiveAdIndex(index)}
                  aria-label={`Afficher l'image ${index + 1}`}
                />
              ))}
            </div>
          </div>
        </section>

        <section className={`meeting-panel meeting-upcoming${!isLoading && upcomingMeetings.length === 0 ? ' is-empty' : ''}`} ref={upcomingRef}>
          <div className="meeting-section-head">
            <h2>Réunions à venir</h2>
            <button type="button" onClick={() => setShowAllUpcoming((value) => !value)}>
              {showAllUpcoming ? 'Réduire' : 'Voir tout'}
            </button>
          </div>

          {isLoading ? (
            <div className="meeting-loading">
              <span />
              Chargement des réunions...
            </div>
          ) : upcomingMeetings.length > 0 ? (
            upcomingMeetings.map((meeting) => (
              <article className="meeting-upcoming-row" key={meeting.id}>
                <div className="meeting-date-card">
                  <strong>{meeting.day}</strong>
                  <span>{meeting.month}</span>
                </div>
                <div className="meeting-row-copy">
                  <h3>{meeting.title}</h3>
                  <p>
                    <Clock3 size={18} />
                    {meeting.time}
                    <Users size={18} />
                    {meeting.participants}
                  </p>
                </div>
                <div className="meeting-row-actions">
                  <button type="button" onClick={() => openScheduledMeeting(meeting.meeting)}>
                    Rejoindre
                  </button>
                  {meeting.meeting && canShareMeeting(meeting.meeting) && (
                    <button type="button" className="meeting-share-row-button" onClick={() => copyMeetingLink(meeting.meeting)}>
                      {copiedId === String(meeting.meeting.id) ? <Check size={16} /> : <Share2 size={16} />}
                      Partager
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="meeting-empty-state">Aucune réunion programmée pour le moment.</div>
          )}
        </section>

        <section className="meeting-panel meeting-recents" ref={recentRef}>
          <div className="meeting-section-head">
            <h2>Réunions récentes</h2>
            {hasMoreRecentMeetings && (
              <button type="button" onClick={() => setShowAllRecent((value) => !value)}>
                {showAllRecent ? 'Réduire' : 'Voir tout'}
              </button>
            )}
          </div>

          <div className="meeting-recent-grid">
            {recentMeetingCards.length > 0 ? recentMeetingCards.map((recent) => (
              <article
                className="meeting-recent-card"
                key={recent.id}
                tabIndex={0}
                role="button"
                aria-label={`Verifier ${recent.title}`}
                onClick={() => openScheduledMeeting(recent.meeting)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openScheduledMeeting(recent.meeting);
                  }
                }}
              >
                {recent.image && (
                  <div className="meeting-recent-media">
                    <img src={recent.image} alt="" />
                    <span className="meeting-duration">{recent.duration}</span>
                    {recent.count && <span className="meeting-count">{recent.count}</span>}
                  </div>
                )}
                <div className="meeting-recent-foot">
                  <div>
                    <h3>{recent.title}</h3>
                    <p>{recent.date}</p>
                  </div>
                  <div className="meeting-recent-options" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      aria-label={`Options pour ${recent.title}`}
                      aria-haspopup="menu"
                      aria-expanded={recentMenuId === recent.id}
                      onClick={(event) => toggleRecentMenu(event, recent.id)}
                    >
                      <MoreVertical size={22} strokeWidth={3} />
                    </button>
                    {recentMenuId === recent.id && (
                      <div className="meeting-recent-options-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => openScheduledMeeting(recent.meeting)}>
                          <Video size={17} strokeWidth={2.6} />
                          Vérifier
                        </button>
                        {recent.meeting && canShareMeeting(recent.meeting) && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={async () => {
                              await copyMeetingLink(recent.meeting);
                              setRecentMenuId(null);
                            }}
                          >
                            {copiedId === String(recent.meeting.id) ? <Check size={17} strokeWidth={2.6} /> : <Share2 size={17} strokeWidth={2.6} />}
                            {copiedId === String(recent.meeting.id) ? 'Lien copié' : 'Copier le lien'}
                          </button>
                        )}
                        {canManageMeeting(recent.meeting) && (
                          <button type="button" role="menuitem" onClick={() => requestEditRecentMeeting(recent.meeting)}>
                            <Pencil size={17} strokeWidth={2.6} />
                            Modifier
                          </button>
                        )}
                        {canManageMeeting(recent.meeting) && (
                          <button
                            type="button"
                            role="menuitem"
                            className="meeting-recent-options-danger"
                            disabled={!recent.meeting || deletingMeetingId === recent.meeting.id}
                            onClick={() => requestDeleteRecentMeeting(recent.meeting)}
                          >
                            <Trash2 size={17} strokeWidth={2.6} />
                            {recent.meeting && deletingMeetingId === recent.meeting.id ? 'Suppression...' : 'Supprimer'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            )) : (
              <div className="meeting-empty-state">Aucune réunion récente trouvée.</div>
            )}
          </div>
        </section>

        <section className="meeting-panel meeting-features">
          <h2>Fonctionnalités</h2>
          <div className="meeting-feature-row">
            {meetingFeatures.map((feature) => {
              const Icon = feature.icon;
              return (
                <button type="button" key={feature.label}>
                  <span className={`meeting-feature-icon meeting-feature-${feature.tone}`}>
                    <Icon size={26} fill={feature.icon === CircleDot ? 'currentColor' : 'none'} strokeWidth={feature.icon === Captions ? 0 : 2.8} />
                    {feature.icon === Captions && <strong>CC</strong>}
                  </span>
                  {feature.label}
                </button>
              );
            })}
          </div>
        </section>

        <MeetingAdSlider slides={adSlides} activeIndex={activeAdIndex} onSelect={setActiveAdIndex} />
      </main>

      <AnimatePresence>
        {showNewMeeting && (
          <NewMeetingModal
            isStarting={isStarting}
            initialStartTime={pendingScheduleStartTime}
            onClose={() => {
              setShowNewMeeting(false);
              setPendingScheduleStartTime(null);
            }}
            onCreate={async (payload) => {
              if (!currentUser || isStarting) {
                setShowNewMeeting(false);
                setShowSchedule(true);
                return;
              }

              setIsStarting(true);
              try {
                if (payload.action === 'save') {
                  saveMeetingDraft(payload);
                  setShowNewMeeting(false);
                  setPendingScheduleStartTime(null);
                  setCopiedId('meeting-draft');
                  window.setTimeout(() => setCopiedId(null), 1800);
                  return;
                }
                const instantMeeting = await meetingService.scheduleMeeting({
                  title: payload.title || 'Réunion instantanée',
                  description: payload.description,
                  startTime: payload.startTime,
                  duration: payload.duration,
                  settings: {
                    callType: payload.type,
                    ...payload.settings,
                  },
                  participants: payload.participants,
                });

                setMeetings((current) => [instantMeeting, ...current]);
                setShowNewMeeting(false);
                setPendingScheduleStartTime(null);
                if (payload.action === 'launch') {
                  setActiveMeeting(instantMeeting);
                } else {
                  const sharePayload = {
                    channel: payload.action,
                    title: instantMeeting.title,
                    link: getMeetingJoinUrl(instantMeeting),
                    meetingId: instantMeeting.id,
                  };
                  localStorage.setItem('pendingMeetingShare', JSON.stringify(sharePayload));
                  await navigator.clipboard.writeText(sharePayload.link).catch(() => undefined);
                  if (payload.action === 'actus') window.dispatchEvent(new CustomEvent('mbote-open-tab', { detail: 'actus' }));
                  if (payload.action === 'message') window.dispatchEvent(new CustomEvent('mbote-open-tab', { detail: 'dashboard' }));
                  setCopiedId(String(instantMeeting.id));
                  window.setTimeout(() => setCopiedId(null), 1800);
                }
              } catch (error) {
                console.error('Failed to create meeting:', error);
              } finally {
                setIsStarting(false);
              }
            }}
          />
        )}

        {showSchedule && (
          <ScheduleMeetingDatePicker
            onClose={() => setShowSchedule(false)}
            onConfirm={(startTime) => {
              setPendingScheduleStartTime(startTime);
              setShowSchedule(false);
              setShowNewMeeting(true);
            }}
          />
        )}

        {launchPreview && (
          <MeetingLaunchPreviewModal
            preview={launchPreview}
            isStarting={isStarting}
            error={launchError}
            onClose={() => {
              setLaunchPreview(null);
              setLaunchError('');
            }}
            onCopy={() => launchPreview.canCopyLink && copyMeetingLink(launchPreview.meeting)}
            onLaunch={launchScheduledMeeting}
          />
        )}
        {editingMeeting && (
          <MeetingEditModal
            meeting={editingMeeting}
            isSaving={editingMeetingBusy}
            onCancel={() => setEditingMeeting(null)}
            onSave={(payload) => updateRecentMeeting(editingMeeting, payload)}
          />
        )}

        {pendingDeleteMeeting && (
          <MeetingDeleteConfirmModal
            meeting={pendingDeleteMeeting}
            isDeleting={deletingMeetingId === pendingDeleteMeeting.id}
            onCancel={() => setPendingDeleteMeeting(null)}
            onConfirm={deleteRecentMeeting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function formatMeetingDateInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatMeetingTimeInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '09:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function MeetingEditModal({
  meeting,
  isSaving,
  onCancel,
  onSave,
}: {
  meeting: Meeting;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (payload: ScheduleMeetingPayload) => void;
}) {
  const [title, setTitle] = useState(meeting.title || '');
  const [description, setDescription] = useState(meeting.description || '');
  const [date, setDate] = useState(formatMeetingDateInput(meeting.start_time));
  const [time, setTime] = useState(formatMeetingTimeInput(meeting.start_time));
  const [duration, setDuration] = useState(String(meeting.duration || 60));
  const [coverImage, setCoverImage] = useState(meeting.settings?.coverImage || '');
  const [error, setError] = useState('');

  const handleCoverImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choisissez une image valide.');
      return;
    }
    if (file.size > 1_500_000) {
      setError("L'image doit faire moins de 1,5 Mo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setError('');
      setCoverImage(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError('Le titre est requis.');
      return;
    }
    const normalizedDuration = Math.max(15, Math.min(480, Number.parseInt(duration, 10) || 60));
    onSave({
      title: normalizedTitle,
      description: description.trim(),
      startTime: new Date(`${date}T${time || '09:00'}`).toISOString(),
      duration: normalizedDuration,
      settings: {
        ...(meeting.settings || {}),
        coverImage,
      },
    });
  };

  return (
    <motion.div
      className="meeting-delete-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.form
        className="meeting-edit-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-edit-title"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header>
          <span aria-hidden="true"><Pencil size={23} strokeWidth={2.8} /></span>
          <div>
            <small>Réunion</small>
            <h2 id="meeting-edit-title">Modifier la réunion</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Fermer"><X size={20} /></button>
        </header>
        <label>
          <span>Titre</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
        </label>
        <label>
          <span>Description</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={220} />
        </label>
        <div className="meeting-edit-grid">
          <label>
            <span>Date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            <span>Heure</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <label>
            <span>Durée</span>
            <input type="number" min="15" max="480" value={duration} onChange={(event) => setDuration(event.target.value)} />
          </label>
        </div>
        <label className="meeting-edit-cover">
          <span>Image</span>
          <input type="file" accept="image/*" onChange={handleCoverImageChange} />
          {coverImage ? <img src={coverImage} alt="" /> : <b>Aucune image personnalisée</b>}
        </label>
        {coverImage && <button type="button" className="meeting-edit-secondary" onClick={() => setCoverImage('')}>Retirer l'image</button>}
        {error && <p className="meeting-edit-error">{error}</p>}
        <footer>
          <button type="button" onClick={onCancel} disabled={isSaving}>Annuler</button>
          <button type="submit" className="primary" disabled={isSaving}>{isSaving ? 'Enregistrement...' : 'Enregistrer'}</button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
function ScheduleMeetingDatePicker({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (startTime: string) => void;
}) {
  const defaultStart = getRoundedMeetingStartDate();
  const [date, setDate] = useState(toDateInputValue(defaultStart));
  const [time, setTime] = useState(toTimeInputValue(defaultStart));
  const [error, setError] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const startDate = new Date(`${date}T${time || '09:00'}`);
    if (!date || !time || Number.isNaN(startDate.getTime())) {
      setError('Choisissez une date et une heure valides.');
      return;
    }
    if (startDate.getTime() < Date.now() - 60_000) {
      setError('Choisissez une date ou une heure a venir.');
      return;
    }
    setError('');
    onConfirm(startDate.toISOString());
  };

  return (
    <motion.div
      className="meeting-schedule-picker-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.form
        className="meeting-schedule-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-schedule-picker-title"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header>
          <span aria-hidden="true"><CalendarDays size={24} strokeWidth={2.8} /></span>
          <div>
            <small>Planifier</small>
            <h2 id="meeting-schedule-picker-title">Date et heure</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </header>
        <p>Choisissez d'abord le créneau de la réunion. La configuration s'ouvrira ensuite avec ces informations.</p>
        <div className="meeting-schedule-picker-grid">
          <label>
            <span>Date</span>
            <input type="date" value={date} min={toDateInputValue(new Date())} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            <span>Heure</span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </label>
        </div>
        {error && <strong className="meeting-schedule-picker-error">{error}</strong>}
        <footer>
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">Configurer la réunion</button>
        </footer>
      </motion.form>
    </motion.div>
  );
}
function MeetingDeleteConfirmModal({
  meeting,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  meeting: Meeting;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div
      className="meeting-delete-backdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.section
        className="meeting-delete-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-delete-title"
        initial={{ opacity: 0, y: 18, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="meeting-delete-icon" aria-hidden="true">
          <Trash2 size={25} strokeWidth={2.8} />
        </span>
        <h2 id="meeting-delete-title">Supprimer cette réunion ?</h2>
        <p>La réunion <strong>{meeting.title}</strong> sera supprimée définitivement de votre liste.</p>
        <footer>
          <button type="button" onClick={onCancel} disabled={isDeleting}>Annuler</button>
          <button type="button" className="danger" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Suppression...' : 'Supprimer'}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}
function MeetingLaunchPreviewModal({
  preview,
  isStarting,
  error,
  onClose,
  onCopy,
  onLaunch,
}: {
  preview: MeetingLaunchPreview;
  isStarting: boolean;
  error: string;
  onClose: () => void;
  onCopy: () => void;
  onLaunch: () => void;
}) {
  const canLaunch = preview.status === 'ready';
  const primaryLabel = preview.primaryAction === 'join' ? 'Rejoindre' : 'Lancer et notifier';

  return (
    <motion.div
      className="meeting-launch-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-launch-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.section
        className={`meeting-launch-card meeting-launch-${preview.status}`}
        initial={{ y: 20, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      >
        <header>
          <span>
            {canLaunch ? <Video size={23} fill="currentColor" strokeWidth={0} /> : <Clock3 size={23} strokeWidth={2.8} />}
          </span>
          <div>
            <small>{preview.meeting.is_active ? 'Reunion active' : 'Verification horaire'}</small>
            <h3 id="meeting-launch-title">{preview.title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer">
            <X size={20} />
          </button>
        </header>

        <div className="meeting-launch-summary">
          <strong>{preview.meeting.title}</strong>
          <p>{preview.message}</p>
          {error && <p className="meeting-launch-error">{error}</p>}
        </div>

        <div className="meeting-launch-details">
          <div>
            <CalendarDays size={18} />
            <span>Debut</span>
            <strong>{preview.startLabel}</strong>
          </div>
          <div>
            <Clock3 size={18} />
            <span>Fin prevue</span>
            <strong>{preview.endLabel}</strong>
          </div>
          <div>
            <Users size={18} />
            <span>Audience</span>
            <strong>{preview.participantLabel}</strong>
          </div>
          <div>
            <ShieldCheck size={18} />
            <span>Securite</span>
            <strong>{preview.meeting.settings?.waitingRoom ? 'Salle attente active' : 'Acces direct'}</strong>
          </div>
        </div>

        <footer>
          <button type="button" onClick={onCopy} disabled={!preview.canCopyLink}>
            <Link2 size={18} />
            Copier le lien
          </button>
          <button type="button" className="primary" disabled={!canLaunch || isStarting} onClick={onLaunch}>
            <Video size={18} fill="currentColor" strokeWidth={0} />
            {isStarting ? 'Notification...' : primaryLabel}
          </button>
        </footer>
      </motion.section>
    </motion.div>
  );
}

function MeetingAdSlider({ slides, activeIndex, onSelect }: { slides: MeetingAdSlide[]; activeIndex: number; onSelect: (index: number) => void }) {
  const activeSlide = slides[activeIndex] || slides[0] || defaultPublicSettings.meetingAdSlides[0];
  const handlePublicImageError = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.dataset.fallbackApplied === 'true') return;
    image.dataset.fallbackApplied = 'true';
    image.src = '/favicon.svg';
    image.classList.add('bg-violet-100', 'object-contain', 'p-10');
  };
  const openAd = () => {
    if (!activeSlide?.ctaUrl) return;
    if (activeSlide.ctaUrl.startsWith('/')) {
      window.location.href = activeSlide.ctaUrl;
      return;
    }
    window.open(activeSlide.ctaUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="meeting-panel meeting-ad-panel" aria-label="Publicite Reunion">
      <div className="meeting-ad-media">
        <img src={activeSlide.imageUrl || '/mbote-login-watermark.png'} alt="" onError={handlePublicImageError} />
      </div>
      <div className="meeting-ad-copy">
        <span>Publicite</span>
        <h2>{activeSlide.title}</h2>
        <p>{activeSlide.description}</p>
        <button type="button" onClick={openAd}>{activeSlide.ctaLabel || 'Ouvrir'}</button>
      </div>
      <div className="meeting-ad-dots">
        {slides.map((slide, index) => (
          <button
            type="button"
            key={`${slide.title}-${index}`}
            className={index === activeIndex ? 'is-active' : ''}
            onClick={() => onSelect(index)}
            aria-label={`Afficher la publicité ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}

function MeetingSummaryModal({
  title,
  type,
  date,
  time,
  duration,
  participants,
  settings,
  isStarting,
  onBack,
  onClose,
  onConfirm,
}: {
  title: string;
  type: MeetingType;
  date: string;
  time: string;
  duration: string;
  participants: MeetingParticipantSuggestion[];
  settings: NewMeetingSettings;
  isStarting: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: (action: MeetingCreateAction) => void;
}) {
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const rows = [
    ['Type', type === 'video' ? 'Video' : 'Audio'],
    ['Date', `${date} a ${time}`],
    ['Fuseau', formatMeetingTimeZone(settings.timeZone)],
    ['Duree', `${duration || 60} min`],
    ['Participants', `${Math.max(settings.participantCapacity || 1, participants.length + 1)} au total`],
    ['Salle attente', settings.waitingRoom ? 'Activee' : 'Desactivee'],
    ['Micro participants', settings.participantAudio ? 'Autorisé' : 'Coupé au départ'],
    ['Camera participants', settings.participantVideo ? 'Autorisée' : 'Coupée au départ'],
    ['Résumé Luna IA', settings.lunaSummary ? 'Activé' : 'Désactivé'],
    ['Partage lien', settings.linkSharing ? 'Autorisé' : "Réservé ? l'hôte"],
    ['Accès élargi', settings.externalAccess ? 'Autorisé' : 'Participants invites seulement'],
    ['Mot de passe', settings.password ? 'Defini' : 'Non defini'],
  ];

  return (
    <div className="new-meeting-summary-backdrop" role="dialog" aria-modal="true">
      <section className="new-meeting-summary-card">
        <header>
          <button type="button" onClick={onBack} aria-label="Modifier"><ArrowLeft size={20} /></button>
          <h3>Résumé de la réunion</h3>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </header>
        <div className="new-meeting-summary-title">
          <Video size={22} />
          <div>
            <strong>{title || 'Reunion'}</strong>
            <span>{settings.encryption ? 'Chiffrement active' : 'Chiffrement desactive'}</span>
          </div>
        </div>
        <section className="new-meeting-summary-access" aria-label="Identifiants envoyes aux participants">
          <span>ID de la réunion</span>
          <strong>{settings.meetingAccessId}</strong>
          <small>Cet ID est envoye aux participants avec le mot de passe.</small>
        </section>
        <div className="new-meeting-summary-grid">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        {settings.coverImage && (
          <div className="new-meeting-summary-cover">
            <img src={settings.coverImage} alt="" />
          </div>
        )}
        {participants.length > 0 && (
          <div className="new-meeting-summary-people">
            {participants.slice(0, 6).map((participant) => (
              <img key={participant.id} src={participant.avatar || `https://i.pravatar.cc/80?u=${participant.id}`} alt={participant.name} title={participant.name} />
            ))}
          </div>
        )}
        <div className="new-meeting-summary-actions">
          <button type="button" onClick={() => onConfirm('save')} disabled={isStarting}>Enregistrer pour plus tard</button>
          <button type="button" onClick={() => setSharePickerOpen(true)} disabled={isStarting}>Partager</button>
          <button type="button" onClick={() => onConfirm('device')} disabled={isStarting}>Autres canaux</button>
          <button type="button" className="primary" onClick={() => onConfirm('launch')} disabled={isStarting}>Lancer la réunion</button>
        </div>
      </section>
      {sharePickerOpen && (
        <section className="new-meeting-share-modal" role="dialog" aria-modal="true" aria-label="Partager la réunion">
          <header>
            <h3>Partager</h3>
            <button type="button" onClick={() => setSharePickerOpen(false)} aria-label="Fermer"><X size={18} /></button>
          </header>
          <button type="button" onClick={() => onConfirm('message')} disabled={isStarting}>
            <MessageCircle size={18} />
            <span><strong>Message</strong><small>Partager via un message de discussion.</small></span>
          </button>
          <button type="button" onClick={() => onConfirm('actus')} disabled={isStarting}>
            <Share2 size={18} />
            <span><strong>Actus</strong><small>Partager le lien avec le titre de la réunion.</small></span>
          </button>
          <button type="button" onClick={() => onConfirm('status')} disabled={isStarting}>
            <CircleDot size={18} />
            <span><strong>Statut</strong><small>Partager à votre statut avec le titre.</small></span>
          </button>
        </section>
      )}
    </div>
  );
}

function NewMeetingModal({
  isStarting,
  initialStartTime,
  onClose,
  onCreate,
}: {
  isStarting: boolean;
  initialStartTime?: string | null;
  onClose: () => void;
  onCreate: (payload: {
    type: MeetingType;
    title: string;
    description: string;
    startTime: string;
    duration: number;
    participants: string[];
    settings: NewMeetingSettings;
    action: MeetingCreateAction;
  }) => Promise<void>;
}) {
  const defaultStart = useMemo(() => {
    const parsedStart = initialStartTime ? new Date(initialStartTime) : null;
    return parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : getRoundedMeetingStartDate();
  }, [initialStartTime]);
  const defaultDate = toDateInputValue(defaultStart);
  const defaultTime = toTimeInputValue(defaultStart);
  const [type, setType] = useState<MeetingType>('video');
  const [title, setTitle] = useState("Réunion d'équipe");
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [duration, setDuration] = useState('60');
  const [participantQuery, setParticipantQuery] = useState('');
  const [participantSuggestions, setParticipantSuggestions] = useState<MeetingParticipantSuggestion[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<MeetingParticipantSuggestion[]>([]);
  const [showParticipantPicker, setShowParticipantPicker] = useState(false);
  const [isSearchingParticipants, setIsSearchingParticipants] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [formError, setFormError] = useState('');
  const [settings, setSettings] = useState<NewMeetingSettings>({
    waitingRoom: true,
    coverImage: '',
    timeZone: getDefaultMeetingTimeZone(),
    participantAudio: true,
    participantVideo: true,
    screenShare: true,
    password: '',
    encryption: true,
    joinBeforeHost: false,
    chat: true,
    reactions: true,
    lunaSummary: true,
    linkSharing: false,
    externalAccess: false,
    participantCapacity: 10,
    meetingAccessId: generateMeetingAccessId(),
  });

  useEffect(() => {
    const query = participantQuery.trim();
    if (query.length < 1) {
      setParticipantSuggestions([]);
      return undefined;
    }

    let cancelled = false;
    setIsSearchingParticipants(true);
    const timer = window.setTimeout(() => {
      meetingService.searchParticipantSuggestions(query)
        .then((items) => {
          if (cancelled) return;
          const selectedIds = new Set(selectedParticipants.map((item) => item.id));
          setParticipantSuggestions(items.filter((item) => !selectedIds.has(item.id)));
        })
        .catch(() => {
          if (!cancelled) setParticipantSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearchingParticipants(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [participantQuery, selectedParticipants]);

  const toggleSetting = (key: keyof NewMeetingSettings) => {
    setSettings((current) => {
      if (key === 'encryption') {
        const nextEncryption = !current.encryption;
        return { ...current, encryption: nextEncryption };
      }
      return { ...current, [key]: !current[key] };
    });
  };

  const addParticipant = (participant: MeetingParticipantSuggestion) => {
    setSelectedParticipants((current) => {
      if (current.some((item) => item.id === participant.id)) return current;
      const nextParticipants = [...current, participant];
      setSettings((currentSettings) => ({
        ...currentSettings,
        participantCapacity: Math.max(currentSettings.participantCapacity || 1, nextParticipants.length + 1),
      }));
      return nextParticipants;
    });
    setParticipantQuery('');
    setParticipantSuggestions([]);
  };

  const removeParticipant = (participantId: string) => {
    setSelectedParticipants((current) => current.filter((participant) => participant.id !== participantId));
  };

  const addParticipantEmails = () => {
    const candidates = participantQuery
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!candidates.length) return;

    const invalidEmail = candidates.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidEmail) {
      showFormError(`L'adresse ${invalidEmail} n'est pas valide.`);
      return;
    }

    setSelectedParticipants((current) => {
      const knownEmails = new Set(current.map((participant) => String(participant.email || '').toLowerCase()));
      const additions = candidates
        .filter((email) => !knownEmails.has(email))
        .map((email) => ({ id: `email:${email}`, name: email, username: '', avatar: '', email }));
      const nextParticipants = [...current, ...additions];
      setSettings((currentSettings) => ({
        ...currentSettings,
        participantCapacity: Math.max(currentSettings.participantCapacity || 1, nextParticipants.length + 1),
      }));
      return nextParticipants;
    });
    setParticipantQuery('');
    setParticipantSuggestions([]);
    setFormError('');
  };

  const showFormError = (message: string) => {
    setFormError(message);
  };

  const handleCoverImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showFormError('Choisissez une image valide pour la réunion.');
      event.target.value = '';
      return;
    }
    if (file.size > 1_500_000) {
      showFormError("L'image doit faire moins de 1,5 Mo.");
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSettings((current) => ({ ...current, coverImage: String(reader.result || '') }));
      setFormError('');
    };
    reader.readAsDataURL(file);
  };

  const buildPayload = (action: MeetingCreateAction) => {
    const participantEmails = selectedParticipants.map((participant) => participant.email || participant.id);
    const participantCapacity = Math.max(settings.participantCapacity || 1, participantEmails.length + 1);
    return ({
      type,
      title: title.trim(),
      description: description.trim() || selectedParticipants.map((participant) => participant.name).join(', '),
      startTime: new Date(`${date}T${time}`).toISOString(),
      duration: Number.parseInt(duration, 10) || 60,
      participants: participantEmails,
      settings: { ...settings, participantCapacity },
      action,
    });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const startAt = new Date(`${date}T${time}`);
    if (!title.trim()) {
      showFormError('Ajoutez un titre pour continuer.');
      return;
    }
    if (Number.isNaN(startAt.getTime())) {
      showFormError('Date ou heure invalide.');
      return;
    }
    if ((Number.parseInt(duration, 10) || 0) < 15) {
      showFormError('La durée minimale est de 15 minutes.');
      return;
    }
    if (!settings.password.trim()) {
      showFormError("Ajoutez un mot de passe pour sécuriser l'accès à la réunion.");
      return;
    }
    if ((settings.participantCapacity || 0) < selectedParticipants.length + 1) {
      showFormError("Le nombre de participants doit couvrir l'hôte et les invités sélectionnés.");
      return;
    }
    setFormError('');
    setShowSummary(true);
  };

  const confirmCreate = async (action: MeetingCreateAction) => {
    await onCreate(buildPayload(action));
  };

  return (
    <motion.div
      className="new-meeting-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-meeting-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.form
        className="new-meeting-card"
        onSubmit={handleSubmit}
        initial={{ y: 28, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 28, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
      >
        <header className="new-meeting-header">
          <button type="button" className="new-meeting-back" onClick={onClose} aria-label="Retour">
            <ArrowLeft size={25} strokeWidth={2.8} />
          </button>
          <h2 id="new-meeting-title">Nouvelle réunion</h2>
          <span />
        </header>

        <section className="new-meeting-section">
          <h3>Type de réunion</h3>
          <div className="new-meeting-type-grid">
            <MeetingTypeButton
              active={type === 'video'}
              icon={Video}
              title="Réunion vidéo"
              text="Organisez une réunion vidéo avec vos participants"
              onClick={() => setType('video')}
            />
            <MeetingTypeButton
              active={type === 'audio'}
              icon={UsersRound}
              title="Réunion audio"
              text="Organisez une réunion audio avec vos participants"
              onClick={() => setType('audio')}
            />
          </div>
        </section>

        <section className="new-meeting-section">
          <h3>Informations de la réunion</h3>
          <MeetingInput icon={Calendar} title="Titre de la réunion" value={title} onChange={setTitle} placeholder="Ex: Réunion d'équipe" />
          <MeetingInput icon={List} title="Description (optionnel)" value={description} onChange={setDescription} placeholder="Ajouter une description..." />

          <label className="new-meeting-cover">
            <span>
              <ImageIcon size={24} strokeWidth={2.8} />
            </span>
            <div>
              <strong>Image de la réunion</strong>
              <small>{settings.coverImage ? 'Image personnalisée active' : 'Visible sur les cartes de réunion'}</small>
            </div>
            {settings.coverImage && <img src={settings.coverImage} alt="" />}
            <input type="file" accept="image/*" onChange={handleCoverImageChange} />
            <b>{settings.coverImage ? 'Modifier' : 'Choisir'}</b>
          </label>
          {settings.coverImage && (
            <button
              type="button"
              className="new-meeting-cover-remove"
              onClick={() => setSettings((current) => ({ ...current, coverImage: '' }))}
            >
              Retirer l'image personnalisée
            </button>
          )}

          <div className="new-meeting-double-grid">
            <MeetingInput icon={CalendarDays} title="Date" type="date" value={date} onChange={setDate} />
            <MeetingInput icon={Clock3} title="Heure" type="time" value={time} onChange={setTime} />
            <MeetingInput icon={Clock3} title="Durée" type="number" value={duration} onChange={setDuration} suffix="min" />
            <MeetingInput
              icon={Users}
              title="Nombre de participants"
              type="number"
              value={String(settings.participantCapacity || 1)}
              onChange={(value) => {
                const numericValue = Number.parseInt(value, 10);
                setSettings((current) => ({
                  ...current,
                  participantCapacity: Math.max(selectedParticipants.length + 1, Number.isFinite(numericValue) ? numericValue : 1),
                }));
              }}
              suffix="max"
            />
            <MeetingSelect
              icon={Globe2}
              title="Fuseau horaire"
              value={settings.timeZone}
              options={meetingTimeZoneOptions}
              onChange={(value) => setSettings((current) => ({ ...current, timeZone: value }))}
            />
          </div>
        </section>

        <section className="new-meeting-section">
          <h3>Participants</h3>
          <label className="new-meeting-participants">
            <span>
              <Users size={24} strokeWidth={2.8} />
            </span>
            <div>
              <strong>Ajouter des participants</strong>
              <input
                value={participantQuery}
                onChange={(event) => setParticipantQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                    event.preventDefault();
                    addParticipantEmails();
                  }
                }}
                placeholder="Saisissez une ou plusieurs adresses e-mail"
                inputMode="email"
                aria-label="Adresses e-mail des participants"
              />
            </div>
            <button
              type="button"
              aria-label="Ajouter les adresses e-mail"
              aria-haspopup="dialog"
              onClick={() => participantQuery.includes('@') ? addParticipantEmails() : setShowParticipantPicker(true)}
            >
              <UserPlus size={22} strokeWidth={2.8} />
            </button>
          </label>
          {selectedParticipants.length > 0 && (
            <div className="new-meeting-selected-participants">
              {selectedParticipants.map((participant) => (
                <button type="button" key={participant.id} onClick={() => removeParticipant(participant.id)}>
                  <img src={participant.avatar || `https://i.pravatar.cc/80?u=${participant.id}`} alt="" />
                  <span>{participant.email || participant.name}</span>
                  <X size={14} />
                </button>
              ))}
            </div>
          )}
          {(participantSuggestions.length > 0 || isSearchingParticipants) && (
            <div className="new-meeting-suggestions">
              {isSearchingParticipants && <p>Recherche...</p>}
              {participantSuggestions.map((participant) => (
                <button type="button" key={participant.id} onClick={() => addParticipant(participant)}>
                  <img src={participant.avatar || `https://i.pravatar.cc/80?u=${participant.id}`} alt="" />
                  <span>
                    <strong>{participant.name}</strong>
                    <small>{participant.username ? `@${participant.username}` : participant.email || 'Ami MBote'}</small>
                  </span>
                  <Check size={17} />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="new-meeting-section">
          <h3>Paramètres</h3>
          <div className="new-meeting-settings-grid">
            <SettingCard icon={Lock} title="Salle d'attente" active={settings.waitingRoom} onClick={() => toggleSetting('waitingRoom')} />
            <SettingCard icon={Mic2} title="Audio des participants" active={settings.participantAudio} onClick={() => toggleSetting('participantAudio')} />
            <SettingCard icon={Video} title="Vidéo des participants" active={settings.participantVideo} onClick={() => toggleSetting('participantVideo')} />
            <SettingCard icon={Monitor} title="Partage d'écran" active={settings.screenShare} onClick={() => toggleSetting('screenShare')} />
          </div>

          <button type="button" className="new-meeting-advanced" onClick={() => setShowAdvanced((value) => !value)} aria-expanded={showAdvanced}>
            <span>
              <ShieldCheck size={24} strokeWidth={2.8} />
            </span>
            <div>
              <strong>Sécurité avancée</strong>
              <small>{settings.encryption ? 'Chiffrement activé' : 'Chiffrement désactivé'} ? {settings.password ? 'Mot de passe défini' : 'Sans mot de passe'}</small>
            </div>
            <ChevronRight size={22} strokeWidth={2.8} />
          </button>
          {showAdvanced && (
            <div className="new-meeting-advanced-panel">
              <MeetingInput
                icon={Lock}
                title="ID de la réunion"
                value={settings.meetingAccessId}
                readOnly
              />
              <MeetingInput
                icon={Lock}
                title="Mot de passe"
                value={settings.password}
                onChange={(value) => setSettings((current) => ({ ...current, password: value }))}
                placeholder="Ex: mbote2026"
              />
              <SettingRow title="Chiffrement de bout en bout" active={settings.encryption} onClick={() => toggleSetting('encryption')} />
              <SettingRow title="Rejoindre avant l'hôte" active={settings.joinBeforeHost} onClick={() => toggleSetting('joinBeforeHost')} />
              <SettingRow title="Discussion de réunion" active={settings.chat} onClick={() => toggleSetting('chat')} />
              <SettingRow title="Réactions en réunion" active={settings.reactions} onClick={() => toggleSetting('reactions')} />
              <SettingRow title="Résumé de réunion par Luna IA" active={settings.lunaSummary} onClick={() => toggleSetting('lunaSummary')} />
              <SettingRow title="Autorisér le partage du lien" active={settings.linkSharing} onClick={() => toggleSetting('linkSharing')} />
              <SettingRow title="Accès élargi hors participants" active={settings.externalAccess} onClick={() => toggleSetting('externalAccess')} />
            </div>
          )}
        </section>

        <button className="new-meeting-create" type="submit" disabled={isStarting}>
          <Video size={20} fill="currentColor" strokeWidth={0} />
          {isStarting ? 'Création...' : 'Créer la réunion'}
        </button>
      </motion.form>
      {formError && (
        <div className="new-meeting-error-modal-backdrop" role="presentation" onClick={() => setFormError('')}>
          <motion.div
            className="new-meeting-error-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="new-meeting-error-title"
            aria-describedby="new-meeting-error-message"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            onClick={(event) => event.stopPropagation()}
          >
            <strong id="new-meeting-error-title">Vérification nécessaire</strong>
            <p id="new-meeting-error-message">{formError}</p>
            <button type="button" onClick={() => setFormError('')}>Compris</button>
          </motion.div>
        </div>
      )}
      {showSummary && (
        <MeetingSummaryModal
          title={title}
          type={type}
          date={date}
          time={time}
          duration={duration}
          participants={selectedParticipants}
          settings={settings}
          isStarting={isStarting}
          onBack={() => setShowSummary(false)}
          onClose={onClose}
          onConfirm={confirmCreate}
        />
      )}
      {showParticipantPicker && (
        <ParticipantPicker
          selectedParticipants={selectedParticipants}
          suggestions={participantSuggestions}
          query={participantQuery}
          setQuery={setParticipantQuery}
          onAdd={addParticipant}
          onRemove={removeParticipant}
          onClose={() => setShowParticipantPicker(false)}
        />
      )}
    </motion.div>
  );
}

function ParticipantPicker({
  selectedParticipants,
  suggestions,
  query,
  setQuery,
  onAdd,
  onRemove,
  onClose,
}: {
  selectedParticipants: MeetingParticipantSuggestion[];
  suggestions: MeetingParticipantSuggestion[];
  query: string;
  setQuery: (value: string) => void;
  onAdd: (participant: MeetingParticipantSuggestion) => void;
  onRemove: (participantId: string) => void;
  onClose: () => void;
}) {
  const selectedIds = new Set(selectedParticipants.map((participant) => participant.id));
  return (
    <div className="new-meeting-picker-backdrop" role="dialog" aria-modal="true">
      <section className="new-meeting-picker-card">
        <header>
          <h3>Selectionner des participants</h3>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </header>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tapez A, B, C..." />
        <div className="new-meeting-picker-list">
          {suggestions.length > 0 ? suggestions.map((participant) => (
            <button type="button" key={participant.id} onClick={() => selectedIds.has(participant.id) ? onRemove(participant.id) : onAdd(participant)}>
              <img src={participant.avatar || `https://i.pravatar.cc/80?u=${participant.id}`} alt="" />
              <span>
                <strong>{participant.name}</strong>
                <small>{participant.username ? `@${participant.username}` : participant.email || 'Ami MBote'}</small>
              </span>
              {selectedIds.has(participant.id) ? <Check size={18} /> : <UserPlus size={18} />}
            </button>
          )) : (
            <p>Entrez la premiere lettre du nom ou prenom d'un ami.</p>
          )}
        </div>
        <footer>
          <span>{selectedParticipants.length} selectionne{selectedParticipants.length > 1 ? 's' : ''}</span>
          <button type="button" onClick={onClose}>Valider</button>
        </footer>
      </section>
    </div>
  );
}

function MeetingTypeButton({
  active,
  icon: Icon,
  title,
  text,
  onClick,
}: {
  active: boolean;
  icon: ElementType;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? 'is-active' : ''} onClick={onClick}>
      <span>
        <Icon size={28} strokeWidth={2.9} />
      </span>
      <strong>{title}</strong>
      <p>{text}</p>
      <b>{active ? <Check size={17} strokeWidth={3.2} /> : null}</b>
    </button>
  );
}

function MeetingInput({
  icon: Icon,
  title,
  value,
  onChange,
  placeholder,
  type = 'text',
  suffix,
  readOnly = false,
}: {
  icon: ElementType;
  title: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  suffix?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="new-meeting-input">
      <span>
        <Icon size={23} strokeWidth={2.8} />
      </span>
      <div>
        <strong>{title}</strong>
        <input
          type={type}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(event) => onChange?.(event.target.value)}
        />
      </div>
      {suffix && <em>{suffix}</em>}
    </label>
  );
}

function MeetingSelect({
  icon: Icon,
  title,
  value,
  options,
  onChange,
}: {
  icon: ElementType;
  title: string;
  value: string;
  options: MeetingTimeZoneOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="new-meeting-input new-meeting-select">
      <span>
        <Icon size={23} strokeWidth={2.8} />
      </span>
      <div>
        <strong>{title}</strong>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function SettingCard({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: ElementType;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`new-meeting-setting ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={onClick}>
      <Icon size={26} strokeWidth={2.8} />
      <strong>{title}</strong>
      <small>{active ? 'Activé' : 'Désactivé'}</small>
      <i />
    </button>
  );
}

function SettingRow({ title, active, onClick }: { title: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`new-meeting-switch-row ${active ? 'is-active' : ''}`} aria-pressed={active} onClick={onClick}>
      <span>{title}</span>
      <strong>{active ? 'Activé' : 'Désactivé'}</strong>
      <i />
    </button>
  );
}
