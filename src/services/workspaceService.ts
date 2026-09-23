import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

const readJson=async<T>(response:Response):Promise<T>=>{
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload?.error==='string'?payload.error:'Une erreur est survenue.');
  return payload as T;
};

export type GoogleCalendarStatus={
  configured:boolean;
  connected:boolean;
  scope:string;
};

export type WorkspaceFile={
  id:string;
  ownerId:number;
  name:string;
  mimeType:string;
  sizeBytes:number;
  createdAt:string;
};

export type WorkGroupMember={
  email:string;
  userId:number|null;
  role:'owner'|'member';
  name:string;
  avatar:string;
};

export type WorkGroupCall={
  id:string;
  meetingId:number;
  callType:'audio'|'video';
  title:string;
  startTime:string;
  duration:number;
  status:'scheduled'|'live'|'ended'|'cancelled';
  meetingLink:string;
  isActive:boolean;
  createdAt:string;
};

export type WorkGroup={
  id:string;
  ownerId:number;
  name:string;
  description:string;
  isOwner:boolean;
  createdAt:string;
  updatedAt:string;
  members:WorkGroupMember[];
  calls:WorkGroupCall[];
  files:WorkspaceFile[];
};

export const workspaceService={
  async getGoogleCalendarStatus(){
    return readJson<GoogleCalendarStatus>(await apiFetch(apiUrl('/api/calendar/google/status'),{headers:getAuthHeaders()}));
  },

  async connectGoogleCalendar(returnTo='/app/calendar'){
    return readJson<{url:string}>(await apiFetch(apiUrl('/api/calendar/google/connect'),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify({returnTo}),
    }));
  },

  async syncGoogleCalendar(){
    return readJson<{success:boolean;imported:number;pushed:number;totalGoogle:number}>(await apiFetch(apiUrl('/api/calendar/google/sync'),{
      method:'POST',
      headers:getAuthHeaders(),
      body:'{}',
    },60_000));
  },

  async disconnectGoogleCalendar(){
    return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/calendar/google/connection'),{
      method:'DELETE',
      headers:getAuthHeaders(),
    }));
  },

  async getFiles(){
    return readJson<WorkspaceFile[]>(await apiFetch(apiUrl('/api/files'),{headers:getAuthHeaders()}));
  },

  async uploadFile(file:File,workGroupId?:string){
    const headers:Record<string,string>={...getAuthHeaders(),'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)};
    if(workGroupId)headers['X-Work-Group-Id']=workGroupId;
    return readJson<WorkspaceFile>(await apiFetch(apiUrl('/api/files/upload'),{
      method:'POST',
      headers,
      body:file,
    },90_000));
  },

  async openFile(fileId:string){
    const response=await apiFetch(apiUrl(`/api/files/${encodeURIComponent(fileId)}/content`),{headers:getAuthHeaders()},60_000);
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(payload?.error||'Fichier indisponible.');
    }
    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.target='_blank';
    link.rel='noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),60_000);
  },

  async deleteFile(fileId:string){
    const response=await apiFetch(apiUrl(`/api/files/${encodeURIComponent(fileId)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(payload?.error||'Suppression impossible.');
    }
  },

  async getWorkGroups(){
    return readJson<WorkGroup[]>(await apiFetch(apiUrl('/api/work-groups'),{headers:getAuthHeaders()}));
  },

  async getWorkGroup(groupId:string){
    return readJson<WorkGroup>(await apiFetch(apiUrl(`/api/work-groups/${encodeURIComponent(groupId)}`),{headers:getAuthHeaders()}));
  },

  async createWorkGroup(payload:{name:string;description?:string;emails:string[]}){
    return readJson<WorkGroup>(await apiFetch(apiUrl('/api/work-groups'),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify(payload),
    }));
  },

  async deleteWorkGroup(groupId:string){
    const response=await apiFetch(apiUrl(`/api/work-groups/${encodeURIComponent(groupId)}`),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(payload?.error||'Suppression du groupe impossible.');
    }
  },

  async attachGroupCall(groupId:string,payload:{meetingId:number;callType:'audio'|'video'}){
    return readJson<{success:boolean;id:string;meetingId:number;callType:'audio'|'video'}>(await apiFetch(apiUrl(`/api/work-groups/${encodeURIComponent(groupId)}/calls`),{
      method:'POST',
      headers:getAuthHeaders(),
      body:JSON.stringify(payload),
    }));
  },
};
