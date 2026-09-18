import { apiUrl, getAuthHeaders } from '../lib/api';

export type MeetingCaption = {
  id: string;
  meetingId: number;
  userId: number;
  speaker: string;
  text: string;
  breakoutRoomId?: string | null;
  provider?: string;
  language?: string;
  createdAt: string;
};

export type TranscriptionStatus = {
  configured: boolean;
  model: string;
  chunkSeconds: number;
};

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as { error?: unknown }).error || ('Erreur transcription (' + response.status + ')')));
  }
  return data as T;
};

export const transcriptionService = {
  async getStatus(): Promise<TranscriptionStatus> {
    const response = await fetch(apiUrl('/api/transcription/status'), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    return readJson<TranscriptionStatus>(response);
  },

  async getCaptions(meetingId: number): Promise<MeetingCaption[]> {
    const response = await fetch(apiUrl('/api/meetings/' + meetingId + '/captions'), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    return readJson<MeetingCaption[]>(response);
  },

  async transcribeAudio(
    meetingId: number,
    blob: Blob,
    options?: { language?: string; breakoutRoomId?: string | null },
  ): Promise<MeetingCaption | null> {
    const query = new URLSearchParams();
    if (options?.language) query.set('language', options.language);
    if (options?.breakoutRoomId) query.set('breakoutRoomId', options.breakoutRoomId);
    const suffix = query.size ? '?' + query.toString() : '';
    const response = await fetch(apiUrl('/api/meetings/' + meetingId + '/transcription/chunk' + suffix), {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': blob.type || 'audio/webm',
      },
      body: blob,
    });
    if (response.status === 204) return null;
    return readJson<MeetingCaption>(response);
  },

  async publishBrowserCaption(
    meetingId: number,
    text: string,
    options?: { language?: string; breakoutRoomId?: string | null },
  ): Promise<MeetingCaption> {
    const response = await fetch(apiUrl('/api/meetings/' + meetingId + '/captions/text'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        text,
        language: options?.language || '',
        breakoutRoomId: options?.breakoutRoomId || undefined,
      }),
    });
    return readJson<MeetingCaption>(response);
  },
};
