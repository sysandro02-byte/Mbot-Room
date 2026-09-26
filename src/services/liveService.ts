import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

const readJson=async<T>(response:Response):Promise<T>=>{
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Une erreur est survenue.');
  return data as T;
};

export type LiveVisibility='public'|'private'|'followers';
export type LiveStatus='scheduled'|'live'|'ended'|'cancelled';
export type LiveCategory='business'|'music'|'games'|'events'|'wellness'|'education'|'tech'|'community'|'other';

export type LiveSession={
  id:string;
  meetingId:number;
  hostId:number;
  hostName:string;
  hostAvatar:string;
  title:string;
  description:string;
  category:LiveCategory|string;
  visibility:LiveVisibility|string;
  coverUrl:string;
  status:LiveStatus|string;
  scheduledFor:string|null;
  startedAt:string|null;
  endedAt:string|null;
  chatEnabled:boolean;
  cohostsEnabled:boolean;
  recordingEnabled:boolean;
  moderationEnabled:boolean;
  viewerCount:number;
  peakViewerCount:number;
  likeCount:number;
  commentCount:number;
  shareCount:number;
  giftCount:number;
  isLiked:boolean;
  isFollowing:boolean;
  isHost:boolean;
  canComment:boolean;
  canRequestParticipation:boolean;
  canShare:boolean;
  shareUrl:string;
};

export type LiveComment={id:string;userId:number;name:string;avatar:string;text:string;createdAt:string};
export type LiveJoinResult={success:boolean;meetingId:number;viewerCount:number;role:'host'|'cohost'|'viewer'};
export type LiveParticipationRequest={userId:number;name:string;avatar:string;status:'pending'|'accepted'|'rejected';createdAt:string};

export const liveMediaUrl=(value:string)=>{
  const raw=String(value||'').trim();
  return raw.startsWith('/api/')?apiUrl(raw):raw;
};

export const liveService={
  async getFeed(filters:{q?:string;category?:string;mode?:'live'|'trending'}={}){
    const params=new URLSearchParams();
    if(filters.q)params.set('q',filters.q);
    if(filters.category)params.set('category',filters.category);
    if(filters.mode)params.set('mode',filters.mode);
    return readJson<LiveSession[]>(await apiFetch(apiUrl('/api/live/feed'+(params.size?'?'+params.toString():'')),{headers:getAuthHeaders(),cache:'no-store'}));
  },
  async getLive(id:string,invite=''){
    const suffix=invite?'?invite='+encodeURIComponent(invite):'';
    return readJson<LiveSession>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}${suffix}`),{headers:getAuthHeaders(),cache:'no-store'}));
  },
  async uploadCover(file:File){
    const response=await apiFetch(apiUrl('/api/live/assets/cover'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':file.type},
      body:file,
    },60_000);
    const data=await readJson<{id:string;url:string;mimeType:string;sizeBytes:number}>(response);
    return {...data,url:liveMediaUrl(data.url)};
  },
  async createLive(payload:{
    title:string;description?:string;category:LiveCategory|string;visibility:LiveVisibility;
    coverUrl?:string;scheduledFor?:string;startNow?:boolean;chatEnabled?:boolean;cohostsEnabled?:boolean;
    recordingEnabled?:boolean;moderationEnabled?:boolean;
  }){
    return readJson<LiveSession>(await apiFetch(apiUrl('/api/live'),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify(payload)}));
  },
  async start(id:string){return readJson<LiveSession>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/start`),{method:'POST',headers:getAuthHeaders(),body:'{}'}));},
  async end(id:string){return readJson<{success:boolean;status:string}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/end`),{method:'POST',headers:getAuthHeaders(),body:'{}'}));},
  async join(id:string,inviteToken=''){return readJson<LiveJoinResult>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/join`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({inviteToken})}));},
  async leave(id:string){return readJson<{success:boolean;viewerCount:number}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/leave`),{method:'POST',headers:getAuthHeaders(),body:'{}'}));},
  async heartbeat(id:string){return readJson<{success:boolean;viewerCount:number}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/heartbeat`),{method:'POST',headers:getAuthHeaders(),body:'{}'}));},
  async getComments(id:string,inviteToken=''){const suffix=inviteToken?'?invite='+encodeURIComponent(inviteToken):'';return readJson<LiveComment[]>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/comments${suffix}`),{headers:getAuthHeaders(),cache:'no-store'}));},
  async comment(id:string,text:string,inviteToken=''){return readJson<LiveComment>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/comments`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({text,inviteToken})}));},
  async deleteComment(id:string,commentId:string){const response=await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`),{method:'DELETE',headers:getAuthHeaders()});if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Suppression impossible.');},
  async toggleLike(id:string,inviteToken=''){return readJson<{liked:boolean;likeCount:number}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/like`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({inviteToken})}));},
  async share(id:string,inviteToken=''){return readJson<{shareCount:number;url:string}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/share`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({inviteToken})}));},
  async toggleFollow(id:string){return readJson<{following:boolean}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/follow`),{method:'POST',headers:getAuthHeaders(),body:'{}'}));},
  async updateSettings(id:string,payload:{chatEnabled?:boolean;moderationEnabled?:boolean;cohostsEnabled?:boolean}){return readJson<LiveSession>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/settings`),{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify(payload)}));},
  async sendGift(id:string,giftType='star',inviteToken=''){
    return readJson<{id:string;liveId:string;userId:number;name:string;avatar:string;giftType:string;giftCount:number;createdAt:string}>(
      await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/gifts`),{
        method:'POST',headers:getAuthHeaders(),body:JSON.stringify({giftType,inviteToken}),
      })
    );
  },
  async invite(id:string,email:string){
    return readJson<{success:boolean;email:string;registered:boolean;url:string}>(
      await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/invitations`),{
        method:'POST',headers:getAuthHeaders(),body:JSON.stringify({email}),
      })
    );
  },
  async requestParticipation(id:string,inviteToken=''){return readJson<{success:boolean;status:string}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/participation-requests`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({inviteToken})}));},
  async react(id:string,reaction='👏',inviteToken=''){return readJson<{liveId:string;userId:number;name:string;reaction:string;createdAt:string}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/reactions`),{method:'POST',headers:getAuthHeaders(),body:JSON.stringify({reaction,inviteToken})}));},
  async getParticipationRequests(id:string){return readJson<LiveParticipationRequest[]>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/participation-requests`),{headers:getAuthHeaders(),cache:'no-store'}));},
  async respondParticipation(id:string,userId:number,status:'accepted'|'rejected'){return readJson<{success:boolean;status:string}>(await apiFetch(apiUrl(`/api/live/${encodeURIComponent(id)}/participation-requests/${userId}`),{method:'PATCH',headers:getAuthHeaders(),body:JSON.stringify({status})}));},
};

export const liveCategoryLabel=(value:string)=>({
  business:'Business',music:'Musique',games:'Jeux',events:'Événements',wellness:'Bien-être',
  education:'Éducation',tech:'Tech',community:'Communauté',other:'Autres',
}[value]||'Autres');
