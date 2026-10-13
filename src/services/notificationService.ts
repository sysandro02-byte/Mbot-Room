import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';
import { isNativeAndroidApp } from '../lib/nativePlatform';

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

type PushConfig={configured:boolean;publicKey:string};

type NativePushBridge = {
  isNativePushConfigured?: () => boolean;
  getNativePushToken?: () => string;
  isNotificationPermissionGranted?: () => boolean;
};
const nativeBridge = (): NativePushBridge | null => {
  if (!isNativeAndroidApp()) return null;
  return (window as Window & { MBoteRoomAndroid?: NativePushBridge }).MBoteRoomAndroid || null;
};
const nativeToken = () => {
  try { return String(nativeBridge()?.getNativePushToken?.() || ''); } catch { return ''; }
};
const waitNativeToken = async () => {
  for (let attempt=0; attempt<12; attempt+=1) {
    const token=nativeToken();
    if(token)return token;
    await new Promise((resolve)=>window.setTimeout(resolve,800));
  }
  throw new Error('Impossible de récupérer le jeton FCM. Vérifiez la connexion et les services Google Play.');
};
const nativeConfig = async () => readJson<{configured:boolean}>(
  await apiFetch(apiUrl('/api/push/native/config'),{headers:getAuthHeaders()})
);
const nativeState = async ():Promise<PushState> => {
  const bridge=nativeBridge();
  const platform:PushState['platform']='android';
  const supported=Boolean(bridge?.getNativePushToken && bridge?.isNativePushConfigured);
  const permission=bridge?.isNotificationPermissionGranted?.()===false?'denied':'granted';
  if(!supported)return {supported:false,configured:false,permission:'unsupported',subscribed:false,standalone:true,platform};
  const configured=Boolean(bridge?.isNativePushConfigured?.() && (await nativeConfig().catch(()=>({configured:false}))).configured);
  const token=nativeToken();
  const status=token&&configured ? await readJson<{subscribed:boolean}>(
    await apiFetch(apiUrl('/api/push/native/status'),{
      method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({token}),
    })
  ).catch(()=>({subscribed:false})) : {subscribed:false};
  return {supported:true,configured,permission,subscribed:status.subscribed,standalone:true,platform};
};
const changeNativeSubscription = async (enable:boolean):Promise<PushState> => {
  const bridge=nativeBridge();
  if(!bridge?.isNativePushConfigured?.())throw new Error('Firebase n’est pas configuré dans cet APK Android.');
  if(enable && bridge.isNotificationPermissionGranted?.()===false)
    throw new Error('Activez les notifications MBotéRoom dans les réglages Android.');
  if(enable && !(await nativeConfig()).configured)
    throw new Error('Le serveur MBotéRoom n’est pas encore configuré pour les notifications FCM.');
  const token=enable?await waitNativeToken():nativeToken();
  if(!token)throw new Error('Jeton Android indisponible.');
  await readJson(await apiFetch(apiUrl('/api/push/native/'+(enable?'subscribe':'unsubscribe')),{
    method:'POST',headers:{...getAuthHeaders(),'Content-Type':'application/json'},
    body:JSON.stringify({token}),
  }));
  return nativeState();
};

const readJson=async<T>(response:Response):Promise<T>=>{
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(typeof data?.error==='string'?data.error:'Une erreur est survenue.');
  return data as T;
};

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

const bytesToBase64Url=(value:ArrayBuffer|ArrayBufferView)=>{
  const bytes=value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};

const getPushRegistration=async()=>{
  if(!('serviceWorker'in navigator))return null;
  let registration=await navigator.serviceWorker.getRegistration('/');
  if(!registration){
    registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  }
  if(!registration.active){
    registration=await navigator.serviceWorker.ready;
  }
  return registration;
};

const currentSubscription=async()=>{
  if(!('serviceWorker'in navigator)||!('PushManager'in window))return null;
  const registration=await getPushRegistration();
  return registration?.pushManager.getSubscription()||null;
};

const subscriptionUsesKey=(subscription:PushSubscription,publicKey:string)=>{
  const key=subscription.options.applicationServerKey;
  if(!key)return false;
  try{return bytesToBase64Url(key)===publicKey.replace(/=+$/,'');}
  catch{return false;}
};

