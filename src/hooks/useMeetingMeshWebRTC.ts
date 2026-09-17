import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { socket } from '../lib/socket';
import { authService } from '../services/authService';
import { getRtcConfiguration } from '../lib/webrtc';

type MeetingMediaState = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

export type RemoteMeetingParticipant = {
  socketId: string;
  userId: string;
  name: string;
  avatar: string;
  stream: MediaStream | null;
  media: MeetingMediaState;
};

type ServerMeetingParticipant = {
  socketId: string;
  userId: number | string;
  name?: string;
  avatar?: string;
  media?: Partial<MeetingMediaState>;
};

type UseMeetingMeshWebRTCOptions = {
  meetingId: number;
  localUserId: string;
  localName: string;
  localAvatar?: string;
  localStream: MediaStream | null;
  media: MeetingMediaState;
  enabled?: boolean;
  onNotice?: (message: string) => void;
};

type PeerState = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  restartAttempts: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
};

const DISCONNECT_GRACE_MS = 8_000;
const MAX_ICE_RESTARTS = 2;

const normalizeParticipant = (participant: ServerMeetingParticipant, stream: MediaStream | null = null): RemoteMeetingParticipant => ({
  socketId: String(participant.socketId),
  userId: String(participant.userId),
  name: participant.name || 'Participant',
  avatar: participant.avatar || '',
  stream,
  media: {
    audio: Boolean(participant.media?.audio),
    video: Boolean(participant.media?.video),
    screen: Boolean(participant.media?.screen),
  },
});

