import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';
import { DashboardTip, Meeting } from './meetingService';

export type GuestAccessSlide = { id: string; title: string; body: string; imageUrl: string; isActive: boolean; createdAt: string; updatedAt: string };

export type LoginBranding = {
  wordmarkUrl: string;
  illustrationUrl: string;
  updatedAt: string;
};

export type AdminInvite = {
  id: string;
  email: string;
  invitePath?: string;
  expiresAt: string;
  consumedAt?: string | null;
  createdAt: string;
};

export type HomeSlide = {
  slot: 1 | 2 | 3 | 4;
  title: string;
  body: string;
  imageUrl: string;
  actionLabel: string;
  actionPath: string;
  isActive: boolean;
  updatedAt: string;
};

export type AdminPlatformSettings = {
  registrationEnabled: boolean;
  guestAccessEnabled: boolean;
  meetingCreationEnabled: boolean;
  lunaEnabled: boolean;
  recordingEnabled: boolean;
  publicMeetingsEnabled: boolean;
  premiumPaymentEnabled: boolean;
  guestRaiseHandEnabled: boolean;
  guestRecordingEnabled: boolean;
  guestScreenShareEnabled: boolean;
  guestLunaEnabled: boolean;
  guestTranscriptionEnabled: boolean;
  guestChatEnabled: boolean;
};

export type AdminManagedUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  phoneNumber: string;
  organization: string;
  jobTitle: string;
  country: string;
  city: string;
  birthDate: string;
  age: number|null;
  role: 'admin'|'user'|'guest';
  isGuest: boolean;
  isSuspended: boolean;
  accountStatus: 'active'|'quarantined'|'banned';
  featureRestrictions: string[];
  createdAt: string;
};

export type AdminLegalDocument = {
  key: string;
  title: string;
  body: string;
  version: string;
  updatedAt: string;
};

export type AdminReport = {
  id: string;
  reporterUserId: number|null;
  reporterName: string;
  reporterEmail: string;
  type: 'bug'|'meeting';
  meetingId: number|null;
  meetingTitle: string;
  title: string;
  description: string;
  pageUrl: string;
  status: 'open'|'reviewing'|'resolved'|'dismissed';
  createdAt: string;
  updatedAt: string;
};

export type AdminDashboardStat = {
  id: 'users' | 'meetings' | 'live' | 'hours' | 'recordings';
  label: string;
  value: number;
  suffix?: string;
  evolution: number;
  helper: string;
  points: number[];
};

export type AdminActivity = {
  id: string;
  type: 'user' | 'meeting' | 'report' | 'ban' | 'recording';
  title: string;
  description: string;
  createdAt: string;
};

export type AdminUsagePoint = {
  label: string;
  meetings: number;
  users: number;
};

export type AdminUserDistribution = {
  active: number;
  guests: number;
  inactive: number;
  banned: number;
};

export type AdminCountryStat = {
  id: string;
  name: string;
  flag: string;
  count: number;
  percentage: number;
};

export type AdminDashboardPayload = {
  stats: AdminDashboardStat[];
  liveMeetings: Meeting[];
  recentActivity: AdminActivity[];
  usage: AdminUsagePoint[];
  distribution: AdminUserDistribution;
  countries: AdminCountryStat[];
  permissions: string[];
};

const readJson = async <T>(response: Response): Promise<T> => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Accès administrateur impossible.';
    throw new Error(message);
  }
  return data as T;
};

