import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  Bell,
  Bot,
  Check,
  Copy,
  Download,
  Edit3,
  FileText,
  Grid2X2,
  Lock,
  Mic,
  MicOff,
  Monitor,
  MoreVertical,
  Paperclip,
  PhoneOff,
  Send,
  ShieldCheck,
  Sparkles,
  Smile,
  Upload,
  UserPlus,
  UserX,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import { Meeting, meetingService, LobbyParticipant, MeetingMediaRequest } from '../services/meetingService';
import { authService } from '../services/authService';
import { useMeetingMeshWebRTC } from '../hooks/useMeetingMeshWebRTC';
import { cn } from '../lib/utils';
import './MeetingRoom.css';

type Panel = 'chat' | 'participants' | 'details' | 'files' | 'poll' | 'reactions' | 'luna' | null;
type RoomLayout = 'grid' | 'speaker' | 'compact';
type ChatTab = 'discussion' | 'polls' | 'files';
type BooleanMeetingSetting = 'waitingRoom' | 'joinBeforeHost' | 'participantAudio' | 'participantVideo' | 'chat' | 'reactions' | 'recording' | 'screenShare' | 'encryption' | 'linkSharing' | 'externalAccess';

interface MeetingRoomProps {
  meeting: Meeting;
  joinOptions?: {
    mic?: boolean;
    camera?: boolean;
    background?: boolean;
    effects?: boolean;
  };
  onLeave: () => void;
}

type RoomParticipant = {
  id: string;
  name: string;
  avatar: string;
  role?: string;
  muted: boolean;
  camera: boolean;
  virtualBackground?: boolean;
  visualEffects?: boolean;
  blocked?: boolean;
  spotlight?: boolean;
};

type ParticipantAction =
  | 'mute'
  | 'unmute'
  | 'camera-off'
  | 'camera-on'
  | 'request-mic'
  | 'request-camera'
  | 'rename'
  | 'make-cohost'
  | 'remove-cohost'
  | 'spotlight'
  | 'block'
  | 'unblock'
  | 'remove';

type RoomMessage = {
  id: string;
  sender: string;
  time: string;
  text: string;
  reaction: string;
};

type LunaMessage = {
  id: string;
  sender: 'user' | 'luna';
  text: string;
  configured?: boolean;
};

type SharedFile = {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  url?: string;
};

type PollOption = {
  label: string;
  votes: number;
};

const initialFiles: SharedFile[] = [];

const initialPoll: PollOption[] = [
  { label: 'Valider la proposition', votes: 0 },
  { label: 'Continuer la discussion', votes: 0 },
  { label: 'Reporter la decision', votes: 0 },
];

