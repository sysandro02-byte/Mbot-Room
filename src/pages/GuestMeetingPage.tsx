import { ChangeEvent, FormEvent, ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AudioLines,
  BadgeInfo,
  Bot,
  CalendarDays,
  Camera,
  CameraOff,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clipboard,
  Download,
  FileText,
  Info,
  Languages,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  PhoneOff,
  ScreenShare,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  Video,
  Volume2,
  X,
  Hand,
} from 'lucide-react';
import { useMeetingMeshWebRTC, RemoteMeetingParticipant } from '../hooks/useMeetingMeshWebRTC';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import { getMeetingAccessCode, LobbyParticipant, Meeting, meetingService } from '../services/meetingService';
import './GuestMeetingPage.css';

type MeetingPanel = 'participants' | 'chat' | 'settings' | null;

type LunaStatus = 'listening' | 'disabled' | 'loading' | 'error';

type JoinOptions = {
  mic?: boolean;
  camera?: boolean;
  background?: boolean;
  backgroundUrl?: string;
};

type MeetingLocationState = {
  guestName?: string;
  meeting?: Partial<Meeting>;
  joinOptions?: JoinOptions;
  isGuest?: boolean;
};

type LocalMessage = {
  id: string;
  userId?: string;
  sender: string;
  text: string;
  time: string;
};

type RealtimeChatMessage = {
  id?: string;
  meetingId?: string;
  userId?: string | number;
  sender?: string;
  text?: string;
  time?: string;
};

type RealtimeHandRaised = {
  meetingId?: string;
  userId?: string | number;
  name?: string;
  raised?: boolean;
};

type MediaErrorKind =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'device-lost'
  | 'insecure-context'
  | 'unsupported'
  | 'unknown';

type MediaErrorInfo = {
  kind: MediaErrorKind;
  title: string;
  detail: string;
};

type TileMenuState = {
  id: string;
  self: boolean;
  name: string;
} | null;

type LunaSummary = {
  updatedAt: string;
  liveSummary: string;
  keyPoints: string[];
  decisions: string[];
  actions: Array<{
    id: string;
    assignee: string;
    task: string;
    dueDate: string;
  }>;
  nextMeeting: {
    title: string;
    date: string;
  };
};

const emptyLunaSummary: LunaSummary = {
  updatedAt: 'En attente',
  liveSummary: 'Luna IA attend suffisamment de contexte de réunion pour produire un résumé fiable.',
  keyPoints: [],
  decisions: [],
  actions: [],
  nextMeeting: {
    title: 'À planifier',
    date: 'Date à confirmer',
  },
};

const getInitials = (name: string) =>
  String(name || 'MBotéRoom')
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

const getCurrentTime = () => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());

const getMediaErrorInfo = (error: unknown): MediaErrorInfo => {
  if (window.isSecureContext === false) {
    return {
      kind: 'insecure-context',
      title: 'Connexion non sécurisée',
      detail: 'La caméra et le microphone nécessitent HTTPS ou localhost.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      kind: 'unsupported',
      title: 'Navigateur non compatible',
      detail: 'Ce navigateur ne prend pas en charge les périphériques audio ou vidéo.',
    };
  }
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'permission-denied',
      title: 'Permission refusée',
      detail: 'Autorisez la caméra et le microphone dans votre navigateur, puis réessayez.',
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'no-device',
      title: 'Aucun périphérique détecté',
      detail: 'Aucun microphone ou aucune caméra utilisable n’a été détecté.',
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return {
      kind: 'device-busy',
      title: 'Périphérique occupé',
      detail: 'Fermez les autres applications qui utilisent votre caméra ou votre micro.',
    };
  }
  return {
    kind: 'unknown',
    title: 'Média indisponible',
    detail: 'Impossible d’ouvrir vos périphériques audio ou vidéo.',
  };
};

const extractBulletLines = (text: string) =>
  text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter((line) => line.length > 18)
    .slice(0, 4);

const buildLunaCopyText = (summary: LunaSummary) => [
  'Résumé Luna IA',
  '',
  summary.liveSummary,
  '',
  'Points clés',
  ...summary.keyPoints.map((point) => `- ${point}`),
  '',
  'Décisions',
  ...summary.decisions.map((decision) => `- ${decision}`),
  '',
  'Actions',
  ...summary.actions.map((action) => `- ${action.assignee} : ${action.task} (${action.dueDate})`),
  '',
  `Prochaine réunion : ${summary.nextMeeting.title} - ${summary.nextMeeting.date}`,
].join('\n');

