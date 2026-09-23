import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';
import { publishPreferences, readCachedPreferences } from '../lib/userPreferences';
import { queueOfflineMutation } from '../lib/offline';
import type { RoomUser } from './authService';

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Une erreur est survenue.');
  return data as T;
};

const safeOfflineMutation = async <T>(
  url: string,
  method: 'POST'|'PUT'|'DELETE',
  payload: unknown,
  optimistic: () => T,
): Promise<T> => {
  const body = method === 'DELETE' && payload == null ? '' : JSON.stringify(payload ?? {});
  let response: Response;
  try {
    response = await apiFetch(url, {
      method,
      headers: getAuthHeaders(),
      body: method === 'DELETE' && !body ? undefined : body,
    });
  } catch {
    queueOfflineMutation(url, method, body);
    window.dispatchEvent(new CustomEvent('mbote-room-offline-saved', { detail: { url, method } }));
    return optimistic();
  }
  return readJson<T>(response);
};

const localStoredUser = (): RoomUser => {
  try {
    const raw = localStorage.getItem('user') || sessionStorage.getItem('user') || '{}';
    return JSON.parse(raw) as RoomUser;
  } catch {
    return {} as RoomUser;
  }
};

export type CalendarEvent = {
  id:string; user_id:number; meeting_id?:number|null; title:string; description:string;
  starts_at:string; ends_at:string; created_at:string; updated_at:string;
  google_event_id?:string|null; source?:string;
};
export type Contact = { id:number; name:string; username:string; email:string; avatar:string; is_guest:boolean };
export type Recording = { id:string; meeting_id:number; title:string; start_time:string; storage_url:string; mime_type:string; size_bytes:number; duration_seconds:number; created_at:string };
export type WhiteboardStroke = { id:string; color:string; width:number; points:Array<{x:number;y:number}> };
export type Whiteboard = { id:string; owner_id:number; meeting_id?:number|null; title:string; document:{strokes:WhiteboardStroke[]}; created_at:string; updated_at:string };
export type ConnectedSession = { id:string; current:boolean; createdAt:string; expiresAt:string; lastActivity:string; label:string };

export type Preferences = {
  language?: string;
  theme?: string;
  notifications?: boolean;
  audio?: boolean;
  video?: boolean;
  defaultMic?: boolean;
  defaultCamera?: boolean;
  background?: string;
  timezone?: string;
  accessibility?: Record<string, unknown>;
  textSize?: 'small' | 'normal' | 'large';
  notificationSounds?: boolean;
  vibration?: boolean;
  lockScreenPreview?: boolean;
  autoArchiveDays?: number;
  mediaDownload?: 'wifi' | 'always' | 'never';
  chatBackground?: 'default' | 'soft' | 'dark';
  noiseReduction?: boolean;
  hdVideo?: boolean;
  lunaAutoSummary?: boolean;
  lunaRealtimeTranslation?: boolean;
  lunaActionSuggestions?: boolean;
  dataSaver?: boolean;
  waitingRoomDefault?: boolean;
  meetingLockDefault?: boolean;
  participantAudioAllowed?: boolean;
  participantVideoAllowed?: boolean;
  screenShareAllowed?: boolean;
};

