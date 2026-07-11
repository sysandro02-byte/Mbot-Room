import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Calendar, Check, Clock, Image as ImageIcon, LockKeyhole, Mic, MicOff, ShieldCheck, Sparkles, User, Users, Video, VideoOff, X } from 'lucide-react';
import MeetingRoom from '../components/MeetingRoom';
import { authService } from '../services/authService';
import { getMeetingAccessCode, meetingService, Meeting } from '../services/meetingService';
import { goBack } from '../lib/navigation';
import BackButton from '../components/BackButton';
import './MeetingJoinPage.css';

type JoinStep = 'form' | 'preview' | 'access' | 'waiting' | 'room';

type JoinOptions = {
  mic: boolean;
  camera: boolean;
  background: boolean;
  backgroundUrl?: string;
};

export default function MeetingJoinPage() {
  const { meetingLink = '' } = useParams();
  const navigate = useNavigate();
  const currentUser = authService.getCurrentUser();
  const currentUserName = currentUser?.name || currentUser?.username || currentUser?.email || 'Utilisateur MBoté';
  const currentUserAvatar = currentUser?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserName)}&background=7c3aed&color=fff&bold=true`;
  const [step, setStep] = useState<JoinStep>(meetingLink ? 'preview' : 'form');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingCode, setMeetingCode] = useState(meetingLink);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(Boolean(meetingLink));
  const [isJoining, setIsJoining] = useState(false);
  const [joinConfirmOpen, setJoinConfirmOpen] = useState(false);
  const [options, setOptions] = useState<JoinOptions>({
    mic: true,
    camera: true,
    background: false,
  });
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const uploadedBackgroundUrlRef = useRef<string>('');
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    return () => {
      if (uploadedBackgroundUrlRef.current) {
        URL.revokeObjectURL(uploadedBackgroundUrlRef.current);
      }
    };
  }, []);

  const toggleMicrophone = () => setOptions((prev) => ({ ...prev, mic: !prev.mic }));
  const toggleCamera = () => setOptions((prev) => ({ ...prev, camera: !prev.camera }));
  const toggleVirtualBackground = () => setOptions((prev) => ({ ...prev, background: !prev.background }));

  const selectVirtualBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choisissez une image pour le fond virtuel.');
      return;
    }
    if (uploadedBackgroundUrlRef.current) {
      URL.revokeObjectURL(uploadedBackgroundUrlRef.current);
    }
    const objectUrl = URL.createObjectURL(file);
    uploadedBackgroundUrlRef.current = objectUrl;
    setOptions((prev) => ({ ...prev, background: true, backgroundUrl: objectUrl }));
  };

  useEffect(() => {
    if (!authService.isAuthenticated()) {
      const target = meetingLink ? `/join/${encodeURIComponent(meetingLink)}` : '/join';
      navigate(`/login?redirect=${encodeURIComponent(target)}`, { replace: true });
      return;
    }
    if (!meetingLink) return;
    void loadMeeting(meetingLink);
  }, [meetingLink, navigate]);

  useEffect(() => {
    let cancelled = false;

    const stopPreviewStream = () => {
      previewStreamRef.current?.getTracks().forEach((track) => track.stop());
      previewStreamRef.current = null;
      setPreviewStream(null);
      setMicLevel(0);
    };

    if (step !== 'form' || (!options.camera && !options.mic)) {
      stopPreviewStream();
      setPreviewError('');
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('Camera ou micro indisponible sur ce navigateur.');
      return undefined;
    }

    const openPreviewStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: options.mic ? {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } : false,
          video: options.camera ? {
            width: { ideal: 960 },
            height: { ideal: 540 },
            facingMode: 'user',
          } : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopPreviewStream();
        previewStreamRef.current = stream;
        setPreviewStream(stream);
        setPreviewError('');
      } catch (streamError) {
        stopPreviewStream();
        const message = streamError instanceof DOMException && streamError.name === 'NotAllowedError'
          ? 'Autorisez la camera et le micro pour voir votre apercu.'
          : "Impossible d'ouvrir la camera ou le micro.";
        setPreviewError(message);
      }
    };

    void openPreviewStream();

    return () => {
      cancelled = true;
      stopPreviewStream();
    };
  }, [options.camera, options.mic, step]);

  useEffect(() => {
    const video = previewVideoRef.current;
    if (!video || !previewStream) return;
    video.srcObject = previewStream;
    void video.play().catch(() => undefined);
  }, [previewStream]);

  useEffect(() => {
    if (!options.mic || !previewStream?.getAudioTracks().length) {
      setMicLevel(0);
      return undefined;
    }

    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCtor) return undefined;
    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(previewStream);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frameId = 0;

    analyser.fftSize = 256;
    source.connect(analyser);

    const readLevel = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((total, value) => total + value, 0) / Math.max(1, data.length);
      setMicLevel(Math.min(1, average / 110));
      frameId = window.requestAnimationFrame(readLevel);
    };
    readLevel();

    return () => {
      window.cancelAnimationFrame(frameId);
      source.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [options.mic, previewStream]);

  const loadMeeting = async (value: string, openConfirmation = false) => {
    const normalized = normalizeMeetingInput(value);
    if (!normalized) {
      setError('Ajoutez un lien, un code ou un ID de réunion.');
      return null;
    }
    setIsLoading(true);
    setError('');
    try {
      let found: Meeting | null = null;
      if (!/^\d+$/.test(normalized)) {
        found = await meetingService.getMeetingByLink(normalized);
      } else {
        const meetings = await meetingService.getMeetings();
        found = meetings.find((item) => String(item.id) === normalized || getMeetingAccessCode(item) === normalized.toUpperCase()) || null;
      }
      if (!found) throw new Error('Reunion introuvable.');
      setMeeting(found);
      setMeetingCode(String(found.id));
      setStep('preview');
      if (openConfirmation) setJoinConfirmOpen(true);
      return found;
    } catch (loadError) {
      setMeeting(null);
      setError(loadError instanceof Error ? loadError.message : 'Réunion introuvable ou lien expiré.');
      setStep('form');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (step !== 'waiting' || !meeting || !currentUser?.id) return undefined;
    let cancelled = false;
    const checkLobbyStatus = async () => {
      const lobby = await meetingService.getLobby(meeting.id).catch(() => []);
      if (cancelled) return;
      const me = lobby.find((item) => String(item.user_id) === String(currentUser.id));
      if (me?.status === 'accepted') {
        setError('');
        setStep('room');
      }
      if (me?.status === 'rejected') {
        setError("L'hôte a refusé votre demande d'accès.");
        setStep('preview');
      }
    };
    void checkLobbyStatus();
    const timer = window.setInterval(checkLobbyStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser?.id, meeting, step]);

  const meetingDate = useMemo(() => {
    if (!meeting) return '';
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(meeting.start_time));
  }, [meeting]);

  const joinNow = async () => {
    if (!meeting) return;
    setIsJoining(true);
    const expectedPassword = String(meeting.settings?.password || '').trim();
    if (expectedPassword && password.trim().toUpperCase() !== expectedPassword.toUpperCase()) {
      setStep('access');
      setJoinConfirmOpen(false);
      setError('Mot de passe incorrect.');
      setIsJoining(false);
      return;
    }
    const access = await meetingService.requestJoin(meeting.id, currentUser?.id ? Number(currentUser.id) : undefined, password).catch((joinError) => {
      setJoinConfirmOpen(false);
      setError(joinError instanceof Error ? joinError.message : 'Accès impossible.');
      return null;
    });
    setIsJoining(false);
    if (!access) return;
    setError('');
    setJoinConfirmOpen(false);
    setStep(access.status === 'requested' ? 'waiting' : 'room');
  };

  const requestJoinConfirmation = () => {
    if (!meeting) return;
    setError('');
    setJoinConfirmOpen(true);
  };

  const submitLookup = async (event: FormEvent) => {
    event.preventDefault();
    await joinWithIdAndPassword();
  };

  const joinWithIdAndPassword = async () => {
    const normalizedCode = normalizeMeetingInput(meetingCode);
    if (!normalizedCode || !password.trim()) {
      setError("Ajoutez l'ID de la réunion et son mot de passe.");
      return;
    }

    setIsJoining(true);
    setError('');
    try {
      const found = await meetingService.lookupMeetingAccess(normalizedCode, password);
      setMeeting(found);
      setMeetingCode(String(found.id));
      const access = await meetingService.requestJoin(found.id, currentUser?.id ? Number(currentUser.id) : undefined, password);
      setJoinConfirmOpen(false);
      setStep(access.status === 'requested' ? 'waiting' : 'room');
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Acces impossible avec cet ID et ce mot de passe.');
    } finally {
      setIsJoining(false);
    }
  };

  const closeToMeetings = () => goBack(navigate, '/app?tab=reunions');

  if (step === 'room' && meeting) {
    return <MeetingRoom meeting={meeting} joinOptions={options} onLeave={closeToMeetings} />;
  }

  const previewClassName = [
    'join-camera-preview',
    options.camera ? '' : 'is-camera-off',
    options.background ? 'has-background' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className="join-page">
      <header className="join-top-bar">
        {step === 'form' ? (
          <BackButton fallbackPath="/app?tab=reunions" label="" className="join-top-back" />
        ) : (
          <button type="button" onClick={() => setStep('form')} aria-label="Retour">
            <ArrowLeft size={26} />
          </button>
        )}
        <h1>Rejoindre une réunion</h1>
        <span />
      </header>

      {step === 'form' && (
        <>
          <section className={`join-illustration join-device-preview${options.background ? ' has-background' : ''}${!options.camera ? ' is-camera-off' : ''}`} aria-label="Apercu camera, micro et arriere-plan">
            <div className="join-device-surface">
              {options.camera && previewStream?.getVideoTracks().length ? (
                <video ref={previewVideoRef} muted playsInline autoPlay />
              ) : (
                <div className="join-device-camera-off">
                  <img src={currentUserAvatar} alt="" />
                  <strong>{options.camera ? 'Camera en attente' : 'Camera desactivee'}</strong>
                  <small>{options.camera ? 'Autorisez la camera pour voir votre image.' : 'Votre image ne sera pas partagee.'}</small>
                </div>
              )}
              {options.background && <span className="join-device-background" aria-hidden="true" style={options.backgroundUrl ? { backgroundImage: `linear-gradient(135deg, rgba(18, 12, 54, .28), rgba(91, 0, 232, .2)), url("${options.backgroundUrl}")` } : undefined} />}
              <div className="join-device-status">
                <button type="button" className={options.background ? 'is-on is-background' : 'is-off is-background'} onClick={toggleVirtualBackground} onDoubleClick={() => backgroundInputRef.current?.click()} aria-pressed={options.background}>
                  <ImageIcon size={16} />
                  {options.background ? 'Fond virtuel actif' : 'Sans fond virtuel'}
                </button>
                <button type="button" className={options.mic ? 'is-on is-device-toggle' : 'is-off is-device-toggle'} onClick={toggleMicrophone} aria-pressed={options.mic}>
                  {options.mic ? <Mic size={16} /> : <MicOff size={16} />}
                  {options.mic ? 'Micro actif' : 'Micro coupe'}
                </button>
                <button type="button" className={options.camera ? 'is-on is-device-toggle' : 'is-off is-device-toggle'} onClick={toggleCamera} aria-pressed={options.camera}>
                  {options.camera ? <Video size={16} /> : <VideoOff size={16} />}
                  {options.camera ? 'Camera active' : 'Camera coupee'}
                </button>
              </div>
              <input ref={backgroundInputRef} className="join-background-input" type="file" accept="image/*" onChange={selectVirtualBackground} aria-label="Telecharger un fond virtuel" />
              <div className="join-device-mic-meter" aria-hidden="true">
                {[0.25, 0.45, 0.65, 0.85].map((threshold) => (
                  <i key={threshold} className={options.mic && micLevel >= threshold ? 'is-active' : ''} />
                ))}
              </div>
              {previewError && <p className="join-device-error">{previewError}</p>}
            </div>
          </section>

          <form onSubmit={submitLookup}>
            <h2 className="join-section-title">Entrez les informations de la réunion</h2>
            <JoinInput icon={<LockKeyhole />} title="ID de réunion" value={meetingCode} onChange={setMeetingCode} placeholder="Ex : 984 567 1234 ou lien" action={<Sparkles size={22} />} />
            <JoinInput icon={<LockKeyhole />} title="Mot de passe de la réunion" value={password} onChange={setPassword} placeholder="Code secret si requis" inputType="password" />

            <section className="join-current-user-card" aria-label="Identité utilisée en réunion">
              <img src={currentUserAvatar} alt="" />
              <div>
                <strong>{currentUserName}</strong>
                <p>Ce nom et cette photo seront affichés dans la réunion.</p>
              </div>
            </section>

            <h2 className="join-section-title">Options de connexion</h2>
            <div className="join-options-card">
              <OptionRow
                icon={options.mic ? <Mic /> : <MicOff />}
                label={options.mic ? 'Desactiver mon micro' : 'Activer mon micro'}
                active={options.mic}
                onClick={toggleMicrophone}
              />
              <OptionRow
                icon={options.camera ? <Video /> : <VideoOff />}
                label={options.camera ? 'Desactiver ma camera' : 'Activer ma camera'}
                active={options.camera}
                onClick={toggleCamera}
              />
              <OptionRow
                icon={<ImageIcon />}
                label={options.background ? "Retirer l'arriere-plan" : 'Arriere-plan virtuel'}
                active={options.background}
                onClick={toggleVirtualBackground}
                secondaryLabel="Changer l'image"
                onSecondaryClick={() => backgroundInputRef.current?.click()}
              />
            </div>

            <section className="join-secure-card">
              <div><ShieldCheck size={24} /></div>
              <div>
                <strong>Vos informations sont chiffrees</strong>
                <p>Votre réunion est sécurisée de bout en bout.</p>
              </div>
            </section>

            <button className="join-primary-btn" type="submit" disabled={isJoining || isLoading}>
              {isJoining || isLoading ? 'Vérification...' : 'Rejoindre la réunion'}
            </button>
          </form>
        </>
      )}

      {step === 'preview' && meeting && (
        <>
          <section className="join-ready-card">
            <div><Check size={24} /></div>
            <div>
              <h2>Prêt à rejoindre</h2>
              <p>Vérifiez vos paramètres avant de rejoindre la réunion.</p>
            </div>
          </section>

          <section className={previewClassName}>
            {options.camera ? (
              <img src={currentUserAvatar || meeting.host_avatar || 'https://i.pravatar.cc/600?img=15'} alt={`Apercu camera de ${currentUserName}`} />
            ) : (
              <div className="join-camera-off-preview">
                <img src={currentUserAvatar} alt={currentUserName} />
                <strong>{currentUserName}</strong>
                <small>Camera desactivee</small>
              </div>
            )}
            {options.background && options.backgroundUrl && <span className="join-camera-custom-background" style={{ backgroundImage: `url("${options.backgroundUrl}")` }} aria-hidden="true" />}
            <button className="join-change-bg" type="button" onClick={() => backgroundInputRef.current?.click()} aria-label="Changer le fond virtuel">
              <ImageIcon size={22} />
            </button>
            <div className="join-preview-controls">
              <PreviewControl icon={options.mic ? <Mic /> : <MicOff />} label="Micro" active={options.mic} onClick={toggleMicrophone} />
              <PreviewControl icon={options.camera ? <Video /> : <VideoOff />} label="Camera" active={options.camera} onClick={toggleCamera} />
              <PreviewControl icon={<ImageIcon />} label="Fond" active={options.background} onClick={toggleVirtualBackground} />
            </div>
          </section>

          <section>
            <h2 className="join-section-title">Détails de la réunion</h2>
            <div className="join-details-card">
              <Detail icon={<Calendar />} label="Titre" value={meeting.title} />
              <Detail icon={<User />} label="Hote" value={meeting.host_name || 'Vous'} />
              <Detail icon={<Clock />} label="Heure" value={meetingDate} />
              <Detail icon={<Sparkles />} label="Fuseau horaire" value="(GMT+1) Paris" />
              <Detail icon={<Users />} label="Participants" value={`${Math.max(1, meeting.participant_count || 1)} participants`} />
            </div>
          </section>

          {meeting.settings?.password && (
            <JoinInput icon={<LockKeyhole />} title="Mot de passe" value={password} onChange={setPassword} placeholder="Code secret de la réunion" inputType="password" />
          )}
          <button className="join-primary-btn" type="button" onClick={requestJoinConfirmation}>Rejoindre maintenant</button>
          <button className="join-cancel-btn" type="button" onClick={() => setStep('form')}>Annuler</button>
        </>
      )}

      {step === 'access' && meeting && (
        <section className="join-waiting-card">
          <h2>Acces protege</h2>
          <p>Entrez le mot de passe envoyé par l'hôte pour continuer.</p>
          <JoinInput icon={<LockKeyhole />} title="Mot de passe" value={password} onChange={setPassword} placeholder="Code secret" inputType="password" />
          <button className="join-primary-btn" type="button" onClick={requestJoinConfirmation}>Verifier et rejoindre</button>
        </section>
      )}

      {step === 'waiting' && (
        <section className="join-waiting-card">
          <h2>Salle d'attente</h2>
          <p>Votre demande est envoyée. L'hôte doit vous accepter avant l'ouverture de la salle. Vous entrerez automatiquement dès que l'accès est accepté.</p>
          <button className="join-cancel-btn" type="button" onClick={closeToMeetings}>Retour aux réunions</button>
        </section>
      )}

      {joinConfirmOpen && meeting && (
        <div className="join-confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="join-confirm-title">
          <section className="join-confirm-card">
            <button className="join-confirm-close" type="button" onClick={() => setJoinConfirmOpen(false)} aria-label="Fermer">
              <X size={20} />
            </button>
            <div className="join-confirm-icon"><ShieldCheck size={26} /></div>
            <h2 id="join-confirm-title">Entrer dans cette réunion ?</h2>
            <p>
              Vous allez rejoindre <strong>{meeting.title}</strong> avec le nom <strong>{currentUserName}</strong>.
              {meeting.settings?.waitingRoom !== false
                ? " L'hôte devra accepter votre accès depuis la salle d'attente."
                : " Vous entrerez directement si vos informations sont valides."}
            </p>
            <div className="join-confirm-summary">
              <span>{options.mic ? 'Micro active' : 'Micro coupe'}</span>
              <span>{options.camera ? 'Camera activee' : 'Camera coupee'}</span>
              <span>{options.background ? 'Arriere-plan active' : 'Sans arriere-plan'}</span>
            </div>
            <div className="join-confirm-actions">
              <button className="join-cancel-btn" type="button" onClick={() => setJoinConfirmOpen(false)}>Annuler</button>
              <button className="join-primary-btn" type="button" disabled={isJoining} onClick={joinNow}>
                {isJoining ? 'Demande en cours...' : 'Accepter et rejoindre'}
              </button>
            </div>
          </section>
        </div>
      )}

      {error && (
        <div className="join-confirm-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="join-error-title">
          <section className="join-confirm-card join-error-card">
            <button className="join-confirm-close" type="button" onClick={() => setError('')} aria-label="Fermer">
              <X size={20} />
            </button>
            <div className="join-confirm-icon join-error-icon"><AlertTriangle size={28} /></div>
            <h2 id="join-error-title">Action impossible</h2>
            <p>{error}</p>
            <button className="join-primary-btn" type="button" onClick={() => setError('')}>Compris</button>
          </section>
        </div>
      )}
    </main>
  );
}

function normalizeMeetingInput(value: string) {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || raw;
  } catch {
    return raw.replace(/\s+/g, '');
  }
}

function JoinInput({ icon, title, value, onChange, placeholder, action, inputType = 'text' }: { icon: React.ReactNode; title: string; value: string; onChange: (value: string) => void; placeholder: string; action?: React.ReactNode; inputType?: string }) {
  return (
    <label className="join-input-box">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <input type={inputType} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      </div>
      {action && <button type="button">{action}</button>}
    </label>
  );
}

function OptionRow({
  icon,
  label,
  active,
  onClick,
  secondaryLabel,
  onSecondaryClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  secondaryLabel?: string;
  onSecondaryClick?: () => void;
}) {
  return (
    <button className={secondaryLabel ? 'join-option-row has-secondary-action' : 'join-option-row'} type="button" onClick={onClick} aria-pressed={active}>
      <span>{icon}</span>
      <strong>
        {label}
        {secondaryLabel && (
          <small
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onSecondaryClick?.();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onSecondaryClick?.();
              }
            }}
          >
            {secondaryLabel}
          </small>
        )}
      </strong>
      <i className={active ? 'active' : ''} />
    </button>
  );
}

function PreviewControl({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className="join-preview-control" type="button" onClick={onClick} aria-pressed={active}>
      <span>{icon}</span>
      <strong>{label}</strong>
      <small>{active ? 'Active' : 'Desactive'}</small>
    </button>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="join-detail-row">
      <span>{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