export default function GuestMeetingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { meetingId = '' } = useParams();
  const locationState = location.state as MeetingLocationState | null;
  const currentUser = authService.getCurrentUser();
  const joinOptions = locationState?.joinOptions || {};
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const microphoneEnabledRef = useRef(joinOptions.mic !== false);
  const cameraEnabledRef = useRef(joinOptions.camera !== false);
  const isLunaRoute = location.pathname.endsWith('/luna');
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [lobby, setLobby] = useState<LobbyParticipant[]>([]);
  const [isLoadingMeeting, setIsLoadingMeeting] = useState(true);
  const [meetingError, setMeetingError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<MediaErrorInfo | null>(null);
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfo[]>([]);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(joinOptions.mic !== false);
  const [cameraEnabled, setCameraEnabled] = useState(joinOptions.camera !== false);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [handRaised, setHandRaised] = useState(false);
  const [activePanel, setActivePanel] = useState<MeetingPanel>(null);
  const [showGuestBanner, setShowGuestBanner] = useState(true);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [tileMenu, setTileMenu] = useState<TileMenuState>(null);
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);
  const [hideLocalPreview, setHideLocalPreview] = useState(false);
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>(() => [{
    id: 'system-welcome',
    sender: 'MBotéRoom',
    text: 'Vous êtes entré dans la réunion en tant qu’invité.',
    time: getCurrentTime(),
  }]);
  const [messageDraft, setMessageDraft] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [lunaVisible, setLunaVisible] = useState(isLunaRoute);
  const [lunaReduced, setLunaReduced] = useState(false);
  const [lunaSummary, setLunaSummary] = useState<LunaSummary>(emptyLunaSummary);
  const [lunaStatus, setLunaStatus] = useState<LunaStatus>('loading');
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [settings, setSettings] = useState({
    noiseReduction: true,
    mirrorVideo: true,
    showNames: true,
    lunaSummary: true,
  });

  const localName = locationState?.guestName?.trim()
    || currentUser?.name
    || currentUser?.username
    || currentUser?.email
    || 'Invité MBotéRoom';
  const localUserId = String(currentUser?.id || '');
  const mediaState = useMemo(() => ({
    audio: microphoneEnabled && Boolean(localStream?.getAudioTracks().length),
    video: cameraEnabled && Boolean(localStream?.getVideoTracks().length),
    screen: isSharingScreen,
  }), [cameraEnabled, isSharingScreen, localStream, microphoneEnabled]);

  const { remoteParticipants } = useMeetingMeshWebRTC({
    meetingId: meeting?.id || 0,
    localUserId,
    localName,
    localAvatar: currentUser?.avatar || '',
    localStream,
    media: mediaState,
    enabled: Boolean(meeting?.id && localUserId && authService.isAuthenticated()),
    onNotice: setNotice,
  });

  const guestBannerStorageKey = useMemo(
    () => `mboteroom.guest-banner.dismissed.${meeting?.id || meetingId || 'unknown'}`,
    [meeting?.id, meetingId],
  );

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setMicrophoneLevel(0);
  }, []);

  const refreshAvailableDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setAvailableDevices([]);
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    setAvailableDevices(devices);
  }, []);

  const dismissGuestBanner = () => {
    sessionStorage.setItem(guestBannerStorageKey, 'true');
    setShowGuestBanner(false);
  };

  useEffect(() => {
    if (!authService.isAuthenticated()) {
      navigate('/rejoindre-une-reunion', { replace: true });
      return;
    }

    let cancelled = false;
    const loadMeeting = async () => {
      setIsLoadingMeeting(true);
      setMeetingError('');
      try {
        let found: Meeting | null = null;
        if (!/^\d+$/.test(meetingId)) {
          found = await meetingService.getMeetingByLink(meetingId);
        } else {
          const meetings = await meetingService.getMeetings();
          found = meetings.find((item) => (
            String(item.id) === String(meetingId)
            || String(item.meeting_link) === String(meetingId)
            || getMeetingAccessCode(item) === String(meetingId).toUpperCase()
          )) || null;
        }
        if (!found && locationState?.meeting?.id) {
          found = locationState.meeting as Meeting;
        }
        if (!found) throw new Error('Réunion introuvable ou accès non autorisé.');
        if (cancelled) return;
        setMeeting(found);

        const lobbyRows = await meetingService.getLobby(found.id).catch(() => []);
        if (cancelled) return;
        setLobby(lobbyRows);
        const currentLobbyRow = lobbyRows.find((row) => String(row.user_id) === String(currentUser?.id || ''));
        if (currentUser?.isGuest && currentLobbyRow?.status === 'requested') {
          navigate(`/reunions/${encodeURIComponent(String(found.id))}/salle-attente`, {
            replace: true,
            state: location.state,
          });
          return;
        }
        if (currentUser?.isGuest && currentLobbyRow?.status === 'rejected') {
          await authService.logout(false);
          navigate('/rejoindre-une-reunion', { replace: true });
          return;
        }
        if (currentUser?.isGuest && !currentLobbyRow) {
          navigate('/rejoindre-une-reunion', { replace: true });
        }
      } catch (error) {
        if (!cancelled) setMeetingError(error instanceof Error ? error.message : 'Impossible de charger la réunion.');
      } finally {
        if (!cancelled) setIsLoadingMeeting(false);
      }
    };

    void loadMeeting();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.isGuest, location.state, locationState?.meeting, meetingId, navigate]);

  useEffect(() => {
    setShowGuestBanner(sessionStorage.getItem(guestBannerStorageKey) !== 'true');
  }, [guestBannerStorageKey]);

  useEffect(() => {
    void refreshAvailableDevices();
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => {
      void refreshAvailableDevices();
      if (localStreamRef.current && localStreamRef.current.getTracks().some((track) => track.readyState === 'ended')) {
        setMediaError({
          kind: 'device-lost',
          title: 'Périphérique déconnecté',
          detail: 'Un périphérique audio ou vidéo a été retiré pendant la réunion.',
        });
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshAvailableDevices]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('.guest-tile-menu-wrap')) setTileMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTileMenu(null);
        setLeaveConfirmOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError(getMediaErrorInfo(new DOMException('Unsupported', 'NotSupportedError')));
      return undefined;
    }

    let cancelled = false;
    const openMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: settings.noiseReduction,
            autoGainControl: true,
          },
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream.getAudioTracks().forEach((track) => {
          track.enabled = microphoneEnabledRef.current;
        });
        stream.getVideoTracks().forEach((track) => {
          track.enabled = cameraEnabledRef.current;
        });

        localStreamRef.current = stream;
        setLocalStream(stream);
        setMediaError(null);
        void refreshAvailableDevices();
      } catch (error) {
        setMediaError(getMediaErrorInfo(error));
        setMicrophoneEnabled(false);
        setCameraEnabled(false);
        microphoneEnabledRef.current = false;
        cameraEnabledRef.current = false;
      }
    };

    void openMedia();

    return () => {
      cancelled = true;
      stopLocalMedia();
    };
  }, [refreshAvailableDevices, settings.noiseReduction, stopLocalMedia]);

  useEffect(() => {
    if (!localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream;
    void localVideoRef.current.play().catch(() => undefined);
  }, [localStream]);

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!localStream || !microphoneEnabled || !localStream.getAudioTracks().length) {
      setMicrophoneLevel(0);
      return undefined;
    }

    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return undefined;
    const context = new AudioContextCtor();
    const source = context.createMediaStreamSource(new MediaStream(localStream.getAudioTracks()));
    const analyser = context.createAnalyser();
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frameId = 0;

    analyser.fftSize = 256;
    source.connect(analyser);

    const updateLevel = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / Math.max(1, data.length);
      setMicrophoneLevel(Math.min(1, average / 110));
      frameId = window.requestAnimationFrame(updateLevel);
    };
    updateLevel();

    return () => {
      window.cancelAnimationFrame(frameId);
      source.disconnect();
      void context.close().catch(() => undefined);
    };
  }, [localStream, microphoneEnabled]);

  const acceptedLobby = useMemo(
    () => lobby.filter((participant) => participant.status === 'accepted'),
    [lobby],
  );
  const participantCount = Math.max(1, new Set([
    localUserId,
    meeting?.host_id ? String(meeting.host_id) : '',
    ...remoteParticipants.map((participant) => participant.userId),
    ...acceptedLobby.map((participant) => String(participant.user_id)),
  ].filter(Boolean)).size);
  const hostName = meeting?.host_name || 'Hôte MBotéRoom';
  const secureMeeting = meeting?.settings?.encryption !== false;
  const meetingAccessId = meeting ? formatMeetingId(getMeetingAccessCode(meeting)) : formatMeetingId(meetingId);
  const localIsActiveSpeaker = microphoneEnabled && microphoneLevel > 0.12;
  const sortedRemoteParticipants = useMemo(() => {
    const pinned = pinnedParticipantId
      ? remoteParticipants.find((participant) => participant.socketId === pinnedParticipantId || participant.userId === pinnedParticipantId)
      : null;
    const rest = remoteParticipants.filter((participant) => participant.socketId !== pinned?.socketId);
    return pinned ? [pinned, ...rest] : rest;
  }, [pinnedParticipantId, remoteParticipants]);
  const primaryParticipant = sortedRemoteParticipants.find((participant) => participant.userId === String(meeting?.host_id || '')) || sortedRemoteParticipants[0];
  const secondaryParticipants = sortedRemoteParticipants.filter((participant) => participant.socketId !== primaryParticipant?.socketId);
  const gridParticipantCount = 1 + secondaryParticipants.length + (hideLocalPreview ? 0 : 1);

  useEffect(() => {
    if (!meeting?.id) return undefined;

    const handleChatMessage = (payload: RealtimeChatMessage) => {
      const text = String(payload.text || '').trim();
      if (!text) return;
      setMessages((currentMessages) => {
        const id = String(payload.id || `${Date.now()}-${currentMessages.length}`);
        if (currentMessages.some((message) => message.id === id)) return currentMessages;
        return [...currentMessages, {
          id,
          userId: payload.userId ? String(payload.userId) : undefined,
          sender: String(payload.sender || 'Participant'),
          text,
          time: payload.time ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(payload.time)) : getCurrentTime(),
        }];
      });
    };

    const handleHandRaised = (payload: RealtimeHandRaised) => {
      if (String(payload.userId || '') === localUserId) return;
      const participantName = String(payload.name || 'Un participant');
      setNotice(payload.raised ? `${participantName} a levé la main.` : `${participantName} a baissé la main.`);
    };

    socket.on('meeting:chat-message', handleChatMessage);
    socket.on('meeting:hand-raised', handleHandRaised);
    return () => {
      socket.off('meeting:chat-message', handleChatMessage);
      socket.off('meeting:hand-raised', handleHandRaised);
    };
  }, [localUserId, meeting?.id]);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timeoutId = window.setTimeout(() => setToastMessage(''), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  useEffect(() => {
    if (!meeting?.id || !lunaVisible || !settings.lunaSummary) {
      setLunaStatus(settings.lunaSummary ? 'disabled' : 'disabled');
      return undefined;
    }

    let cancelled = false;
    const loadLunaSummary = async () => {
      setLunaStatus('loading');
      const participantNames = [
        hostName,
        localName,
        ...remoteParticipants.map((participant) => participant.name),
        ...acceptedLobby.map((participant) => participant.name),
      ].filter((name, index, all) => name && all.indexOf(name) === index);
      const chatContext = messages
        .slice(-8)
        .map((message) => `${message.sender}: ${message.text}`)
        .join('\n');
      const prompt = [
        `Génère un résumé de réunion concis pour "${meeting.title}".`,
        `Hôte: ${hostName}.`,
        `Participants: ${participantNames.join(', ') || 'non renseignés'}.`,
        chatContext ? `Messages récents:\n${chatContext}` : 'Aucune transcription persistante n’est encore disponible.',
        'Réponds en français avec un résumé, des points clés, des décisions et des actions si elles sont explicitement présentes.',
      ].join('\n\n');

      try {
        const result = await meetingService.askLuna(meeting.id, prompt, 'professional');
        if (cancelled) return;
        const answer = result.answer.trim();
        const bullets = extractBulletLines(answer);
        setLunaSummary({
          updatedAt: getCurrentTime(),
          liveSummary: answer || emptyLunaSummary.liveSummary,
          keyPoints: bullets,
          decisions: bullets.filter((line) => /valid|décid|prioris|act/i.test(line)).slice(0, 3),
          actions: bullets
            .filter((line) => /faire|finalis|prépar|optimis|assign|action/i.test(line))
            .slice(0, 3)
            .map((line, index) => ({
              id: `luna-action-${index}`,
              assignee: participantNames[index % Math.max(1, participantNames.length)] || 'Participant',
              task: line,
              dueDate: 'À confirmer',
            })),
          nextMeeting: {
            title: meeting.title,
            date: meeting.start_time
              ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meeting.start_time))
              : 'Date à confirmer',
          },
        });
        setLunaStatus(result.configured === false ? 'disabled' : 'listening');
      } catch (error) {
        if (!cancelled) {
          setLunaStatus('error');
          setToastMessage(error instanceof Error ? error.message : 'Luna IA est indisponible pour le moment.');
        }
      }
    };

    void loadLunaSummary();
    return () => {
      cancelled = true;
    };
  }, [acceptedLobby, hostName, localName, lunaVisible, meeting, messages, remoteParticipants, settings.lunaSummary]);

  const toggleMicrophone = () => {
    const nextValue = !microphoneEnabled;
    microphoneEnabledRef.current = nextValue;
    setMicrophoneEnabled(nextValue);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = nextValue;
    });
  };

  const toggleCamera = () => {
    const nextValue = !cameraEnabled;
    cameraEnabledRef.current = nextValue;
    setCameraEnabled(nextValue);
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = nextValue;
    });
  };

  const retryMedia = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError(getMediaErrorInfo(new DOMException('Unsupported', 'NotSupportedError')));
      return;
    }
    try {
      stopLocalMedia();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: settings.noiseReduction,
          autoGainControl: true,
        },
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
      });
      microphoneEnabledRef.current = true;
      cameraEnabledRef.current = true;
      stream.getTracks().forEach((track) => {
        track.enabled = true;
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMicrophoneEnabled(true);
      setCameraEnabled(true);
      setMediaError(null);
      void refreshAvailableDevices();
    } catch (error) {
      setMediaError(getMediaErrorInfo(error));
    }
  };

  const continueWithoutCamera = () => {
    cameraEnabledRef.current = false;
    setCameraEnabled(false);
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = false;
    });
    setMediaError(null);
  };

  const continueWithoutMicrophone = () => {
    microphoneEnabledRef.current = false;
    setMicrophoneEnabled(false);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    setMediaError(null);
  };

  const toggleHandRaised = () => {
    const nextValue = !handRaised;
    setHandRaised(nextValue);
    if (meeting?.id) {
      socket.emit('meeting:hand-raised', { meetingId: meeting.id, raised: nextValue });
    }
  };

  const copyMeetingLink = async () => {
    const url = `${window.location.origin}/reunions/${encodeURIComponent(String(meeting?.id || meetingId))}/luna`;
    try {
      await navigator.clipboard.writeText(url);
      setToastMessage('Le lien de la réunion a été copié.');
    } catch {
      setToastMessage('Impossible de copier le lien depuis ce navigateur.');
    }
  };

  const copyLunaSummary = async () => {
    try {
      await navigator.clipboard.writeText(buildLunaCopyText(lunaSummary));
      setToastMessage('Le résumé Luna IA a été copié.');
    } catch {
      setToastMessage('Impossible de copier le résumé.');
    }
  };

  const exportLunaSummary = (format: 'txt' | 'json') => {
    const content = format === 'json' ? JSON.stringify(lunaSummary, null, 2) : buildLunaCopyText(lunaSummary);
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `resume-luna-${meeting?.id || meetingId}.${format}`;
    link.click();
    URL.revokeObjectURL(objectUrl);
    setToastMessage(`Export ${format.toUpperCase()} préparé.`);
  };

  const translateLunaSummary = async () => {
    if (!meeting?.id) return;
    try {
      setLunaStatus('loading');
      const result = await meetingService.askLuna(
        meeting.id,
        `Traduis en anglais ce résumé sans modifier le sens:\n\n${buildLunaCopyText(lunaSummary)}`,
        'professional',
      );
      setLunaSummary((currentSummary) => ({
        ...currentSummary,
        updatedAt: getCurrentTime(),
        liveSummary: result.answer || currentSummary.liveSummary,
      }));
      setLunaStatus(result.configured === false ? 'disabled' : 'listening');
      setToastMessage('Traduction générée par Luna IA.');
    } catch {
      setLunaStatus('error');
      setToastMessage('Traduction indisponible pour le moment.');
    }
  };

  const toggleScreenShare = async () => {
    if (isSharingScreen) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setIsSharingScreen(false);
      setToastMessage('Partage d’écran arrêté.');
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setToastMessage("Le partage d’écran n’est pas disponible dans ce navigateur.");
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screenStream;
      screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setIsSharingScreen(false);
        screenStreamRef.current = null;
      });
      setIsSharingScreen(true);
      setToastMessage('Partage d’écran démarré.');
    } catch {
      setToastMessage('Partage d’écran annulé.');
    }
  };

  const toggleRecording = () => {
    setIsRecording(false);
    setToastMessage("L’enregistrement doit être autorisé par le backend avant activation.");
  };

  const togglePanel = (panel: MeetingPanel) => {
    setActivePanel((currentPanel) => (currentPanel === panel ? null : panel));
  };

  const leaveMeeting = async () => {
    setLeaveConfirmOpen(false);
    const targetMeetingId = String(meeting?.id || meetingId || 'terminee');
    const endedState = {
      guest: Boolean(currentUser?.isGuest),
      meetingId: meeting?.id || meetingId,
      meeting: meeting || locationState?.meeting,
      participants: [
        { id: String(meeting?.host_id || 'host'), name: hostName, role: 'Hôte', avatar: meeting?.host_avatar, online: true },
        { id: localUserId || 'me', name: localName, role: currentUser?.isGuest ? 'Invité' : 'Participant', avatar: currentUser?.avatar, online: true },
        ...remoteParticipants.map((participant) => ({
          id: participant.userId,
          name: participant.name,
          role: participant.userId === String(meeting?.host_id || '') ? 'Hôte' : 'Participant',
          avatar: participant.avatar,
          online: true,
        })),
        ...acceptedLobby.map((participant) => ({
          id: String(participant.user_id),
          name: participant.name,
          role: 'Participant',
          online: participant.status === 'accepted',
        })),
      ],
      summary: lunaSummary.keyPoints.length
        ? [lunaSummary.liveSummary, ...lunaSummary.keyPoints]
        : undefined,
    };
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    stopLocalMedia();
    if (currentUser?.isGuest) {
      await authService.logout().catch(() => undefined);
    }
    navigate(`/reunions/${encodeURIComponent(targetMeetingId)}/terminee`, { replace: true, state: endedState });
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = messageDraft.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (meeting?.id && socket.connected) {
      socket.emit('meeting:chat-message', { meetingId: meeting.id, text });
    } else {
      setMessages((currentMessages) => [...currentMessages, {
        id: `${Date.now()}-${currentMessages.length}`,
        userId: localUserId,
        sender: localName,
        text,
        time: getCurrentTime(),
      }]);
    }
    setMessageDraft('');
  };

  if (!authService.isAuthenticated()) {
    return <Navigate to="/rejoindre-une-reunion" replace />;
  }

  if (isLoadingMeeting) {
    return (
      <main className="guest-meeting-page guest-meeting-status-page">
        <p>Chargement de la réunion...</p>
      </main>
    );
  }

  if (meetingError || !meeting) {
    return (
      <main className="guest-meeting-page guest-meeting-status-page">
        <section>
          <h1>Accès impossible</h1>
          <p role="alert">{meetingError || 'Réunion introuvable.'}</p>
          <Link to="/rejoindre-une-reunion">Retour à la participation invitée</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={['guest-meeting-page', lunaVisible ? 'has-luna-panel' : '', lunaReduced ? 'is-luna-reduced' : ''].filter(Boolean).join(' ')}>
      <header className="guest-meeting-header">
        <Link
          className="guest-meeting-brand"
          to="/rejoindre-une-reunion"
          aria-label="Accueil MBot?Room"
          onClick={(event) => {
            event.preventDefault();
            setLeaveConfirmOpen(true);
          }}
        >
          <span className="guest-meeting-brand-icon">
            <UsersRound size={27} aria-hidden="true" />
            <Video size={14} aria-hidden="true" />
          </span>
          <strong>MBot?<span>Room</span></strong>
        </Link>

        <section className="guest-meeting-title" aria-label="Informations de r?union">
          <div>
            <h1>{meeting.title}</h1>
            {secureMeeting && <LockKeyhole size={16} aria-hidden="true" />}
          </div>
          <span className={secureMeeting ? 'is-secure' : ''}>
            <ShieldCheck size={17} aria-hidden="true" />
            {secureMeeting ? 'R?union s?curis?e' : 'R?union standard'}
          </span>
        </section>

        <nav className="guest-meeting-header-actions" aria-label="Actions invit?">
          <span className="guest-meeting-account-badge" title="Mode invit? : certaines fonctions avanc?es sont limit?es."><UserRound size={18} aria-hidden="true" />Invit?</span>
          {isLunaRoute ? (
            <button className="guest-meeting-register guest-meeting-share-link" type="button" onClick={() => void copyMeetingLink()}>
              <Clipboard size={18} aria-hidden="true" />
              Partager un lien
            </button>
          ) : (
            <Link className="guest-meeting-register" to="/inscription" state={{ meeting, guestName: localName, returnTo: location.pathname }}>Cr?er un compte</Link>
          )}
          <button className="guest-meeting-header-leave" type="button" onClick={() => setLeaveConfirmOpen(true)}>
            <LogOut size={19} aria-hidden="true" />
            Quitter
          </button>
        </nav>
      </header>

      <div className="guest-meeting-layout">
        <section className="guest-meeting-main" aria-label="R?union en cours">
          {showGuestBanner && !isLunaRoute && (
            <aside className="guest-meeting-banner">
              <Info size={21} aria-hidden="true" />
              <p>Vous participez en tant qu?invit?. Cr?ez un compte pour acc?der ? plus de fonctionnalit?s.</p>
              <Link to="/inscription" state={{ meeting, guestName: localName, returnTo: location.pathname }}>Cr?er un compte</Link>
              <button type="button" aria-label="Fermer la banni?re invit?" onClick={dismissGuestBanner}>
                <X size={19} aria-hidden="true" />
              </button>
            </aside>
          )}

          {notice && <p className="guest-meeting-notice" role="status">{notice}</p>}
          {mediaError && (
            <MediaErrorNotice
              error={mediaError}
              devices={availableDevices}
              onRetry={() => void retryMedia()}
              onWithoutCamera={continueWithoutCamera}
              onWithoutMicrophone={continueWithoutMicrophone}
              onOpenSettings={() => setActivePanel('settings')}
            />
          )}

          <section className="guest-meeting-grid" data-count={gridParticipantCount} aria-label="Participants vid?o">
            {primaryParticipant ? (
              <RemoteParticipantTile
                participant={primaryParticipant}
                hostName={hostName}
                large={gridParticipantCount > 2}
                activeSpeaker={!localIsActiveSpeaker && primaryParticipant.media.audio}
                pinned={pinnedParticipantId === primaryParticipant.socketId || pinnedParticipantId === primaryParticipant.userId}
                menuOpen={tileMenu?.id === primaryParticipant.socketId}
                onMenu={() => setTileMenu(tileMenu?.id === primaryParticipant.socketId ? null : { id: primaryParticipant.socketId, self: false, name: primaryParticipant.name })}
                onPin={() => {
                  setPinnedParticipantId((current) => (current === primaryParticipant.socketId ? null : primaryParticipant.socketId));
                  setTileMenu(null);
                }}
                onToast={setToastMessage}
              />
            ) : (
              <HostPlaceholderTile hostName={hostName} meeting={meeting} large={gridParticipantCount > 2} activeSpeaker={!localIsActiveSpeaker} />
            )}

            {secondaryParticipants.map((participant) => (
              <RemoteParticipantTile
                key={participant.socketId}
                participant={participant}
                hostName={hostName}
                pinned={pinnedParticipantId === participant.socketId || pinnedParticipantId === participant.userId}
                menuOpen={tileMenu?.id === participant.socketId}
                onMenu={() => setTileMenu(tileMenu?.id === participant.socketId ? null : { id: participant.socketId, self: false, name: participant.name })}
                onPin={() => {
                  setPinnedParticipantId((current) => (current === participant.socketId ? null : participant.socketId));
                  setTileMenu(null);
                }}
                onToast={setToastMessage}
              />
            ))}

            {!hideLocalPreview && (
              <LocalParticipantTile
                videoRef={localVideoRef}
                localName={localName}
                cameraEnabled={cameraEnabled}
                microphoneEnabled={microphoneEnabled}
                handRaised={handRaised}
                activeSpeaker={localIsActiveSpeaker}
                mediaError={mediaError}
                mirror={settings.mirrorVideo}
                menuOpen={tileMenu?.id === 'local'}
                onMenu={() => setTileMenu(tileMenu?.id === 'local' ? null : { id: 'local', self: true, name: localName })}
                onPin={() => {
                  setPinnedParticipantId((current) => (current === 'local' ? null : 'local'));
                  setTileMenu(null);
                }}
                onHidePreview={() => {
                  setHideLocalPreview(true);
                  setTileMenu(null);
                }}
                onToast={setToastMessage}
              />
            )}
          </section>

          {activePanel && (
            <MeetingPanelSheet
              panel={activePanel}
              meeting={meeting}
              hostName={hostName}
              localName={localName}
              localUserId={localUserId}
              microphoneEnabled={microphoneEnabled}
              remoteParticipants={remoteParticipants}
              acceptedLobby={acceptedLobby}
              messages={messages}
              messageDraft={messageDraft}
              settings={settings}
              onClose={() => setActivePanel(null)}
              onSendMessage={sendMessage}
              onDraftChange={setMessageDraft}
              onSettingsChange={setSettings}
            />
          )}

          <MeetingControls
            microphoneEnabled={microphoneEnabled}
            cameraEnabled={cameraEnabled}
            handRaised={handRaised}
            participantCount={participantCount}
            activePanel={activePanel}
            isSharingScreen={isSharingScreen}
            isRecording={isRecording}
            onToggleMicrophone={toggleMicrophone}
            onToggleCamera={toggleCamera}
            onToggleHand={toggleHandRaised}
            onTogglePanel={togglePanel}
            onToggleShare={() => void toggleScreenShare()}
            onToggleRecording={toggleRecording}
            onLeave={() => setLeaveConfirmOpen(true)}
          />
        </section>

        {lunaVisible ? (
          <LunaPanel
            reduced={lunaReduced}
            status={lunaStatus}
            summary={lunaSummary}
            onReduce={() => setLunaReduced((currentValue) => !currentValue)}
            onClose={() => setLunaVisible(false)}
            onCopy={() => void copyLunaSummary()}
            onExport={exportLunaSummary}
            onTranscription={() => setActivePanel('chat')}
            onTranslate={() => void translateLunaSummary()}
          />
        ) : (
          <aside className="guest-meeting-sidebar" aria-label="Informations invité">
            <section className="guest-meeting-side-card">
              <h2>Informations de la réunion</h2>
              <InfoRow label="ID de réunion" value={meetingAccessId} icon={<BadgeInfo />} />
              <InfoRow label="Hôte" value={hostName} icon={<UserRound />} />
              <InfoRow label="Sécurité" value={secureMeeting ? 'Réunion sécurisée' : 'Réunion standard'} icon={<ShieldCheck />} positive={secureMeeting} />
              <InfoRow label="Participants" value={`${participantCount} en réunion`} icon={<UsersRound />} />
            </section>

            <section className="guest-meeting-side-card guest-meeting-limits">
              <BadgeInfo size={28} aria-hidden="true" />
              <div>
                <h2>Accès invité</h2>
                <p>Certaines fonctionnalités peuvent être limitées : enregistrement, historique des discussions ou gestion avancée.</p>
              </div>
            </section>

            <section className="guest-meeting-side-card guest-meeting-premium">
              <UsersRound size={38} aria-hidden="true" />
              <h2>Profitez de toutes les fonctionnalités</h2>
              <p>Créez un compte MBotéRoom pour enregistrer vos réunions, retrouver votre historique et gérer vos invitations.</p>
              <Link to="/inscription">Créer un compte</Link>
              <Link className="guest-meeting-learn-more" to="/fonctionnalites">En savoir plus</Link>
            </section>
          </aside>
        )}
      </div>

      {!lunaVisible && isLunaRoute && (
        <button className="open-luna-button" type="button" onClick={() => setLunaVisible(true)}>
          <Sparkles size={19} aria-hidden="true" />
          Ouvrir Luna IA
        </button>
      )}

      {leaveConfirmOpen && (
        <div className="guest-leave-modal-backdrop" role="presentation" onClick={() => setLeaveConfirmOpen(false)}>
          <section className="guest-leave-modal" role="dialog" aria-modal="true" aria-labelledby="guest-leave-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="guest-leave-title">Quitter la réunion ?</h2>
              <button type="button" aria-label="Fermer" onClick={() => setLeaveConfirmOpen(false)}><X size={20} /></button>
            </header>
            <p>Votre micro, votre caméra, le partage d’écran et la connexion temps réel seront arrêtés.</p>
            <footer>
              <button type="button" onClick={() => setLeaveConfirmOpen(false)}>Annuler</button>
              <button type="button" className="is-danger" onClick={() => void leaveMeeting()}>Quitter la réunion</button>
            </footer>
          </section>
        </div>
      )}

      {toastMessage && (
        <div className="guest-meeting-toast" role="status" aria-live="polite">
          <CheckCircle2 size={18} aria-hidden="true" />
          {toastMessage}
        </div>
      )}
    </main>
  );
}

