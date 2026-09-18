import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  Camera,
  CameraOff,
  Captions,
  Circle,
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
  Send,
  Settings2,
  ShieldCheck,
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
import {
  BreakoutRoom,
  collaborationService,
  MeetingMessage,
  MeetingParticipant,
  MeetingPoll,
} from '../services/collaborationService';
import { getMeetingAccessCode, LobbyParticipant, Meeting, meetingService } from '../services/meetingService';
import { mediaTransportService, type MediaTransportStatus } from '../services/mediaTransportService';
import { createCompositeMeetingRecording, type CompositeRecordingSession } from '../lib/meetingRecording';
import './MeetingRoomV2.css';

type Panel = 'participants' | 'chat' | 'polls' | 'luna' | 'breakouts' | null;
type MeetingLocationState = {
  guestName?: string;
  joinOptions?: { mic?: boolean; camera?: boolean; backgroundUrl?: string };
  meeting?: Partial<Meeting>;
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

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    const mediaElement = videoRef.current as HTMLVideoElement & { setSinkId?: (deviceId: string) => Promise<void> };
    if (!local && audioOutputId && typeof mediaElement.setSinkId === 'function') {
      void mediaElement.setSinkId(audioOutputId).catch(() => undefined);
    }
    if (stream) void videoRef.current.play().catch(() => undefined);
  }, [audioOutputId, local, stream, videoEnabled]);

  return (
    <article className={`room-v2-tile ${screen ? 'is-screen' : ''} ${activeSpeaker ? 'is-speaking' : ''} ${pinned ? 'is-pinned' : ''}`} data-speaking={activeSpeaker ? 'true' : 'false'}>
      {stream && videoEnabled !== false ? (
        <video ref={videoRef} autoPlay playsInline muted={Boolean(local)} />
      ) : (
        <div className="room-v2-avatar" aria-label={`${name}, caméra coupée`}>
          {avatar ? <img src={avatar} alt="" /> : <span>{initials(name)}</span>}
        </div>
      )}
      <div className="room-v2-tile-meta">
        <span>{name}{local ? ' (vous)' : ''}</span>
        {badge ? <small>{badge}</small> : null}
        {activeSpeaker ? <small className="speaker-badge">Parle</small> : null}
        {handRaised ? <small className="hand-badge" aria-label="Main levée"><Hand size={13}/> Main</small> : null}
        {muted ? <MicOff size={15} aria-label="Micro coupé" /> : <Mic size={15} aria-label="Micro actif" />}
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
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
};

const dedupeMessages = (items: MeetingMessage[]) => {
  const map = new Map(items.map((message) => [message.id, message]));
  return [...map.values()].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
};

