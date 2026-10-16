import { ChangeEvent, CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Camera,
  CircleOff,
  FileImage,
  Hourglass,
  LogOut,
  Mic,
  MonitorUp,
  Settings,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import { getMeetingAccessCode, Meeting, meetingService } from '../services/meetingService';
import { waitingDeviceLabel } from '../lib/waitingDevices';
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
  joinOptions?: { mic?: boolean; camera?: boolean; audioInputId?: string; videoInputId?: string };
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
  const microphoneEnabledRef = useRef(locationState?.joinOptions?.mic !== false);
  const cameraEnabledRef = useRef(locationState?.joinOptions?.camera !== false);
  const mediaRequestRef = useRef(0);
  const supportsSpeakerSelection = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingError, setMeetingError] = useState('');
  const [lobbyStatus, setLobbyStatus] = useState<LobbyStatus>('waiting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDevicesState>(initialDevices);
  const [selectedMicrophone, setSelectedMicrophone] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [microphoneEnabled, setMicrophoneEnabled] = useState(microphoneEnabledRef.current);
  const [cameraEnabled, setCameraEnabled] = useState(cameraEnabledRef.current);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('none');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState('');
  const [customBackgroundName, setCustomBackgroundName] = useState('');
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('checking');
  const [mediaError, setMediaError] = useState('');
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [isChangingDevice, setIsChangingDevice] = useState(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  const [isLeavingWaitingRoom, setIsLeavingWaitingRoom] = useState(false);

  const stopMedia = useCallback(() => {
    mediaRequestRef.current += 1;
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
    setSelectedSpeaker((currentValue) => currentValue && speakers.some(device => device.deviceId === currentValue) ? currentValue : '');
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const updateDevices = () => { void refreshDevices().catch(() => undefined); };
    navigator.mediaDevices.addEventListener('devicechange', updateDevices);
    window.addEventListener('focus', updateDevices);
    const poll = window.setInterval(() => { if (showDeviceSettings) updateDevices(); }, 5000);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', updateDevices);
      window.removeEventListener('focus', updateDevices);
      window.clearInterval(poll);
    };
  }, [refreshDevices, showDeviceSettings]);

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

  const openMedia = useCallback(async (microphoneDeviceId?: string, cameraDeviceId?: string): Promise<boolean> => {
    const requestId = ++mediaRequestRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionStatus('denied');
      setMediaError("Votre navigateur ne prend pas en charge l'accès à la caméra et au microphone.");
      return false;
    }

    setPermissionStatus('checking');
    setMediaError('');

    const audioConstraint: MediaTrackConstraints = microphoneDeviceId
      ? { deviceId: { exact: microphoneDeviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    const videoConstraint: MediaTrackConstraints = cameraDeviceId
      ? { deviceId: { exact: cameraDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
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

      if (requestId !== mediaRequestRef.current) {
        nextStream.getTracks().forEach(track => track.stop());
        return false;
      }
      if ((cameraDeviceId && !nextStream.getVideoTracks().length) || (microphoneDeviceId && !nextStream.getAudioTracks().length)) {
        nextStream.getTracks().forEach(track => track.stop());
        throw new Error('Le périphérique sélectionné est indisponible.');
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
      return true;
    } catch (error) {
      if (requestId !== mediaRequestRef.current) return false;
      setPermissionStatus(streamRef.current?.getTracks().some(track => track.readyState === 'live') ? 'partial' : 'denied');
      setMediaError(error instanceof DOMException && error.name === 'NotAllowedError'
        ? "L'accès à la caméra ou au microphone a été refusé. Autorisez les permissions dans votre navigateur."
        : error instanceof Error ? error.message : "Impossible d'accéder à vos périphériques.");
      return false;
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
        // Restore the meeting after page reload, including private invitations.
        // A numeric meeting link is not necessarily the internal database ID.
        // Always restore the exact route identifier via the same backend lookup.
        const found: Meeting | null = locationState?.meeting?.id
          ? locationState.meeting as Meeting
          : await meetingService.getMeetingByLink(meetingId);
        if (cancelled) return;
        setMeeting(found);
        if (!found) setMeetingError('Réunion introuvable ou inaccessible.');
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
    void openMedia(locationState?.joinOptions?.audioInputId, locationState?.joinOptions?.videoInputId);

    return () => {
      stopMedia();
    };
  }, [openMedia, stopMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream && cameraEnabled) void video.play().catch(() => undefined);
  }, [stream, cameraEnabled]);

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
    let statusCheckInFlight = false;
    let rejectionTimer: number | null = null;
    const applyLobbyStatus = (status?: 'accepted' | 'rejected' | 'requested') => {
      if (cancelled) return;
      if (status === 'accepted') {
        setLobbyStatus('accepted');
        stopMedia();
        navigate(`/reunions/${encodeURIComponent(String(meeting.meeting_link))}`, {
          replace: true,
          state: {
            guestName,
            meeting,
            isGuest: currentUser?.isGuest === true,
            joinOptions: {
              ...locationState?.joinOptions,
              mic: microphoneEnabledRef.current,
              camera: cameraEnabledRef.current,
              audioInputId: selectedMicrophone || locationState?.joinOptions?.audioInputId,
              videoInputId: selectedCamera || locationState?.joinOptions?.videoInputId,
              audioOutputId: supportsSpeakerSelection ? selectedSpeaker : '',
              background: backgroundMode !== 'none',
              backgroundUrl: customBackgroundUrl || undefined,
            },
          },
        });
        return;
      }
      if (status === 'rejected') {
        setLobbyStatus('rejected');
        stopMedia();
        if (rejectionTimer !== null) window.clearTimeout(rejectionTimer);
        rejectionTimer = window.setTimeout(() => navigate('/rejoindre-une-reunion', { replace: true }), 1800);
        return;
      }
      setLobbyStatus('waiting');
    };

    const checkLobby = async () => {
      // Slow mobile connections must not start overlapping polling requests.
      // Unlike latest-only sequence filtering, this cannot starve every response
      // when the server takes longer than the three-second polling interval.
      if (cancelled || statusCheckInFlight) return;
      statusCheckInFlight = true;
      try {
        const access = await meetingService.getMyMeetingStatus(meeting.id);
        if (cancelled) return;
        setMeetingError('');
        if (access.status === 'ended') {
          setLobbyStatus('ended');
          stopMedia();
          navigate(`/reunions/${encodeURIComponent(meeting.meeting_link)}/terminee`, { replace: true, state: { meeting } });
        } else if (access.status === 'removed') {
          applyLobbyStatus('rejected');
        } else if (access.status === 'left') {
          setMeetingError('Votre demande n’est plus en attente. Quittez cette page et effectuez une nouvelle demande.');
        } else {
          applyLobbyStatus(access.status === 'accepted' ? 'accepted' : 'requested');
        }
      } catch (error) {
        if (!cancelled) setMeetingError(error instanceof Error
          ? error.message
          : 'Vérification de votre accès indisponible. Nouvelle tentative automatique…');
      } finally {
        statusCheckInFlight = false;
      }
    };

    const onLobbyStatus = (payload: { meetingId?: number; status?: 'accepted' | 'rejected' | 'requested' }) => {
      if (Number(payload?.meetingId || 0) !== Number(meeting.id)) return;
      // Socket events are notifications, not admission credentials. Verify the
      // current database decision before entering the media room.
      void checkLobby();
    };

    const legacyToken = authService.getToken();
    socket.auth = legacyToken ? { token: legacyToken } : {};
    socket.on('meeting:lobby-status', onLobbyStatus);
    if (!socket.connected) socket.connect();

    void checkLobby();
    const intervalId = window.setInterval(checkLobby, 3000);
    return () => {
      cancelled = true;
      socket.off('meeting:lobby-status', onLobbyStatus);
      window.clearInterval(intervalId);
      if (rejectionTimer !== null) window.clearTimeout(rejectionTimer);
    };
  }, [backgroundMode, currentUser?.id, currentUser?.isGuest, customBackgroundUrl, guestName, meeting, navigate, stopMedia, selectedMicrophone, selectedCamera, locationState?.joinOptions]);

  useEffect(() => {
    return () => {
      if (customBackgroundUrl) URL.revokeObjectURL(customBackgroundUrl);
    };
  }, [customBackgroundUrl]);

  const meetingTitle = meeting?.title || 'Réunion MBotéRoom';
  const meetingAccessId = meeting ? getMeetingAccessCode(meeting) : String(locationState?.meetingId || meetingId);
  const hostName = meeting?.host_name || 'Hôte MBotéRoom';
  const secured = meeting?.settings?.encryption !== false;
  const micAvailable = Boolean(stream?.getAudioTracks().some(track => track.readyState === 'live'));
  const cameraAvailable = Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live'));
  const videoClassName = ['waiting-video-preview', `background-${backgroundMode}`, cameraEnabled && cameraAvailable ? '' : 'is-camera-off'].filter(Boolean).join(' ');
  const customPreviewStyle = customBackgroundUrl ? ({ '--waiting-room-background': `url("${customBackgroundUrl}")` } as CSSProperties) : undefined;

  const toggleMicrophone = () => {
    if (!micAvailable) {
      void changeDevice('audio', selectedMicrophone || devices.microphones[0]?.deviceId || '');
      return;
    }
    const nextValue = !microphoneEnabled;
    microphoneEnabledRef.current = nextValue;
    setMicrophoneEnabled(nextValue);
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = nextValue; });
  };

  const toggleCamera = () => {
    if (!cameraAvailable) {
      void changeDevice('video', selectedCamera || devices.cameras[0]?.deviceId || '');
      return;
    }
    const nextValue = !cameraEnabled;
    cameraEnabledRef.current = nextValue;
    setCameraEnabled(nextValue);
    streamRef.current?.getVideoTracks().forEach(track => { track.enabled = nextValue; });
  };

  const changeDevice = async (kind: 'audio' | 'video', deviceId: string) => {
    if (isChangingDevice || !navigator.mediaDevices?.getUserMedia) return;
    const currentStream = streamRef.current;
    if (!currentStream) {
      void openMedia(kind === 'audio' ? deviceId : undefined, kind === 'video' ? deviceId : undefined);
      return;
    }
    setIsChangingDevice(true);
    setMediaError('');
    const previous = kind === 'video' ? currentStream.getVideoTracks()[0] : currentStream.getAudioTracks()[0];
    const previousId = previous?.getSettings().deviceId || '';
    const otherTracks = currentStream.getTracks().filter(track => track.kind !== kind && track.readyState === 'live');
    // Stop the old track first: several Android devices cannot open two cameras simultaneously.
    previous?.stop();
    const request = kind === 'video'
      ? { audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }), width: { ideal: 1280 }, height: { ideal: 720 } } }
      : { audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true }, video: false };
    try {
      const acquired = await navigator.mediaDevices.getUserMedia(request);
      const track = kind === 'video' ? acquired.getVideoTracks()[0] : acquired.getAudioTracks()[0];
      if (!track) {
        acquired.getTracks().forEach(item => item.stop());
        throw new Error('Périphérique indisponible.');
      }
      if (currentStream !== streamRef.current) {
        acquired.getTracks().forEach(item => item.stop());
        return;
      }
      track.enabled = kind === 'video' ? cameraEnabledRef.current : microphoneEnabledRef.current;
      const updated = new MediaStream([...otherTracks, track]);
      streamRef.current = updated;
      setStream(updated);
      if (kind === 'video') setSelectedCamera(track.getSettings().deviceId || deviceId);
      else setSelectedMicrophone(track.getSettings().deviceId || deviceId);
      setPermissionStatus(updated.getAudioTracks().length && updated.getVideoTracks().length ? 'ready' : 'partial');
      await refreshDevices();
    } catch {
      if (currentStream !== streamRef.current) return;
      // Restore the previous device if Android refuses the new one.
      try {
        const recovered = await navigator.mediaDevices.getUserMedia(kind === 'video'
          ? { audio: false, video: previousId ? { deviceId: { ideal: previousId } } : true }
          : { audio: previousId ? { deviceId: { ideal: previousId } } : true, video: false });
        const restored = kind === 'video' ? recovered.getVideoTracks()[0] : recovered.getAudioTracks()[0];
        if (restored && currentStream === streamRef.current) {
          restored.enabled = kind === 'video' ? cameraEnabledRef.current : microphoneEnabledRef.current;
          const updated = new MediaStream([...otherTracks, restored]);
          streamRef.current = updated;
          setStream(updated);
        } else recovered.getTracks().forEach(track => track.stop());
      } catch { /* Keep any remaining live tracks. */ }
      setMediaError('Impossible de changer ce périphérique. Vérifiez les autorisations.');
    } finally {
      setIsChangingDevice(false);
    }
  };

  const changeMicrophone = (event: ChangeEvent<HTMLSelectElement>) => {
    void changeDevice('audio', event.target.value);
  };

  const changeCamera = (event: ChangeEvent<HTMLSelectElement>) => {
    void changeDevice('video', event.target.value);
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
      if (selectedSpeaker) {
        if (!outputElement.setSinkId) throw new Error('Sélection de sortie audio indisponible.');
        await outputElement.setSinkId(selectedSpeaker);
      }
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
    setCustomBackgroundName(file.name);
    setBackgroundMode('custom');
    setMediaError('');
  };

  const handleQuit = async () => {
    if (isLeavingWaitingRoom) return;
    setIsLeavingWaitingRoom(true);
    try {
      if (meeting?.id) {
        await meetingService.cancelLobbyRequest(meeting.id);
      }
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : 'Impossible d’annuler la demande pour le moment.');
      setIsLeavingWaitingRoom(false);
      return;
    }

    stopMedia();
    if (currentUser?.isGuest) {
      sessionStorage.removeItem('mboteroom-guest-meeting-link');
      await authService.logout().catch(() => undefined);
    }
    navigate(currentUser?.isGuest ? '/rejoindre-une-reunion' : '/app/meetings', { replace: true });
  };

  const openDeviceSettings = () => {
    setShowDeviceSettings((current) => !current);
    window.setTimeout(() => {
      deviceSettingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };

  const selectBackgroundMode = (mode: BackgroundMode) => {
    setBackgroundMode(mode);
    setMediaError('');
  };

  return (
    <main className="guest-waiting-page waiting-simple-page">
      <section className="waiting-simple-card" aria-labelledby="waiting-room-title">
        <div className="waiting-simple-heading">
          <span className="waiting-simple-logo" aria-hidden="true"><img src="/icons/mboteroom-symbol.png" alt="" /></span>
          <div>
            <p className="waiting-simple-kicker">Salle d’attente</p>
            <h1 id="waiting-room-title">{meetingTitle}</h1>
            <span className="waiting-simple-host">Hôte : {hostName}</span>
          </div>
          <span className="waiting-simple-security"><ShieldCheck size={16} aria-hidden="true" />{secured ? 'Sécurisée' : 'Standard'}</span>
        </div>

        <div className={lobbyStatus === 'rejected' ? 'waiting-simple-status is-rejected' : 'waiting-simple-status'}>
          <span><Hourglass size={20} aria-hidden="true" /></span>
          <div>
            <strong>{lobbyStatus === 'rejected' ? 'Demande refusée' : lobbyStatus === 'ended' ? 'Réunion terminée' : 'En attente de l’hôte'}</strong>
            <p>{lobbyStatus === 'rejected'
              ? 'Vous allez être redirigé.'
              : lobbyStatus === 'ended' ? 'La réunion a été clôturée.'
              : 'Votre demande a été envoyée. Vous entrerez automatiquement dès que l’hôte vous admettra.'}</p>
          </div>
        </div>

        {meetingError ? <p className="waiting-error" role="alert">{meetingError}</p> : null}

        <section className={videoClassName + ' waiting-simple-preview'} style={customPreviewStyle} aria-label="Aperçu vidéo">
          <video ref={videoRef} muted playsInline autoPlay hidden={!cameraEnabled || !cameraAvailable} aria-hidden="true" />
          {!cameraEnabled || !cameraAvailable ? (
            <div className="video-disabled-state">
              <CircleOff size={40} aria-hidden="true" />
              <strong>{cameraAvailable ? 'Caméra désactivée' : permissionStatus === 'checking' ? 'Connexion de la caméra…' : 'Caméra indisponible'}</strong>
              <span>{cameraAvailable ? 'Vous pouvez rejoindre la réunion sans caméra.' : 'Vérifiez les autorisations ou choisissez une autre caméra.'}</span>
            </div>
          ) : null}
          <span className="waiting-simple-name">{guestName}</span>
          {mediaError ? <p className="video-error" role="alert">{mediaError}</p> : null}
        </section>

        <div className="waiting-simple-controls" aria-label="Contrôles avant la réunion">
          <button type="button" className={microphoneEnabled && micAvailable ? 'is-active' : ''} onClick={toggleMicrophone} disabled={permissionStatus === 'checking' || isChangingDevice} aria-pressed={microphoneEnabled && micAvailable}>
            {microphoneEnabled ? <Mic size={20}/> : <CircleOff size={20}/>}
            <span>{!micAvailable ? 'Activer le micro' : microphoneEnabled ? 'Micro activé' : 'Micro coupé'}</span>
          </button>
          <button type="button" className={cameraEnabled && cameraAvailable ? 'is-active' : ''} onClick={toggleCamera} disabled={permissionStatus === 'checking' || isChangingDevice} aria-pressed={cameraEnabled && cameraAvailable}>
            {cameraEnabled ? <Camera size={20}/> : <CircleOff size={20}/>}
            <span>{!cameraAvailable ? 'Activer la caméra' : cameraEnabled ? 'Caméra activée' : 'Caméra coupée'}</span>
          </button>
          <button type="button" className={showDeviceSettings ? 'is-active' : ''} onClick={openDeviceSettings}>
            <Settings size={20}/>
            <span>Paramètres</span>
          </button>
        </div>

        {showDeviceSettings ? (
          <section ref={deviceSettingsRef} className="waiting-simple-settings" aria-label="Paramètres audio et vidéo">
            <div className="waiting-simple-setting-row">
              <label>
                <span><Mic size={17}/> Microphone</span>
                <select value={selectedMicrophone} onChange={changeMicrophone} aria-label="Sélectionner le microphone">
                  {devices.microphones.length ? devices.microphones.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>{waitingDeviceLabel('audioinput', device.label, index)}</option>
                  )) : <option value="">Microphone par défaut</option>}
                </select>
              </label>
              <div className="waiting-simple-meter" aria-label={`Niveau sonore ${Math.round(microphoneLevel * 100)}%`}>
                {audioBars.slice(0,12).map((bar) => <span key={bar} className={bar < Math.round(microphoneLevel * 12) ? 'is-active' : ''}/>)}
              </div>
            </div>

            <label className="waiting-simple-setting-row">
              <span><Camera size={17}/> Caméra</span>
              <select value={selectedCamera} onChange={changeCamera} aria-label="Sélectionner la caméra">
                {devices.cameras.length ? devices.cameras.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>{waitingDeviceLabel('videoinput', device.label, index)}</option>
                )) : <option value="">Caméra par défaut</option>}
              </select>
            </label>

            <div className="waiting-simple-setting-row waiting-simple-audio-test">
              <div><span><Volume2 size={17}/> Haut-parleurs</span><small>{devices.speakers.length ? 'Sortie détectée' : 'Sortie par défaut'}</small></div>
              <select aria-label="Choisir la sortie audio connectée" value={selectedSpeaker} onChange={(event) => { setSelectedSpeaker(event.target.value); setMediaError(''); }} disabled={!supportsSpeakerSelection}>
                <option value="">Sortie audio système</option>
                {devices.speakers.filter((device)=>device.deviceId && device.deviceId !== 'default').map((device,index)=>(
                  <option key={device.deviceId} value={device.deviceId}>{waitingDeviceLabel('audiooutput',device.label,index)}</option>
                ))}
              </select>
              <button type="button" onClick={() => void testSpeaker()} disabled={isTestingSpeaker}>{isTestingSpeaker ? 'Test en cours…' : 'Tester le son'}</button>
              {!supportsSpeakerSelection ? <small className="waiting-audio-note">Le navigateur utilise la sortie audio du téléphone. Changez-la dans les paramètres Android.</small> : null}
            </div>

            <div className="waiting-simple-backgrounds">
              <span>Arrière-plan</span>
              <div>
                <BackgroundButton mode="none" active={backgroundMode === 'none'} label="Aucun" icon={<CircleOff />} onClick={selectBackgroundMode} />
                <BackgroundButton mode="blur" active={backgroundMode === 'blur'} label="Flou" icon={<MonitorUp />} onClick={selectBackgroundMode} />
                <BackgroundButton mode="gradient" active={backgroundMode === 'gradient'} label="Dégradé" icon={<Sparkles />} onClick={selectBackgroundMode} />
                <button className={backgroundMode === 'custom' ? 'background-option background-option-custom is-active' : 'background-option background-option-custom'} type="button" onClick={() => customBackgroundInputRef.current?.click()} aria-pressed={backgroundMode === 'custom'}>
                  <FileImage size={18}/> {customBackgroundUrl ? 'Image choisie' : 'Image'}
                </button>
              </div>
              {customBackgroundName ? <small className="waiting-background-filename">Image sélectionnée : {customBackgroundName}</small> : null}
              <small className="waiting-background-note">Effets visibles dans l’aperçu uniquement : le remplacement de fond n’est pas encore appliqué au flux diffusé.</small>
              <input ref={customBackgroundInputRef} className="waiting-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleCustomBackground} />
            </div>
          </section>
        ) : null}

        <div className="waiting-simple-footer">
          <div className="waiting-simple-id">
            <span>ID</span>
            <strong>{formatMeetingId(meetingAccessId)}</strong>
          </div>
          <button type="button" className="waiting-simple-exit" onClick={() => setConfirmExitOpen(true)} disabled={isLeavingWaitingRoom}>
            <LogOut size={18}/>
            Annuler et sortir
          </button>
        </div>
      </section>

      {confirmExitOpen ? (
        <div className="waiting-simple-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isLeavingWaitingRoom) setConfirmExitOpen(false); }}>
          <section className="waiting-simple-modal" role="dialog" aria-modal="true" aria-labelledby="waiting-exit-title">
            <h2 id="waiting-exit-title">Quitter la salle d’attente ?</h2>
            <p>Votre demande pour rejoindre cette réunion sera annulée.</p>
            <div>
              <button type="button" className="secondary" disabled={isLeavingWaitingRoom} onClick={() => setConfirmExitOpen(false)}>Rester</button>
              <button type="button" className="danger" disabled={isLeavingWaitingRoom} onClick={() => void handleQuit()}>{isLeavingWaitingRoom ? 'Sortie…' : 'Quitter'}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
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