function MediaErrorNotice({
  error,
  devices,
  onRetry,
  onWithoutCamera,
  onWithoutMicrophone,
  onOpenSettings,
}: {
  error: MediaErrorInfo;
  devices: MediaDeviceInfo[];
  onRetry: () => void;
  onWithoutCamera: () => void;
  onWithoutMicrophone: () => void;
  onOpenSettings: () => void;
}) {
  const microphones = devices.filter((device) => device.kind === 'audioinput').length;
  const cameras = devices.filter((device) => device.kind === 'videoinput').length;

  return (
    <aside className={`guest-media-error is-${error.kind}`} role="alert">
      <BadgeInfo size={22} aria-hidden="true" />
      <div>
        <strong>{error.title}</strong>
        <p>{error.detail}</p>
        <small>{microphones} micro détecté{microphones > 1 ? 's' : ''} · {cameras} caméra détectée{cameras > 1 ? 's' : ''}</small>
      </div>
      <div className="guest-media-error-actions">
        <button type="button" onClick={onRetry}>Réessayer</button>
        <button type="button" onClick={onOpenSettings}>Paramètres</button>
        <button type="button" onClick={onWithoutCamera}>Sans caméra</button>
        <button type="button" onClick={onWithoutMicrophone}>Sans micro</button>
      </div>
    </aside>
  );
}