const profileAvatarFallback = (name: string, seed: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name || seed || 'MBoté')}&background=7c3aed&color=fff&bold=true`;

export default function MeetingRoom({ meeting, joinOptions, onLeave }: MeetingRoomProps) {
  const currentUser = authService.getCurrentUser();
  const currentUserId = String(currentUser?.id || 'me');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const sharedFileUrlsRef = useRef<string[]>([]);
  const initialSettings = meeting.settings || {};
  const isHost = String(currentUser?.id || '') === String(meeting.host_id);
  const isCoHost = String(currentUser?.id || '') === String(meeting.co_host_id || '');
  const isModerator = isHost || isCoHost;
  const [roomSettings, setRoomSettings] = useState({ ...initialSettings });
  const [panel, setPanel] = useState<Panel>(null);
  const [layout, setLayout] = useState<RoomLayout>('grid');
  const [muted, setMuted] = useState(joinOptions?.mic === false || (!isModerator && initialSettings.participantAudio === false));
  const [cameraOff, setCameraOff] = useState(joinOptions?.camera === false || initialSettings.participantVideo === false);
  const [virtualBackground] = useState(Boolean(joinOptions?.background));
  const [visualEffects] = useState(Boolean(joinOptions?.effects));
  const [recording, setRecording] = useState(Boolean(initialSettings.recording));
  const [screenSharing, setScreenSharing] = useState(false);
  const [localMediaStream, setLocalMediaStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [reaction, setReaction] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lobby, setLobby] = useState<LobbyParticipant[]>([]);
  const previousLobbyRequestIdsRef = useRef<Set<string>>(new Set());
  const [acceptedParticipants, setAcceptedParticipants] = useState<LobbyParticipant[]>([]);
  const [participantOverrides, setParticipantOverrides] = useState<Record<string, Partial<RoomParticipant>>>({});
  const [removedParticipantIds, setRemovedParticipantIds] = useState<string[]>([]);
  const [openParticipantMenuId, setOpenParticipantMenuId] = useState<string | null>(null);
  const [mediaRequests, setMediaRequests] = useState<MeetingMediaRequest[]>([]);
  const [hostNotice, setHostNotice] = useState<string | null>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [securityMenuOpen, setSecurityMenuOpen] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>(initialFiles);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [pollActive, setPollActive] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('Quelle decision prendre maintenant ?');
  const [pollOptions, setPollOptions] = useState<PollOption[]>(initialPoll);
  const [myPollVote, setMyPollVote] = useState<string | null>(null);
  const [chatTab, setChatTab] = useState<ChatTab>('discussion');
  const [participantSearch, setParticipantSearch] = useState('');
  const [messages, setMessages] = useState<RoomMessage[]>(() => [{
    id: 'system-start',
    sender: 'MBote',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    text: `${meeting.title} est ouverte. Le chat, les fichiers et le sondage utilisent les actions de cette réunion.`,
    reaction: '',
  }]);
  const [messageDraft, setMessageDraft] = useState('');
  const [lunaMessages, setLunaMessages] = useState<LunaMessage[]>([
    {
      id: 'luna-welcome',
      sender: 'luna',
      text: 'Bonjour, je suis Luna IA. Je peux aider à résumer, préparer une décision, clarifier une idée ou proposer les prochaines actions de cette réunion.',
      configured: true,
    },
  ]);
  const [lunaDraft, setLunaDraft] = useState('');
  const [isLunaThinking, setIsLunaThinking] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const stopLocalMedia = () => {
      localMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      localMediaStreamRef.current = null;
      setLocalMediaStream(null);
    };

    if (muted && cameraOff) {
      stopLocalMedia();
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Camera ou micro indisponible dans ce navigateur.");
      return undefined;
    }

    const startLocalMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: muted ? false : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: cameraOff ? false : {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopLocalMedia();
        localMediaStreamRef.current = stream;
        setLocalMediaStream(stream);
        setMediaError('');
      } catch (error) {
        stopLocalMedia();
        const message = error instanceof DOMException && error.name === 'NotAllowedError'
          ? "Autorisez l'accès au micro et à la caméra pour les utiliser en réunion."
          : "Impossible d'ouvrir la camera ou le micro sur cet appareil.";
        setMediaError(message);
      }
    };

    void startLocalMedia();

    return () => {
      cancelled = true;
    };
  }, [cameraOff, muted]);

  useEffect(() => {
    let cancelled = false;

    const stopScreenShare = () => {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
    };

    if (!screenSharing) {
      stopScreenShare();
      return undefined;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenSharing(false);
      setHostNotice("Le partage d'ecran n'est pas supporte par ce navigateur.");
      return undefined;
    }

    const startScreenShare = async () => {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopScreenShare();
        stream.getVideoTracks()[0]?.addEventListener('ended', () => setScreenSharing(false), { once: true });
        screenStreamRef.current = stream;
        setScreenStream(stream);
        setHostNotice("Partage d'ecran actif.");
      } catch {
        setScreenSharing(false);
        setHostNotice("Partage d'ecran annule.");
      }
    };

    void startScreenShare();

    return () => {
      cancelled = true;
    };
  }, [screenSharing]);

  useEffect(() => () => {
    localMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    sharedFileUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const nextLobbyResponse = await meetingService.getLobby(meeting.id).catch(() => []);
      const nextLobby = Array.isArray(nextLobbyResponse) ? nextLobbyResponse : [];
      const requestedLobby = nextLobby.filter((item) => item.status === 'requested');
      if (isModerator) {
        const previousIds = previousLobbyRequestIdsRef.current;
        const newestRequest = requestedLobby.find((item) => !previousIds.has(String(item.user_id)));
        if (newestRequest) {
          setPanel('participants');
          setHostNotice(`${newestRequest.name} est dans la salle d'attente. Accepter ou refuser.`);
        }
        previousLobbyRequestIdsRef.current = new Set(requestedLobby.map((item) => String(item.user_id)));
      }
      setLobby(isModerator ? requestedLobby : []);
      setAcceptedParticipants(nextLobby.filter((item) => item.status === 'accepted'));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [isModerator, meeting.id]);

  useEffect(() => {
    const loadRequests = async () => {
      const requests = await meetingService.getMediaRequests(meeting.id).catch(() => []);
      setMediaRequests(requests);
    };
    void loadRequests();
    const timer = window.setInterval(loadRequests, 3500);
    return () => window.clearInterval(timer);
  }, [meeting.id]);

  useEffect(() => {
    if (!hostNotice) return undefined;
    const timer = window.setTimeout(() => setHostNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [hostNotice]);

  const outboundMeetingStream = screenStream || localMediaStream;
  const meetingMediaState = useMemo(() => ({
    audio: !muted && Boolean(localMediaStream?.getAudioTracks().length),
    video: !cameraOff && Boolean(localMediaStream?.getVideoTracks().length),
    screen: Boolean(screenStream),
  }), [cameraOff, localMediaStream, muted, screenStream]);
  const { remoteParticipants } = useMeetingMeshWebRTC({
    meetingId: meeting.id,
    localUserId: currentUserId,
    localName: currentUser?.name || currentUser?.username || 'Vous',
    localAvatar: currentUser?.avatar || '',
    localStream: outboundMeetingStream,
    media: meetingMediaState,
    enabled: Boolean(currentUser?.id),
    onNotice: setHostNotice,
  });
  const remoteStreamsByUserId = useMemo(() => new Map(
    remoteParticipants.map((participant) => [participant.userId, participant.stream]),
  ), [remoteParticipants]);
  const remoteScreenShareUserIds = useMemo(() => new Set(
    remoteParticipants.filter((participant) => participant.media.screen).map((participant) => participant.userId),
  ), [remoteParticipants]);

  const participants = useMemo<RoomParticipant[]>(() => {
    const me: RoomParticipant = {
      id: currentUserId,
      name: `${currentUser?.name || 'Vous'} (Vous)`,
      avatar: currentUser?.avatar || profileAvatarFallback(currentUser?.name || 'Vous', String(currentUser?.id || 'me')),
      role: isHost ? 'Hote' : isCoHost ? 'Co-hote' : undefined,
      muted,
      camera: !cameraOff,
      virtualBackground,
      visualEffects,
    };
    const accepted = acceptedParticipants.map((item) => ({
      id: String(item.user_id),
      name: item.name,
      avatar: item.avatar || profileAvatarFallback(item.name, String(item.user_id)),
      muted: roomSettings.participantAudio === false,
      camera: roomSettings.participantVideo !== false,
    }));
    const remoteAccepted = remoteParticipants
      .filter((participant) => participant.userId !== currentUserId)
      .map((participant) => ({
        id: participant.userId,
        name: participant.name,
        avatar: participant.avatar || profileAvatarFallback(participant.name, participant.userId),
        muted: !participant.media.audio,
        camera: participant.media.video || participant.media.screen,
      }));

    return [me, ...accepted, ...remoteAccepted]
      .filter((participant, index, source) => source.findIndex((item) => item.id === participant.id) === index)
      .filter((participant) => !removedParticipantIds.includes(participant.id))
      .map((participant) => {
        const merged = { ...participant, ...participantOverrides[participant.id] };
        return merged.blocked ? { ...merged, muted: true, camera: false } : merged;
      })
      .slice(0, 8);
  }, [acceptedParticipants, cameraOff, currentUser?.avatar, currentUser?.id, currentUser?.name, currentUserId, isCoHost, isHost, muted, participantOverrides, remoteParticipants, removedParticipantIds, roomSettings.participantAudio, roomSettings.participantVideo, virtualBackground, visualEffects]);

  const orderedParticipants = useMemo(() => {
    const sorted = [...participants].sort((a, b) => Number(Boolean(b.spotlight)) - Number(Boolean(a.spotlight)));
    return sorted;
  }, [participants]);
  const filteredPanelParticipants = useMemo(() => {
    const query = participantSearch.trim().toLowerCase();
    if (!query) return participants;
    return participants.filter((participant) => participant.name.toLowerCase().includes(query));
  }, [participantSearch, participants]);
  const videoLimit = layout === 'speaker' ? 1 : layout === 'compact' ? 2 : 4;
  const visibleVideoParticipants = orderedParticipants.slice(0, videoLimit);
  const miniParticipants = orderedParticipants.slice(videoLimit);
  const elapsed = formatElapsed(elapsedSeconds);
  const meetingId = String(meeting.id).padStart(10, '0').replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
  const inviteLink = `${window.location.origin}/join/${meeting.meeting_link}`;
  const canShareInvite = isModerator || Boolean(roomSettings.linkSharing) || Boolean(roomSettings.externalAccess);
  const visibleFiles = showAllFiles ? sharedFiles : sharedFiles.filter((file) => file.visible).slice(0, 3);
  const togglePanel = (nextPanel: Panel) => {
    setRoomMenuOpen(false);
    setViewMenuOpen(false);
    setSecurityMenuOpen(false);
    setOpenParticipantMenuId(null);
    setPanel((current) => (current === nextPanel ? null : nextPanel));
  };

  const toggleMicrophone = () => {
    setRoomMenuOpen(false);
    setOpenParticipantMenuId(null);
    setMuted((current) => {
      const nextMuted = !current;
      setHostNotice(nextMuted ? 'Votre micro est coupé.' : 'Votre micro est activé.');
      return nextMuted;
    });
  };

  const toggleCamera = () => {
    setRoomMenuOpen(false);
    setOpenParticipantMenuId(null);
    if (!isModerator && roomSettings.participantVideo === false && cameraOff) {
      setHostNotice("La caméra des participants est désactivée par l'hôte.");
      return;
    }
    setCameraOff((current) => {
      const nextCameraOff = !current;
      setHostNotice(nextCameraOff ? 'Votre caméra est coupée.' : 'Votre caméra est activée.');
      return nextCameraOff;
    });
  };

  const toggleScreenShare = () => {
    setRoomMenuOpen(false);
    setOpenParticipantMenuId(null);
    if (roomSettings.screenShare === false) {
      setHostNotice("Le partage d'écran est désactivé pour cette réunion.");
      return;
    }
    setScreenSharing((current) => {
      const nextSharing = !current;
      if (!nextSharing) setHostNotice("Partage d'écran arrêté.");
      return nextSharing;
    });
  };

  const openControlPanel = (nextPanel: Panel, notice?: string) => {
    togglePanel(nextPanel);
    if (notice) setHostNotice(notice);
  };

  const toggleRecordingControl = () => {
    setRoomMenuOpen(false);
    setOpenParticipantMenuId(null);
    if (!isModerator) {
      setHostNotice("Seul l'hôte ou le co-hôte peut gérer l'enregistrement.");
      return;
    }
    if (roomSettings.encryption !== false) {
      setHostNotice("Désactivez le chiffrement pour lancer l'enregistrement.");
      return;
    }
    toggleRoomSetting('recording');
    setHostNotice(recording ? 'Enregistrement arrêté.' : 'Enregistrement démarré.');
  };

  const toggleMoreControls = () => {
    setPanel(null);
    setViewMenuOpen(false);
    setSecurityMenuOpen(false);
    setOpenParticipantMenuId(null);
    setRoomMenuOpen((current) => !current);
  };

  const sendMessage = (event: FormEvent) => {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!text) return;
    if (roomSettings.chat === false) {
      setHostNotice("La conversation est désactivée par l'hôte.");
      return;
    }
    setMessages((current) => [...current, {
      id: `msg-${Date.now()}`,
      sender: 'Vous',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text,
      reaction: '✓✓',
    }]);
    setMessageDraft('');
    setChatTab('discussion');
    setHostNotice('Message envoyé.');
  };

  const setParticipantPatch = (participantId: string, patch: Partial<RoomParticipant>) => {
    setParticipantOverrides((current) => ({
      ...current,
      [participantId]: { ...current[participantId], ...patch },
    }));
  };

  const askLuna = async (prompt?: string) => {
    const text = String(prompt || lunaDraft).trim().slice(0, 1800);
    if (!text || isLunaThinking) return;
    setLunaMessages((current) => [...current, { id: `luna-user-${Date.now()}`, sender: 'user', text }]);
    setLunaDraft('');
    setIsLunaThinking(true);
    try {
      const result = await meetingService.askLuna(meeting.id, text, 'professional');
      setLunaMessages((current) => [...current, {
        id: `luna-answer-${Date.now()}`,
        sender: 'luna',
        text: result.answer || 'Luna n’a pas pu générer une réponse complète.',
        configured: result.configured,
      }]);
    } catch (error) {
      setLunaMessages((current) => [...current, {
        id: `luna-error-${Date.now()}`,
        sender: 'luna',
        text: error instanceof Error ? error.message : 'Luna IA est indisponible pour le moment.',
        configured: false,
      }]);
    } finally {
      setIsLunaThinking(false);
    }
  };

  const pendingMediaRequest = mediaRequests[0] || null;

  const handleParticipantAction = async (participant: RoomParticipant, action: ParticipantAction) => {
    setOpenParticipantMenuId(null);
    if (!isModerator && !participant.name.includes('(Vous)')) {
      setHostNotice("Seul l'hôte ou le co-hôte peut exécuter cette action.");
      return;
    }

    const participantLabel = participant.name.replace(' (Vous)', '');
    const isSelfParticipant = participant.id === currentUserId || participant.name.includes('(Vous)');
    const applyParticipantPatch = (patch: Partial<RoomParticipant>) => {
      setParticipantPatch(participant.id, patch);
      if (!isSelfParticipant) return;
      if (typeof patch.muted === 'boolean') setMuted(patch.muted);
      if (typeof patch.camera === 'boolean') setCameraOff(!patch.camera);
      if (patch.blocked) {
        setMuted(true);
        setCameraOff(true);
      }
    };

    if (action === 'mute') {
      applyParticipantPatch({ muted: true });
      setHostNotice(`Micro coupé pour ${participantLabel}.`);
    }
    if (action === 'unmute') {
      applyParticipantPatch({ muted: false });
      setHostNotice(`Micro rétabli pour ${participantLabel}.`);
    }
    if (action === 'camera-off') {
      applyParticipantPatch({ camera: false });
      setHostNotice(`Caméra coupée pour ${participantLabel}.`);
    }
    if (action === 'camera-on') {
      applyParticipantPatch({ camera: true });
      setHostNotice(`Caméra demandée pour ${participantLabel}.`);
    }
    if (action === 'block') {
      applyParticipantPatch({ blocked: true, muted: true, camera: false });
      setHostNotice(`${participantLabel} est bloqué dans cette réunion.`);
    }
    if (action === 'unblock') {
      applyParticipantPatch({ blocked: false });
      setHostNotice(`${participantLabel} est débloqué.`);
    }
    if (action === 'spotlight') {
      setParticipantOverrides((current) => Object.fromEntries(
        participants.map((item) => [item.id, { ...current[item.id], spotlight: item.id === participant.id ? !item.spotlight : false }]),
      ));
      setHostNotice(participant.spotlight ? `${participantLabel} n'est plus en focus.` : `${participantLabel} est mis en focus.`);
    }
    if (action === 'make-cohost') {
      setParticipantPatch(participant.id, { role: 'Co-hôte' });
      setHostNotice(`${participantLabel} est nommé co-hôte.`);
    }
    if (action === 'remove-cohost') {
      setParticipantPatch(participant.id, { role: undefined });
      setHostNotice(`${participantLabel} n'est plus co-hôte.`);
    }
    if (action === 'remove') {
      setRemovedParticipantIds((current) => current.includes(participant.id) ? current : [...current, participant.id]);
      setHostNotice(`${participantLabel} a été retiré de la réunion.`);
    }
    if (action === 'request-mic' || action === 'request-camera') {
      if (isSelfParticipant) {
        if (action === 'request-mic') {
          applyParticipantPatch({ muted: false });
          setHostNotice('Votre micro est rétabli.');
        } else {
          applyParticipantPatch({ camera: true });
          setHostNotice('Votre caméra est activée.');
        }
        return;
      }
      const targetUserId = Number(participant.id);
      if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
        setHostNotice('Ce participant doit être un vrai utilisateur connecté pour recevoir une demande.');
        return;
      }
      const kind = action === 'request-mic' ? 'mic' : 'camera';
      try {
        await meetingService.requestMediaControl(meeting.id, targetUserId, kind);
        setHostNotice(`Demande ${kind === 'mic' ? 'micro' : 'caméra'} envoyée à ${participantLabel}.`);
      } catch (error) {
        setHostNotice(error instanceof Error ? error.message : 'Demande impossible.');
      }
    }
    if (action === 'rename') {
      const nextName = window.prompt('Nouveau nom du participant', participant.name.replace(' (Vous)', ''))?.trim();
      if (nextName) {
        setParticipantPatch(participant.id, { name: participant.name.includes('(Vous)') ? `${nextName} (Vous)` : nextName });
        setHostNotice(`${participantLabel} est renommé en ${nextName}.`);
      }
    }
  };

  const respondToLobby = async (participant: LobbyParticipant, status: 'accepted' | 'rejected') => {
    await meetingService.respondToLobby(meeting.id, participant.user_id, status).catch(() => undefined);
    setLobby((current) => current.filter((item) => item.user_id !== participant.user_id));
    if (status === 'accepted') {
      setAcceptedParticipants((current) => [...current, { ...participant, status }]);
    }
  };

  const toggleRoomSetting = (key: BooleanMeetingSetting) => {
    if (!isModerator) {
      setHostNotice("Seul l'hôte peut modifier la sécurité de la réunion.");
      return;
    }
    const defaultOnSettings = ['waitingRoom', 'participantAudio', 'participantVideo', 'chat', 'reactions', 'screenShare', 'encryption'];
    const encryptionActive = roomSettings.encryption !== false;
    if (key === 'recording' && encryptionActive) {
      setRecording(false);
      setRoomSettings((current) => ({ ...current, recording: false }));
      setHostNotice("L'enregistrement est bloque quand le chiffrement est active.");
      return;
    }
    if (key === 'encryption' && !encryptionActive) {
      setRecording(false);
      setRoomSettings((current) => ({ ...current, encryption: true, recording: false }));
      setHostNotice('Chiffrement active : enregistrement desactive.');
      return;
    }
    setRoomSettings((current) => {
      const isActive = defaultOnSettings.includes(key) ? current[key] !== false : Boolean(current[key]);
      return { ...current, [key]: !isActive };
    });
    if (key === 'recording') setRecording((value) => !value);
    if (key === 'encryption' && encryptionActive) {
      setHostNotice("Chiffrement désactivé : l'enregistrement peut être activé.");
    }
    if (key === 'participantAudio') {
      const nextEnabled = !(roomSettings.participantAudio !== false);
      setParticipantOverrides((current) => Object.fromEntries(
        participants.map((participant) => [participant.id, { ...current[participant.id], muted: !nextEnabled }]),
      ));
      if (!nextEnabled) setMuted(true);
    }
    if (key === 'participantVideo') {
      const nextEnabled = !(roomSettings.participantVideo !== false);
      setParticipantOverrides((current) => Object.fromEntries(
        participants.map((participant) => [participant.id, { ...current[participant.id], camera: nextEnabled }]),
      ));
      if (!nextEnabled) setCameraOff(true);
    }
    if (key === 'screenShare' && roomSettings.screenShare !== false) {
      setScreenSharing(false);
    }
  };

  const muteAll = () => {
    if (!isModerator) return setHostNotice("Seul l'hôte ou le co-hôte peut couper tous les micros.");
    participants.forEach((participant) => setParticipantPatch(participant.id, { muted: true }));
    setMuted(true);
    return setHostNotice('Tous les micros ont ete coupes.');
  };

  const copyInvite = async () => {
    if (!canShareInvite) {
      setHostNotice("Le partage du lien est désactivé par l'hôte.");
      return;
    }
    await navigator.clipboard.writeText(inviteLink).catch(() => undefined);
    setHostNotice('Lien de réunion copié.');
  };

  const handleMenuCopyInvite = async () => {
    setRoomMenuOpen(false);
    await copyInvite();
  };

  const handleMenuInvite = () => {
    setRoomMenuOpen(false);
    if (!canShareInvite) {
      setHostNotice("Le partage du lien est desactive par l'hote.");
      return;
    }
    setInviteModalOpen(true);
  };

  const handleMenuFiles = () => {
    setRoomMenuOpen(false);
    togglePanel('files');
  };

  const handleMenuPoll = () => {
    setRoomMenuOpen(false);
    togglePanel('poll');
    if (!isModerator) {
      setHostNotice("Seul l'hote peut declencher le sondage.");
      return;
    }
    setPollActive(true);
  };
  const uploadSharedFile = () => {
    fileInputRef.current?.click();
  };

  const handleSharedFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 25_000_000) {
      setHostNotice('Le fichier doit faire moins de 25 Mo.');
      return;
    }

    const url = URL.createObjectURL(file);
    sharedFileUrlsRef.current.push(url);
    const nextFile: SharedFile = {
      id: `file-${Date.now()}`,
      name: file.name,
      type: `${file.type || 'Fichier'} · ${formatFileSize(file.size)}`,
      visible: true,
      url,
    };
    setSharedFiles((current) => [nextFile, ...current]);
    setHostNotice('Fichier ajouté à la réunion.');
  };

  const votePoll = (label: string) => {
    if (!pollActive) return;
    setPollOptions((current) => current.map((option) => {
      if (option.label === label && myPollVote !== label) return { ...option, votes: option.votes + 1 };
      if (option.label === myPollVote) return { ...option, votes: Math.max(0, option.votes - 1) };
      return option;
    }));
    setMyPollVote(label);
  };

  const updatePollOption = (index: number, label: string) => {
    if (pollActive || !isModerator) return;
    setPollOptions((current) => current.map((option, optionIndex) => (
      optionIndex === index ? { ...option, label, votes: 0 } : option
    )));
    setMyPollVote(null);
  };

  const addPollOption = () => {
    if (pollActive || !isModerator) return;
    setPollOptions((current) => [...current, { label: `Option ${current.length + 1}`, votes: 0 }]);
  };

  const removePollOption = (index: number) => {
    if (pollActive || !isModerator) return;
    setPollOptions((current) => current.length <= 2 ? current : current.filter((_, optionIndex) => optionIndex !== index));
    setMyPollVote(null);
  };

  const togglePollActive = () => {
    if (!isModerator) {
      setHostNotice("Seul l'hôte ou le co-hôte peut déclencher le sondage.");
      return;
    }
    if (pollActive) {
      setPollActive(false);
      setHostNotice('Sondage fermé.');
      return;
    }
    const validOptions = pollOptions.map((option) => option.label.trim()).filter(Boolean);
    if (!pollQuestion.trim() || validOptions.length < 2) {
      setHostNotice('Ajoutez une question et au moins deux options.');
      return;
    }
    setPollQuestion(pollQuestion.trim());
    setPollOptions(validOptions.map((label) => ({ label, votes: 0 })));
    setMyPollVote(null);
    setPollActive(true);
    setHostNotice('Sondage démarré.');
  };

  const respondToPendingMediaRequest = async (status: 'accepted' | 'rejected') => {
    if (!pendingMediaRequest) return;
    await meetingService.respondToMediaRequest(meeting.id, pendingMediaRequest.id, status).catch(() => null);
    setMediaRequests((current) => current.filter((item) => item.id !== pendingMediaRequest.id));
    if (status === 'accepted') {
      if (pendingMediaRequest.kind === 'mic') setMuted(false);
      if (pendingMediaRequest.kind === 'camera') setCameraOff(false);
      setHostNotice('Demande acceptée.');
    } else {
      setHostNotice('Demande refusee.');
    }
  };

  const leaveMeeting = () => {
    setLeaveConfirmOpen(false);
    setRatingModalOpen(true);
  };

  const submitRating = () => {
    setRatingModalOpen(false);
    setHostNotice(`Avis envoyé avec ${rating || 0} étoile${rating > 1 ? 's' : ''}.`);
    window.setTimeout(onLeave, 500);
  };

  return (
    <main className="meeting-room-page">
      <section className="meeting-room-shell">
        <header className="meeting-room-header">
          <div className="meeting-room-logo">M</div>
          <button className="meeting-room-title" type="button" onClick={() => togglePanel('details')}>
            <h1>{meeting.title} <ShieldCheck size={15} /></h1>
            <p><b /> {elapsed} <span><Users size={14} /> {participants.length}</span></p>
          </button>
          <div className="meeting-room-header-actions">
            <button className="meeting-room-view" type="button" onClick={() => setViewMenuOpen((value) => !value)}><Grid2X2 size={18} /> Affichage</button>
            <button className="meeting-room-icon" type="button" aria-label="Securite" onClick={() => setSecurityMenuOpen((value) => !value)}><ShieldCheck size={20} /></button>
            <button className="meeting-room-icon" type="button" aria-label="Options" onClick={() => setRoomMenuOpen((value) => !value)}><MoreVertical size={20} /></button>
          </div>
          {viewMenuOpen && (
            <Dropdown className="meeting-room-header-menu meeting-room-view-menu">
              <button type="button" onClick={() => { setLayout('grid'); setViewMenuOpen(false); }}>Grille 2 x 2</button>
              <button type="button" onClick={() => { setLayout('speaker'); setViewMenuOpen(false); }}>Intervenant principal</button>
              <button type="button" onClick={() => { setLayout('compact'); setViewMenuOpen(false); }}>Compact</button>
            </Dropdown>
          )}
          {securityMenuOpen && (
            <Dropdown className="meeting-room-header-menu meeting-room-security-menu">
              <ToggleMenuItem label="Salle d'attente" active={roomSettings.waitingRoom !== false} onClick={() => toggleRoomSetting('waitingRoom')} />
              <ToggleMenuItem label="Chiffrement" active={roomSettings.encryption !== false} onClick={() => toggleRoomSetting('encryption')} />
              <ToggleMenuItem label="Rejoindre avant l'hôte" active={Boolean(roomSettings.joinBeforeHost)} onClick={() => toggleRoomSetting('joinBeforeHost')} />
              <ToggleMenuItem label="Discussion" active={roomSettings.chat !== false} onClick={() => toggleRoomSetting('chat')} />
              <ToggleMenuItem label="Reactions" active={roomSettings.reactions !== false} onClick={() => toggleRoomSetting('reactions')} />
              <ToggleMenuItem label="Partage du lien" active={Boolean(roomSettings.linkSharing)} onClick={() => toggleRoomSetting('linkSharing')} />
              <ToggleMenuItem label="Acces elargi" active={Boolean(roomSettings.externalAccess)} onClick={() => toggleRoomSetting('externalAccess')} />
            </Dropdown>
          )}
          {roomMenuOpen && (
            <Dropdown className="meeting-room-header-menu meeting-room-options-menu">
              <button type="button" disabled={!canShareInvite} onClick={handleMenuCopyInvite}><Copy size={16} /> Copier le lien</button>
              <button type="button" disabled={!canShareInvite} onClick={handleMenuInvite}><UserPlus size={16} /> Inviter</button>
              <button type="button" onClick={handleMenuFiles}><FileText size={16} /> Fichiers <small>{sharedFiles.length}</small></button>
              <button type="button" disabled={!isModerator} onClick={handleMenuPoll}><Bell size={16} /> {pollActive ? 'Voir le sondage' : 'Demarrer un sondage'}</button>
            </Dropdown>
          )}
        </header>

        <section className={cn('meeting-room-main', panel && 'has-panel')}>
          <div className="meeting-room-video-zone">
            {mediaError && <div className="meeting-room-media-warning">{mediaError}</div>}
            <div className={cn('meeting-room-video-grid', `is-${layout}`)}>
              {visibleVideoParticipants.map((participant) => (
                <VideoCard
                  key={participant.id}
                  participant={participant}
                  mediaStream={participant.id === currentUserId ? outboundMeetingStream : remoteStreamsByUserId.get(participant.id) || null}
                  isLocalMedia={participant.id === currentUserId}
                  isScreenShare={participant.id === currentUserId ? Boolean(screenStream) : remoteScreenShareUserIds.has(participant.id)}
                  menuOpen={openParticipantMenuId === participant.id}
                  onMenu={() => setOpenParticipantMenuId((current) => current === participant.id ? null : participant.id)}
                  onAction={handleParticipantAction}
                />
              ))}
            </div>
            <div className="meeting-room-mini-users">
              {miniParticipants.map((participant) => (
                <MiniUser key={participant.id} participant={participant} onClick={() => setOpenParticipantMenuId(participant.id)} />
              ))}
            </div>
          </div>

          {panel === 'chat' && roomSettings.chat !== false && (
            <ChatPanel
              tab={chatTab}
              setTab={setChatTab}
              messages={messages}
              draft={messageDraft}
              setDraft={setMessageDraft}
              onSend={sendMessage}
              files={sharedFiles}
              pollOptions={pollOptions}
              pollActive={pollActive}
              pollQuestion={pollQuestion}
              onVote={votePoll}
              myPollVote={myPollVote}
              onMention={() => setMessageDraft((value) => `${value}${value.endsWith(' ') || !value ? '@' : ' @'}`)}
              onAttach={uploadSharedFile}
              isHost={isModerator}
              onTogglePoll={togglePollActive}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'participants' && (
            <ParticipantsPanel
              participants={filteredPanelParticipants}
              totalParticipants={participants.length}
              search={participantSearch}
              onSearch={setParticipantSearch}
              lobby={lobby}
              isHost={isModerator}
              openMenuId={openParticipantMenuId}
              onToggleMenu={(id) => setOpenParticipantMenuId((current) => current === id ? null : id)}
              onAction={handleParticipantAction}
              onMuteAll={muteAll}
              onInvite={() => setInviteModalOpen(true)}
              onMore={() => setRoomMenuOpen(true)}
              onRespond={respondToLobby}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'details' && (
            <DetailsPanel
              meeting={meeting}
              settings={roomSettings}
              inviteLink={inviteLink}
              meetingId={meetingId}
              isHost={isModerator}
              onToggleSetting={toggleRoomSetting}
              onCopyInvite={copyInvite}
              onEndMeeting={() => setLeaveConfirmOpen(true)}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'files' && (
            <FilesPanel files={visibleFiles} showAll={showAllFiles} onToggleAll={() => setShowAllFiles((value) => !value)} onUpload={uploadSharedFile} onClose={() => setPanel(null)} />
          )}
          {panel === 'poll' && (
            <PollPanel
              isHost={isModerator}
              active={pollActive}
              question={pollQuestion}
              options={pollOptions}
              myVote={myPollVote}
              onQuestionChange={setPollQuestion}
              onVote={votePoll}
              onOptionChange={updatePollOption}
              onAddOption={addPollOption}
              onRemoveOption={removePollOption}
              onToggleActive={togglePollActive}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'reactions' && roomSettings.reactions !== false && (
            <ReactionsPanel
              activeReaction={reaction}
              onSelect={(item) => {
                setReaction(item);
                setMessages((current) => current.map((message, index) => (
                  index === current.length - 1 ? { ...message, reaction: item } : message
                )));
              }}
              onClose={() => setPanel(null)}
            />
          )}
          {panel === 'luna' && (
            <LunaPanel
              messages={lunaMessages}
              draft={lunaDraft}
              isThinking={isLunaThinking}
              setDraft={setLunaDraft}
              onAsk={(prompt) => void askLuna(prompt)}
              onClose={() => setPanel(null)}
            />
          )}
        </section>

        <footer className="meeting-room-controls">
          <Control label="Micro" active={!muted} icon={muted ? <MicOff /> : <Mic />} onClick={toggleMicrophone} />
          <Control label="Caméra" active={!cameraOff} icon={cameraOff ? <VideoOff /> : <Video />} onClick={toggleCamera} />
          <Control label="Écran" active={screenSharing} icon={<Monitor />} onClick={toggleScreenShare} />
          <Control label="Participants" active={panel === 'participants'} icon={<Users />} badge={String(participants.length)} onClick={() => openControlPanel('participants')} />
          <Control label="Conversation" active={panel === 'chat'} icon={<Smile />} onClick={() => roomSettings.chat === false ? setHostNotice("La conversation est désactivée par l'hôte.") : openControlPanel('chat')} />
          <Control label="Fichiers" active={panel === 'files'} icon={<FileText />} onClick={() => openControlPanel('files')} />
          <Control label="Sondage" active={panel === 'poll'} icon={<Bell />} onClick={() => openControlPanel('poll')} />
          <Control label="Emojis" active={panel === 'reactions'} icon={<Smile />} onClick={() => roomSettings.reactions === false ? setHostNotice("Les réactions sont désactivées par l'hôte.") : openControlPanel('reactions')} />
          <Control label="Luna IA" active={panel === 'luna'} icon={<Bot />} onClick={() => openControlPanel('luna')} />
          <Control label="Enregistrer" active={recording} icon={<span className="meeting-record-dot" />} onClick={toggleRecordingControl} />
          <Control label="Détails" active={panel === 'details'} icon={<ShieldCheck />} onClick={() => openControlPanel('details')} />
          <Control label="Plus" active={roomMenuOpen} icon={<MoreVertical />} onClick={toggleMoreControls} />
          <button className="meeting-room-leave" type="button" onClick={() => setLeaveConfirmOpen(true)}><PhoneOff size={20} /> Quitter</button>
        </footer>
      </section>

      <section className="meeting-room-panels-row">
        <ParticipantsPanel
          participants={participants}
          lobby={lobby}
          isHost={isModerator}
          openMenuId={openParticipantMenuId}
          onToggleMenu={(id) => setOpenParticipantMenuId((current) => current === id ? null : id)}
          onAction={handleParticipantAction}
          onMuteAll={muteAll}
          onInvite={() => setInviteModalOpen(true)}
          onMore={() => setRoomMenuOpen(true)}
          onRespond={respondToLobby}
          onClose={() => setPanel(null)}
        />
        <DetailsPanel
          meeting={meeting}
          settings={roomSettings}
          inviteLink={inviteLink}
          meetingId={meetingId}
          isHost={isModerator}
          onToggleSetting={toggleRoomSetting}
          onCopyInvite={copyInvite}
          onEndMeeting={() => setLeaveConfirmOpen(true)}
          onClose={() => setPanel(null)}
        />
        <div className="meeting-room-right-panels">
          <FilesPanel files={visibleFiles} showAll={showAllFiles} onToggleAll={() => setShowAllFiles((value) => !value)} onUpload={uploadSharedFile} onClose={() => setPanel(null)} />
          <PollPanel
            isHost={isModerator}
            active={pollActive}
            question={pollQuestion}
            options={pollOptions}
            myVote={myPollVote}
            onQuestionChange={setPollQuestion}
            onVote={votePoll}
            onOptionChange={updatePollOption}
            onAddOption={addPollOption}
            onRemoveOption={removePollOption}
            onToggleActive={togglePollActive}
            onClose={() => setPanel(null)}
          />
        </div>
      </section>

      <input
        ref={fileInputRef}
        className="meeting-room-hidden-input"
        type="file"
        onChange={handleSharedFileChange}
      />

      {false && roomSettings.reactions !== false && (
        <div className="meeting-room-reactions">
          {['👍', '❤️', '😂', '😮', '😢', '👏', '+'].map((item) => (
            <button key={item} type="button" className={reaction === item ? 'is-active' : ''} onClick={() => setReaction(item)}>{item}</button>
          ))}
        </div>
      )}

      {pendingMediaRequest && (
        <Modal title="Demande du moderateur" onClose={() => respondToPendingMediaRequest('rejected')}>
          <p>{pendingMediaRequest.requestedByName || "L'hôte"} vous demande d'ouvrir {pendingMediaRequest.kind === 'mic' ? 'votre micro' : 'votre caméra'}.</p>
          <div className="meeting-room-modal-actions">
            <button type="button" onClick={() => respondToPendingMediaRequest('rejected')}>Refuser</button>
            <button type="button" className="primary" onClick={() => respondToPendingMediaRequest('accepted')}>Accepter</button>
          </div>
        </Modal>
      )}

      {inviteModalOpen && (
        <Modal title="Inviter des participants" onClose={() => setInviteModalOpen(false)}>
          <label className="meeting-room-invite-box">
            <span>Lien de réunion</span>
            <input readOnly value={inviteLink} />
          </label>
          {!canShareInvite && <p>Le partage du lien est désactivé pour cette réunion.</p>}
          <div className="meeting-room-modal-actions">
            <button type="button" onClick={copyInvite}><Copy size={16} /> Copier</button>
            <button type="button" className="primary" disabled={!canShareInvite} onClick={() => { setInviteModalOpen(false); setHostNotice('Invitation prête à être partagée.'); }}><UserPlus size={16} /> Inviter</button>
          </div>
        </Modal>
      )}

      {leaveConfirmOpen && (
        <Modal title={isHost ? 'Mettre fin à la réunion ?' : 'Quitter la réunion ?'} onClose={() => setLeaveConfirmOpen(false)}>
          <p>{isHost ? "Tous les participants recevront ensuite la modale d'avis avec les étoiles." : 'Vous pourrez donner un avis juste après avoir quitté la réunion.'}</p>
          <div className="meeting-room-modal-actions">
            <button type="button" onClick={() => setLeaveConfirmOpen(false)}>Annuler</button>
            <button type="button" className="danger" onClick={leaveMeeting}>{isHost ? 'Terminer' : 'Quitter'}</button>
          </div>
        </Modal>
      )}

      {ratingModalOpen && (
        <Modal title="Votre avis sur la réunion" onClose={() => setRatingModalOpen(false)}>
          <div className="meeting-room-rating">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" className={rating >= star ? 'is-active' : ''} onClick={() => setRating(star)}>★</button>
            ))}
          </div>
          <textarea value={ratingComment} onChange={(event) => setRatingComment(event.target.value)} placeholder="Ajouter un commentaire..." />
          <div className="meeting-room-modal-actions">
            <button type="button" onClick={onLeave}>Ignorer</button>
            <button type="button" className="primary" onClick={submitRating}>Envoyer l'avis</button>
          </div>
        </Modal>
      )}

      {hostNotice && <div className="meeting-room-toast">{hostNotice}</div>}
    </main>
  );
}

