import { apiUrl, getAuthHeaders } from '../lib/api';

export type MediaTransportStatus = {
  configuredMode: 'auto' | 'mesh' | 'livekit';
  preferredMode: 'mesh' | 'livekit';
  browserTransport: 'mesh' | 'livekit';
  livekitReady: boolean;
  turnConfigured: boolean;
  serverRecordingReady: boolean;
};

export type MediaSession =
  | { mode: 'mesh'; reason?: string }
  | {
      mode: 'livekit';
      serverUrl: string;
      participantToken: string;
      roomName: string;
      identity: string;
      expiresAt: string;
    };

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as { error?: unknown }).error || 'Service média indisponible.'));
  }
  return data as T;
};

export const mediaTransportService = {
  async getStatus(): Promise<MediaTransportStatus> {
    const response = await fetch(apiUrl('/api/media/status'), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    return readJson<MediaTransportStatus>(response);
  },

  async getMeetingSession(meetingId: number, breakoutRoomId?: string | null): Promise<MediaSession> {
    const query = breakoutRoomId ? `?breakoutRoomId=${encodeURIComponent(breakoutRoomId)}` : '';
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/media-session${query}`), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    return readJson<MediaSession>(response);
  },
};
