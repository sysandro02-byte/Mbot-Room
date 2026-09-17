import { apiUrl, getAuthHeaders } from '../lib/api';
import type { RoomUser } from './authService';

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Erreur API (${response.status})`);
  return data as T;
};

export type CalendarEvent = {
  id:string; user_id:number; meeting_id?:number|null; title:string; description:string;
  starts_at:string; ends_at:string; created_at:string; updated_at:string;
};
export type Contact = { id:number; name:string; username:string; email:string; avatar:string; is_guest:boolean };
export type Recording = { id:string; meeting_id:number; title:string; start_time:string; storage_url:string; mime_type:string; size_bytes:number; duration_seconds:number; created_at:string };
export type WhiteboardStroke = { id:string; color:string; width:number; points:Array<{x:number;y:number}> };
export type Whiteboard = { id:string; owner_id:number; meeting_id?:number|null; title:string; document:{strokes:WhiteboardStroke[]}; created_at:string; updated_at:string };
export type Preferences = {
  language?:string; theme?:string; notifications?:boolean; audio?:boolean; video?:boolean;
  defaultMic?:boolean; defaultCamera?:boolean; background?:string; timezone?:string; accessibility?:Record<string,unknown>;
};

export const appDataService = {
  async getCalendar() {
    return readJson<CalendarEvent[]>(await fetch(apiUrl('/api/calendar/events'), { headers:getAuthHeaders() }));
  },
  async createCalendarEvent(payload:{title:string;description?:string;startsAt:string;endsAt:string;meetingId?:number}) {
    return readJson<CalendarEvent>(await fetch(apiUrl('/api/calendar/events'), { method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload) }));
  },
  async deleteCalendarEvent(id:string) {
    const response=await fetch(apiUrl(`/api/calendar/events/${encodeURIComponent(id)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');
  },
  async getContacts() {
    return readJson<Contact[]>(await fetch(apiUrl('/api/contacts'),{headers:getAuthHeaders()}));
  },
  async getRecordings() {
    return readJson<Recording[]>(await fetch(apiUrl('/api/recordings'),{headers:getAuthHeaders()}));
  },
  async getPreferences() {
    return readJson<Preferences>(await fetch(apiUrl('/api/preferences'),{headers:getAuthHeaders()}));
  },
  async updatePreferences(payload:Preferences) {
    return readJson<Preferences>(await fetch(apiUrl('/api/preferences'),{method:'PUT',headers:getAuthHeaders(),body:JSON.stringify(payload)}));
  },
  async getProfile() {
    return readJson<{user:RoomUser}>(await fetch(apiUrl('/api/profile'),{headers:getAuthHeaders()}));
  },
  async updateProfile(payload:Partial<Pick<RoomUser,'name'|'username'|'avatar'|'phoneNumber'|'organization'|'jobTitle'>>) {
    return readJson<{user:RoomUser}>(await fetch(apiUrl('/api/profile'),{method:'PUT',headers:getAuthHeaders(),body:JSON.stringify(payload)}));
  },
  async getWhiteboards() {
    return readJson<Whiteboard[]>(await fetch(apiUrl('/api/whiteboards'),{headers:getAuthHeaders()}));
  },
  async createWhiteboard(payload:{title:string;document:{strokes:WhiteboardStroke[]};meetingId?:number}) {
    return readJson<Whiteboard>(await fetch(apiUrl('/api/whiteboards'),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}));
  },
  async updateWhiteboard(id:string,payload:{title:string;document:{strokes:WhiteboardStroke[]}}) {
    return readJson<Whiteboard>(await fetch(apiUrl(`/api/whiteboards/${encodeURIComponent(id)}`),{method:'PUT',headers:getAuthHeaders(),body:JSON.stringify(payload)}));
  },
  async deleteWhiteboard(id:string) {
    const response=await fetch(apiUrl(`/api/whiteboards/${encodeURIComponent(id)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');
  },
};