function RemoteParticipantTile({
  participant,
  hostName,
  large = false,
  activeSpeaker = false,
  pinned = false,
  menuOpen,
  onMenu,
  onPin,
  onToast,
}: {
  participant: RemoteMeetingParticipant;
  hostName: string;
  large?: boolean;
  activeSpeaker?: boolean;
  pinned?: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onPin: () => void;
  onToast: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = participant.stream;
    void videoRef.current.play().catch(() => undefined);
  }, [participant.stream]);

  const isHost = participant.name === hostName;

  return (
    <article className={['guest-video-tile', large ? 'is-large' : '', activeSpeaker ? 'is-speaking' : '', pinned ? 'is-pinned' : ''].filter(Boolean).join(' ')}>
      {participant.stream && participant.media.video ? (
        <video ref={videoRef} autoPlay playsInline />
      ) : participant.avatar ? (
        <img src={participant.avatar} alt="" />
      ) : (
        <AvatarFallback name={participant.name} />
      )}
      {activeSpeaker && <span className="guest-active-speaker"><Volume2 size={16} aria-hidden="true" />Intervenant actif</span>}
      <TileMenu
        label={`Plus d?actions pour ${participant.name}`}
        open={menuOpen}
        items={[
          { label: pinned ? 'D?s?pingler' : '?pingler', action: onPin },
          { label: 'Plein ?cran', action: () => onToast('Double-cliquez sur la carte pour l?afficher en plein ?cran.') },
          { label: 'Envoyer un message priv?', action: () => onToast('Les messages priv?s seront activ?s avec l?API messages.') },
          { label: 'Signaler le participant', action: () => onToast('Signalement enregistr?. Connexion support ? finaliser.') },
        ]}
        onToggle={onMenu}
      />
      <NameBadge microphoneEnabled={participant.media.audio} name={`${participant.name}${isHost ? ' (H?te)' : ''}`} />
    </article>
  );
}

