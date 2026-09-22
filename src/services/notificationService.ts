import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

export type RoomNotification={
  id:string;user_id:number;type:string;title:string;body:string;data:Record<string,unknown>;createdAt:string;readAt:string|null;
};

export type PushState={
  supported:boolean;
  configured:boolean;
  permission:NotificationPermission|'unsupported';
  subscribed:boolean;
  standalone:boolean;
  platform:'ios'|'android'|'desktop'|'web';
};

const readJson=async<T>(response:Response):Promise<T>=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Une erreur est survenue.');return data as T;};

const detectPlatform=():PushState['platform']=>{
  const ua=navigator.userAgent.toLowerCase();
  const isiOS=/iphone|ipad|ipod/.test(ua)||(/macintosh/.test(ua)&&navigator.maxTouchPoints>1);
  if(isiOS)return 'ios';
  if(/android/.test(ua))return 'android';
  if(/windows|macintosh|linux/.test(ua))return 'desktop';
  return 'web';
};

const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches
  || Boolean((navigator as Navigator & {standalone?:boolean}).standalone);

const base64UrlToBytes=(value:string)=>{
  const padding='='.repeat((4-(value.length%4))%4);
  const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=window.atob(base64);
  return Uint8Array.from(raw,(char)=>char.charCodeAt(0));
};

const currentSubscription=async()=>{
  if(!('serviceWorker'in navigator)||!('PushManager'in window))return null;
  const registration=await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const notificationService={
  async list(){return readJson<RoomNotification[]>(await apiFetch(apiUrl('/api/notifications'),{headers:getAuthHeaders()}));},
  async markRead(id:string){return readJson<RoomNotification>(await apiFetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}/read`),{method:'POST',headers:getAuthHeaders()}));},
  async markAllRead(){return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/notifications/read-all'),{method:'POST',headers:getAuthHeaders()}));},

  async getPushState():Promise<PushState>{
    const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
    if(!supported)return {supported:false,configured:false,permission:'unsupported',subscribed:false,standalone:isStandalone(),platform:detectPlatform()};
    const config=await readJson<{configured:boolean;publicKey:string}>(await apiFetch(apiUrl('/api/push/config'),{headers:getAuthHeaders()})).catch(()=>({configured:false,publicKey:''}));
    const subscription=await currentSubscription().catch(()=>null);
    return {supported:true,configured:Boolean(config.configured&&config.publicKey),permission:Notification.permission,subscribed:Boolean(subscription),standalone:isStandalone(),platform:detectPlatform()};
  },

  async enablePush(){
    if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('Les notifications push ne sont pas prises en charge sur cet appareil.');
    const platform=detectPlatform();
    if(platform==='ios'&&!isStandalone())throw new Error('Sur iPhone/iPad, installez d’abord MBotéRoom sur l’écran d’accueil pour activer les notifications push.');
    const config=await readJson<{configured:boolean;publicKey:string}>(await apiFetch(apiUrl('/api/push/config'),{headers:getAuthHeaders()}));
    if(!config.configured||!config.publicKey)throw new Error('Les notifications ne sont pas encore disponibles.');
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Autorisation de notification refusée. Vous pouvez la réactiver dans les réglages du navigateur ou du système.');
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:base64UrlToBytes(config.publicKey),
      });
    }
    await readJson(await apiFetch(apiUrl('/api/push/subscribe'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({...subscription.toJSON(),platform}),
    }));
    return this.getPushState();
  },

  async disablePush(){
    const subscription=await currentSubscription();
    if(subscription){
      await apiFetch(apiUrl('/api/push/subscribe'),{
        method:'DELETE',
        headers:{...getAuthHeaders(),'Content-Type':'application/json'},
        body:JSON.stringify({endpoint:subscription.endpoint}),
      }).catch(()=>undefined);
      await subscription.unsubscribe().catch(()=>false);
    }else{
      await apiFetch(apiUrl('/api/push/subscribe'),{method:'DELETE',headers:getAuthHeaders()}).catch(()=>undefined);
    }
    return this.getPushState();
  },

  async sendPushTest(){
    return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/push/test'),{method:'POST',headers:getAuthHeaders()}));
  },
};
