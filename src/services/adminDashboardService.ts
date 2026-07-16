import { apiUrl, getAuthHeaders } from '../lib/api';
import { DashboardTip, Meeting } from './meetingService';

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
  async getDashboard(period: string): Promise<AdminDashboardPayload> {
    const response = await fetch(apiUrl(`/api/admin/dashboard?period=${encodeURIComponent(period)}`), {
      headers: getAuthHeaders(),
    });
    return readJson<AdminDashboardPayload>(response);
  },

  async search(query: string) {
    const response = await fetch(apiUrl(`/api/admin/search?q=${encodeURIComponent(query)}`), {
      headers: getAuthHeaders(),
    });
    return readJson<{ meetings: Meeting[]; users: Array<{ id: number; name: string; email: string }> }>(response);
  },

  async joinMeeting(meetingId: number) {
    const response = await fetch(apiUrl(`/api/admin/meetings/${meetingId}/join`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return readJson<{ success: boolean; meeting: Meeting }>(response);
  },

  async getDashboardTips() {
    const response = await fetch(apiUrl('/api/admin/dashboard-tips'), {
      headers: getAuthHeaders(),
    });
    return readJson<DashboardTip[]>(response);
  },

  async createDashboardTip(payload: Pick<DashboardTip, 'title' | 'body' | 'actionLabel' | 'actionPath' | 'isActive'>) {
    const response = await fetch(apiUrl('/api/admin/dashboard-tips'), {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<DashboardTip>(response);
  },

  async updateDashboardTip(tipId: string, payload: Pick<DashboardTip, 'title' | 'body' | 'actionLabel' | 'actionPath' | 'isActive'>) {
    const response = await fetch(apiUrl(`/api/admin/dashboard-tips/${encodeURIComponent(tipId)}`), {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    return readJson<DashboardTip>(response);
  },

  async deleteDashboardTip(tipId: string) {
    const response = await fetch(apiUrl(`/api/admin/dashboard-tips/${encodeURIComponent(tipId)}`), {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data?.error === 'string' ? data.error : 'Suppression impossible.');
    }
  },
};
