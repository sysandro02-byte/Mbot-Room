import { Bell, CalendarDays, ChevronRight, Clock3, Crown, Folder, MessageCircle, Radio, Search, UsersRound, Video } from 'lucide-react';
import type { HomeSlide, Meeting } from '../../../services/meetingService';
import { getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';
import './AndroidHome.css';

type Props = {
  firstName: string;
  meetings: Meeting[];
  recentMeetings: Meeting[];
  slides: HomeSlide[];
  loading: boolean;
  unreadNotifications: number;
  onCreate: () => void;
  onJoin: () => void;
  onOpen: (meeting: Meeting) => void;
  onAll: () => void;
  onNotifications: () => void;
  onGroups: () => void;
  onPremium: () => void;
  onLive: () => void;
  onCalendar: () => void;
  onMessages: () => void;
  onProfile: () => void;
  onSlideAction: (path: string) => void;
};

const dateTime = (value: string) => new Intl.DateTimeFormat(getAppLocale(), {
  weekday: 'long', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const participantCount = (meeting: Meeting) => Array.isArray(meeting.settings?.participants)
  ? meeting.settings.participants.length
  : 0;

export default function AndroidHome({ firstName, meetings, recentMeetings, slides, loading, unreadNotifications, onCreate, onJoin, onOpen, onAll, onNotifications, onGroups, onPremium, onLive, onCalendar, onMessages, onProfile, onSlideAction }: Props) {
  const liveMeeting = meetings.find((meeting) => getMeetingPhase(meeting) === 'live') || null;
  const hero = slides.find((slide) => slide.slot >= 1 && slide.slot <= 3 && slide.isActive !== false)
    || slides.find((slide) => slide.isActive !== false)
    || null;
  const nextMeeting = meetings[0] || null;

  return <main className="android-home android-home-redesign" aria-busy={loading}>
    <header className="android-home-redesign-header">
      <div className="android-home-heading">
        <div className="android-home-brandline"><span className="android-home-wordmark">MBoté<span>Room</span></span><small>Réunions vidéo sécurisées</small></div>
        <h1>Bonjour, {firstName}</h1>
        <p>Ravie de vous revoir !</p>
        <p className="android-home-tagline">Des idées plus proches, un monde plus ouvert.</p>
      </div>
      <div className="android-home-header-actions">
        <button type="button" className="android-profile-button" onClick={onProfile} aria-label="Mon profil">{firstName.slice(0, 1).toUpperCase()}</button>
        <button type="button" className="android-icon-button" onClick={() => onSlideAction('/app/search')} aria-label="Rechercher"><Search size={22}/></button>
        <button type="button" className="android-icon-button" onClick={onNotifications} aria-label="Notifications"><Bell size={22}/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}</button>
      </div>
    </header>

    <section className="android-primary-actions" aria-label="Actions principales">
      <button type="button" onClick={onCreate}>
        <span className="android-primary-icon"><Video size={27}/></span>
        <span className="android-primary-copy"><strong>Démarrer une réunion</strong><small>Lancez une réunion vidéo en un clic</small></span>
        <ChevronRight className="android-primary-arrow" size={26}/>
      </button>
      <button type="button" onClick={onJoin}>
        <span className="android-primary-icon"><UsersRound size={28}/></span>
        <span className="android-primary-copy"><strong>Rejoindre avec un code</strong><small>Entrez un code de réunion pour nous rejoindre</small></span>
        <ChevronRight className="android-primary-arrow" size={26}/>
      </button>
    </section>

    <button type="button" className="android-hero-banner" onClick={() => hero?.actionPath && onSlideAction(hero.actionPath)} aria-label={hero?.title || 'Organisez vos échanges simplement'}>
      {hero?.imageUrl ? <img src={hero.imageUrl} alt=""/> : null}
      <span className="android-hero-copy"><strong>{hero?.title || 'Organisez vos échanges simplement'}</strong><small>{hero?.body || 'Collaborez, partagez, avancez ensemble.'}</small></span>
      <span className="android-hero-dots" aria-hidden="true"><i/><i/><i/></span>
    </button>

    <section className="android-home-meetings">
      <div className="android-section-title"><h2>Prochaine réunion</h2><button type="button" onClick={onAll}>Voir tout <ChevronRight size={17}/></button></div>
      {nextMeeting ? <article className="android-meeting-card">
        <span className="android-meeting-icon"><CalendarDays size={27}/></span>
        <div className="android-meeting-card-copy">
          <strong>{nextMeeting.title}</strong>
          <small>{getMeetingPhase(nextMeeting) === 'live' ? 'En direct maintenant' : dateTime(nextMeeting.start_time)}</small>
          <small className="android-meeting-mode"><Video size={15}/> En ligne</small>
        </div>
        <button type="button" className="android-meeting-card-action" onClick={() => onOpen(nextMeeting)} aria-label={liveMeeting ? 'Rejoindre la réunion en direct' : 'Ouvrir la prochaine réunion'}><ChevronRight size={22}/></button>
      </article> : <button type="button" className="android-meeting-card android-empty-card" onClick={onCreate}>
        <span className="android-meeting-icon"><CalendarDays size={27}/></span>
        <span className="android-meeting-card-copy"><strong>Aucune réunion prévue</strong><small>Planifiez votre prochaine réunion.</small></span>
        <ChevronRight size={20}/>
      </button>}
    </section>

    <section className="android-home-quick-access">
      <div className="android-section-title"><h2>Accès rapide</h2></div>
      <nav className="android-quick-row" aria-label="Accès rapides">
        <button type="button" onClick={onMessages}><span><MessageCircle size={29}/></span>Messages{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}</button>
        <button type="button" onClick={() => onSlideAction('/app/contacts')}><span><UsersRound size={29}/></span>Contacts</button>
        <button type="button" onClick={onCalendar}><span><CalendarDays size={29}/></span>Calendrier</button>
        <button type="button" onClick={() => onSlideAction('/app/files')}><span><Folder size={29}/></span>Fichiers</button>
      </nav>
    </section>

    <button type="button" className="android-premium-strip" onClick={onPremium}>
      <span className="android-premium-crown"><Crown size={33}/></span>
      <span><strong>Passez à MBotéRoom Premium</strong><small>Plus de fonctionnalités pour vos réunions</small></span>
      <ChevronRight size={21}/>
    </button>

    {recentMeetings.length ? <section className="android-home-recent" aria-label="Réunions récentes">
      <div className="android-section-title"><h2>Réunions récentes</h2><button type="button" onClick={onAll}>Voir tout <ChevronRight size={17}/></button></div>
      {recentMeetings.slice(0, 2).map((meeting) => <button type="button" className="android-recent-row" key={meeting.id} onClick={() => onOpen(meeting)}>
        <span><Clock3 size={18}/></span><strong>{meeting.title}</strong><small>{dateTime(meeting.start_time)}</small><ChevronRight size={17}/>
      </button>)}
    </section> : null}

    <span className="sr-only">{onGroups && onLive ? 'Fonctions de groupes et Live disponibles dans la navigation.' : ''}</span>
  </main>;
}
