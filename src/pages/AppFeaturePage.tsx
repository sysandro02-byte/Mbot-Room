import { FormEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  CirclePlay,
  Download,
  Eraser,
  MessageCircle,
  Plus,
  Save,
  Search,
  Settings,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { authService } from '../services/authService';
import { getMeetingAccessCode, Meeting, meetingService } from '../services/meetingService';
import AppShell from '../components/AppShell';
import './AppFeaturePage.css';
import { useNavigate } from 'react-router-dom';

type FeatureKind = 'calendar' | 'recordings' | 'messages' | 'contacts' | 'whiteboard' | 'polls' | 'settings' | 'profile';

type AppFeaturePageProps = {
  kind: FeatureKind;
};

type LocalMessage = {
  id: string;
  text: string;
  createdAt: string;
};

type LocalPoll = {
  id: string;
  question: string;
  options: Array<{ id: string; label: string; votes: number }>;
  createdAt: string;
};

const loadLocalMessages = (userId: string): LocalMessage[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(`mboteroom.messages.${userId || 'anonymous'}`) || '[]');
    return Array.isArray(stored)
      ? stored.filter((item): item is LocalMessage => Boolean(item?.id && item?.text && item?.createdAt))
      : [];
  } catch {
    return [];
  }
};

const loadLocalPolls = (userId: string): LocalPoll[] => {
  try {
    const stored = JSON.parse(localStorage.getItem('mboteroom.polls.' + (userId || 'anonymous')) || '[]');
    return Array.isArray(stored)
      ? stored.filter((item): item is LocalPoll => Boolean(item?.id && item?.question && Array.isArray(item?.options)))
      : [];
  } catch {
    return [];
  }
};
const featureTitles: Record<FeatureKind, string> = {
  calendar: 'Calendrier',
  recordings: 'Enregistrements',
  messages: 'Messages',
  contacts: 'Contacts',
  whiteboard: 'Tableau blanc',
  polls: 'Sondages',
  settings: 'Paramètres',
  profile: 'Mon profil',
};

const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

const isUserMeeting = (meeting: Meeting) => {
  const user = authService.getCurrentUser();
  const userId = String(user?.id || '');
  const tokens = [user?.id, user?.email, user?.username, user?.name].filter(Boolean).map((item) => String(item).toLowerCase());
  return String(meeting.host_id) === userId
    || String(meeting.co_host_id || '') === userId
    || (meeting.settings?.participants || []).some((participant) => tokens.includes(String(participant).toLowerCase()));
};

