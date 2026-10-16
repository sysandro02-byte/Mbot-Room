import { useEffect, useState } from 'react';
import { Bell, CalendarDays, ChevronRight, EllipsisVertical, FolderOpen, Link2, MessageCircle, Search, UsersRound, Video } from 'lucide-react';
import type { HomeSlide, Meeting } from '../../../services/meetingService';
import { getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';
import './AndroidHome.css';

type Props = {
  firstName: string;
  avatar?: string;
  initials?: string;
  meetings: Meeting[];
  recentMeetings: Meeting[];
  slides: HomeSlide[];
  loading: boolean;
  unreadNotifications: number;
  onCreate: () => void;
  onJoin: () => void;
  onPlan: () => void;
  onGroups: () => void;
  onShareLink: (meeting?: Meeting) => void;
  canStartMeeting: (meeting: Meeting) => boolean;
  onOpen: (meeting: Meeting) => void;
  onAll: () => void;
  onNotifications: () => void;
  onPremium: () => void;
  onCalendar: () => void;
  onMessages: () => void;
  onContacts: () => void;
  onFiles: () => void;
  onProfile: () => void;
  onSearch: () => void;
  onSlideAction: (path: string) => void;
};

const formatTime = (date: Date) => new Intl.DateTimeFormat(getAppLocale(), {
  hour: '2-digit', minute: '2-digit',
}).format(date);

const formatMeetingRange = (meeting: Meeting) => {
  const start = new Date(meeting.start_time);
  if (Number.isNaN(start.getTime())) return 'Date à confirmer';
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const day = start.toDateString() === today.toDateString() ? 'Aujourd’hui'
    : start.toDateString() === tomorrow.toDateString() ? 'Demain'
      : new Intl.DateTimeFormat(getAppLocale(), { day: 'numeric', month: 'short' }).format(start);
  const durationMinutes = Number(meeting.duration);
  const end = Number.isFinite(durationMinutes) && durationMinutes > 0
    ? new Date(start.getTime() + durationMinutes * 60_000) : null;
  return day + ' · ' + formatTime(start) + (end ? ' - ' + formatTime(end) : '');
};

const DEFAULT_VIDEO_IMAGE = '/images/android-home-video-call.svg';

export default function AndroidHome({
  firstName, avatar, initials, meetings, slides, loading, unreadNotifications,
  onCreate, onJoin, onPlan, onGroups, onShareLink, canStartMeeting,
  onOpen, onAll, onNotifications, onCalendar, onMessages, onContacts,
  onFiles, onProfile, onSearch, onSlideAction,
}: Props) {
  const [activeSlide, setActiveSlide] = useState(0);
  const [showAllQuick, setShowAllQuick] = useState(false);
  const [openMeetingMenu, setOpenMeetingMenu] = useState(false);
  const [brokenImage, setBrokenImage] = useState('');

  const activeSlides = slides
    .filter((slide) => slide.isActive !== false && slide.slot >= 1 && slide.slot <= 4)
    .sort((left, right) => left.slot - right.slot);
  const visibleSlides = activeSlides.length ? activeSlides : slides.filter((slide) => slide.isActive !== false).slice(0, 1);
  const safeSlideIndex = activeSlide % Math.max(1, visibleSlides.length);
  const hero = visibleSlides[safeSlideIndex] || null;

  useEffect(() => {
    if (visibleSlides.length < 2) return;
    const timer = window.setInterval(() => setActiveSlide((index) => (index + 1) % visibleSlides.length), 7000);
    return () => window.clearInterval(timer);
  }, [visibleSlides.length]);

  useEffect(() => { setBrokenImage(''); }, [hero?.imageUrl]);

  // L'image de démonstration n'est affichée que pour le visuel 1 configuré par défaut.
  // Les médias personnalisés définis par l'administration gardent toujours la priorité.
  const sourceImage = hero?.imageUrl
    && hero.imageUrl !== '/images/mboteroom-home-hero.svg'
    ? hero.imageUrl : DEFAULT_VIDEO_IMAGE;
  const bannerImage = brokenImage === sourceImage ? DEFAULT_VIDEO_IMAGE : sourceImage;

  const nextMeeting = meetings[0] || null;
  const isLive = nextMeeting && getMeetingPhase(nextMeeting) === 'live';
  const canStart = nextMeeting && canStartMeeting(nextMeeting);
  const nextActionLabel = isLive ? 'Rejoindre' : canStart ? 'Démarrer' : 'Détails';
  const nextAction = () => {
    if (!nextMeeting) return;
    setOpenMeetingMenu(false);
    if (isLive || canStart) onOpen(nextMeeting);
    else onAll();
  };

  return <main className="android-home android-home-redesign android-home-reference" aria-busy={loading}>
    <header className="android-home-topbar">
      <div className="android-home-logo" aria-hidden="true"><Video /></div>
      <div className="android-home-brand">
        <span>MBoté</span><strong>Room</strong>
        <small>Réunions vidéo sécurisées</small>
      </div>
      <div className="android-home-top-actions">
        <button type="button" className="android-home-avatar" onClick={onProfile} aria-label="Mon profil">
          {avatar ? <img src={avatar} alt="" /> : <span>{initials || firstName.slice(0, 1).toUpperCase()}</span>}
        </button>
        <button type="button" className="android-home-round" onClick={onSearch} aria-label="Rechercher"><Search/></button>
        <button type="button" className="android-home-round" onClick={onNotifications} aria-label="Notifications">
          <Bell/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}
        </button>
      </div>
    </header>

    <section className="android-home-welcome">
      <h1>Bonjour, {firstName} <span aria-hidden="true">👋</span></h1>
      <p>Ravi de vous revoir !</p>
      <small>Des idées plus proches, un monde plus ouvert.</small>
    </section>

    <section className="android-home-main-actions" aria-label="Actions principales">
      <button type="button" className="android-home-start" onClick={onCreate}>
        <span className="android-home-start-icon"><Video/></span>
        <span className="android-home-action-copy"><strong>Démarrer une réunion</strong><small>Lancez une réunion vidéo en un clic</small></span>
        <ChevronRight className="android-home-action-arrow"/>
      </button>
      <button type="button" className="android-home-join" onClick={onJoin}>
        <span className="android-home-join-icon"><UsersRound/></span>
        <span className="android-home-action-copy"><strong>Rejoindre avec un code</strong><small>Entrez un code de réunion pour nous rejoindre</small></span>
        <ChevronRight className="android-home-action-arrow"/>
      </button>
    </section>

    <section className="android-home-highlights" aria-label="Annonces et nouveautés">
      <button type="button" className="android-home-banner"
        onClick={() => hero?.actionPath ? onSlideAction(hero.actionPath) : onCreate()}
        aria-label={(hero?.actionLabel || 'Découvrir') + ' : ' + (hero?.title || 'Réunions simples, professionnelles et sécurisées')}>
        <span className="android-home-banner-copy">
          <strong>{hero?.title || 'Réunions simples, professionnelles et sécurisées'}</strong>
          <small>{hero?.body || 'Créez, planifiez et animez vos réunions depuis un espace pensé pour vos besoins.'}</small>
        </span>
        <img src={bannerImage} alt="" loading="eager"
          onError={() => setBrokenImage(sourceImage)} />
      </button>
      {visibleSlides.length > 1 && <div className="android-home-dots" role="group" aria-label="Choisir une annonce">
        {visibleSlides.map((slide, index) => <button key={slide.slot} type="button"
          className={index === safeSlideIndex ? 'active' : ''}
          aria-label={'Annonce ' + (index + 1) + ' sur ' + visibleSlides.length}
          aria-current={index === safeSlideIndex ? 'true' : undefined}
          onClick={() => setActiveSlide(index)} />)}
      </div>}
    </section>

    <section className="android-home-section android-home-shortcuts">
      <div className="android-home-section-title">
        <h2>Accès rapides</h2>
        <button type="button" onClick={() => setShowAllQuick((open) => !open)}
          aria-expanded={showAllQuick}>{showAllQuick ? 'Réduire' : 'Tout voir'} <ChevronRight/></button>
      </div>
      <div className="android-home-quick">
        <button type="button" onClick={onPlan}><span className="violet"><CalendarDays/></span><small>Planifier une réunion</small></button>
        <button type="button" onClick={onAll}><span className="orange"><CalendarDays/></span><small>Mes réunions</small></button>
        <button type="button" onClick={onGroups}><span className="blue"><UsersRound/></span><small>Mes groupes</small></button>
        <button type="button" onClick={() => onShareLink(nextMeeting || undefined)}><span className="green"><Link2/></span><small>Partager un lien</small></button>
      </div>
      {showAllQuick && <div className="android-home-quick android-home-quick-extra">
        <button type="button" onClick={onMessages}><span className="teal"><MessageCircle/></span><small>Messages</small></button>
        <button type="button" onClick={onContacts}><span className="blue"><UsersRound/></span><small>Contacts</small></button>
        <button type="button" onClick={onCalendar}><span className="violet"><CalendarDays/></span><small>Calendrier</small></button>
        <button type="button" onClick={onFiles}><span className="orange"><FolderOpen/></span><small>Fichiers</small></button>
      </div>}
    </section>

    <section className="android-home-section android-home-meetings">
      <div className="android-home-section-title">
        <h2>Mes prochaines réunions</h2>
        <button type="button" onClick={onAll}>Tout voir <ChevronRight/></button>
      </div>
      {nextMeeting ? <article className="android-home-next">
        <span className="android-home-next-icon"><CalendarDays/></span>
        <span className="android-home-next-copy">
          <strong>{nextMeeting.title}</strong>
          <span>{formatMeetingRange(nextMeeting)}</span>
          {typeof nextMeeting.participant_count === 'number' && <small><UsersRound/> {nextMeeting.participant_count} participant{nextMeeting.participant_count > 1 ? 's' : ''}</small>}
        </span>
        <div className="android-home-next-actions">
          <button type="button" className="android-home-next-more" aria-label="Options de la réunion"
            aria-expanded={openMeetingMenu} onClick={() => setOpenMeetingMenu((open) => !open)}><EllipsisVertical/></button>
          <button type="button" className="android-home-next-join" onClick={nextAction}>{nextActionLabel}</button>
          {openMeetingMenu && <div className="android-home-next-menu">
            <button type="button" onClick={() => { setOpenMeetingMenu(false); onShareLink(nextMeeting); }}>Partager le lien</button>
            <button type="button" onClick={() => { setOpenMeetingMenu(false); onAll(); }}>Mes réunions</button>
          </div>}
        </div>
      </article> : <button type="button" className="android-home-next android-home-next-empty" onClick={onPlan}>
        <span className="android-home-next-icon"><CalendarDays/></span>
        <span className="android-home-next-copy"><strong>{loading ? 'Chargement des réunions…' : 'Aucune réunion programmée'}</strong>
          <span>{loading ? 'Recherche de vos réunions' : 'Planifiez votre prochaine réunion.'}</span></span>
        <span className="android-home-next-empty-arrow"><ChevronRight/></span>
      </button>}
    </section>
  </main>;
}