export const appDataService = {
  async getCalendar() {
    return readJson<CalendarEvent[]>(await apiFetch(apiUrl('/api/calendar/events'), { headers:getAuthHeaders() }));
  },
  async createCalendarEvent(payload:{title:string;description?:string;startsAt:string;endsAt:string;meetingId?:number}) {
    const url=apiUrl('/api/calendar/events');
    return safeOfflineMutation<CalendarEvent>(url,'POST',payload,()=>({
      id:`offline-${crypto.randomUUID()}`,user_id:Number(localStoredUser().id||0),meeting_id:payload.meetingId||null,
      title:payload.title,description:payload.description||'',starts_at:payload.startsAt,ends_at:payload.endsAt,
      created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }));
  },
  async deleteCalendarEvent(id:string) {
    const url=apiUrl(`/api/calendar/events/${encodeURIComponent(id)}`);
    try{
      const response=await apiFetch(url,{method:'DELETE',headers:getAuthHeaders()});
      if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');
    }catch(error){
      if(error instanceof Error && !/Impossible de joindre|met trop de temps/i.test(error.message)) throw error;
      queueOfflineMutation(url,'DELETE','');
      window.dispatchEvent(new CustomEvent('mbote-room-offline-saved',{detail:{url,method:'DELETE'}}));
    }
  },
  async getContacts() {
    return readJson<Contact[]>(await apiFetch(apiUrl('/api/contacts'),{headers:getAuthHeaders()}));
  },
  async getRecordings() {
    return readJson<Recording[]>(await apiFetch(apiUrl('/api/recordings'),{headers:getAuthHeaders()}));
  },
  async getPreferences() {
    try {
      const preferences = await readJson<Preferences>(await apiFetch(apiUrl('/api/preferences'),{headers:getAuthHeaders()}));
      publishPreferences(preferences);
      return preferences;
    } catch (error) {
      const cached = readCachedPreferences();
      if (Object.keys(cached).length) return cached;
      throw error;
    }
  },
  async updatePreferences(payload:Preferences) {
    const saved = await safeOfflineMutation<Preferences>(apiUrl('/api/preferences'),'PUT',payload,()=>payload);
    publishPreferences(saved);
    return saved;
  },
  async getConnectedSessions() {
    return readJson<ConnectedSession[]>(await apiFetch(apiUrl('/api/security/sessions'),{headers:getAuthHeaders()}));
  },
  async revokeConnectedSession(sessionId:string) {
    const response=await apiFetch(apiUrl(`/api/security/sessions/${encodeURIComponent(sessionId)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'Impossible de fermer cette session.');}
  },
  async revokeOtherSessions() {
    return readJson<{success:boolean;revoked:number}>(await apiFetch(apiUrl('/api/security/sessions/revoke-others'),{method:'POST',headers:getAuthHeaders()}));
  },
  async getProfile() {
    return readJson<{user:RoomUser}>(await apiFetch(apiUrl('/api/profile'),{headers:getAuthHeaders()}));
  },
  async updateProfile(payload:Partial<Pick<RoomUser,'name'|'username'|'avatar'|'phoneNumber'|'organization'|'jobTitle'>>) {
    return safeOfflineMutation<{user:RoomUser}>(apiUrl('/api/profile'),'PUT',payload,()=>({user:{...localStoredUser(),...payload}}));
  },
  async getWhiteboards() {
    return readJson<Whiteboard[]>(await apiFetch(apiUrl('/api/whiteboards'),{headers:getAuthHeaders()}));
  },
  async createWhiteboard(payload:{title:string;document:{strokes:WhiteboardStroke[]};meetingId?:number}) {
    return safeOfflineMutation<Whiteboard>(apiUrl('/api/whiteboards'),'POST',payload,()=>({
      id:`offline-${crypto.randomUUID()}`,owner_id:Number(localStoredUser().id||0),meeting_id:payload.meetingId||null,
      title:payload.title,document:payload.document,created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }));
  },
  async updateWhiteboard(id:string,payload:{title:string;document:{strokes:WhiteboardStroke[]}}) {
    return safeOfflineMutation<Whiteboard>(apiUrl(`/api/whiteboards/${encodeURIComponent(id)}`),'PUT',payload,()=>({
      id,owner_id:Number(localStoredUser().id||0),title:payload.title,document:payload.document,
      created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }));
  },
  async deleteWhiteboard(id:string) {
    const url=apiUrl(`/api/whiteboards/${encodeURIComponent(id)}`);
    try{
      const response=await apiFetch(url,{method:'DELETE',headers:getAuthHeaders()});
      if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');
    }catch(error){
      if(error instanceof Error && !/Impossible de joindre|met trop de temps/i.test(error.message)) throw error;
      queueOfflineMutation(url,'DELETE','');
      window.dispatchEvent(new CustomEvent('mbote-room-offline-saved',{detail:{url,method:'DELETE'}}));
    }
  },
};
