import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Une erreur est survenue.');
  return data as T;
};

export type MeetingMessage = { id:string; meetingId:string; userId:number; sender:string; text:string; time:string };
export type MeetingParticipant = {
  userId:number; role:'host'|'cohost'|'participant'; status:'accepted'|'left'|'removed';
  mutedByHost:boolean; cameraDisabledByHost:boolean; joinedAt?:string|null; leftAt?:string|null;
  name:string; username:string; email:string; avatar:string; isGuest:boolean;
};
export type MeetingPoll = {
  id:string; meetingId:number; question:string; isOpen:boolean; createdBy:number; createdAt:string;
  options:Array<{id:string;label:string;votes:number}>;
};
export type RecordingMetadata = {
  id:string;
  meeting_id:number;
  storage_url:string;
  mime_type:string;
  size_bytes:number;
  duration_seconds:number;
  created_at:string;
  provider?:'manual'|'livekit'|'supabase';
  provider_recording_id?:string;
  status?:'starting'|'active'|'ending'|'complete'|'failed'|'aborted'|'limit_reached'|'ready'|'unknown';
  started_at?:string|null;
  ended_at?:string|null;
  metadata?:Record<string,unknown>;
};

export type BreakoutRoom = {
  id:string; meetingId:number; name:string; isOpen:boolean; createdAt?:string; updatedAt?:string;
  members:Array<{userId:number;name:string;avatar:string}>;
};

type RecordingUploadTicket = {
  bucket:string;
  path:string;
  token:string;
  tusEndpoint:string;
  expiresInSeconds:number;
};

