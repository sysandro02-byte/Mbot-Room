const API_CACHE_PREFIX = 'mboteroom-api-v2';
const QUEUE_KEY = 'mboteroom-offline-queue-v2';
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE = 100;

export type OfflineQueueEntry = {
  id: string;
  url: string;
  method: string;
  body: string;
  contentType: string;
  createdAt: string;
  attempts: number;
};

const safeWindow = () => typeof window !== 'undefined';

const currentUserId = () => {
  if (!safeWindow()) return 'anonymous';
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = storage.getItem('user');
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.id != null) return String(parsed.id);
    } catch {}
  }
  return 'anonymous';
};

const cacheName = () => `${API_CACHE_PREFIX}-${currentUserId()}`;

const syntheticCacheKey = (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const key = new URL('/__mboteroom_offline_api__', window.location.origin);
  key.searchParams.set('user', currentUserId());
  key.searchParams.set('url', url);
  return new Request(key.href, { method: 'GET' });
};

export const isCacheableApiGet = (input: RequestInfo | URL, method = 'GET') => {
  if (!safeWindow() || method.toUpperCase() !== 'GET' || !('caches' in window)) return false;
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/\/api\//.test(url)) return false;
  return !/\/api\/(?:auth|push|rtc|sfu|health)(?:\/|$)/.test(url);
};

export const cacheApiResponse = async (input: RequestInfo | URL, response: Response) => {
  if (!isCacheableApiGet(input) || !response.ok || response.status !== 200) return;
  try {
    const body = await response.clone().blob();
    const headers = new Headers(response.headers);
    headers.set('X-MBoteRoom-Cached-At', String(Date.now()));
    headers.set('X-MBoteRoom-Offline-Source', 'network');
    const cached = new Response(body, { status: 200, statusText: 'OK', headers });
    const cache = await caches.open(cacheName());
    await cache.put(syntheticCacheKey(input), cached);
  } catch {}
};

export const readCachedApiResponse = async (input: RequestInfo | URL) => {
  if (!isCacheableApiGet(input)) return null;
  try {
    const cache = await caches.open(cacheName());
    const cached = await cache.match(syntheticCacheKey(input));
    if (!cached) return null;
    const cachedAt = Number(cached.headers.get('X-MBoteRoom-Cached-At') || 0);
    if (cachedAt && Date.now() - cachedAt > CACHE_MAX_AGE_MS) {
      await cache.delete(syntheticCacheKey(input));
      return null;
    }
    const body = await cached.blob();
    const headers = new Headers(cached.headers);
    headers.set('X-MBoteRoom-Offline', 'true');
    headers.set('X-MBoteRoom-Offline-Source', 'cache');
    window.dispatchEvent(new CustomEvent('mbote-room-offline-cache-hit', {
      detail: { url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, cachedAt },
    }));
    return new Response(body, { status: 200, statusText: 'OK (offline cache)', headers });
  } catch {
    return null;
  }
};

const readQueue = (): OfflineQueueEntry[] => {
  if (!safeWindow()) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : [];
  } catch {
    return [];
  }
};

const writeQueue = (entries: OfflineQueueEntry[]) => {
  if (!safeWindow()) return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(entries.slice(-MAX_QUEUE)));
  window.dispatchEvent(new CustomEvent('mbote-room-offline-queue-changed', { detail: { pending: entries.length } }));
};

export const getOfflineQueueCount = () => readQueue().length;

export const queueOfflineMutation = (url: string, method: string, body = '', contentType = 'application/json') => {
  const entries = readQueue();
  const entry: OfflineQueueEntry = {
    id: crypto.randomUUID(),
    url,
    method: method.toUpperCase(),
    body,
    contentType,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  writeQueue([...entries, entry]);
  return entry;
};

const currentAuthHeaders = () => {
  if (!safeWindow()) return {};
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
};

let flushing = false;
export const flushOfflineQueue = async () => {
  if (!safeWindow() || flushing || !navigator.onLine) return { synced: 0, pending: getOfflineQueueCount() };
  flushing = true;
  let synced = 0;
  const entries = readQueue();
  const remaining: OfflineQueueEntry[] = [];
  try {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      try {
        const headers = new Headers();
        headers.set('Content-Type', entry.contentType || 'application/json');
        headers.set('X-MBoteRoom-Offline-Replay', '1');
        const authHeaders = currentAuthHeaders();
        if ('Authorization' in authHeaders && authHeaders.Authorization) headers.set('Authorization', authHeaders.Authorization);
        const response = await fetch(entry.url, {
          method: entry.method,
          credentials: 'include',
          headers,
          body: ['GET', 'HEAD'].includes(entry.method) ? undefined : entry.body,
        });
        if (response.ok || response.status === 404) {
          synced += 1;
          continue;
        }
        if (response.status === 401 || response.status === 403 || response.status === 408 || response.status === 429 || response.status >= 500) {
          remaining.push({ ...entry, attempts: entry.attempts + 1 }, ...entries.slice(index + 1));
          break;
        }
        window.dispatchEvent(new CustomEvent('mbote-room-offline-conflict', {
          detail: { entry, status: response.status },
        }));
      } catch {
        remaining.push({ ...entry, attempts: entry.attempts + 1 }, ...entries.slice(index + 1));
        break;
      }
    }
  } finally {
    writeQueue(remaining);
    flushing = false;
  }
  if (synced > 0) {
    window.dispatchEvent(new CustomEvent('mbote-room-offline-synced', { detail: { synced, pending: remaining.length } }));
  }
  return { synced, pending: remaining.length };
};

export const clearOfflinePrivateData = async () => {
  if (!safeWindow()) return;
  try {
    const name = cacheName();
    await caches.delete(name);
  } catch {}
  localStorage.removeItem(QUEUE_KEY);
};

let initialized = false;
export const initOfflineMode = () => {
  if (!safeWindow() || initialized) return;
  initialized = true;
  const sync = () => void flushOfflineQueue();
  window.addEventListener('online', sync);
  window.addEventListener('focus', sync);
  window.setInterval(() => {
    if (navigator.onLine && getOfflineQueueCount()) void flushOfflineQueue();
  }, 60_000);
  if (navigator.onLine && getOfflineQueueCount()) void flushOfflineQueue();
};
