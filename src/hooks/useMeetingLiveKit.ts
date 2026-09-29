import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadLiveKitClient,
  type LiveKitRoomLike,
  type LiveKitSdk,
  type LiveKitTrackPublicationLike,
} from '../lib/livekitClient';
import { mediaTransportService } from '../services/mediaTransportService';
import type { MeetingNetworkQuality, RemoteMeetingParticipant } from './useMeetingMeshWebRTC';

type MeetingMediaState = {
  audio: boolean;
  video: boolean;
  screen: boolean;
};

type UseMeetingLiveKitOptions = {
  meetingId: number;
  breakoutRoomId?: string | null;
  localStream: MediaStream | null;
  media: MeetingMediaState;
  enabled?: boolean;
  sessionKey?: string | number;
  onNotice?: (message: string) => void;
  onFailure?: (message: string) => void;
};

type LiveKitStatus = 'idle' | 'connecting' | 'connected' | 'failed';

type ParticipantMetadata = {
  mboteRoomUserId?: number | string;
  displayName?: string;
  avatar?: string;
};

const parseMetadata = (value?: string): ParticipantMetadata => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as ParticipantMetadata : {};
  } catch {
    return {};
  }
};

const userIdFromIdentity = (identity: string) => {
  const match = identity.match(/^mboteroom-user-(\d+)$/);
  return match?.[1] || identity;
};

