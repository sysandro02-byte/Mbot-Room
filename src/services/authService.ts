import { apiUrl, getAuthHeaders } from '../lib/api';

export type RoomUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  isGuest?: boolean;
  createdAt?: string;
};

type AuthResponse = {
  user: RoomUser;
  token: string;
};

const USER_KEY = 'user';
const TOKEN_KEY = 'token';

const normalizeUser = (user: any): RoomUser => ({
  id: String(user.id),
  name: user.name || '',
  username: user.username || '',
  email: user.email || '',
  avatar: user.avatar || '',
  isGuest: Boolean(user.isGuest || user.is_guest),
  createdAt: user.createdAt || user.created_at || '',
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

const saveSession = ({ user, token }: AuthResponse) => {
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
  localStorage.setItem(TOKEN_KEY, token);
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
  };
};

export const authService = {
  async register(payload: { name: string; email: string; password: string; username?: string }) {
    const session = await postAuth('/api/auth/register', payload);
    saveSession(session);
    return session;
  },

  async login(payload: { email: string; password: string }) {
    const session = await postAuth('/api/auth/login', payload);
    saveSession(session);
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
    };
    saveSession(session);
    return {
      ...session,
      meeting: result.meeting,
      lobbyStatus: result.lobbyStatus as 'requested' | 'accepted',
    };
  },

  async refreshCurrentUser() {
    const response = await fetch(apiUrl('/api/auth/me'), { headers: getAuthHeaders() });
    if (!response.ok) {
      this.logout(false);
      return null;
    }
    const result = await readJson(response);
    const user = normalizeUser(result.user);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  async logout(notifyServer = true) {
    const token = this.getToken();
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_KEY);
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
      return raw ? normalizeUser(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },

  getToken() {
    return localStorage.getItem(TOKEN_KEY);
  },

  isAuthenticated() {
    return Boolean(this.getCurrentUser() && this.getToken());
  },
};
