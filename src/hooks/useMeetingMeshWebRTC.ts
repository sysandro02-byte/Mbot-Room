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
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
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
    peersRef.current.get(socketId)?.close();
    peersRef.current.delete(socketId);
    pendingCandidatesRef.current.delete(socketId);
    setRemoteParticipants((current) => current.filter((item) => item.socketId !== socketId));
  }, []);

  const attachLocalTracks = useCallback((peer: RTCPeerConnection) => {
    peer.getSenders().forEach((sender) => peer.removeTrack(sender));
    localStreamRef.current?.getTracks().forEach((track) => {
      const stream = localStreamRef.current;
      if (stream) peer.addTrack(track, stream);
    });
  }, []);

  const createPeer = useCallback((targetSocketId: string) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing) return existing;

    const peer = new RTCPeerConnection(getRtcConfiguration());
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('meeting:ice-candidate', {
        meetingId,
        targetSocketId,
        candidate: event.candidate.toJSON(),
      });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteParticipants((current) => current.map((participant) => (
        participant.socketId === targetSocketId ? { ...participant, stream } : participant
      )));
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        removeRemoteParticipant(targetSocketId);
      }
    };
    attachLocalTracks(peer);
    peersRef.current.set(targetSocketId, peer);
    return peer;
  }, [attachLocalTracks, meetingId, removeRemoteParticipant]);

  const createOffer = useCallback(async (targetSocketId: string) => {
    const peer = createPeer(targetSocketId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socket.emit('meeting:offer', { meetingId, targetSocketId, offer });
  }, [createPeer, meetingId]);

  useEffect(() => {
    if (!enabled || !meetingId || !localUserId) return undefined;

    socket.auth = { token: authService.getToken() };
    if (!socket.connected) socket.connect();

    const onParticipants = (response: { ok?: boolean; code?: string; error?: string; participants?: ServerMeetingParticipant[] }) => {
      if (!response?.ok) {
        onNotice?.(response?.error || 'Connexion temps réel de la réunion impossible.');
        return;
      }
      joinedRef.current = true;
      const participants = Array.isArray(response.participants) ? response.participants : [];
      setRemoteParticipants(participants.map((participant) => normalizeParticipant(participant)));
      participants.forEach((participant) => {
        void createOffer(String(participant.socketId)).catch(() => {
          onNotice?.('Connexion video avec un participant impossible.');
        });
      });
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
      if (!fromSocketId || String(fromUserId) === localUserId) return;
      updateRemoteParticipant({ socketId: fromSocketId, userId: fromUserId });
      const peer = createPeer(fromSocketId);
      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const pending = pendingCandidatesRef.current.get(fromSocketId) || [];
      for (const candidate of pending.splice(0)) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.set(fromSocketId, pending);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit('meeting:answer', { meetingId, targetSocketId: fromSocketId, answer });
    };
    const handleAnswer = async ({ fromSocketId, answer }: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      const peer = peersRef.current.get(String(fromSocketId));
      if (!peer) return;
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
      const pending = pendingCandidatesRef.current.get(String(fromSocketId)) || [];
      for (const candidate of pending.splice(0)) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.set(String(fromSocketId), pending);
    };
    const handleIceCandidate = async ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      const peer = peersRef.current.get(String(fromSocketId));
      if (peer?.remoteDescription) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
        return;
      }
      const pending = pendingCandidatesRef.current.get(String(fromSocketId)) || [];
      pending.push(candidate);
      pendingCandidatesRef.current.set(String(fromSocketId), pending);
    };

    socket.emit('meeting:join', {
      meetingId,
      name: localName,
      avatar: localAvatar,
      media: mediaRef.current,
    }, onParticipants);
    socket.on('meeting:participant-joined', handleParticipantJoined);
    socket.on('meeting:participant-left', handleParticipantLeft);
    socket.on('meeting:participant-media-updated', handleMediaUpdated);
    socket.on('meeting:offer', handleOffer);
    socket.on('meeting:answer', handleAnswer);
    socket.on('meeting:ice-candidate', handleIceCandidate);

    return () => {
      socket.emit('meeting:leave', { meetingId });
      socket.off('meeting:participant-joined', handleParticipantJoined);
      socket.off('meeting:participant-left', handleParticipantLeft);
      socket.off('meeting:participant-media-updated', handleMediaUpdated);
      socket.off('meeting:offer', handleOffer);
      socket.off('meeting:answer', handleAnswer);
      socket.off('meeting:ice-candidate', handleIceCandidate);
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      pendingCandidatesRef.current.clear();
      joinedRef.current = false;
      setRemoteParticipants([]);
    };
  }, [createOffer, createPeer, enabled, localAvatar, localName, localUserId, meetingId, onNotice, removeRemoteParticipant, updateRemoteParticipant]);

  useEffect(() => {
    if (!joinedRef.current) return;
    socket.emit('meeting:media-updated', { meetingId, media });
  }, [media, mediaKey, meetingId]);

  useEffect(() => {
    peersRef.current.forEach((peer, socketId) => {
      attachLocalTracks(peer);
      void peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer).then(() => offer))
        .then((offer) => socket.emit('meeting:offer', { meetingId, targetSocketId: socketId, offer }))
        .catch(() => onNotice?.('Mise a jour camera/micro incomplete pour un participant.'));
    });
  }, [attachLocalTracks, localStream, meetingId, onNotice]);

  return { remoteParticipants };
}
