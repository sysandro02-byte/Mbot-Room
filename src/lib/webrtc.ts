import { apiUrl, getAuthHeaders } from './api';

const splitUrls = (value: string | undefined) =>
  String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

const fallbackRtcConfiguration = (): RTCConfiguration => {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // Compatibility fallback for local/dev deployments that still use static TURN vars.
  const turnUrls = splitUrls(import.meta.env.VITE_TURN_URLS);
  if (turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    });
  }

  return { iceServers, iceCandidatePoolSize: 4 };
};

let cachedConfig: RTCConfiguration | null = null;
let cachedUntil = 0;

export const getRtcConfiguration = async (): Promise<RTCConfiguration> => {
  if (cachedConfig && Date.now() < cachedUntil) return cachedConfig;

  try {
    const response = await fetch(apiUrl('/api/rtc/config'), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('RTC config unavailable');
    const data = await response.json();
    const config: RTCConfiguration = {
      iceServers: Array.isArray(data?.iceServers) ? data.iceServers : fallbackRtcConfiguration().iceServers,
      iceCandidatePoolSize: Number(data?.iceCandidatePoolSize || 6),
    };
    cachedConfig = config;
    const expiresAt = data?.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 10 * 60 * 1000;
    cachedUntil = Math.max(Date.now() + 60_000, expiresAt - 60_000);
    return config;
  } catch {
    const fallback = fallbackRtcConfiguration();
    cachedConfig = fallback;
    cachedUntil = Date.now() + 5 * 60 * 1000;
    return fallback;
  }
};
