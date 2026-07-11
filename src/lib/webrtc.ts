const splitUrls = (value: string | undefined) =>
  String(value || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);

export const getRtcConfiguration = (): RTCConfiguration => {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

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
