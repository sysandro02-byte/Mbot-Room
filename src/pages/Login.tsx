import { FocusEvent, FormEvent, KeyboardEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Building2,
  Eye,
  EyeOff,
  Globe2,
  Laptop,
  Lock,
  LogIn,
  Mail,
  Monitor,
  Phone,
  Sparkles,
  ShieldCheck,
  User,
  UsersRound,
  Video,
  Zap,
} from 'lucide-react';
import { authService } from '../services/authService';
import './Login.css';

type AuthView = 'login' | 'register' | 'guest' | 'forgot';
type Language = 'fr' | 'en' | 'ln' | 'ar';

type LoginProps = {
  initialView?: AuthView;
};

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'phoneNumber' | 'organization' | 'jobTitle' | 'meetingCode' | 'meetingPassword', string>>;

const translations = {
  fr: {
    languageLabel: 'FranÃ§ais',
    ariaLanguage: 'SÃ©lectionner la langue',
    brandTitle: 'RÃ©unions sÃ©curisÃ©es',
    heroTitle: 'RÃ©unions sÃ©curisÃ©es\npour tous',
    heroDescription: 'Organisez, rejoignez et collaborez\nen toute simplicitÃ© avec MBotÃ©Room.',
    features: [
      ['SÃ©curisÃ©', 'Vos rÃ©unions sont protÃ©gÃ©es avec un chiffrement de bout en bout.'],
      ['Facile Ã  utiliser', 'Interface intuitive pour crÃ©er et rejoindre vos rÃ©unions en un clic.'],
      ['Audio et vidÃ©o HD', "Profitez d'une qualitÃ© audio et vidÃ©o exceptionnelle."],
      ['Accessible partout', "Utilisable sur tous vos appareils, n'importe oÃ¹, n'importe quand."],
    ],
    footerBenefits: [
      'SÃ©curitÃ© de bout en bout',
      'Audio et vidÃ©o HD',
      'Accessible sur tous vos appareils',
      'Aucune installation requise',
    ],
    title: 'Connexion',
    subtitle: 'Connectez-vous Ã  votre compte MBotÃ©Room',
    email: 'Adresse e-mail',
    emailPlaceholder: 'exemple@mail.com',
    password: 'Mot de passe',
    passwordPlaceholder: 'Votre mot de passe',
    remember: 'Se souvenir de moi',
    forgot: 'Mot de passe oubliÃ© ?',
    submit: 'Se connecter',
    submitting: 'Connexion en cours...',
    or: 'ou',
    google: 'Continuer avec MBotÃ©',
    joinTitle: 'Rejoindre une rÃ©union',
    joinText: "Vous n'avez pas de compte ? Rejoignez une rÃ©union en tant qu'invitÃ©.",
    noAccount: 'Pas encore de compte ?',
    createAccount: 'CrÃ©er un compte',
  },
  en: {
    languageLabel: 'English',
    ariaLanguage: 'Select language',
    brandTitle: 'Secure meetings',
    heroTitle: 'Secure meetings\nfor everyone',
    heroDescription: 'Host, join, and collaborate\nwith MBotÃ©Room in total simplicity.',
    features: [
      ['Secure', 'Your meetings are protected with end-to-end encryption.'],
      ['Easy to use', 'An intuitive interface to create and join meetings in one click.'],
      ['HD audio and video', 'Enjoy outstanding audio and video quality.'],
      ['Available everywhere', 'Use it on all your devices, anywhere, anytime.'],
    ],
    footerBenefits: [
      'End-to-end security',
      'HD audio and video',
      'Available on all your devices',
      'No installation required',
    ],
    title: 'Sign in',
    subtitle: 'Sign in to your MBotÃ©Room account',
    email: 'Email address',
    emailPlaceholder: 'example@mail.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    remember: 'Remember me',
    forgot: 'Forgot password?',
    submit: 'Sign in',
    submitting: 'Signing in...',
    or: 'or',
    google: 'Continue with MBotÃ©',
    joinTitle: 'Join a meeting',
    joinText: "No account? Join a meeting as a guest.",
    noAccount: "Don't have an account?",
    createAccount: 'Create account',
  },
  ln: {
    languageLabel: 'Lingala',
    ariaLanguage: 'Pona monoko',
    brandTitle: 'Masolo ya libateli',
    heroTitle: 'Masolo ya libateli\nmpo na bato nyonso',
    heroDescription: 'Bongisa, kota mpe sala elongo\nna MBotÃ©Room na pete.',
    features: [
      ['Ebatelami', 'Masolo na yo ebatelami na chiffrement ya suka na suka.'],
      ['Pete kosalela', 'Interface ya pete mpo na kosala mpe kokota na rÃ©union na clic moko.'],
      ['Audio mpe video HD', 'Sepela na qualitÃ© ya malamu mpo na mongongo mpe video.'],
      ['Ezali bisika nyonso', 'Salela yango na ba appareils nyonso, bisika nyonso, ntango nyonso.'],
    ],
    footerBenefits: [
      'Libateli ya suka na suka',
      'Audio mpe video HD',
      'Ezali na ba appareils nyonso',
      'Installation esengeli te',
    ],
    title: 'Kokota',
    subtitle: 'Kota na compte na yo ya MBotÃ©Room',
    email: 'Adresse e-mail',
    emailPlaceholder: 'exemple@mail.com',
    password: 'Mot de passe',
    passwordPlaceholder: 'Mot de passe na yo',
    remember: 'Kobomba ngai',
    forgot: 'Obosani mot de passe ?',
    submit: 'Kokota',
    submitting: 'Kokota ezali kosalema...',
    or: 'to',
    google: 'Koba na MBotÃ©',
    joinTitle: 'Kokota na rÃ©union',
    joinText: "Ozangi compte ? Kota na rÃ©union lokola invitÃ©.",
    noAccount: 'Ozali nanu na compte te ?',
    createAccount: 'Kosala compte',
  },
  ar: {
    languageLabel: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
    ariaLanguage: 'Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„Ù„ØºØ©',
    brandTitle: 'Ø§Ø¬ØªÙ…Ø§Ø¹Ø§Øª Ø¢Ù…Ù†Ø©',
    heroTitle: 'Ø§Ø¬ØªÙ…Ø§Ø¹Ø§Øª Ø¢Ù…Ù†Ø©\nÙ„Ù„Ø¬Ù…ÙŠØ¹',
    heroDescription: 'Ù†Ø¸Ù‘Ù… Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹Ø§Øª ÙˆØ§Ù†Ø¶Ù… ÙˆØªØ¹Ø§ÙˆÙ†\nØ¨ÙƒÙ„ Ø³Ù‡ÙˆÙ„Ø© Ù…Ø¹ MBotÃ©Room.',
    features: [
      ['Ø¢Ù…Ù†', 'Ø§Ø¬ØªÙ…Ø§Ø¹Ø§ØªÙƒ Ù…Ø­Ù…ÙŠØ© Ø¨ØªØ´ÙÙŠØ± Ù…Ù† Ø§Ù„Ø·Ø±Ù Ø¥Ù„Ù‰ Ø§Ù„Ø·Ø±Ù.'],
      ['Ø³Ù‡Ù„ Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù…', 'ÙˆØ§Ø¬Ù‡Ø© Ø¨Ø³ÙŠØ·Ø© Ù„Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹Ø§Øª ÙˆØ§Ù„Ø§Ù†Ø¶Ù…Ø§Ù… Ø¥Ù„ÙŠÙ‡Ø§ Ø¨Ù†Ù‚Ø±Ø© ÙˆØ§Ø­Ø¯Ø©.'],
      ['ØµÙˆØª ÙˆÙÙŠØ¯ÙŠÙˆ HD', 'Ø§Ø³ØªÙ…ØªØ¹ Ø¨Ø¬ÙˆØ¯Ø© ØµÙˆØª ÙˆÙÙŠØ¯ÙŠÙˆ Ù…Ù…ØªØ§Ø²Ø©.'],
      ['Ù…ØªØ§Ø­ ÙÙŠ ÙƒÙ„ Ù…ÙƒØ§Ù†', 'Ø§Ø³ØªØ®Ø¯Ù…Ù‡ Ø¹Ù„Ù‰ ÙƒÙ„ Ø£Ø¬Ù‡Ø²ØªÙƒØŒ ÙÙŠ Ø£ÙŠ Ù…ÙƒØ§Ù† ÙˆÙÙŠ Ø£ÙŠ ÙˆÙ‚Øª.'],
    ],
    footerBenefits: [
      'Ø£Ù…Ø§Ù† Ù…Ù† Ø§Ù„Ø·Ø±Ù Ø¥Ù„Ù‰ Ø§Ù„Ø·Ø±Ù',
      'ØµÙˆØª ÙˆÙÙŠØ¯ÙŠÙˆ HD',
      'Ù…ØªØ§Ø­ Ø¹Ù„Ù‰ ÙƒÙ„ Ø£Ø¬Ù‡Ø²ØªÙƒ',
      'Ø¨Ø¯ÙˆÙ† ØªØ«Ø¨ÙŠØª',
    ],
    title: 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„',
    subtitle: 'Ø³Ø¬Ù‘Ù„ Ø§Ù„Ø¯Ø®ÙˆÙ„ Ø¥Ù„Ù‰ Ø­Ø³Ø§Ø¨Ùƒ ÙÙŠ MBotÃ©Room',
    email: 'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ',
    emailPlaceholder: 'example@mail.com',
    password: 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±',
    passwordPlaceholder: 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ø§Ù„Ø®Ø§ØµØ© Ø¨Ùƒ',
    remember: 'ØªØ°ÙƒØ±Ù†ÙŠ',
    forgot: 'Ù‡Ù„ Ù†Ø³ÙŠØª ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±ØŸ',
    submit: 'ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„',
    submitting: 'Ø¬Ø§Ø±ÙŠ ØªØ³Ø¬ÙŠÙ„ Ø§Ù„Ø¯Ø®ÙˆÙ„...',
    or: 'Ø£Ùˆ',
    google: 'Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø© Ø¨Ø§Ø³ØªØ®Ø¯Ø§Ù… MBotÃ©',
    joinTitle: 'Ø§Ù„Ø§Ù†Ø¶Ù…Ø§Ù… Ø¥Ù„Ù‰ Ø§Ø¬ØªÙ…Ø§Ø¹',
    joinText: 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ Ø­Ø³Ø§Ø¨ØŸ Ø§Ù†Ø¶Ù… Ø¥Ù„Ù‰ Ø§Ø¬ØªÙ…Ø§Ø¹ ÙƒØ¶ÙŠÙ.',
    noAccount: 'Ù„ÙŠØ³ Ù„Ø¯ÙŠÙƒ Ø­Ø³Ø§Ø¨ØŸ',
    createAccount: 'Ø¥Ù†Ø´Ø§Ø¡ Ø­Ø³Ø§Ø¨',
  },
} satisfies Record<Language, {
  languageLabel: string;
  ariaLanguage: string;
  brandTitle: string;
  heroTitle: string;
  heroDescription: string;
  features: [string, string][];
  footerBenefits: string[];
  title: string;
  subtitle: string;
  email: string;
  emailPlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  remember: string;
  forgot: string;
  submit: string;
  submitting: string;
  or: string;
  google: string;
  joinTitle: string;
  joinText: string;
  noAccount: string;
  createAccount: string;
}>;

