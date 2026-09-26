import { cacheApiResponse, isCacheableApiGet, readCachedApiResponse } from './offline';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const PRODUCTION_API_FALLBACK = 'https://mbote-room-api.onrender.com';

const isUsableConfiguredUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (parsed.hostname.endsWith('.invalid')) return false;
    if (import.meta.env.PROD && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return false;
    return true;
  } catch {
    return false;
  }
};

const shouldUseProductionFallback = () => {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (host === 'appassets.androidplatform.net' || /MBoteRoomAndroid/i.test(navigator.userAgent)) return true;
  if (host === 'localhost' || host === '127.0.0.1') return false;
  if (host === 'mbote-room-api.onrender.com') return false;
  return host.endsWith('.vercel.app');
};

export const getApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL?.trim() || '';
  if (configured && isUsableConfiguredUrl(configured)) return trimTrailingSlash(configured);
  if (shouldUseProductionFallback()) return PRODUCTION_API_FALLBACK;
  return '';
};

export const apiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

export const getSocketUrl = () => {
  const configured = import.meta.env.VITE_SOCKET_URL?.trim() || '';
  if (configured && isUsableConfiguredUrl(configured)) return trimTrailingSlash(configured);
  const apiBaseUrl = getApiBaseUrl();
  return apiBaseUrl || window.location.origin;
};

export const getAuthHeaders = () => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

type NetworkInformationLike = {
  effectiveType?: string;
  rtt?: number;
  saveData?: boolean;
};

const retryableStatusCodes = new Set([408,425,429,500,502,503,504]);
const sleep = (delayMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));

const networkAwareTimeout = (requestedMs: number) => {
  if (typeof navigator === 'undefined') return requestedMs;
  const connection=(navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  const slowNetwork=connection?.effectiveType === '2g'
    || connection?.effectiveType === 'slow-2g'
    || Number(connection?.rtt || 0) >= 700
    || /MBoteRoomAndroid|; wv\)/i.test(navigator.userAgent);
  return Math.max(requestedMs, slowNetwork ? 90_000 : 60_000);
};

export const apiFetch = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 45_000,
) => {
  const method = String(init.method || 'GET').toUpperCase();
  const cacheableGet=isCacheableApiGet(input,method);
  if (typeof navigator !== 'undefined' && !navigator.onLine && cacheableGet) {
    const cached = await readCachedApiResponse(input);
    if (cached) return cached;
  }

  const attempts=cacheableGet && !init.signal ? 2 : 1;
  const effectiveTimeout=networkAwareTimeout(timeoutMs);
  let lastError:unknown=null;

  for(let attempt=0;attempt<attempts;attempt+=1){
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),effectiveTimeout);
    try{
      const response=await fetch(input,{
        credentials:'include',
        ...init,
        signal:init.signal||controller.signal,
      });

      if(cacheableGet){
        if(response.ok){
          void cacheApiResponse(input,response);
          return response;
        }
        if(response.status>=500){
          const cached=await readCachedApiResponse(input);
          if(cached)return cached;
        }
        if(retryableStatusCodes.has(response.status)&&attempt+1<attempts){
          await sleep(700*(attempt+1));
          continue;
        }
      }
      return response;
    }catch(error){
      lastError=error;
      if(cacheableGet){
        const cached=await readCachedApiResponse(input);
        if(cached)return cached;
      }
      const aborted=error instanceof DOMException&&error.name==='AbortError';
      const externalAbort=Boolean(init.signal?.aborted);
      if(!externalAbort&&attempt+1<attempts){
        await sleep(aborted?500:800);
        continue;
      }
      if(aborted){
        throw new Error('Connexion lente détectée. MBotéRoom continue de réessayer lorsque le réseau répond.');
      }
      throw new Error('MBotéRoom est momentanément indisponible. Vérifiez votre connexion puis réessayez.');
    }finally{
      window.clearTimeout(timer);
    }
  }

  if(lastError instanceof DOMException&&lastError.name==='AbortError'){
    throw new Error('Connexion lente détectée. MBotéRoom continue de réessayer lorsque le réseau répond.');
  }
  throw new Error('MBotéRoom est momentanément indisponible. Vérifiez votre connexion puis réessayez.');
};

export const handleExpiredAuthSession = () => undefined;
