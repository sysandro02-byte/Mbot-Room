import { FormEvent, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { DoorOpen, Lock, Mail, ShieldCheck, User, Video } from 'lucide-react';
import { authService } from '../services/authService';
import './Login.css';

type AuthMode = 'login' | 'register' | 'guest';

export default function Login() {
  const [mode, setMode] = useState<AuthMode>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [guestName, setGuestName] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingPassword, setMeetingPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = useMemo(() => {
    const raw = searchParams.get('redirect') || '/app';
    return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app';
  }, [searchParams]);

  if (authService.isAuthenticated()) {
    return <Navigate to={redirectTo} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      if (mode === 'register') {
        await authService.register({ name, email, password });
        navigate(redirectTo, { replace: true });
      } else if (mode === 'login') {
        await authService.login({ email, password });
        navigate(redirectTo, { replace: true });
      } else {
        const result = await authService.guestJoin({ name: guestName, meetingCode, password: meetingPassword });
        const target = result.meeting?.meeting_link ? `/join/${result.meeting.meeting_link}` : '/join';
        navigate(target, { replace: true });
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Action impossible.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-hero-badge"><ShieldCheck size={18} /> Accès contrôlé</div>
        <h1>Réunions MBoté sécurisées pour comptes et invités</h1>
        <p>Créez un compte pour gérer vos réunions, ou rejoignez une réunion existante avec son ID et son mot de passe.</p>
        <div className="login-hero-grid" aria-hidden="true">
          <span>Hôte</span>
          <span>Co-hôte</span>
          <span>Invité</span>
          <span>Lobby</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-brand">
          <span><Video size={28} /></span>
          <div>
            <strong>MBoté Room</strong>
            <p>Compte utilisateur ou accès invité via salle d’attente.</p>
          </div>
        </div>

        <div className="login-mode">
          <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>
            Créer un compte
          </button>
          <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>
            Se connecter
          </button>
          <button type="button" className={mode === 'guest' ? 'is-active' : ''} onClick={() => setMode('guest')}>
            Rejoindre
          </button>
        </div>

        <form onSubmit={submit}>
          <h2>
            {mode === 'register'
              ? 'Créer votre accès réunion'
              : mode === 'login'
                ? 'Connexion à vos réunions'
                : 'Rejoindre une réunion'}
          </h2>
          <p className="login-copy">
            {mode === 'register'
              ? 'Un compte est obligatoire pour accéder à l’interface réunion.'
              : mode === 'login'
                ? 'Connectez-vous pour retrouver vos réunions et rejoindre une salle.'
                : 'Entrez votre nom, l’ID de réunion et le mot de passe. L’hôte ou le co-hôte vous validera depuis la salle d’attente.'}
          </p>

          {(mode === 'register' || mode === 'guest') && (
            <label className="login-field">
              <User size={20} />
              <span>
                <strong>{mode === 'guest' ? 'Votre nom visible' : 'Nom complet'}</strong>
                <input
                  value={mode === 'guest' ? guestName : name}
                  onChange={(event) => mode === 'guest' ? setGuestName(event.target.value) : setName(event.target.value)}
                  placeholder="Ex : Marie Louka"
                  required
                />
              </span>
            </label>
          )}

          {mode !== 'guest' ? (
            <label className="login-field">
              <Mail size={20} />
              <span>
                <strong>Email</strong>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vous@exemple.com" required />
              </span>
            </label>
          ) : (
            <label className="login-field">
              <DoorOpen size={20} />
              <span>
                <strong>ID ou lien de réunion</strong>
                <input value={meetingCode} onChange={(event) => setMeetingCode(event.target.value)} placeholder="Ex : 9845671234" required />
              </span>
            </label>
          )}

          <label className="login-field">
            <Lock size={20} />
            <span>
              <strong>{mode === 'guest' ? 'Mot de passe de réunion' : 'Mot de passe'}</strong>
              <input
                type="password"
                value={mode === 'guest' ? meetingPassword : password}
                onChange={(event) => mode === 'guest' ? setMeetingPassword(event.target.value) : setPassword(event.target.value)}
                placeholder={mode === 'guest' ? 'Code donné par l’hôte' : '8 caractères minimum'}
                minLength={mode === 'guest' ? undefined : 8}
                required
              />
            </span>
          </label>

          {error && <p className="login-error">{error}</p>}

          <button className="login-submit" type="submit" disabled={isLoading}>
            {isLoading
              ? 'Vérification...'
              : mode === 'register'
                ? 'Créer le compte'
                : mode === 'login'
                  ? 'Entrer'
                  : 'Rejoindre la salle d’attente'}
          </button>
        </form>

        <p className="login-demo">
          Compte démo local : <strong>hote@mbote.local</strong> / <strong>MboteRoom2026!</strong>
        </p>
      </section>
    </main>
  );
}
