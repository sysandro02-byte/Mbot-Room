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
  onNotice,
  onFailure,
}: UseMeetingLiveKitOptions) {
  const roomRef = useRef<LiveKitRoomLike | null>(null);
  const sdkRef = useRef<LiveKitSdk | null>(null);
  const publishedTracksRef = useRef<Map<MediaStreamTrack, LiveKitTrackPublicationLike>>(new Map());
  const publishGenerationRef = useRef(0);
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

    const participants = [...room.remoteParticipants.values()].map((participant) => {
      const metadata = parseMetadata(participant.metadata);
      const stream = new MediaStream();
      let audio = false;
      let video = false;
      let screen = false;

      participant.trackPublications.forEach((publication) => {
        const track = publication.track;
        const mediaTrack = track?.mediaStreamTrack;
        if (!track || !mediaTrack || mediaTrack.readyState !== 'live' || publication.isSubscribed === false) return;
        if (!stream.getTracks().some((current) => current.id === mediaTrack.id)) stream.addTrack(mediaTrack);

        const kind = String(track.kind || publication.kind || '');
        const source = String(publication.source || track.source || '');
        const muted = Boolean(publication.isMuted || track.isMuted);
        if (kind === sdk.Track.Kind.Audio || kind === 'audio') {
          if (!muted) audio = true;
        }
        if (kind === sdk.Track.Kind.Video || kind === 'video') {
          if (source === sdk.Track.Source.ScreenShare) screen = !muted;
          else video = !muted;
        }
      });

      const userId = String(metadata.mboteRoomUserId || userIdFromIdentity(participant.identity));
      return {
        socketId: `livekit:${participant.identity}`,
        userId,
        name: participant.name || metadata.displayName || 'Participant',
        avatar: metadata.avatar || '',
        stream: stream.getTracks().length ? stream : null,
        media: { audio, video, screen },
      } satisfies RemoteMeetingParticipant;
    });

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
        if (session.mode !== 'livekit') throw new Error('Le serveur SFU n’est pas configuré pour cette réunion.');

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
          onFailure?.('Connexion SFU interrompue. Retour automatique au mode WebRTC direct.');
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

        await room.connect(session.serverUrl, session.participantToken, {
          autoSubscribe: true,
          maxRetries: 3,
          websocketTimeout: 12_000,
          peerConnectionTimeout: 15_000,
        });
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
        const message = cause instanceof Error ? cause.message : 'Connexion SFU impossible.';
        setStatus('failed');
        setNetworkQuality({ level: 'offline', rttMs: null, packetLossPct: null, connectedPeers: 0, totalPeers: 0 });
        onFailure?.(`${message} Retour au mode WebRTC direct.`);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      publishGenerationRef.current += 1;
      publishedTracksRef.current.clear();
      listeners.forEach(({ event, listener }) => room?.off(event, listener));
      const activeRoom = roomRef.current;
      if (activeRoom === room) roomRef.current = null;
      sdkRef.current = null;
      void room?.disconnect(false).catch(() => undefined);
      setRemoteParticipants([]);
      setActiveSpeakerSocketId(null);
    };
  }, [breakoutRoomId, enabled, meetingId, onFailure, onNotice, rebuildRemoteParticipants]);

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
