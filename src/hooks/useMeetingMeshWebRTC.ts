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

export type MeetingNetworkQuality = {
  level: 'excellent' | 'good' | 'poor' | 'offline';
  rttMs: number | null;
  packetLossPct: number | null;
  connectedPeers: number;
  totalPeers: number;
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
  breakoutRoomId?: string | null;
  enabled?: boolean;
  peerConnectionsEnabled?: boolean;
  onNotice?: (message: string) => void;
};

type PeerState = {
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswer: boolean;
  restartAttempts: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
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
  breakoutRoomId = null,
  enabled = true,
  peerConnectionsEnabled = true,
  onNotice,
}: UseMeetingMeshWebRTCOptions) {
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteMeetingParticipant[]>([]);
  const [networkQuality, setNetworkQuality] = useState<MeetingNetworkQuality>({
    level: 'offline',
    rttMs: null,
    packetLossPct: null,
    connectedPeers: 0,
    totalPeers: 0,
  });
  const [activeSpeakerSocketId, setActiveSpeakerSocketId] = useState<string | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const mediaRef = useRef(media);
  const joinedRef = useRef(false);
  const rtcConfigRef = useRef<RTCConfiguration>({ iceServers: [], iceCandidatePoolSize: 0 });
  const [rtcConfigReady, setRtcConfigReady] = useState(false);

  const mediaKey = useMemo(() => `${Number(media.audio)}:${Number(media.video)}:${Number(media.screen)}`, [media.audio, media.video, media.screen]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    let cancelled = false;
    setRtcConfigReady(false);
    if (!enabled) return () => { cancelled = true; };
    if (!peerConnectionsEnabled) {
      setRtcConfigReady(true);
      return () => { cancelled = true; };
    }
    void getRtcConfiguration().then((config) => {
      if (cancelled) return;
      rtcConfigRef.current = config;
      setRtcConfigReady(true);
    }).catch(() => {
      if (!cancelled) setRtcConfigReady(true);
    });
    return () => { cancelled = true; };
  }, [enabled, peerConnectionsEnabled]);

  const updateRemoteParticipant = useCallback((participant: ServerMeetingParticipant, patch?: Partial<RemoteMeetingParticipant>) => {
    setRemoteParticipants((current) => {
      const socketId = String(participant.socketId);
      const existing = current.find((item) => item.socketId === socketId);
      if (existing) {
        const nextMedia = participant.media
          ? {
              audio: participant.media.audio ?? existing.media.audio,
              video: participant.media.video ?? existing.media.video,
              screen: participant.media.screen ?? existing.media.screen,
            }
          : existing.media;
        const next: RemoteMeetingParticipant = {
          ...existing,
          socketId,
          userId: participant.userId !== undefined ? String(participant.userId) : existing.userId,
          name: participant.name ?? existing.name,
          avatar: participant.avatar ?? existing.avatar,
          media: nextMedia,
          stream: existing.stream,
          ...patch,
        };
        return current.map((item) => item.socketId === socketId ? next : item);
      }
      return [...current, { ...normalizeParticipant(participant), ...patch }];
    });
  }, []);

  const removeRemoteParticipant = useCallback((socketId: string) => {
    const state = peersRef.current.get(socketId);
    if (state?.disconnectTimer) clearTimeout(state.disconnectTimer);
    peersRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    state?.remoteStream.getTracks().forEach((track) => state.remoteStream.removeTrack(track));
    state?.pc.close();
    setRemoteParticipants((current) => current.filter((item) => item.socketId !== socketId));
  }, []);

  const closeAllPeers = useCallback(() => {
    peersRef.current.forEach((state) => {
      if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
      state.remoteStream.getTracks().forEach((track) => state.remoteStream.removeTrack(track));
      state.pc.close();
    });
    peersRef.current.clear();
    pendingCandidatesRef.current.clear();
    setRemoteParticipants([]);
  }, []);

  const bindRemoteCreatedSenders = useCallback((state: PeerState) => {
    for (const transceiver of state.pc.getTransceivers()) {
      const kind = transceiver.receiver.track.kind;
      if (kind === 'audio' && !state.audioSender) state.audioSender = transceiver.sender;
      if (kind === 'video' && !state.videoSender) state.videoSender = transceiver.sender;
      if ((kind === 'audio' || kind === 'video') && transceiver.direction !== 'sendrecv') {
        transceiver.direction = 'sendrecv';
      }
    }
  }, []);

  const ensureOffererSenders = useCallback((state: PeerState) => {
    bindRemoteCreatedSenders(state);
    if (!state.audioSender) {
      state.audioSender = state.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    }
    if (!state.videoSender) {
      state.videoSender = state.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }
  }, [bindRemoteCreatedSenders]);

  const syncLocalTracks = useCallback(async (state: PeerState, createMissingSenders = false) => {
    if (createMissingSenders) ensureOffererSenders(state);
    else bindRemoteCreatedSenders(state);

    const stream = localStreamRef.current;
    const audioTrack = stream?.getAudioTracks().find((track) => track.readyState === 'live') || null;
    const videoTrack = stream?.getVideoTracks().find((track) => track.readyState === 'live') || null;
    const updates: Promise<void>[] = [];
    if (state.audioSender) updates.push(state.audioSender.replaceTrack(audioTrack));
    if (state.videoSender) updates.push(state.videoSender.replaceTrack(videoTrack));
    await Promise.all(updates);
  }, [bindRemoteCreatedSenders, ensureOffererSenders]);

  const flushPendingCandidates = useCallback(async (socketId: string, state: PeerState) => {
    const pending = pendingCandidatesRef.current.get(socketId) || [];
    pendingCandidatesRef.current.set(socketId, []);
    for (const candidate of pending) {
      await state.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const createPeer = useCallback((targetSocketId: string, prepareOfferer = false) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing) {
      if (prepareOfferer) ensureOffererSenders(existing);
      return existing;
    }

    const pc = new RTCPeerConnection(rtcConfigRef.current);
    const remoteStream = new MediaStream();
    const state: PeerState = {
      pc,
      remoteStream,
      polite: String(socket.id || '') > targetSocketId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      restartAttempts: 0,
      disconnectTimer: null,
      audioSender: null,
      videoSender: null,
    };

    if (prepareOfferer) ensureOffererSenders(state);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('meeting:ice-candidate', {
        meetingId,
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    };

    pc.ontrack = (event) => {
      const duplicateKind = remoteStream.getTracks().find((track) => track.kind === event.track.kind && track.id !== event.track.id);
      if (duplicateKind) remoteStream.removeTrack(duplicateKind);
      if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);

      setRemoteParticipants((current) => current.map((participant) => (
        participant.socketId === targetSocketId ? { ...participant, stream: remoteStream } : participant
      )));

      event.track.addEventListener('ended', () => {
        remoteStream.removeTrack(event.track);
        setRemoteParticipants((current) => current.map((participant) => (
          participant.socketId === targetSocketId ? { ...participant, stream: remoteStream } : participant
        )));
      }, { once: true });
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
        await syncLocalTracks(state, true);
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
    return state;
  }, [ensureOffererSenders, meetingId, onNotice, removeRemoteParticipant, syncLocalTracks]);

  const shouldInitiateOffer = useCallback((targetSocketId: string) => {
    const localSocketId = String(socket.id || '');
    return Boolean(localSocketId && targetSocketId && localSocketId.localeCompare(targetSocketId) < 0);
  }, []);

  const createOffer = useCallback(async (targetSocketId: string, iceRestart = false) => {
    const state = createPeer(targetSocketId, true);
    const { pc } = state;
    if (state.makingOffer || pc.signalingState !== 'stable') return;
    try {
      state.makingOffer = true;
      await syncLocalTracks(state, true);
      await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
      socket.emit('meeting:offer', { meetingId, targetSocketId, offer: pc.localDescription });
    } finally {
      state.makingOffer = false;
    }
  }, [createPeer, meetingId, syncLocalTracks]);

  useEffect(() => {
    if (!enabled || !rtcConfigReady || !meetingId || !localUserId) return undefined;

    const legacyToken = authService.getToken();
    socket.auth = legacyToken ? { token: legacyToken } : {};

    const joinRealtime = () => {
      socket.emit('meeting:join', {
        meetingId,
        name: localName,
        avatar: localAvatar,
        media: mediaRef.current,
        breakoutRoomId,
      }, (response: { ok?: boolean; error?: string; participants?: ServerMeetingParticipant[] }) => {
        if (!response?.ok) {
          joinedRef.current = false;
          onNotice?.(response?.error || 'Connexion temps réel de la réunion impossible.');
          return;
        }
        joinedRef.current = true;
        const rawParticipants = Array.isArray(response.participants) ? response.participants : [];
        const participantsByUser = new Map<string, ServerMeetingParticipant>();
        for (const participant of rawParticipants) {
          const participantUserId = String(participant.userId);
          if (!participant.socketId || participantUserId === localUserId) continue;
          participantsByUser.set(participantUserId, participant);
        }
        const participants = [...participantsByUser.values()];
        setRemoteParticipants(participants.map((participant) => normalizeParticipant(participant)));
        if (peerConnectionsEnabled) {
          for (const participant of participants) {
            const targetSocketId = String(participant.socketId);
            if (!shouldInitiateOffer(targetSocketId)) continue;
            void createOffer(targetSocketId).catch(() => onNotice?.('Connexion vidéo avec un participant impossible.'));
          }
        }
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
      if (String(participant.userId) === localUserId || !participant.socketId) return;
      updateRemoteParticipant(participant);
      const targetSocketId = String(participant.socketId);
      if (peerConnectionsEnabled && shouldInitiateOffer(targetSocketId)) {
        void createOffer(targetSocketId).catch(() => onNotice?.('Connexion vidéo avec un participant impossible.'));
      }
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
      if (!peerConnectionsEnabled || !fromSocketId || String(fromUserId) === localUserId || !offer) return;
      updateRemoteParticipant({ socketId: fromSocketId, userId: fromUserId });
      const state = createPeer(fromSocketId, false);
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
        bindRemoteCreatedSenders(state);
        await flushPendingCandidates(fromSocketId, state);
        if (offer.type === 'offer') {
          await syncLocalTracks(state, false);
          await pc.setLocalDescription(await pc.createAnswer());
          socket.emit('meeting:answer', { meetingId, targetSocketId: fromSocketId, answer: pc.localDescription });
        }
      } catch {
        onNotice?.('Négociation audio/vidéo interrompue avec un participant.');
      }
    };

    const handleAnswer = async ({ fromSocketId, answer }: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      if (!peerConnectionsEnabled) return;
      const state = peersRef.current.get(String(fromSocketId));
      if (!state || !answer) return;
      state.settingRemoteAnswer = true;
      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(answer));
        bindRemoteCreatedSenders(state);
        await flushPendingCandidates(String(fromSocketId), state);
      } catch {
        onNotice?.('Réponse WebRTC invalide reçue.');
      } finally {
        state.settingRemoteAnswer = false;
      }
    };

    const handleIceCandidate = async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      if (!peerConnectionsEnabled || !candidate) return;
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
      if (!peerConnectionsEnabled || !fromSocketId) return;
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
  }, [bindRemoteCreatedSenders, breakoutRoomId, closeAllPeers, createOffer, createPeer, enabled, flushPendingCandidates, localAvatar, localName, localUserId, meetingId, onNotice, peerConnectionsEnabled, removeRemoteParticipant, rtcConfigReady, shouldInitiateOffer, syncLocalTracks, updateRemoteParticipant]);

  useEffect(() => {
    if (!joinedRef.current) return;
    socket.emit('meeting:media-updated', { meetingId, media });
  }, [media, mediaKey, meetingId]);

  useEffect(() => {
    if (!peerConnectionsEnabled) {
      closeAllPeers();
      return;
    }
    peersRef.current.forEach((state, targetSocketId) => {
      const hadAudio = Boolean(state.audioSender?.track);
      const hadVideo = Boolean(state.videoSender?.track);
      void (async () => {
        try {
          await syncLocalTracks(state, false);
          const hasAudio = Boolean(state.audioSender?.track);
          const hasVideo = Boolean(state.videoSender?.track);
          const missingNegotiatedSender = !state.audioSender || !state.videoSender;
          if (missingNegotiatedSender && joinedRef.current && state.pc.signalingState === 'stable') {
            await createOffer(targetSocketId);
            return;
          }
          if ((!hadAudio && hasAudio) || (!hadVideo && hasVideo)) {
            socket.emit('meeting:media-updated', { meetingId, media: mediaRef.current });
          }
        } catch {
          onNotice?.('Mise à jour caméra/micro incomplète pour un participant.');
        }
      })();
    });
  }, [closeAllPeers, createOffer, localStream, meetingId, onNotice, peerConnectionsEnabled, syncLocalTracks]);

  useEffect(() => {
    if (!enabled) {
      setNetworkQuality({ level: 'offline', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
      return undefined;
    }
    if (!peerConnectionsEnabled) {
      setNetworkQuality({ level: 'excellent', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
      setActiveSpeakerSocketId(null);
      return undefined;
    }

    let cancelled = false;
    const sample = async () => {
      const peers = [...peersRef.current.entries()];
      if (peers.length === 0) {
        if (!cancelled) {
          setNetworkQuality({ level: 'excellent', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
          setActiveSpeakerSocketId(null);
        }
        return;
      }

      let connectedPeers = 0;
      let maxRttSeconds = 0;
      let totalLost = 0;
      let totalReceived = 0;
      let loudestSocketId: string | null = null;
      let loudestAudioLevel = 0;

      await Promise.all(peers.map(async ([socketId, { pc }]) => {
        if (pc.connectionState === 'connected') connectedPeers += 1;
        try {
          const reports = await pc.getStats();
          reports.forEach((report) => {
            const stat = report as unknown as Record<string, unknown>;
            if (
              stat.type === 'candidate-pair'
              && (stat.state === 'succeeded' || stat.nominated === true)
              && typeof stat.currentRoundTripTime === 'number'
            ) {
              maxRttSeconds = Math.max(maxRttSeconds, stat.currentRoundTripTime);
            }
            if (stat.type === 'inbound-rtp' && stat.isRemote !== true) {
              const lost = typeof stat.packetsLost === 'number' ? Math.max(0, stat.packetsLost) : 0;
              const received = typeof stat.packetsReceived === 'number' ? Math.max(0, stat.packetsReceived) : 0;
              totalLost += lost;
              totalReceived += received;
              const mediaKind = String(stat.kind || stat.mediaType || '');
              const audioLevel = typeof stat.audioLevel === 'number' ? stat.audioLevel : 0;
              if (mediaKind === 'audio' && audioLevel > loudestAudioLevel) {
                loudestAudioLevel = audioLevel;
                loudestSocketId = socketId;
              }
            }
            if (stat.type === 'track' && String(stat.kind || '') === 'audio') {
              const audioLevel = typeof stat.audioLevel === 'number' ? stat.audioLevel : 0;
              if (audioLevel > loudestAudioLevel) {
                loudestAudioLevel = audioLevel;
                loudestSocketId = socketId;
              }
            }
          });
        } catch {
          // A peer can disappear while stats are being sampled.
        }
      }));

      if (cancelled) return;
      const total = totalLost + totalReceived;
      const packetLossPct = total > 0 ? (totalLost / total) * 100 : 0;
      const rttMs = maxRttSeconds > 0 ? Math.round(maxRttSeconds * 1000) : null;

      let level: MeetingNetworkQuality['level'] = 'excellent';
      if (connectedPeers === 0) level = 'offline';
      else if (connectedPeers < peers.length || (rttMs !== null && rttMs > 350) || packetLossPct > 5) level = 'poor';
      else if ((rttMs !== null && rttMs > 150) || packetLossPct > 2) level = 'good';

      setNetworkQuality({
        level,
        rttMs,
        packetLossPct: Number(packetLossPct.toFixed(1)),
        connectedPeers,
        totalPeers: peers.length,
      });
      setActiveSpeakerSocketId(loudestAudioLevel >= 0.015 ? loudestSocketId : null);
    };

    void sample();
    const timer = window.setInterval(() => { void sample(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, peerConnectionsEnabled]);

  return { remoteParticipants, networkQuality, activeSpeakerSocketId };
}
