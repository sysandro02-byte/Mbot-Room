import { ReactNode, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { authService } from '../services/authService';
import { getMeetingAccessCode, LobbyParticipant, Meeting, meetingService } from '../services/meetingService';
import './MeetingEndedPage.css';

type EndedLocationState = {
  meeting?: Partial<Meeting>;
  participants?: Array<{ id: string; name: string; role: string; avatar?: string; online?: boolean }>;
  summary?: string[];
  guest?: boolean;
  meetingId?: string | number;
};

type EndedMeeting = {
  id: string;
  title: string;
  host: string;
  date: string;
  time: string;
  duration: string;
  participantCount: number;
  secure: boolean;
};

type FollowUpAction = {
  id: string;
  label: string;
  completed: boolean;
};

const defaultSummary = [
  "Revue de l'avancement des projets en cours et des priorités produit.",
  'Décision : lancement de la version bêta prévu le 30 juin 2025.',
  'Assignation des tâches pour le sprint à venir.',
  "Points bloquants identifiés et plan d'action validé.",
  'Prochaine réunion fixée selon les disponibilités de l’équipe.',
];

const defaultActions: FollowUpAction[] = [
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

const formatTimeRange = (start?: string, duration = 60) => {
  if (!start) return 'Heure à confirmer';
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return 'Heure à confirmer';
  const endDate = new Date(startDate.getTime() + duration * 60_000);
  const formatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)} (GMT+1)`;
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

export default function MeetingEndedPage() {
  const { meetingId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as EndedLocationState | null;
  const [meeting, setMeeting] = useState<Meeting | null>((state?.meeting?.id ? state.meeting as Meeting : null));
  const [lobby, setLobby] = useState<LobbyParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(authService.isAuthenticated() && !state?.meeting?.id));
  const [accessError, setAccessError] = useState('');
  const [toast, setToast] = useState('');
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [actions, setActions] = useState(defaultActions);

  useEffect(() => {
    if (!authService.isAuthenticated()) {
      setIsLoading(false);
      if (!state?.meeting?.id) setAccessError("Connectez-vous ou revenez depuis une réunion terminée pour voir ses détails.");
      return;
    }

    let cancelled = false;
    const loadMeeting = async () => {
      setIsLoading(true);
      try {
        const meetings = await meetingService.getMeetings();
        if (cancelled) return;
        const targetId = String(meetingId || state?.meetingId || state?.meeting?.id || '');
        const found = meetings.find((item) => (
          String(item.id) === targetId
          || String(item.meeting_link) === targetId
          || getMeetingAccessCode(item) === targetId.toUpperCase()
        )) || null;
        if (!found) throw new Error('Réunion introuvable ou accès non autorisé.');
        setMeeting(found);
        setLobby(await meetingService.getLobby(found.id).catch(() => []));
      } catch (error) {
        if (!cancelled) setAccessError(error instanceof Error ? error.message : 'Impossible de charger la réunion.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    if (!meeting) void loadMeeting();
    else setIsLoading(false);
    return () => {
      cancelled = true;
    };
  }, [meeting, meetingId, state?.meeting?.id, state?.meetingId]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  const endedMeeting = useMemo<EndedMeeting>(() => {
    const currentMeeting = meeting || state?.meeting;
    const rawId = String(currentMeeting?.id || state?.meetingId || meetingId || '123456789');
    return {
      id: rawId,
      title: currentMeeting?.title || "Réunion d'équipe – Produit",
      host: currentMeeting?.host_name || 'Jean Claude M.',
      date: formatDate(currentMeeting?.start_time),
      time: formatTimeRange(currentMeeting?.start_time, currentMeeting?.duration || 83),
      duration: formatDuration(currentMeeting?.duration || 83),
      participantCount: Math.max(1, currentMeeting?.participant_count || lobby.length || state?.participants?.length || 1),
      secure: currentMeeting?.settings?.encryption !== false,
    };
  }, [lobby.length, meeting, meetingId, state]);

  const participants = useMemo(() => {
    const base = [
      { id: 'host', name: endedMeeting.host, role: 'Hôte', online: true },
      { id: 'me', name: 'Vous', role: state?.guest ? 'Invité' : 'Participant', online: true },
      ...lobby.map((item) => ({ id: String(item.user_id), name: item.name, role: item.status === 'accepted' ? 'Participant' : 'Invité', online: item.status === 'accepted' })),
      ...(state?.participants || []),
    ];
    return base.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id || candidate.name === item.name) === index);
  }, [endedMeeting.host, lobby, state?.guest, state?.participants]);

  const summary = state?.summary?.length ? state.summary : defaultSummary;

  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(endedMeeting.id);
      setToast("L'ID de réunion a été copié.");
    } catch {
      setToast("Impossible de copier l'ID.");
    }
  };

  const downloadSummary = () => {
    saveTextFile([
      endedMeeting.title,
      `ID : ${formatMeetingId(endedMeeting.id)}`,
      `Hôte : ${endedMeeting.host}`,
      `Date : ${endedMeeting.date}`,
      '',
      'Résumé',
      ...summary.map((item) => `- ${item}`),
    ].join('\n'), `resume-reunion-${endedMeeting.id}.txt`);
    setToast('Résumé TXT téléchargé. Export PDF/DOCX à connecter côté backend.');
  };

  const exportChat = () => {
    saveTextFile('Export du chat MBotéRoom\n\nLes messages persistants seront fournis par le backend de conservation du chat.', `chat-reunion-${endedMeeting.id}.txt`);
    setToast('Chat exporté en TXT.');
  };

  const shareNotes = () => {
    const subject = encodeURIComponent(`Résumé - ${endedMeeting.title}`);
    const body = encodeURIComponent(summary.map((item) => `• ${item}`).join('\n'));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const submitRating = () => {
    if (!rating) {
      setToast('Sélectionnez une note avant d’envoyer votre avis.');
      return;
    }
    setToast(`Merci pour votre note de ${rating}/5.`);
  };

  const leave = async () => {
    if (state?.guest || authService.getCurrentUser()?.isGuest) {
      await authService.logout().catch(() => undefined);
    }
    navigate('/', { replace: true });
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
        <Link className="meeting-ended-brand" to="/" aria-label="Accueil MBotéRoom">
          <span className="meeting-ended-brand-icon"><UsersRound size={27} aria-hidden="true" /><Video size={14} aria-hidden="true" /></span>
          <strong>MBoté<span>Room</span></strong>
        </Link>
        <section className="meeting-ended-title">
          <h1>{endedMeeting.title}</h1>
          <span><ShieldCheck size={17} aria-hidden="true" />Réunion terminée</span>
        </section>
        <nav className="meeting-ended-actions" aria-label="Navigation de fin de réunion">
          <Link className="meeting-ended-home" to="/app"><Home size={19} aria-hidden="true" />Retour à l’accueil</Link>
          <Link className="meeting-ended-join" to="/rejoindre-une-reunion"><Video size={19} aria-hidden="true" />Rejoindre une nouvelle réunion</Link>
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
              <StatCard icon={<UsersRound />} label="Participants" value={`${endedMeeting.participantCount} participants`} detail="dont vous" />
              <StatCard icon={<IdCard />} label="ID de réunion" value={formatMeetingId(endedMeeting.id)} action={<button type="button" aria-label="Copier l’ID de réunion" onClick={() => void copyMeetingId()}><Copy size={18} /></button>} />
            </div>

            <div className="meeting-ended-grid">
              <section className="meeting-ended-summary">
                <header><span><FileText size={21} /></span><h2>Résumé de la réunion</h2></header>
                <ul>{summary.map((item) => <li key={item}>{item}</li>)}</ul>
                <button type="button" onClick={() => navigate(`/reunions/${encodeURIComponent(endedMeeting.id)}/luna`, { state })}>Voir tous les points discutés <ArrowRight size={18} /></button>
              </section>

              <section className="meeting-ended-participants">
                <header><h2><UsersRound size={22} />Participants ({endedMeeting.participantCount})</h2><button type="button" onClick={() => setToast('Liste complète des participants à connecter au backend.')}>Voir tous</button></header>
                <div>
                  {participants.slice(0, 5).map((participant) => <ParticipantChip key={participant.id} participant={participant} />)}
                  {endedMeeting.participantCount > 5 && <article className="meeting-ended-more"><span>+{endedMeeting.participantCount - 5}</span><strong>{endedMeeting.participantCount - 5} autre</strong></article>}
                </div>
              </section>
            </div>

            <div className="meeting-ended-tools">
              <ToolCard icon={<Download />} title="Télécharger le résumé" description="PDF récapitulatif de la réunion" variant="purple" onClick={downloadSummary} />
              <ToolCard icon={<Mail />} title="Partager les notes" description="Envoyer le résumé par email" variant="blue" onClick={shareNotes} />
              <ToolCard icon={<Video />} title="Voir l’enregistrement" description="Disponible selon les permissions" variant="green" onClick={() => setToast("Aucun enregistrement signé n'est disponible pour cette réunion.")} />
              <ToolCard icon={<FileText />} title="Exporter le chat" description="Télécharger la conversation" variant="violet" onClick={exportChat} />
            </div>
          </section>

          <section className="meeting-rating-card">
            <div><span><Star size={31} fill="currentColor" /></span><section><h2>Comment s’est déroulée cette réunion ?</h2><p>Votre avis nous aide à améliorer MBotéRoom.</p></section></div>
            <div className="meeting-stars" role="radiogroup" aria-label="Note de la réunion">
              {[1, 2, 3, 4, 5].map((value) => {
                const selected = value <= (hoveredRating || rating);
                return (
                  <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} étoile${value > 1 ? 's' : ''}`} onMouseEnter={() => setHoveredRating(value)} onMouseLeave={() => setHoveredRating(0)} onClick={() => setRating(value)}>
                    <Star size={34} fill={selected ? 'currentColor' : 'none'} />
                  </button>
                );
              })}
            </div>
            <button className="meeting-rating-submit" type="button" onClick={submitRating}>Donner mon avis</button>
          </section>
        </section>

        <aside className="meeting-ended-sidebar">
          <section className="meeting-ended-side-card">
            <h2>Informations de la réunion</h2>
            <SideRow icon={<IdCard />} label="ID de réunion" value={formatMeetingId(endedMeeting.id)} />
            <SideRow icon={<UserRound />} label="Hôte" value={endedMeeting.host} />
            <SideRow icon={<CalendarDays />} label="Date" value={endedMeeting.date} />
            <SideRow icon={<Clock3 />} label="Heure" value={endedMeeting.time} />
            <SideRow icon={<ShieldCheck />} label="Sécurité" value={endedMeeting.secure ? 'Réunion sécurisée' : 'Réunion standard'} positive={endedMeeting.secure} />
          </section>

          <section className="meeting-ended-side-card">
            <h2>Prochaines actions</h2>
            <div className="meeting-followups">
              {actions.map((action) => (
                <button key={action.id} type="button" className={action.completed ? 'is-completed' : ''} onClick={() => setActions((current) => current.map((item) => item.id === action.id ? { ...item, completed: !item.completed } : item))}>
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

      {toast && <div className="meeting-ended-toast" role="status" aria-live="polite"><CheckCircle2 size={19} />{toast}</div>}
    </main>
  );
}

function StatCard({ icon, label, value, detail, action }: { icon: ReactNode; label: string; value: string; detail?: string; action?: ReactNode }) {
  return <article className="meeting-stat-card"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong>{detail && <em>{detail}</em>}</div>{action}</article>;
}

function ParticipantChip({ participant }: { participant: { name: string; role: string; online?: boolean } }) {
  return <article className="meeting-ended-participant"><span>{getInitials(participant.name)}{participant.online && <i />}</span><strong>{participant.name}</strong><small>{participant.role}</small></article>;
}

function ToolCard({ icon, title, description, variant, onClick }: { icon: ReactNode; title: string; description: string; variant: string; onClick: () => void }) {
  return <button className={`meeting-tool-card is-${variant}`} type="button" onClick={onClick}><span>{icon}</span><strong>{title}</strong><small>{description}</small></button>;
}

function SideRow({ icon, label, value, positive = false }: { icon: ReactNode; label: string; value: string; positive?: boolean }) {
  return <div className="meeting-ended-side-row"><span>{icon}</span><p>{label}</p><strong className={positive ? 'is-positive' : ''}>{value}</strong></div>;
}