function VideoCard({
  participant,
  mediaStream,
  isLocalMedia,
  isScreenShare,
  menuOpen,
  onMenu,
  onAction,
}: {
  participant: RoomParticipant;
  mediaStream?: MediaStream | null;
  isLocalMedia?: boolean;
  isScreenShare?: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onAction: (participant: RoomParticipant, action: ParticipantAction) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = mediaStream || null;
  }, [mediaStream]);

  return (
    <article className={cn('meeting-room-video-card', participant.spotlight && 'is-spotlight', participant.blocked && 'is-blocked', participant.virtualBackground && 'has-virtual-background', participant.visualEffects && 'has-visual-effects')}>
      {mediaStream && participant.camera ? (
        <video ref={videoRef} className="meeting-room-video-stream" autoPlay playsInline muted={Boolean(isLocalMedia)} />
      ) : participant.camera ? (
        <img src={participant.avatar} alt={participant.name} />
      ) : (
        <div className="meeting-room-camera-off">{getInitials(participant.name)}<small>Camera desactivee</small></div>
      )}
      {isScreenShare && <span className="meeting-room-screen-badge">Partage d'ecran</span>}
      <button type="button" className="meeting-room-dots" aria-label={`Options ${participant.name}`} onClick={onMenu}><MoreVertical size={18} /></button>
      {menuOpen && <ParticipantMenu participant={participant} onAction={onAction} />}
      <button type="button" className="meeting-room-name-tag" onClick={onMenu}>
        <span>{participant.name.replace(' (Vous)', '')}</span>
        {participant.muted ? <MicOff size={15} className="is-off" /> : <Mic size={15} className="is-on" />}
      </button>
    </article>
  );
}

