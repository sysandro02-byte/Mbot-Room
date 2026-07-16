import { ChangeEvent, CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BadgeInfo,
  Camera,
  Check,
  ChevronDown,
  CircleOff,
  FileImage,
  Hourglass,
  Image as ImageIcon,
  LogOut,
  Mic,
  MonitorUp,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import { authService } from '../services/authService';
import { getMeetingAccessCode, Meeting, meetingService } from '../services/meetingService';
import './GuestWaitingRoomPage.css';

type BackgroundMode = 'none' | 'blur' | 'office' | 'gradient' | 'custom';
type PermissionStatus = 'checking' | 'ready' | 'partial' | 'denied';
type LobbyStatus = 'waiting' | 'accepted' | 'rejected' | 'ended';

type MediaDevicesState = {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

type WaitingRoomState = {
  guestName?: string;
  meetingId?: string | number;
  meeting?: Partial<Meeting>;
  isGuest?: boolean;
};

const initialDevices: MediaDevicesState = {
  microphones: [],
  cameras: [],
  speakers: [],
};

const audioBars = Array.from({ length: 28 }, (_, index) => index);

function formatMeetingId(value: string): string {
  const normalized = value.replace(/\D/g, '');
  if (!normalized) return value;
  return normalized.match(/.{1,3}/g)?.join(' ') || normalized;
}

function getDeviceLabel(device: MediaDeviceInfo, fallback: string, index: number): string {
  return device.label || `${fallback} ${index + 1}`;
}

function isImageFile(file: File): boolean {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
}

export default function GuestWaitingRoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { meetingId = '' } = useParams();
  const locationState = location.state as WaitingRoomState | null;
  const currentUser = authService.getCurrentUser();
  const guestName = locationState?.guestName?.trim() || currentUser?.name || 'Vous';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const customBackgroundInputRef = useRef<HTMLInputElement | null>(null);
  const deviceSettingsRef = useRef<HTMLElement | null>(null);
  const microphoneEnabledRef = useRef(true);
  const cameraEnabledRef = useRef(true);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingError, setMeetingError] = useState('');
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatus>('waiting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDevicesState>(initialDevices);
  const [selectedMicrophone, setSelectedMicrophone] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('none');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState('');
  const [showDeviceSettings, setShowDeviceSettings] = useState(true);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('checking');
  const [mediaError, setMediaError] = useState('');
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStream(null);
    setMicrophoneLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const availableDevices = await navigator.mediaDevices.enumerateDevices();
    const microphones = availableDevices.filter((device) => device.kind === 'audioinput');
    const cameras = availableDevices.filter((device) => device.kind === 'videoinput');
    const speakers = availableDevices.filter((device) => device.kind === 'audiooutput');

    setDevices({ microphones, cameras, speakers });
    setSelectedMicrophone((currentValue) => currentValue && microphones.some((device) => device.deviceId === currentValue) ? currentValue : microphones[0]?.deviceId || '');
    setSelectedCamera((currentValue) => currentValue && cameras.some((device) => device.deviceId === currentValue) ? currentValue : cameras[0]?.deviceId || '');
    setSelectedSpeaker((currentValue) => currentValue && speakers.some((device) => device.deviceId === currentValue) ? currentValue : speakers[0]?.deviceId || '');
  }, []);

  const requestPartialMedia = useCallback(async (audioConstraint: boolean | MediaTrackConstraints, videoConstraint: boolean | MediaTrackConstraints) => {
    const tracks: MediaStreamTrack[] = [];

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
      tracks.push(...audioStream.getAudioTracks());
    } catch {
      // Microphone can be unavailable while camera remains usable.
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraint });
      tracks.push(...videoStream.getVideoTracks());
    } catch {
      // Camera can be unavailable while microphone remains usable.
    }

    if (!tracks.length) {
      throw new Error("Aucun périphérique audio ou vidéo n'est accessible.");
    }

    return new MediaStream(tracks);
  }, []);

  const openMedia = useCallback(async (microphoneDeviceId?: string, cameraDeviceId?: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionStatus('denied');
      setMediaError("Votre navigateur ne prend pas en charge l'accès à la caméra et au microphone.");
      return;
    }

    setPermissionStatus('checking');
    setMediaError('');

    const audioConstraint: MediaTrackConstraints = microphoneDeviceId
      ? { deviceId: { exact: microphoneDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const videoConstraint: MediaTrackConstraints = cameraDeviceId
      ? { deviceId: { exact: cameraDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' };

    try {
      let nextStream: MediaStream;

      try {
        nextStream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        });
      } catch {
        nextStream = await requestPartialMedia(audioConstraint, videoConstraint);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      nextStream.getAudioTracks().forEach((track) => {
        track.enabled = microphoneEnabledRef.current;
      });
      nextStream.getVideoTracks().forEach((track) => {
        track.enabled = cameraEnabledRef.current;
      });

      streamRef.current = nextStream;
      setStream(nextStream);

      const hasAudio = nextStream.getAudioTracks().length > 0;
      const hasVideo = nextStream.getVideoTracks().length > 0;
      setPermissionStatus(hasAudio && hasVideo ? 'ready' : 'partial');

      await refreshDevices();

      const audioDeviceId = nextStream.getAudioTracks()[0]?.getSettings().deviceId;
      const videoDeviceId = nextStream.getVideoTracks()[0]?.getSettings().deviceId;
      if (audioDeviceId) setSelectedMicrophone(audioDeviceId);
      if (videoDeviceId) setSelectedCamera(videoDeviceId);
    } catch (error) {
      setPermissionStatus('denied');
      setMediaError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? "L'accès à la caméra ou au microphone a été refusé. Autorisez les permissions dans votre navigateur."
        : error instanceof Error ? error.message : "Impossible d'accéder à vos périphériques.");
    }
  }, [refreshDevices, requestPartialMedia]);

  useEffect(() => {
    if (!authService.isAuthenticated()) {
      navigate('/rejoindre-une-reunion', { replace: true });
      return;
    }

    let cancelled = false;
    const loadMeeting = async () => {
      try {
        const meetings = await meetingService.getMeetings();
        if (cancelled) return;
        const found = meetings.find((item) => {
          const accessCode = getMeetingAccessCode(item);
          return String(item.id) === String(meetingId)
            || String(item.meeting_link) === String(meetingId)
            || accessCode === String(meetingId).toUpperCase()
            || String(locationState?.meeting?.id || '') === String(item.id);
        }) || null;
        setMeeting(found || (locationState?.meeting as Meeting | undefined) || null);
        if (!found && !locationState?.meeting) setMeetingError('Réunion introuvable ou inaccessible.');
      } catch (error) {
        if (!cancelled) setMeetingError(error instanceof Error ? error.message : 'Impossible de charger la réunion.');
      }
    };

    void loadMeeting();
    return () => {
      cancelled = true;
    };
  }, [locationState?.meeting, meetingId, navigate]);

  useEffect(() => {
    void openMedia();

    return () => {
      stopMedia();
    };
  }, [openMedia, stopMedia]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    void videoRef.current.play().catch(() => undefined);
  }, [stream]);

  useEffect(() => {
    if (!stream || !microphoneEnabled || stream.getAudioTracks().length === 0) {
      setMicrophoneLevel(0);
      return undefined;
    }

    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return undefined;
    const audioContext = new AudioContextCtor();
    const source = audioContext.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser = audioContext.createAnalyser();
    const values = new Uint8Array(analyser.frequencyBinCount);
    let animationFrameId = 0;

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.78;
    source.connect(analyser);

    const updateMeter = () => {
      analyser.getByteFrequencyData(values);
      const average = values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
      setMicrophoneLevel(Math.min(average / 100, 1));
      animationFrameId = requestAnimationFrame(updateMeter);
    };

    updateMeter();

    return () => {
      cancelAnimationFrame(animationFrameId);
      source.disconnect();
      void audioContext.close().catch(() => undefined);
    };
  }, [stream, microphoneEnabled]);

  useEffect(() => {
    if (!meeting || !currentUser?.id) return undefined;

    let cancelled = false;
    const checkLobby = async () => {
      const lobby = await meetingService.getLobby(meeting.id).catch(() => []);
      if (cancelled) return;
      const me = lobby.find((item) => String(item.user_id) === String(currentUser.id));
      if (me?.status === 'accepted') {
        setLobbyStatus('accepted');
        stopMedia();
        navigate(`/reunions/${encodeURIComponent(String(meeting.id))}`, {
          replace: true,
          state: {
            guestName,
            meeting,
            isGuest: true,
            joinOptions: {
              mic: microphoneEnabledRef.current,
              camera: cameraEnabledRef.current,
              background: backgroundMode !== 'none',
              backgroundUrl: customBackgroundUrl || undefined,
            },
          },
        });
      } else if (me?.status === 'rejected') {
        setLobbyStatus('rejected');
        stopMedia();
        window.setTimeout(() => navigate('/rejoindre-une-reunion', { replace: true }), 1800);
      } else {
        setLobbyStatus('waiting');
      }
    };

    void checkLobby();
    const intervalId = window.setInterval(checkLobby, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [backgroundMode, currentUser?.id, customBackgroundUrl, meeting, navigate, stopMedia]);

  useEffect(() => {
    return () => {
      if (customBackgroundUrl) URL.revokeObjectURL(customBackgroundUrl);
    };
  }, [customBackgroundUrl]);

  const meetingTitle = meeting?.title || 'Réunion MBotéRoom';
  const meetingLink = meeting?.meeting_link || String(locationState?.meetingId || meetingId);
  const meetingAccessId = meeting ? getMeetingAccessCode(meeting) : String(locationState?.meetingId || meetingId);
  const hostName = meeting?.host_name || 'Hôte MBotéRoom';
  const participantCount = Math.max(1, meeting?.participant_count || 1);
  const secured = meeting?.settings?.encryption !== false;
  const activeAudioBars = Math.round(microphoneLevel * audioBars.length);
  const videoClassName = ['waiting-video-preview', `background-${backgroundMode}`, cameraEnabled ? '' : 'is-camera-off'].filter(Boolean).join(' ');
  const customPreviewStyle = customBackgroundUrl ? ({ '--waiting-room-background': `url("${customBackgroundUrl}")` } as CSSProperties) : undefined;

  const toggleMicrophone = () => {
    const nextValue = !microphoneEnabled;
    microphoneEnabledRef.current = nextValue;
    setMicrophoneEnabled(nextValue);
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
  };

  const toggleCamera = () => {
    const nextValue = !cameraEnabled;
    cameraEnabledRef.current = nextValue;
    setCameraEnabled(nextValue);
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextValue;
    });
  };

  const changeMicrophone = async (event: ChangeEvent<HTMLSelectElement>) => {
    const deviceId = event.target.value;
    setSelectedMicrophone(deviceId);
    await openMedia(deviceId, selectedCamera || undefined);
  };

  const changeCamera = async (event: ChangeEvent<HTMLSelectElement>) => {
    const deviceId = event.target.value;
    setSelectedCamera(deviceId);
    await openMedia(selectedMicrophone || undefined, deviceId);
  };

  const testSpeaker = async () => {
    if (isTestingSpeaker) return;
    setIsTestingSpeaker(true);
    let audioContext: AudioContext | null = null;
    let audioElement: HTMLAudioElement | null = null;

    try {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = 640;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(destination);

      audioElement = new Audio();
      audioElement.srcObject = destination.stream;
      const outputElement = audioElement as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
      if (selectedSpeaker && outputElement.setSinkId) await outputElement.setSinkId(selectedSpeaker);
      await audioElement.play();
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.55);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 650));
      audioElement.pause();
    } catch {
      setMediaError("Le test des haut-parleurs n'a pas pu être lancé.");
    } finally {
      audioElement?.pause();
      void audioContext?.close().catch(() => undefined);
      setIsTestingSpeaker(false);
    }
  };

  const handleCustomBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isImageFile(file)) {
      setMediaError('Choisissez une image PNG, JPEG ou WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMediaError("L'image ne doit pas dépasser 5 Mo.");
      return;
    }
    if (customBackgroundUrl) URL.revokeObjectURL(customBackgroundUrl);
    const objectUrl = URL.createObjectURL(file);
    setCustomBackgroundUrl(objectUrl);
    setBackgroundMode('custom');
    setMediaError('');
  };

  const handleQuit = async () => {
    stopMedia();
    await authService.logout().catch(() => undefined);
    navigate('/rejoindre-une-reunion', { replace: true });
  };

  const openDeviceSettings = (openStatusModal = false) => {
    setShowDeviceSettings(true);
    if (openStatusModal) setIsSettingsOpen(true);
    window.setTimeout(() => {
      deviceSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };

  const selectBackgroundMode = (mode: BackgroundMode) => {
    setBackgroundMode(mode);
    setMediaError('');
  };

  return (
    <main className="guest-waiting-page">
      <header className="waiting-header">
        <Link className="waiting-brand" to="/rejoindre-une-reunion" aria-label="Accueil MBotéRoom">
          <span className="waiting-brand-logo">
            <UsersRound size={27} aria-hidden="true" />
            <Video className="waiting-brand-camera" size={15} aria-hidden="true" />
          </span>
          <strong>MBoté<span>Room</span></strong>
        </Link>

        <div className="waiting-header-meeting">
          <h1>{meetingTitle}</h1>
          <span>
            <ShieldCheck size={18} aria-hidden="true" />
            {secured ? 'Réunion sécurisée' : 'Réunion standard'}
          </span>
        </div>

        <nav className="waiting-header-actions" aria-label="Actions de la réunion">
          <span className="waiting-guest-status"><UserRound size={19} aria-hidden="true" />Invité</span>
          <Link className="waiting-create-account" to="/inscription">Créer un compte</Link>
          <button className="waiting-leave-button" type="button" onClick={handleQuit}>
            <LogOut size={20} aria-hidden="true" />
            Quitter
          </button>
        </nav>
      </header>

      <div className="waiting-page-layout">
        <section className="waiting-main">
          <div className="waiting-notice">
            <span className="waiting-notice-icon">
              <Hourglass size={27} aria-hidden="true" />
              <Sparkles className="waiting-spark waiting-spark-one" size={12} aria-hidden="true" />
              <Sparkles className="waiting-spark waiting-spark-two" size={12} aria-hidden="true" />
            </span>
            <div>
              <h2>{lobbyStatus === 'rejected' ? "L'hôte a refusé votre demande." : 'Vous êtes dans la salle d’attente.'}</h2>
              <p>{lobbyStatus === 'rejected' ? 'Vous allez être redirigé vers la page de participation.' : "L'hôte vous admettra bientôt. Merci de patienter."}</p>
            </div>
          </div>

          {meetingError && <p className="waiting-error" role="alert">{meetingError}</p>}

          <div className="waiting-workspace">
            <section className={videoClassName} style={customPreviewStyle} aria-label="Aperçu vidéo">
              <span className="video-preview-badge">Aperçu vidéo</span>
              {cameraEnabled && stream?.getVideoTracks().length ? (
                <video ref={videoRef} muted playsInline autoPlay />
              ) : (
                <div className="video-disabled-state">
                  <CircleOff size={42} aria-hidden="true" />
                  <strong>Caméra désactivée</strong>
                  <span>Votre image ne sera pas partagée avant votre admission.</span>
                </div>
              )}
              {mediaError && <p className="video-error" role="alert">{mediaError}</p>}
              <span className="video-guest-label"><UserRound size={20} aria-hidden="true" />{guestName} (invité)</span>
            </section>

            <section ref={deviceSettingsRef} className={`device-settings-card${showDeviceSettings ? '' : ' is-hidden'}`} aria-labelledby="device-settings-title">
              <header>
                <h2 id="device-settings-title">Vérifiez vos paramètres</h2>
                <p>Assurez-vous que tout fonctionne correctement.</p>
                <button
                  className="device-settings-close"
                  type="button"
                  aria-label="Fermer les paramètres"
                  onClick={() => setShowDeviceSettings(false)}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </header>

              <DeviceSetting
                icon={<Mic />}
                title="Microphone"
                status={microphoneEnabled && stream?.getAudioTracks().length ? 'Le son est détecté' : 'Microphone coupé'}
                actionLabel={microphoneEnabled ? 'Désactiver le microphone' : 'Activer le microphone'}
                onAction={toggleMicrophone}
                active={microphoneEnabled}
              >
                <div className="audio-level-meter" aria-label={`Niveau sonore ${Math.round(microphoneLevel * 100)}%`}>
                  {audioBars.map((bar) => (
                    <span key={bar} className={bar < activeAudioBars ? (bar > 20 ? 'is-hot is-active' : 'is-active') : ''} />
                  ))}
                </div>
                <select value={selectedMicrophone} onChange={changeMicrophone} aria-label="Sélectionner le microphone">
                  {devices.microphones.length ? devices.microphones.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{getDeviceLabel(device, 'Microphone', index)}</option>
                  )) : <option value="">Microphone par défaut</option>}
                </select>
              </DeviceSetting>

              <DeviceSetting
                icon={<Camera />}
                title="Caméra"
                status={cameraEnabled && stream?.getVideoTracks().length ? 'Caméra activée' : 'Caméra désactivée'}
                actionLabel={cameraEnabled ? 'Désactiver la caméra' : 'Activer la caméra'}
                onAction={toggleCamera}
                active={cameraEnabled}
              >
                <select value={selectedCamera} onChange={changeCamera} aria-label="Sélectionner la caméra">
                  {devices.cameras.length ? devices.cameras.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{getDeviceLabel(device, 'Caméra', index)}</option>
                  )) : <option value="">Caméra par défaut</option>}
                </select>
              </DeviceSetting>

              <DeviceSetting
                icon={<Volume2 />}
                title="Haut-parleurs"
                status={devices.speakers.length ? 'Sortie audio détectée' : 'Sortie par défaut'}
                actionLabel="Tester les haut-parleurs"
                actionText={isTestingSpeaker ? 'Test...' : 'Tester'}
                onAction={() => void testSpeaker()}
                active
              >
                <select value={selectedSpeaker} onChange={(event) => setSelectedSpeaker(event.target.value)} aria-label="Sélectionner les haut-parleurs">
                  {devices.speakers.length ? devices.speakers.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{getDeviceLabel(device, 'Haut-parleurs', index)}</option>
                  )) : <option value="">Sortie par défaut</option>}
                </select>
              </DeviceSetting>

              <section className="background-settings" aria-label="Changer le fond">
                <h3>Changer le fond</h3>
                <div className="background-options">
                  <BackgroundButton mode="none" active={backgroundMode === 'none'} label="Aucun" icon={<CircleOff />} onClick={selectBackgroundMode} />
                  <BackgroundButton mode="blur" active={backgroundMode === 'blur'} label="Flou" icon={<MonitorUp />} onClick={selectBackgroundMode} />
                  <BackgroundButton mode="office" active={backgroundMode === 'office'} label="Bureau" icon={<ImageIcon />} onClick={selectBackgroundMode} />
                  <BackgroundButton mode="gradient" active={backgroundMode === 'gradient'} label="Dégradé bleu" icon={<Sparkles />} onClick={selectBackgroundMode} />
                  <button className={backgroundMode === 'custom' ? 'background-option background-option-custom is-active' : 'background-option background-option-custom'} type="button" aria-pressed={backgroundMode === 'custom'} onClick={() => customBackgroundUrl ? selectBackgroundMode('custom') : customBackgroundInputRef.current?.click()}>
                    <FileImage size={22} aria-hidden="true" />
                    Image
                  </button>
                </div>
                <input ref={customBackgroundInputRef} className="waiting-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCustomBackground} aria-label="Importer une image d’arrière-plan" />
              </section>
            </section>
          </div>

          {isSettingsOpen && (
            <div className="waiting-settings-modal-backdrop" role="presentation" onMouseDown={() => setIsSettingsOpen(false)}>
              <section
                className="waiting-settings-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="waiting-settings-modal-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button type="button" aria-label="Fermer" onClick={() => setIsSettingsOpen(false)}>
                  <X size={20} aria-hidden="true" />
                </button>
                <span className="waiting-settings-modal-icon" aria-hidden="true"><BadgeInfo size={27} /></span>
                <h2 id="waiting-settings-modal-title">Paramètres avancés</h2>
                <p>{mediaError || `Statut média : ${permissionStatus === 'ready' ? 'caméra et micro prêts' : permissionStatus === 'partial' ? 'accès partiel' : permissionStatus === 'checking' ? 'vérification en cours' : 'accès refusé'}.`}</p>
                {permissionStatus === 'denied' && (
                  <strong>Autorisez la caméra et le microphone dans les paramètres de votre navigateur, puis rechargez la page.</strong>
                )}
              </section>
            </div>
          )}

          <nav className="waiting-controls" aria-label="Contrôles de la salle d’attente">
            <ControlButton icon={microphoneEnabled ? <Mic /> : <CircleOff />} label="Micro" active={microphoneEnabled} onClick={() => openDeviceSettings()} />
            <ControlButton icon={cameraEnabled ? <Camera /> : <CircleOff />} label="Caméra" active={cameraEnabled} onClick={() => openDeviceSettings()} />
            <ControlButton icon={<Volume2 />} label="Tester l'audio" active onClick={() => openDeviceSettings()} />
            <ControlButton icon={<ImageIcon />} label="Arrière-plan" active={backgroundMode !== 'none'} onClick={() => openDeviceSettings()} />
            <ControlButton icon={<Settings />} label="Paramètres" active={isSettingsOpen} onClick={() => openDeviceSettings(true)} />
            <button className="waiting-controls-leave" type="button" onClick={handleQuit}>
              <LogOut size={22} aria-hidden="true" />
              Quitter
            </button>
          </nav>
        </section>

        <aside className="waiting-sidebar" aria-label="Informations de la réunion">
          <section className="meeting-information-card">
            <h2>Informations de la réunion</h2>
            <InfoRow icon={<CalendarIcon />} label="ID de réunion" value={formatMeetingId(meetingAccessId)} />
            <InfoRow icon={<UserRound />} label="Hôte" value={hostName} />
            <InfoRow icon={<ShieldCheck />} label="Sécurité" value={secured ? 'Réunion sécurisée' : 'Réunion standard'} positive={secured} />
            <InfoRow icon={<UsersRound />} label="Participants dans la réunion" value={String(participantCount)} />
          </section>

          <section className="guest-information-card">
            <BadgeInfo size={30} aria-hidden="true" />
            <div>
              <h2>En tant qu'invité</h2>
              <p>Vous pouvez participer à la réunion, mais certaines fonctionnalités peuvent être limitées : enregistrement, historique des discussions, etc.</p>
            </div>
          </section>

          <section className="premium-account-card">
            <UsersRound size={40} aria-hidden="true" />
            <h2>Profitez de toutes les fonctionnalités</h2>
            <p>Créez un compte MBotéRoom pour enregistrer vos réunions, retrouver votre historique et gérer vos invitations.</p>
            <Link to="/inscription">Créer un compte</Link>
            <Link className="premium-learn-more" to="/fonctionnalites">En savoir plus</Link>
          </section>
        </aside>
      </div>
    </main>
  );
}