export function useMeetingLiveKit({
  meetingId,
  breakoutRoomId = null,
  localStream,
  media,
  enabled = false,
  sessionKey = 0,
  onNotice,
  onFailure,
}: UseMeetingLiveKitOptions) {
  const roomRef = useRef<LiveKitRoomLike | null>(null);
  const sdkRef = useRef<LiveKitSdk | null>(null);
  const publishedTracksRef = useRef<Map<MediaStreamTrack, LiveKitTrackPublicationLike>>(new Map());
  const publishGenerationRef = useRef(0);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [status, setStatus] = useState<LiveKitStatus>('idle');
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteMeetingParticipant[]>([]);
  const [activeSpeakerSocketId, setActiveSpeakerSocketId] = useState<string | null>(null);
  const [networkQuality, setNetworkQuality] = useState<MeetingNetworkQuality>({
    level: 'offline',
    rttMs: null,
    packetLossPct: null,
    connectedPeers: 0,
    totalPeers: 0,
  });

  const rebuildRemoteParticipants = useCallback(() => {
    const room = roomRef.current;
    const sdk = sdkRef.current;
    if (!room || !sdk) {
      setRemoteParticipants([]);
      return;
    }

    const activeIdentities = new Set<string>();
    const participants = [...room.remoteParticipants.values()].map((participant) => {
      activeIdentities.add(participant.identity);
      const metadata = parseMetadata(participant.metadata);
      let stream = remoteStreamsRef.current.get(participant.identity);
      if (!stream) {
        stream = new MediaStream();
        remoteStreamsRef.current.set(participant.identity, stream);
      }

      const audioTracks: MediaStreamTrack[] = [];
      const cameraTracks: MediaStreamTrack[] = [];
      const screenTracks: MediaStreamTrack[] = [];
      let audio = false;
      let video = false;
      let screen = false;

      participant.trackPublications.forEach((publication) => {
        const track = publication.track;
        const mediaTrack = track?.mediaStreamTrack;
        if (!track || !mediaTrack || mediaTrack.readyState !== 'live' || publication.isSubscribed === false) return;

        const kind = String(track.kind || publication.kind || '');
        const source = String(publication.source || track.source || '');
        const muted = Boolean(publication.isMuted || track.isMuted);
        if (kind === sdk.Track.Kind.Audio || kind === 'audio') {
          audioTracks.push(mediaTrack);
          if (!muted) audio = true;
        }
        if (kind === sdk.Track.Kind.Video || kind === 'video') {
          if (source === sdk.Track.Source.ScreenShare) {
            screenTracks.push(mediaTrack);
            if (!muted) screen = true;
          } else {
            cameraTracks.push(mediaTrack);
            if (!muted) video = true;
          }
        }
      });

      const preferredVideoTracks = screen ? screenTracks : cameraTracks;
      const desiredTracks = [...audioTracks, ...preferredVideoTracks];
      const desiredIds = new Set(desiredTracks.map((track) => track.id));
      stream.getTracks().forEach((track) => {
        if (!desiredIds.has(track.id)) stream!.removeTrack(track);
      });
      desiredTracks.forEach((track) => {
        if (!stream!.getTracks().some((current) => current.id === track.id)) stream!.addTrack(track);
      });

      const userId = String(metadata.mboteRoomUserId || userIdFromIdentity(participant.identity));
      return {
        socketId: `livekit:${participant.identity}`,
        userId,
        name: participant.name || metadata.displayName || 'Participant',
        avatar: metadata.avatar || '',
        stream: stream.getTracks().length ? stream : null,
        media: { audio, video: screen ? false : video, screen },
      } satisfies RemoteMeetingParticipant;
    });

    for (const identity of [...remoteStreamsRef.current.keys()]) {
      if (!activeIdentities.has(identity)) remoteStreamsRef.current.delete(identity);
    }

    setRemoteParticipants(participants);
    setNetworkQuality((current) => ({
      ...current,
      level: 'good',
      connectedPeers: participants.length,
      totalPeers: participants.length,
    }));
  }, []);

  useEffect(() => {
    if (!enabled || !meetingId) {
      setStatus('idle');
      setRemoteParticipants([]);
      remoteStreamsRef.current.clear();
      setActiveSpeakerSocketId(null);
      setNetworkQuality({ level: 'offline', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
      return undefined;
    }

    let cancelled = false;
    let room: LiveKitRoomLike | null = null;
    const listeners: Array<{ event: string; listener: (...args: any[]) => void }> = [];

    const listen = (sdk: LiveKitSdk, key: string, listener: (...args: any[]) => void) => {
      const event = sdk.RoomEvent[key];
      if (!event || !room) return;
      room.on(event, listener);
      listeners.push({ event, listener });
    };

    const connect = async () => {
      setStatus('connecting');
      try {
        const session = await mediaTransportService.getMeetingSession(meetingId, breakoutRoomId);
        if (session.mode !== 'livekit') throw new Error('La connexion vidéo avancée n’est pas disponible pour cette réunion.');

        const sdk = await loadLiveKitClient();
        if (cancelled) return;
        sdkRef.current = sdk;

        room = new sdk.Room({
          adaptiveStream: true,
          dynacast: true,
          stopLocalTrackOnUnpublish: false,
        });
        roomRef.current = room;

        const refresh = () => rebuildRemoteParticipants();
        const handleSpeakers = (speakers: Array<{ identity?: string }>) => {
          const identity = speakers?.[0]?.identity;
          setActiveSpeakerSocketId(identity ? `livekit:${identity}` : null);
        };
        const handleDisconnected = () => {
          if (cancelled) return;
          setStatus('failed');
          setNetworkQuality({ level: 'offline', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
          onFailure?.('La connexion de la réunion a changé automatiquement pour rester active.');
        };
        const handleReconnecting = () => {
          if (!cancelled) {
            setNetworkQuality((current) => ({ ...current, level: 'poor' }));
            onNotice?.('Reconnexion au serveur média SFU…');
          }
        };
        const handleReconnected = () => {
          if (!cancelled) {
            setStatus('connected');
            setNetworkQuality((current) => ({ ...current, level: 'good' }));
            refresh();
          }
        };

        [
          'TrackSubscribed',
          'TrackUnsubscribed',
          'TrackPublished',
          'TrackUnpublished',
          'TrackMuted',
          'TrackUnmuted',
          'ParticipantConnected',
          'ParticipantDisconnected',
          'ParticipantMetadataChanged',
        ].forEach((key) => listen(sdk, key, refresh));
        listen(sdk, 'ActiveSpeakersChanged', handleSpeakers);
        listen(sdk, 'Disconnected', handleDisconnected);
        listen(sdk, 'Reconnecting', handleReconnecting);
        listen(sdk, 'Reconnected', handleReconnected);

        const connectDeadlineMs = 22_000;
        let deadlineTimer = 0;
        try {
          await Promise.race([
            room.connect(session.serverUrl, session.participantToken, {
              autoSubscribe: true,
              maxRetries: 1,
              websocketTimeout: 10_000,
              peerConnectionTimeout: 12_000,
            }),
            new Promise<void>((_resolve, reject) => {
              deadlineTimer = window.setTimeout(
                () => reject(new Error('Le serveur média met trop de temps à répondre.')),
                connectDeadlineMs,
              );
            }),
          ]);
        } finally {
          if (deadlineTimer) window.clearTimeout(deadlineTimer);
        }
        if (cancelled) {
          await room.disconnect(false).catch(() => undefined);
          return;
        }

        setStatus('connected');
        setNetworkQuality({
          level: 'good',
          rttMs: null,
          packetLossPct: null,
          connectedPeers: room.remoteParticipants.size,
          totalPeers: room.remoteParticipants.size,
        });
        refresh();
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : 'Connexion au serveur média impossible.';
        await room?.disconnect(false).catch(() => undefined);
        if (roomRef.current === room) roomRef.current = null;
        setStatus('failed');
        setNetworkQuality({ level: 'offline', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
        onFailure?.(message);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      publishGenerationRef.current += 1;
      publishedTracksRef.current.clear();
      remoteStreamsRef.current.clear();
      listeners.forEach(({ event, listener }) => room?.off(event, listener));
      const activeRoom = roomRef.current;
      if (activeRoom === room) roomRef.current = null;
      sdkRef.current = null;
      void room?.disconnect(false).catch(() => undefined);
      setRemoteParticipants([]);
      setActiveSpeakerSocketId(null);
    };
  }, [breakoutRoomId, enabled, meetingId, sessionKey, onFailure, onNotice, rebuildRemoteParticipants]);

  useEffect(() => {
    if (status !== 'connected') return;
    const room = roomRef.current;
    const sdk = sdkRef.current;
    if (!room || !sdk) return;

    const generation = ++publishGenerationRef.current;
    const sync = async () => {
      const desiredTracks = (localStream?.getTracks() || []).filter((track) => track.readyState === 'live');
      const desired = new Set(desiredTracks);

      for (const [track] of [...publishedTracksRef.current.entries()]) {
        if (desired.has(track)) continue;
        await room.localParticipant.unpublishTrack(track, false).catch(() => undefined);
        publishedTracksRef.current.delete(track);
      }

      for (const track of desiredTracks) {
        if (generation !== publishGenerationRef.current) return;
        let publication = publishedTracksRef.current.get(track);
        if (!publication) {
          const isAudio = track.kind === 'audio';
          const source = isAudio
            ? (media.screen && sdk.Track.Source.ScreenShareAudio ? sdk.Track.Source.ScreenShareAudio : sdk.Track.Source.Microphone)
            : (media.screen ? sdk.Track.Source.ScreenShare : sdk.Track.Source.Camera);
          publication = await room.localParticipant.publishTrack(track, {
            source,
            name: isAudio ? (media.screen ? 'screen-audio' : 'microphone') : (media.screen ? 'screen' : 'camera'),
            simulcast: !isAudio,
          });
          publishedTracksRef.current.set(track, publication);
        }

        const shouldBeEnabled = track.enabled && (
          track.kind === 'audio'
            ? media.audio
            : (media.screen || media.video)
        );
        if (shouldBeEnabled && publication.isMuted) await publication.unmute?.().catch(() => undefined);
        if (!shouldBeEnabled && !publication.isMuted) await publication.mute?.().catch(() => undefined);
      }
    };

    void sync().catch(() => {
      onNotice?.('Une piste locale n’a pas pu être publiée sur le SFU.');
    });
  }, [localStream, media.audio, media.screen, media.video, onNotice, status]);

  return {
    status,
    connected: status === 'connected',
    failed: status === 'failed',
    remoteParticipants,
    activeSpeakerSocketId,
    networkQuality,
  };
}
