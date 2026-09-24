import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  Camera,
  CameraOff,
  Captions,
  Circle,
  Clock3,
  Hand,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Pin,
  PinOff,
  Radio,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  UsersRound,
  Volume2,
  Vote,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useMeetingMeshWebRTC } from '../hooks/useMeetingMeshWebRTC';
import { useMeetingLiveKit } from '../hooks/useMeetingLiveKit';
import { useMeetingCaptions } from '../hooks/useMeetingCaptions';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import { appDataService, type ClientPlatformSettings } from '../services/appDataService';
import {
  BreakoutRoom,
  collaborationService,
  MeetingMessage,
  MeetingParticipant,
  MeetingPoll,
} from '../services/collaborationService';
import { getMeetingAccessCode, getMeetingJoinUrl, LobbyParticipant, LunaCatchUpResponse, Meeting, MeetingMediaRequest, meetingService } from '../services/meetingService';
import { mediaTransportService, type MediaTransportStatus } from '../services/mediaTransportService';
import { createCompositeMeetingRecording, type CompositeRecordingSession } from '../lib/meetingRecording';
import { getAppLocale } from '../lib/appLanguage';
import { readCachedPreferences } from '../lib/userPreferences';
import './MeetingRoomV2.css';

type Panel = 'participants' | 'chat' | 'polls' | 'luna' | 'breakouts' | null;
type MeetingLocationState = {
  guestName?: string;
  joinOptions?: { mic?: boolean; camera?: boolean; backgroundUrl?: string };
  meeting?: Partial<Meeting>;
};

type DisplayCaptureMediaDevices = MediaDevices & {
  getDisplayMedia?: (options?: DisplayMediaStreamOptions) => Promise<MediaStream>;
};

type DisplayCaptureNavigator = Navigator & {
  getDisplayMedia?: (options?: DisplayMediaStreamOptions) => Promise<MediaStream>;
};

const requestDisplayCapture = async () => {
  const mediaDevices = navigator.mediaDevices as DisplayCaptureMediaDevices | undefined;
  const legacyNavigator = navigator as DisplayCaptureNavigator;
  const capture = mediaDevices?.getDisplayMedia
    ? mediaDevices.getDisplayMedia.bind(mediaDevices)
    : legacyNavigator.getDisplayMedia?.bind(legacyNavigator);

  if (!capture) {
    throw new DOMException('Screen capture is not supported by this browser.', 'NotSupportedError');
  }

  const touchDevice = navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches;
  const options: DisplayMediaStreamOptions = touchDevice
    ? { video: true, audio: false }
    : { video: { frameRate: { ideal: 15, max: 30 } }, audio: true };

  try {
    return await capture(options);
  } catch (error) {
    const errorName = error instanceof DOMException ? error.name : '';
    if (touchDevice || errorName === 'NotAllowedError' || errorName === 'AbortError') throw error;
    return capture({ video: true, audio: false });
  }
};

type VideoTileProps = {
  name: string;
  stream: MediaStream | null;
  avatar?: string;
  muted?: boolean;
  videoEnabled?: boolean;
  screen?: boolean;
  badge?: string;
  local?: boolean;
  audioOutputId?: string;
  activeSpeaker?: boolean;
  pinned?: boolean;
  handRaised?: boolean;
  reaction?: string;
  onPin?: () => void;
};

const initials = (value: string) => String(value || 'MB')
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

function VideoTile({ name, stream, avatar, muted, videoEnabled, screen, badge, local, audioOutputId, activeSpeaker, pinned, handRaised, reaction, onPin }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (!node) return;
    node.srcObject = stream;
    node.muted = Boolean(local);
    const mediaElement = node as HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> };
    if (!local && audioOutputId && typeof mediaElement.setSinkId === 'function') {
      void mediaElement.setSinkId(audioOutputId).catch(() => undefined);
    }
    const startPlayback = () => {
      if (videoRef.current !== node || node.srcObject !== stream) return;
      void node.play().catch(() => undefined);
    };
    node.addEventListener('loadedmetadata', startPlayback, { once: true });
    startPlayback();
  }, [audioOutputId, local, stream]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return undefined;
    let disposed = false;
    let recoveryTimer: number | null = null;
    let attempts = 0;

    const attach = (forceFresh = false) => {
      if (disposed || !stream) return;
      const nextStream = forceFresh
        ? new MediaStream(stream.getTracks().filter((track) => track.readyState === 'live'))
        : stream;
      if (forceFresh || node.srcObject !== nextStream) node.srcObject = nextStream;
      void node.play().catch(() => undefined);
    };

    const scheduleRecovery = () => {
      if (disposed || !stream || local || videoEnabled === false) return;
      if (node.readyState > 0 || node.videoWidth > 0) return;
      const liveVideo = stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);
      if (!liveVideo || attempts >= 4) return;
      recoveryTimer = window.setTimeout(() => {
        attempts += 1;
        attach(true);
        scheduleRecovery();
      }, attempts === 0 ? 450 : 900);
    };

    attach(false);
    scheduleRecovery();

    const tracks = stream?.getTracks() || [];
    const retry = () => {
      attempts = 0;
      attach(true);
      scheduleRecovery();
    };
    tracks.forEach((track) => track.addEventListener('unmute', retry));

    return () => {
      disposed = true;
      if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
      tracks.forEach((track) => track.removeEventListener('unmute', retry));
    };
  }, [local, stream, videoEnabled]);

  return (
    <article className={`room-v2-tile ${screen ? 'is-screen' : ''} ${activeSpeaker ? 'is-speaking' : ''} ${pinned ? 'is-pinned' : ''}`} data-speaking={activeSpeaker ? 'true' : 'false'}>
      {stream && videoEnabled !== false ? (
        <video ref={attachVideo} autoPlay playsInline muted={Boolean(local)} />
      ) : (
        <div className="room-v2-avatar" aria-label={`${name}, caméra coupée`}>
          {avatar ? <img src={avatar} alt="" /> : <span>{initials(name)}</span>}
        </div>
      )}
      {badge ? <span className="room-v2-role-badge">{badge}</span> : null}
      {handRaised ? <div className="room-v2-hand-overlay" aria-label="Main levée"><span><Hand/></span><div><strong>Main levée</strong><small>Demande de parole</small></div></div> : null}
      <div className="room-v2-tile-meta">
        <span>{name}{local ? ' (vous)' : ''}</span>
        {activeSpeaker ? <small className="speaker-badge">Parle</small> : null}
        {muted ? <MicOff size={15} aria-label="Micro coupé" /> : <Mic size={15} aria-label="Micro actif" />}
        {!muted ? <i className="room-v2-audio-bars" aria-hidden="true"><b/><b/><b/></i> : null}
      </div>
      {reaction ? <div className="room-v2-reaction-bubble" aria-label={`Réaction ${reaction}`}>{reaction}</div> : null}
      {!local && onPin ? (
        <button
          type="button"
          className="room-v2-pin"
          data-testid={pinned ? 'unpin-participant' : 'pin-participant'}
          onClick={onPin}
          aria-label={pinned ? `Désépingler ${name}` : `Épingler ${name}`}
          title={pinned ? 'Désépingler' : 'Épingler'}
        >
          {pinned ? <PinOff size={15}/> : <Pin size={15}/>}
        </button>
      ) : null}
    </article>
  );
}

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getAppLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
};

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':')
    : [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
};

const dedupeMessages = (items: MeetingMessage[]) => {
  const map = new Map(items.map((message) => [message.id, message]));
  return [...map.values()].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
};

const normalizeMediaRequest = (payload: any): MeetingMediaRequest | null => {
  const id = String(payload?.id || '');
  const meetingId = Number(payload?.meetingId ?? payload?.meeting_id ?? 0);
  const targetUserId = Number(payload?.targetUserId ?? payload?.target_user_id ?? 0);
  const requestedBy = Number(payload?.requestedBy ?? payload?.requested_by ?? 0);
  const kind = payload?.kind === 'camera' ? 'camera' : payload?.kind === 'mic' ? 'mic' : null;
  const status = ['pending','accepted','rejected'].includes(payload?.status) ? payload.status : 'pending';
  if (!id || !meetingId || !targetUserId || !requestedBy || !kind) return null;
  return {
    id,
    meetingId,
    targetUserId,
    requestedBy,
    requestedByName: String(payload?.requestedByName ?? payload?.requested_by_name ?? ''),
    kind,
    status,
    createdAt: String(payload?.createdAt ?? payload?.created_at ?? new Date().toISOString()),
    respondedAt: payload?.respondedAt ?? payload?.responded_at ?? undefined,
  };
};

