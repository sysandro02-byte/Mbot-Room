import { useState } from 'react';
import { Bell, CalendarDays, ChevronRight, Crown, MessageSquare, Radio, UsersRound, Video } from 'lucide-react';
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
  weekday: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const participantCount = (meeting: Meeting) => Array.isArray(meeting.settings?.participants)
  ? meeting.settings.participants.length
  : 0;

export default function AndroidHome({ firstName, meetings, recentMeetings, slides, loading, unreadNotifications, onCreate, onJoin, onOpen, onAll, onNotifications, onGroups, onPremium, onLive, onCalendar, onMessages, onProfile, onSlideAction }: Props) {
  const [actionError] = useState('');
  const liveMeeting = meetings.find((meeting) => getMeetingPhase(meeting) === 'live') || null;
  const banner = slides.find((slide) => slide.slot === 4 && slide.isActive !== false) || slides.find((slide) => slide.isActive !== false) || null;
  const hero = slides.find((slide) => slide.slot >= 1 && slide.slot <= 3 && slide.isActive !== false) || banner;
  const upcoming = meetings.slice(0, 2);

  return <main className="android-home android-home-redesign" aria-busy={loading}>
    <header className="android-home-redesign-header">
      <div>
        <div className="android-home-brandline"><span className="android-home-brandmark"><Video size={21}/></span><span className="android-home-wordmark">MBotéRoom</span></div>
        <h1>Bonjour {firstName} 👋</h1>
        <p>Prêt(e) à vous connecter aujourd’hui ?</p>
      </div>
      <div className="android-home-header-actions">
        <button type="button" className="android-icon-button" onClick={onNotifications} aria-label="Notifications"><Bell size={20}/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}</button>
        <button type="button" className="android-profile-button" onClick={onProfile} aria-label="Mon profil">{firstName.slice(0, 1).toUpperCase()}</button>
      </div>
    </header>

    <button type="button" className="android-hero-banner" onClick={() => hero?.actionPath && onSlideAction(hero.actionPath)}>
      {hero?.imageUrl ? <img src={hero.imageUrl} alt=""/> : null}
      <span className="android-hero-copy"><strong>{hero?.title || 'Des réunions plus proches de vos projets'}</strong><small>{hero?.body || 'Échangez, collaborez, progressez avec MBotéRoom.'}</small></span>
      <span className="android-hero-dots" aria-hidden="true"><i/><i/><i/></span>
    </button>

    <section className="android-primary-actions" aria-label="Actions principales">
      <button type="button" onClick={onCreate}><span><Video size={23}/></span><strong>Créer une réunion</strong><small>Démarrer maintenant</small></button>
      <button type="button" onClick={onJoin}><span><span style={{fontSize:24,fontWeight:900}}>+</span></span><strong>Rejoindre une réunion</strong><small>Avec un ID ou un lien</small></button>
    </section>
    {actionError ? <p className="android-home-action-error" role="alert">{actionError}</p> : null}

    <nav className="android-quick-row" aria-label="Accès rapides">
      <button type="button" onClick={onCalendar}><span><CalendarDays size={19}/></span>Planifier</button>
      <button type="button" onClick={onLive}><span><Radio size={19}/></span>Live</button>
      <button type="button" onClick={onGroups}><span><UsersRound size={19}/></span>Groupes</button>
      <button type="button" onClick={onMessages}><span><MessageSquare size={19}/></span>Messages{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}</button>
    </nav>

    <section>
      <div className="android-section-title"><h2>Prochaines réunions</h2><button type="button" onClick={onAll}>Voir tout ›</button></div>
      <div className="android-meeting-list">
        {upcoming.map((meeting) => {
          const live = getMeetingPhase(meeting) === 'live';
          return <article className="android-meeting-card" key={meeting.id}><span className="android-meeting-icon">{live ? <Radio size={20}/> : <CalendarDays size={20}/>}</span><div className="android-meeting-card-copy"><strong>{meeting.title}</strong><small>{live ? 'En direct maintenant' : `${dateTime(meeting.start_time)} · ${participantCount(meeting) || '—'} participant${participantCount(meeting) > 1 ? 's' : ''}`}</small></div><button type="button" className="android-meeting-card-action" onClick={() => onOpen(meeting)}>{live ? 'Reprendre' : 'Rejoindre'}</button></article>;
        })}
        {!loading && !upcoming.length ? <button type="button" className="android-meeting-card android-empty-card" onClick={onCreate}><span className="android-meeting-icon"><CalendarDays size={20}/></span><span className="android-meeting-card-copy"><strong>Aucune réunion prévue</strong><small>Planifiez votre prochaine réunion.</small></span></button> : null}
      </div>
    </section>

    {recentMeetings.length ? <section><div className="android-section-title"><h2>Réunions récentes</h2><button type="button" onClick={onAll}>Voir tout ›</button></div><div className="android-meeting-list">{recentMeetings.slice(0, 2).map((meeting) => <article className="android-meeting-card" key={meeting.id}><span className="android-meeting-icon"><Video size={19}/></span><div className="android-meeting-card-copy"><strong>{meeting.title}</strong><small>{dateTime(meeting.start_time)}</small></div><button type="button" className="android-meeting-card-action done" onClick={() => onOpen(meeting)}>Terminée</button></article>)}</div></section> : null}

    <button type="button" className="android-premium-strip" onClick={onPremium}><span><Crown size={22}/></span><span><strong>Fonctionnalités Premium</strong><small>Débloquez plus de possibilités avec MBotéRoom Premium.</small></span><ChevronRight size={18}/></button>

    {banner ? <button type="button" className="android-admin-banner" onClick={() => onSlideAction(banner.actionPath || '/fonctionnalites')}><div>{banner.imageUrl ? <img src={banner.imageUrl} alt=""/> : <Radio size={26}/>}</div><span><small>À la une</small><strong>{banner.title}</strong><em>{banner.body}</em></span><ChevronRight size={18}/></button> : null}
    {liveMeeting ? <span className="sr-only">Une réunion est actuellement en direct.</span> : null}
  </main>;
}
