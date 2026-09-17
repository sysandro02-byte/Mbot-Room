import { apiUrl, getAuthHeaders } from '../lib/api';

export type RoomNotification={
  id:string;user_id:number;type:string;title:string;body:string;data:Record<string,unknown>;createdAt:string;readAt:string|null;
};

const readJson=async<T>(response:Response):Promise<T>=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:`Erreur API (${response.status})`);return data as T;};

export const notificationService={
  async list(){return readJson<RoomNotification[]>(await fetch(apiUrl('/api/notifications'),{headers:getAuthHeaders()}));},
  async markRead(id:string){return readJson<RoomNotification>(await fetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}/read`),{method:'POST',headers:getAuthHeaders()}));},
  async markAllRead(){return readJson<{success:boolean}>(await fetch(apiUrl('/api/notifications/read-all'),{method:'POST',headers:getAuthHeaders()}));},
};