function HostPlaceholderTile({ hostName, meeting, large, activeSpeaker }: { hostName: string; meeting: Meeting; large?: boolean; activeSpeaker?: boolean }) {
  return (
    <article className={['guest-video-tile', 'is-placeholder', large ? 'is-large' : '', activeSpeaker ? 'is-speaking' : ''].filter(Boolean).join(' ')}>
      {meeting.host_avatar ? <img src={meeting.host_avatar} alt="" /> : <AvatarFallback name={hostName} />}
      {activeSpeaker && <span className="guest-active-speaker"><Volume2 size={16} aria-hidden="true" />Intervenant actif</span>}
      <NameBadge microphoneEnabled name={`${hostName} (H?te)`} />
    </article>
  );
}

function AvatarFallback({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span className={compact ? 'guest-avatar-fallback is-compact' : 'guest-avatar-fallback'} aria-hidden="true">
      {getInitials(name)}
    </span>
  );
}

function LocalParticipantTile({
  videoRef,
  localName,
  cameraEnabled,
  microphoneEnabled,
  handRaised,
  activeSpeaker,
  mediaError,
  mirror,
  menuOpen,
  onMenu,
  onPin,
  onHidePreview,
  onToast,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  localName: string;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  handRaised: boolean;
  activeSpeaker: boolean;
  mediaError: MediaErrorInfo | null;
  mirror: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onPin: () => void;
  onHidePreview: () => void;
  onToast: (message: string) => void;
}) {
  return (
    <article className={['guest-video-tile', 'is-self', activeSpeaker ? 'is-speaking' : ''].filter(Boolean).join(' ')}>
      {cameraEnabled && !mediaError ? (
        <video ref={videoRef} autoPlay muted playsInline className={mirror ? 'is-mirrored' : ''} />
      ) : (
        <div className="guest-camera-off">
          <UserRound size={42} aria-hidden="true" />
          <strong>{mediaError ? 'Média indisponible' : 'Caméra désactivée'}</strong>
          {mediaError && <small>{mediaError.detail}</small>}
        </div>
      )}
      {activeSpeaker && <span className="guest-active-speaker"><Volume2 size={16} aria-hidden="true" />Vous parlez</span>}
      {handRaised && <span className="guest-hand-raised"><Hand size={16} aria-hidden="true" />Main lev?e</span>}
      <TileMenu
        label="Plus d?actions pour votre tuile"
        open={menuOpen}
        items={[
          { label: '?pingler ma vid?o', action: onPin },
          { label: 'Masquer mon aper?u', action: onHidePreview },
          { label: 'Modifier mon nom', action: () => onToast('La modification du nom invit? sera reli?e au profil invit?.') },
          { label: 'Choisir un arri?re-plan', action: () => onToast('Les arri?re-plans seront appliqu?s depuis la salle d?attente.') },
          { label: 'Afficher les statistiques r?seau', action: () => onToast('Statistiques r?seau : connexion temps r?el active.') },
          { label: 'Signaler un probl?me', action: () => onToast('Signalement enregistr?. Connexion support ? finaliser.') },
        ]}
        onToggle={onMenu}
      />
      <NameBadge microphoneEnabled={microphoneEnabled} name={`${localName} (invit?)`} self />
    </article>
  );
}

