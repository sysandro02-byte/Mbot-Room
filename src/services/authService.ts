import { apiUrl, getApiBaseUrl, getAuthHeaders } from '../lib/api';
import { clearOfflinePrivateData } from '../lib/offline';

export type RoomUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  phoneNumber?: string;
  organization?: string;
  jobTitle?: string;
  country?: string;
  city?: string;
  birthDate?: string;
  birthPlace?: string;
  address?: string;
  bio?: string;
  profileVisible?: boolean;
  personalMeetingId?: string;
  accountStatus?: 'active' | 'quarantined' | 'banned';
  featureRestrictions?: string[];
  termsVersion?: string;
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
const EXPIRY_KEY = 'sessionExpiresAt';

type RawRoomUser = Partial<Record<keyof RoomUser | 'is_guest' | 'created_at' | 'phone_number' | 'job_title' | 'birth_date' | 'birth_place' | 'personal_meeting_id' | 'role' | 'permissions', unknown>>;

const getStorage = (persist: boolean) => (persist ? localStorage : sessionStorage);

const clearStoredSession = () => {
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
  localStorage.removeItem('mboteroom-last-activity-at');
  localStorage.removeItem('mboteroom-last-safe-route');
  sessionStorage.removeItem('mboteroom-pwa-resume-done');
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
  country: String(user.country || ''),
  city: String(user.city || ''),
  birthDate: String(user.birthDate || user.birth_date || ''),
  birthPlace: String(user.birthPlace || user.birth_place || ''),
  address: String(user.address || ''),
  bio: String(user.bio || ''),
  profileVisible: user.profileVisible === undefined ? true : Boolean(user.profileVisible),
  personalMeetingId: String(user.personalMeetingId || user.personal_meeting_id || ''),
  accountStatus: user.accountStatus === 'quarantined' || user.accountStatus === 'banned' ? user.accountStatus : 'active',
  featureRestrictions: Array.isArray(user.featureRestrictions) ? user.featureRestrictions.filter((item): item is string => typeof item === 'string') : [],
  termsVersion: String(user.termsVersion || ''),
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

const saveSession = ({ user, token, expiresAt }: AuthResponse, persist: boolean) => {
  clearStoredSession();
  const storage = getStorage(persist);
  storage.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
  if (token) storage.setItem(TOKEN_KEY, token);
  if (expiresAt) storage.setItem(EXPIRY_KEY, expiresAt);
  localStorage.setItem('mboteroom-last-activity-at', String(Date.now()));
  sessionStorage.removeItem('mboteroom-pwa-resume-done');
  window.dispatchEvent(new CustomEvent('mbote-room-auth-changed'));
};

const authRequestHeaders = () => ({
  'Content-Type': 'application/json',
  ...(getApiBaseUrl() ? { 'X-MBote-Room-Session-Mode': 'bearer' } : {}),
});

const fetchAuth = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45_000);
  try {
    return await fetch(input, { ...init, signal: init.signal || controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('MBotéRoom met trop de temps à répondre. Réessayez.');
    }
    throw new Error('MBotéRoom est momentanément indisponible. Vérifiez votre connexion puis réessayez.');
  } finally {
    window.clearTimeout(timeout);
  }
};

