import { Bell, CalendarDays, ChevronRight, CircleDot, Plus, Radio, UsersRound, Video } from 'lucide-react';
import type { Meeting } from '../../../services/meetingService';
import { getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';

type Props = {
  firstName: string;
  meetings: Meeting[];
  loading: boolean;
  unreadNotifications: number;
  onCreate: () => void;
  onPlan: () => void;
  onOpen: (meeting: Meeting) => void;
  onAll: () => void;
  onNotifications: () => void;
  onLive: () => void;
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

export default function AndroidHome({
  firstName, meetings, loading, unreadNotifications, onCreate, onPlan, onOpen, onAll, onNotifications, onLive,
}: Props) {
  const nextMeeting = meetings[0] || null;
  const liveMeetings = meetings.filter((meeting) => getMeetingPhase(meeting) === 'live');

  return <main className="android-home" aria-busy={loading}>
    <header className="android-home-header">
      <div><h1>Bonjour, {firstName}</h1><p>Bonnes réunions aujourd’hui !</p></div>
      <button type="button" className="android-icon-button" onClick={onNotifications} aria-label="Notifications">
        <Bell size={22}/>{unreadNotifications ? <b>{unreadNotifications > 9 ? '9+' : unreadNotifications}</b> : null}
      </button>
    </header>

    {nextMeeting ? <section className="android-next-meeting">
      <div className="android-next-kicker"><span><CalendarDays size={16}/> Prochaine réunion</span><em>{relativeTime(nextMeeting)}</em></div>
      <h2>{nextMeeting.title}</h2>
      <p><CalendarDays size={16}/>{dateTime(nextMeeting.start_time)} · {nextMeeting.duration} min</p>
      <p><UsersRound size={16}/>{participantCount(nextMeeting) || '—'} participant{participantCount(nextMeeting) > 1 ? 's' : ''}</p>
      <button type="button" onClick={() => onOpen(nextMeeting)}><Video size={17}/>{getMeetingPhase(nextMeeting) === 'live' ? 'Rejoindre' : 'Ouvrir la réunion'}</button>
    </section> : <section className="android-next-meeting android-next-empty">
      <CalendarDays size={22}/><h2>Aucune réunion à venir</h2><p>Planifiez votre prochaine réunion pour la retrouver ici.</p>
      <button type="button" onClick={onPlan}><Plus size={17}/>Planifier une réunion</button>
    </section>}

    <section className="android-home-actions" aria-label="Actions rapides">
      <button type="button" onClick={onCreate}><span className="is-teal"><Plus size={24}/></span><strong>Nouvelle réunion</strong><small>Démarrer maintenant</small></button>
      <button type="button" onClick={onPlan}><span className="is-blue"><CalendarDays size={22}/></span><strong>Planifier</strong><small>Programmer à l’avance</small></button>
    </section>

    <button type="button" className="android-live-banner" onClick={onLive}>
      <span><Radio size={22}/><b>Live</b></span>
      <div><strong>{liveMeetings.length ? `${liveMeetings.length} réunion${liveMeetings.length > 1 ? 's' : ''} en direct` : 'Aucune réunion en direct'}</strong><small>{liveMeetings.length ? 'Rejoignez le direct depuis cet espace.' : 'Les réunions en cours apparaîtront ici.'}</small></div>
      <ChevronRight size={20}/>
    </button>

    <section className="android-upcoming-list">
      <div className="android-section-title"><h2>Mes prochaines réunions</h2><button type="button" onClick={onAll}>Voir tout</button></div>
      {meetings.slice(0, 4).map((meeting) => <button type="button" className="android-meeting-row" key={meeting.id} onClick={() => onOpen(meeting)}>
        <span><CalendarDays size={20}/></span><div><strong>{meeting.title}</strong><small>{dateTime(meeting.start_time)} · {participantCount(meeting) || '—'} participant{participantCount(meeting) > 1 ? 's' : ''}</small></div><ChevronRight size={20}/>
      </button>)}
      {!loading && !meetings.length ? <p className="android-list-empty"><CircleDot size={17}/>Votre liste est vide.</p> : null}
    </section>
  </main>;
}
