import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Home,
  IdCard,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import { authService } from '../services/authService';
import {
  EndedMeetingPayload,
  EndedMeetingParticipant,
  getMeetingAccessCode,
  LobbyParticipant,
  Meeting,
  meetingService,
} from '../services/meetingService';
import './MeetingEndedPage.css';

type EndedLocationState = {
  meeting?: Partial<Meeting>;
  participants?: EndedMeetingParticipant[];
  summary?: string[];
  guest?: boolean;
  meetingId?: string | number;
};

type EndedMeetingView = {
  id: string;
  publicId: string;
  title: string;
  host: string;
  date: string;
  time: string;
  duration: string;
  participantCount: number;
  secure: boolean;
  guest: boolean;
};

type FollowUpAction = {
  id: string;
  label: string;
  completed: boolean;
};

const fallbackSummary = [
  "Revue de l'avancement des projets en cours et des priorités produit.",
  'Décisions et points d’action regroupés pour le suivi après la réunion.',
  'Assignation des tâches pour le sprint à venir.',
  "Points bloquants identifiés et plan d'action validé.",
  "Prochaine réunion à planifier selon les disponibilités de l'équipe.",
];

const fallbackActions: FollowUpAction[] = [
  { id: 'share-summary', label: "Partager le résumé avec l'équipe", completed: true },
  { id: 'follow-tasks', label: 'Suivre les tâches assignées', completed: true },
  { id: 'prepare-next', label: 'Préparer les points pour la prochaine réunion', completed: false },
  { id: 'review-recording', label: "Consulter l'enregistrement si besoin", completed: false },
];

const getInitials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const formatMeetingId = (value: string) => {
  const normalized = value.replace(/\D/g, '');
  return normalized ? normalized.match(/.{1,3}/g)?.join(' ') || normalized : value;
};

const formatDate = (value?: string) => {
  if (!value) return 'Date à confirmer';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date à confirmer';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
};

