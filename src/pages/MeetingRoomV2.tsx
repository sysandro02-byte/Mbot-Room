import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bot,
  Camera,
  CameraOff,
  Circle,
  Hand,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PhoneOff,
  Radio,
  Send,
  ShieldCheck,
  Square,
  UsersRound,
  Vote,
  X,
} from 'lucide-react';
import { useMeetingMeshWebRTC, RemoteMeetingParticipant } from '../hooks/useMeetingMeshWebRTC';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import {
  collaborationService,
  MeetingMessage,
  MeetingParticipant,
  MeetingPoll,
} from '../services/collaborationService';
import { getMeetingAccessCode, Meeting, meetingService } from '../services/meetingService';
import './MeetingRoomV2.css';

type Panel = 'participants' | 'chat' | 'polls' | 'luna' | null;
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
};

const initials = (value: string) => String(value || 'MB')
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase();

function VideoTile({ name, stream, avatar, muted, videoEnabled, screen, badge, local }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    if (stream) void videoRef.current.play().catch(() => undefined);
  }, [stream]);

  return (
    <article className={`room-v2-tile ${screen ? 'is-screen' : ''}`}>
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
        {muted ? <MicOff size={15} aria-label="Micro coupé" /> : <Mic size={15} aria-label="Micro actif" />}
      </div>
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

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<Panel>('participants');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(initialMic);
  const [cameraEnabled, setCameraEnabled] = useState(initialCamera);
  const [screenSharing, setScreenSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [polls, setPolls] = useState<MeetingPoll[]>([]);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [lunaPrompt, setLunaPrompt] = useState('');
  const [lunaAnswer, setLunaAnswer] = useState('');
  const [lunaLoading, setLunaLoading] = useState(false);
  const [menuUserId, setMenuUserId] = useState<number | null>(null);

  const localUserId = String(currentUser?.id || '');
  const localName = state?.guestName?.trim() || currentUser?.name || currentUser?.username || currentUser?.email || 'Participant';
  const isModerator = Boolean(meeting && currentUser && (
    Number(meeting.host_id) === Number(currentUser.id)
    || Number(meeting.co_host_id || 0) === Number(currentUser.id)
    || currentUser.role === 'admin'
  ));

  const mediaState = useMemo(() => ({
    audio: micEnabled && Boolean(localStream?.getAudioTracks().some((track) => track.readyState === 'live')),
    video: !screenSharing && cameraEnabled && Boolean(localStream?.getVideoTracks().some((track) => track.readyState === 'live')),
    screen: screenSharing,
  }), [cameraEnabled, localStream, micEnabled, screenSharing]);

  const { remoteParticipants } = useMeetingMeshWebRTC({
    meetingId: meeting?.id || 0,
    localUserId,
    localName,
    localAvatar: currentUser?.avatar || '',
    localStream,
    media: mediaState,
    enabled: Boolean(meeting?.id && localUserId && isAuthenticated),
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
    if (!meeting?.id) return;
    let cancelled = false;
    const load = async () => {
      const [memberRows, chatRows, pollRows] = await Promise.all([
        collaborationService.getParticipants(meeting.id).catch(() => []),
        collaborationService.getMessages(meeting.id).catch(() => []),
        collaborationService.getPolls(meeting.id).catch(() => []),
      ]);
      if (cancelled) return;
      setParticipants(memberRows);
      setMessages(dedupeMessages(chatRows));
      setPolls(pollRows);
    };
    void load();
    return () => { cancelled = true; };
  }, [meeting?.id]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('Votre navigateur ne permet pas l’accès à la caméra ou au microphone.');
      return;
    }
    let cancelled = false;
    const openMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
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
      } catch (cause) {
        const name = cause instanceof DOMException ? cause.name : '';
        setNotice(name === 'NotAllowedError'
          ? 'Autorisez la caméra et le microphone dans votre navigateur pour participer avec audio/vidéo.'
          : 'Caméra ou microphone indisponible. Vous pouvez rester dans la réunion sans média local.');
      }
    };
    void openMedia();
    return () => {
      cancelled = true;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    };
  }, [initialCamera, initialMic]);

  const refreshParticipants = useCallback(async () => {
    if (!meeting?.id) return;
    setParticipants(await collaborationService.getParticipants(meeting.id).catch(() => []));
  }, [meeting?.id]);

  useEffect(() => {
    if (!meeting?.id) return;
    const id = meeting.id;
    const onChat = (message: MeetingMessage) => setMessages((current) => dedupeMessages([...current, message]));
    const onChatDeleted = ({ messageId }: { messageId: string }) => setMessages((current) => current.filter((message) => message.id !== messageId));
    const onPoll = (poll: MeetingPoll) => setPolls((current) => [poll, ...current.filter((item) => item.id !== poll.id)]);
    const onPresence = () => void refreshParticipants();
    const onLobby = () => void refreshParticipants();
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
      socket.off('meeting:moderation', onModeration);
      socket.off('meeting:ended', onEnded);
      socket.off('meeting:removed', onRemoved);
      socket.off('meeting:banned', onBanned);
      socket.off('meeting:moved-to-lobby', onMoved);
    };
  }, [location.state, meeting?.id, navigate, refreshParticipants]);

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

  const toggleRecording = () => {
    if (recording) {
      stopRecording();
      return;
    }
    const stream = localStream;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setNotice('L’enregistrement local n’est pas disponible dans ce navigateur.');
      return;
    }
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
        setRecording(false);
        setNotice('Enregistrement local terminé et téléchargé.');
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording(true);
      setNotice('Enregistrement local démarré. Il contient votre flux local, pas les vidéos distantes.');
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
        </div>
        {isModerator && !meeting.is_active ? <button className="room-v2-start" type="button" onClick={startMeeting}>Démarrer</button> : null}
      </header>

      {notice ? <div className="room-v2-notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fermer"><X size={16}/></button></div> : null}

      <section className="room-v2-body">
        <div className="room-v2-stage">
          <div className={`room-v2-gallery count-${Math.min(galleryCount, 9)}`}>
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
              />
            ))}
          </div>
        </div>

        {panel ? (
          <aside className="room-v2-panel">
            <div className="room-v2-panel-title">
              <h2>{panel === 'participants' ? 'Participants' : panel === 'chat' ? 'Discussion' : panel === 'polls' ? 'Sondages' : 'Luna IA'}</h2>
              <button type="button" onClick={() => setPanel(null)} aria-label="Fermer"><X size={20}/></button>
            </div>

            {panel === 'participants' ? (
              <div className="room-v2-participants">
                {activeMembers.map((member) => {
                  const remote = remoteByUser.get(member.userId);
                  const isSelf = member.userId === Number(currentUser?.id || 0);
                  return (
                    <article key={member.userId}>
                      <div className="room-v2-person-avatar">{member.avatar ? <img src={member.avatar} alt=""/> : initials(member.name)}</div>
                      <div><strong>{member.name}{isSelf ? ' (vous)' : ''}</strong><small>{member.role === 'host' ? 'Hôte' : member.role === 'cohost' ? 'Co-hôte' : member.isGuest ? 'Invité' : 'Participant'}{remote || isSelf ? ' · En ligne' : ''}</small></div>
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
        <Control active={handRaised} label="Main" onClick={() => { const raised = !handRaised; setHandRaised(raised); socket.emit('meeting:hand-raised',{meetingId:meeting.id,raised}); }}><Hand/></Control>
        <Control active={panel === 'participants'} label="Participants" onClick={() => setPanel(panel === 'participants' ? null : 'participants')}><UsersRound/></Control>
        <Control active={panel === 'chat'} label="Discussion" onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><MessageCircle/></Control>
        <Control active={panel === 'polls'} label="Sondages" onClick={() => setPanel(panel === 'polls' ? null : 'polls')}><Vote/></Control>
        <Control active={panel === 'luna'} label="Luna" onClick={() => setPanel(panel === 'luna' ? null : 'luna')}><Bot/></Control>
        <Control active={recording} label={recording ? 'Stop rec.' : 'Enregistrer local'} onClick={toggleRecording}>{recording ? <Square/> : <Circle/>}</Control>
        <div className="room-v2-leave-actions">
          <button type="button" className="room-v2-leave" onClick={() => void leaveMeeting(false)}><LogOut size={18}/> Quitter</button>
          {isModerator ? <button type="button" className="room-v2-end" onClick={() => void leaveMeeting(true)}><PhoneOff size={18}/> Terminer pour tous</button> : null}
        </div>
      </footer>
    </main>
  );
}

function Control({ children, label, active, onClick }: { children: ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return <button type="button" className={`room-v2-control ${active ? 'active' : ''}`} onClick={onClick}><span>{children}</span><small>{label}</small></button>;
}
