import { FocusEvent, FormEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  Building2,
  CalendarDays,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Laptop,
  Lock,
  KeyRound,
  CheckCircle2,
  LoaderCircle,
  LogIn,
  Mail,
  MapPin,
  Monitor,
  Phone,
  Sparkles,
  ShieldCheck,
  Share2,
  Smartphone,
  User,
  UsersRound,
  Video,
  Zap,
} from 'lucide-react';
import { authService } from '../services/authService';
import { sanitizeInternalPath } from '../lib/navigationSecurity';
import { apiFetch, apiUrl } from '../lib/api';
import { getStoredLanguage, persistAppLanguage, type AppLanguage } from '../lib/appLanguage';
import { companyCategories, getRegistrationCountry, registrationCountries } from '../lib/registrationCatalog';
import TermsConsent from '../components/TermsConsent';
import './Login.css';

type AuthView = 'login' | 'register' | 'guest' | 'forgot';
type Language = AppLanguage;

type LoginProps = {
  initialView?: AuthView;
};

type LoginBranding = {
  wordmarkUrl: string;
  illustrationUrl: string;
  updatedAt?: string;
};

const defaultLoginBranding: LoginBranding = {
  wordmarkUrl: '/icons/mboteroom-wordmark.png',
  illustrationUrl: '/images/meeting-black-team.svg',
};

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'confirmPassword' | 'phoneNumber' | 'organization' | 'jobTitle' | 'country' | 'city' | 'birthDate' | 'birthPlace' | 'address' | 'meetingCode' | 'meetingPassword', string>>;

const passwordStrengthError = (password: string) => {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Ajoutez une majuscule, une minuscule, un chiffre et un caractère spécial.';
  }
  if (/\s/.test(password)) return 'Le mot de passe ne doit pas contenir d’espace.';
  return '';
};

