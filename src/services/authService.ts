import { apiUrl, getAuthHeaders } from '../lib/api';

export type RoomUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  phoneNumber?: string;
  organization?: string;
  jobTitle?: string;
  role?: 'admin' | 'user' | 'guest';
  permissions?: string[];
  isGuest?: boolean;
  createdAt?: string;
};

type AuthResponse = {
  user: RoomUser;
  token: string;
  expiresAt?: string;
};

const USER_KEY = 'user';
const TOKEN_KEY = 'token';

type RawRoomUser = Partial<Record<keyof RoomUser | 'is_guest' | 'created_at' | 'phone_number' | 'job_title' | 'role' | 'permissions', unknown>>;

const getStorage = (persist: boolean) => (persist ? localStorage : sessionStorage);

const clearStoredSession = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
};

const normalizeUser = (user: RawRoomUser): RoomUser => ({
  id: String(user.id || ''),
  name: String(user.name || ''),
  username: String(user.username || ''),
  email: String(user.email || ''),
  avatar: String(user.avatar || ''),
  phoneNumber: String(user.phoneNumber || user.phone_number || ''),
  organization: String(user.organization || ''),
  jobTitle: String(user.jobTitle || user.job_title || ''),
  role: user.role === 'admin' || user.role === 'guest' ? user.role : user.isGuest || user.is_guest ? 'guest' : 'user',
  permissions: Array.isArray(user.permissions) ? user.permissions.filter((item): item is string => typeof item === 'string') : [],
  isGuest: Boolean(user.isGuest || user.is_guest),
  createdAt: String(user.createdAt || user.created_at || ''),
});

const readJson = async (response: Response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

const saveSession = ({ user, token }: AuthResponse, persist: boolean) => {
  clearStoredSession();
  const storage = getStorage(persist);
  storage.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
  storage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));
};

const postAuth = async (path: string, body: unknown): Promise<AuthResponse> => {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(result.error || 'Authentification impossible.');
  }
  return {
    user: normalizeUser(result.user),
    token: String(result.token || ''),
    expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined,
  };
};

export const authService = {
  async register(payload: { name: string; email: string; password: string; username?: string; phoneNumber?: string; organization?: string; jobTitle?: string }) {
    const session = await postAuth('/api/auth/register', payload);
    saveSession(session, true);
    return session;
  },

  async login(payload: { email: string; password: string; rememberMe?: boolean }) {
    const session = await postAuth('/api/auth/login', payload);
    saveSession(session, Boolean(payload.rememberMe));
    return session;
  },

  async guestJoin(payload: { name: string; meetingCode: string; password: string }) {
    const response = await fetch(apiUrl('/api/auth/guest-join'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || 'Réunion introuvable.');
    }
    const session = {
      user: normalizeUser(result.user),
      token: String(result.token || ''),
      expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined,
    };
    saveSession(session, false);
    return {
      ...session,
      meeting: result.meeting,
      lobbyStatus: result.lobbyStatus as 'requested' | 'accepted',
    };
  },

  async verifyMboteCredentials(identifier: string, password: string) {
    const response = await fetch(apiUrl('/api/auth/mbote/credentials'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Identifiants MBoté incorrects.');
    return result as { challengeId: string; profile: { id: string; name: string; email: string; avatar?: string } };
  },

  async authorizeMbote(challengeId: string, redirectTo = '/app') {
    const response = await fetch(apiUrl('/api/auth/mbote/authorize'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId }),
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Autorisation MBoté impossible.");
    const session = {
      user: normalizeUser(result.user), token: String(result.token || ''),
      expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined,
    };
    saveSession(session, true);
    return { ...session, redirectTo };
  },
  async startMboteAuth(redirectTo = '/app') {
    const response = await fetch(apiUrl(`/api/auth/mbote/start?redirect=${encodeURIComponent(redirectTo)}`));
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || "Authentification MBoté indisponible.");
    }
    if (!result.url) throw new Error("URL d'authentification MBoté indisponible.");
    window.location.assign(String(result.url));
  },

  consumeMboteAuthCallback() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('mboteToken');
    const rawUser = params.get('mboteUser');
    if (!token || !rawUser) return null;

    try {
      const user = normalizeUser(JSON.parse(rawUser));
      if (!user.id) throw new Error('Profil MBoté incomplet.');
      saveSession({ user, token }, true);
      const requestedRedirect = params.get('redirect') || '/app';
      return requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//') ? requestedRedirect : '/app';
    } finally {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  },

  async forgotPassword(email: string) {
    const response = await fetch(apiUrl('/api/auth/forgot-password'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || 'Demande de réinitialisation impossible.');
    }
    return result as { success: boolean; message?: string; resetUrl?: string };
  },

  async refreshCurrentUser() {
    const response = await fetch(apiUrl('/api/auth/me'), { headers: getAuthHeaders() });
    if (!response.ok) {
      this.logout(false);
      return null;
    }
    const result = await readJson(response);
    const user = normalizeUser(result.user);
    getStorage(Boolean(localStorage.getItem(TOKEN_KEY))).setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  async logout(notifyServer = true) {
    const token = this.getToken();
    clearStoredSession();
    if (notifyServer && token) {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));
  },

  getCurrentUser(): RoomUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      const sessionRaw = sessionStorage.getItem(USER_KEY);
      return raw || sessionRaw ? normalizeUser(JSON.parse(raw || sessionRaw || '{}')) : null;
    } catch {
      return null;
    }
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  },

  isAuthenticated() {
    return Boolean(this.getCurrentUser() && this.getToken());
  },

  isAdmin() {
    const user = this.getCurrentUser();
    return Boolean(user?.role === 'admin' || user?.id === '1' || user?.permissions?.includes('admin.dashboard.view'));
  },
};
