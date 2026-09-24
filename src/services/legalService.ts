import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

export type LegalDocument = {
  key: string;
  title: string;
  body: string;
  version: string;
  updatedAt: string;
};

export type UserReport = {
  id: string;
  type: 'bug'|'meeting';
  title: string;
  description: string;
  meetingId?: number|null;
  status: string;
  createdAt: string;
};

const readJson=async<T>(response:Response):Promise<T>=>{
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Une erreur est survenue.');
  return data as T;
};

export const legalService={
  async getTerms(){
    return readJson<LegalDocument>(await apiFetch(apiUrl('/api/public/legal/terms'),{cache:'no-store'}));
  },
  async sendReport(payload:{type:'bug'|'meeting';title:string;description:string;meetingId?:number|null;pageUrl?:string}){
    return readJson<UserReport>(await apiFetch(apiUrl('/api/reports'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    }));
  },
};