const languageOptions: Array<{ value: Language; label: string }> = [
  { value: 'fr', label: 'FranÃ§ais' },
  { value: 'en', label: 'English' },
  { value: 'ln', label: 'Lingala' },
  { value: 'ar', label: 'Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©' },
];

const features = [
  {
    title: 'SÃ©curisÃ©',
    description: 'Vos rÃ©unions sont protÃ©gÃ©es avec un chiffrement de bout en bout.',
    icon: ShieldCheck,
    tone: 'blue',
  },
  {
    title: 'Facile Ã  utiliser',
    description: 'Interface intuitive pour crÃ©er et rejoindre vos rÃ©unions en un clic.',
    icon: UsersRound,
    tone: 'green',
  },
  {
    title: 'Audio et vidÃ©o HD',
    description: "Profitez d'une qualitÃ© audio et vidÃ©o exceptionnelle.",
    icon: Monitor,
    tone: 'orange',
  },
  {
    title: 'Accessible partout',
    description: "Utilisable sur tous vos appareils, n'importe oÃ¹, n'importe quand.",
    icon: Laptop,
    tone: 'purple',
  },
] as const;

const footerBenefitIcons = [
  ShieldCheck,
  Video,
  Laptop,
  Zap,
] as const;

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export default function Login({ initialView = 'login' }: LoginProps) {
  const [language, setLanguage] = useState<Language>('fr');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [organization, setOrganization] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingPassword, setMeetingPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copy = translations[language];

  const redirectTo = useMemo(() => {
    const raw = searchParams.get('redirect') || '/app';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app';
  }, [searchParams]);

  if (initialView !== 'forgot' && authService.isAuthenticated()) {
    return <Navigate to={redirectTo} replace />;
  }

  const clearErrors = () => {
    if (formError) setFormError('');
    if (Object.keys(fieldErrors).length) setFieldErrors({});
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const nextErrors: FieldErrors = {};
    if (!email.trim()) nextErrors.email = "L'adresse e-mail est obligatoire.";
    else if (!isValidEmail(email)) nextErrors.email = "L'adresse e-mail est invalide.";
    if (!password) nextErrors.password = 'Le mot de passe est obligatoire.';

    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      await authService.login({ email: email.trim(), password, rememberMe });
      setPassword('');
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Connexion impossible pour le moment.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const nextErrors: FieldErrors = {};
    if (!name.trim()) nextErrors.name = 'Le nom complet est obligatoire.';
    if (!email.trim()) nextErrors.email = "L'adresse e-mail est obligatoire.";
    else if (!isValidEmail(email)) nextErrors.email = "L'adresse e-mail est invalide.";
    if (!password) nextErrors.password = 'Le mot de passe est obligatoire.';
    else if (password.length < 8) nextErrors.password = 'Le mot de passe doit contenir au moins 8 caractÃ¨res.';
    if (phoneNumber.trim() && phoneNumber.trim().length < 6) nextErrors.phoneNumber = 'Le numéro de téléphone est trop court.';

    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      await authService.register({
        name: name.trim(),
        email: email.trim(),
        password,
        phoneNumber: phoneNumber.trim(),
        organization: organization.trim(),
        jobTitle: jobTitle.trim(),
      });
      setPassword('');
      navigate(redirectTo, { replace: true });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'CrÃ©ation de compte impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitGuestJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const nextErrors: FieldErrors = {};
    if (!guestName.trim()) nextErrors.name = 'Votre nom est obligatoire.';
    if (!meetingCode.trim()) nextErrors.meetingCode = "L'ID ou le lien de rÃ©union est obligatoire.";
    if (!meetingPassword.trim()) nextErrors.meetingPassword = 'Le mot de passe de rÃ©union est obligatoire.';

    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      const result = await authService.guestJoin({
        name: guestName.trim(),
        meetingCode: meetingCode.trim(),
        password: meetingPassword,
      });
      setMeetingPassword('');
      const target = result.meeting?.meeting_link ? `/join/${result.meeting.meeting_link}` : '/join';
      navigate(target, { replace: true });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'AccÃ¨s invitÃ© impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const startMboteLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setFormError('');
    try {
      await authService.startMboteAuth(redirectTo);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Authentification MBoté indisponible.");
      setIsLoading(false);
    }
  };

  const submitForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const nextErrors: FieldErrors = {};
    if (!email.trim()) nextErrors.email = "L'adresse e-mail est obligatoire.";
    else if (!isValidEmail(email)) nextErrors.email = "L'adresse e-mail est invalide.";

    setFieldErrors(nextErrors);
    setFormError('');
    setForgotMessage('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      const result = await authService.forgotPassword(email.trim());
      setForgotMessage(result.resetUrl ? `${result.message || 'Lien généré.'} ${result.resetUrl}` : result.message || 'Demande envoyée.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Réinitialisation impossible pour le moment.');
    } finally {
      setIsLoading(false);
    }
  };

  const goToGuestJoin = () => navigate('/rejoindre-une-reunion');

  const handleGuestKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      goToGuestJoin();
    }
  };

  return (
    <main className="login-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <section className="login-shell" aria-label="Connexion MBotÃ©Room">
        <AuthBrandPanel copy={copy} language={language} onLanguageChange={setLanguage} />

        <section className="auth-side">
          {initialView === 'login' && (
            <section className="login-card" aria-labelledby="login-title">
              <header className="login-card-header">
                <h1 id="login-title">{copy.title}</h1>
                <p>{copy.subtitle}</p>
              </header>

              <form className="login-form" onSubmit={submitLogin} noValidate>
                <FormField
                  id="login-email"
                  label={copy.email}
                  icon={<Mail size={21} aria-hidden="true" />}
                  error={fieldErrors.email}
                >
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    placeholder={copy.emailPlaceholder}
                    autoComplete="email"
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      clearErrors();
                    }}
                  />
                </FormField>

                <FormField
                  id="login-password"
                  label={copy.password}
                  icon={<Lock size={21} aria-hidden="true" />}
                  error={fieldErrors.password}
                >
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    placeholder={copy.passwordPlaceholder}
                    autoComplete="current-password"
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      clearErrors();
                    }}
                  />
                  <button
                    className="password-toggle"
                    type="button"
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
                  </button>
                </FormField>

                <div className="form-options">
                  <label className="remember-control">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(event) => setRememberMe(event.target.checked)}
                    />
                    <span aria-hidden="true" />
                    {copy.remember}
                  </label>
                  <button className="auth-text-link" type="button" onClick={() => navigate('/mot-de-passe-oublie')}>
                    {copy.forgot}
                  </button>
                </div>

                {formError && (
                  <p className="auth-error" role="alert">
                    {formError}
                  </p>
                )}

                <button className="primary-login-button" type="submit" disabled={isLoading}>
                  <LogIn size={21} aria-hidden="true" />
                  {isLoading ? copy.submitting : copy.submit}
                </button>

                <div className="auth-separator" aria-hidden="true">
                  <span />
                  <strong>{copy.or}</strong>
                  <span />
                </div>

                <button className="google-login-button mbote-auth-button" type="button" onClick={() => void startMboteLogin()} disabled={isLoading}>
                  <MboteAuthIcon />
                  {copy.google}
                </button>

                <button className="join-meeting-card" type="button" onClick={goToGuestJoin} onKeyDown={handleGuestKeyDown}>
                  <span className="join-meeting-icon"><UsersRound size={29} aria-hidden="true" /></span>
                  <span className="join-meeting-copy">
                    <strong>{copy.joinTitle}</strong>
                    <small>{copy.joinText}</small>
                  </span>
                  <ChevronRight className="join-meeting-arrow" size={26} aria-hidden="true" />
                </button>

                <p className="create-account-copy">
                  {copy.noAccount}
                  <button type="button" onClick={() => navigate('/inscription')}>
                    {copy.createAccount}
                  </button>
                </p>
              </form>
            </section>
          )}

          {initialView === 'register' && (
            <CompactAuthCard
              title="CrÃ©er un compte"
              subtitle="CrÃ©ez votre accÃ¨s MBotÃ©Room pour gÃ©rer vos rÃ©unions."
              error={formError}
              onSubmit={submitRegister}
              isLoading={isLoading}
              submitLabel="CrÃ©er le compte"
              loadingLabel="CrÃ©ation en cours..."
              footer={<AuthFooterAction label="DÃ©jÃ  un compte ?" action="Se connecter" onClick={() => navigate('/connexion')} />}
            >
              <FormField id="register-name" label="Nom complet" icon={<User size={21} aria-hidden="true" />} error={fieldErrors.name}>
                <input id="register-name" value={name} placeholder="Ex : Marie Louka" autoComplete="name" onChange={(event) => { setName(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="register-email" label="Adresse e-mail" icon={<Mail size={21} aria-hidden="true" />} error={fieldErrors.email}>
                <input id="register-email" type="email" value={email} placeholder="exemple@mail.com" autoComplete="email" onChange={(event) => { setEmail(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="register-phone" label="Téléphone" icon={<Phone size={21} aria-hidden="true" />} error={fieldErrors.phoneNumber}>
                <input id="register-phone" type="tel" value={phoneNumber} placeholder="+242 06 000 00 00" autoComplete="tel" onChange={(event) => { setPhoneNumber(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="register-organization" label="Organisation" icon={<Building2 size={21} aria-hidden="true" />} error={fieldErrors.organization}>
                <input id="register-organization" value={organization} placeholder="Entreprise, école ou équipe" autoComplete="organization" onChange={(event) => { setOrganization(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="register-job-title" label="Fonction" icon={<Sparkles size={21} aria-hidden="true" />} error={fieldErrors.jobTitle}>
                <input id="register-job-title" value={jobTitle} placeholder="Ex : Chef de projet" autoComplete="organization-title" onChange={(event) => { setJobTitle(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="register-password" label="Mot de passe" icon={<Lock size={21} aria-hidden="true" />} error={fieldErrors.password}>
                <input id="register-password" type="password" value={password} placeholder="8 caractÃ¨res minimum" autoComplete="new-password" onChange={(event) => { setPassword(event.target.value); clearErrors(); }} />
              </FormField>
            </CompactAuthCard>
          )}

          {initialView === 'guest' && (
            <CompactAuthCard
              title="Rejoindre une rÃ©union"
              subtitle="Entrez les informations fournies par l'hÃ´te."
              error={formError}
              onSubmit={submitGuestJoin}
              isLoading={isLoading}
              submitLabel="Rejoindre la salle d'attente"
              loadingLabel="VÃ©rification..."
              footer={<AuthFooterAction label="Vous avez un compte ?" action="Se connecter" onClick={() => navigate('/connexion')} />}
            >
              <FormField id="guest-name" label="Votre nom visible" icon={<User size={21} aria-hidden="true" />} error={fieldErrors.name}>
                <input id="guest-name" value={guestName} placeholder="Ex : Marie Louka" autoComplete="name" onChange={(event) => { setGuestName(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="guest-code" label="ID ou lien de rÃ©union" icon={<UsersRound size={21} aria-hidden="true" />} error={fieldErrors.meetingCode}>
                <input id="guest-code" value={meetingCode} placeholder="Ex : 9845671234" onChange={(event) => { setMeetingCode(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="guest-password" label="Mot de passe de rÃ©union" icon={<Lock size={21} aria-hidden="true" />} error={fieldErrors.meetingPassword}>
                <input id="guest-password" type="password" value={meetingPassword} placeholder="Code donnÃ© par l'hÃ´te" autoComplete="off" onChange={(event) => { setMeetingPassword(event.target.value); clearErrors(); }} />
              </FormField>
            </CompactAuthCard>
          )}

          {initialView === 'forgot' && (
            <section className="login-card compact-auth-card" aria-labelledby="forgot-title">
              <header className="login-card-header">
                <h1 id="forgot-title">Mot de passe oubliÃ©</h1>
                <p>Entrez votre adresse e-mail pour recevoir un lien de rÃ©initialisation.</p>
              </header>
              <form className="login-form" onSubmit={submitForgotPassword} noValidate>
                <FormField id="forgot-email" label="Adresse e-mail" icon={<Mail size={21} aria-hidden="true" />} error={fieldErrors.email}>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    placeholder="exemple@mail.com"
                    autoComplete="email"
                    onChange={(event) => {
                      setEmail(event.target.value);
                      clearErrors();
                      setForgotMessage('');
                    }}
                  />
                </FormField>
                {formError && <p className="auth-error" role="alert">{formError}</p>}
                {forgotMessage && <p className="auth-success" role="status">{forgotMessage}</p>}
                <button className="primary-login-button" type="submit" disabled={isLoading}>
                  {isLoading ? 'Envoi en cours...' : 'Envoyer le lien'}
                </button>
                <AuthFooterAction label="Vous connaissez votre mot de passe ?" action="Se connecter" onClick={() => navigate('/connexion')} />
              </form>
            </section>
          )}
        </section>
      </section>

      <footer className="login-benefits" aria-label="Avantages MBotÃ©Room">
        {copy.footerBenefits.map((label, index) => {
          const Icon = footerBenefitIcons[index] || ShieldCheck;
          return (
            <div className="login-benefit" key={label}>
              <Icon size={23} aria-hidden="true" />
              <span>{label}</span>
            </div>
          );
        })}
      </footer>
    </main>
  );
}

function AuthBrandPanel({
  copy,
  language,
  onLanguageChange,
}: {
  copy: (typeof translations)[Language];
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const selectedLanguage = languageOptions.find((option) => option.value === language) || languageOptions[0];
  const closeLanguageMenuOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsLanguageMenuOpen(false);
    }
  };

  const selectLanguage = (nextLanguage: Language) => {
    onLanguageChange(nextLanguage);
    setIsLanguageMenuOpen(false);
  };

  return (
    <aside className="brand-panel">
      <span className="brand-dots" aria-hidden="true" />
      <div className="language-selector" onBlur={closeLanguageMenuOnBlur}>
        <button
          type="button"
          aria-label={copy.ariaLanguage}
          aria-haspopup="listbox"
          aria-expanded={isLanguageMenuOpen}
          onClick={() => setIsLanguageMenuOpen((currentValue) => !currentValue)}
        >
          <Globe2 size={16} aria-hidden="true" />
          <span>{selectedLanguage.label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {isLanguageMenuOpen && (
          <div className="language-menu" role="listbox" aria-label={copy.ariaLanguage}>
            {languageOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === language}
                className={option.value === language ? 'is-selected' : ''}
                onClick={() => selectLanguage(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="mbote-logo" aria-label="MBotÃ©Room">
        <span className="mbote-logo-icon">
          <UsersRound size={30} aria-hidden="true" />
          <Video size={18} className="mbote-logo-video" aria-hidden="true" />
        </span>
        <strong><span>MBotÃ©</span><span>Room</span></strong>
      </div>

      <div className="brand-panel-copy">
        <h2>{copy.heroTitle.split('\n').map((line) => <span key={line}>{line}</span>)}</h2>
        <p>{copy.heroDescription.split('\n').map((line) => <span key={line}>{line}</span>)}</p>
      </div>

      <div className="feature-list">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          const translatedFeature = copy.features[index] || [feature.title, feature.description];
          return (
            <article className="feature-item" key={feature.title}>
              <span className={`feature-icon feature-icon-${feature.tone}`}>
                <Icon size={27} aria-hidden="true" />
              </span>
              <span>
                <strong>{translatedFeature[0]}</strong>
                <small>{translatedFeature[1]}</small>
              </span>
            </article>
          );
        })}
      </div>

      <MeetingIllustration />
    </aside>
  );
}

function MeetingIllustration() {
  return (
    <div className="meeting-illustration" aria-hidden="true">
      <div className="illustration-plant">
        <span className="plant-leaf leaf-one" />
        <span className="plant-leaf leaf-two" />
        <span className="plant-leaf leaf-three" />
        <span className="plant-leaf leaf-four" />
        <span className="plant-stem" />
        <span className="plant-pot" />
      </div>
      <div className="illustration-laptop">
        <div className="laptop-screen">
          <span className="participant participant-one"><User size={36} /></span>
          <span className="participant participant-two"><User size={36} /></span>
          <span className="participant participant-three"><User size={36} /></span>
          <span className="participant participant-four"><User size={36} /></span>
        </div>
        <span className="laptop-base" />
      </div>
      <div className="illustration-phone">
        <span className="phone-speaker" />
        <span className="phone-logo"><UsersRound size={17} /></span>
        <strong>MBotÃ©Room</strong>
      </div>
    </div>
  );
}

function FormField({
  id,
  label,
  icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className={error ? 'input-shell has-error' : 'input-shell'}>
        <span className="input-icon">{icon}</span>
        {children}
      </div>
      {error && <p id={`${id}-error`} className="field-error" role="alert">{error}</p>}
    </div>
  );
}

function CompactAuthCard({
  title,
  subtitle,
  error,
  isLoading,
  submitLabel,
  loadingLabel,
  footer,
  onSubmit,
  children,
}: {
  title: string;
  subtitle: string;
  error: string;
  isLoading: boolean;
  submitLabel: string;
  loadingLabel: string;
  footer: React.ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="login-card compact-auth-card" aria-labelledby="compact-auth-title">
      <header className="login-card-header">
        <h1 id="compact-auth-title">{title}</h1>
        <p>{subtitle}</p>
      </header>
      <form className="login-form" onSubmit={onSubmit} noValidate>
        {children}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-login-button" type="submit" disabled={isLoading}>
          {isLoading ? loadingLabel : submitLabel}
        </button>
        {footer}
      </form>
    </section>
  );
}

function AuthFooterAction({ label, action, onClick }: { label: string; action: string; onClick: () => void }) {
  return (
    <p className="create-account-copy">
      {label}
      <button type="button" onClick={onClick}>{action}</button>
    </p>
  );
}

function MboteAuthIcon() {
  return (
    <span className="mbote-auth-icon" aria-hidden="true">
      <UsersRound size={18} />
      <Video size={10} />
    </span>
  );
}
