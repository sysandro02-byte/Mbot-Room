import { useState } from 'react';
import { Bell, CalendarDays, ChevronRight, CirclePlay, Crown, Link2, Plus, Radio, UsersRound, Video, Zap } from 'lucide-react';
import type { HomeSlide, Meeting } from '../../../services/meetingService';
import { getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';

type Props = {
  firstName: string;
  meetings: Meeting[];
  recentMeetings: Meeting[];
  slides: HomeSlide[];
  loading: boolean;
  unreadNotifications: number;
  onCreate: () => void;
  onJoin: () => void;
  onInstant: () => Promise<void>;
  onOpen: (meeting: Meeting) => void;
  onAll: () => void;
  onNotifications: () => void;
  onGroups: () => void;
  onPremium: () => void;
  onLive: () => void;
  onSlideAction: (path: string) => void;
};

const dateTime = (value: string) => new Intl.DateTimeFormat(getAppLocale(), {
  weekday: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

const relativeTime = (meeting: Meeting) => {
  if (getMeetingPhase(meeting) === 'live') return 'En direct';
  const minutes = Math.ceil((new Date(meeting.start_time).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return 'Maintenant';
  if (minutes < 60) return `Dans ${minutes} min`;
  if (minutes < 24 * 60) return `Dans ${Math.ceil(minutes / 60)} h`;
  return `Dans ${Math.ceil(minutes / (24 * 60))} j`;
};

const participantCount = (meeting: Meeting) => Array.isArray(meeting.settings?.participants)
  ? meeting.settings.participants.length
  : 0;

export default function AndroidHome({ firstName, meetings, recentMeetings, slides, loading, unreadNotifications, onCreate, onJoin, onInstant, onOpen, onAll, onNotifications, onGroups, onPremium, onLive, onSlideAction }: Props) {
  const [instantLoading, setInstantLoading] = useState(false);
  const [instantError, setInstantError] = useState('');
  const liveMeeting = meetings.find((meeting) => getMeetingPhase(meeting) === 'live') || null;
  const nextMeeting = liveMeeting || meetings.find((meeting) => getMeetingPhase(meeting) === 'upcoming') || null;
  const banner = slides.find((slide) => slide.slot === 4 && slide.isActive !== false) || slides.find((slide) => slide.isActive !== false) || null;
  const startInstantMeeting = async () => {
    setInstantError('');
    setInstantLoading(true);
    try { await onInstant(); }
    catch (cause) { setInstantError(cause instanceof Error ? cause.message : 'Création de la réunion instantanée impossible.'); }
    finally { setInstantLoading(false); }
  };

  return <main className="android-home android-home-redesign" aria-busy={loading}>
    <header className="android-home-header android-home-redesign-header">
      <div><span className="android-home-wordmark">MBotéRoom</span><h1>Bonjour, {firstName}</h1><p>Prêt à vous réunir ?</p></div>
      <button type="button" className="android-icon-button" onClick={onNotifications} aria-label="Notifications"><Bell size={21}/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}</button>
    </header>

    <section className="android-create-card" aria-label="Créer une réunion"><span className="android-create-card-icon"><Video size={25}/></span><div><strong>Créer une réunion</strong><small>Lancez une réunion vidéo en quelques secondes.</small></div><button type="button" onClick={onCreate}>Créer <ChevronRight size={17}/></button></section>

    <section className="android-primary-actions" aria-label="Actions principales">
      <button type="button" onClick={onJoin}><span className="join"><Link2 size={20}/></span><strong>Rejoindre</strong><small>Avec un ID ou un lien</small></button>
      <button type="button" onClick={() => void startInstantMeeting()} disabled={instantLoading}><span className="instant"><Zap size={20}/></span><strong>{instantLoading ? 'Création…' : 'Instantanée'}</strong><small>Démarrer maintenant</small></button>
    </section>
    {instantError ? <p className="android-home-action-error" role="alert">{instantError}</p> : null}

    {nextMeeting ? <section className={`android-resume-card ${getMeetingPhase(nextMeeting) === 'live' ? 'is-live' : ''}`}><div className="android-resume-copy"><span>{getMeetingPhase(nextMeeting) === 'live' ? <><i/> En direct</> : <><CalendarDays size={14}/> Prochaine réunion</>}</span><strong>{nextMeeting.title}</strong><small>{getMeetingPhase(nextMeeting) === 'live' ? 'Votre réunion est en cours.' : `${dateTime(nextMeeting.start_time)} · ${participantCount(nextMeeting) || '—'} participant${participantCount(nextMeeting) > 1 ? 's' : ''}`}</small></div><button type="button" onClick={() => onOpen(nextMeeting)}>{getMeetingPhase(nextMeeting) === 'live' ? 'Reprendre' : 'Ouvrir'} <CirclePlay size={17}/></button></section> : <section className="android-resume-card android-resume-empty"><CalendarDays size={20}/><div><strong>Votre journée est libre</strong><small>Créez ou planifiez une réunion pour commencer.</small></div></section>}

    <section className="android-home-section android-upcoming-section"><div className="android-section-title"><h2>À venir</h2><button type="button" onClick={onAll}>Voir tout</button></div><div className="android-meeting-scroll">
      {meetings.slice(0, 3).map((meeting) => <button type="button" className="android-upcoming-card" key={meeting.id} onClick={() => onOpen(meeting)}><span className={getMeetingPhase(meeting) === 'live' ? 'live' : ''}>{getMeetingPhase(meeting) === 'live' ? <Radio size={15}/> : <CalendarDays size={15}/>} {relativeTime(meeting)}</span><strong>{meeting.title}</strong><small>{dateTime(meeting.start_time)}</small><em><UsersRound size={13}/>{participantCount(meeting) || '—'}</em></button>)}
      {!loading && !meetings.length ? <button type="button" className="android-upcoming-card android-empty-card" onClick={onCreate}><Plus size={20}/><strong>Planifier une réunion</strong><small>Elle apparaîtra ici.</small></button> : null}
    </div></section>

    <section className="android-home-section"><div className="android-section-title"><h2>Accès rapide</h2></div><div className="android-quick-grid"><button type="button" onClick={onGroups}><span className="groups"><UsersRound size={21}/></span><strong>Groupes</strong></button><button type="button" onClick={onNotifications}><span className="notifications"><Bell size={21}/></span><strong>Notifications</strong>{unreadNotifications ? <b>{unreadNotifications}</b> : null}</button><button type="button" onClick={onPremium}><span className="premium"><Crown size={21}/></span><strong>Premium</strong></button><button type="button" onClick={onLive}><span className="live"><Radio size={21}/></span><strong>Live</strong></button></div></section>

    {banner ? <button type="button" className="android-admin-banner" onClick={() => onSlideAction(banner.actionPath || '/fonctionnalites')}><div>{banner.imageUrl ? <img src={banner.imageUrl} alt="" /> : <Radio size={28}/>}</div><span><small>À la une</small><strong>{banner.title}</strong><em>{banner.body}</em></span><ChevronRight size={19}/></button> : <button type="button" className="android-admin-banner android-default-banner" onClick={onLive}><div><Radio size={28}/></div><span><small>À la une</small><strong>Live en haute qualité</strong><em>Découvrez les nouveautés de MBotéRoom.</em></span><ChevronRight size={19}/></button>}

    {recentMeetings.length ? <section className="android-home-section android-recent-section"><div className="android-section-title"><h2>Récentes</h2><button type="button" onClick={onAll}>Tout voir</button></div>{recentMeetings.slice(0, 2).map((meeting) => <button type="button" className="android-recent-row" key={meeting.id} onClick={() => onOpen(meeting)}><span><Video size={18}/></span><div><strong>{meeting.title}</strong><small>{dateTime(meeting.start_time)}</small></div><ChevronRight size={18}/></button>)}</section> : null}
  </main>;
}