const postAuth = async (path: string, body: unknown): Promise<AuthResponse> => {
  const response = await fetchAuth(apiUrl(path), {
    method: 'POST',
    headers: authRequestHeaders(),
    body: JSON.stringify(body),
    credentials: 'include',
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
  async adminRegister(payload: { name: string; email: string; password: string; username?: string; phoneNumber?: string; organization?: string; jobTitle?: string; inviteToken?: string }) {
    const response = await fetchAuth(apiUrl('/api/auth/admin/register'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Création du compte administrateur impossible.');
    return {
      challengeId: String(result.challengeId || ''),
      emailHint: String(result.emailHint || ''),
    };
  },

  async register(payload: { name: string; email: string; password: string; username?: string; phoneNumber?: string; organization?: string; jobTitle?: string; country?: string; city?: string; birthDate?: string; birthPlace?: string; address?: string; termsAccepted: boolean; termsVersion: string }) {
    const response = await fetchAuth(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Création de compte impossible.');
    const session = {
      user: normalizeUser(result.user),
      token: String(result.token || ''),
      expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined,
    };
    saveSession(session, true);
    return {
      ...session,
      accountCreated: Boolean(result.accountCreated),
      welcomeEmailSent: Boolean(result.welcomeEmailSent),
      security: result.security as { otpRequiredOnNextLogin?: boolean; passwordEmailed?: boolean } | undefined,
    };
  },

  async login(payload: { email: string; password: string; rememberMe?: boolean; adminOnly?: boolean }) {
    const response = await fetchAuth(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Connexion impossible.');
    return result as { otpRequired: true; challengeId: string; emailHint: string; expiresInSeconds: number };
  },

  async verifyLoginOtp(challengeId: string, code: string, rememberMe = false) {
    const response = await fetchAuth(apiUrl('/api/auth/login/otp'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify({ challengeId, code }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Code de sécurité invalide.');
    const session = {
      user: normalizeUser(result.user),
      token: String(result.token || ''),
      expiresAt: typeof result.expiresAt === 'string' ? result.expiresAt : undefined,
    };
    saveSession(session, rememberMe);
    return session;
  },

  async resendLoginOtp(challengeId: string) {
    const response = await fetchAuth(apiUrl('/api/auth/login/otp/resend'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify({ challengeId }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Impossible de renvoyer le code.');
    return result as { success: boolean; expiresInSeconds: number };
  },

  async guestJoin(payload: { name: string; meetingCode: string; password: string; termsAccepted: boolean; termsVersion: string }) {
    const response = await fetchAuth(apiUrl('/api/auth/guest-join'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
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
    const response = await fetchAuth(apiUrl('/api/auth/mbote/credentials'), {
      method: 'POST', headers: authRequestHeaders(),
      body: JSON.stringify({ identifier, password }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || 'Identifiants MBoté incorrects.');
    return result as { challengeId: string; profile: { id: string; name: string; email: string; avatar?: string } };
  },

  async authorizeMbote(challengeId: string, redirectTo = '/app') {
    const response = await fetchAuth(apiUrl('/api/auth/mbote/authorize'), {
      method: 'POST', headers: authRequestHeaders(), body: JSON.stringify({ challengeId }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result.error || "Autorisation MBoté impossible.");
    return {
      otpRequired: true as const,
      challengeId: String(result.challengeId || ''),
      emailHint: String(result.emailHint || ''),
      expiresInSeconds: Number(result.expiresInSeconds || 600),
      redirectTo,
    };
  },
  async startMboteAuth(redirectTo = '/app') {
    const response = await fetchAuth(apiUrl(`/api/auth/mbote/start?redirect=${encodeURIComponent(redirectTo)}`), { credentials: 'include' });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || "Authentification MBoté indisponible.");
    }
    if (!result.url) throw new Error("URL d'authentification MBoté indisponible.");
    window.location.assign(String(result.url));
  },

  consumeMboteAuthCallback() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const otpChallengeId = params.get('otpChallengeId') || '';
    const redirectToRaw = params.get('redirect') || '/app';
    const redirectTo = redirectToRaw.startsWith('/') && !redirectToRaw.startsWith('//') ? redirectToRaw : '/app';

    if (otpChallengeId) {
      const result = {
        type: 'otp' as const,
        challengeId: otpChallengeId,
        emailHint: params.get('otpEmailHint') || '',
        expiresInSeconds: Number(params.get('otpExpiresInSeconds') || 600),
        redirectTo,
      };
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return result;
    }

    const rawUser = params.get('mboteUser');
    if (!rawUser) return null;
    try {
      const user = normalizeUser(JSON.parse(rawUser));
      if (!user.id) throw new Error('Profil MBoté incomplet.');
      saveSession({
        user,
        token: '',
        expiresAt: params.get('expiresAt') || undefined,
      }, true);
      return { type: 'session' as const, redirectTo };
    } finally {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  },

  async forgotPassword(email: string, admin = false) {
    const response = await fetchAuth(apiUrl('/api/auth/forgot-password'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify({ email, admin }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || 'Demande de réinitialisation impossible.');
    }
    return result as { success: boolean; message?: string; resetUrl?: string };
  },

  async resetPassword(token: string, password: string) {
    const response = await fetchAuth(apiUrl('/api/auth/reset-password'), {
      method: 'POST',
      headers: authRequestHeaders(),
      body: JSON.stringify({ token, password }),
      credentials: 'include',
    });
    const result = await readJson(response);
    if (!response.ok) {
      throw new Error(result.error || 'Réinitialisation du mot de passe impossible.');
    }
    return result as { success: boolean; message?: string };
  },

  async refreshCurrentUser() {
    const response = await fetchAuth(apiUrl('/api/auth/me'), {
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await this.logout(false);
        return null;
      }
      const result = await readJson(response);
      throw new Error(result.error || 'La vérification de la session est temporairement indisponible.');
    }
    const result = await readJson(response);
    const user = normalizeUser(result.user);
    const persist = Boolean(localStorage.getItem(USER_KEY));
    getStorage(persist).setItem(USER_KEY, JSON.stringify(user));
    return user;
  },

  async touchActivity() {
    const response = await fetchAuth(apiUrl('/api/auth/activity'), {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
    });
    if (response.status === 401 || response.status === 403) {
      await this.logout(false);
      throw new Error('Votre session a expiré après une période d’inactivité.');
    }
    if (!response.ok) {
      const result = await readJson(response);
      throw new Error(result.error || 'Impossible de prolonger la session.');
    }
  },

  async logout(notifyServer = true) {
    const legacyToken = this.getToken();
    if (notifyServer) {
      await fetchAuth(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: legacyToken ? { Authorization: `Bearer ${legacyToken}` } : undefined,
        credentials: 'include',
      }).catch(() => undefined);
    }
    await clearOfflinePrivateData().catch(() => undefined);
    clearStoredSession();
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
    const user = this.getCurrentUser();
    if (!user) return false;
    const expiry = localStorage.getItem(EXPIRY_KEY) || sessionStorage.getItem(EXPIRY_KEY);
    if (expiry) {
      const timestamp = new Date(expiry).getTime();
      if (!Number.isNaN(timestamp) && timestamp <= Date.now()) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return true;
        }
        clearStoredSession();
        return false;
      }
    }
    return true;
  },

  isAdmin() {
    const user = this.getCurrentUser();
    return Boolean(user?.role === 'admin' || user?.permissions?.includes('admin.dashboard.view'));
  },
};