const encodeTusMetadata = (value:string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const readTusOffset = async (uploadUrl:string) => {
  const response = await fetch(uploadUrl, { method:'HEAD', headers:{ 'Tus-Resumable':'1.0.0' } });
  if (!response.ok) throw new Error('Impossible de reprendre l’envoi de l’enregistrement.');
  return Math.max(0, Number(response.headers.get('Upload-Offset') || 0));
};

const uploadBlobToSupabaseTus = async (
  ticket:RecordingUploadTicket,
  blob:Blob,
  meetingId:number,
  onProgress?:(progress:number)=>void,
) => {
  const metadata = [
    `bucketName ${encodeTusMetadata(ticket.bucket)}`,
    `objectName ${encodeTusMetadata(ticket.path)}`,
    `contentType ${encodeTusMetadata(blob.type || 'video/webm')}`,
    `cacheControl ${encodeTusMetadata('3600')}`,
    `metadata ${encodeTusMetadata(JSON.stringify({ source:'mboteroom', meetingId }))}`,
  ].join(',');

  const created = await fetch(ticket.tusEndpoint, {
    method:'POST',
    headers:{
      'Tus-Resumable':'1.0.0',
      'Upload-Length':String(blob.size),
      'Upload-Metadata':metadata,
      'x-signature':ticket.token,
      'x-upsert':'false',
    },
  });
  if (!created.ok) {
    const message = await created.text().catch(()=>'');
    throw new Error(message || 'Supabase n’a pas pu préparer l’envoi de l’enregistrement.');
  }

  const location = created.headers.get('Location');
  if (!location) throw new Error('Supabase n’a pas retourné de destination d’envoi.');
  const uploadUrl = new URL(location, ticket.tusEndpoint).toString();
  const chunkSize = 6 * 1024 * 1024;
  let offset = Math.max(0, Number(created.headers.get('Upload-Offset') || 0));

  while (offset < blob.size) {
    const end = Math.min(blob.size, offset + chunkSize);
    const chunk = blob.slice(offset, end);
    let completed = false;
    let lastError:unknown = null;

    for (let attempt = 0; attempt < 4 && !completed; attempt += 1) {
      try {
        const response = await fetch(uploadUrl, {
          method:'PATCH',
          headers:{
            'Tus-Resumable':'1.0.0',
            'Upload-Offset':String(offset),
            'Content-Type':'application/offset+octet-stream',
          },
          body:chunk,
        });
        if (!response.ok) throw new Error(await response.text().catch(()=>''));
        offset = Math.max(end, Number(response.headers.get('Upload-Offset') || end));
        completed = true;
        onProgress?.(Math.min(100, Math.round(offset / blob.size * 100)));
      } catch (error) {
        lastError = error;
        if (attempt >= 3) break;
        await new Promise((resolve)=>window.setTimeout(resolve, 700 * (attempt + 1)));
        try {
          offset = await readTusOffset(uploadUrl);
          if (offset >= end) {
            completed = true;
            onProgress?.(Math.min(100, Math.round(offset / blob.size * 100)));
          }
        } catch {
          // Retry the same chunk if the offset cannot be read.
        }
      }
    }

    if (!completed) {
      throw lastError instanceof Error && lastError.message
        ? lastError
        : new Error('L’envoi de l’enregistrement vers Supabase a échoué.');
    }
  }
};

export const collaborationService = {
  async getMessages(meetingId:number) {
    return readJson<MeetingMessage[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/messages?limit=150`), { headers:getAuthHeaders() }));
  },
  async sendMessage(meetingId:number,text:string) {
    return readJson<MeetingMessage>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/messages`), { method:'POST',headers:getAuthHeaders(),body:JSON.stringify({text}) }));
  },
  async deleteMessage(meetingId:number,messageId:string) {
    const response=await apiFetch(apiUrl(`/api/meetings/${meetingId}/messages/${encodeURIComponent(messageId)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');
  },
  async getParticipants(meetingId:number) {
    return readJson<MeetingParticipant[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants`),{headers:getAuthHeaders()}));
  },
  async muteAllParticipants(meetingId:number) {
    return readJson<{success:boolean;muted:number;userIds:number[]}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants/mute-all`),{method:'POST',headers:getAuthHeaders()}));
  },
  async updateParticipant(meetingId:number,userId:number,patch:{role?:'cohost'|'participant';mutedByHost?:boolean;cameraDisabledByHost?:boolean}) {
    return readJson<any>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants/${userId}`),{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(patch)}));
  },
  async removeParticipant(meetingId:number,userId:number) {
    const response=await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants/${userId}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok) throw new Error((await response.json().catch(()=>({}))).error||'Retrait impossible.');
  },
  async banParticipant(meetingId:number,userId:number,reason='') {
    return readJson<{success:boolean}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants/${userId}/ban`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({reason})}));
  },
  async moveToLobby(meetingId:number,userId:number) {
    return readJson<{success:boolean}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/participants/${userId}/move-to-lobby`),{method:'POST',headers:getAuthHeaders()}));
  },
  async getBreakoutRooms(meetingId:number) {
    return readJson<BreakoutRoom[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/breakouts`),{headers:getAuthHeaders()}));
  },
  async createBreakoutRooms(meetingId:number,names:string[]) {
    return readJson<BreakoutRoom[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/breakouts`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({names})}));
  },
  async assignBreakoutParticipant(meetingId:number,breakoutId:string,userId:number) {
    return readJson<{success:boolean}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/breakouts/${encodeURIComponent(breakoutId)}/assign`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({userId})}));
  },
  async openBreakoutRooms(meetingId:number) {
    return readJson<{success:boolean;assignments:number}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/breakouts/open`),{method:'POST',headers:getAuthHeaders()}));
  },
  async closeBreakoutRooms(meetingId:number) {
    return readJson<{success:boolean}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/breakouts/close`),{method:'POST',headers:getAuthHeaders()}));
  },
  async getPolls(meetingId:number) {
    return readJson<MeetingPoll[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/polls`),{headers:getAuthHeaders()}));
  },
  async createPoll(meetingId:number,question:string,options:string[]) {
    return readJson<MeetingPoll>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/polls`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({question,options})}));
  },
  async vote(meetingId:number,pollId:string,optionId:string) {
    return readJson<MeetingPoll>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/polls/${pollId}/vote`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({optionId})}));
  },
  async closePoll(meetingId:number,pollId:string) {
    return readJson<MeetingPoll>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/polls/${pollId}/close`),{method:'POST',headers:getAuthHeaders()}));
  },
  async endMeeting(meetingId:number) {
    return readJson<{success:boolean}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/end`),{method:'POST',headers:getAuthHeaders()}));
  },
  async generateSummary(meetingId:number) {
    return readJson<{bullets:string[];decisions:string[];actions:string[];nextMeeting:string}>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/summary/generate`),{method:'POST',headers:getAuthHeaders()}));
  },
  async getRecordings(meetingId:number) {
    return readJson<RecordingMetadata[]>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings`),{headers:getAuthHeaders()}));
  },
  async startServerRecording(meetingId:number, options?:{breakoutRoomId?:string|null;layout?:'grid'|'speaker'|'single-speaker'}) {
    return readJson<RecordingMetadata>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings/start`),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({
        breakoutRoomId:options?.breakoutRoomId||undefined,
        layout:options?.layout||'grid',
      }),
    }));
  },
  async getServerRecordingStatus(meetingId:number, recordingId:string) {
    return readJson<RecordingMetadata>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings/${encodeURIComponent(recordingId)}/status`),{
      headers:getAuthHeaders(),
      cache:'no-store',
    }));
  },
  async stopServerRecording(meetingId:number, recordingId:string) {
    return readJson<RecordingMetadata>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings/${encodeURIComponent(recordingId)}/stop`),{
      method:'POST',
      headers:getAuthHeaders(),
    }));
  },
  async uploadLocalRecording(
    meetingId:number,
    blob:Blob,
    durationSeconds:number,
    onProgress?:(progress:number)=>void,
  ) {
    const ticket=await readJson<RecordingUploadTicket>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings/upload-ticket`),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({
        mimeType:(blob.type||'video/webm').split(';')[0],
        sizeBytes:blob.size,
      }),
    }));
    await uploadBlobToSupabaseTus(ticket,blob,meetingId,onProgress);
    return readJson<RecordingMetadata>(await apiFetch(apiUrl(`/api/meetings/${meetingId}/recordings`),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({
        storagePath:ticket.path,
        mimeType:(blob.type||'video/webm').split(';')[0],
        sizeBytes:blob.size,
        durationSeconds:Math.max(0,Math.round(durationSeconds)),
      }),
    }));
  },
};