export default function MeetingRoomV2() {
  const navigate = useNavigate();
  const location = useLocation();
  const { meetingId = '' } = useParams();
  const state = location.state as MeetingLocationState | null;
  const currentUser = authService.getCurrentUser();
  const isAuthenticated = authService.isAuthenticated();
  const userPreferences = readCachedPreferences();
  const initialMic = state?.joinOptions?.mic !== undefined ? state.joinOptions.mic !== false : userPreferences.defaultMic !== false;
  const initialCamera = state?.joinOptions?.camera !== undefined ? state.joinOptions.camera !== false : userPreferences.defaultCamera !== false;

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingSessionRef = useRef<CompositeRecordingSession | null>(null);
  const recordingStartedAtRef = useRef(0);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>('participants');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [participantSearch, setParticipantSearch] = useState('');
  const [clockTick, setClockTick] = useState(Date.now());
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [selectedVideoInputId, setSelectedVideoInputId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [viewMode, setViewMode] = useState<'participants' | 'gallery' | 'speaker'>('gallery');
  const [pinnedSocketId, setPinnedSocketId] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(initialMic);
  const [cameraEnabled, setCameraEnabled] = useState(initialCamera);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<'local' | 'server' | null>(null);
  const [serverRecordingId, setServerRecordingId] = useState<string | null>(null);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<number>>(new Set());
  const [raisedHandTimes, setRaisedHandTimes] = useState<Record<number,string>>({});
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const reactionTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const [reactionPanelOpen, setReactionPanelOpen] = useState(false);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [lobbyParticipants, setLobbyParticipants] = useState<LobbyParticipant[]>([]);
  const [breakoutRooms, setBreakoutRooms] = useState<BreakoutRoom[]>([]);
  const [breakoutRoomId, setBreakoutRoomId] = useState<string | null>(null);
  const [breakoutRoomName, setBreakoutRoomName] = useState('');
  const [breakoutCount, setBreakoutCount] = useState(2);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [polls, setPolls] = useState<MeetingPoll[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [lunaPrompt, setLunaPrompt] = useState('');
  const [lunaAnswer, setLunaAnswer] = useState('');
  const [lunaLoading, setLunaLoading] = useState(false);
  const [catchUp, setCatchUp] = useState<LunaCatchUpResponse | null>(null);
  const [catchUpLoading, setCatchUpLoading] = useState(false);
  const [catchUpMinutes, setCatchUpMinutes] = useState(15);
  const [catchUpDismissed, setCatchUpDismissed] = useState(false);
  const [menuUserId, setMenuUserId] = useState<number | null>(null);
  const [mediaTransportStatus, setMediaTransportStatus] = useState<MediaTransportStatus | null>(null);
  const [mediaTransportChecked, setMediaTransportChecked] = useState(false);
  const [platformSettings, setPlatformSettings] = useState<ClientPlatformSettings | null>(null);
  const [liveKitFailed, setLiveKitFailed] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(userPreferences.lunaRealtimeTranslation === true);
  const [pendingMediaRequest, setPendingMediaRequest] = useState<MeetingMediaRequest | null>(null);

  const localUserId = String(currentUser?.id || '');
  const localName = state?.guestName?.trim() || currentUser?.name || currentUser?.username || currentUser?.email || 'Participant';
  const localMember = participants.find((participant) => participant.userId === Number(currentUser?.id || 0));
  const isHost = Boolean(meeting && currentUser && Number(meeting.host_id) === Number(currentUser.id));
  const isCoHost = Boolean(meeting && currentUser && (
    Number(meeting.co_host_id || 0) === Number(currentUser.id)
    || localMember?.role === 'cohost'
  ));
  const isAdmin = currentUser?.role === 'admin';
  const isModerator = Boolean(meeting && currentUser && (isHost || isCoHost || isAdmin));
  const guestMode = currentUser?.isGuest === true;
  const guestRaiseHandAllowed = !guestMode || platformSettings?.guestRaiseHandEnabled === true;
  const guestRecordingAllowed = !guestMode || platformSettings?.guestRecordingEnabled === true;
  const guestScreenShareAllowed = !guestMode || platformSettings?.guestScreenShareEnabled === true;
  const guestLunaAllowed = !guestMode || platformSettings?.guestLunaEnabled === true;
  const guestTranscriptionAllowed = !guestMode || platformSettings?.guestTranscriptionEnabled === true;
  const guestChatAllowed = !guestMode || platformSettings?.guestChatEnabled === true;
  const canUseMic = Boolean(meeting && (isModerator || meeting.settings?.participantAudio !== false));
  const canUseCamera = Boolean(meeting && meeting.settings?.callType !== 'audio' && (isModerator || meeting.settings?.participantVideo !== false));
  const canShareScreen = Boolean(meeting && guestScreenShareAllowed && (isModerator || meeting.settings?.screenShare !== false));
  const canUseReactions = Boolean(meeting && (isModerator || meeting.settings?.reactions !== false));
  const canUseChat = Boolean(meeting && guestChatAllowed && meeting.settings?.chat !== false);
  const canUseLuna = Boolean(meeting && guestLunaAllowed && (isModerator || meeting.settings?.lunaSummary !== false));
  const canUseTranscription = Boolean(meeting && guestTranscriptionAllowed);
  const canRecord = Boolean(meeting && guestRecordingAllowed && (isModerator || meeting.settings?.recording === true));
  const canCreatePoll = isModerator;
  const canEndForAll = Boolean(meeting && currentUser && (isHost || isAdmin));

  const refreshMediaDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMediaDevices(devices);
      const currentAudioId = cameraStreamRef.current?.getAudioTracks()[0]?.getSettings().deviceId;
      const currentVideoId = cameraStreamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
      if (currentAudioId) setSelectedAudioInputId(currentAudioId);
      if (currentVideoId) setSelectedVideoInputId(currentVideoId);
    } catch {
      // Device labels may be unavailable until permission is granted.
    }
  }, []);

  const mediaState = useMemo(() => {
    const micActive = canUseMic && micEnabled && Boolean(cameraStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled));
    const screenAudioActive = canShareScreen && screenSharing && Boolean(screenStreamRef.current?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled));
    return {
      audio: micActive || screenAudioActive,
      video: canUseCamera && !screenSharing && cameraEnabled && Boolean(cameraStreamRef.current?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled)),
      screen: canShareScreen && screenSharing,
    };
  }, [cameraEnabled, canShareScreen, canUseCamera, canUseMic, localStream, micEnabled, screenSharing]);

  const mediaEnabled = Boolean(meeting?.id && localUserId && isAuthenticated && mediaReady);
  const liveKitDesired = Boolean(
    mediaTransportChecked
    && mediaTransportStatus?.livekitReady
    && mediaTransportStatus.preferredMode === 'livekit'
    && !liveKitFailed
  );

  const handleLiveKitFailure = useCallback((message: string) => {
    setLiveKitFailed(true);
    setNotice(message);
  }, []);

  const liveKitMedia = useMeetingLiveKit({
    meetingId: meeting?.id || 0,
    breakoutRoomId,
    localStream,
    media: mediaState,
    enabled: mediaEnabled && liveKitDesired,
    onNotice: setNotice,
    onFailure: handleLiveKitFailure,
  });

  const meshMedia = useMeetingMeshWebRTC({
    meetingId: meeting?.id || 0,
    localUserId,
    localName,
    localAvatar: currentUser?.avatar || '',
    localStream,
    media: mediaState,
    breakoutRoomId,
    enabled: mediaEnabled,
    peerConnectionsEnabled: mediaTransportChecked && !liveKitDesired,
    onNotice: setNotice,
  });

  const usingLiveKit = liveKitDesired && !liveKitMedia.failed;
  const remoteParticipants = usingLiveKit ? liveKitMedia.remoteParticipants : meshMedia.remoteParticipants;
  const networkQuality = usingLiveKit ? liveKitMedia.networkQuality : meshMedia.networkQuality;
  const activeSpeakerSocketId = usingLiveKit ? liveKitMedia.activeSpeakerSocketId : meshMedia.activeSpeakerSocketId;

  const summaryTranscriptionEnabled = Boolean(meeting?.id && meeting.settings?.lunaSummary !== false && canUseTranscription);
  const liveCaptions = useMeetingCaptions({
    meetingId: meeting?.id || 0,
    enabled: Boolean(meeting?.id) && (captionsEnabled || summaryTranscriptionEnabled),
    audioStream: cameraStreamRef.current || localStream,
    breakoutRoomId,
    language: getAppLocale(),
    onNotice: captionsEnabled ? setNotice : undefined,
  });

  const loadMeeting = useCallback(async () => {
    if (!isAuthenticated) {
      navigate('/rejoindre-une-reunion', { replace: true });
      return;
    }
    setLoading(true);
    setError('');
    try {
      let found: Meeting | null = null;
      if (/^\d+$/.test(meetingId)) {
        const list = await meetingService.getMeetings();
        found = list.find((item) => String(item.id) === meetingId) || null;
      } else if (meetingId) {
        found = await meetingService.getMeetingByLink(meetingId);
      }
      if (!found && state?.meeting?.id) found = state.meeting as Meeting;
      if (!found) throw new Error('Réunion introuvable ou inaccessible.');

      const lobby = await meetingService.getLobby(found.id).catch(() => []);
      const ownLobby = lobby.find((item) => String(item.user_id) === String(currentUser?.id || ''));
      if (currentUser?.isGuest && ownLobby?.status === 'requested') {
        navigate(`/reunions/${found.meeting_link}/salle-attente`, { replace: true, state: location.state });
        return;
      }
      if (currentUser?.isGuest && ownLobby?.status === 'rejected') throw new Error('L’hôte a refusé votre demande d’accès.');
      setMeeting(found);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de charger la réunion.');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, currentUser?.isGuest, isAuthenticated, location.state, meetingId, navigate, state?.meeting]);

  useEffect(() => { void loadMeeting(); }, [loadMeeting]);

  useEffect(() => {
    if (!meeting?.is_active) return undefined;
    setClockTick(Date.now());
    const timer = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [meeting?.is_active, meeting?.id]);

  useEffect(() => {
    let cancelled = false;
    const refreshPlatformSettings = async () => {
      try {
        const next = await appDataService.getPlatformSettings();
        if (!cancelled) setPlatformSettings(next);
      } catch {
        if (!cancelled && currentUser?.isGuest) setPlatformSettings(null);
      }
    };
    void refreshPlatformSettings();
    const interval = window.setInterval(() => void refreshPlatformSettings(), 30_000);
    const onSettingsUpdated = (next: ClientPlatformSettings) => {
      if (!cancelled && next && typeof next === 'object') setPlatformSettings(next);
    };
    socket.on('admin:settings-updated', onSettingsUpdated);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      socket.off('admin:settings-updated', onSettingsUpdated);
    };
  }, [currentUser?.isGuest]);

  useEffect(() => {
    if (!canUseTranscription && captionsEnabled) setCaptionsEnabled(false);
  }, [canUseTranscription, captionsEnabled]);

  useEffect(() => {
    if (!guestRaiseHandAllowed && handRaised && meeting?.id) {
      setHandRaised(false);
      setRaisedHands((current) => {
        const next = new Set(current);
        next.delete(Number(currentUser?.id || 0));
        return next;
      });
      socket.emit('meeting:hand-raised', { meetingId: meeting.id, raised: false });
    }
    if (!canUseLuna && panel === 'luna') setPanel(null);
  }, [canUseLuna, currentUser?.id, guestRaiseHandAllowed, handRaised, meeting?.id, panel]);

  useEffect(() => {
    let cancelled = false;
    setMediaTransportChecked(false);
    void mediaTransportService.getStatus()
      .then((status) => {
        if (cancelled) return;
        setMediaTransportStatus(status);
        setLiveKitFailed(false);
      })
      .catch(() => {
        if (!cancelled) setMediaTransportStatus(null);
      })
      .finally(() => {
        if (!cancelled) setMediaTransportChecked(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setLiveKitFailed(false);
  }, [meeting?.id]);


  useEffect(() => {
    if (!meeting?.id) return;
    let cancelled = false;
    const load = async () => {
      const [memberRows, chatRows, pollRows, lobbyRows, breakoutRows] = await Promise.all([
        collaborationService.getParticipants(meeting.id).catch(() => []),
        collaborationService.getMessages(meeting.id).catch(() => []),
        collaborationService.getPolls(meeting.id).catch(() => []),
        isModerator ? meetingService.getLobby(meeting.id).catch(() => []) : Promise.resolve([]),
        collaborationService.getBreakoutRooms(meeting.id).catch(() => []),
      ]);
      if (cancelled) return;
      setParticipants(memberRows);
      setMessages(dedupeMessages(chatRows));
      setPolls(pollRows);
      setLobbyParticipants(lobbyRows.filter((item) => item.status === 'requested'));
      setBreakoutRooms(breakoutRows);
    };
    void load();
    return () => { cancelled = true; };
  }, [isModerator, meeting?.id]);

  useEffect(() => {
    if (!meeting?.id) return undefined;
    setMediaReady(false);

    const audioRequested = initialMic && (isModerator || meeting.settings?.participantAudio !== false);
    const videoRequested = meeting.settings?.callType !== 'audio' && initialCamera && (isModerator || meeting.settings?.participantVideo !== false);

    if (!audioRequested && !videoRequested) {
      const emptyStream = new MediaStream();
      cameraStreamRef.current = emptyStream;
      setLocalStream(emptyStream);
      setMicEnabled(false);
      setCameraEnabled(false);
      setMediaReady(true);
      return () => {
        cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      };
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('Votre navigateur ne permet pas l’accès à la caméra ou au microphone.');
      setMediaReady(true);
      return undefined;
    }

    let cancelled = false;
    const openMedia = async () => {
      try {
        const dataSaver = userPreferences.dataSaver === true;
        const hdVideo = userPreferences.hdVideo !== false && !dataSaver;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioRequested ? {
            echoCancellation: true,
            noiseSuppression: userPreferences.noiseReduction !== false,
            autoGainControl: true,
            channelCount: { ideal: 1 },
          } : false,
          video: videoRequested
            ? {
                width: { ideal: hdVideo ? 1280 : 640 },
                height: { ideal: hdVideo ? 720 : 360 },
                frameRate: { ideal: dataSaver ? 15 : 30, max: dataSaver ? 20 : 30 },
              }
            : false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => { track.enabled = audioRequested; });
        stream.getVideoTracks().forEach((track) => { track.enabled = videoRequested; });
        cameraStreamRef.current = stream;
        setLocalStream(stream);
        setMicEnabled(audioRequested);
        setCameraEnabled(videoRequested);
        setMediaReady(true);
        void refreshMediaDevices();
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : '';
        const requestedLabel = audioRequested && videoRequested ? 'la caméra et le microphone' : audioRequested ? 'le microphone' : 'la caméra';
        setNotice(name === 'NotAllowedError'
          ? `Autorisez ${requestedLabel} dans votre navigateur pour l’utiliser dans la réunion.`
          : `${requestedLabel.charAt(0).toUpperCase() + requestedLabel.slice(1)} indisponible. Vous pouvez rester dans la réunion sans ce média.`);
        if (!cancelled) {
          cameraStreamRef.current = new MediaStream();
          setLocalStream(cameraStreamRef.current);
          setMicEnabled(false);
          setCameraEnabled(false);
          setMediaReady(true);
        }
      }
    };
    void openMedia();
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    };
  }, [meeting?.id, initialCamera, initialMic, refreshMediaDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    const handleDeviceChange = () => { void refreshMediaDevices(); };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [refreshMediaDevices]);

  const refreshParticipants = useCallback(async () => {
    if (!meeting?.id) return;
    setParticipants(await collaborationService.getParticipants(meeting.id).catch(() => []));
  }, [meeting?.id]);

  const refreshLobby = useCallback(async () => {
    if (!meeting?.id || !isModerator) return;
    const rows = await meetingService.getLobby(meeting.id).catch(() => []);
    setLobbyParticipants(rows.filter((item) => item.status === 'requested'));
  }, [isModerator, meeting?.id]);

  const refreshBreakouts = useCallback(async () => {
    if (!meeting?.id) return;
    setBreakoutRooms(await collaborationService.getBreakoutRooms(meeting.id).catch(() => []));
  }, [meeting?.id]);

  useEffect(() => {
    if (!meeting?.id || isModerator) {
      setPendingMediaRequest(null);
      return;
    }
    void meetingService.getMediaRequests(meeting.id)
      .then((requests) => {
        const pending = requests.find((request) =>
          request.status === 'pending'
          && Number(request.targetUserId) === Number(currentUser?.id || 0)
        ) || null;
        setPendingMediaRequest(pending);
      })
      .catch(() => undefined);
  }, [currentUser?.id, isModerator, meeting?.id]);

  useEffect(() => {
    if (!meeting?.id) return;
    const id = meeting.id;
    const onChat = (message: MeetingMessage) => setMessages((current) => dedupeMessages([...current, message]));
    const onChatDeleted = ({ messageId }: { messageId: string }) => setMessages((current) => current.filter((message) => message.id !== messageId));
    const onPoll = (poll: MeetingPoll) => setPolls((current) => [poll, ...current.filter((item) => item.id !== poll.id)]);
    const onPresence = () => void refreshParticipants();
    const onLobby = () => { void refreshParticipants(); void refreshLobby(); };
    const onHandRaised = (payload: { meetingId: number; userId: number; raised: boolean; raisedAt?: string | null }) => {
      if (Number(payload.meetingId) !== id) return;
      const userId = Number(payload.userId);
      setRaisedHands((current) => {
        const next = new Set(current);
        if (payload.raised) next.add(userId);
        else next.delete(userId);
        return next;
      });
      setRaisedHandTimes((current) => {
        const next = { ...current };
        if (payload.raised) next[userId] = String(payload.raisedAt || new Date().toISOString());
        else delete next[userId];
        return next;
      });
    };
    const onHandsSnapshot = (payload: { meetingId:number; hands?: Array<{userId:number;raisedAt?:string}> }) => {
      if (Number(payload.meetingId) !== id) return;
      const hands = Array.isArray(payload.hands) ? payload.hands : [];
      setRaisedHands(new Set(hands.map((item) => Number(item.userId))));
      const times: Record<number,string> = {};
      hands.forEach((item) => { if (item.raisedAt) times[Number(item.userId)] = String(item.raisedAt); });
      setRaisedHandTimes(times);
    };
    const onReaction = (payload: { meetingId: number; userId: number; reaction: string }) => {
      if (Number(payload.meetingId) !== id || !payload.reaction) return;
      const userId = Number(payload.userId);
      setReactions((current) => ({ ...current, [userId]: payload.reaction }));
      const previous = reactionTimersRef.current.get(userId);
      if (previous) clearTimeout(previous);
      const timer = setTimeout(() => {
        setReactions((current) => {
          const next = { ...current };
          delete next[userId];
          return next;
        });
        reactionTimersRef.current.delete(userId);
      }, 4000);
      reactionTimersRef.current.set(userId, timer);
    };
    const onBreakoutAssigned = (payload: { meetingId: number; breakoutRoomId: string | null; breakoutRoomName?: string; isOpen?: boolean }) => {
      if (Number(payload.meetingId) !== id) return;
      if (payload.isOpen === false || !payload.breakoutRoomId) {
        setBreakoutRoomId(null);
        setBreakoutRoomName('');
        setNotice('Retour dans la réunion principale.');
        return;
      }
      setBreakoutRoomId(String(payload.breakoutRoomId));
      setBreakoutRoomName(String(payload.breakoutRoomName || 'Sous-salle'));
      setNotice(`Vous rejoignez la sous-salle « ${payload.breakoutRoomName || 'Sous-salle'} ».`);
    };
    const onBreakoutsUpdated = () => void refreshBreakouts();
    const onLocked = (payload: { meetingId: number; locked: boolean }) => {
      if (Number(payload.meetingId) !== id) return;
      setMeeting((current) => current ? { ...current, settings: { ...(current.settings || {}), locked: Boolean(payload.locked) } } : current);
      setNotice(payload.locked ? 'La réunion a été verrouillée par l’hôte.' : 'La réunion a été déverrouillée.');
    };
    const onMeetingUpdated = (payload: Meeting) => {
      if (Number(payload?.id) !== id) return;
      setMeeting((current) => current ? { ...current, ...payload, settings: { ...(current.settings || {}), ...(payload.settings || {}) } } : payload);
    };
    const onMediaRequest = (payload: any) => {
      const request = normalizeMediaRequest(payload);
      if (!request || request.meetingId !== id || request.targetUserId !== Number(currentUser?.id || 0) || request.status !== 'pending') return;
      setPendingMediaRequest(request);
    };
    const onMediaRequestResponded = (payload: any) => {
      const request = normalizeMediaRequest(payload);
      if (!request || request.meetingId !== id || request.requestedBy !== Number(currentUser?.id || 0)) return;
      setNotice(request.status === 'accepted'
        ? `Le participant a accepté d’activer ${request.kind === 'mic' ? 'son microphone' : 'sa caméra'}.`
        : `Le participant a refusé d’activer ${request.kind === 'mic' ? 'son microphone' : 'sa caméra'}.`);
      void refreshParticipants();
    };
    const onModeration = (payload: { meetingId:number; mutedByHost?:boolean; cameraDisabledByHost?:boolean; role?:string }) => {
      if (Number(payload.meetingId) !== id) return;
      if (payload.mutedByHost === true) {
        cameraStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
        setMicEnabled(false);
        setNotice('L’hôte a coupé votre microphone.');
      }
      if (payload.cameraDisabledByHost === true) {
        cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = false; });
        setCameraEnabled(false);
        setNotice('L’hôte a désactivé votre caméra.');
      }
      void refreshParticipants();
    };
    const leaveByHost = (message: string) => {
      setNotice(message);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      navigate(`/reunions/${id}/terminee`, { replace: true });
    };
    const onEnded = () => leaveByHost('La réunion a été terminée par l’hôte.');
    const onCancelled = () => leaveByHost('La réunion a été annulée par l’hôte.');
    const onRemoved = () => leaveByHost('Vous avez été retiré de la réunion.');
    const onBanned = () => leaveByHost('Vous avez été exclu de cette réunion.');
    const onMoved = () => navigate(`/reunions/${id}/salle-attente`, { replace: true, state: location.state });

    socket.on('meeting:chat-message', onChat);
    socket.on('meeting:chat-deleted', onChatDeleted);
    socket.on('meeting:poll-updated', onPoll);
    socket.on('meeting:presence', onPresence);
    socket.on('meeting:lobby-updated', onLobby);
    socket.on('meeting:hand-raised', onHandRaised);
    socket.on('meeting:hands-snapshot', onHandsSnapshot);
    socket.emit('meeting:hands-request', { meetingId:id });
    socket.on('meeting:reaction', onReaction);
    socket.on('meeting:breakout-assigned', onBreakoutAssigned);
    socket.on('meeting:breakouts-updated', onBreakoutsUpdated);
    socket.on('meeting:breakouts-opened', onBreakoutsUpdated);
    socket.on('meeting:breakouts-closed', onBreakoutsUpdated);
    socket.on('meeting:locked', onLocked);
    socket.on('meeting:updated', onMeetingUpdated);
    socket.on('meeting:media-request', onMediaRequest);
    socket.on('meeting:media-request-responded', onMediaRequestResponded);
    socket.on('meeting:moderation', onModeration);
    socket.on('meeting:ended', onEnded);
    socket.on('meeting:cancelled', onCancelled);
    socket.on('meeting:removed', onRemoved);
    socket.on('meeting:banned', onBanned);
    socket.on('meeting:moved-to-lobby', onMoved);
    return () => {
      socket.off('meeting:chat-message', onChat);
      socket.off('meeting:chat-deleted', onChatDeleted);
      socket.off('meeting:poll-updated', onPoll);
      socket.off('meeting:presence', onPresence);
      socket.off('meeting:lobby-updated', onLobby);
      socket.off('meeting:hand-raised', onHandRaised);
      socket.off('meeting:hands-snapshot', onHandsSnapshot);
      socket.off('meeting:reaction', onReaction);
      socket.off('meeting:breakout-assigned', onBreakoutAssigned);
      socket.off('meeting:breakouts-updated', onBreakoutsUpdated);
      socket.off('meeting:breakouts-opened', onBreakoutsUpdated);
      socket.off('meeting:breakouts-closed', onBreakoutsUpdated);
      socket.off('meeting:locked', onLocked);
      socket.off('meeting:updated', onMeetingUpdated);
      socket.off('meeting:media-request', onMediaRequest);
      socket.off('meeting:media-request-responded', onMediaRequestResponded);
      socket.off('meeting:moderation', onModeration);
      reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
      reactionTimersRef.current.clear();
      socket.off('meeting:ended', onEnded);
      socket.off('meeting:cancelled', onCancelled);
      socket.off('meeting:removed', onRemoved);
      socket.off('meeting:banned', onBanned);
      socket.off('meeting:moved-to-lobby', onMoved);
    };
  }, [currentUser?.id, location.state, meeting?.id, navigate, refreshBreakouts, refreshLobby, refreshParticipants]);

  const requestMissingMediaTrack = useCallback(async (kind: 'audio' | 'video') => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia(kind === 'audio'
        ? {
            audio: {
              deviceId: selectedAudioInputId ? { exact: selectedAudioInputId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: { ideal: 1 },
            },
            video: false,
          }
        : {
            audio: false,
            video: {
              deviceId: selectedVideoInputId ? { exact: selectedVideoInputId } : undefined,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
          });
      const nextTrack = kind === 'audio' ? fresh.getAudioTracks()[0] : fresh.getVideoTracks()[0];
      if (!nextTrack) return false;
      nextTrack.enabled = true;

      const existing = cameraStreamRef.current;
      const preserved = (existing?.getTracks() || []).filter((track) => track.kind !== kind && track.readyState === 'live');
      existing?.getTracks().filter((track) => track.kind === kind).forEach((track) => track.stop());
      const nextCameraStream = new MediaStream([...preserved, nextTrack]);
      cameraStreamRef.current = nextCameraStream;

      if (!screenSharing) {
        setLocalStream(nextCameraStream);
      } else if (kind === 'audio' && screenStreamRef.current) {
        const combined = new MediaStream();
        screenStreamRef.current.getVideoTracks().filter((track) => track.readyState === 'live').forEach((track) => combined.addTrack(track));
        const displayAudio = screenStreamRef.current.getAudioTracks().filter((track) => track.readyState === 'live');
        [nextTrack, ...displayAudio].forEach((track) => combined.addTrack(track));
        setLocalStream(combined);
      }

      await refreshMediaDevices();
      return true;
    } catch (cause) {
      const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
      setNotice(denied
        ? `Autorisez le ${kind === 'audio' ? 'microphone' : 'caméra'} dans votre navigateur puis réessayez.`
        : `Impossible d’activer ${kind === 'audio' ? 'le microphone' : 'la caméra'}.`);
      return false;
    }
  }, [refreshMediaDevices, screenSharing, selectedAudioInputId, selectedVideoInputId]);

  const toggleMic = async () => {
    if (!canUseMic) {
      setNotice('L’hôte a désactivé le microphone des participants.');
      return;
    }
    const tracks = cameraStreamRef.current?.getAudioTracks().filter((track) => track.readyState === 'live') || [];
    if (!tracks.length) {
      if (await requestMissingMediaTrack('audio')) setMicEnabled(true);
      return;
    }
    const next = !micEnabled;
    tracks.forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
  };

  const toggleCamera = async () => {
    if (!canUseCamera) {
      setNotice('L’hôte a désactivé la caméra des participants.');
      return;
    }
    const tracks = cameraStreamRef.current?.getVideoTracks().filter((track) => track.readyState === 'live') || [];
    if (!tracks.length) {
      if (await requestMissingMediaTrack('video')) setCameraEnabled(true);
      return;
    }
    const next = !cameraEnabled;
    tracks.forEach((track) => { track.enabled = next; });
    setCameraEnabled(next);
  };

  const switchInputDevice = useCallback(async (kind: 'audioinput' | 'videoinput', deviceId: string) => {
    if (!deviceId || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const fresh = await navigator.mediaDevices.getUserMedia(kind === 'audioinput'
        ? { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } }, video: false }
        : { audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } });
      const nextTrack = kind === 'audioinput' ? fresh.getAudioTracks()[0] : fresh.getVideoTracks()[0];
      if (!nextTrack) throw new Error('Périphérique sans piste média.');

      const current = cameraStreamRef.current || new MediaStream();
      const replacingKind = kind === 'audioinput' ? 'audio' : 'video';
      const preserved = current.getTracks().filter((track) => track.kind !== replacingKind && track.readyState === 'live');
      current.getTracks().filter((track) => track.kind === replacingKind).forEach((track) => track.stop());
      nextTrack.enabled = kind === 'audioinput' ? (micEnabled && canUseMic) : (cameraEnabled && canUseCamera);
      const nextCameraStream = new MediaStream([...preserved, nextTrack]);
      cameraStreamRef.current = nextCameraStream;

      if (!screenSharing) {
        setLocalStream(nextCameraStream);
      } else if (kind === 'audioinput' && screenStreamRef.current) {
        const display = screenStreamRef.current;
        const combined = new MediaStream();
        display.getVideoTracks().filter((track) => track.readyState === 'live').forEach((track) => combined.addTrack(track));
        const displayAudio = display.getAudioTracks().filter((track) => track.readyState === 'live');
        [nextTrack, ...displayAudio].forEach((track) => combined.addTrack(track));
        setLocalStream(combined);
      }

      if (kind === 'audioinput') setSelectedAudioInputId(deviceId);
      else setSelectedVideoInputId(deviceId);
      await refreshMediaDevices();
      setNotice(kind === 'audioinput' ? 'Microphone changé.' : 'Caméra changée.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de changer de périphérique.');
    }
  }, [cameraEnabled, canUseCamera, canUseMic, micEnabled, refreshMediaDevices, screenSharing]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    setLocalStream(cameraStreamRef.current);
  }, []);

  useEffect(() => {
    if (!meeting) return;
    if (!canUseMic) {
      cameraStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });
      setMicEnabled(false);
    }
    if (!canUseCamera) {
      cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = false; });
      setCameraEnabled(false);
    }
    if (!canShareScreen && screenSharing) stopScreenShare();
  }, [canShareScreen, canUseCamera, canUseMic, meeting, screenSharing, stopScreenShare]);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      stopScreenShare();
      return;
    }
    if (!canShareScreen) {
      setNotice('Le partage d’écran est désactivé pour les participants.');
      return;
    }
    try {
      const display = await requestDisplayCapture();
      const videoTrack = display.getVideoTracks()[0];
      if (!videoTrack) {
        display.getTracks().forEach((track) => track.stop());
        setNotice('Aucun écran n’a été sélectionné.');
        return;
      }
      const combined = new MediaStream();
      display.getVideoTracks().forEach((track) => combined.addTrack(track));
      const displayAudio = display.getAudioTracks().filter((track) => track.readyState === 'live');
      const micAudio = canUseMic ? (cameraStreamRef.current?.getAudioTracks().filter((track) => track.readyState === 'live') || []) : [];
      [...micAudio, ...displayAudio].forEach((track) => combined.addTrack(track));
      videoTrack.addEventListener('ended', stopScreenShare, { once: true });
      screenStreamRef.current = display;
      setScreenSharing(true);
      setLocalStream(combined);
      setNotice(navigator.maxTouchPoints > 0 ? 'Partage d’écran démarré sur votre appareil.' : 'Partage d’écran démarré.');
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : '';
      if (errorName === 'NotAllowedError' || errorName === 'AbortError') {
        setNotice('Partage d’écran annulé.');
      } else if (errorName === 'NotSupportedError') {
        setNotice('Ce navigateur ne permet pas encore le partage d’écran sur cet appareil.');
      } else {
        setNotice('Impossible de démarrer le partage d’écran sur cet appareil.');
      }
    }
  };

  const respondToPendingMediaRequest = async (status: 'accepted' | 'rejected') => {
    const request = pendingMediaRequest;
    if (!meeting?.id || !request) return;
    let finalStatus = status;
    try {
      if (status === 'accepted') {
        if (request.kind === 'mic') {
          if (!canUseMic) {
            finalStatus = 'rejected';
            setNotice('Le microphone est désactivé par les paramètres de la réunion.');
          } else {
            const tracks = cameraStreamRef.current?.getAudioTracks().filter((track) => track.readyState === 'live') || [];
            const enabled = tracks.length ? true : await requestMissingMediaTrack('audio');
            if (!enabled) finalStatus = 'rejected';
            else {
              cameraStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true; });
              setMicEnabled(true);
            }
          }
        } else {
          if (!canUseCamera) {
            finalStatus = 'rejected';
            setNotice('La caméra est désactivée par les paramètres de la réunion.');
          } else {
            const tracks = cameraStreamRef.current?.getVideoTracks().filter((track) => track.readyState === 'live') || [];
            const enabled = tracks.length ? true : await requestMissingMediaTrack('video');
            if (!enabled) finalStatus = 'rejected';
            else {
              cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = true; });
              setCameraEnabled(true);
            }
          }
        }
      }
      await meetingService.respondToMediaRequest(meeting.id, request.id, finalStatus);
      setPendingMediaRequest(null);
      if (finalStatus === 'accepted') {
        setNotice(request.kind === 'mic' ? 'Microphone activé à votre demande.' : 'Caméra activée à votre demande.');
      } else if (status === 'rejected') {
        setNotice('Demande de l’hôte refusée.');
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de répondre à la demande média.');
    }
  };

  const stopLocalRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const stopActiveRecording = useCallback(async () => {
    if (!recording) return;
    if (recordingMode === 'server' && meeting?.id && serverRecordingId) {
      try {
        const stopped = await collaborationService.stopServerRecording(meeting.id, serverRecordingId);
        setRecording(false);
        setRecordingMode(null);
        setServerRecordingId(null);
        setNotice(stopped.storage_url
          ? 'Enregistrement terminé et disponible dans vos enregistrements.'
          : 'L’enregistrement s’arrête. Le fichier sera disponible dans quelques instants.');
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : 'Impossible d’arrêter l’enregistrement.');
      }
      return;
    }
    stopLocalRecording();
  }, [meeting?.id, recording, recordingMode, serverRecordingId, stopLocalRecording]);

  useEffect(() => {
    if (recording && !canRecord) {
      void stopActiveRecording();
      setNotice('L’autorisation d’enregistrement pour les invités a été retirée.');
    }
  }, [canRecord, recording, stopActiveRecording]);

  const startLocalRecording = useCallback(async () => {
    if (!localStream || typeof MediaRecorder === 'undefined') {
      setNotice('L’enregistrement n’est pas disponible dans ce navigateur.');
      return;
    }
    const sources = [
      { stream: localStream, label: `${localName} (vous)` },
      ...remoteParticipants.map((participant) => ({ stream: participant.stream, label: participant.name })),
    ];
    const session = await createCompositeMeetingRecording(sources);
    recordingSessionRef.current = session;
    const stream = session.stream;
    const preferred = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm';
    try {
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: preferred });
      recorder.ondataavailable = (event) => { if (event.data.size > 0) recordingChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
        await recordingSessionRef.current?.stop();
        recordingSessionRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        setRecordingMode(null);

        try {
          if (!meeting?.id) throw new Error('Réunion introuvable pour cet enregistrement.');
          setNotice('Enregistrement terminé. Envoi sécurisé vers Supabase… 0 %');
          await collaborationService.uploadLocalRecording(
            meeting.id,
            blob,
            durationSeconds,
            (progress) => setNotice(`Envoi sécurisé vers Supabase… ${progress} %`),
          );
          setNotice('Enregistrement sauvegardé dans Supabase et disponible dans vos enregistrements.');
        } catch (cause) {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `mboteroom-${meeting?.id || 'reunion'}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setNotice(`${cause instanceof Error ? cause.message : 'Envoi vers Supabase impossible.'} Une copie locale de sécurité a été téléchargée.`);
        } finally {
          recordingChunksRef.current = [];
          recordingStartedAtRef.current = 0;
        }
      };
      recordingStartedAtRef.current = Date.now();
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecordingMode('local');
      setRecording(true);
      setNotice(`Enregistrement composite local démarré pour ${sources.filter((source) => source.stream).length} flux.`);
    } catch {
      void recordingSessionRef.current?.stop();
      recordingSessionRef.current = null;
      setNotice('Impossible de démarrer l’enregistrement local.');
    }
  }, [localName, localStream, meeting?.id, remoteParticipants]);

  const toggleRecording = async () => {
    if (!canRecord) {
      setNotice('L’enregistrement est réservé à l’hôte/co-hôte, sauf autorisation explicite de la réunion.');
      return;
    }
    if (recording) {
      await stopActiveRecording();
      return;
    }

    if (
      isModerator
      && meeting?.id
      && liveKitMedia.connected
      && mediaTransportStatus?.serverRecordingReady
    ) {
      try {
        const serverRecording = await collaborationService.startServerRecording(meeting.id, {
          breakoutRoomId,
          layout: viewMode === 'speaker' ? 'speaker' : 'grid',
        });
        setServerRecordingId(serverRecording.id);
        setRecordingMode('server');
        setRecording(true);
        setNotice('Enregistrement démarré.');
        return;
      } catch (cause) {
        setNotice(`${cause instanceof Error ? cause.message : 'Enregistrement indisponible.'} L’enregistrement continue sur cet appareil.`);
      }
    }

    await startLocalRecording();
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!meeting?.id || !text) return;
    if (!canUseChat) {
      setNotice(guestMode ? 'L’envoi de messages est désactivé pour les invités.' : 'Le chat est désactivé pour cette réunion.');
      return;
    }
    try {
      const message = await collaborationService.sendMessage(meeting.id, text);
      setMessages((current) => dedupeMessages([...current, message]));
      setMessageDraft('');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Message non envoyé.');
    }
  };

  const createPoll = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreatePoll) {
      setNotice('Seul l’hôte ou le co-hôte peut créer un sondage.');
      return;
    }
    const options = pollOptions.map((value) => value.trim()).filter(Boolean);
    if (!meeting?.id || !pollQuestion.trim() || options.length < 2) return;
    try {
      const poll = await collaborationService.createPoll(meeting.id, pollQuestion.trim(), options);
      setPolls((current) => [poll, ...current.filter((item) => item.id !== poll.id)]);
      setPollQuestion('');
      setPollOptions(['', '']);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Sondage non créé.');
    }
  };

  const askLuna = async (event: FormEvent) => {
    event.preventDefault();
    if (!meeting?.id || !lunaPrompt.trim()) return;
    if (!canUseLuna) {
      setLunaAnswer(guestMode ? 'Luna IA est désactivée pour les invités.' : 'Luna IA est désactivée pour cette réunion.');
      return;
    }
    setLunaLoading(true);
    try {
      const answer = await meetingService.askLuna(meeting.id, lunaPrompt.trim());
      setLunaAnswer(answer.answer);
    } catch (cause) {
      setLunaAnswer(cause instanceof Error ? cause.message : 'Luna IA est indisponible.');
    } finally {
      setLunaLoading(false);
    }
  };

  const requestCatchUp = async (minutes = catchUpMinutes) => {
    if (!meeting?.id || !canUseLuna) return;
    setCatchUpMinutes(minutes);
    setCatchUpLoading(true);
    setCatchUpDismissed(true);
    try {
      const result = await meetingService.getLunaCatchUp(meeting.id, minutes);
      setCatchUp(result);
      setPanel('luna');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Le rattrapage Luna est indisponible.');
    } finally {
      setCatchUpLoading(false);
    }
  };

  const respondToLobby = async (userId: number, status: 'accepted' | 'rejected') => {
    if (!meeting?.id) return;
    try {
      await meetingService.respondToLobby(meeting.id, userId, status);
      await Promise.all([refreshLobby(), refreshParticipants()]);
      setNotice(status === 'accepted' ? 'Participant admis.' : 'Demande refusée.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Action salle d’attente impossible.');
    }
  };

  const admitAllLobby = async () => {
    if (!meeting?.id) return;
    try {
      const result = await meetingService.admitAllLobby(meeting.id);
      await Promise.all([refreshLobby(), refreshParticipants()]);
      setNotice(`${result.admitted} participant${result.admitted > 1 ? 's' : ''} admis.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Admission globale impossible.');
    }
  };

  const muteAllParticipants = async () => {
    if (!meeting?.id) return;
    try {
      const result = await collaborationService.muteAllParticipants(meeting.id);
      await refreshParticipants();
      setNotice(`${result.muted} participant${result.muted > 1 ? 's' : ''} mis en sourdine.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de couper tous les micros.');
    }
  };

  const moderateParticipant = async (userId: number, action: 'mute' | 'camera' | 'request-mic' | 'request-camera' | 'remove' | 'ban' | 'lobby' | 'cohost' | 'participant') => {
    if (!meeting?.id) return;
    setMenuUserId(null);
    try {
      if (action === 'mute') await collaborationService.updateParticipant(meeting.id, userId, { mutedByHost: true });
      if (action === 'camera') await collaborationService.updateParticipant(meeting.id, userId, { cameraDisabledByHost: true });
      if (action === 'request-mic') {
        await meetingService.requestMediaControl(meeting.id, userId, 'mic');
        setNotice('Demande d’activation du microphone envoyée.');
      }
      if (action === 'request-camera') {
        await meetingService.requestMediaControl(meeting.id, userId, 'camera');
        setNotice('Demande d’activation de la caméra envoyée.');
      }
      if (action === 'cohost') await collaborationService.updateParticipant(meeting.id, userId, { role: 'cohost' });
      if (action === 'participant') await collaborationService.updateParticipant(meeting.id, userId, { role: 'participant' });
      if (action === 'remove') await collaborationService.removeParticipant(meeting.id, userId);
      if (action === 'ban') await collaborationService.banParticipant(meeting.id, userId, 'Exclusion par le modérateur');
      if (action === 'lobby') await collaborationService.moveToLobby(meeting.id, userId);
      await refreshParticipants();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Action de modération impossible.');
    }
  };

  const toggleMeetingLock = async () => {
    if (!meeting?.id || !isModerator) return;
    const next = !Boolean(meeting.settings?.locked);
    try {
      const result = await meetingService.setMeetingLocked(meeting.id, next);
      if (result.meeting) setMeeting(result.meeting);
      else setMeeting((current) => current ? { ...current, settings: { ...(current.settings || {}), locked: result.locked } } : current);
      setNotice(result.locked ? 'Réunion verrouillée.' : 'Réunion déverrouillée.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de modifier le verrouillage.');
    }
  };

  const createBreakouts = async () => {
    if (!meeting?.id || !isModerator) return;
    try {
      const count = Math.max(2, Math.min(10, Math.floor(breakoutCount || 2)));
      const names = Array.from({ length: count }, (_, index) => `Sous-salle ${index + 1}`);
      await collaborationService.createBreakoutRooms(meeting.id, names);
      await refreshBreakouts();
      setPanel('breakouts');
      setNotice(`${count} sous-salles créées.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de créer les sous-salles.');
    }
  };

  const assignBreakout = async (roomId: string, userId: number) => {
    if (!meeting?.id || !isModerator) return;
    try {
      await collaborationService.assignBreakoutParticipant(meeting.id, roomId, userId);
      await refreshBreakouts();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Affectation impossible.');
    }
  };

  const setBreakoutsOpen = async (open: boolean) => {
    if (!meeting?.id || !isModerator) return;
    try {
      if (open) await collaborationService.openBreakoutRooms(meeting.id);
      else await collaborationService.closeBreakoutRooms(meeting.id);
      if (!open) {
        setBreakoutRoomId(null);
        setBreakoutRoomName('');
      }
      await refreshBreakouts();
      setNotice(open ? 'Sous-salles ouvertes.' : 'Sous-salles fermées.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Action sous-salles impossible.');
    }
  };

  const startMeeting = async () => {
    if (!meeting?.id) return;
    try {
      const result = await meetingService.startMeetingAndNotify(meeting.id);
      if (result.meeting) setMeeting(result.meeting);
      setNotice('Réunion démarrée.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Démarrage impossible.');
    }
  };

  const inviteParticipants = async () => {
    if (!meeting) return;
    const url = getMeetingJoinUrl(meeting);
    try {
      if (navigator.share) {
        await navigator.share({ title: meeting.title, text: `Rejoignez « ${meeting.title} » sur MBotéRoom`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setNotice('Lien d’invitation copié.');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        setNotice('Lien d’invitation copié.');
      } catch {
        setNotice(url);
      }
    }
  };

  const leaveMeeting = async (endForAll = false) => {
    if (!meeting?.id) return;
    try {
      if (endForAll && canEndForAll) await collaborationService.endMeeting(meeting.id);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de terminer la réunion.');
      return;
    }
    socket.emit('meeting:leave', { meetingId: meeting.id });
    await stopActiveRecording();
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    navigate(`/reunions/${meeting.meeting_link}/terminee`, { replace: true });
  };

  if (loading) return <main className="room-v2-loading">Connexion à la réunion…</main>;
  if (error || !meeting) return (
    <main className="room-v2-error">
      <ShieldCheck size={38} />
      <h1>Impossible d’entrer dans la réunion</h1>
      <p>{error || 'Réunion introuvable.'}</p>
      <button type="button" onClick={() => navigate('/app')}>Retour à MBotéRoom</button>
    </main>
  );

  const activeMembers = participants.filter((participant) => participant.status === 'accepted');
  const galleryCount = 1 + remoteParticipants.length;
  const featuredSocketId = pinnedSocketId || activeSpeakerSocketId || remoteParticipants[0]?.socketId || null;
  const featuredParticipant = featuredSocketId ? remoteParticipants.find((participant) => participant.socketId === featuredSocketId) || null : null;
  const remoteScreenParticipant = remoteParticipants.find((participant) => participant.media.screen) || null;
  const screenShareActive = Boolean(screenSharing || remoteScreenParticipant);
  const screenPresenterName = screenSharing ? localName : remoteScreenParticipant?.name || '';
  const speakerViewEnabled = (viewMode === 'speaker' || viewMode === 'participants') && Boolean(featuredParticipant);
  const elapsedSeconds = meeting.is_active ? Math.max(0, Math.floor((clockTick - new Date(meeting.start_time).getTime()) / 1000)) : 0;
  const raisedMembers = activeMembers.filter((member) => raisedHands.has(member.userId));
  const normalizedParticipantSearch = participantSearch.trim().toLowerCase();
  const visibleMembers = normalizedParticipantSearch
    ? activeMembers.filter((member) => [member.name, member.role, member.isGuest ? 'invité' : 'participant'].some((value) => String(value || '').toLowerCase().includes(normalizedParticipantSearch)))
    : activeMembers;

  return (
    <main className="room-v2-shell">
      <header className="room-v2-header">
        <div className="room-v2-brand">
          <img src="/icons/mboteroom-wordmark.png" alt="MBotéRoom"/>
        </div>
        <div className="room-v2-meeting-heading">
          <strong>{meeting.title}</strong>
          <span>ID {meeting.settings?.meetingAccessId || getMeetingAccessCode(meeting)}</span>
        </div>
        <div className="room-v2-meeting-status">
          <span className="room-v2-secure-status"><ShieldCheck size={18}/> <i/> Connecté</span>
          <span className={meeting.is_active ? 'room-v2-live-pill is-live' : 'room-v2-live-pill'}>
            <Radio size={16}/>
            <span>{meeting.is_active ? 'En cours' : 'Programmée'}<small>{meeting.is_active ? formatDuration(elapsedSeconds) : formatTime(meeting.start_time)}</small></span>
          </span>
          {isModerator && !meeting.is_active ? <button className="room-v2-start" type="button" onClick={startMeeting}>Démarrer</button> : null}
          <button className="room-v2-header-icon" type="button" aria-label="Participants" onClick={() => setPanel(panel === 'participants' ? null : 'participants')}><UsersRound/></button>
          <button className="room-v2-header-icon" type="button" aria-label="Discussion" onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageCircle/></button>
          <button className="room-v2-header-icon" type="button" aria-label="Périphériques" onClick={() => { setDevicePanelOpen((current) => !current); if (!devicePanelOpen) void refreshMediaDevices(); }}><Settings2/></button>
          <div className="room-v2-technical-status" aria-label="État technique de la réunion">
            <span
              className={`room-v2-media-transport ${liveKitMedia.connected ? 'sfu-active' : liveKitDesired ? 'sfu-connecting' : 'mesh-active'}`}
              data-testid="media-transport-status"
              data-transport={liveKitMedia.connected ? 'livekit' : 'mesh'}
            >{liveKitMedia.connected ? 'Connexion optimisée' : liveKitDesired ? 'Optimisation…' : 'Connexion active'}</span>
            <span className={`room-v2-network ${networkQuality.level}`} data-testid="network-quality" data-level={networkQuality.level}>
              {networkQuality.level === 'offline' ? <WifiOff size={14}/> : <Wifi size={14}/>}
              {networkQuality.rttMs !== null ? <small>{networkQuality.rttMs} ms</small> : null}
            </span>
          </div>
        </div>
      </header>

      <nav className="room-v2-mode-tabs" aria-label="Affichage de la réunion">
        <button type="button" className={viewMode === 'participants' && !screenShareActive ? 'active' : ''} onClick={() => setViewMode('participants')} data-testid="participants-view-button"><UsersRound/><span>Participants</span></button>
        <button type="button" className={viewMode === 'gallery' && !screenShareActive ? 'active' : ''} onClick={() => setViewMode('gallery')} data-testid="gallery-view-button"><span className="room-v2-grid-icon" aria-hidden="true"/><span>Galerie</span></button>
        <button type="button" className={viewMode === 'speaker' && !screenShareActive ? 'active' : ''} onClick={() => setViewMode('speaker')} data-testid="speaker-view-button"><span className="room-v2-speaker-icon" aria-hidden="true"/><span>Intervenant</span></button>
        {screenShareActive ? <button type="button" className="active room-v2-share-tab"><MonitorUp/><span>Partage d’écran</span></button> : null}
      </nav>

      {notice ? <div className="room-v2-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fermer"><X size={16}/></button></div> : null}

      {meeting.is_active && !isModerator && canUseLuna && !catchUpDismissed && (Date.now() - new Date(meeting.start_time).getTime() > 5 * 60_000) ? (
        <section className="room-v2-catchup-offer" aria-label="Rattrapage intelligent Luna">
          <span><Sparkles size={18}/></span>
          <div><strong>Vous arrivez en cours de réunion ?</strong><small>Luna peut vous résumer en privé les 15 dernières minutes sans interrompre les participants.</small></div>
          <button type="button" disabled={catchUpLoading} onClick={() => void requestCatchUp(15)}>{catchUpLoading ? 'Analyse…' : 'Me rattraper'}</button>
          <button type="button" className="dismiss" aria-label="Masquer" onClick={() => setCatchUpDismissed(true)}><X size={16}/></button>
        </section>
      ) : null}

      <section className="room-v2-body">
        <div className={`room-v2-stage ${speakerViewEnabled ? 'speaker-mode' : ''}`}>
          {screenShareActive ? (
            <div className="room-v2-screen-layout" data-testid="screen-share-layout">
              <section className="room-v2-screen-card">
                <header>
                  <span><MonitorUp/> Écran partagé</span>
                  <strong>{screenPresenterName} partage son écran</strong>
                </header>
                <div className="room-v2-screen-canvas">
                  <VideoTile
                    name={screenPresenterName}
                    stream={screenSharing ? localStream : remoteScreenParticipant?.stream || null}
                    avatar={screenSharing ? currentUser?.avatar : remoteScreenParticipant?.avatar}
                    muted={screenSharing ? !mediaState.audio : !remoteScreenParticipant?.media.audio}
                    videoEnabled
                    screen
                    local={screenSharing}
                    audioOutputId={selectedAudioOutputId}
                    activeSpeaker={!screenSharing && activeSpeakerSocketId === remoteScreenParticipant?.socketId}
                    pinned={!screenSharing && pinnedSocketId === remoteScreenParticipant?.socketId}
                    reaction={!screenSharing && remoteScreenParticipant ? reactions[Number(remoteScreenParticipant.userId)] : undefined}
                    onPin={!screenSharing && remoteScreenParticipant ? () => setPinnedSocketId((current) => current === remoteScreenParticipant.socketId ? null : remoteScreenParticipant.socketId) : undefined}
                  />
                  {screenSharing && cameraEnabled ? <div className="room-v2-presenter-pip">
                    <VideoTile name={localName} stream={cameraStreamRef.current} avatar={currentUser?.avatar} muted={!micEnabled} videoEnabled={cameraEnabled} local badge={isHost?'Hôte':isCoHost?'Co-hôte':undefined}/>
                  </div> : null}
                </div>
                <footer>
                  <span><Radio size={15}/> Partage en cours</span>
                  <strong>{screenPresenterName}</strong>
                  {screenSharing ? <button type="button" onClick={() => void toggleScreenShare()}><Square/> Arrêter le partage</button> : null}
                </footer>
              </section>
              <div className="room-v2-screen-strip">
                {screenSharing ? null : <VideoTile name={localName} stream={localStream} avatar={currentUser?.avatar} muted={!mediaState.audio} videoEnabled={mediaState.video} local badge={isHost?'Hôte':isCoHost?'Co-hôte':currentUser?.isGuest?'Invité':'Participant'}/>}
                {remoteParticipants.filter((participant) => participant.socketId !== remoteScreenParticipant?.socketId).map((participant) => (
                  <VideoTile
                    key={participant.socketId}
                    name={participant.name}
                    stream={participant.stream}
                    avatar={participant.avatar}
                    muted={!participant.media.audio}
                    videoEnabled={participant.media.video}
                    badge={activeMembers.find((member) => member.userId === Number(participant.userId))?.role === 'cohost' ? 'Co-hôte' : undefined}
                    audioOutputId={selectedAudioOutputId}
                    activeSpeaker={activeSpeakerSocketId === participant.socketId}
                    pinned={pinnedSocketId === participant.socketId}
                    handRaised={raisedHands.has(Number(participant.userId))}
                    reaction={reactions[Number(participant.userId)]}
                    onPin={() => setPinnedSocketId((current) => current === participant.socketId ? null : participant.socketId)}
                  />
                ))}
                <button type="button" className="room-v2-invite-tile" onClick={() => void inviteParticipants()}><UsersRound/><span>Inviter des participants</span></button>
              </div>
            </div>
          ) : speakerViewEnabled && featuredParticipant ? (
            <div className="room-v2-speaker-layout" data-testid="speaker-layout">
              <div className="room-v2-speaker-main">
                <span className="room-v2-featured-label"><Pin size={14}/> Intervenant actif</span>
                <VideoTile
                  name={featuredParticipant.name}
                  stream={featuredParticipant.stream}
                  avatar={featuredParticipant.avatar}
                  muted={!featuredParticipant.media.audio}
                  videoEnabled={featuredParticipant.media.video || featuredParticipant.media.screen}
                  screen={featuredParticipant.media.screen}
                  badge={activeMembers.find((member) => member.userId === Number(featuredParticipant.userId))?.role === 'cohost' ? 'Co-hôte' : undefined}
                  audioOutputId={selectedAudioOutputId}
                  activeSpeaker={activeSpeakerSocketId === featuredParticipant.socketId}
                  pinned={pinnedSocketId === featuredParticipant.socketId}
                  handRaised={raisedHands.has(Number(featuredParticipant.userId))}
                  reaction={reactions[Number(featuredParticipant.userId)]}
                  onPin={() => setPinnedSocketId((current) => current === featuredParticipant.socketId ? null : featuredParticipant.socketId)}
                />
              </div>
              <div className={`room-v2-speaker-strip ${viewMode === 'participants' ? 'participant-mode' : ''}`}>
                <VideoTile
                  name={localName}
                  stream={localStream}
                  avatar={currentUser?.avatar}
                  muted={!mediaState.audio}
                  videoEnabled={screenSharing || mediaState.video}
                  screen={screenSharing}
                  badge={isHost ? 'Hôte' : isCoHost ? 'Co-hôte' : isAdmin ? 'Admin' : currentUser?.isGuest ? 'Invité' : 'Participant'}
                  handRaised={handRaised}
                  reaction={reactions[Number(currentUser?.id || 0)]}
                  local
                />
                {remoteParticipants.filter((participant) => participant.socketId !== featuredParticipant.socketId).map((participant) => (
                  <VideoTile
                    key={participant.socketId}
                    name={participant.name}
                    stream={participant.stream}
                    avatar={participant.avatar}
                    muted={!participant.media.audio}
                    videoEnabled={participant.media.video || participant.media.screen}
                    screen={participant.media.screen}
                    badge={activeMembers.find((member) => member.userId === Number(participant.userId))?.role === 'cohost' ? 'Co-hôte' : undefined}
                    audioOutputId={selectedAudioOutputId}
                    activeSpeaker={activeSpeakerSocketId === participant.socketId}
                    pinned={pinnedSocketId === participant.socketId}
                    handRaised={raisedHands.has(Number(participant.userId))}
                    reaction={reactions[Number(participant.userId)]}
                    onPin={() => setPinnedSocketId((current) => current === participant.socketId ? null : participant.socketId)}
                  />
                ))}
                {viewMode === 'participants' ? <button type="button" className="room-v2-invite-tile" onClick={() => void inviteParticipants()}><UsersRound/><span>Inviter des participants</span></button> : null}
              </div>
            </div>
          ) : (
            <div className={`room-v2-gallery count-${Math.min(galleryCount, 9)}`} data-testid="gallery-layout">
              <VideoTile
                name={localName}
                stream={localStream}
                avatar={currentUser?.avatar}
                muted={!mediaState.audio}
                videoEnabled={screenSharing || mediaState.video}
                screen={screenSharing}
                badge={isHost ? 'Hôte' : isCoHost ? 'Co-hôte' : isAdmin ? 'Admin' : currentUser?.isGuest ? 'Invité' : 'Participant'}
                handRaised={handRaised}
                reaction={reactions[Number(currentUser?.id || 0)]}
                local
              />
              {remoteParticipants.map((participant) => (
                <VideoTile
                  key={participant.socketId}
                  name={participant.name}
                  stream={participant.stream}
                  avatar={participant.avatar}
                  muted={!participant.media.audio}
                  videoEnabled={participant.media.video || participant.media.screen}
                  screen={participant.media.screen}
                  badge={activeMembers.find((member) => member.userId === Number(participant.userId))?.role === 'cohost' ? 'Co-hôte' : undefined}
                  audioOutputId={selectedAudioOutputId}
                  activeSpeaker={activeSpeakerSocketId === participant.socketId}
                  pinned={pinnedSocketId === participant.socketId}
                  handRaised={raisedHands.has(Number(participant.userId))}
                  reaction={reactions[Number(participant.userId)]}
                  onPin={() => setPinnedSocketId((current) => current === participant.socketId ? null : participant.socketId)}
                />
              ))}
            </div>
          )}
        </div>

        {!panel ? <aside className="room-v2-desktop-rail" aria-label="Participants de la réunion">
          {raisedMembers.length ? <section className="room-v2-hand-queue">
            <header><span><Hand size={18}/></span><strong>File des mains levées ({raisedMembers.length})</strong></header>
            {raisedMembers.map((member) => {
              const remote = remoteParticipants.find((participant) => Number(participant.userId) === member.userId);
              const raisedAt = raisedHandTimes[member.userId];
              return <article key={member.userId}>
                <div className="room-v2-person-avatar">{member.avatar?<img src={member.avatar} alt=""/>:initials(member.name)}</div>
                <div><strong>{member.name}</strong><small>a levé la main et souhaite prendre la parole.{raisedAt ? ' · '+formatTime(raisedAt) : ''}</small></div>
                {remote ? <button type="button" aria-label={`Mettre ${member.name} en avant`} onClick={() => { setPinnedSocketId(remote.socketId); setViewMode('speaker'); }}><Hand/></button> : null}
              </article>;
            })}
          </section> : null}
          <section className="room-v2-rail-participants">
            <header><span><UsersRound size={18}/></span><strong>Participants ({activeMembers.length})</strong></header>
            <label><Search size={15}/><input value={participantSearch} onChange={(event)=>setParticipantSearch(event.target.value)} placeholder="Rechercher un participant…"/></label>
            <div>
              {visibleMembers.map((member) => {
                const remote = remoteParticipants.find((participant) => Number(participant.userId) === member.userId);
                const isSelf = member.userId === Number(currentUser?.id || 0);
                return <article key={member.userId}>
                  <div className="room-v2-person-avatar">{member.avatar?<img src={member.avatar} alt=""/>:initials(member.name)}</div>
                  <div><strong>{member.name}{isSelf?' (vous)':''}</strong><small>{member.role==='host'?'Hôte':member.role==='cohost'?'Co-hôte':member.isGuest?'Invité':'Participant'}</small></div>
                  {raisedHands.has(member.userId)?<Hand className="room-v2-rail-hand"/>:null}
                  {remote?.media.audio || (isSelf&&mediaState.audio)?<Mic className="room-v2-rail-mic"/>:<MicOff className="room-v2-rail-muted"/>}
                  {remote ? <button type="button" className="room-v2-rail-more" aria-label={`Mettre ${member.name} en avant`} onClick={()=>{setPinnedSocketId(remote.socketId);setViewMode('speaker');}}><MoreVertical/></button>:null}
                </article>;
              })}
            </div>
            <button type="button" className="room-v2-rail-invite" onClick={()=>void inviteParticipants()}><UsersRound/> Inviter des participants</button>
          </section>
        </aside> : null}

        {panel ? (
          <aside className="room-v2-panel">
            <div className="room-v2-panel-title">
              <h2>{panel === 'participants' ? 'Participants' : panel === 'chat' ? 'Discussion' : panel === 'polls' ? 'Sondages' : panel === 'breakouts' ? 'Sous-salles' : 'Luna IA'}</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Fermer"><X size={20}/></button>
            </div>

            {panel === 'participants' ? (
              <div className="room-v2-participants">
                {isModerator ? (
                  <div className="room-v2-host-tools">
                    <button type="button" onClick={() => void muteAllParticipants()} data-testid="mute-all-button">Couper tous les micros</button>
                    {lobbyParticipants.length ? <button type="button" onClick={() => void admitAllLobby()} data-testid="admit-all-button">Admettre tous ({lobbyParticipants.length})</button> : null}
                  </div>
                ) : null}
                {isModerator && lobbyParticipants.length ? (
                  <section className="room-v2-lobby-section">
                    <strong>Salle d’attente</strong>
                    {lobbyParticipants.map((item) => (
                      <article key={item.user_id} className="room-v2-lobby-row">
                        <div className="room-v2-person-avatar">{item.avatar ? <img src={item.avatar} alt=""/> : initials(item.name)}</div>
                        <div><strong>{item.name}</strong><small>En attente</small></div>
                        <div className="room-v2-lobby-actions">
                          <button type="button" onClick={() => void respondToLobby(item.user_id, 'accepted')}>Admettre</button>
                          <button type="button" className="danger" onClick={() => void respondToLobby(item.user_id, 'rejected')}>Refuser</button>
                        </div>
                      </article>
                    ))}
                  </section>
                ) : null}
                {activeMembers.map((member) => {
                  const remote = remoteParticipants.find((participant) => Number(participant.userId) === member.userId);
                  const isSelf = member.userId === Number(currentUser?.id || 0);
                  return (
                    <article key={member.userId}>
                      <div className="room-v2-person-avatar">{member.avatar ? <img src={member.avatar} alt=""/> : initials(member.name)}</div>
                      <div><strong>{member.name}{isSelf ? ' (vous)' : ''}{raisedHands.has(member.userId) || (isSelf && handRaised) ? <span className="room-v2-raised-inline"> · ✋</span> : null}</strong><small>{member.role === 'host' ? 'Hôte' : member.role === 'cohost' ? 'Co-hôte' : member.isGuest ? 'Invité' : 'Participant'}{remote || isSelf ? ' · En ligne' : ''}</small></div>
                      {isModerator && !isSelf && member.role !== 'host' && (isHost || member.role !== 'cohost') ? (
                        <div className="room-v2-person-menu-wrap">
                          <button type="button" onClick={() => setMenuUserId(menuUserId === member.userId ? null : member.userId)}><MoreVertical size={18}/></button>
                          {menuUserId === member.userId ? (
                            <div className="room-v2-person-menu">
                              {remote ? (
                                <>
                                  {remote.media.audio
                                    ? <button onClick={() => void moderateParticipant(member.userId, 'mute')}>Couper le micro</button>
                                    : <button onClick={() => void moderateParticipant(member.userId, 'request-mic')}>Demander d’activer le micro</button>}
                                  {remote.media.video
                                    ? <button onClick={() => void moderateParticipant(member.userId, 'camera')}>Couper la caméra</button>
                                    : <button onClick={() => void moderateParticipant(member.userId, 'request-camera')}>Demander d’activer la caméra</button>}
                                </>
                              ) : <span className="room-v2-person-offline">Participant hors ligne</span>}
                              {isHost && member.role !== 'cohost' ? <button onClick={() => void moderateParticipant(member.userId, 'cohost')}>Nommer co-hôte</button> : null}
                              {isHost && member.role === 'cohost' ? <button onClick={() => void moderateParticipant(member.userId, 'participant')}>Retirer le rôle co-hôte</button> : null}
                              <button onClick={() => void moderateParticipant(member.userId, 'lobby')}>Mettre en salle d’attente</button>
                              <button onClick={() => void moderateParticipant(member.userId, 'remove')}>Retirer</button>
                              <button className="danger" onClick={() => void moderateParticipant(member.userId, 'ban')}>Exclure et bannir</button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {panel === 'chat' ? (
              <div className="room-v2-chat">
                <div className="room-v2-chat-list">
                  {messages.length ? messages.map((message) => (
                    <article key={message.id} className={Number(message.userId) === Number(currentUser?.id || 0) ? 'mine' : ''}>
                      <div><strong>{message.sender}</strong><time>{formatTime(message.time)}</time></div>
                      <p>{message.text}</p>
                    </article>
                  )) : <p className="room-v2-empty">Aucun message pour le moment.</p>}
                </div>
                <form className="room-v2-chat-form" onSubmit={sendMessage}>
                  <textarea value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} maxLength={2000} placeholder={!canUseChat ? (guestMode && !guestChatAllowed ? 'Envoi de messages désactivé pour les invités' : 'Chat désactivé par l’hôte') : 'Écrire un message…'} disabled={!canUseChat}/>
                  <button type="submit" disabled={!messageDraft.trim() || !canUseChat}><Send size={18}/></button>
                </form>
              </div>
            ) : null}

            {panel === 'breakouts' ? (
              <div className="room-v2-breakouts">
                {!breakoutRooms.length ? (
                  <div className="room-v2-breakout-create">
                    <p>Créez des groupes séparés pour les ateliers ou discussions parallèles.</p>
                    <label>Nombre de sous-salles
                      <input type="number" min={2} max={10} value={breakoutCount} onChange={(event) => setBreakoutCount(Number(event.target.value))}/>
                    </label>
                    <button type="button" onClick={() => void createBreakouts()} disabled={!isModerator}>Créer les sous-salles</button>
                  </div>
                ) : (
                  <>
                    <div className="room-v2-breakout-actions">
                      <button type="button" onClick={() => void setBreakoutsOpen(true)}>Ouvrir les sous-salles</button>
                      <button type="button" className="secondary" onClick={() => void setBreakoutsOpen(false)}>Fermer les sous-salles</button>
                    </div>
                    {breakoutRooms.map((room) => (
                      <article className="room-v2-breakout-card" key={room.id}>
                        <div><strong>{room.name}</strong><small>{room.isOpen ? 'Ouverte' : 'Fermée'} · {room.members.length} participant(s)</small></div>
                        <div className="room-v2-breakout-members">
                          {room.members.map((member) => <span key={member.userId}>{member.name}</span>)}
                        </div>
                        <label>Affecter un participant
                          <select defaultValue="" onChange={(event) => { const userId = Number(event.target.value); if (userId) void assignBreakout(room.id, userId); event.currentTarget.value=''; }}>
                            <option value="">Choisir…</option>
                            {activeMembers.filter((member) => member.role !== 'host').map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
                          </select>
                        </label>
                      </article>
                    ))}
                  </>
                )}
              </div>
            ) : null}

            {panel === 'polls' ? (
              <div className="room-v2-polls">
                {canCreatePoll ? (
                  <form onSubmit={createPoll} className="room-v2-poll-create">
                    <input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Question du sondage" maxLength={300}/>
                    {pollOptions.map((option, index) => (
                      <input key={index} value={option} onChange={(event) => setPollOptions((current) => current.map((value, i) => i === index ? event.target.value : value))} placeholder={`Option ${index + 1}`} maxLength={120}/>
                    ))}
                    <button type="button" onClick={() => setPollOptions((current) => current.length < 6 ? [...current, ''] : current)}>+ Option</button>
                    <button type="submit" disabled={!pollQuestion.trim() || pollOptions.filter((value) => value.trim()).length < 2}>Créer le sondage</button>
                  </form>
                ) : <p className="room-v2-empty">Vous pouvez voter aux sondages ouverts. La création est réservée à l’hôte et au co-hôte.</p>}
                {polls.map((poll) => (
                  <article className="room-v2-poll" key={poll.id}>
                    <strong>{poll.question}</strong>
                    {poll.options.map((option) => (
                      <button key={option.id} disabled={!poll.isOpen} onClick={() => meeting?.id && void collaborationService.vote(meeting.id, poll.id, option.id).then((value) => setPolls((current) => [value, ...current.filter((item) => item.id !== value.id)]))}>
                        <span>{option.label}</span><b>{option.votes}</b>
                      </button>
                    ))}
                    {isModerator && poll.isOpen ? <button className="room-v2-close-poll" onClick={() => meeting?.id && void collaborationService.closePoll(meeting.id, poll.id).then((value) => setPolls((current) => [value, ...current.filter((item) => item.id !== value.id)]))}>Fermer le sondage</button> : null}
                  </article>
                ))}
              </div>
            ) : null}

            {panel === 'luna' ? (
              <div className="room-v2-luna">
                <section className="room-v2-catchup-card">
                  <div className="room-v2-catchup-title"><span><Sparkles size={18}/></span><div><strong>Rattrapage silencieux</strong><small>Un briefing privé pour rejoindre une réunion déjà commencée sans demander « qu’est-ce que j’ai raté ? ».</small></div></div>
                  <div className="room-v2-catchup-windows" role="group" aria-label="Durée du rattrapage">
                    {[5,15,30].map((minutes)=><button key={minutes} type="button" className={catchUpMinutes===minutes?'active':''} onClick={()=>void requestCatchUp(minutes)} disabled={!canUseLuna||catchUpLoading}><Clock3 size={13}/>{minutes} min</button>)}
                  </div>
                  {catchUpLoading?<div className="room-v2-catchup-loading"><Sparkles size={17}/> Luna analyse les échanges récents…</div>:null}
                  {catchUp&&!catchUpLoading?(
                    catchUp.available?<div className="room-v2-catchup-result">
                      <span className="room-v2-private-badge"><ShieldCheck size={13}/> Privé · visible seulement par vous</span>
                      <h4>{catchUp.headline||'Rattrapage express'}</h4>
                      {catchUp.brief?<p>{catchUp.brief}</p>:null}
                      {catchUp.keyPoints?.length?<div><strong>À retenir</strong><ul>{catchUp.keyPoints.map((item,index)=><li key={`point-${index}`}>{item}</li>)}</ul></div>:null}
                      {catchUp.decisions?.length?<div><strong>Décisions déjà prises</strong><ul>{catchUp.decisions.map((item,index)=><li key={`decision-${index}`}>{item}</li>)}</ul></div>:null}
                      {catchUp.actions?.length?<div><strong>Actions</strong><ul>{catchUp.actions.map((item,index)=><li key={`action-${index}`}>{item}</li>)}</ul></div>:null}
                      {catchUp.openQuestions?.length?<div><strong>Questions encore ouvertes</strong><ul>{catchUp.openQuestions.map((item,index)=><li key={`question-${index}`}>{item}</li>)}</ul></div>:null}
                      <small className="room-v2-catchup-sources">Basé sur {catchUp.sources?.captions||0} extrait(s) audio et {catchUp.sources?.chat||0} message(s) de discussion.</small>
                    </div>:<div className="room-v2-catchup-empty">{catchUp.reason||'Pas encore assez de contenu pour générer un rattrapage.'}</div>
                  ):null}
                </section>
                <p>Luna peut utiliser le chat et les transcriptions audio persistées de la réunion. Elle n’invente pas le contenu qui n’a pas été transcrit.</p>
                {userPreferences.lunaActionSuggestions !== false ? <div className="room-v2-luna-suggestions">
                  {['Résume les points clés', 'Quelles actions restent à faire ?', 'Quelles décisions ont été prises ?'].map((suggestion) => (
                    <button key={suggestion} type="button" disabled={!canUseLuna || lunaLoading} onClick={() => setLunaPrompt(suggestion)}>{suggestion}</button>
                  ))}
                </div> : null}
                <form onSubmit={askLuna}>
                  <textarea value={lunaPrompt} onChange={(event) => setLunaPrompt(event.target.value)} placeholder={canUseLuna ? 'Ex. Quelles décisions ont déjà été prises ?' : 'Luna est désactivée par l’hôte'} maxLength={5000} disabled={!canUseLuna}/>
                  <button type="submit" disabled={!canUseLuna || lunaLoading || !lunaPrompt.trim()}>{lunaLoading ? 'Analyse…' : 'Demander à Luna'}</button>
                </form>
                {lunaAnswer ? <div className="room-v2-luna-answer">{lunaAnswer}</div> : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>

      {pendingMediaRequest ? (
        <section className="room-v2-media-request" role="dialog" aria-live="assertive" aria-label="Demande média de l’hôte">
          <div>
            <strong>{pendingMediaRequest.requestedByName || 'L’hôte'} vous demande d’activer {pendingMediaRequest.kind === 'mic' ? 'votre microphone' : 'votre caméra'}.</strong>
            <span>Vous gardez le contrôle : vous pouvez accepter ou refuser.</span>
          </div>
          <div>
            <button type="button" className="accept" onClick={() => void respondToPendingMediaRequest('accepted')}>Accepter</button>
            <button type="button" onClick={() => void respondToPendingMediaRequest('rejected')}>Refuser</button>
          </div>
        </section>
      ) : null}

      {captionsEnabled && liveCaptions.captions.length ? (
        <div
          className="room-v2-caption-overlay"
          data-testid="caption-overlay"
          data-mode={liveCaptions.mode}
          aria-live="polite"
          aria-label="Sous-titres de la réunion"
        >
          {liveCaptions.captions.slice(-3).map((caption) => (
            <p key={caption.id}>
              <strong>{caption.speaker}</strong>
              <span>{caption.text}</span>
              {caption.provider === 'groq-whisper' ? <small>IA</small> : null}
            </p>
          ))}
        </div>
      ) : null}

      {handRaised ? <div className="room-v2-hand-toast" role="status">
        <span><Hand/></span>
        <div><strong>Vous avez levé la main</strong><small>L’animateur a été notifié</small></div>
        <button type="button" aria-label="Baisser la main" onClick={() => {
          setHandRaised(false);
          setRaisedHands((current) => { const next=new Set(current); next.delete(Number(currentUser?.id||0)); return next; });
          socket.emit('meeting:hand-raised',{meetingId:meeting.id,raised:false});
        }}><X/></button>
      </div> : null}

      <footer className="room-v2-controls">
        <Control active={micEnabled} disabled={!canUseMic} title={!canUseMic ? 'Microphone désactivé par l’hôte' : undefined} label={micEnabled ? 'Micro' : 'Micro coupé'} onClick={() => void toggleMic()}>{micEnabled ? <Mic/> : <MicOff/>}</Control>
        <Control active={cameraEnabled} disabled={!canUseCamera} title={!canUseCamera ? 'Caméra désactivée par l’hôte' : undefined} label={cameraEnabled ? 'Caméra' : 'Caméra coupée'} onClick={() => void toggleCamera()}>{cameraEnabled ? <Camera/> : <CameraOff/>}</Control>
        <Control active={screenSharing} disabled={!canShareScreen} title={!canShareScreen ? (guestMode && !guestScreenShareAllowed ? 'Partage d’écran non autorisé pour les invités' : 'Partage d’écran désactivé par l’hôte') : undefined} label="Partager" onClick={() => void toggleScreenShare()}><MonitorUp/></Control>
        <Control
          active={captionsEnabled}
          disabled={!canUseTranscription || userPreferences.lunaRealtimeTranslation !== true}
          title={!canUseTranscription ? 'Transcription non autorisée pour les invités' : userPreferences.lunaRealtimeTranslation !== true ? 'Activez la traduction en temps réel dans Paramètres > Outils IA Luna' : undefined}
          label={captionsEnabled ? (liveCaptions.mode === 'server' ? 'Sous-titres IA' : 'Sous-titres') : 'Sous-titres'}
          testId="captions-button"
          onClick={() => {
            const next = !captionsEnabled;
            setCaptionsEnabled(next);
            if (!next) liveCaptions.clearCaptions();
          }}
        ><Captions/></Control>
        <Control active={handRaised} disabled={!guestRaiseHandAllowed} title={!guestRaiseHandAllowed ? 'Lever la main non autorisé pour les invités' : undefined} label={handRaised ? 'Main levée' : 'Main'} onClick={() => {
          const raised = !handRaised;
          setHandRaised(raised);
          setRaisedHands((current) => { const next = new Set(current); if (raised) next.add(Number(currentUser?.id || 0)); else next.delete(Number(currentUser?.id || 0)); return next; });
          socket.emit('meeting:hand-raised',{meetingId:meeting.id,raised});
        }}><Hand/></Control>
        <Control active={recording} disabled={!canRecord} title={!canRecord ? (guestMode && !guestRecordingAllowed ? 'Enregistrement non autorisé pour les invités' : 'Enregistrement non autorisé pour votre rôle') : undefined} label={recording ? 'Stop rec.' : 'Enregistrer'} onClick={() => void toggleRecording()}>{recording ? <Square/> : <Circle/>}</Control>

        <div className="room-v2-more-wrap">
          <Control active={moreMenuOpen} label="Plus" onClick={() => setMoreMenuOpen((current) => !current)}><MoreVertical/></Control>
          {moreMenuOpen ? <div className="room-v2-more-menu" role="menu">
            <button type="button" onClick={() => {setPanel(panel==='participants'?null:'participants');setMoreMenuOpen(false);}}><UsersRound/><span>Participants</span><b>{activeMembers.length}</b></button>
            <button type="button" disabled={!canUseChat} onClick={() => {setPanel(panel==='chat'?null:'chat');setMoreMenuOpen(false);}}><MessageCircle/><span>Discussion</span>{messages.length?<b>{messages.length}</b>:null}</button>
            <button type="button" onClick={() => {setPanel(panel==='polls'?null:'polls');setMoreMenuOpen(false);}}><Vote/><span>Sondages</span></button>
            <button type="button" disabled={!canUseReactions} onClick={() => {setReactionPanelOpen((current)=>!current);setMoreMenuOpen(false);}}><span className="room-v2-more-emoji">😊</span><span>Réactions</span></button>
            <button type="button" disabled={!canUseLuna} onClick={() => {setPanel(panel==='luna'?null:'luna');setMoreMenuOpen(false);}}><Bot/><span>Luna IA</span></button>
            {isModerator ? <button type="button" onClick={() => {setPanel(panel==='breakouts'?null:'breakouts');void refreshBreakouts();setMoreMenuOpen(false);}}><UsersRound/><span>Sous-salles</span></button> : null}
            {isModerator ? <button type="button" onClick={() => {void toggleMeetingLock();setMoreMenuOpen(false);}}><ShieldCheck/><span>{meeting.settings?.locked?'Déverrouiller':'Verrouiller'}</span></button> : null}
            <button type="button" onClick={() => {setDevicePanelOpen(true);void refreshMediaDevices();setMoreMenuOpen(false);}}><Settings2/><span>Périphériques</span></button>
            <button type="button" onClick={() => {void inviteParticipants();setMoreMenuOpen(false);}}><UsersRound/><span>Inviter</span></button>
            <div/>
            <button type="button" className="danger" onClick={() => void leaveMeeting(false)}><LogOut/><span>Quitter la réunion</span></button>
            {canEndForAll ? <button type="button" className="danger" onClick={() => void leaveMeeting(true)}><PhoneOff/><span>Terminer pour tous</span></button> : null}
          </div> : null}
        </div>

        <div className="room-v2-leave-actions">
          <button type="button" className="room-v2-leave" onClick={() => void leaveMeeting(false)}><PhoneOff size={18}/> Quitter la réunion</button>
        </div>
      </footer>

      {reactionPanelOpen ? (
        <div className="room-v2-reaction-panel" data-testid="reaction-panel">
          {['👍','👏','❤️','🎉','😂'].map((reaction) => (
            <button key={reaction} type="button" onClick={() => { setReactionPanelOpen(false); socket.emit('meeting:reaction',{meetingId:meeting.id,reaction}); }}>{reaction}</button>
          ))}
        </div>
      ) : null}

      {devicePanelOpen ? (
        <div className="room-v2-device-panel" data-testid="device-settings-panel">
          <div className="room-v2-device-title"><strong>Audio et vidéo</strong><button type="button" onClick={() => setDevicePanelOpen(false)} aria-label="Fermer"><X size={16}/></button></div>
          <label>
            <Mic size={16}/> Microphone
            <select value={selectedAudioInputId} onChange={(event) => void switchInputDevice('audioinput', event.target.value)}>
              {mediaDevices.filter((device) => device.kind === 'audioinput').map((device, index) => <option key={device.deviceId || `audio-${index}`} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
            </select>
          </label>
          <label>
            <Camera size={16}/> Caméra
            <select value={selectedVideoInputId} onChange={(event) => void switchInputDevice('videoinput', event.target.value)}>
              {mediaDevices.filter((device) => device.kind === 'videoinput').map((device, index) => <option key={device.deviceId || `video-${index}`} value={device.deviceId}>{device.label || `Caméra ${index + 1}`}</option>)}
            </select>
          </label>
          <label>
            <Volume2 size={16}/> Haut-parleur
            <select value={selectedAudioOutputId} onChange={(event) => setSelectedAudioOutputId(event.target.value)} disabled={typeof HTMLMediaElement === 'undefined' || !('setSinkId' in HTMLMediaElement.prototype)}>
              <option value="">Sortie système</option>
              {mediaDevices.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId || `output-${index}`} value={device.deviceId}>{device.label || `Haut-parleur ${index + 1}`}</option>)}
            </select>
          </label>
          <small>Le choix du haut-parleur dépend du navigateur utilisé.</small>
        </div>
      ) : null}
    </main>
  );
}

function Control({ children, label, active, onClick, testId, disabled, title }: { children: ReactNode; label: string; active?: boolean; onClick: () => void; testId?: string; disabled?: boolean; title?: string }) {
  return <button type="button" data-testid={testId} className={`room-v2-control ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-disabled={disabled ? 'true' : undefined}><span>{children}</span><small>{label}</small></button>;
}