export const adminDashboardService = {
  async getPlatformSettings(): Promise<AdminPlatformSettings> {
    const response = await apiFetch(apiUrl('/api/admin/settings'), { headers: getAuthHeaders() });
    return readJson<AdminPlatformSettings>(response);
  },

  async updatePlatformSettings(payload: Partial<AdminPlatformSettings>): Promise<AdminPlatformSettings> {
    const response = await apiFetch(apiUrl('/api/admin/settings'), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<AdminPlatformSettings>(response);
  },

  async getAdminInvites(): Promise<AdminInvite[]> {
    const response = await apiFetch(apiUrl('/api/admin/admin-invites'), { headers: getAuthHeaders(), cache: 'no-store' });
    return readJson<AdminInvite[]>(response);
  },

  async createAdminInvite(email: string): Promise<AdminInvite> {
    const response = await apiFetch(apiUrl('/api/admin/admin-invites'), {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return readJson<AdminInvite>(response);
  },

  async revokeAdminInvite(inviteId: string): Promise<void> {
    const response = await apiFetch(apiUrl(`/api/admin/admin-invites/${encodeURIComponent(inviteId)}`), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data?.error === 'string' ? data.error : 'Révocation impossible.');
    }
  },

  async getUsers(query = ''): Promise<AdminManagedUser[]> {
    const rows:AdminManagedUser[]=[];
    const pageSize=1000;
    for(let offset=0;offset<100000;offset+=pageSize){
      const response=await apiFetch(apiUrl(`/api/admin/users?q=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`),{
        headers:getAuthHeaders(),
        cache:'no-store',
      });
      const page=await readJson<AdminManagedUser[]>(response);
      rows.push(...page);
      if(page.length<pageSize)break;
    }
    return rows;
  },

  async updateUser(userId: number, payload: Partial<Pick<AdminManagedUser,'name'|'phoneNumber'|'organization'|'jobTitle'|'country'|'city'|'isSuspended'|'accountStatus'|'featureRestrictions'>>): Promise<AdminManagedUser> {
    const response = await apiFetch(apiUrl(`/api/admin/users/${userId}`), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<AdminManagedUser>(response);
  },

  async revokeUserSessions(userId: number): Promise<void> {
    const response = await apiFetch(apiUrl(`/api/admin/users/${userId}/revoke-sessions`), {
      method: 'POST', headers: getAuthHeaders(),
    });
    await readJson<{ success: boolean }>(response);
  },

  async getTerms(): Promise<AdminLegalDocument> {
    const response=await apiFetch(apiUrl('/api/admin/legal/terms'),{headers:getAuthHeaders(),cache:'no-store'});
    return readJson<AdminLegalDocument>(response);
  },

  async updateTerms(payload:{title:string;body:string}): Promise<AdminLegalDocument> {
    const response=await apiFetch(apiUrl('/api/admin/legal/terms'),{
      method:'PUT',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    return readJson<AdminLegalDocument>(response);
  },

  async getReports(status=''): Promise<AdminReport[]> {
    const suffix=status?`?status=${encodeURIComponent(status)}`:'';
    const response=await apiFetch(apiUrl('/api/admin/reports'+suffix),{headers:getAuthHeaders(),cache:'no-store'});
    return readJson<AdminReport[]>(response);
  },

  async updateReport(reportId:string,status:AdminReport['status']): Promise<AdminReport> {
    const response=await apiFetch(apiUrl(`/api/admin/reports/${encodeURIComponent(reportId)}`),{
      method:'PUT',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({status}),
    });
    return readJson<AdminReport>(response);
  },

  async getDashboard(period: string): Promise<AdminDashboardPayload> {
    const response = await apiFetch(apiUrl(`/api/admin/dashboard?period=${encodeURIComponent(period)}`), {
      headers: getAuthHeaders(),
    });
    return readJson<AdminDashboardPayload>(response);
  },

  async search(query: string) {
    const response = await apiFetch(apiUrl(`/api/admin/search?q=${encodeURIComponent(query)}`), {
      headers: getAuthHeaders(),
    });
    return readJson<{ meetings: Meeting[]; users: Array<{ id: number; name: string; email: string }> }>(response);
  },

  async joinMeeting(meetingId: number) {
    const response = await apiFetch(apiUrl(`/api/admin/meetings/${meetingId}/join`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return readJson<{ success: boolean; meeting: Meeting }>(response);
  },

  async getDashboardTips() {
    const response = await apiFetch(apiUrl('/api/admin/dashboard-tips'), {
      headers: getAuthHeaders(),
    });
    return readJson<DashboardTip[]>(response);
  },

  async createDashboardTip(payload: Pick<DashboardTip, 'title' | 'body' | 'actionLabel' | 'actionPath' | 'isActive'>) {
    const response = await apiFetch(apiUrl('/api/admin/dashboard-tips'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<DashboardTip>(response);
  },

  async updateDashboardTip(tipId: string, payload: Pick<DashboardTip, 'title' | 'body' | 'actionLabel' | 'actionPath' | 'isActive'>) {
    const response = await apiFetch(apiUrl(`/api/admin/dashboard-tips/${encodeURIComponent(tipId)}`), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<DashboardTip>(response);
  },

  async getLoginBranding(): Promise<LoginBranding> {
    const response = await apiFetch(apiUrl('/api/admin/login-branding'), { headers: getAuthHeaders(), cache: 'no-store' });
    return readJson<LoginBranding>(response);
  },

  async saveLoginBranding(payload: Pick<LoginBranding, 'wordmarkUrl' | 'illustrationUrl'>): Promise<LoginBranding> {
    const response = await apiFetch(apiUrl('/api/admin/login-branding'), {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return readJson<LoginBranding>(response);
  },

  async getHomeSlides(): Promise<HomeSlide[]> {
    const response = await apiFetch(apiUrl('/api/admin/home-slides'), { headers: getAuthHeaders() });
    return readJson<HomeSlide[]>(response);
  },

  async saveHomeSlide(slot: HomeSlide['slot'], payload: Omit<HomeSlide, 'slot' | 'updatedAt'>): Promise<HomeSlide> {
    const response = await apiFetch(apiUrl(`/api/admin/home-slides/${slot}`), {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return readJson<HomeSlide>(response);
  },

  async getGuestAccessSlides() {
    const response = await apiFetch(apiUrl('/api/admin/guest-access-slides'), { headers: getAuthHeaders() });
    return readJson<GuestAccessSlide[]>(response);
  },
  async saveGuestAccessSlide(payload: Pick<GuestAccessSlide, 'title' | 'body' | 'imageUrl' | 'isActive'>, id?: string) {
    const response = await apiFetch(apiUrl(id ? `/api/admin/guest-access-slides/${encodeURIComponent(id)}` : '/api/admin/guest-access-slides'), {
      method: id ? 'PUT' : 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    return readJson<GuestAccessSlide>(response);
  },
  async deleteGuestAccessSlide(id: string) {
    const response = await apiFetch(apiUrl(`/api/admin/guest-access-slides/${encodeURIComponent(id)}`), { method: 'DELETE', headers: getAuthHeaders() });
    if (!response.ok) throw new Error('Suppression impossible.');
  },
  async deleteDashboardTip(tipId: string) {
    const response = await apiFetch(apiUrl(`/api/admin/dashboard-tips/${encodeURIComponent(tipId)}`), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data?.error === 'string' ? data.error : 'Suppression impossible.');
    }
  },
};
