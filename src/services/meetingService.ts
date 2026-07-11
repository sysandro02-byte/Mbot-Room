import { apiUrl, getAuthHeaders } from '../lib/api';

export interface Meeting {
  id: number;
  title: string;
  description: string;
  host_id: number;
  co_host_id?: number;
  host_name: string;
  host_avatar: string;
  start_time: string;
  duration: number;
  meeting_link: string;
  is_active: boolean;
  settings?: MeetingSettings;
  participant_count?: number;
}

export interface MeetingSettings {
  callType?: 'video' | 'audio';
  coverImage?: string;
  timeZone?: string;
  participants?: string[];
  participantCapacity?: number;
  meetingAccessId?: string;
  waitingRoom?: boolean;
  participantAudio?: boolean;
  participantVideo?: boolean;
  screenShare?: boolean;
  password?: string;
  encryption?: boolean;
  joinBeforeHost?: boolean;
  chat?: boolean;
  reactions?: boolean;
  recording?: boolean;
  lunaSummary?: boolean;
  linkSharing?: boolean;
  externalAccess?: boolean;
  isPublic?: boolean;
  visibility?: string;
}

export interface ScheduleMeetingPayload {
  title: string;
  description?: string;
  coHostId?: number | null;
  startTime?: string;
  start_time?: string;
  duration?: number;
  settings?: MeetingSettings;
  participants?: string[];
}

export interface ActusEvent extends Meeting {
  participant_count: number;
  is_invited?: boolean;
  is_public?: boolean;
  my_lobby_status?: 'requested' | 'accepted' | 'rejected' | null;
  relevance_reason: 'created_by_me' | 'registered' | 'public' | 'friend_suggested' | 'profile_match' | '';
}

export const getMeetingAccessCode = (meeting: Pick<Meeting, 'meeting_link'>) =>
  String(meeting.meeting_link || '').slice(-6).toUpperCase();

export const getMeetingJoinUrl = (meeting: Pick<Meeting, 'meeting_link'>) =>
  `${window.location.origin}/join/${meeting.meeting_link}`;

export interface LobbyParticipant {
  meeting_id: number;
  user_id: number;
  status: 'requested' | 'accepted' | 'rejected';
  name: string;
  avatar: string;
}

export interface MeetingMediaRequest {
  id: string;
  meetingId: number;
  targetUserId: number;
  requestedBy: number;
  requestedByName?: string;
  kind: 'mic' | 'camera';
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  respondedAt?: string;
}

export interface MeetingParticipantSuggestion {
  id: string;
  name: string;
  username: string;
  avatar: string;
  email?: string;
}

export const meetingService = {
  async getMeetings(): Promise<Meeting[]> {
    const response = await fetch(apiUrl('/api/meetings'), { headers: getAuthHeaders() });
    return response.json();
  },

  async getActusEvents(): Promise<ActusEvent[]> {
    const response = await fetch(apiUrl('/api/actus/events'), { headers: getAuthHeaders() });
    if (!response.ok) return [];
    return response.json();
  },

  async getMeetingByLink(meetingLink: string): Promise<Meeting> {
    const response = await fetch(apiUrl(`/api/meetings/link/${encodeURIComponent(meetingLink)}`), { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error('Réunion introuvable');
    }
    return response.json();
  },

  async lookupMeetingAccess(value: string, password: string): Promise<Meeting> {
    const response = await fetch(apiUrl('/api/meetings/join-lookup'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ value, password }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'ID ou mot de passe de réunion incorrect');
    }
    return response.json();
  },

  async scheduleMeeting(data: ScheduleMeetingPayload): Promise<Meeting> {
    const response = await fetch(apiUrl('/api/meetings'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Création de réunion impossible');
    }
    return response.json();
  },

  async updateMeeting(meetingId: number, data: ScheduleMeetingPayload): Promise<Meeting> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}`), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Modification de réunion impossible');
    }
    return response.json();
  },

  async searchParticipantSuggestions(query: string): Promise<MeetingParticipantSuggestion[]> {
    const response = await fetch(apiUrl(`/api/meetings/participant-suggestions?query=${encodeURIComponent(query)}`), {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data.map((item: any) => ({
      id: String(item.id),
      name: item.name || 'Utilisateur',
      username: item.username || '',
      avatar: item.avatar || '',
      email: item.email || '',
    })) : [];
  },

  async getLobby(meetingId: number): Promise<LobbyParticipant[]> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/lobby`), { headers: getAuthHeaders() });
    if (!response.ok) return [];
    const data = await response.json().catch(() => []);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.lobby)) return data.lobby;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.rows)) return data.rows;
    return [];
  },

  async requestJoin(meetingId: number, userId?: number, password?: string): Promise<{ success: boolean; status?: 'accepted' | 'requested' }> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/join-request`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId, password }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Demande d’accès impossible');
    }
    return response.json();
  },

  async startMeetingAndNotify(meetingId: number): Promise<{ success: boolean; notifiedCount: number; meeting?: Meeting }> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/start-notify`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Démarrage de réunion impossible');
    }
    return response.json();
  },

  async deleteMeeting(meetingId: number): Promise<void> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}`), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Suppression de réunion impossible');
    }
  },

  async respondToLobby(meetingId: number, userId: number, status: 'accepted' | 'rejected'): Promise<void> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/lobby/respond`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ userId, status }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Réponse lobby impossible');
    }
  },

  async requestMediaControl(meetingId: number, targetUserId: number, kind: 'mic' | 'camera'): Promise<MeetingMediaRequest> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/media-requests`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ targetUserId, kind }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Demande micro/camera impossible');
    }
    return response.json();
  },

  async getMediaRequests(meetingId: number): Promise<MeetingMediaRequest[]> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/media-requests`), {
      headers: getAuthHeaders(),
    });
    if (!response.ok) return [];
    return response.json();
  },

  async respondToMediaRequest(meetingId: number, requestId: string, status: 'accepted' | 'rejected'): Promise<MeetingMediaRequest | null> {
    const response = await fetch(apiUrl(`/api/meetings/${meetingId}/media-requests/${encodeURIComponent(requestId)}/respond`), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Réponse à la demande impossible');
    }
    return response.json();
  }
};