const translations = {
  fr: {
    languageLabel: 'Français',
    ariaLanguage: 'Sélectionner la langue',
    brandTitle: 'Réunions sécurisées',
    heroTitle: 'Réunions sécurisées\npour tous',
    heroDescription: 'Organisez, rejoignez et collaborez\nen toute simplicité avec MBotéRoom.',
    features: [
      ['Sécurisé', 'Vos réunions sont protégées par des contrôles d’accès.'],
      ['Facile à utiliser', 'Interface intuitive pour créer et rejoindre vos réunions en un clic.'],
      ['Audio et vidéo de qualité', "Profitez d'une qualité audio et vidéo exceptionnelle."],
      ['Accessible partout', "Utilisable sur tous vos appareils, n'importe où, n'importe quand."],
    ],
    footerBenefits: [
      'Accès protégés',
      'Audio et vidéo de qualité',
      'Accessible sur tous vos appareils',
      'Aucune installation requise',
    ],
    title: 'Connexion',
    subtitle: 'Connectez-vous à votre compte MBotéRoom',
    email: 'Adresse e-mail',
    emailPlaceholder: 'exemple@mail.com',
    password: 'Mot de passe',
    passwordPlaceholder: 'Votre mot de passe',
    remember: 'Se souvenir de moi',
    forgot: 'Mot de passe oublié ?',
    submit: 'Se connecter',
    submitting: 'Connexion en cours...',
    or: 'ou',
    google: 'MBoté Connect',
    mboteLoading: 'Redirection vers MBoté Connect...',
    joinTitle: 'Rejoindre une réunion',
    joinText: "Vous n'avez pas de compte ? Rejoignez une réunion en tant qu'invité.",
    noAccount: 'Pas encore de compte ?',
    createAccount: 'Créer un compte',
    apkTitle: 'MBotéRoom pour Android',
    apkText: 'Téléchargez toujours la dernière version APK compilée.',
    apkDownload: 'Télécharger l’APK',
    apkShare: 'Envoyer à un ami',
    apkShareText: 'Télécharge MBotéRoom pour Android avec ce lien :',
    apkCopied: 'Lien de téléchargement copié.',
    apkShareFailed: 'Impossible de partager le lien pour le moment.',
  },
  en: {
    languageLabel: 'English',
    ariaLanguage: 'Select language',
    brandTitle: 'Secure meetings',
    heroTitle: 'Secure meetings\nfor everyone',
    heroDescription: 'Host, join, and collaborate\nwith MBotéRoom in total simplicity.',
    features: [
      ['Secure', 'Your meetings are protected by access controls.'],
      ['Easy to use', 'An intuitive interface to create and join meetings in one click.'],
      ['Quality audio and video', 'Enjoy outstanding audio and video quality.'],
      ['Available everywhere', 'Use it on all your devices, anywhere, anytime.'],
    ],
    footerBenefits: [
      'Protected access',
      'Quality audio and video',
      'Available on all your devices',
      'No installation required',
    ],
    title: 'Sign in',
    subtitle: 'Sign in to your MBotéRoom account',
    email: 'Email address',
    emailPlaceholder: 'example@mail.com',
    password: 'Password',
    passwordPlaceholder: 'Your password',
    remember: 'Remember me',
    forgot: 'Forgot password?',
    submit: 'Sign in',
    submitting: 'Signing in...',
    or: 'or',
    google: 'MBoté Connect',
    mboteLoading: 'Redirecting to MBoté Connect...',
    joinTitle: 'Join a meeting',
    joinText: "No account? Join a meeting as a guest.",
    noAccount: "Don't have an account?",
    createAccount: 'Create account',
    apkTitle: 'MBotéRoom for Android',
    apkText: 'Always download the latest compiled APK.',
    apkDownload: 'Download APK',
    apkShare: 'Send to a friend',
    apkShareText: 'Download MBotéRoom for Android using this link:',
    apkCopied: 'Download link copied.',
    apkShareFailed: 'Unable to share the link right now.',
  },
  ln: {
    languageLabel: 'Lingala',
    ariaLanguage: 'Pona monoko',
    brandTitle: 'Masolo ya libateli',
    heroTitle: 'Masolo ya libateli\nmpo na bato nyonso',
    heroDescription: 'Bongisa, kota mpe sala elongo\nna MBotéRoom na pete.',
    features: [
      ['Ebatelami', 'Masolo na yo ebatelami mpo na bato oyo babengami.'],
      ['Pete kosalela', 'Interface ya pete mpo na kosala mpe kokota na réunion na clic moko.'],
      ['Audio mpe video ya malamu', 'Sepela na qualité ya malamu mpo na mongongo mpe video.'],
      ['Ezali bisika nyonso', 'Salela yango na ba appareils nyonso, bisika nyonso, ntango nyonso.'],
    ],
    footerBenefits: [
      'Masolo ebatelami',
      'Audio mpe video ya malamu',
      'Ezali na ba appareils nyonso',
      'Installation esengeli te',
    ],
    title: 'Kokota',
    subtitle: 'Kota na compte na yo ya MBotéRoom',
    email: 'Adresse e-mail',
    emailPlaceholder: 'exemple@mail.com',
    password: 'Mot de passe',
    passwordPlaceholder: 'Mot de passe na yo',
    remember: 'Kobomba ngai',
    forgot: 'Obosani mot de passe ?',
    submit: 'Kokota',
    submitting: 'Kokota ezali kosalema...',
    or: 'to',
    google: 'MBoté Connect',
    mboteLoading: 'Kokende na MBoté Connect...',
    joinTitle: 'Kokota na réunion',
    joinText: "Ozangi compte ? Kota na réunion lokola invité.",
    noAccount: 'Ozali nanu na compte te ?',
    createAccount: 'Kosala compte',
    apkTitle: 'MBotéRoom mpo na Android',
    apkText: 'Télécharger ntango nyonso APK ya sika oyo esili kosalama.',
    apkDownload: 'Télécharger APK',
    apkShare: 'Tindela moninga',
    apkShareText: 'Télécharger MBotéRoom mpo na Android na lien oyo:',
    apkCopied: 'Lien ya téléchargement ekopiami.',
    apkShareFailed: 'Kokabola lien ekoki te sikoyo.',
  },
  ar: {
    languageLabel: 'العربية',
    ariaLanguage: 'اختر اللغة',
    brandTitle: 'اجتماعات آمنة',
    heroTitle: 'اجتماعات آمنة\nللجميع',
    heroDescription: 'نظّم الاجتماعات وانضم إليها وتعاون\nبسهولة مع MBotéRoom.',
    features: [
      ['آمن', 'اجتماعاتك محمية بضوابط الوصول.'],
      ['سهل الاستخدام', 'واجهة بسيطة لإنشاء الاجتماعات والانضمام إليها بنقرة واحدة.'],
      ['صوت وفيديو بجودة عالية', 'استمتع بجودة صوت وفيديو ممتازة.'],
      ['متاح في كل مكان', 'استخدمه على جميع أجهزتك في أي وقت ومن أي مكان.'],
    ],
    footerBenefits: [
      'وصول محمي',
      'صوت وفيديو بجودة عالية',
      'متاح على جميع أجهزتك',
      'لا يحتاج إلى تثبيت',
    ],
    title: 'تسجيل الدخول',
    subtitle: 'سجّل الدخول إلى حساب MBotéRoom',
    email: 'البريد الإلكتروني',
    emailPlaceholder: 'example@mail.com',
    password: 'كلمة المرور',
    passwordPlaceholder: 'كلمة المرور الخاصة بك',
    remember: 'تذكرني',
    forgot: 'هل نسيت كلمة المرور؟',
    submit: 'تسجيل الدخول',
    submitting: 'جارٍ تسجيل الدخول...',
    or: 'أو',
    google: 'MBoté Connect',
    mboteLoading: 'جارٍ الانتقال إلى MBoté Connect...',
    joinTitle: 'الانضمام إلى اجتماع',
    joinText: 'ليس لديك حساب؟ انضم إلى الاجتماع كضيف.',
    noAccount: 'ليس لديك حساب بعد؟',
    createAccount: 'إنشاء حساب',
    apkTitle: 'MBotéRoom لنظام Android',
    apkText: 'نزّل دائمًا أحدث ملف APK تم تجميعه.',
    apkDownload: 'تنزيل APK',
    apkShare: 'إرساله إلى صديق',
    apkShareText: 'نزّل MBotéRoom لنظام Android من هذا الرابط:',
    apkCopied: 'تم نسخ رابط التنزيل.',
    apkShareFailed: 'تعذّر مشاركة الرابط الآن.',
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
  mboteLoading: string;
  joinTitle: string;
  joinText: string;
  noAccount: string;
  createAccount: string;
  apkTitle: string;
  apkText: string;
  apkDownload: string;
  apkShare: string;
  apkShareText: string;
  apkCopied: string;
  apkShareFailed: string;
}>;

const languageOptions: Array<{ value: Language; label: string }> = [
  { value: 'fr', label: 'Français' },
  { value: 'en', label: 'English' },
  { value: 'ln', label: 'Lingala' },
  { value: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629' },
];

const features = [
  {
    title: 'Sécurisé',
    description: 'Vos réunions sont protégées par des contrôles d’accès.',
    icon: ShieldCheck,
    tone: 'blue',
  },
  {
    title: 'Facile à utiliser',
    description: 'Interface intuitive pour créer et rejoindre vos réunions en un clic.',
    icon: UsersRound,
    tone: 'green',
  },
  {
    title: 'Audio et vidéo de qualité',
    description: "Profitez d'une qualité audio et vidéo exceptionnelle.",
    icon: Monitor,
    tone: 'orange',
  },
  {
    title: 'Accessible partout',
    description: "Utilisable sur tous vos appareils, n'importe où, n'importe quand.",
    icon: Laptop,
    tone: 'purple',
  },
] as const;

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const ANDROID_APK_URL = 'https://mboteroom.loukatech.com/download/android';

export default function Login({ initialView = 'login' }: LoginProps) {
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());
  const [loginBranding, setLoginBranding] = useState<LoginBranding>(defaultLoginBranding);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(() => localStorage.getItem('mboteroom-remember-me') === 'true' ? (localStorage.getItem('mboteroom-remember-email') || '') : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationCategory, setOrganizationCategory] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [address, setAddress] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsVersion, setTermsVersion] = useState('');
  const [isRegisterModalOpen, setRegisterModalOpen] = useState(false);
  const [forgotMessage, setForgotMessage] = useState('');
  const [resetComplete, setResetComplete] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('mboteroom-remember-me') === 'true');
  const [guestName, setGuestName] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingPassword, setMeetingPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAndroidCredentials, setShowAndroidCredentials] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMboteLoading, setIsMboteLoading] = useState(false);
  const [apkShareMessage, setApkShareMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [externalAuthModalMessage, setExternalAuthModalMessage] = useState('');
  const [otpChallengeId, setOtpChallengeId] = useState('');
  const [otpEmailHint, setOtpEmailHint] = useState('');
  const [otpRedirectTo, setOtpRedirectTo] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [isOtpResending, setIsOtpResending] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState<{ email: string; welcomeEmailSent: boolean } | null>(null);
  const [mboteStep, setMboteStep] = useState<'credentials' | 'consent' | null>(null);
  const [mboteIdentifier, setMboteIdentifier] = useState('');
  const [mbotePassword, setMbotePassword] = useState('');
  const [mboteChallengeId, setMboteChallengeId] = useState('');
  const [mboteProfile, setMboteProfile] = useState<{ name: string; email: string; avatar?: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const copy = translations[language];
  const selectedRegistrationCountry = useMemo(() => getRegistrationCountry(country), [country]);
  const phoneDialCode = selectedRegistrationCountry?.dialCode || '';
  const phoneDisplayValue = phoneDialCode
    ? `${phoneDialCode}${phoneNumber ? ` ${phoneNumber}` : ''}`
    : phoneNumber;
  const [resetToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return (hash.get('reset') || searchParams.get('token') || '').trim();
  });

  useEffect(() => {
    let cancelled = false;
    const loadLoginBranding = async () => {
      try {
        const response = await apiFetch(apiUrl('/api/public/login-branding'), { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload || typeof payload !== 'object') return;
        const next: LoginBranding = {
          wordmarkUrl: typeof payload.wordmarkUrl === 'string' && payload.wordmarkUrl ? payload.wordmarkUrl : defaultLoginBranding.wordmarkUrl,
          illustrationUrl: typeof payload.illustrationUrl === 'string' && payload.illustrationUrl ? payload.illustrationUrl : defaultLoginBranding.illustrationUrl,
          updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
        };
        if (!cancelled) setLoginBranding(next);
      } catch {
        // Keep bundled defaults when the backend is unavailable.
      }
    };
    void loadLoginBranding();
    const onFocus = () => void loadLoginBranding();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    persistAppLanguage(language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('mboteroom-remember-me', String(rememberMe));
    if (rememberMe && email.trim()) localStorage.setItem('mboteroom-remember-email', email.trim());
    if (!rememberMe) localStorage.removeItem('mboteroom-remember-email');
  }, [email, rememberMe]);

  useEffect(() => {
    if (!resetToken) return;
    const current = new URL(window.location.href);
    current.searchParams.delete('token');
    window.history.replaceState(null, '', current.pathname + (current.search ? current.search : ''));
  }, [resetToken]);

  useEffect(() => {
    try {
      const callback = authService.consumeMboteAuthCallback();
      if (callback?.type === 'session') {
        navigate(callback.redirectTo, { replace: true });
        return;
      }
      if (callback?.type === 'otp') {
        setOtpChallengeId(callback.challengeId);
        setOtpEmailHint(callback.emailHint);
        setOtpSecondsLeft(callback.expiresInSeconds || 600);
        setOtpRedirectTo(callback.redirectTo);
      }
    } catch (error) {
      setExternalAuthModalMessage(error instanceof Error ? error.message : "La connexion avec MBoté n'a pas abouti.");
    }
  }, [navigate]);

  useEffect(() => {
    if (searchParams.get('externalAuth') !== 'failed') return;
    setExternalAuthModalMessage(searchParams.get('reason') || "La connexion avec MBoté n'a pas abouti.");
  }, [searchParams]);

  const redirectTo = useMemo(() => {
    const legacy = searchParams.get('redirect') || '';
    const stored = sessionStorage.getItem('mboteroom-login-redirect') || '';
    const target = sanitizeInternalPath(stored || legacy || '/app');
    if (legacy) {
      sessionStorage.setItem('mboteroom-login-redirect', target);
      const clean = new URL(window.location.href);
      clean.searchParams.delete('redirect');
      window.history.replaceState(null, '', clean.pathname + (clean.search ? clean.search : ''));
    }
    return target;
  }, [searchParams]);

  useEffect(() => {
    if (!otpChallengeId || otpSecondsLeft <= 0) return undefined;
    const timer = window.setInterval(() => setOtpSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [otpChallengeId, otpSecondsLeft]);

  if (initialView !== 'forgot' && authService.isAuthenticated() && !registrationSuccess) {
    return <Navigate to={redirectTo} replace />;
  }

  const clearErrors = () => {
    if (formError) setFormError('');
    if (Object.keys(fieldErrors).length) setFieldErrors({});
  };

  const updateRegistrationPhone = (value: string) => {
    const localValue = phoneDialCode && value.startsWith(phoneDialCode)
      ? value.slice(phoneDialCode.length).trimStart()
      : value.replace(/^\+\d{1,4}\s*/, '');
    setPhoneNumber(localValue.replace(/[^0-9\s()-]/g, '').slice(0, 30));
    clearErrors();
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
      const result = await authService.login({ email: email.trim(), password, rememberMe });
      setPassword('');
      setOtpChallengeId(result.challengeId);
      setOtpEmailHint(result.emailHint);
      setOtpSecondsLeft(result.expiresInSeconds || 600);
      setOtpRedirectTo(redirectTo);
      setOtpCode('');
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Connexion impossible pour le moment.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitLoginOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || !otpChallengeId) return;
    const code = otpCode.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) {
      setFormError('Saisissez le code à 6 chiffres reçu par e-mail.');
      return;
    }
    setIsLoading(true);
    setFormError('');
    try {
      await authService.verifyLoginOtp(otpChallengeId, code, rememberMe);
      setOtpChallengeId('');
      setOtpCode('');
      const target = sanitizeInternalPath(otpRedirectTo || redirectTo);
      sessionStorage.removeItem('mboteroom-login-redirect');
      navigate(target, { replace: true });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Validation du code impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const resendLoginOtp = async () => {
    if (!otpChallengeId || isOtpResending) return;
    setIsOtpResending(true);
    setFormError('');
    try {
      const result = await authService.resendLoginOtp(otpChallengeId);
      setOtpSecondsLeft(result.expiresInSeconds || 600);
      setOtpCode('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Impossible de renvoyer le code.');
    } finally {
      setIsOtpResending(false);
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
    else {
      const passwordError = passwordStrengthError(password);
      if (passwordError) nextErrors.password = passwordError;
    }
    if (!country) nextErrors.country = 'Sélectionnez votre pays.';
    if (!city) nextErrors.city = 'Sélectionnez votre ville.';
    if (phoneNumber.trim() && phoneNumber.replace(/\D/g, '').length < 6) nextErrors.phoneNumber = 'Le numéro de téléphone est trop court.';
    if (!termsAccepted || !termsVersion) {
      setFormError("Vous devez lire et accepter les conditions d’utilisation avant de créer votre compte.");
      return;
    }

    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      const result = await authService.register({
        name: name.trim(),
        email: email.trim(),
        password,
        phoneNumber: phoneNumber.trim() && phoneDialCode ? `${phoneDialCode} ${phoneNumber.trim()}` : '',
        organization: organization.trim(),
        organizationCategory,
        jobTitle: jobTitle.trim(),
        country: country.trim(),
        city: city.trim(),
        birthDate,
        birthPlace: birthPlace.trim(),
        address: address.trim(),
        termsAccepted,
        termsVersion,
      });
      setPassword('');
      setRegisterModalOpen(false);
      setRegistrationSuccess({ email: email.trim(), welcomeEmailSent: result.welcomeEmailSent });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Création de compte impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitGuestJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading) return;

    const nextErrors: FieldErrors = {};
    if (!guestName.trim()) nextErrors.name = 'Votre nom est obligatoire.';
    if (!meetingCode.trim()) nextErrors.meetingCode = "L'ID ou le lien de réunion est obligatoire.";
    if (!meetingPassword.trim()) nextErrors.meetingPassword = 'Le mot de passe de réunion est obligatoire.';
    if (!termsAccepted || !termsVersion) {
      setFormError("Vous devez lire et accepter les conditions d’utilisation avant de rejoindre en invité.");
      return;
    }

    setFieldErrors(nextErrors);
    setFormError('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      const result = await authService.guestJoin({
        name: guestName.trim(),
        meetingCode: meetingCode.trim(),
        password: meetingPassword,
        termsAccepted,
        termsVersion,
      });
      setMeetingPassword('');
      const target = result.meeting?.meeting_link ? `/join/${result.meeting.meeting_link}` : '/join';
      navigate(target, { replace: true });
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : 'Accès invité impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  const startMboteLogin = () => {
    if (isLoading || isMboteLoading) return;
    setFormError('');
    setMboteStep('credentials');
  };

  const submitMboteCredentials = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!mboteIdentifier.trim() || !mbotePassword || isMboteLoading) {
      setFormError('Votre identifiant et votre mot de passe MBoté sont obligatoires.');
      return;
    }
    setIsMboteLoading(true);
    setFormError('');
    try {
      const result = await authService.verifyMboteCredentials(mboteIdentifier.trim(), mbotePassword);
      setMboteChallengeId(result.challengeId);
      setMboteProfile(result.profile);
      setMbotePassword('');
      setMboteStep('consent');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Identifiants MBoté incorrects.');
    } finally {
      setIsMboteLoading(false);
    }
  };

  const authorizeMbote = async () => {
    if (!mboteChallengeId || isMboteLoading) return;
    setIsMboteLoading(true);
    setFormError('');
    try {
      const result = await authService.authorizeMbote(mboteChallengeId, redirectTo);
      setMboteStep(null);
      setOtpChallengeId(result.challengeId);
      setOtpEmailHint(result.emailHint);
      setOtpSecondsLeft(result.expiresInSeconds || 600);
      setOtpRedirectTo(result.redirectTo);
      setOtpCode('');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Autorisation MBoté impossible.');
      setMboteStep('credentials');
    } finally {
      setIsMboteLoading(false);
    }
  };

  const closeMboteAuth = () => {
    setMboteStep(null);
    setMbotePassword('');
    setMboteChallengeId('');
    setMboteProfile(null);
    setFormError('');
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

  const submitResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || resetComplete) return;

    const nextErrors: FieldErrors = {};
    if (!password) nextErrors.password = 'Le nouveau mot de passe est obligatoire.';
    else {
      const passwordError = passwordStrengthError(password);
      if (passwordError) nextErrors.password = passwordError;
    }
    if (!confirmPassword) nextErrors.confirmPassword = 'Confirmez le nouveau mot de passe.';
    else if (confirmPassword !== password) nextErrors.confirmPassword = 'Les mots de passe ne correspondent pas.';

    setFieldErrors(nextErrors);
    setFormError('');
    setForgotMessage('');
    if (Object.keys(nextErrors).length) return;

    setIsLoading(true);
    try {
      const result = await authService.resetPassword(resetToken, password);
      setPassword('');
      setConfirmPassword('');
      setResetComplete(true);
      setForgotMessage(result.message || 'Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter.');
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

  const shareAndroidApk = async () => {
    setApkShareMessage('');
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'MBotéRoom Android',
          text: copy.apkShareText,
          url: ANDROID_APK_URL,
        });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(ANDROID_APK_URL);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = ANDROID_APK_URL;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setApkShareMessage(copy.apkCopied);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setApkShareMessage(copy.apkShareFailed);
    }
  };

  const renderRegistrationFields = () => (
    <>
      <FormField id="register-name" label="Nom complet" icon={<User size={21} aria-hidden="true" />} error={fieldErrors.name}>
        <input id="register-name" value={name} placeholder="Ex : Marie Louka" autoComplete="name" onChange={(event) => { setName(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-email" label="Adresse e-mail" icon={<Mail size={21} aria-hidden="true" />} error={fieldErrors.email}>
        <input id="register-email" type="email" value={email} placeholder="exemple@mail.com" autoComplete="email" onChange={(event) => { setEmail(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-country" label="Pays" icon={<Globe2 size={21} aria-hidden="true" />} error={fieldErrors.country}>
        <select
          id="register-country"
          value={country}
          autoComplete="country-name"
          onChange={(event) => {
            setCountry(event.target.value);
            setCity('');
            clearErrors();
          }}
        >
          <option value="">Sélectionner un pays</option>
          {registrationCountries.map((item) => <option key={item.code} value={item.name}>{item.name} ({item.dialCode})</option>)}
        </select>
      </FormField>
      <FormField id="register-city" label="Ville" icon={<MapPin size={21} aria-hidden="true" />} error={fieldErrors.city}>
        <select
          id="register-city"
          value={city}
          autoComplete="address-level2"
          disabled={!selectedRegistrationCountry}
          onChange={(event) => { setCity(event.target.value); clearErrors(); }}
        >
          <option value="">{selectedRegistrationCountry ? 'Sélectionner une ville' : 'Choisissez d’abord un pays'}</option>
          {selectedRegistrationCountry?.cities.map((item) => <option key={item} value={item}>{item}</option>)}
          {selectedRegistrationCountry ? <option value="Autre ville">Autre ville</option> : null}
        </select>
      </FormField>
      <FormField id="register-phone" label="Téléphone" icon={<Phone size={21} aria-hidden="true" />} error={fieldErrors.phoneNumber}>
        <input
          id="register-phone"
          type="tel"
          value={phoneDisplayValue}
          placeholder={phoneDialCode ? `${phoneDialCode} 06 000 00 00` : 'Sélectionnez d’abord un pays'}
          autoComplete="tel"
          disabled={!phoneDialCode}
          onChange={(event) => updateRegistrationPhone(event.target.value)}
        />
      </FormField>
      <FormField id="register-birth-date" label="Date de naissance" icon={<CalendarDays size={21} aria-hidden="true" />} error={fieldErrors.birthDate}>
        <input id="register-birth-date" type="date" value={birthDate} max={new Date().toISOString().slice(0, 10)} autoComplete="bday" onChange={(event) => { setBirthDate(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-birth-place" label="Lieu de naissance" icon={<MapPin size={21} aria-hidden="true" />} error={fieldErrors.birthPlace}>
        <input id="register-birth-place" value={birthPlace} placeholder="Ex : Pointe-Noire" onChange={(event) => { setBirthPlace(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-address" label="Adresse" icon={<MapPin size={21} aria-hidden="true" />} error={fieldErrors.address}>
        <input id="register-address" value={address} placeholder="Quartier, rue ou avenue" autoComplete="street-address" onChange={(event) => { setAddress(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-organization" label="Organisation" icon={<Building2 size={21} aria-hidden="true" />} error={fieldErrors.organization}>
        <input id="register-organization" value={organization} placeholder="Entreprise, école ou équipe" autoComplete="organization" onChange={(event) => { setOrganization(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-organization-category" label="Catégorie d’entreprise (optionnel)" icon={<Building2 size={21} aria-hidden="true" />}>
        <select id="register-organization-category" value={organizationCategory} onChange={(event) => { setOrganizationCategory(event.target.value); clearErrors(); }}>
          <option value="">Aucune catégorie sélectionnée</option>
          {companyCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </FormField>
      <FormField id="register-job-title" label="Fonction" icon={<Sparkles size={21} aria-hidden="true" />} error={fieldErrors.jobTitle}>
        <input id="register-job-title" value={jobTitle} placeholder="Ex : Chef de projet" autoComplete="organization-title" onChange={(event) => { setJobTitle(event.target.value); clearErrors(); }} />
      </FormField>
      <FormField id="register-password" label="Mot de passe" icon={<Lock size={21} aria-hidden="true" />} error={fieldErrors.password}>
        <input id="register-password" type="password" value={password} placeholder="10 caractères minimum" autoComplete="new-password" onChange={(event) => { setPassword(event.target.value); clearErrors(); }} />
      </FormField>
    </>
  );

  return (
    <main className="login-page" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <section className="login-shell" aria-label="Connexion MBotéRoom">
        <AuthBrandPanel copy={copy} language={language} branding={loginBranding} onLanguageChange={setLanguage} />

        <section className="auth-side">
          {initialView === 'login' && (
            <section className="android-welcome" aria-label="Bienvenue sur MBotéRoom">
              <div className="android-welcome-top">
                <img src={loginBranding.wordmarkUrl} alt="MBotéRoom" />
                <select aria-label={copy.ariaLanguage} value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                  {languageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <p className="android-welcome-tagline">Réunissez-vous sans limites</p>
              <div className="android-welcome-visual">
                <img src={loginBranding.illustrationUrl} alt="Réunion vidéo MBotéRoom" />
              </div>
              <div className="android-welcome-benefits">
                <span><ShieldCheck size={21}/><b>Accès sécurisé</b><small>Vos réunions en toute sécurité</small></span>
                <span><Smartphone size={21}/><b>Tous appareils</b><small>Android, iOS, Web</small></span>
                <span><UsersRound size={21}/><b>Haute qualité</b><small>Audio et vidéo en HD</small></span>
              </div>
              <div className="android-welcome-actions">
                <button className="android-welcome-connect" type="button" onClick={() => setShowAndroidCredentials(true)}><User size={25}/><span><b>Connexion</b><small>Se connecter à mon compte</small></span><ChevronRight/></button>
                <button type="button" onClick={() => { clearErrors(); setRegisterModalOpen(true); }}><span className="android-action-icon">+</span><span><b>Créer un compte</b><small>Rejoignez MBotéRoom gratuitement</small></span><ChevronRight/></button>
                <button className="android-guest-action" type="button" onClick={goToGuestJoin}><span className="android-action-icon"><User size={20}/></span><span><b>Continuer en tant qu’invité</b><small>Rejoindre sans créer de compte</small></span><ChevronRight/></button>
                <a className="android-apk-action" href={ANDROID_APK_URL}><span className="android-action-icon"><Smartphone size={20}/></span><span><b>MBotéRoom pour Android</b><small>Télécharger l’APK</small></span><Download/></a>
              </div>
              <div className="android-welcome-shortcuts">
                <button type="button"><Sparkles/><b>Premium</b><small>Fonctionnalités avancées</small></button>
                <button type="button" onClick={() => navigate('/app/calendrier')}><CalendarDays/><b>Planifier</b><small>Programmer une réunion</small></button>
                <button type="button" onClick={() => navigate('/rejoindre')}><Video/><b>Voir une démo</b><small>Découvrir MBotéRoom</small></button>
                <button type="button" onClick={() => navigate('/aide')}><ShieldCheck/><b>Aide</b><small>Centre d’assistance</small></button>
              </div>
              <p className="android-welcome-footer">MBotéRoom application créée par LoukaTech</p>
            </section>
          )}
          {showAndroidCredentials && (
            <div className="android-login-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAndroidCredentials(false); }}><section className="login-card android-login-form-card android-login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title"><button className="android-login-modal-close" type="button" aria-label="Fermer" onClick={() => setShowAndroidCredentials(false)}>×</button>
              <header className="login-card-header">
                <span className="auth-card-kicker">Espace sécurisé MBotéRoom</span>
                <h1 id="login-title">{copy.title}</h1>
                <p>{copy.subtitle}</p>
                <div className="auth-security-badges" aria-label="Sécurité de connexion">
                  <span><ShieldCheck size={15}/> Code de sécurité par e-mail</span>
                  <span><Video size={15}/> Réunions de qualité</span>
                  <span><Sparkles size={15}/> Luna IA</span>
                </div>
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
                      onChange={(event) => {
                        const nextValue = event.target.checked;
                        setRememberMe(nextValue);
                        localStorage.setItem('mboteroom-remember-me', String(nextValue));
                        if (!nextValue) localStorage.removeItem('mboteroom-remember-email');
                      }}
                    />
                    <span aria-hidden="true" />
                    {copy.remember}
                  </label>
                  <button className="auth-text-link" type="button" onClick={() => { setShowAndroidCredentials(false); navigate('/mot-de-passe-oublie'); }}>
                    {copy.forgot}
                  </button>
                </div>

                {formError && (
                  <p className="auth-error" role="alert">
                    {formError}
                  </p>
                )}

                <button className="primary-login-button" type="submit" disabled={isLoading || isMboteLoading}>
                  <LogIn size={21} aria-hidden="true" />
                  {isLoading ? copy.submitting : copy.submit}
                </button>

                <div className="auth-separator" aria-hidden="true">
                  <span />
                  <strong>{copy.or}</strong>
                  <span />
                </div>

                <div className="external-login-row" aria-label="Méthodes de connexion externes">
                  <button
                    className="google-login-button mbote-auth-button"
                    type="button"
                    onClick={() => void startMboteLogin()}
                    disabled={isLoading || isMboteLoading}
                    aria-busy={isMboteLoading}
                  >
                    {isMboteLoading ? <LoaderCircle className="mbote-auth-spinner" size={22} aria-hidden="true" /> : <MboteAuthIcon />}
                    <span aria-live="polite">{isMboteLoading ? copy.mboteLoading : copy.google}</span>
                    <ChevronRight className="external-login-arrow" size={20} aria-hidden="true" />
                  </button>

                </div>

                <button className="join-meeting-card" type="button" onClick={goToGuestJoin} onKeyDown={handleGuestKeyDown}>
                  <span className="join-meeting-icon"><UsersRound size={29} aria-hidden="true" /></span>
                  <span className="join-meeting-copy">
                    <strong>{copy.joinTitle}</strong>
                    <small>{copy.joinText}</small>
                  </span>
                  <ChevronRight className="join-meeting-arrow" size={26} aria-hidden="true" />
                </button>

                <section className="android-download-card" aria-label={copy.apkTitle}>
                  <div className="android-download-heading">
                    <span className="android-download-icon"><Smartphone size={25} aria-hidden="true" /></span>
                    <span>
                      <strong>{copy.apkTitle}</strong>
                      <small>{copy.apkText}</small>
                    </span>
                  </div>
                  <div className="android-download-actions">
                    <a href={ANDROID_APK_URL} className="android-download-primary" aria-label={copy.apkDownload}>
                      <Download size={18} aria-hidden="true" />
                      <span>{copy.apkDownload}</span>
                    </a>
                    <button type="button" className="android-download-share" onClick={() => void shareAndroidApk()} aria-label={copy.apkShare}>
                      <Share2 size={18} aria-hidden="true" />
                      <span>{copy.apkShare}</span>
                    </button>
                  </div>
                  {apkShareMessage ? <small className="android-download-message" role="status">{apkShareMessage}</small> : null}
                </section>

                <p className="create-account-copy">
                  {copy.noAccount}
                  <button type="button" onClick={() => { clearErrors(); setRegisterModalOpen(true); }} aria-haspopup="dialog">
                    {copy.createAccount}
                  </button>
                </p>
              </form>
            </section></div>
          )}

          {initialView === 'register' && (
            <CompactAuthCard
              title="Créer votre espace MBotéRoom"
              subtitle="Centralisez vos réunions, invitations, résumés Luna IA et outils de collaboration dans un espace sécurisé."
              error={formError}
              onSubmit={submitRegister}
              isLoading={isLoading}
              submitLabel="Créer le compte"
              loadingLabel="Création en cours..."
              footer={<AuthFooterAction label="Déjà un compte ?" action="Se connecter" onClick={() => navigate('/connexion')} />}
            >
              {renderRegistrationFields()}
              <TermsConsent accepted={termsAccepted} version={termsVersion} autoOpen onAccepted={(accepted,version)=>{setTermsAccepted(accepted);setTermsVersion(version);setFormError('');}} />
            </CompactAuthCard>
          )}

          {initialView === 'guest' && (
            <CompactAuthCard
              title="Rejoindre une réunion"
              subtitle="Entrez les informations fournies par l'hôte."
              error={formError}
              onSubmit={submitGuestJoin}
              isLoading={isLoading}
              submitLabel="Rejoindre la salle d'attente"
              loadingLabel="Vérification..."
              footer={<AuthFooterAction label="Vous avez un compte ?" action="Se connecter" onClick={() => navigate('/connexion')} />}
            >
              <FormField id="guest-name" label="Votre nom visible" icon={<User size={21} aria-hidden="true" />} error={fieldErrors.name}>
                <input id="guest-name" value={guestName} placeholder="Ex : Marie Louka" autoComplete="name" onChange={(event) => { setGuestName(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="guest-code" label="ID ou lien de réunion" icon={<UsersRound size={21} aria-hidden="true" />} error={fieldErrors.meetingCode}>
                <input id="guest-code" value={meetingCode} placeholder="Ex : 9845671234" onChange={(event) => { setMeetingCode(event.target.value); clearErrors(); }} />
              </FormField>
              <FormField id="guest-password" label="Mot de passe de réunion" icon={<Lock size={21} aria-hidden="true" />} error={fieldErrors.meetingPassword}>
                <input id="guest-password" type="password" value={meetingPassword} placeholder="Code donné par l'hôte" autoComplete="off" onChange={(event) => { setMeetingPassword(event.target.value); clearErrors(); }} />
              </FormField>
              <TermsConsent accepted={termsAccepted} version={termsVersion} onAccepted={(accepted,version)=>{setTermsAccepted(accepted);setTermsVersion(version);setFormError('');}} />
            </CompactAuthCard>
          )}

          {initialView === 'forgot' && (
            <div className="android-login-modal-backdrop forgot-modal-backdrop" role="presentation"><section className="login-card compact-auth-card android-login-modal forgot-bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="forgot-title">
              <header className="login-card-header">
                <h1 id="forgot-title">{resetToken ? 'Nouveau mot de passe' : 'Mot de passe oublié'}</h1>
                <p>{resetToken ? 'Choisissez un nouveau mot de passe sécurisé pour votre compte.' : 'Entrez votre adresse e-mail pour recevoir un lien de réinitialisation.'}</p>
              </header>
              <form className="login-form" onSubmit={resetToken ? submitResetPassword : submitForgotPassword} noValidate>
                {!resetToken && (
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
                )}
                {resetToken && !resetComplete && (
                  <>
                    <FormField id="reset-password" label="Nouveau mot de passe" icon={<Lock size={21} aria-hidden="true" />} error={fieldErrors.password}>
                      <input
                        id="reset-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        placeholder="Au moins 10 caractères"
                        autoComplete="new-password"
                        aria-invalid={Boolean(fieldErrors.password)}
                        aria-describedby={fieldErrors.password ? 'reset-password-error' : undefined}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          clearErrors();
                        }}
                      />
                      <button
                        className="password-toggle"
                        type="button"
                        aria-label={showPassword ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
                        onClick={() => setShowPassword((current) => !current)}
                      >
                        {showPassword ? <EyeOff size={21} aria-hidden="true" /> : <Eye size={21} aria-hidden="true" />}
                      </button>
                    </FormField>
                    <FormField id="reset-password-confirm" label="Confirmer le mot de passe" icon={<ShieldCheck size={21} aria-hidden="true" />} error={fieldErrors.confirmPassword}>
                      <input
                        id="reset-password-confirm"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        placeholder="Saisissez-le une seconde fois"
                        autoComplete="new-password"
                        aria-invalid={Boolean(fieldErrors.confirmPassword)}
                        aria-describedby={fieldErrors.confirmPassword ? 'reset-password-confirm-error' : undefined}
                        onChange={(event) => {
                          setConfirmPassword(event.target.value);
                          clearErrors();
                        }}
                      />
                    </FormField>
                  </>
                )}
                {formError && <p className="auth-error" role="alert">{formError}</p>}
                {forgotMessage && <p className="auth-success" role="status">{forgotMessage}</p>}
                {!resetComplete && (
                  <button className="primary-login-button" type="submit" disabled={isLoading}>
                    {isLoading ? (resetToken ? 'Modification en cours...' : 'Envoi en cours...') : (resetToken ? 'Modifier le mot de passe' : 'Envoyer le lien')}
                  </button>
                )}
                <AuthFooterAction label="Vous connaissez votre mot de passe ?" action="Se connecter" onClick={() => navigate('/connexion')} />
              </form>
            </section></div>
          )}
        </section>
      </section>

      <footer className="login-benefits" aria-label="Créateur de MBotéRoom">
        <div className="login-created-by">MBotéRoom créé par <strong>LoukaTech</strong></div>
      </footer>

      {isRegisterModalOpen && !registrationSuccess && (
        <div
          className="auth-modal-backdrop registration-modal-backdrop android-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRegisterModalOpen(false);
          }}
        >
          <section className="auth-modal registration-modal android-bottom-sheet" role="dialog" aria-modal="true" aria-labelledby="registration-modal-title">
            <button className="registration-modal-close" type="button" aria-label="Fermer la création de compte" onClick={() => setRegisterModalOpen(false)}>×</button>
            <header className="registration-modal-header">
              <span className="auth-card-kicker">Nouveau compte MBotéRoom</span>
              <h2 id="registration-modal-title">Créer un compte</h2>
              <p>Renseignez vos informations pour créer votre espace sécurisé.</p>
            </header>
            <form className="login-form registration-modal-form" onSubmit={submitRegister} noValidate>
              <div className="registration-modal-grid">
                {renderRegistrationFields()}
              </div>
              <TermsConsent accepted={termsAccepted} version={termsVersion} onAccepted={(accepted,version)=>{setTermsAccepted(accepted);setTermsVersion(version);setFormError('');}} />
              {formError && <p className="auth-error" role="alert">{formError}</p>}
              <button className="primary-login-button" type="submit" disabled={isLoading || !termsAccepted || !termsVersion}>
                {isLoading ? 'Création en cours...' : 'Créer le compte'}
              </button>
            </form>
          </section>
        </div>
      )}

      {registrationSuccess && (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal account-created-modal" role="dialog" aria-modal="true" aria-labelledby="account-created-title">
            <span className="auth-modal-icon success" aria-hidden="true"><CheckCircle2 size={28} /></span>
            <h2 id="account-created-title">Votre compte est prêt</h2>
            <p>Bienvenue sur MBotéRoom. Votre espace professionnel vient d’être créé.</p>
            <div className="account-created-summary">
              <span><Mail size={18}/><b>{registrationSuccess.email}</b></span>
              <span><ShieldCheck size={18}/><b>Code de sécurité demandé à chaque connexion</b></span>
              <span><Sparkles size={18}/><b>Luna IA, réunions de qualité et collaboration</b></span>
            </div>
            <div className={registrationSuccess.welcomeEmailSent ? 'account-created-mail sent' : 'account-created-mail warning'}>
              {registrationSuccess.welcomeEmailSent ? '✓ Le mail de bienvenue a été envoyé.' : 'Le compte est créé, mais le mail de bienvenue n’a pas pu être confirmé.'}
            </div>
            <p className="account-created-security">Pour votre sécurité, votre mot de passe n’est jamais envoyé en clair par e-mail.</p>
            <button type="button" onClick={() => { setRegistrationSuccess(null); sessionStorage.removeItem('mboteroom-login-redirect'); navigate(sanitizeInternalPath(redirectTo), { replace: true }); }} autoFocus>
              Accéder à mon espace
            </button>
          </section>
        </div>
      )}

      {otpChallengeId && (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal otp-login-modal" role="dialog" aria-modal="true" aria-labelledby="otp-login-title">
            <span className="auth-modal-icon otp" aria-hidden="true"><KeyRound size={27}/></span>
            <h2 id="otp-login-title">Vérifiez votre connexion</h2>
            <p>Un code à 6 chiffres a été envoyé à <strong>{otpEmailHint}</strong>.</p>
            <form onSubmit={submitLoginOtp} className="otp-login-form">
              <label htmlFor="login-otp">Code de sécurité</label>
              <input
                id="login-otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                placeholder="000000"
                onChange={(event) => { setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setFormError(''); }}
                autoFocus
              />
              <small>{otpSecondsLeft > 0 ? `Expire dans ${Math.floor(otpSecondsLeft / 60)}:${String(otpSecondsLeft % 60).padStart(2, '0')}` : 'Code expiré — demandez-en un nouveau.'}</small>
              {formError && <p className="auth-error otp-error" role="alert">{formError}</p>}
              <button className="primary-login-button" type="submit" disabled={isLoading || otpCode.length !== 6}>{isLoading ? 'Vérification...' : 'Confirmer et se connecter'}</button>
              <button className="auth-modal-secondary-button" type="button" onClick={() => void resendLoginOtp()} disabled={isOtpResending}>{isOtpResending ? 'Envoi...' : 'Renvoyer le code'}</button>
              <button className="otp-cancel-button" type="button" onClick={() => { setOtpChallengeId(''); setOtpRedirectTo(''); setOtpCode(''); setFormError(''); }}>Changer de compte</button>
            </form>
          </section>
        </div>
      )}

      {mboteStep && (
        <div className="auth-modal-backdrop" role="presentation" onMouseDown={closeMboteAuth}>
          <section className="auth-modal mbote-auth-flow" role="dialog" aria-modal="true" aria-labelledby="mbote-flow-title" onMouseDown={(event) => event.stopPropagation()}>
            {mboteStep === 'credentials' ? (
              <>
                <span className="auth-modal-icon" aria-hidden="true">M</span>
                <h2 id="mbote-flow-title">Se connecter avec MBoté Connect</h2>
                <p>Entrez d’abord vos identifiants MBoté pour continuer.</p>
                <form className="mbote-credentials-form" onSubmit={submitMboteCredentials}>
                  <label htmlFor="mbote-identifier">Identifiant MBoté</label>
                  <input id="mbote-identifier" value={mboteIdentifier} autoComplete="username" onChange={(event) => setMboteIdentifier(event.target.value)} autoFocus />
                  <label htmlFor="mbote-password">Mot de passe MBoté</label>
                  <input id="mbote-password" type="password" value={mbotePassword} autoComplete="current-password" onChange={(event) => setMbotePassword(event.target.value)} />
                  {formError && <p className="auth-error" role="alert">{formError}</p>}
                  <button className="primary-login-button" type="submit" disabled={isMboteLoading}>{isMboteLoading ? 'Vérification...' : 'Vérifier et continuer'}</button>
                  <button className="auth-modal-secondary-button" type="button" onClick={closeMboteAuth}>Annuler</button>
                </form>
              </>
            ) : (
              <>
                <span className="auth-modal-icon" aria-hidden="true">✓</span>
                <h2 id="mbote-flow-title">Autoriser l'application ?</h2>
                <p><strong>MBotéRoom</strong> souhaite accéder à votre compte MBoté.</p>
                <div className="mbote-consent-profile">{mboteProfile?.avatar && <img src={mboteProfile.avatar} alt="" />}<span><strong>{mboteProfile?.name}</strong><small>{mboteProfile?.email}</small></span></div>
                <ul className="mbote-consent-list"><li>Voir votre profil public</li><li>Voir votre adresse e-mail</li></ul>
                {formError && <p className="auth-error" role="alert">{formError}</p>}
                <button className="primary-login-button" type="button" onClick={() => void authorizeMbote()} disabled={isMboteLoading}>{isMboteLoading ? 'Autorisation...' : 'Autoriser et continuer'}</button>
                <button className="auth-modal-secondary-button" type="button" onClick={closeMboteAuth}>Annuler</button>
              </>
            )}
          </section>
        </div>
      )}
      {externalAuthModalMessage && (
        <ExternalAuthErrorModal
          message={externalAuthModalMessage}
          onClose={() => setExternalAuthModalMessage('')}
        />
      )}
    </main>
  );
}

function ExternalAuthErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="auth-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="auth-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        aria-describedby="auth-modal-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="auth-modal-icon" aria-hidden="true">!</span>
        <h2 id="auth-modal-title">Connexion MBoté impossible</h2>
        <p id="auth-modal-message">{message}</p>
        <button type="button" onClick={onClose} autoFocus>Fermer</button>
      </section>
    </div>
  );
}

function AuthBrandPanel({
  copy,
  language,
  branding,
  onLanguageChange,
}: {
  copy: (typeof translations)[Language];
  language: Language;
  branding: LoginBranding;
  onLanguageChange: (language: Language) => void;
}) {
  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);
  const navigateToAdmin = useNavigate();
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
      <button className="mbote-logo admin-entry" type="button" aria-label="Ouvrir la connexion administrateur" title="Administration" onClick={() => navigateToAdmin('/admin/login')}>
        <img
          className="mboteroom-wordmark"
          src={branding.wordmarkUrl}
          alt="MBotéRoom"
          onError={(event) => { if (event.currentTarget.src !== defaultLoginBranding.wordmarkUrl) event.currentTarget.src = defaultLoginBranding.wordmarkUrl; }}
        />
      </button>

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

      <MeetingIllustration src={branding.illustrationUrl} />
      <div className="auth-showcase-badge auth-showcase-badge-team" aria-hidden="true">
        <UsersRound size={18} />
        <span>Réunions plus<br/>productives</span>
      </div>
      <div className="auth-showcase-badge auth-showcase-badge-security" aria-hidden="true">
        <Lock size={18} />
        <span>Vos données<br/>en sécurité</span>
      </div>
      <span className="auth-showcase-note" aria-hidden="true">Travailler<br/>ensemble,<br/>simplement.</span>
    </aside>
  );
}

function MeetingIllustration({ src }: { src: string }) {
  return (
    <figure className="meeting-illustration">
      <img
        src={src || defaultLoginBranding.illustrationUrl}
        alt="Participants en pleine réunion vidéo MBotéRoom"
        loading="eager"
        decoding="async"
        onError={(event) => { if (event.currentTarget.src !== defaultLoginBranding.illustrationUrl) event.currentTarget.src = defaultLoginBranding.illustrationUrl; }}
      />
    </figure>
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