function TileMenu({
  label,
  open,
  items,
  onToggle,
}: {
  label: string;
  open: boolean;
  items: Array<{ label: string; action: () => void }>;
  onToggle: () => void;
}) {
  return (
    <div className="guest-tile-menu-wrap">
      <button className="guest-tile-menu" type="button" aria-label={label} aria-expanded={open} onClick={onToggle}>
        <MoreHorizontal size={21} aria-hidden="true" />
      </button>
      {open && (
        <div className="guest-tile-dropdown" role="menu">
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              onClick={() => {
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NameBadge({ name, microphoneEnabled, self = false }: { name: string; microphoneEnabled: boolean; self?: boolean }) {
  return (
    <span className={self ? 'guest-name-badge is-self' : 'guest-name-badge'}>
      {microphoneEnabled ? <Mic size={16} aria-hidden="true" /> : <MicOff size={16} aria-hidden="true" />}
      {name}
    </span>
  );
}

function MeetingControls({
  microphoneEnabled,
  cameraEnabled,
  handRaised,
  participantCount,
  activePanel,
  isSharingScreen,
  isRecording,
  onToggleMicrophone,
  onToggleCamera,
  onToggleHand,
  onTogglePanel,
  onToggleShare,
  onToggleRecording,
  onLeave,
}: {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  handRaised: boolean;
  participantCount: number;
  activePanel: MeetingPanel;
  isSharingScreen: boolean;
  isRecording: boolean;
  onToggleMicrophone: () => void;
  onToggleCamera: () => void;
  onToggleHand: () => void;
  onTogglePanel: (panel: MeetingPanel) => void;
  onToggleShare: () => void;
  onToggleRecording: () => void;
  onLeave: () => void;
}) {
  return (
    <nav className="guest-meeting-controls" aria-label="Contrôles de réunion">
      <ControlButton icon={microphoneEnabled ? <Mic /> : <MicOff />} label="Micro" active={microphoneEnabled} danger={!microphoneEnabled} onClick={onToggleMicrophone} />
      <ControlButton icon={cameraEnabled ? <Camera /> : <CameraOff />} label="Caméra" active={cameraEnabled} danger={!cameraEnabled} onClick={onToggleCamera} />
      <ControlButton icon={<Hand />} label={handRaised ? 'Baisser la main' : 'Lever la main'} active={handRaised} onClick={onToggleHand} />
      <ControlButton icon={<MessageCircle />} label="Chat" active={activePanel === 'chat'} onClick={() => onTogglePanel('chat')} />
      <ControlButton icon={<UsersRound />} label="Participants" active={activePanel === 'participants'} badge={participantCount} onClick={() => onTogglePanel('participants')} />
      <ControlButton icon={<ScreenShare />} label="Partager" active={isSharingScreen} onClick={onToggleShare} />
      <ControlButton icon={<CircleDot />} label="Enregistrer" active={isRecording} danger={isRecording} onClick={onToggleRecording} />
      <ControlButton icon={<Settings />} label="Paramètres" active={activePanel === 'settings'} onClick={() => onTogglePanel('settings')} />
      <button className="guest-meeting-leave" type="button" onClick={onLeave}>
        <PhoneOff size={22} aria-hidden="true" />
        Quitter
      </button>
    </nav>
  );
}

function ControlButton({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  locked = false,
  badge,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  locked?: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      className={['guest-control', active ? 'is-active' : '', danger ? 'is-danger' : '', locked ? 'is-locked' : ''].filter(Boolean).join(' ')}
      type="button"
      disabled={disabled}
      aria-pressed={!disabled ? active : undefined}
      onClick={onClick}
    >
      <span>
        {icon}
        {locked && <LockKeyhole size={13} aria-hidden="true" />}
        {typeof badge === 'number' && <b>{badge}</b>}
      </span>
      {label}
    </button>
  );
}

function MeetingPanelSheet({
  panel,
  meeting,
  hostName,
  localName,
  localUserId,
  microphoneEnabled,
  remoteParticipants,
  acceptedLobby,
  messages,
  messageDraft,
  settings,
  onClose,
  onSendMessage,
  onDraftChange,
  onSettingsChange,
}: {
  panel: Exclude<MeetingPanel, null>;
  meeting: Meeting;
  hostName: string;
  localName: string;
  localUserId: string;
  microphoneEnabled: boolean;
  remoteParticipants: RemoteMeetingParticipant[];
  acceptedLobby: LobbyParticipant[];
  messages: LocalMessage[];
  messageDraft: string;
  settings: { noiseReduction: boolean; mirrorVideo: boolean; showNames: boolean; lunaSummary: boolean };
  onClose: () => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (value: string) => void;
  onSettingsChange: (settings: { noiseReduction: boolean; mirrorVideo: boolean; showNames: boolean; lunaSummary: boolean }) => void;
}) {
  const participantRows = [
    { id: String(meeting.host_id), name: hostName, role: 'Hôte', microphoneEnabled: true },
    { id: localUserId, name: localName, role: 'Invité', microphoneEnabled },
    ...remoteParticipants.map((participant) => ({
      id: participant.userId,
      name: participant.name,
      role: participant.userId === String(meeting.host_id) ? 'Hôte' : 'Participant',
      microphoneEnabled: participant.media.audio,
    })),
    ...acceptedLobby.map((participant) => ({
      id: String(participant.user_id),
      name: participant.name,
      role: 'Accepté',
      microphoneEnabled: true,
    })),
  ].filter((participant, index, all) => all.findIndex((item) => item.id === participant.id) === index);

  return (
    <aside className="guest-meeting-panel" aria-label={`Panneau ${panel}`}>
      <header>
        <h2>{panel === 'participants' ? 'Participants' : panel === 'chat' ? 'Chat' : 'Paramètres'}</h2>
        <button type="button" aria-label="Fermer le panneau" onClick={onClose}><X size={19} aria-hidden="true" /></button>
      </header>

      {panel === 'participants' && (
        <div className="guest-panel-participants">
          {participantRows.map((participant) => (
            <article key={participant.id}>
              <AvatarFallback name={participant.name} compact />
              <span>
                <strong>{participant.name}</strong>
                <small>{participant.role}</small>
              </span>
              {participant.microphoneEnabled ? <Mic size={18} aria-label="Micro actif" /> : <MicOff size={18} aria-label="Micro coupé" />}
            </article>
          ))}
        </div>
      )}

      {panel === 'chat' && (
        <div className="guest-panel-chat">
          <div className="guest-chat-list">
            {messages.map((message) => (
              <article key={message.id}>
                <strong>{message.sender}<small>{message.time}</small></strong>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          <form onSubmit={onSendMessage}>
            <input value={messageDraft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Écrire un message" maxLength={800} aria-label="Message de chat" />
            <button type="submit" disabled={!messageDraft.trim()} aria-label="Envoyer le message">
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </div>
      )}

      {panel === 'settings' && (
        <div className="guest-panel-settings">
          <ToggleRow label="Réduction du bruit" checked={settings.noiseReduction} onChange={(checked) => onSettingsChange({ ...settings, noiseReduction: checked })} />
          <ToggleRow label="Affichage miroir" checked={settings.mirrorVideo} onChange={(checked) => onSettingsChange({ ...settings, mirrorVideo: checked })} />
          <ToggleRow label="Afficher les noms" checked={settings.showNames} onChange={(checked) => onSettingsChange({ ...settings, showNames: checked })} />
          <ToggleRow label="Résumés Luna IA" checked={settings.lunaSummary} onChange={(checked) => onSettingsChange({ ...settings, lunaSummary: checked })} />
          <p>Les périphériques avancés restent gérés dans la salle d’attente avant l’admission.</p>
        </div>
      )}
    </aside>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="guest-setting-toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)} />
    </label>
  );
}

function LunaPanel({
  reduced,
  status,
  summary,
  onReduce,
  onClose,
  onCopy,
  onExport,
  onTranscription,
  onTranslate,
}: {
  reduced: boolean;
  status: LunaStatus;
  summary: LunaSummary;
  onReduce: () => void;
  onClose: () => void;
  onCopy: () => void;
  onExport: (format: 'txt' | 'json') => void;
  onTranscription: () => void;
  onTranslate: () => void;
}) {
  const statusLabel = status === 'listening'
    ? 'Écoute et résume en temps réel'
    : status === 'loading'
      ? 'Analyse Luna IA en cours'
      : status === 'error'
        ? 'Service Luna IA indisponible'
        : 'Luna IA attend l’activation du résumé';

  return (
    <aside className="luna-panel" aria-label="Luna IA" aria-live="polite">
      <header className="luna-panel-header">
        <div>
          <span className="luna-panel-logo"><Sparkles size={24} aria-hidden="true" /></span>
          <h2>Luna IA</h2>
        </div>
        <button className="luna-panel-reduce" type="button" onClick={onReduce}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          {reduced ? 'Déployer' : 'Réduire'}
        </button>
        <button className="luna-panel-close" type="button" aria-label="Fermer Luna IA" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      {!reduced && (
        <>
          <section className={`luna-listening-state is-${status}`}>
            <span aria-hidden="true" />
            <strong>{statusLabel}</strong>
            <AudioLines size={28} aria-hidden="true" />
          </section>

          <div className="luna-panel-scroll">
            <section className="luna-section">
              <header>
                <h3><Bot size={18} aria-hidden="true" />Résumé en direct</h3>
                <small>Mis à jour à {summary.updatedAt}</small>
              </header>
              <p>{summary.liveSummary}</p>
            </section>

            <section className="luna-section">
              <h3><CheckCircle2 size={18} aria-hidden="true" />Points clés</h3>
              {summary.keyPoints.length ? (
                <ul className="luna-bullet-list">
                  {summary.keyPoints.map((point) => <li key={point}>{point}</li>)}
                </ul>
              ) : (
                <p className="luna-empty">Aucun point clé confirmé pour le moment.</p>
              )}
            </section>

            <section className="luna-section">
              <h3><Check size={18} aria-hidden="true" />Décisions</h3>
              {summary.decisions.length ? (
                <ul className="luna-decision-list">
                  {summary.decisions.map((decision) => <li key={decision}><CheckCircle2 size={16} aria-hidden="true" />{decision}</li>)}
                </ul>
              ) : (
                <p className="luna-empty">Aucune décision explicite détectée.</p>
              )}
            </section>

            <section className="luna-section">
              <h3><CalendarDays size={18} aria-hidden="true" />Actions à faire</h3>
              <div className="luna-action-list">
                {summary.actions.length ? summary.actions.map((action) => (
                  <article key={action.id}>
                    <AvatarFallback name={action.assignee} compact />
                    <span><strong>{action.assignee}</strong><small>{action.task}</small></span>
                    <time>{action.dueDate}</time>
                  </article>
                )) : <p className="luna-empty">Aucune action assignée automatiquement.</p>}
              </div>
              <button className="luna-link-button" type="button">Voir toutes les actions ({summary.actions.length})</button>
            </section>

            <section className="luna-section luna-next-meeting">
              <h3><CalendarDays size={18} aria-hidden="true" />Prochaine réunion</h3>
              <strong>{summary.nextMeeting.title}</strong>
              <p>{summary.nextMeeting.date}</p>
              <button type="button">Ajouter au calendrier</button>
            </section>
          </div>

          <footer className="luna-panel-actions">
            <button type="button" onClick={onCopy}><Clipboard size={18} aria-hidden="true" />Copier le résumé</button>
            <button type="button" onClick={() => onExport('txt')}><Download size={18} aria-hidden="true" />Exporter<ChevronDown size={15} aria-hidden="true" /></button>
            <button type="button" onClick={onTranscription}><FileText size={18} aria-hidden="true" />Voir la transcription</button>
            <button type="button" onClick={onTranslate}><Languages size={18} aria-hidden="true" />Traduire</button>
          </footer>
        </>
      )}
    </aside>
  );
}

function InfoRow({ icon, label, value, positive = false }: { icon: ReactNode; label: string; value: string; positive?: boolean }) {
  return (
    <div className="guest-meeting-info-row">
      <span>{icon}</span>
      <p>{label}</p>
      <strong className={positive ? 'is-positive' : ''}>{value}</strong>
    </div>
  );
}