const formatTimeRange = (start?: string, end?: string, duration = 60, timezone = 'GMT+1') => {
  if (!start) return 'Heure à confirmer';
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return 'Heure à confirmer';
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + duration * 60_000);
  const formatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(startDate)} - ${formatter.format(endDate)} (${timezone})`;
};

const formatDuration = (minutes = 60) => {
  const seconds = Math.max(1, minutes * 60);
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return [hours, mins, secs].map((value) => String(value).padStart(2, '0')).join(':');
};

const saveTextFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const normalizeParticipant = (item: EndedMeetingParticipant) => ({
  ...item,
  id: String(item.id || item.name),
  name: item.name || 'Participant',
  role: item.role || 'Participant',
});

export default function MeetingEndedPage() {
  const { meetingId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as EndedLocationState | null;
  const targetMeetingId = String(meetingId || state?.meetingId || state?.meeting?.id || '');
  const [endedData, setEndedData] = useState<EndedMeetingPayload | null>(null);
  const [lobby, setLobby] = useState<LobbyParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(authService.isAuthenticated() && targetMeetingId));
  const [accessError, setAccessError] = useState('');
  const [toast, setToast] = useState('');
  const [rating, setRating] = useState(() => Number(localStorage.getItem(`meeting-rating:${targetMeetingId}`) || 0));
  const [hoveredRating, setHoveredRating] = useState(0);
  const [ratingSent, setRatingSent] = useState(Boolean(localStorage.getItem(`meeting-rating:${targetMeetingId}:sent`)));
  const [actions, setActions] = useState<FollowUpAction[]>(fallbackActions);
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [joinValue, setJoinValue] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    if (!targetMeetingId || !authService.isAuthenticated()) {
      setIsLoading(false);
      if (!state?.meeting?.id && !targetMeetingId) {
        setAccessError("Ouvrez cette page depuis une réunion terminée pour voir ses détails.");
      }
      return;
    }

    let cancelled = false;
    const loadEndedMeeting = async () => {
      setIsLoading(true);
      setAccessError('');
      try {
        const data = await meetingService.getEndedMeeting(targetMeetingId);
        if (cancelled) return;
        setEndedData(data);
        setActions(data.nextActions.length ? data.nextActions : fallbackActions);
      } catch (error) {
        if (cancelled) return;
        if (state?.meeting?.id) {
          setAccessError('');
          setActions(fallbackActions);
        } else {
          setAccessError(error instanceof Error ? error.message : 'Impossible de charger la fin de réunion.');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadEndedMeeting();
    return () => {
      cancelled = true;
    };
  }, [state?.meeting?.id, targetMeetingId]);

  useEffect(() => {
    const meeting = endedData?.meeting || state?.meeting;
    if (!meeting?.id || endedData) return;
    let cancelled = false;
    meetingService.getLobby(Number(meeting.id))
      .then((rows) => {
        if (!cancelled) setLobby(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [endedData, state?.meeting]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const endedMeeting = useMemo<EndedMeetingView>(() => {
    const currentMeeting = endedData?.meeting || state?.meeting;
    const rawId = String(currentMeeting?.id || targetMeetingId || 'meeting');
    const publicId = endedData?.publicId || (currentMeeting?.meeting_link ? getMeetingAccessCode(currentMeeting as Meeting) : rawId);
    const duration = endedData?.durationMinutes || currentMeeting?.duration || 60;
    const participantsCount = endedData?.participants.length
      || currentMeeting?.participant_count
      || lobby.filter((item) => item.status !== 'rejected').length
      || state?.participants?.length
      || 1;

    return {
      id: rawId,
      publicId,
      title: currentMeeting?.title || 'Nouvelle réunion',
      host: currentMeeting?.host_name || authService.getCurrentUser()?.name || 'Hôte MBotéRoom',
      date: formatDate(endedData?.startedAt || currentMeeting?.start_time),
      time: formatTimeRange(
        endedData?.startedAt || currentMeeting?.start_time,
        endedData?.endedAt,
        duration,
        endedData?.timezone || currentMeeting?.settings?.timeZone || 'GMT+1',
      ),
      duration: formatDuration(duration),
      participantCount: Math.max(1, participantsCount),
      secure: currentMeeting?.settings?.encryption !== false,
      guest: Boolean(endedData?.guestRestrictions || state?.guest || authService.getCurrentUser()?.isGuest),
    };
  }, [endedData, lobby, state, targetMeetingId]);

  const participants = useMemo(() => {
    if (endedData?.participants.length) return endedData.participants.map(normalizeParticipant);
    const base: EndedMeetingParticipant[] = [
      { id: 'host', name: endedMeeting.host, role: 'Hôte', online: true },
      { id: 'me', name: authService.getCurrentUser()?.name || 'Vous', role: endedMeeting.guest ? 'Invité' : 'Participant', online: true },
      ...lobby
        .filter((item) => item.status !== 'rejected')
        .map((item) => ({
          id: String(item.user_id),
          name: item.name,
          role: item.status === 'accepted' ? 'Participant' as const : 'Invité' as const,
          avatar: item.avatar,
          online: item.status === 'accepted',
        })),
      ...(state?.participants || []),
    ];
    return base
      .map(normalizeParticipant)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id || candidate.name === item.name) === index);
  }, [endedData, endedMeeting.guest, endedMeeting.host, lobby, state?.participants]);

  const summary = useMemo(() => {
    if (endedData?.summary.bullets.length) return endedData.summary.bullets;
    if (state?.summary?.length) return state.summary;
    return fallbackSummary;
  }, [endedData, state?.summary]);

  const permissions = endedData?.permissions || {
    canDownloadSummary: !endedMeeting.guest,
    canShareSummary: !endedMeeting.guest,
    canViewRecording: Boolean(endedData?.recording.available),
    canExportChat: !endedMeeting.guest,
    canRate: true,
  };

  const homeTarget = endedMeeting.guest ? '/rejoindre-une-reunion' : '/app';

  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(endedMeeting.publicId);
      setToast("L'ID de réunion a été copié.");
    } catch {
      setToast("Impossible de copier l'ID.");
    }
  };

  const downloadSummary = () => {
    if (!permissions.canDownloadSummary) {
      setToast('Connectez-vous avec un compte complet pour télécharger le résumé.');
      return;
    }
    saveTextFile([
      endedMeeting.title,
      `ID : ${formatMeetingId(endedMeeting.publicId)}`,
      `Hôte : ${endedMeeting.host}`,
      `Date : ${endedMeeting.date}`,
      `Heure : ${endedMeeting.time}`,
      '',
      'Résumé',
      ...summary.map((item) => `- ${item}`),
      '',
      'Actions',
      ...actions.map((item) => `- [${item.completed ? 'x' : ' '}] ${item.label}`),
    ].join('\n'), `resume-reunion-${endedMeeting.publicId}.txt`);
    setToast('Résumé téléchargé.');
  };

  const exportChat = () => {
    if (!permissions.canExportChat) {
      setToast("L'export du chat est réservé aux comptes complets.");
      return;
    }
    saveTextFile([
      `Export du chat - ${endedMeeting.title}`,
      `ID : ${formatMeetingId(endedMeeting.publicId)}`,
      '',
      'Aucun message persistant à exporter pour cette réunion.',
    ].join('\n'), `chat-reunion-${endedMeeting.publicId}.txt`);
    setToast('Chat exporté.');
  };

  const shareNotes = async () => {
    if (!permissions.canShareSummary) {
      setToast('Connectez-vous avec un compte complet pour partager les notes.');
      return;
    }
    const text = summary.map((item) => `- ${item}`).join('\n');
    if (navigator.share) {
      await navigator.share({ title: endedMeeting.title, text }).catch(() => undefined);
      return;
    }
    const subject = encodeURIComponent(`Résumé - ${endedMeeting.title}`);
    const body = encodeURIComponent(text);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const watchRecording = () => {
    if (!permissions.canViewRecording || !endedData?.recording.available) {
      setToast("Aucun enregistrement n'est disponible pour cette réunion.");
      return;
    }
    if (endedData.recording.url) {
      window.open(endedData.recording.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setToast("L'enregistrement est en cours de préparation.");
  };

  const submitRating = () => {
    if (!rating) {
      setToast('Sélectionnez une note avant d’envoyer votre avis.');
      return;
    }
    localStorage.setItem(`meeting-rating:${targetMeetingId}`, String(rating));
    localStorage.setItem(`meeting-rating:${targetMeetingId}:sent`, '1');
    setRatingSent(true);
    setToast(`Merci pour votre note de ${rating}/5.`);
  };

  const leave = async () => {
    if (endedMeeting.guest) {
      await authService.logout().catch(() => undefined);
      navigate('/rejoindre-une-reunion', { replace: true });
      return;
    }
    navigate('/app', { replace: true });
  };

  const joinNewMeeting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = joinValue.trim();
    if (!value) {
      setJoinError('Saisissez un ID ou un lien de réunion.');
      return;
    }
    setIsJoining(true);
    setJoinError('');
    try {
      const meeting = await meetingService.lookupMeetingAccess(value, joinPassword);
      navigate(`/reunions/${meeting.id}/salle-attente`, { state: { meeting } });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Réunion introuvable.');
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return <main className="meeting-ended-page meeting-ended-status">Chargement de la fin de réunion...</main>;
  }

  if (accessError) {
    return (
      <main className="meeting-ended-page meeting-ended-status">
        <section>
          <h1>Accès impossible</h1>
          <p role="alert">{accessError}</p>
          <Link to="/rejoindre-une-reunion">Rejoindre une réunion</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="meeting-ended-page">
      <header className="meeting-ended-header">
        <Link className="meeting-ended-brand" to={homeTarget} aria-label="Accueil MBotéRoom">
          <span className="meeting-ended-brand-icon"><UsersRound size={27} aria-hidden="true" /><Video size={14} aria-hidden="true" /></span>
          <strong>MBoté<span>Room</span></strong>
        </Link>
        <section className="meeting-ended-title">
          <h1>{endedMeeting.title}</h1>
          <span><ShieldCheck size={17} aria-hidden="true" />Réunion terminée</span>
        </section>
        <nav className="meeting-ended-actions" aria-label="Navigation de fin de réunion">
          <Link className="meeting-ended-home" to={homeTarget}><Home size={19} aria-hidden="true" />Retour à l’accueil</Link>
          <button className="meeting-ended-join" type="button" onClick={() => setJoinModalOpen(true)}><Video size={19} aria-hidden="true" />Rejoindre une nouvelle réunion</button>
          <button className="meeting-ended-quit" type="button" onClick={() => void leave()}><LogOut size={20} aria-hidden="true" />Quitter</button>
        </nav>
      </header>

      <div className="meeting-ended-layout">
        <section className="meeting-ended-main">
          <section className="meeting-ended-card">
            <header className="meeting-ended-hero">
              <div className="meeting-ended-check"><Check size={58} aria-hidden="true" /><span><Check size={22} aria-hidden="true" /></span></div>
              <div>
                <h2>La réunion est terminée</h2>
                <strong>Merci pour votre participation.</strong>
                <p>Nous espérons que cette réunion a été productive.</p>
              </div>
            </header>

            <div className="meeting-ended-stats">
              <StatCard icon={<Clock3 />} label="Durée" value={endedMeeting.duration} />
              <StatCard icon={<CalendarDays />} label="Date et heure" value={endedMeeting.date} detail={endedMeeting.time} />
              <StatCard icon={<UserRound />} label="Hôte" value={endedMeeting.host} />
              <StatCard icon={<UsersRound />} label="Participants" value={`${endedMeeting.participantCount} participant${endedMeeting.participantCount > 1 ? 's' : ''}`} detail="dont vous" />
              <StatCard icon={<IdCard />} label="ID de réunion" value={formatMeetingId(endedMeeting.publicId)} action={<button type="button" aria-label="Copier l’ID de réunion" onClick={() => void copyMeetingId()}><Copy size={18} /></button>} />
            </div>

            <div className="meeting-ended-grid">
              <section className="meeting-ended-summary">
                <header><span><FileText size={21} /></span><h2>Résumé de la réunion</h2></header>
                <ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>
                <button type="button" onClick={() => navigate(`/reunions/${encodeURIComponent(endedMeeting.id)}/luna`, { state })}>Voir tous les points discutés <ArrowRight size={18} /></button>
              </section>

              <section className="meeting-ended-participants">
                <header><h2><UsersRound size={22} />Participants ({participants.length})</h2><button type="button" onClick={() => setToast('Tous les participants visibles sont synchronisés avec cette réunion.')}>Voir tous</button></header>
                <div>
                  {participants.slice(0, 5).map((participant) => <ParticipantChip key={participant.id} participant={participant} />)}
                  {participants.length > 5 && <article className="meeting-ended-more"><span>+{participants.length - 5}</span><strong>{participants.length - 5} autre{participants.length - 5 > 1 ? 's' : ''}</strong></article>}
                </div>
              </section>
            </div>

            <div className="meeting-ended-tools">
              <ToolCard icon={<Download />} title="Télécharger le résumé" description="Fichier récapitulatif de la réunion" variant="purple" disabled={!permissions.canDownloadSummary} onClick={downloadSummary} />
              <ToolCard icon={<Mail />} title="Partager les notes" description="Envoyer le résumé par email" variant="blue" disabled={!permissions.canShareSummary} onClick={() => void shareNotes()} />
              <ToolCard icon={<Video />} title="Voir l’enregistrement" description={endedData?.recording.available ? `Disponible ${endedData.recording.retentionDays} jours` : 'Non disponible'} variant="green" disabled={!permissions.canViewRecording} onClick={watchRecording} />
              <ToolCard icon={<FileText />} title="Exporter le chat" description="Télécharger la conversation" variant="violet" disabled={!permissions.canExportChat} onClick={exportChat} />
            </div>
          </section>

          <section className="meeting-rating-card">
            <div><span><Star size={31} fill="currentColor" /></span><section><h2>Comment s’est déroulée cette réunion ?</h2><p>Votre avis nous aide à améliorer MBotéRoom.</p></section></div>
            <div className="meeting-stars" role="radiogroup" aria-label="Note de la réunion">
              {[1, 2, 3, 4, 5].map((value) => {
                const selected = value <= (hoveredRating || rating);
                return (
                  <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} étoile${value > 1 ? 's' : ''}`} onMouseEnter={() => setHoveredRating(value)} onMouseLeave={() => setHoveredRating(0)} onClick={() => setRating(value)} disabled={ratingSent}>
                    <Star size={34} fill={selected ? 'currentColor' : 'none'} />
                  </button>
                );
              })}
            </div>
            <button className="meeting-rating-submit" type="button" onClick={submitRating} disabled={ratingSent}>{ratingSent ? 'Avis envoyé' : 'Donner mon avis'}</button>
          </section>
        </section>

        <aside className="meeting-ended-sidebar">
          <section className="meeting-ended-side-card">
            <h2>Informations de la réunion</h2>
            <SideRow icon={<IdCard />} label="ID de réunion" value={formatMeetingId(endedMeeting.publicId)} />
            <SideRow icon={<UserRound />} label="Hôte" value={endedMeeting.host} />
            <SideRow icon={<CalendarDays />} label="Date" value={endedMeeting.date} />
            <SideRow icon={<Clock3 />} label="Heure" value={endedMeeting.time} />
            <SideRow icon={<ShieldCheck />} label="Sécurité" value={endedMeeting.secure ? 'Réunion sécurisée' : 'Réunion standard'} positive={endedMeeting.secure} />
          </section>

          <section className="meeting-ended-side-card">
            <h2>Prochaines actions</h2>
            <div className="meeting-followups">
              {actions.map((action) => (
                <button key={action.id} type="button" className={action.completed ? 'is-completed' : ''} aria-pressed={action.completed} onClick={() => setActions((current) => current.map((item) => item.id === action.id ? { ...item, completed: !item.completed } : item))}>
                  <span>{action.completed && <Check size={13} />}</span>
                  <strong>{action.label}</strong>
                  {action.completed && <CheckCircle2 size={17} />}
                </button>
              ))}
            </div>
          </section>

          <section className="meeting-ended-account-card">
            <span><UsersRound size={34} /><Sparkles size={16} /></span>
            <h2>Profitez de toutes les fonctionnalités</h2>
            <p>Créez un compte MBotéRoom pour accéder à l’historique complet de vos réunions, enregistrements et notes partagées.</p>
            <Link to="/inscription">Créer un compte</Link>
            <button type="button" onClick={() => navigate('/rejoindre-une-reunion')}>Continuer en tant qu’invité</button>
          </section>
        </aside>
      </div>

      {joinModalOpen && (
        <div className="meeting-ended-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setJoinModalOpen(false);
        }}>
          <section className="meeting-ended-modal" role="dialog" aria-modal="true" aria-labelledby="join-ended-title">
            <header>
              <h2 id="join-ended-title">Rejoindre une nouvelle réunion</h2>
              <button type="button" aria-label="Fermer" onClick={() => setJoinModalOpen(false)}><X size={20} /></button>
            </header>
            <form onSubmit={(event) => void joinNewMeeting(event)}>
              <label htmlFor="ended-join-value">ID ou lien de réunion</label>
              <input id="ended-join-value" value={joinValue} onChange={(event) => setJoinValue(event.target.value)} placeholder="123 456 789 ou lien MBotéRoom" autoComplete="off" />
              <label htmlFor="ended-join-password">Mot de passe si requis</label>
              <input id="ended-join-password" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} placeholder="Mot de passe de réunion" type="password" autoComplete="current-password" />
              {joinError && <p className="meeting-ended-form-error" role="alert">{joinError}</p>}
              <button type="submit" disabled={isJoining}>{isJoining ? 'Vérification...' : 'Rejoindre'}</button>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="meeting-ended-toast" role="status" aria-live="polite"><CheckCircle2 size={19} />{toast}</div>}
    </main>
  );
}

function StatCard({ icon, label, value, detail, action }: { icon: ReactNode; label: string; value: string; detail?: string; action?: ReactNode }) {
  return <article className="meeting-stat-card"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</div>{action}</article>;
}

function ParticipantChip({ participant }: { participant: EndedMeetingParticipant }) {
  return <article className="meeting-ended-participant"><span>{getInitials(participant.name)}{participant.online && <i />}</span><strong>{participant.name}</strong><small>{participant.role}</small></article>;
}

function ToolCard({ icon, title, description, variant, disabled, onClick }: { icon: ReactNode; title: string; description: string; variant: string; disabled?: boolean; onClick: () => void }) {
  return <button className={`meeting-tool-card is-${variant}`} type="button" disabled={disabled} onClick={onClick}><span>{icon}</span><strong>{title}</strong><small>{description}</small></button>;
}

function SideRow({ icon, label, value, positive = false }: { icon: ReactNode; label: string; value: string; positive?: boolean }) {
  return <div className="meeting-ended-side-row"><span>{icon}</span><p>{label}</p><strong className={positive ? 'is-positive' : ''}>{value}</strong></div>;
}
