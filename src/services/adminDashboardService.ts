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

export type AdminAudienceFilters = {
  country?: string;
  city?: string;
  role?: 'user'|'admin'|'all';
  accountStatus?: 'active'|'quarantined'|'banned'|'all';
  organization?: string;
  jobTitle?: string;
  userIds?: number[];
};

export type AdminAudienceOptions = {
  countries: Array<{name:string;count:number;cities:Array<{name:string;count:number}>}>;
  organizations: Array<{name:string;count:number}>;
  jobTitles: Array<{name:string;count:number}>;
  totals: {total:number;users:number;admins:number;active:number};
};

export type AdminAudiencePreview = {
  count: number;
  tooLarge: boolean;
  sample: Array<{
    id:number;name:string;email:string;country:string;city:string;organization:string;jobTitle:string;role:string;accountStatus:string;
  }>;
};

export type AdminBroadcast = {
  id:string;
  title:string;
  body:string;
  actionPath:string;
  audience:AdminAudienceFilters;
  recipientCount:number;
  pushSent:number;
  pushFailed:number;
  aiAssisted:boolean;
  createdAt:string;
  push?:{sent:number;failed:number;stale:number};
};

export type AdminAdCampaign = {
  id:string;
  title:string;
  body:string;
  imageUrl:string;
  actionLabel:string;
  actionUrl:string;
  audience:AdminAudienceFilters;
  isActive:boolean;
  startsAt:string;
  endsAt:string|null;
  maxImpressionsPerUser:number;
  cooldownHours:number;
  dismissible:boolean;
  priority:number;
  impressions:number;
  uniqueViewers:number;
  dismissals:number;
  clicks:number;
  createdAt:string;
  updatedAt:string;
};

export type AdminAdCampaignDraft = Omit<AdminAdCampaign,
  'id'|'impressions'|'uniqueViewers'|'dismissals'|'clicks'|'createdAt'|'updatedAt'
>;

export type AdminAiInsights = {
  metrics: {
    users: Record<string,number>;
    meetings: Record<string,number>;
    reports: Record<string,number>;
    notifications: Record<string,number>;
    topCountries: Array<{country:string;count:number}>;
  };
  summary:string;
  provider:string;
  model:string|null;
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

  async getAudienceOptions(): Promise<AdminAudienceOptions> {
    const response=await apiFetch(apiUrl('/api/admin/broadcasts/audience-options'),{headers:getAuthHeaders(),cache:'no-store'});
    return readJson<AdminAudienceOptions>(response);
  },

  async previewAudience(audience:AdminAudienceFilters): Promise<AdminAudiencePreview> {
    const response=await apiFetch(apiUrl('/api/admin/broadcasts/preview'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify({audience}),
    });
    return readJson<AdminAudiencePreview>(response);
  },

  async getBroadcasts(): Promise<AdminBroadcast[]> {
    const response=await apiFetch(apiUrl('/api/admin/broadcasts'),{headers:getAuthHeaders(),cache:'no-store'});
    return readJson<AdminBroadcast[]>(response);
  },

  async sendBroadcast(payload:{title:string;body:string;actionPath:string;audience:AdminAudienceFilters;push?:boolean;aiAssisted?:boolean}): Promise<AdminBroadcast> {
    const response=await apiFetch(apiUrl('/api/admin/broadcasts'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    return readJson<AdminBroadcast>(response);
  },

  async composeBroadcastWithAi(payload:{intent:string;title?:string;body?:string;tone?:string}): Promise<{title:string;body:string;provider:string;model:string}> {
    const response=await apiFetch(apiUrl('/api/admin/ai/compose'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    return readJson<{title:string;body:string;provider:string;model:string}>(response);
  },

  async getAiInsights(): Promise<AdminAiInsights> {
    const response=await apiFetch(apiUrl('/api/admin/ai/insights'),{headers:getAuthHeaders(),cache:'no-store'},60_000);
    return readJson<AdminAiInsights>(response);
  },

  async getAdCampaigns(): Promise<AdminAdCampaign[]> {
    const response=await apiFetch(apiUrl('/api/admin/ads'),{headers:getAuthHeaders(),cache:'no-store'});
    return readJson<AdminAdCampaign[]>(response);
  },

  async createAdCampaign(payload:AdminAdCampaignDraft): Promise<AdminAdCampaign> {
    const response=await apiFetch(apiUrl('/api/admin/ads'),{
      method:'POST',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    return readJson<AdminAdCampaign>(response);
  },

  async updateAdCampaign(campaignId:string,payload:Partial<AdminAdCampaignDraft>): Promise<AdminAdCampaign> {
    const response=await apiFetch(apiUrl(`/api/admin/ads/${encodeURIComponent(campaignId)}`),{
      method:'PUT',
      headers:{...getAuthHeaders(),'Content-Type':'application/json'},
      body:JSON.stringify(payload),
    });
    return readJson<AdminAdCampaign>(response);
  },

  async deleteAdCampaign(campaignId:string): Promise<void> {
    const response=await apiFetch(apiUrl(`/api/admin/ads/${encodeURIComponent(campaignId)}`),{
      method:'DELETE',
      headers:getAuthHeaders(),
    });
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw new Error(typeof data?.error==='string'?data.error:'Suppression impossible.');
    }
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
