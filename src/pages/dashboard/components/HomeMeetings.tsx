import { Clock3, Copy, EllipsisVertical, ExternalLink, Play, Share2, UsersRound, Video } from 'lucide-react';
import { useState } from 'react';
import type { Meeting } from '../../../services/meetingService';
import type { Recording } from '../../../services/appDataService';
import { getMeetingJoinUrl, getMeetingPhase } from '../../../services/meetingService';
import { getAppLocale } from '../../../lib/appLanguage';

const formatDate = (value: string) => new Intl.DateTimeFormat(getAppLocale(), { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const formatTime = (value: string) => new Intl.DateTimeFormat(getAppLocale(), { hour: '2-digit', minute: '2-digit' }).format(new Date(value));

const timeUntil = (meeting: Meeting) => {
  const phase = getMeetingPhase(meeting);
  if (phase === 'live') return 'En direct';
  if (phase === 'ended') return meeting.status === 'cancelled' ? 'Annulée' : 'Terminée';
  const minutes = Math.max(0, Math.ceil((new Date(meeting.start_time).getTime() - Date.now()) / 60000));
  if (minutes < 60) return `Dans ${minutes} min`;
  if (minutes < 1440) return `Dans ${Math.ceil(minutes / 60)} h`;
  return `Dans ${Math.ceil(minutes / 1440)} j`;
};

type NextProps = {
  meeting: Meeting | null;
  canManage: boolean;
  onOpen: (meeting: Meeting) => void;
  onManage: (meeting: Meeting) => void;
  onPlan: () => void;
};

export function NextMeetingCard({ meeting, canManage, onOpen, onManage, onPlan }: NextProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const phase = meeting ? getMeetingPhase(meeting) : null;

  const copy = async () => {
    if (!meeting) return;
    await navigator.clipboard.writeText(getMeetingJoinUrl(meeting));
    setMenuOpen(false);
  };

  const share = async () => {
    if (!meeting) return;
    const url = getMeetingJoinUrl(meeting);
    if (navigator.share) await navigator.share({ title: meeting.title, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(url);
    setMenuOpen(false);
  };

  return (
    <section className="home-card home-next-meeting">
      <div className="home-section-head"><h2>Prochaine réunion</h2><button type="button" onClick={() => meeting && onManage(meeting)}>Tout voir</button></div>
      {meeting ? <article className="home-next-meeting-body">
        <div className="home-next-meeting-meta">
          <span className="home-next-date"><Clock3 size={16}/><b>{formatDate(meeting.start_time)}</b><small>{formatTime(meeting.start_time)} · {meeting.duration} min</small></span>
          <span className="home-countdown">{timeUntil(meeting)}</span>
        </div>
        <h3>{meeting.title}</h3>
        <p>{meeting.description || 'Réunion MBotéRoom'}</p>
        <div className="home-next-meeting-footer">
          <div className="home-participant-preview"><span>{meeting.host_avatar ? <img src={meeting.host_avatar} alt="" /> : <UsersRound size={17}/>}</span><small>{meeting.host_name}</small></div>
          <button className="home-join-button" type="button" onClick={() => onOpen(meeting)}><Video size={18}/>{phase === 'live' ? 'Rejoindre maintenant' : phase === 'ended' ? 'Voir le résumé' : 'Ouvrir'}</button>
          <div className="home-meeting-menu-wrap">
            <button className="home-more-button" type="button" aria-label="Options de la réunion" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}><EllipsisVertical size={19}/></button>
            {menuOpen ? <div className="home-meeting-menu" role="menu">
              <button type="button" onClick={() => { setMenuOpen(false); onOpen(meeting); }}><ExternalLink size={16}/> Voir les détails</button>
              <button type="button" onClick={() => void copy()}><Copy size={16}/> Copier le lien</button>
              <button type="button" onClick={() => void share()}><Share2 size={16}/> Inviter / partager</button>
              {canManage ? <button type="button" onClick={() => { setMenuOpen(false); onManage(meeting); }}><EllipsisVertical size={16}/> Gérer / supprimer</button> : null}
            </div> : null}
          </div>
        </div>
      </article> : <div className="home-empty-state"><CalendarEmpty/><strong>Aucune réunion programmée.</strong><p>Planifiez votre prochaine réunion pour la retrouver ici.</p><button className="home-empty-action" type="button" onClick={onPlan}>Planifier une réunion</button></div>}
    </section>
  );
}

function CalendarEmpty() {
  return <span className="home-empty-icon"><Clock3 size={24}/></span>;
}

type RecentProps = {
  meetings: Meeting[];
  recordings: Recording[];
  onOpen: (meeting: Meeting) => void;
  onManage: (meeting: Meeting) => void;
  canManage: (meeting: Meeting) => boolean;
  onAll: () => void;
};

export function RecentMeetings({ meetings, recordings, onOpen, onManage, canManage, onAll }: RecentProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const share = async (meeting: Meeting) => {
    const url = getMeetingJoinUrl(meeting);
    if (navigator.share) await navigator.share({ title: meeting.title, url }).catch(() => undefined);
    else await navigator.clipboard.writeText(url);
    setOpenMenuId(null);
  };

  return (
    <section className="home-card home-recent-meetings">
      <div className="home-section-head"><h2>Réunions récentes</h2><button type="button" onClick={onAll}>Tout voir</button></div>
      {meetings.length ? <div className="home-recent-list">
        {meetings.slice(0, 3).map((meeting) => {
          const recording = recordings.find((item) => Number(item.meeting_id) === Number(meeting.id));
          return <article key={meeting.id}>
            <span className="home-recent-thumb">{meeting.host_avatar ? <img src={meeting.host_avatar} alt="" /> : <Video size={18}/>}</span>
            <div><strong>{meeting.title}</strong><small>{formatDate(meeting.start_time)} · {meeting.duration} min</small></div>
            {recording?.storage_url ? <a href={recording.storage_url} target="_blank" rel="noreferrer" aria-label={`Ouvrir l'enregistrement de ${meeting.title}`}><Play size={16}/></a> : <button type="button" aria-label={`Voir le résumé de ${meeting.title}`} onClick={() => onOpen(meeting)}><Play size={16}/></button>}
            <div className="home-meeting-menu-wrap">
              <button className="home-row-more" type="button" aria-label={`Options pour ${meeting.title}`} aria-expanded={openMenuId===meeting.id} onClick={() => setOpenMenuId((current)=>current===meeting.id?null:meeting.id)}><EllipsisVertical size={17}/></button>
              {openMenuId===meeting.id?<div className="home-meeting-menu home-recent-menu" role="menu">
                <button type="button" onClick={() => { setOpenMenuId(null); onOpen(meeting); }}><ExternalLink size={16}/> Voir les détails</button>
                <button type="button" onClick={() => { setOpenMenuId(null); onOpen(meeting); }}><Play size={16}/> Résumé Luna</button>
                {recording?.storage_url ? <a className="home-meeting-menu-link" href={recording.storage_url} target="_blank" rel="noreferrer" onClick={() => setOpenMenuId(null)}><Video size={16}/> Voir l’enregistrement</a> : null}
                <button type="button" onClick={() => void share(meeting)}><Share2 size={16}/> Partager</button>
                {canManage(meeting)?<button type="button" onClick={() => { setOpenMenuId(null); onManage(meeting); }}><EllipsisVertical size={16}/> Gérer / supprimer</button>:null}
              </div>:null}
            </div>
          </article>;
        })}
      </div> : <div className="home-empty-state compact"><strong>Aucune réunion récente.</strong></div>}
    </section>
  );
}