export function useMeetingMeshWebRTC({
  meetingId,
  localUserId,
  localName,
  localAvatar = '',
  localStream,
  media,
  enabled = true,
  onNotice,
}: UseMeetingMeshWebRTCOptions) {
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteMeetingParticipant[]>([]);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const mediaRef = useRef(media);
  const joinedRef = useRef(false);

  const mediaKey = useMemo(() => `${Number(media.audio)}:${Number(media.video)}:${Number(media.screen)}`, [media.audio, media.video, media.screen]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  const updateRemoteParticipant = useCallback((participant: ServerMeetingParticipant, patch?: Partial<RemoteMeetingParticipant>) => {
    setRemoteParticipants((current) => {
      const normalized = normalizeParticipant(participant);
      const existing = current.find((item) => item.socketId === normalized.socketId);
      if (existing) {
        return current.map((item) => (
          item.socketId === normalized.socketId
            ? { ...item, ...normalized, stream: item.stream, ...patch }
            : item
        ));
      }
      return [...current, { ...normalized, ...patch }];
    });
  }, []);

  const removeRemoteParticipant = useCallback((socketId: string) => {
    const state = peersRef.current.get(socketId);
    if (state?.disconnectTimer) clearTimeout(state.disconnectTimer);
    peersRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    state?.pc.close();
    setRemoteParticipants((current) => current.filter((item) => item.socketId !== socketId));
  }, []);

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach((state) => {
      if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
      state.pc.close();
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    setRemoteParticipants([]);
  }, []);

  const syncLocalTracks = useCallback(async (state: PeerState) => {
    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks().find((track) => track.readyState === 'live') || null;
    const videoTrack = stream?.getVideoTracks().find((track) => track.readyState === 'live') || null;
    await Promise.all([
      state.audioSender.replaceTrack(audioTrack),
      state.videoSender.replaceTrack(videoTrack),
    ]);
  }, []);

  const flushPendingCandidates = useCallback(async (socketId: string, state: PeerState) => {
    const pending = pendingCandidatesRef.current.get(socketId) || [];
    pendingCandidatesRef.current.set(socketId, []);
    for (const candidate of pending) {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const createPeer = useCallback((targetSocketId: string) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing) return existing;

    const pc = new RTCPeerConnection(getRtcConfiguration());
    const audioSender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const videoSender = pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    const state: PeerState = {
      pc,
      polite: String(socket.id || '') > targetSocketId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      restartAttempts: 0,
      disconnectTimer: null,
      audioSender,
      videoSender,
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('meeting:ice-candidate', {
        meetingId,
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteParticipants((current) => current.map((participant) => (
        participant.socketId === targetSocketId ? { ...participant, stream } : participant
      )));
    };

    const clearDisconnectTimer = () => {
      if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
      state.disconnectTimer = null;
    };

    const restartIce = async () => {
      if (pc.connectionState === 'closed') return;
      if (state.restartAttempts >= MAX_ICE_RESTARTS) {
        onNotice?.('La connexion média avec un participant reste instable. Vérifiez votre réseau ou le serveur TURN.');
        return;
      }
      state.restartAttempts += 1;
      try {
        pc.restartIce();
        if (pc.signalingState !== 'stable' || state.makingOffer) return;
        state.makingOffer = true;
        await syncLocalTracks(state);
        await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
        socket.emit('meeting:offer', { meetingId, targetSocketId, offer: pc.localDescription });
      } catch {
        onNotice?.('Tentative de reconnexion audio/vidéo en cours.');
      } finally {
        state.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearDisconnectTimer();
        state.restartAttempts = 0;
        return;
      }
      if (pc.connectionState === 'failed') {
        clearDisconnectTimer();
        void restartIce();
        return;
      }
      if (pc.connectionState === 'disconnected') {
        clearDisconnectTimer();
        state.disconnectTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') void restartIce();
        }, DISCONNECT_GRACE_MS);
        return;
      }
      if (pc.connectionState === 'closed') removeRemoteParticipant(targetSocketId);
    };

    peersRef.current.set(targetSocketId, state);
    void syncLocalTracks(state);
    return state;
  }, [meetingId, onNotice, removeRemoteParticipant, syncLocalTracks]);

  const createOffer = useCallback(async (targetSocketId: string, iceRestart = false) => {
    const state = createPeer(targetSocketId);
    const { pc } = state;
    if (state.makingOffer || pc.signalingState !== 'stable') return;
    try {
      state.makingOffer = true;
      await syncLocalTracks(state);
      await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
      socket.emit('meeting:offer', { meetingId, targetSocketId, offer: pc.localDescription });
    } finally {
      state.makingOffer = false;
    }
  }, [createPeer, meetingId, syncLocalTracks]);

  useEffect(() => {
    if (!enabled || !meetingId || !localUserId) return undefined;

    socket.auth = { token: authService.getToken() };

    const joinRealtime = () => {
      socket.emit('meeting:join', {
        meetingId,
        name: localName,
        avatar: localAvatar,
        media: mediaRef.current,
      }, (response: { ok?: boolean; error?: string; participants?: ServerMeetingParticipant[] }) => {
        if (!response?.ok) {
          joinedRef.current = false;
          onNotice?.(response?.error || 'Connexion temps réel de la réunion impossible.');
          return;
        }
        joinedRef.current = true;
        const participants = Array.isArray(response.participants) ? response.participants : [];
        setRemoteParticipants(participants.map((participant) => normalizeParticipant(participant)));
        participants.forEach((participant) => {
          void createOffer(String(participant.socketId)).catch(() => onNotice?.('Connexion vidéo avec un participant impossible.'));
        });
      });
    };

    const handleSocketDisconnect = () => {
      joinedRef.current = false;
      closeAllPeers();
    };

    const handleConnectError = () => {
      joinedRef.current = false;
      onNotice?.('Connexion temps réel interrompue. Nouvelle tentative automatique…');
    };

    const handleParticipantJoined = (participant: ServerMeetingParticipant) => {
      if (String(participant.userId) === localUserId) return;
      updateRemoteParticipant(participant);
    };
    const handleParticipantLeft = ({ socketId }: { socketId: string }) => removeRemoteParticipant(String(socketId));
    const handleMediaUpdated = (payload: ServerMeetingParticipant) => {
      updateRemoteParticipant(payload, {
        media: {
          audio: Boolean(payload.media?.audio),
          video: Boolean(payload.media?.video),
          screen: Boolean(payload.media?.screen),
        },
      });
    };

    const handleOffer = async ({ fromSocketId, fromUserId, offer }: { fromSocketId: string; fromUserId: string | number; offer: RTCSessionDescriptionInit }) => {
      if (!fromSocketId || String(fromUserId) === localUserId || !offer) return;
      updateRemoteParticipant({ socketId: fromSocketId, userId: fromUserId });
      const state = createPeer(fromSocketId);
      const { pc } = state;
      const readyForOffer = !state.makingOffer && (pc.signalingState === 'stable' || state.settingRemoteAnswer);
      const offerCollision = offer.type === 'offer' && !readyForOffer;
      state.ignoreOffer = !state.polite && offerCollision;
      if (state.ignoreOffer) return;

      try {
        if (offerCollision && state.polite && pc.signalingState !== 'stable') {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates(fromSocketId, state);
        if (offer.type === 'offer') {
          await syncLocalTracks(state);
          await pc.setLocalDescription(await pc.createAnswer());
          socket.emit('meeting:answer', { meetingId, targetSocketId: fromSocketId, answer: pc.localDescription });
        }
      } catch {
        onNotice?.('Négociation audio/vidéo interrompue avec un participant.');
      }
    };

    const handleAnswer = async ({ fromSocketId, answer }: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      const state = peersRef.current.get(String(fromSocketId));
      if (!state || !answer) return;
      state.settingRemoteAnswer = true;
      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingCandidates(String(fromSocketId), state);
      } catch {
        onNotice?.('Réponse WebRTC invalide reçue.');
      } finally {
        state.settingRemoteAnswer = false;
      }
    };

    const handleIceCandidate = async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      if (!candidate) return;
      const state = peersRef.current.get(String(fromSocketId));
      if (state?.ignoreOffer) return;
      if (state?.pc.remoteDescription) {
        try {
          await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          onNotice?.('Un candidat réseau WebRTC a été ignoré.');
        }
        return;
      }
      const pending = pendingCandidatesRef.current.get(String(fromSocketId)) || [];
      pending.push(candidate);
      pendingCandidatesRef.current.set(String(fromSocketId), pending);
    };

    const handleIceRestartRequested = ({ fromSocketId }: { fromSocketId: string }) => {
      if (!fromSocketId) return;
      void createOffer(String(fromSocketId), true).catch(() => onNotice?.('Redémarrage ICE impossible.'));
    };

    socket.on('connect', joinRealtime);
    socket.on('disconnect', handleSocketDisconnect);
    socket.on('connect_error', handleConnectError);
    socket.on('meeting:participant-joined', handleParticipantJoined);
    socket.on('meeting:participant-left', handleParticipantLeft);
    socket.on('meeting:participant-media-updated', handleMediaUpdated);
    socket.on('meeting:offer', handleOffer);
    socket.on('meeting:answer', handleAnswer);
    socket.on('meeting:ice-candidate', handleIceCandidate);
    socket.on('meeting:ice-restart-requested', handleIceRestartRequested);

    if (socket.connected) joinRealtime();
    else socket.connect();

    return () => {
      if (socket.connected) socket.emit('meeting:leave', { meetingId });
      socket.off('connect', joinRealtime);
      socket.off('disconnect', handleSocketDisconnect);
      socket.off('connect_error', handleConnectError);
      socket.off('meeting:participant-joined', handleParticipantJoined);
      socket.off('meeting:participant-left', handleParticipantLeft);
      socket.off('meeting:participant-media-updated', handleMediaUpdated);
      socket.off('meeting:offer', handleOffer);
      socket.off('meeting:answer', handleAnswer);
      socket.off('meeting:ice-candidate', handleIceCandidate);
      socket.off('meeting:ice-restart-requested', handleIceRestartRequested);
      closeAllPeers();
      joinedRef.current = false;
    };
  }, [closeAllPeers, createOffer, createPeer, enabled, flushPendingCandidates, localAvatar, localName, localUserId, meetingId, onNotice, removeRemoteParticipant, syncLocalTracks, updateRemoteParticipant]);

  useEffect(() => {
    if (!joinedRef.current) return;
    socket.emit('meeting:media-updated', { meetingId, media });
  }, [media, mediaKey, meetingId]);

  useEffect(() => {
    peersRef.current.forEach((state) => {
      void syncLocalTracks(state).catch(() => onNotice?.('Mise à jour caméra/micro incomplète pour un participant.'));
    });
  }, [localStream, onNotice, syncLocalTracks]);

  return { remoteParticipants };
}