export default function AppFeaturePage({ kind }: AppFeaturePageProps) {
  const currentUser = authService.getCurrentUser();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [messageDraft, setMessageDraft] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>(() => loadLocalMessages(currentUser?.id || ''));
  const [contactSearch, setContactSearch] = useState('');
  const [pollQuestion, setPollQuestion] = useState('Votre avis sur la réunion ?');
  const [pollOptionA, setPollOptionA] = useState('Oui');
  const [pollOptionB, setPollOptionB] = useState('Non');
  const [polls, setPolls] = useState<LocalPoll[]>(() => loadLocalPolls(currentUser?.id || ''));
  const [brushColor, setBrushColor] = useState('#3156eb');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const previousPointRef = useRef<{ x: number; y: number } | null>(null);
  const [saved, setSaved] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const loadMeetings = async () => {
      setIsLoading(true);
      const data = await meetingService.getMeetings().catch(() => []);
      if (!cancelled) {
        setMeetings(Array.isArray(data) ? data.filter(isUserMeeting) : []);
        setIsLoading(false);
      }
    };
    void loadMeetings();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(`mboteroom.messages.${currentUser?.id || 'anonymous'}`, JSON.stringify(messages));
  }, [currentUser?.id, messages]);
  useEffect(() => {
    localStorage.setItem('mboteroom.polls.' + (currentUser?.id || 'anonymous'), JSON.stringify(polls));
  }, [currentUser?.id, polls]);

  useEffect(() => {
    if (kind !== 'whiteboard') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
    }
  }, [kind]);

  const upcomingMeetings = useMemo(() => meetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 >= Date.now())
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()), [meetings]);

  const recentMeetings = useMemo(() => meetings
    .filter((meeting) => new Date(meeting.start_time).getTime() + meeting.duration * 60_000 < Date.now() || meeting.is_active)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()), [meetings]);

  const contacts = useMemo(() => {
    const values = new Set<string>();
    for (const meeting of meetings) {
      if (meeting.host_name) values.add(meeting.host_name.trim());
      for (const participant of meeting.settings?.participants || []) {
        const value = String(participant).trim();
        if (value) values.add(value);
      }
    }
    const query = contactSearch.trim().toLocaleLowerCase('fr-FR');
    return [...values]
      .filter((contact) => !query || contact.toLocaleLowerCase('fr-FR').includes(query))
      .sort((a, b) => a.localeCompare(b, 'fr-FR'));
  }, [contactSearch, meetings]);

  const submitMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = messageDraft.trim().slice(0, 1000);
    if (!text) {
      setSaved('Écrivez un message avant de l’enregistrer.');
      return;
    }
    setMessages((current) => [{ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }, ...current].slice(0, 50));
    setMessageDraft('');
    setSaved('Message enregistré.');
  };

  const submitPoll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = pollQuestion.trim().slice(0, 200);
    const optionA = pollOptionA.trim().slice(0, 80);
    const optionB = pollOptionB.trim().slice(0, 80);
    if (!question || !optionA || !optionB || optionA.toLocaleLowerCase('fr-FR') === optionB.toLocaleLowerCase('fr-FR')) {
      setSaved('Ajoutez une question et deux réponses différentes.');
      return;
    }
    setPolls((current) => [{
      id: crypto.randomUUID(),
      question,
      createdAt: new Date().toISOString(),
      options: [
        { id: crypto.randomUUID(), label: optionA, votes: 0 },
        { id: crypto.randomUUID(), label: optionB, votes: 0 },
      ],
    }, ...current].slice(0, 20));
    setPollQuestion('');
    setPollOptionA('Oui');
    setPollOptionB('Non');
    setSaved('Sondage créé et enregistré sur cet appareil.');
  };

  const vote = (pollId: string, optionId: string) => {
    setPolls((current) => current.map((poll) => poll.id === pollId ? {
      ...poll,
      options: poll.options.map((option) => option.id === optionId ? { ...option, votes: option.votes + 1 } : option),
    } : poll));
  };

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    if (!canvas || !point) return;
    canvas.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    previousPointRef.current = point;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = brushColor;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(2, canvas.width / 300), 0, Math.PI * 2);
      context.fill();
    }
  };

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    const previousPoint = previousPointRef.current;
    if (!canvas || !point || !previousPoint) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.strokeStyle = brushColor;
    context.lineWidth = Math.max(3, canvas.width / 180);
    context.beginPath();
    context.moveTo(previousPoint.x, previousPoint.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    previousPointRef.current = point;
  };

  const stopDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    previousPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearWhiteboard = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    setSaved('Tableau effacé.');
  };

  const downloadWhiteboard = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'mboteroom-tableau-' + new Date().toISOString().slice(0, 10) + '.png';
      link.click();
      URL.revokeObjectURL(url);
      setSaved('Tableau exporté en PNG.');
    }, 'image/png');
  };
  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved('Modifications enregistrées localement pour cette session.');
  };

  return (
    <AppShell title={featureTitles[kind]}>
      <section className="app-feature-page">
        <header className="app-feature-hero">
          <span>{featureIcon(kind)}</span>
          <div>
            <h1>{featureTitles[kind]}</h1>
            <p>{featureIntro(kind)}</p>
          </div>
        </header>

        {kind === 'calendar' && (
          <section className="app-feature-grid">
            <FeaturePanel title="Réunions programmées">
              {isLoading ? <p>Chargement...</p> : upcomingMeetings.length ? upcomingMeetings.map((meeting) => <MeetingLine key={meeting.id} meeting={meeting} />) : <p>Aucune réunion programmée.</p>}
            </FeaturePanel>
            <FeaturePanel title="Actions rapides">
              <button className="app-feature-primary" type="button" onClick={() => navigate('/app/meetings')}>
                <Plus size={18} /> Programmer une réunion
              </button>
            </FeaturePanel>
          </section>
        )}

        {kind === 'recordings' && (
          <FeaturePanel title="Réunions récentes">
            {recentMeetings.length ? recentMeetings.map((meeting) => <MeetingLine key={meeting.id} meeting={meeting} meta="Résumé et enregistrement à conserver selon les réglages de la réunion." />) : <p>Aucun enregistrement disponible.</p>}
          </FeaturePanel>
        )}

        {kind === 'messages' && (
          <FeaturePanel title="Messages de réunion">
            <form className="app-feature-form" onSubmit={submitMessage}>
              <label>
                <span>Nouveau message</span>
                <textarea maxLength={1000} value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Écrire une note ou un message d'équipe..." />
              </label>
              <button type="submit" disabled={!messageDraft.trim()}><Save size={18} /> Enregistrer</button>
            </form>
            <div className="app-feature-message-list" aria-live="polite">
              {messages.length ? messages.map((message) => (
                <article key={message.id}>
                  <p>{message.text}</p>
                  <small>{formatDate(message.createdAt)}</small>
                  <button type="button" onClick={() => setMessages((current) => current.filter((item) => item.id !== message.id))}>Supprimer</button>
                </article>
              )) : <p>Aucun message enregistré.</p>}
            </div>
          </FeaturePanel>
        )}

        {kind === 'contacts' && (
          <FeaturePanel title="Participants et contacts">
            <div className="app-feature-search"><Search size={18} /><input type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Rechercher un contact..." aria-label="Rechercher un contact" /></div>
            <div className="app-feature-contact-list">
              {contacts.length ? contacts.map((contact) => (
                <article key={contact}>
                  <span>{contact.slice(0, 2).toUpperCase()}</span>
                  <strong>{contact}</strong>
                </article>
              )) : <p>{contactSearch ? 'Aucun contact trouvé.' : 'Aucun contact synchronisé pour le moment.'}</p>}
            </div>
          </FeaturePanel>
        )}

        {kind === 'whiteboard' && (
          <FeaturePanel title="Tableau blanc rapide">
            <div className="whiteboard-toolbar">
              <label>
                <span>Couleur</span>
                <input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} aria-label="Couleur du pinceau" />
              </label>
              <button type="button" onClick={clearWhiteboard}><Eraser size={18} /> Effacer</button>
              <button type="button" onClick={downloadWhiteboard}><Download size={18} /> Exporter PNG</button>
            </div>
            <canvas
              ref={canvasRef}
              className="whiteboard-canvas"
              aria-label="Tableau blanc interactif"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
            />
            <p className="whiteboard-hint">Dessinez avec la souris, un stylet ou votre doigt.</p>
          </FeaturePanel>
        )}

        {kind === 'polls' && (
          <div className="app-feature-grid app-feature-polls-grid">
            <FeaturePanel title="Créer un sondage">
              <form className="app-feature-form" onSubmit={submitPoll}>
                <label>
                  <span>Question</span>
                  <input maxLength={200} value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Votre question..." />
                </label>
                <label>
                  <span>Première réponse</span>
                  <input maxLength={80} value={pollOptionA} onChange={(event) => setPollOptionA(event.target.value)} />
                </label>
                <label>
                  <span>Deuxième réponse</span>
                  <input maxLength={80} value={pollOptionB} onChange={(event) => setPollOptionB(event.target.value)} />
                </label>
                <button type="submit" disabled={!pollQuestion.trim() || !pollOptionA.trim() || !pollOptionB.trim()}><Check size={18} /> Créer le sondage</button>
              </form>
            </FeaturePanel>
            <FeaturePanel title="Sondages actifs">
              <div className="app-feature-poll-list" aria-live="polite">
                {polls.length ? polls.map((poll) => {
                  const totalVotes = poll.options.reduce((total, option) => total + option.votes, 0);
                  return (
                    <article key={poll.id} className="app-feature-poll-card">
                      <div className="app-feature-poll-heading">
                        <div><strong>{poll.question}</strong><small>{totalVotes} vote{totalVotes > 1 ? 's' : ''}</small></div>
                        <button type="button" onClick={() => setPolls((current) => current.filter((item) => item.id !== poll.id))}>Supprimer</button>
                      </div>
                      {poll.options.map((option) => {
                        const percentage = totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
                        return (
                          <button key={option.id} className="app-feature-poll-option" type="button" onClick={() => vote(poll.id, option.id)}>
                            <span style={{ width: percentage + '%' }} />
                            <strong>{option.label}</strong>
                            <em>{option.votes} · {percentage}%</em>
                          </button>
                        );
                      })}
                    </article>
                  );
                }) : <p>Aucun sondage créé.</p>}
              </div>
            </FeaturePanel>
          </div>
        )}

        {(kind === 'settings' || kind === 'profile') && (
          <FeaturePanel title={kind === 'profile' ? 'Informations du compte' : 'Préférences'}>
            <form className="app-feature-form" onSubmit={handleSave}>
              <label>
                <span>Nom</span>
                <input defaultValue={currentUser?.name || ''} />
              </label>
              <label>
                <span>Email</span>
                <input defaultValue={currentUser?.email || ''} readOnly />
              </label>
              <button type="submit"><Save size={18} /> Enregistrer</button>
            </form>
          </FeaturePanel>
        )}

        {saved && <p className="app-feature-status" role="status">{saved}</p>}
      </section>
    </AppShell>
  );
}

function FeaturePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="app-feature-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MeetingLine({ meeting, meta }: { meeting: Meeting; meta?: string }) {
  return (
    <article className="app-feature-meeting-line">
      <CalendarDays size={20} aria-hidden="true" />
      <div>
        <strong>{meeting.title}</strong>
        <small>{formatDate(meeting.start_time)} · ID {getMeetingAccessCode(meeting)}</small>
        {meta && <p>{meta}</p>}
      </div>
    </article>
  );
}

function featureIcon(kind: FeatureKind) {
  if (kind === 'calendar') return <CalendarDays size={28} />;
  if (kind === 'recordings') return <CirclePlay size={28} />;
  if (kind === 'messages') return <MessageCircle size={28} />;
  if (kind === 'contacts') return <UsersRound size={28} />;
  if (kind === 'whiteboard') return <Sparkles size={28} />;
  if (kind === 'polls') return <Check size={28} />;
  return <Settings size={28} />;
}

function featureIntro(kind: FeatureKind) {
  if (kind === 'calendar') return 'Consultez vos réunions programmées et planifiez vos prochains rendez-vous.';
  if (kind === 'recordings') return 'Retrouvez les réunions récentes et les résumés associés.';
  if (kind === 'messages') return 'Préparez vos messages et notes de réunion.';
  if (kind === 'contacts') return 'Retrouvez les participants ajoutés à vos réunions.';
  if (kind === 'whiteboard') return 'Collaborez visuellement avec votre équipe.';
  if (kind === 'polls') return 'Préparez rapidement des votes pour vos réunions.';
  if (kind === 'profile') return 'Consultez les informations de votre compte.';
  return 'Gérez vos préférences de compte et de réunion.';
}
