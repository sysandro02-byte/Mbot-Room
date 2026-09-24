import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRightToLine,
  ChevronRight,
  Eye,
  EyeOff,
  Hash,
  Headphones,
  Info,
  LockKeyhole,
  MonitorSmartphone,
  ShieldCheck,
  UserRound,
  Video,
  XCircle,
  Zap,
} from 'lucide-react';
import { authService } from '../services/authService';
import TermsConsent from '../components/TermsConsent';
import './GuestJoinPage.css';

type JoinForm = {
  name: string;
  meetingIdentifier: string;
  password: string;
};

type JoinErrors = Partial<Record<keyof JoinForm | 'global', string>>;

const footerAdvantages = [
  {
    title: 'Accès protégés',
    description: 'Vos données sont protégées',
    icon: ShieldCheck,
  },
  {
    title: 'Audio et vidéo de qualité',
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

export default function GuestJoinPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<JoinForm>({
    name: '',
    meetingIdentifier: '',
    password: '',
  });
  const [errors, setErrors] = useState<JoinErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsVersion, setTermsVersion] = useState('');
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
    if (!termsAccepted || !termsVersion) {
      setErrors({ global: "Vous devez lire et accepter les conditions d’utilisation avant de rejoindre en invité." });
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const result = await authService.guestJoin({
        name: form.name.trim(),
        meetingCode: normalizedMeetingIdentifier,
        password: form.password,
        termsAccepted,
        termsVersion,
      });
      setForm((currentForm) => ({ ...currentForm, password: '' }));
      const target = result.meeting?.meeting_link
        ? `/reunions/${encodeURIComponent(String(result.meeting.meeting_link))}/salle-attente`
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

  return (
    <main className="guest-join-page">

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

            <div className="guest-trust-strip" aria-label="Avantages de l'accès invité">
              <div className="guest-trust-button">
                <span><ShieldCheck size={16}/> Accès sécurisé</span>
                <i aria-hidden="true" />
                <span><MonitorSmartphone size={16}/> Tous appareils</span>
                <i aria-hidden="true" />
                <span><Video size={16}/> Prévisualisation avant entrée</span>
              </div>
            </div>

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
                label="Code ou lien de réunion"
                error={errors.meetingIdentifier}
                icon={<Hash size={24} aria-hidden="true" />}
                action={form.meetingIdentifier ? (
                  <button
                    className="guest-input-action"
                    type="button"
                    aria-label="Effacer l'Code de réunion"
                    onClick={() => updateField('meetingIdentifier', '')}
                  >
                    <XCircle size={20} aria-hidden="true" />
                  </button>
                ) : null}
              >
                <input
                  id="meeting-identifier"
                  type="text"
                  value={form.meetingIdentifier}
                  autoComplete="off"
                  placeholder="Ex. : 123 456 789"
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

              <TermsConsent
                accepted={termsAccepted}
                version={termsVersion}
                autoOpen
                onAccepted={(accepted,version)=>{setTermsAccepted(accepted);setTermsVersion(version);setErrors((current)=>({...current,global:undefined}));}}
              />

              {errors.global && (
                <div className="guest-global-error" role="alert">
                  <Info size={20} aria-hidden="true" />
                  <span>{errors.global}</span>
                </div>
              )}

              <button className="guest-join-submit" type="submit" disabled={isSubmitting || !termsAccepted || !termsVersion}>
                <ArrowRightToLine size={22} aria-hidden="true" />
                {isSubmitting ? 'Connexion à la réunion...' : 'Rejoindre la réunion'}
              </button>

              <div className="waiting-room-note">
                <Info size={21} aria-hidden="true" />
                <span>Selon les règles définies par l’hôte, vous pourrez être placé dans la salle d’attente avant d’entrer.</span>
              </div>
            </form>
          </section>

        </div>

        <aside className="guest-join-right" aria-label="Informations invité">
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
        <div className="guest-created-by">MBotéRoom est une application créée par <strong>LoukaTech</strong>.</div>
      </footer>
    </main>
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