export default function MeetingRoomV2() {
  const navigate = useNavigate();
  const location = useLocation();
  const { meetingId = '' } = useParams();
  const state = location.state as MeetingLocationState | null;
  const currentUser = authService.getCurrentUser();
  const isAuthenticated = authService.isAuthenticated();
  const initialMic = state?.joinOptions?.mic !== false;
  const initialCamera = state?.joinOptions?.camera !== false;

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingSessionRef = useRef<CompositeRecordingSession | null>(null);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>('participants');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [selectedVideoInputId, setSelectedVideoInputId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [viewMode, setViewMode] = useState<'gallery' | 'speaker'>('gallery');
  const [pinnedSocketId, setPinnedSocketId] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(initialMic);
  const [cameraEnabled, setCameraEnabled] = useState(initialCamera);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [raisedHands, setRaisedHands] = useState<Set<number>>(new Set());
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
  const [menuUserId, setMenuUserId] = useState<number | null>(null);
  const [mediaTransportStatus, setMediaTransportStatus] = useState<MediaTransportStatus | null>(null);
  const [mediaTransportChecked, setMediaTransportChecked] = useState(false);
  const [liveKitFailed, setLiveKitFailed] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);

  const localUserId = String(currentUser?.id || '');
  const localName = state?.guestName?.trim() || currentUser?.name || currentUser?.username || currentUser?.email || 'Participant';
  const isModerator = Boolean(meeting && currentUser && (
    Number(meeting.host_id) === Number(currentUser.id)
    || Number(meeting.co_host_id || 0) === Number(currentUser.id)
    || currentUser.role === 'admin'
  ));

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

  const mediaState = useMemo(() => ({
    audio: micEnabled && Boolean(localStream?.getAudioTracks().some((track) => track.readyState === 'live')),
    video: !screenSharing && cameraEnabled && Boolean(localStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    screen: screenSharing,
  }), [cameraEnabled, localStream, micEnabled, screenSharing]);

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

  const liveCaptions = useMeetingCaptions({
    meetingId: meeting?.id || 0,
    enabled: Boolean(meeting?.id && captionsEnabled),
    language: typeof navigator !== 'undefined' ? navigator.language : 'fr-FR',
    onNotice: setNotice,
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
        navigate(`/reunions/${found.id}/salle-attente`, { replace: true, state: location.state });
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
    setMediaReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('Votre navigateur ne permet pas l’accès à la caméra ou au microphone.');
      setMediaReady(true);
      return;
    }
    let cancelled = false;
    const openMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: { ideal: 1 },
          },
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.getAudioTracks().forEach((track) => { track.enabled = initialMic; });
        stream.getVideoTracks().forEach((track) => { track.enabled = initialCamera; });
        cameraStreamRef.current = stream;
        setLocalStream(stream);
        setMediaReady(true);
        void refreshMediaDevices();
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : '';
        setNotice(name === 'NotAllowedError'
          ? 'Autorisez la caméra et le microphone dans votre navigateur pour participer avec audio/vidéo.'
          : 'Caméra ou microphone indisponible. Vous pouvez rester dans la réunion sans média local.');
        if (!cancelled) setMediaReady(true);
      }
    };
    void openMedia();
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    };
  }, [initialCamera, initialMic, refreshMediaDevices]);

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
    if (!meeting?.id) return;
    const id = meeting.id;
    const onChat = (message: MeetingMessage) => setMessages((current) => dedupeMessages([...current, message]));
    const onChatDeleted = ({ messageId }: { messageId: string }) => setMessages((current) => current.filter((message) => message.id !== messageId));
    const onPoll = (poll: MeetingPoll) => setPolls((current) => [poll, ...current.filter((item) => item.id !== poll.id)]);
    const onPresence = () => void refreshParticipants();
    const onLobby = () => { void refreshParticipants(); void refreshLobby(); };
    const onHandRaised = (payload: { meetingId: number; userId: number; raised: boolean }) => {
      if (Number(payload.meetingId) !== id) return;
      setRaisedHands((current) => {
        const next = new Set(current);
        if (payload.raised) next.add(Number(payload.userId));
        else next.delete(Number(payload.userId));
        return next;
      });
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
    const onRemoved = () => leaveByHost('Vous avez été retiré de la réunion.');
    const onBanned = () => leaveByHost('Vous avez été exclu de cette réunion.');
    const onMoved = () => navigate(`/reunions/${id}/salle-attente`, { replace: true, state: location.state });

    socket.on('meeting:chat-message', onChat);
    socket.on('meeting:chat-deleted', onChatDeleted);
    socket.on('meeting:poll-updated', onPoll);
    socket.on('meeting:presence', onPresence);
    socket.on('meeting:lobby-updated', onLobby);
    socket.on('meeting:hand-raised', onHandRaised);
    socket.on('meeting:reaction', onReaction);
    socket.on('meeting:breakout-assigned', onBreakoutAssigned);
    socket.on('meeting:breakouts-updated', onBreakoutsUpdated);
    socket.on('meeting:breakouts-opened', onBreakoutsUpdated);
    socket.on('meeting:breakouts-closed', onBreakoutsUpdated);
    socket.on('meeting:locked', onLocked);
    socket.on('meeting:moderation', onModeration);
    socket.on('meeting:ended', onEnded);
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
      socket.off('meeting:reaction', onReaction);
      socket.off('meeting:breakout-assigned', onBreakoutAssigned);
      socket.off('meeting:breakouts-updated', onBreakoutsUpdated);
      socket.off('meeting:breakouts-opened', onBreakoutsUpdated);
      socket.off('meeting:breakouts-closed', onBreakoutsUpdated);
      socket.off('meeting:locked', onLocked);
      socket.off('meeting:moderation', onModeration);
      reactionTimersRef.current.forEach((timer) => clearTimeout(timer));
      reactionTimersRef.current.clear();
      socket.off('meeting:ended', onEnded);
      socket.off('meeting:removed', onRemoved);
      socket.off('meeting:banned', onBanned);
      socket.off('meeting:moved-to-lobby', onMoved);
    };
  }, [location.state, meeting?.id, navigate, refreshBreakouts, refreshLobby, refreshParticipants]);

  const toggleMic = () => {
    const next = !micEnabled;
    cameraStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    if (screenSharing) localStream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
  };

  const toggleCamera = () => {
    const next = !cameraEnabled;
    cameraStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
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
      nextTrack.enabled = kind === 'audioinput' ? micEnabled : cameraEnabled;
      const nextCameraStream = new MediaStream([...preserved, nextTrack]);
      cameraStreamRef.current = nextCameraStream;

      if (!screenSharing) {
        setLocalStream(nextCameraStream);
      } else if (kind === 'audioinput' && screenStreamRef.current) {
        const display = screenStreamRef.current;
        const combined = new MediaStream();
        display.getVideoTracks().filter((track) => track.readyState === 'live').forEach((track) => combined.addTrack(track));
        const displayAudio = display.getAudioTracks().filter((track) => track.readyState === 'live');
        (displayAudio.length ? displayAudio : [nextTrack]).forEach((track) => combined.addTrack(track));
        setLocalStream(combined);
      }

      if (kind === 'audioinput') setSelectedAudioInputId(deviceId);
      else setSelectedVideoInputId(deviceId);
      await refreshMediaDevices();
      setNotice(kind === 'audioinput' ? 'Microphone changé.' : 'Caméra changée.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de changer de périphérique.');
    }
  }, [cameraEnabled, micEnabled, refreshMediaDevices, screenSharing]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    setLocalStream(cameraStreamRef.current);
  }, []);

  const toggleScreenShare = async () => {
    if (screenSharing) {
      stopScreenShare();
      return;
    }
    if (meeting?.settings?.screenShare === false || !navigator.mediaDevices?.getDisplayMedia) {
      setNotice('Le partage d’écran est indisponible ou désactivé par l’hôte.');
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: true });
      const combined = new MediaStream();
      display.getVideoTracks().forEach((track) => combined.addTrack(track));
      const displayAudio = display.getAudioTracks();
      const micAudio = cameraStreamRef.current?.getAudioTracks() || [];
      (displayAudio.length ? displayAudio : micAudio).forEach((track) => combined.addTrack(track));
      display.getVideoTracks()[0]?.addEventListener('ended', stopScreenShare, { once: true });
      screenStreamRef.current = display;
      setScreenSharing(true);
      setLocalStream(combined);
    } catch {
      setNotice('Partage d’écran annulé.');
    }
  };

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const toggleRecording = async () => {
    if (recording) {
      stopRecording();
      return;
    }
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
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mboteroom-${meeting?.id || 'reunion'}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        void recordingSessionRef.current?.stop();
        recordingSessionRef.current = null;
        setRecording(false);
        setNotice('Enregistrement composite terminé et téléchargé.');
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setNotice(`Enregistrement composite démarré pour ${sources.filter((source) => source.stream).length} flux.`);
    } catch {
      setNotice('Impossible de démarrer l’enregistrement local.');
    }
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const text = messageDraft.trim();
    if (!meeting?.id || !text) return;
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

  const moderateParticipant = async (userId: number, action: 'mute' | 'camera' | 'remove' | 'ban' | 'lobby' | 'cohost') => {
    if (!meeting?.id) return;
    setMenuUserId(null);
    try {
      if (action === 'mute') await collaborationService.updateParticipant(meeting.id, userId, { mutedByHost: true });
      if (action === 'camera') await collaborationService.updateParticipant(meeting.id, userId, { cameraDisabledByHost: true });
      if (action === 'cohost') await collaborationService.updateParticipant(meeting.id, userId, { role: 'cohost' });
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

  const leaveMeeting = async (endForAll = false) => {
    if (!meeting?.id) return;
    try {
      if (endForAll && isModerator) await collaborationService.endMeeting(meeting.id);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Impossible de terminer la réunion.');
      return;
    }
    socket.emit('meeting:leave', { meetingId: meeting.id });
    stopRecording();
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    navigate(`/reunions/${meeting.id}/terminee`, { replace: true });
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

  const remoteByUser = new Map(remoteParticipants.map((participant) => [Number(participant.userId), participant]));
  const activeMembers = participants.filter((participant) => participant.status === 'accepted');
  const galleryCount = 1 + remoteParticipants.length;
  const featuredSocketId = pinnedSocketId || activeSpeakerSocketId || remoteParticipants[0]?.socketId || null;
  const featuredParticipant = featuredSocketId ? remoteParticipants.find((participant) => participant.socketId === featuredSocketId) || null : null;
  const speakerViewEnabled = viewMode === 'speaker' && Boolean(featuredParticipant);

  return (
    <main className="room-v2-shell">
      <header className="room-v2-header">
        <div>
          <strong>{meeting.title}</strong>
          <span>ID {meeting.settings?.meetingAccessId || getMeetingAccessCode(meeting)}</span>
        </div>
        <div className="room-v2-live-state">
          {meeting.is_active ? <><Radio size={16} /> En direct</> : <span>Programmée</span>}
          <span>{galleryCount} connecté{galleryCount > 1 ? 's' : ''}</span>
          {breakoutRoomName ? <span className="room-v2-breakout-status">Sous-salle : {breakoutRoomName}</span> : null}
          <span
            className={`room-v2-media-transport ${liveKitMedia.connected ? 'sfu-active' : liveKitDesired ? 'sfu-connecting' : 'mesh-active'}`}
            data-testid="media-transport-status"
            data-transport={liveKitMedia.connected ? 'livekit' : 'mesh'}
            title={liveKitMedia.connected
              ? 'Transport média SFU LiveKit actif.'
              : liveKitDesired
                ? 'Connexion au SFU LiveKit en cours.'
                : liveKitFailed
                  ? 'Le SFU est indisponible. Le mesh WebRTC a repris automatiquement.'
                  : 'Transport média mesh WebRTC actif.'}
          >
            {liveKitMedia.connected ? 'SFU actif' : liveKitDesired ? 'Connexion SFU…' : 'Mesh actif'}
            {!liveKitMedia.connected && mediaTransportStatus?.livekitReady && !liveKitFailed ? <small> · SFU prêt</small> : null}
            {liveKitFailed ? <small> · secours</small> : null}
            {mediaTransportStatus?.serverRecordingReady ? <small> · Rec. serveur prêt</small> : null}
          </span>
          <span
            className={`room-v2-network ${networkQuality.level}`}
            data-testid="network-quality"
            data-level={networkQuality.level}
            title={`${liveKitMedia.connected ? 'SFU' : 'Pairs'} ${networkQuality.connectedPeers}/${networkQuality.totalPeers} · Latence ${networkQuality.rttMs ?? '—'} ms · Pertes ${networkQuality.packetLossPct ?? '—'} %`}
          >
            {networkQuality.level === 'offline' ? <WifiOff size={15} /> : <Wifi size={15} />}
            {networkQuality.level === 'excellent' ? 'Réseau excellent' : networkQuality.level === 'good' ? 'Réseau correct' : networkQuality.level === 'poor' ? 'Réseau faible' : 'Hors ligne'}
            {networkQuality.rttMs !== null ? <small>{networkQuality.rttMs} ms</small> : null}
          </span>
        </div>
        <div className="room-v2-header-actions">
          <div className="room-v2-view-switch" role="group" aria-label="Mode d’affichage">
            <button type="button" className={viewMode === 'gallery' ? 'active' : ''} onClick={() => setViewMode('gallery')} data-testid="gallery-view-button">Galerie</button>
            <button type="button" className={viewMode === 'speaker' ? 'active' : ''} onClick={() => setViewMode('speaker')} data-testid="speaker-view-button">Intervenant</button>
          </div>
          {isModerator && !meeting.is_active ? <button className="room-v2-start" type="button" onClick={startMeeting}>Démarrer</button> : null}
        </div>
      </header>

      {notice ? <div className="room-v2-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fermer"><X size={16}/></button></div> : null}

      {captionsEnabled && liveCaptions.captions.length ? (
        <div className="room-v2-caption-overlay" data-testid="caption-overlay" aria-live="polite">
          {liveCaptions.captions.slice(-2).map((caption) => (
            <p key={caption.id}><strong>{caption.speaker}</strong><span>{caption.text}</span></p>
          ))}
        </div>
      ) : null}

      <section className="room-v2-body">
        <div className={`room-v2-stage ${speakerViewEnabled ? 'speaker-mode' : ''}`}>
          {speakerViewEnabled && featuredParticipant ? (
            <div className="room-v2-speaker-layout" data-testid="speaker-layout">
              <div className="room-v2-speaker-main">
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
              <div className="room-v2-speaker-strip">
                <VideoTile
                  name={localName}
                  stream={localStream}
                  avatar={currentUser?.avatar}
                  muted={!mediaState.audio}
                  videoEnabled={screenSharing || mediaState.video}
                  screen={screenSharing}
                  badge={isModerator ? 'Hôte' : currentUser?.isGuest ? 'Invité' : undefined}
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
                badge={isModerator ? 'Hôte' : currentUser?.isGuest ? 'Invité' : undefined}
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
                  const remote = remoteByUser.get(member.userId);
                  const isSelf = member.userId === Number(currentUser?.id || 0);
                  return (
                    <article key={member.userId}>
                      <div className="room-v2-person-avatar">{member.avatar ? <img src={member.avatar} alt=""/> : initials(member.name)}</div>
                      <div><strong>{member.name}{isSelf ? ' (vous)' : ''}{raisedHands.has(member.userId) || (isSelf && handRaised) ? <span className="room-v2-raised-inline"> · ✋</span> : null}</strong><small>{member.role === 'host' ? 'Hôte' : member.role === 'cohost' ? 'Co-hôte' : member.isGuest ? 'Invité' : 'Participant'}{remote || isSelf ? ' · En ligne' : ''}</small></div>
                      {isModerator && !isSelf && member.role !== 'host' ? (
                        <div className="room-v2-person-menu-wrap">
                          <button type="button" onClick={() => setMenuUserId(menuUserId === member.userId ? null : member.userId)}><MoreVertical size={18}/></button>
                          {menuUserId === member.userId ? (
                            <div className="room-v2-person-menu">
                              <button onClick={() => void moderateParticipant(member.userId, 'mute')}>Couper le micro</button>
                              <button onClick={() => void moderateParticipant(member.userId, 'camera')}>Couper la caméra</button>
                              <button onClick={() => void moderateParticipant(member.userId, 'cohost')}>Nommer co-hôte</button>
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
                  <textarea value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} maxLength={2000} placeholder={meeting.settings?.chat === false ? 'Chat désactivé' : 'Écrire un message…'} disabled={meeting.settings?.chat === false}/>
                  <button type="submit" disabled={!messageDraft.trim() || meeting.settings?.chat === false}><Send size={18}/></button>
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
                <form onSubmit={createPoll} className="room-v2-poll-create">
                  <input value={pollQuestion} onChange={(event) => setPollQuestion(event.target.value)} placeholder="Question du sondage" maxLength={300}/>
                  {pollOptions.map((option, index) => (
                    <input key={index} value={option} onChange={(event) => setPollOptions((current) => current.map((value, i) => i === index ? event.target.value : value))} placeholder={`Option ${index + 1}`} maxLength={120}/>
                  ))}
                  <button type="button" onClick={() => setPollOptions((current) => current.length < 6 ? [...current, ''] : current)}>+ Option</button>
                  <button type="submit" disabled={!pollQuestion.trim() || pollOptions.filter((value) => value.trim()).length < 2}>Créer le sondage</button>
                </form>
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
                <p>Luna répond uniquement avec les informations que vous lui fournissez. Elle ne prétend pas écouter la réunion sans transcription.</p>
                <form onSubmit={askLuna}>
                  <textarea value={lunaPrompt} onChange={(event) => setLunaPrompt(event.target.value)} placeholder="Ex. Résume les décisions décrites dans ce texte…" maxLength={5000}/>
                  <button type="submit" disabled={lunaLoading || !lunaPrompt.trim()}>{lunaLoading ? 'Analyse…' : 'Demander à Luna'}</button>
                </form>
                {lunaAnswer ? <div className="room-v2-luna-answer">{lunaAnswer}</div> : null}
              </div>
            ) : null}
          </aside>
        ) : null}
      </section>

      <footer className="room-v2-controls">
        <Control active={micEnabled} label={micEnabled ? 'Micro' : 'Micro coupé'} onClick={toggleMic}>{micEnabled ? <Mic/> : <MicOff/>}</Control>
        <Control active={cameraEnabled} label={cameraEnabled ? 'Caméra' : 'Caméra coupée'} onClick={toggleCamera}>{cameraEnabled ? <Camera/> : <CameraOff/>}</Control>
        <Control active={screenSharing} label="Partager" onClick={() => void toggleScreenShare()}><MonitorUp/></Control>
        <Control
          active={captionsEnabled}
          label={captionsEnabled ? (liveCaptions.active ? 'Sous-titres' : 'Sous-titres affichés') : 'Sous-titres'}
          testId="captions-button"
          onClick={() => setCaptionsEnabled((current) => !current)}
        ><Captions/></Control>
        <Control active={handRaised} label={handRaised ? 'Baisser la main' : 'Main'} onClick={() => { const raised = !handRaised; setHandRaised(raised); setRaisedHands((current) => { const next = new Set(current); if (raised) next.add(Number(currentUser?.id || 0)); else next.delete(Number(currentUser?.id || 0)); return next; }); socket.emit('meeting:hand-raised',{meetingId:meeting.id,raised}); }}><Hand/></Control>
        <div className="room-v2-reaction-wrap">
          <Control active={reactionPanelOpen} label="Réactions" testId="reaction-button" onClick={() => setReactionPanelOpen((current) => !current)}>😊</Control>
          {reactionPanelOpen ? (
            <div className="room-v2-reaction-panel" data-testid="reaction-panel">
              {['👍','👏','❤️','🎉','😂'].map((reaction) => (
                <button key={reaction} type="button" onClick={() => { setReactionPanelOpen(false); socket.emit('meeting:reaction',{meetingId:meeting.id,reaction}); }}>{reaction}</button>
              ))}
            </div>
          ) : null}
        </div>
        <Control active={panel === 'participants'} label="Participants" onClick={() => setPanel(panel === 'participants' ? null : 'participants')}><UsersRound/></Control>
        <Control active={panel === 'chat'} label="Discussion" onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageCircle/></Control>
        <Control active={panel === 'polls'} label="Sondages" onClick={() => setPanel(panel === 'polls' ? null : 'polls')}><Vote/></Control>
        {isModerator ? <Control active={panel === 'breakouts'} label="Sous-salles" testId="breakout-button" onClick={() => { setPanel(panel === 'breakouts' ? null : 'breakouts'); void refreshBreakouts(); }}><UsersRound/></Control> : null}
        <Control active={panel === 'luna'} label="Luna" onClick={() => setPanel(panel === 'luna' ? null : 'luna')}><Bot/></Control>
        {isModerator ? <Control active={Boolean(meeting.settings?.locked)} label={meeting.settings?.locked ? 'Déverrouiller' : 'Verrouiller'} testId="meeting-lock-button" onClick={() => void toggleMeetingLock()}><ShieldCheck/></Control> : null}
        <div className="room-v2-device-wrap">
          <Control
            active={devicePanelOpen}
            label="Périphériques"
            testId="device-settings-button"
            onClick={() => { setDevicePanelOpen((current) => !current); if (!devicePanelOpen) void refreshMediaDevices(); }}
          ><Settings2/></Control>
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
                <select
                  value={selectedAudioOutputId}
                  onChange={(event) => setSelectedAudioOutputId(event.target.value)}
                  disabled={typeof HTMLMediaElement === 'undefined' || !('setSinkId' in HTMLMediaElement.prototype)}
                >
                  <option value="">Sortie système</option>
                  {mediaDevices.filter((device) => device.kind === 'audiooutput').map((device, index) => <option key={device.deviceId || `output-${index}`} value={device.deviceId}>{device.label || `Haut-parleur ${index + 1}`}</option>)}
                </select>
              </label>
              <small>Le choix du haut-parleur dépend du navigateur. Chrome/Edge le prennent généralement en charge.</small>
            </div>
          ) : null}
        </div>
        <Control active={recording} label={recording ? 'Stop rec.' : 'Enregistrer'} onClick={() => void toggleRecording()}>{recording ? <Square/> : <Circle/>}</Control>
        <div className="room-v2-leave-actions">
          <button type="button" className="room-v2-leave" onClick={() => void leaveMeeting(false)}><LogOut size={18}/> Quitter</button>
          {isModerator ? <button type="button" className="room-v2-end" onClick={() => void leaveMeeting(true)}><PhoneOff size={18}/> Terminer pour tous</button> : null}
        </div>
      </footer>
    </main>
  );
}

function Control({ children, label, active, onClick, testId }: { children: ReactNode; label: string; active?: boolean; onClick: () => void; testId?: string }) {
  return <button type="button" data-testid={testId} className={`room-v2-control ${active ? 'active' : ''}`} onClick={onClick}><span>{children}</span><small>{label}</small></button>;
}