const syncSubscription=async(subscription:PushSubscription,platform:PushState['platform'])=>{
  return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/push/subscribe'),{
    method:'POST',
    headers:{...getAuthHeaders(),'Content-Type':'application/json'},
    body:JSON.stringify({...subscription.toJSON(),platform}),
  }));
};

const removeServerSubscription=async(endpoint:string)=>{
  await apiFetch(apiUrl('/api/push/subscribe'),{
    method:'DELETE',
    headers:{...getAuthHeaders(),'Content-Type':'application/json'},
    body:JSON.stringify({endpoint}),
  }).catch(()=>undefined);
};

export const notificationService={
  async list(timeoutMs=45_000){return readJson<RoomNotification[]>(await apiFetch(apiUrl('/api/notifications'),{headers:getAuthHeaders()},timeoutMs));},
  async markRead(id:string){return readJson<RoomNotification>(await apiFetch(apiUrl(`/api/notifications/${encodeURIComponent(id)}/read`),{method:'POST',headers:getAuthHeaders()}));},
  async markAllRead(){return readJson<{success:boolean}>(await apiFetch(apiUrl('/api/notifications/read-all'),{method:'POST',headers:getAuthHeaders()}));},

  async getPushState():Promise<PushState>{
    if(isNativeAndroidApp())return nativeState();
    const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
    const platform=detectPlatform();
    if(!supported)return {supported:false,configured:false,permission:'unsupported',subscribed:false,standalone:isStandalone(),platform};

    const config=await readJson<PushConfig>(await apiFetch(apiUrl('/api/push/config'),{headers:getAuthHeaders()}))
      .catch(()=>({configured:false,publicKey:''}));
    let subscription=await currentSubscription().catch(()=>null);

    if(subscription&&config.publicKey&&!subscriptionUsesKey(subscription,config.publicKey)){
      await removeServerSubscription(subscription.endpoint);
      await subscription.unsubscribe().catch(()=>false);
      subscription=null;
    }

    let serverSynced=false;
    if(subscription&&config.configured&&config.publicKey&&Notification.permission==='granted'){
      serverSynced=await syncSubscription(subscription,platform).then(()=>true).catch(()=>false);
    }

    return {
      supported:true,
      configured:Boolean(config.configured&&config.publicKey),
      permission:Notification.permission,
      subscribed:Boolean(subscription&&serverSynced),
      standalone:isStandalone(),
      platform,
    };
  },

  async enablePush(){
    if(isNativeAndroidApp())return changeNativeSubscription(true);
    if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error('Les notifications ne sont pas prises en charge sur cet appareil.');
    const platform=detectPlatform();
    if(platform==='ios'&&!isStandalone())throw new Error('Sur iPhone/iPad, installez d’abord MBotéRoom sur l’écran d’accueil pour activer les notifications.');

    const config=await readJson<PushConfig>(await apiFetch(apiUrl('/api/push/config'),{headers:getAuthHeaders()}));
    if(!config.configured||!config.publicKey)throw new Error('Les notifications ne sont pas encore disponibles.');

    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Autorisation de notification refusée. Vous pouvez la réactiver dans les réglages du navigateur ou du système.');

    const registration=await getPushRegistration();
    if(!registration)throw new Error('Le service de notifications n’est pas disponible.');

    let subscription=await registration.pushManager.getSubscription();
    if(subscription&&!subscriptionUsesKey(subscription,config.publicKey)){
      await removeServerSubscription(subscription.endpoint);
      await subscription.unsubscribe().catch(()=>false);
      subscription=null;
    }
    if(!subscription){
      subscription=await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:base64UrlToBytes(config.publicKey),
      });
    }

    await syncSubscription(subscription,platform);
    return this.getPushState();
  },

  async disablePush(){
    if(isNativeAndroidApp())return changeNativeSubscription(false);
    const subscription=await currentSubscription();
    if(subscription){
      await removeServerSubscription(subscription.endpoint);
      await subscription.unsubscribe().catch(()=>false);
    }else{
      await apiFetch(apiUrl('/api/push/subscribe'),{method:'DELETE',headers:getAuthHeaders()}).catch(()=>undefined);
    }
    return this.getPushState();
  },

  async sendPushTest(){
    return readJson<{success:boolean;delivery:{sent:number;failed:number;stale:number}}>(
      await apiFetch(apiUrl('/api/push/test'),{method:'POST',headers:getAuthHeaders()}),
    );
  },
};
