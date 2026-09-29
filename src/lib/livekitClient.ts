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

const LIVEKIT_UMD_URLS = [
  'https://cdn.jsdelivr.net/npm/livekit-client@2.22.3/dist/livekit-client.umd.min.js',
  'https://unpkg.com/livekit-client@2.22.3/dist/livekit-client.umd.min.js',
] as const;
const LIVEKIT_SCRIPT_ID = 'mboteroom-livekit-client';

let sdkPromise: Promise<LiveKitSdk> | null = null;

const loadLiveKitScript = (url: string, sourceIndex: number): Promise<LiveKitSdk> => new Promise((resolve, reject) => {
  const previous = document.getElementById(LIVEKIT_SCRIPT_ID);
  previous?.remove();

  const script = document.createElement('script');
  script.id = LIVEKIT_SCRIPT_ID;
  script.src = url;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.referrerPolicy = 'no-referrer';
  script.dataset.version = '2.22.3';
  script.dataset.sourceIndex = String(sourceIndex);

  let settled = false;
  const cleanup = () => {
    window.clearTimeout(timer);
    script.removeEventListener('load', handleLoad);
    script.removeEventListener('error', handleError);
  };
  const succeed = () => {
    if (settled) return;
    if (!window.LivekitClient) {
      fail(new Error('Le SDK LiveKit a été chargé sans exposer son client.'));
      return;
    }
    settled = true;
    cleanup();
    resolve(window.LivekitClient);
  };
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    script.remove();
    reject(error);
  };
  const handleLoad = () => succeed();
  const handleError = () => fail(new Error('Le SDK LiveKit n’a pas pu être chargé depuis ce serveur.'));
  const timer = window.setTimeout(
    () => fail(new Error('Le chargement du SDK LiveKit a dépassé le délai prévu.')),
    10_000,
  );

  script.addEventListener('load', handleLoad, { once: true });
  script.addEventListener('error', handleError, { once: true });
  document.head.appendChild(script);
});

export const loadLiveKitClient = (): Promise<LiveKitSdk> => {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    let lastError: Error | null = null;
    for (let index = 0; index < LIVEKIT_UMD_URLS.length; index += 1) {
      try {
        return await loadLiveKitScript(LIVEKIT_UMD_URLS[index], index);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Chargement LiveKit impossible.');
      }
    }
    throw lastError || new Error('La connexion vidéo avancée est momentanément indisponible.');
  })().catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
};
