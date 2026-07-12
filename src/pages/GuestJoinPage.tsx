import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightToLine,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  Globe2,
  Hash,
  Headphones,
  Info,
  LockKeyhole,
  LogIn,
  MonitorSmartphone,
  ShieldCheck,
  UserRound,
  UsersRound,
  Video,
  XCircle,
  Zap,
} from 'lucide-react';
import { authService } from '../services/authService';
import { apiUrl } from '../lib/api';
import './GuestJoinPage.css';

type JoinForm = {
  name: string;
  meetingIdentifier: string;
  password: string;
};

type JoinErrors = Partial<Record<keyof JoinForm | 'global', string>>;

type RecentMeeting = {
  id: string;
  title: string;
  meetingCode: string;
  dateLabel: string;
};

type RecentMeetingsState = 'idle' | 'loading' | 'ready' | 'error';

type PublicMeetingResponse = {
  id?: number | string;
  title?: string;
  start_time?: string;
  meeting_link?: string;
  settings?: {
    meetingAccessId?: string;
    isPublic?: boolean;
    visibility?: string;
  };
};

const footerAdvantages = [
  {
    title: 'Sécurité de bout en bout',
    description: 'Vos données sont protégées',
    icon: ShieldCheck,
  },
  {
    title: 'Audio et vidéo HD',
    description: 'Qualité optimale pour vos réunions',
    icon: Video,
  },
  {
    title: 'Accessible sur tous vos appareils',
    description: 'Ordinateur, mobile et tablette',
    icon: MonitorSmartphone,
  },
  {
    title: 'Aucune installation requise',
    description: 'Rejoignez en un clic depuis votre navigateur',
    icon: Zap,
  },
] as const;

function normalizeMeetingIdentifier(value: string): string {
  const trimmedValue = value.trim();
  if (!trimmedValue) return '';

  try {
    const url = new URL(trimmedValue);
    const pathnameParts = url.pathname.split('/').filter(Boolean);
    return String(pathnameParts[pathnameParts.length - 1] || '').replace(/[\s-]+/g, '');
  } catch {
    return trimmedValue.replace(/[\s-]+/g, '');
  }
}

function isValidMeetingIdentifier(value: string): boolean {
  const normalizedValue = normalizeMeetingIdentifier(value);
  return /^[a-zA-Z0-9]{3,64}$/.test(normalizedValue);
}

function formatMeetingCode(value: string): string {
  return value.replace(/(.{3})/g, '$1 ').trim();
}