function DeviceSetting({
  icon,
  title,
  status,
  actionLabel,
  actionText,
  active,
  onAction,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  actionLabel: string;
  actionText?: string;
  active: boolean;
  onAction: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="device-setting">
      <div className="device-setting-title">
        <span>{icon}</span>
        <strong>{title}</strong>
        <small className={active ? 'is-ok' : 'is-off'}>{status}</small>
        <button type="button" aria-label={actionLabel} onClick={onAction}>{actionText || icon}</button>
      </div>
      {children}
    </section>
  );
}

function BackgroundButton({ mode, label, icon, active, onClick }: { mode: BackgroundMode; label: string; icon: React.ReactNode; active: boolean; onClick: (mode: BackgroundMode) => void }) {
  return (
    <button className={`background-option background-option-${mode}${active ? ' is-active' : ''}`} type="button" onClick={() => onClick(mode)} aria-pressed={active}>
      {icon}
      {label}
    </button>
  );
}

function ControlButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'waiting-control is-active' : 'waiting-control'} type="button" onClick={onClick} aria-pressed={active}>
      <span>{icon}</span>
      {label}
    </button>
  );
}

function InfoRow({ icon, label, value, positive = false }: { icon: React.ReactNode; label: string; value: string; positive?: boolean }) {
  return (
    <div className="meeting-info-row">
      <span>{icon}</span>
      <p>{label}</p>
      <strong className={positive ? 'is-positive' : ''}>{value}</strong>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 2v3M17 2v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
