export type LiveKitTrackLike = {
  kind: string;
  source?: string;
  isMuted?: boolean;
  mediaStreamTrack: MediaStreamTrack;
};

export type LiveKitTrackPublicationLike = {
  kind?: string;
  source?: string;
  isMuted?: boolean;
  isSubscribed?: boolean;
  track?: LiveKitTrackLike;
  mute?: () => Promise<unknown>;
  unmute?: () => Promise<unknown>;
};

export type LiveKitParticipantLike = {
  identity: string;
  name?: string;
  metadata?: string;
  isSpeaking?: boolean;
  audioLevel?: number;
  trackPublications: Map<string, LiveKitTrackPublicationLike>;
};

export type LiveKitLocalParticipantLike = LiveKitParticipantLike & {
  publishTrack: (
    track: MediaStreamTrack,
    options?: { name?: string; source?: string; simulcast?: boolean },
  ) => Promise<LiveKitTrackPublicationLike>;
  unpublishTrack: (track: MediaStreamTrack, stopOnUnpublish?: boolean) => Promise<unknown>;
};

export type LiveKitRoomLike = {
  name?: string;
  localParticipant: LiveKitLocalParticipantLike;
  remoteParticipants: Map<string, LiveKitParticipantLike>;
  activeSpeakers?: LiveKitParticipantLike[];
  connect: (url: string, token: string, options?: Record<string, unknown>) => Promise<void>;
  disconnect: (stopTracks?: boolean) => Promise<void>;
  on: (event: string, listener: (...args: any[]) => void) => LiveKitRoomLike;
  off: (event: string, listener: (...args: any[]) => void) => LiveKitRoomLike;
};

export type LiveKitSdk = {
  Room: new (options?: Record<string, unknown>) => LiveKitRoomLike;
  RoomEvent: Record<string, string>;
  Track: {
    Kind: { Audio: string; Video: string };
    Source: {
      Camera: string;
      Microphone: string;
      ScreenShare: string;
      ScreenShareAudio?: string;
    };
  };
};

declare global {
  interface Window {
    LivekitClient?: LiveKitSdk;
  }
}

const LIVEKIT_UMD_URL = 'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.min.js';
const LIVEKIT_SCRIPT_ID = 'mboteroom-livekit-client';

let sdkPromise: Promise<LiveKitSdk> | null = null;

export const loadLiveKitClient = (): Promise<LiveKitSdk> => {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<LiveKitSdk>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      if (!window.LivekitClient) {
        settled = true;
        reject(new Error('Le SDK LiveKit n’a pas pu être chargé.'));
        return;
      }
      settled = true;
      resolve(window.LivekitClient);
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      sdkPromise = null;
      reject(new Error('Le transport SFU LiveKit est momentanément indisponible.'));
    };

    let script = document.getElementById(LIVEKIT_SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = LIVEKIT_SCRIPT_ID;
      script.src = LIVEKIT_UMD_URL;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      script.dataset.version = '2.22.3';
      document.head.appendChild(script);
    }

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });

    window.setTimeout(() => {
      if (window.LivekitClient) finish();
      else fail();
    }, 12_000);
  });

  return sdkPromise;
};
