import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

const readJson=async<T>(response:Response):Promise<T>=>{
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof payload?.error==='string'?payload.error:'Une erreur est survenue.');
  return payload as T;
};

export type DirectoryContact={
  id:number;
  name:string;
  username:string;
  email:string;
  avatar:string;
  organization:string;
  jobTitle:string;
  city:string;
  online:boolean;
  favorite:boolean;
  saved:boolean;
  sharedGroup:boolean;
};

export type ConversationFile={
  id:string;
  name:string;
  mimeType:string;
  sizeBytes:number;
  createdAt:string;
};

export type ConversationParticipant={
  id:number;
  name:string;
  username:string;
  email:string;
  avatar:string;
  organization:string;
  jobTitle:string;
  city:string;
  online:boolean;
};

export type ConversationMessage={
  id:string;
  conversationId:string;
  userId:number;
  sender:string;
  senderAvatar:string;
  text:string;
  createdAt:string;
  file:ConversationFile|null;
};

export type Conversation={
  id:string;
  kind:'direct'|'work_group';
  title:string;
  avatar:string;
  workGroupId:string|null;
  pinned:boolean;
  archived:boolean;
  notificationsEnabled:boolean;
  unreadCount:number;
  lastMessage:ConversationMessage|null;
  participants:ConversationParticipant[];
  files:ConversationFile[];
  createdAt:string;
  updatedAt:string;
};

export const conversationService={
  async getContacts(){
    return readJson<DirectoryContact[]>(await apiFetch(apiUrl('/api/contacts'),{headers:getAuthHeaders(),cache:'no-store'}));
  },

  async searchAccounts(query:string){
    const q=query.trim();
    if(q.length<2)return [] as DirectoryContact[];
    return readJson<DirectoryContact[]>(await apiFetch(apiUrl('/api/contacts/search?q='+encodeURIComponent(q)),{headers:getAuthHeaders(),cache:'no-store'}));
  },

  async saveContact(contactUserId:number){
    return readJson<{success:boolean;contactUserId:number}>(await apiFetch(apiUrl('/api/contacts/'+contactUserId),{
      method:'POST',headers:getAuthHeaders(),body:'{}',
    }));
  },

  async setFavorite(contactUserId:number,favorite:boolean){
    return readJson<{success:boolean;favorite:boolean}>(await apiFetch(apiUrl('/api/contacts/'+contactUserId),{
      method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify({favorite}),
    }));
  },

  async removeContact(contactUserId:number){
    const response=await apiFetch(apiUrl('/api/contacts/'+contactUserId),{method:'DELETE',headers:getAuthHeaders()});
    if(!response.ok){
      const payload=await response.json().catch(()=>({}));
      throw new Error(payload?.error||'Suppression impossible.');
    }
  },

  async getConversations(){
    return readJson<Conversation[]>(await apiFetch(apiUrl('/api/conversations'),{headers:getAuthHeaders(),cache:'no-store'}));
  },

  async createDirect(contactUserId:number){
    return readJson<Conversation>(await apiFetch(apiUrl('/api/conversations/direct'),{
      method:'POST',headers:getAuthHeaders(),body:JSON.stringify({contactUserId}),
    }));
  },

  async openWorkGroup(groupId:string){
    return readJson<Conversation>(await apiFetch(apiUrl('/api/conversations/work-group/'+encodeURIComponent(groupId)),{
      method:'POST',headers:getAuthHeaders(),body:'{}',
    }));
  },

  async getMessages(conversationId:string){
    return readJson<ConversationMessage[]>(await apiFetch(apiUrl('/api/conversations/'+encodeURIComponent(conversationId)+'/messages'),{
      headers:getAuthHeaders(),cache:'no-store',
    }));
  },

  async sendMessage(conversationId:string,payload:{text?:string;fileId?:string}){
    return readJson<ConversationMessage>(await apiFetch(apiUrl('/api/conversations/'+encodeURIComponent(conversationId)+'/messages'),{
      method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload),
    }));
  },

  async markRead(conversationId:string){
    return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/conversations/'+encodeURIComponent(conversationId)+'/read'),{
      method:'POST',headers:getAuthHeaders(),body:'{}',
    }));
  },

  async updateSettings(conversationId:string,payload:{pinned?:boolean;archived?:boolean;notificationsEnabled?:boolean}){
    return readJson<{success:boolean;pinned:boolean;archived:boolean;notificationsEnabled:boolean}>(
      await apiFetch(apiUrl('/api/conversations/'+encodeURIComponent(conversationId)+'/settings'),{
        method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(payload),
      }),
    );
  },
};
