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

export const handleExpiredAuthSession = () => undefined;