function formatMeetingDate(value?: string): string {
  if (!value) return 'Date à confirmer';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date à confirmer';

  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  if (isToday) return `Aujourd'hui à ${time}`;

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toRecentMeeting(meeting: PublicMeetingResponse): RecentMeeting | null {
  const rawCode = String(meeting.settings?.meetingAccessId || meeting.meeting_link || meeting.id || '').trim();
  const meetingCode = normalizeMeetingIdentifier(rawCode);
  if (!meetingCode) return null;

  return {
    id: String(meeting.id || meetingCode),
    title: String(meeting.title || 'Réunion MBotéRoom'),
    meetingCode: formatMeetingCode(meetingCode),
    dateLabel: formatMeetingDate(meeting.start_time),
  };
}

export default function GuestJoinPage() {
  const navigate = useNavigate();
  const meetingIdentifierRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<JoinForm>({
    name: '',
    meetingIdentifier: '',
    password: '',
  });
  const [errors, setErrors] = useState<JoinErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([]);
  const [recentMeetingsState, setRecentMeetingsState] = useState<RecentMeetingsState>('idle');
  useEffect(() => {
    let cancelled = false;

    const loadRecentMeetings = async () => {
      setRecentMeetingsState('loading');
      try {
        const response = await fetch(apiUrl('/api/public/meetings'));
        const payload = await response.json().catch(() => []);
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error('Chargement impossible.');
        }
        const meetings = payload
          .map((meeting: PublicMeetingResponse) => toRecentMeeting(meeting))
          .filter((meeting: RecentMeeting | null): meeting is RecentMeeting => Boolean(meeting))
          .slice(0, 4);

        if (!cancelled) {
          setRecentMeetings(meetings);
          setRecentMeetingsState('ready');
        }
      } catch {
        if (!cancelled) {
          setRecentMeetings([]);
          setRecentMeetingsState('error');
        }
      }
    };

    void loadRecentMeetings();

    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedMeetingIdentifier = useMemo(
    () => normalizeMeetingIdentifier(form.meetingIdentifier),
    [form.meetingIdentifier],
  );

  const updateField = <Field extends keyof JoinForm>(field: Field, value: JoinForm[Field]) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
    setErrors((currentErrors) => ({ ...currentErrors, [field]: undefined, global: undefined }));
  };

  const validateForm = () => {
    const nextErrors: JoinErrors = {};
    const trimmedName = form.name.trim();

    if (!trimmedName) {
      nextErrors.name = 'Veuillez saisir votre nom.';
    } else if (trimmedName.length < 2) {
      nextErrors.name = 'Votre nom doit contenir au moins 2 caractères.';
    } else if (trimmedName.length > 80) {
      nextErrors.name = 'Votre nom ne peut pas dépasser 80 caractères.';
    }

    if (!form.meetingIdentifier.trim()) {
      nextErrors.meetingIdentifier = "Veuillez saisir l'ID ou le lien de la réunion.";
    } else if (!isValidMeetingIdentifier(form.meetingIdentifier)) {
      nextErrors.meetingIdentifier = "L'ID ou le lien de réunion n'est pas valide.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !validateForm()) return;

    setIsSubmitting(true);
    setErrors({});

    try {
      const result = await authService.guestJoin({
        name: form.name.trim(),
        meetingCode: normalizedMeetingIdentifier,
        password: form.password,
      });
      setForm((currentForm) => ({ ...currentForm, password: '' }));
      const target = result.meeting?.id
        ? `/reunions/${encodeURIComponent(String(result.meeting.id))}/salle-attente`
        : '/join';
      navigate(target, {
        replace: true,
        state: {
          guestName: form.name.trim(),
          meetingId: result.meeting?.id || normalizedMeetingIdentifier,
          meeting: result.meeting,
          isGuest: true,
        },
      });
    } catch (error) {
      setErrors({
        global: error instanceof Error ? error.message : 'Impossible de rejoindre cette réunion.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectRecentMeeting = (meeting: RecentMeeting) => {
    updateField('meetingIdentifier', meeting.meetingCode);
    requestAnimationFrame(() => meetingIdentifierRef.current?.focus());
  };

  const handleRecentMeetingKeyboard = (event: KeyboardEvent<HTMLButtonElement>, meeting: RecentMeeting) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectRecentMeeting(meeting);
    }
  };

  return (
    <main className="guest-join-page">
      <GuestJoinHeader />

      <section className="guest-join-layout" aria-label="Rejoindre une réunion MBotéRoom">
        <div className="guest-join-left">
          <section className="guest-join-card" aria-labelledby="guest-join-title">
            <header className="guest-join-card-header">
              <span className="guest-join-header-icon">
                <ArrowRightToLine size={39} aria-hidden="true" />
              </span>
              <div>
                <h1 id="guest-join-title">Rejoindre une réunion</h1>
                <p>Entrez vos informations pour participer en tant qu'invité.</p>
              </div>
            </header>

            <form className="guest-join-form" onSubmit={submitJoin} noValidate>
              <JoinField
                id="guest-name"
                label="Votre nom"
                error={errors.name}
                icon={<UserRound size={22} aria-hidden="true" />}
              >
                <input
                  id="guest-name"
                  type="text"
                  value={form.name}
                  autoComplete="name"
                  placeholder="Ex. : Marie Dupont"
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={errors.name ? 'guest-name-error' : undefined}
                  onChange={(event) => updateField('name', event.target.value)}
                />
              </JoinField>

              <JoinField
                id="meeting-identifier"
                label="ID ou lien de réunion"
                error={errors.meetingIdentifier}
                icon={<Hash size={24} aria-hidden="true" />}
                action={form.meetingIdentifier ? (
                  <button
                    className="guest-input-action"
                    type="button"
                    aria-label="Effacer l'ID de réunion"
                    onClick={() => updateField('meetingIdentifier', '')}
                  >
                    <XCircle size={20} aria-hidden="true" />
                  </button>
                ) : null}
              >
                <input
                  ref={meetingIdentifierRef}
                  id="meeting-identifier"
                  type="text"
                  value={form.meetingIdentifier}
                  autoComplete="off"
                  placeholder="Ex. : 123 456 789 ou https://mboteroom.com/j/123456789"
                  aria-invalid={Boolean(errors.meetingIdentifier)}
                  aria-describedby={errors.meetingIdentifier ? 'meeting-identifier-error' : undefined}
                  onChange={(event) => updateField('meetingIdentifier', event.target.value)}
                />
              </JoinField>

              <JoinField
                id="meeting-password"
                label="Mot de passe (si requis)"
                icon={<LockKeyhole size={21} aria-hidden="true" />}
                action={(
                  <button
                    className="guest-input-action"
                    type="button"
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    onClick={() => setShowPassword((currentValue) => !currentValue)}
                  >
                    {showPassword ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
                  </button>
                )}
              >
                <input
                  id="meeting-password"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  autoComplete="off"
                  placeholder="Entrez le mot de passe de la réunion"
                  onChange={(event) => updateField('password', event.target.value)}
                />
              </JoinField>

              {errors.global && (
                <div className="guest-global-error" role="alert">
                  <Info size={20} aria-hidden="true" />
                  <span>{errors.global}</span>
                </div>
              )}

              <button className="guest-join-submit" type="submit" disabled={isSubmitting}>
                <ArrowRightToLine size={22} aria-hidden="true" />
                {isSubmitting ? 'Connexion à la réunion...' : 'Rejoindre la réunion'}
              </button>

              <div className="waiting-room-note">
                <Info size={21} aria-hidden="true" />
                <span>Vous serez placé dans la salle d'attente jusqu'à validation de l'hôte.</span>
              </div>

              <div className="guest-auth-links">
                <span>Vous n'avez pas de compte ?</span>
                <Link to="/inscription">Créer un compte</Link>
                <span className="guest-link-divider" aria-hidden="true" />
                <Link className="guest-login-link" to="/connexion">
                  <LogIn size={19} aria-hidden="true" />
                  Se connecter
                </Link>
              </div>
            </form>
          </section>

          <section className="recent-meetings-card" aria-labelledby="recent-meetings-title">
            <h2 id="recent-meetings-title">Liens récents ou publics</h2>
            {recentMeetingsState === 'loading' && <p className="recent-meetings-status">Chargement des réunions publiques...</p>}
            {recentMeetingsState === 'error' && <p className="recent-meetings-status">Les liens publics sont indisponibles pour le moment.</p>}
            {recentMeetingsState === 'ready' && recentMeetings.length === 0 && (
              <p className="recent-meetings-status">Aucune réunion publique disponible.</p>
            )}
            {recentMeetings.map((meeting) => (
              <button
                className="recent-meeting"
                type="button"
                key={meeting.id}
                onClick={() => selectRecentMeeting(meeting)}
                onKeyDown={(event) => handleRecentMeetingKeyboard(event, meeting)}
              >
                <span className="recent-meeting-icon">
                  <Globe2 size={22} aria-hidden="true" />
                </span>
                <span className="recent-meeting-information">
                  <strong>{meeting.title}</strong>
                  <small>ID : {meeting.meetingCode}</small>
                </span>
                <span className="recent-meeting-date">
                  <CalendarDays size={20} aria-hidden="true" />
                  {meeting.dateLabel}
                </span>
                <ChevronRight className="recent-meeting-arrow" size={23} aria-hidden="true" />
              </button>
            ))}
            <button className="recent-meetings-all" type="button" onClick={() => navigate('/reunions/recentes')}>
              Voir tous les liens récents
            </button>
          </section>
        </div>

        <aside className="guest-join-right" aria-label="Informations invité">
          <GuestAccessCard />
          <InformationCard
            icon={<Headphones size={39} aria-hidden="true" />}
            iconVariant="soft"
            title="Besoin d'aide ?"
            linkLabel="Centre d'aide"
            linkTo="/aide"
          >
            Consultez notre centre d'aide ou contactez notre support.
          </InformationCard>
        </aside>
      </section>

      <footer className="guest-join-footer" aria-label="Avantages MBotéRoom">
        {footerAdvantages.map((item) => {
          const Icon = item.icon;
          return (
            <div className="guest-footer-item" key={item.title}>
              <Icon size={28} aria-hidden="true" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.description}</small>
              </span>
            </div>
          );
        })}
      </footer>
    </main>
  );
}

function GuestJoinHeader() {
  return (
    <header className="guest-join-header">
      <Link className="guest-brand" to="/app" aria-label="Accueil MBotéRoom">
        <span className="guest-brand-icon">
          <UsersRound size={28} aria-hidden="true" />
        </span>
        <span className="guest-brand-copy">
          <strong><span>MBoté</span><span>Room</span></strong>
          <small>Réunions sécurisées</small>
        </span>
      </Link>

      <nav className="guest-header-actions" aria-label="Navigation invité">
        <span className="guest-badge">
          <UserRound size={18} aria-hidden="true" />
          Invité
        </span>
        <Link className="guest-header-login" to="/connexion">Se connecter</Link>
        <Link className="guest-header-register" to="/inscription">Créer un compte</Link>
      </nav>
    </header>
  );
}

function JoinField({
  id,
  label,
  icon,
  error,
  action,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="guest-form-group">
      <label htmlFor={id}>{label}</label>
      <div className={error ? 'guest-input has-error' : 'guest-input'}>
        <span className="guest-input-icon">{icon}</span>
        {children}
        {action}
      </div>
      {error && (
        <p className="guest-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function GuestAccessCard() {
  return (
    <section className="guest-side-card guest-access-card" aria-labelledby="guest-access-title">
      <div>
        <h2 id="guest-access-title">Accès invité</h2>
        <p>Vous participez en tant qu'invité. Certaines fonctionnalités peuvent être limitées (enregistrement, historique des discussions, etc.).</p>
      </div>
      <MeetingDevicesIllustration compact />
    </section>
  );
}

function InformationCard({
  icon,
  iconVariant,
  title,
  linkLabel,
  linkTo,
  children,
}: {
  icon: React.ReactNode;
  iconVariant: 'blue' | 'soft';
  title: string;
  linkLabel: string;
  linkTo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="guest-side-card information-card">
      <span className={`information-card-icon is-${iconVariant}`}>{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
        <Link to={linkTo}>
          {linkLabel}
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function MeetingDevicesIllustration({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'meeting-devices is-compact' : 'meeting-devices'} aria-hidden="true">
      <div className="devices-plant">
        <span className="devices-leaf leaf-a" />
        <span className="devices-leaf leaf-b" />
        <span className="devices-leaf leaf-c" />
        <span className="devices-leaf leaf-d" />
        <span className="devices-stem" />
        <span className="devices-pot" />
      </div>
      <div className="devices-laptop">
        <div className="devices-screen">
          <span className="device-person person-a"><UserRound size={27} /></span>
          <span className="device-person person-b"><UserRound size={27} /></span>
          <span className="device-person person-c"><UserRound size={27} /></span>
          <span className="device-person person-d"><UserRound size={27} /></span>
        </div>
        <span className="devices-base" />
      </div>
      <div className="devices-phone">
        <span className="devices-speaker" />
        <span className="devices-phone-logo"><UsersRound size={14} /></span>
        <strong>MBotéRoom</strong>
      </div>
    </div>
  );
}
