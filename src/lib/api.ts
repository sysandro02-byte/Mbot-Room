const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const getApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL?.trim() || '';
  return configured ? trimTrailingSlash(configured) : '';
};

export const apiUrl = (path: string) => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

export const getSocketUrl = () => {
  const configured = import.meta.env.VITE_SOCKET_URL?.trim() || import.meta.env.VITE_API_URL?.trim() || '';
  return configured ? trimTrailingSlash(configured) : window.location.origin;
};

export const getAuthHeaders = () => {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const handleExpiredAuthSession = () => undefined;