function MiniUser({ participant, onClick }: { participant: RoomParticipant; onClick: () => void }) {
  return (
    <button type="button" className={cn('meeting-room-mini-user', participant.blocked && 'is-blocked')} onClick={onClick}>
      {participant.camera ? <img src={participant.avatar} alt={participant.name} /> : <span>{getInitials(participant.name)}</span>}
      <p>{participant.name.replace(' (Vous)', '')}</p>
      {participant.muted && <MicOff size={13} />}
    </button>
  );
}

function Control({ icon, label, badge, active, disabled, onClick }: { icon: ReactNode; label: string; badge?: string; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={cn('meeting-room-control', active && 'is-active')} disabled={disabled} onClick={onClick} aria-pressed={Boolean(active)}>
      <span>{icon}</span>
      <small>{label}</small>
      {badge && <b>{badge}</b>}
    </button>
  );
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="meeting-room-panel-header">
      <h2>{title}</h2>
      <button type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
    </header>
  );
}

function ChatPanel({
  tab,
  setTab,
  messages,
  draft,
  setDraft,
  onSend,
  files,
  pollOptions,
  pollActive,
  pollQuestion,
  myPollVote,
  onVote,
  onMention,
  onAttach,
  isHost,
  onTogglePoll,
  onClose,
}: {
  tab: ChatTab;
  setTab: (tab: ChatTab) => void;
  messages: RoomMessage[];
  draft: string;
  setDraft: (value: string) => void;
  onSend: (event: FormEvent) => void;
  files: SharedFile[];
  pollOptions: PollOption[];
  pollActive: boolean;
  pollQuestion: string;
  myPollVote: string | null;
  onVote: (label: string) => void;
  onMention: () => void;
  onAttach: () => void;
  isHost: boolean;
  onTogglePoll: () => void;
  onClose: () => void;
}) {
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const totalVotes = Math.max(1, pollOptions.reduce((total, option) => total + option.votes, 0));
  const currentVotes = pollOptions.reduce((total, option) => total + option.votes, 0);
  const quickEmojis = ['👍', '❤️', '😂', '👏', '🙏', '🔥'];
  const appendEmoji = (emoji: string) => {
    setDraft(`${draft}${draft ? ' ' : ''}${emoji}`);
    setEmojiPickerOpen(false);
  };

  return (
    <aside className="meeting-room-chat-panel">
      <PanelHeader title="Conversation" onClose={onClose} />
      <nav>
        <button type="button" className={tab === 'discussion' ? 'is-active' : ''} onClick={() => setTab('discussion')}>Discussion</button>
        <button type="button" className={tab === 'polls' ? 'is-active' : ''} onClick={() => setTab('polls')}>Sondages</button>
        <button type="button" className={tab === 'files' ? 'is-active' : ''} onClick={() => setTab('files')}>Fichiers</button>
      </nav>
      <div className="meeting-room-chat-list">
        {tab === 'discussion' && messages.map((message) => (
          <article className={message.sender === 'Vous' ? 'meeting-room-my-message' : 'meeting-room-chat-message'} key={message.id}>
            {message.sender !== 'Vous' && <img src={`https://i.pravatar.cc/80?u=${message.sender}`} alt={message.sender} />}
            <div>
              <strong>{message.sender} <small>{message.time}</small></strong>
              <p>{message.text}</p>
              <span>{message.reaction}</span>
            </div>
          </article>
        ))}
        {tab === 'polls' && (
          <div className="meeting-room-chat-tab-panel">
            <h3>{pollActive ? pollQuestion : 'Aucun sondage actif'}</h3>
            {pollActive && pollOptions.map((option) => (
              <button key={option.label} type="button" className={myPollVote === option.label ? 'is-active' : ''} onClick={() => onVote(option.label)}>
                <span>{option.label}</span>
                <b>{Math.round((option.votes / totalVotes) * 100)}%</b>
              </button>
            ))}
            <button type="button" className="meeting-room-chat-action" disabled={!isHost} onClick={onTogglePoll}>
              <Bell size={16} />
              <span>{pollActive ? 'Fermer le sondage' : 'Démarrer le sondage'}</span>
              <b>{isHost ? `${currentVotes} votes` : 'Hôte'}</b>
            </button>
          </div>
        )}
        {tab === 'files' && (
          <div className="meeting-room-chat-tab-panel">
            <button type="button" className="meeting-room-chat-action" onClick={onAttach}>
              <Paperclip size={16} />
              <span>Partager un fichier</span>
              <b>{files.length}</b>
            </button>
            {files.length === 0 && <p className="meeting-room-empty-state">Aucun fichier partagé pour le moment.</p>}
            {files.map((file) => (
              <button key={file.id} type="button" onClick={() => downloadSharedFile(file)}>
                <FileText size={16} />
                <span>{file.name}</span>
                <b>{file.type}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      <form className="meeting-room-chat-input" onSubmit={onSend}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ecrivez un message..." />
        <button type="button" onClick={() => setEmojiPickerOpen((value) => !value)} aria-label="Ouvrir les emojis"><Smile size={18} /></button>
        <button type="button" onClick={onMention} aria-label="Ajouter une mention"><AtSign size={18} /></button>
        <button type="button" onClick={onAttach} aria-label="Partager un fichier"><Paperclip size={18} /></button>
        <button type="submit" className="send" disabled={!draft.trim()} aria-label="Envoyer le message"><Send size={18} /></button>
        {emojiPickerOpen && (
          <div className="meeting-room-chat-emoji-popover">
            {quickEmojis.map((emoji) => (
              <button key={emoji} type="button" onClick={() => appendEmoji(emoji)}>{emoji}</button>
            ))}
          </div>
        )}
      </form>
    </aside>
  );
}

function LunaPanel({
  messages,
  draft,
  isThinking,
  setDraft,
  onAsk,
  onClose,
}: {
  messages: LunaMessage[];
  draft: string;
  isThinking: boolean;
  setDraft: (value: string) => void;
  onAsk: (prompt?: string) => void;
  onClose: () => void;
}) {
  const quickPrompts = [
    'Résume les points importants de cette réunion.',
    'Propose les prochaines actions et responsables.',
    'Aide-moi à formuler une décision claire.',
  ];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAsk();
  };

  return (
    <aside className="meeting-room-panel-card meeting-room-luna-panel">
      <PanelHeader title="Luna IA" onClose={onClose} />
      <div className="meeting-room-luna-hero">
        <span><Sparkles size={18} /></span>
        <div>
          <strong>Assistante MBotéRoom</strong>
          <p>Réponses liées à cette réunion, sans accès aux secrets ni à l’audio non fourni.</p>
        </div>
      </div>
      <div className="meeting-room-luna-suggestions">
        {quickPrompts.map((prompt) => (
          <button type="button" key={prompt} disabled={isThinking} onClick={() => onAsk(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="meeting-room-luna-list">
        {messages.map((message) => (
          <article key={message.id} className={message.sender === 'user' ? 'is-user' : 'is-luna'}>
            <strong>{message.sender === 'user' ? 'Vous' : 'Luna IA'}</strong>
            <p>{message.text}</p>
            {message.sender === 'luna' && message.configured === false && <small>Fournisseur IA non configuré ou indisponible.</small>}
          </article>
        ))}
        {isThinking && (
          <article className="is-luna">
            <strong>Luna IA</strong>
            <p>Luna réfléchit...</p>
          </article>
        )}
      </div>
      <form className="meeting-room-luna-input" onSubmit={submit}>
        <input
          value={draft}
          maxLength={1800}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Demander à Luna..."
        />
        <button type="submit" disabled={isThinking || !draft.trim()}><Send size={16} /></button>
      </form>
    </aside>
  );
}

function ParticipantsPanel({
  participants,
  totalParticipants = participants.length,
  search = '',
  onSearch,
  lobby,
  isHost,
  openMenuId,
  onToggleMenu,
  onAction,
  onMuteAll,
  onInvite,
  onMore,
  onRespond,
  onClose,
}: {
  participants: RoomParticipant[];
  totalParticipants?: number;
  search?: string;
  onSearch?: (value: string) => void;
  lobby: LobbyParticipant[];
  isHost: boolean;
  openMenuId: string | null;
  onToggleMenu: (id: string) => void;
  onAction: (participant: RoomParticipant, action: ParticipantAction) => void;
  onMuteAll: () => void;
  onInvite: () => void;
  onMore: () => void;
  onRespond: (participant: LobbyParticipant, status: 'accepted' | 'rejected') => void;
  onClose: () => void;
}) {
  return (
    <section className="meeting-room-panel-card">
      <PanelHeader title={`Participants (${totalParticipants})`} onClose={onClose} />
      <input className="meeting-room-search-input" value={search} onChange={(event) => onSearch?.(event.target.value)} placeholder="Rechercher un participant" />
      <div className="meeting-room-panel-line"><span>En réunion ({participants.length})</span><button type="button" onClick={onMuteAll}>Tous muets</button></div>
      {participants.map((participant) => (
        <div className={cn('meeting-room-participant-row', participant.blocked && 'is-blocked')} key={participant.id}>
          <img src={participant.avatar} alt={participant.name} />
          <strong>{participant.name}</strong>
          {participant.role && <em>{participant.role}</em>}
          {participant.muted ? <MicOff className="is-off" size={15} /> : <Mic className="is-on" size={15} />}
          {participant.camera ? <Video size={15} /> : <VideoOff size={15} />}
          <button type="button" onClick={() => onToggleMenu(participant.id)}><MoreVertical size={16} /></button>
          {openMenuId === participant.id && <ParticipantMenu participant={participant} onAction={onAction} />}
        </div>
      ))}
      {isHost && lobby.length > 0 && (
        <div className="meeting-room-lobby">
          <strong>En attente ({lobby.length})</strong>
          {lobby.map((item) => (
            <div key={item.user_id}>
              <span>{item.name}</span>
              <button type="button" onClick={() => onRespond(item, 'accepted')}>Accepter</button>
              <button type="button" onClick={() => onRespond(item, 'rejected')}>Refuser</button>
            </div>
          ))}
        </div>
      )}
      <footer className="meeting-room-panel-footer">
        <button type="button" onClick={onInvite}>Inviter</button>
        <button type="button" onClick={onMuteAll}>Couper tous les micros</button>
        <button type="button" onClick={onMore}>•••</button>
      </footer>
    </section>
  );
}

function ParticipantMenu({ participant, onAction }: { participant: RoomParticipant; onAction: (participant: RoomParticipant, action: ParticipantAction) => void }) {
  return (
    <div className="meeting-room-participant-menu">
      <button type="button" onClick={() => onAction(participant, participant.muted ? 'unmute' : 'mute')}>{participant.muted ? <Mic /> : <MicOff />} {participant.muted ? 'Rétablir micro' : 'Couper micro'}</button>
      <button type="button" onClick={() => onAction(participant, participant.camera ? 'camera-off' : 'camera-on')}>{participant.camera ? <VideoOff /> : <Video />} {participant.camera ? 'Couper caméra' : 'Ouvrir caméra'}</button>
      <button type="button" onClick={() => onAction(participant, 'request-mic')}><Bell /> Demander micro</button>
      <button type="button" onClick={() => onAction(participant, 'request-camera')}><Bell /> Demander caméra</button>
      <button type="button" onClick={() => onAction(participant, 'rename')}><Edit3 /> Renommer</button>
      <button type="button" onClick={() => onAction(participant, participant.role === 'Co-hôte' ? 'remove-cohost' : 'make-cohost')}><ShieldCheck /> {participant.role === 'Co-hôte' ? 'Retirer co-hôte' : 'Nommer co-hôte'}</button>
      <button type="button" onClick={() => onAction(participant, 'spotlight')}><Grid2X2 /> {participant.spotlight ? 'Retirer focus' : 'Mettre en focus'}</button>
      <button type="button" onClick={() => onAction(participant, participant.blocked ? 'unblock' : 'block')}><Lock /> {participant.blocked ? 'Débloquer' : 'Bloquer'}</button>
      {!participant.name.includes('(Vous)') && <button type="button" className="danger" onClick={() => onAction(participant, 'remove')}><UserX /> Supprimer</button>}
    </div>
  );
}

function DetailsPanel({
  meeting,
  settings,
  inviteLink,
  meetingId,
  isHost,
  onToggleSetting,
  onCopyInvite,
  onEndMeeting,
  onClose,
}: {
  meeting: Meeting;
  settings: Record<string, any>;
  inviteLink: string;
  meetingId: string;
  isHost: boolean;
  onToggleSetting: (key: BooleanMeetingSetting) => void;
  onCopyInvite: () => void;
  onEndMeeting: () => void;
  onClose: () => void;
}) {
  return (
    <section className="meeting-room-panel-card">
      <PanelHeader title="Détails de la réunion" onClose={onClose} />
      <h3>Informations</h3>
      <Info label="Titre" value={meeting.title} />
      <Info label="Hote" value={meeting.host_name || 'Vous'} />
      <Info label="ID de réunion" value={meetingId} />
      <Info label="Mot de passe" value={settings.password || 'Non defini'} />
      <Info label="Lien d'invitation" value="Copier le lien" purple onClick={onCopyInvite} />
      <h3>Options</h3>
      <SwitchRow label="Salle d'attente" active={settings.waitingRoom !== false} disabled={!isHost} onClick={() => onToggleSetting('waitingRoom')} />
      <SwitchRow label="Autoriser à rejoindre avant l'hôte" active={Boolean(settings.joinBeforeHost)} disabled={!isHost} onClick={() => onToggleSetting('joinBeforeHost')} />
      <SwitchRow label="Micro des participants" active={settings.participantAudio !== false} disabled={!isHost} onClick={() => onToggleSetting('participantAudio')} />
      <SwitchRow label="Camera des participants" active={settings.participantVideo !== false} disabled={!isHost} onClick={() => onToggleSetting('participantVideo')} />
      <SwitchRow label="Partage d'écran" active={settings.screenShare !== false} disabled={!isHost} onClick={() => onToggleSetting('screenShare')} />
      <SwitchRow label="Chiffrement" active={settings.encryption !== false} disabled={!isHost} onClick={() => onToggleSetting('encryption')} />
      <SwitchRow label="Discussion" active={settings.chat !== false} disabled={!isHost} onClick={() => onToggleSetting('chat')} />
      <SwitchRow label="Reactions" active={settings.reactions !== false} disabled={!isHost} onClick={() => onToggleSetting('reactions')} />
      <SwitchRow label="Enregistrement" active={Boolean(settings.recording)} disabled={!isHost || settings.encryption !== false} onClick={() => onToggleSetting('recording')} />
      <SwitchRow label="Partage du lien" active={Boolean(settings.linkSharing)} disabled={!isHost} onClick={() => onToggleSetting('linkSharing')} />
      <SwitchRow label="Acces elargi hors participants" active={Boolean(settings.externalAccess)} disabled={!isHost} onClick={() => onToggleSetting('externalAccess')} />
      <button className="meeting-room-end-btn" type="button" onClick={onEndMeeting}>Mettre fin à la réunion pour tous</button>
    </section>
  );
}

function FilesPanel({ files, showAll, onToggleAll, onUpload, onClose }: { files: SharedFile[]; showAll: boolean; onToggleAll: () => void; onUpload: () => void; onClose: () => void }) {
  return (
    <section className="meeting-room-panel-card meeting-room-small-panel">
      <PanelHeader title="Fichiers partages" onClose={onClose} />
      <button className="meeting-room-upload-btn" type="button" onClick={onUpload}><Upload size={16} /> Partager un fichier</button>
      {files.length === 0 && <p className="meeting-room-empty-state">Aucun fichier partage pour le moment.</p>}
      {files.map((file) => <FileRow key={file.id} name={file.name} type={file.type} url={file.url} />)}
      <button className="meeting-room-link-btn" type="button" onClick={onToggleAll}>{showAll ? 'Reduire' : 'Voir tous les fichiers'}</button>
    </section>
  );
}

function PollPanel({
  isHost,
  active,
  question,
  options,
  myVote,
  onQuestionChange,
  onVote,
  onOptionChange,
  onAddOption,
  onRemoveOption,
  onToggleActive,
  onClose,
}: {
  isHost: boolean;
  active: boolean;
  question: string;
  options: PollOption[];
  myVote: string | null;
  onQuestionChange: (value: string) => void;
  onVote: (label: string) => void;
  onOptionChange: (index: number, label: string) => void;
  onAddOption: () => void;
  onRemoveOption: (index: number) => void;
  onToggleActive: () => void;
  onClose: () => void;
}) {
  const totalVotes = options.reduce((total, option) => total + option.votes, 0);
  const canEdit = isHost && !active;
  return (
    <section className="meeting-room-panel-card meeting-room-small-panel">
      <PanelHeader title={active ? 'Sondage en cours' : 'Sondage ferme'} onClose={onClose} />
      {isHost ? (
        <input className="meeting-room-poll-question" value={question} onChange={(event) => onQuestionChange(event.target.value)} disabled={active} placeholder="Question du sondage" />
      ) : (
        <h3>{question}</h3>
      )}
      {canEdit && (
        <div className="meeting-room-poll-builder">
          {options.map((poll, index) => (
            <label key={`${poll.label}-${index}`}>
              <span>Option {index + 1}</span>
              <input value={poll.label} onChange={(event) => onOptionChange(index, event.target.value)} placeholder={`Option ${index + 1}`} />
              <button type="button" disabled={options.length <= 2} onClick={() => onRemoveOption(index)} aria-label="Supprimer l'option"><X size={15} /></button>
            </label>
          ))}
          <button type="button" className="meeting-room-poll-add" onClick={onAddOption}>Ajouter une option</button>
        </div>
      )}
      {!canEdit && options.map((poll) => (
        <Poll key={poll.label} label={poll.label} value={totalVotes ? Math.round((poll.votes / totalVotes) * 100) : 0} active={myVote === poll.label} disabled={!active} onClick={() => onVote(poll.label)} />
      ))}
      <div className="meeting-room-poll-footer"><span>{totalVotes} votes</span><button type="button" disabled={!isHost && !active} onClick={onToggleActive}>{active ? 'Fermer le sondage' : 'Démarrer le sondage'}</button></div>
    </section>
  );
}

function ReactionsPanel({ activeReaction, onSelect, onClose }: { activeReaction: string | null; onSelect: (value: string) => void; onClose: () => void }) {
  const reactions = ['👍', '❤️', '😂', '😮', '😢', '👏', '+'];
  return (
    <section className="meeting-room-panel-card meeting-room-small-panel">
      <PanelHeader title="Emojis" onClose={onClose} />
      <div className="meeting-room-reactions-panel">
        {reactions.map((item) => (
          <button key={item} type="button" className={activeReaction === item ? 'is-active' : ''} onClick={() => onSelect(item)}>
            {item}
          </button>
        ))}
      </div>
      <p className="meeting-room-empty-state">Choisissez une réaction pour l’envoyer dans la conversation.</p>
    </section>
  );
}

function Info({ label, value, purple, onClick }: { label: string; value: string; purple?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="meeting-room-info-row" onClick={onClick}>
      <span>{label}</span>
      <strong className={purple ? 'purple' : ''}>{value}</strong>
    </button>
  );
}

function SwitchRow({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="meeting-room-switch-row">
      <span>{label}</span>
      <button
        type="button"
        disabled={disabled}
        className={active ? 'on' : ''}
        onClick={onClick}
        role="switch"
        aria-checked={active}
        aria-label={label}
      >
        <i />
      </button>
    </div>
  );
}

function FileRow({ name, type, url }: { name: string; type: string; url?: string }) {
  const downloadFile = () => {
    downloadSharedFile({ id: name, name, type, visible: true, url });
  };

  return (
    <div className="meeting-room-file-row">
      <FileText size={24} />
      <div><strong>{name}</strong><p>{type}</p></div>
      <button type="button" disabled={!url} onClick={downloadFile} aria-label={`Telecharger ${name}`}><Download size={17} /></button>
    </div>
  );
}

function downloadSharedFile(file: SharedFile) {
  if (!file.url) return;
  const link = document.createElement('a');
  link.href = file.url;
  link.download = file.name;
  link.rel = 'noopener noreferrer';
  link.click();
}

function Poll({ label, value, active, disabled, onClick }: { label: string; value: number; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn('meeting-room-poll-row', active && 'is-active')} disabled={disabled} onClick={onClick}>
      <div><span>{label}</span><b>{value}%</b></div>
      <p><i style={{ width: `${value}%` }} /></p>
    </button>
  );
}

function Dropdown({ className, children }: { className: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}

function ToggleMenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick}><Check size={16} className={active ? 'is-on' : 'is-muted'} /> {label}</button>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="meeting-room-modal-backdrop" role="dialog" aria-modal="true">
      <section className="meeting-room-modal-card">
        <header>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fermer"><X size={20} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').replace('(', '') || 'M';
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
