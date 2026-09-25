import { apiFetch, apiUrl, getAuthHeaders } from '../lib/api';

export type UserAdCampaign = {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  actionLabel: string;
  actionUrl: string;
  audience: Record<string, unknown>;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  maxImpressionsPerUser: number;
  cooldownHours: number;
  dismissible: boolean;
  priority: number;
  impressions?: number;
  uniqueViewers?: number;
  dismissals?: number;
  clicks?: number;
  createdAt: string;
  updatedAt: string;
};

const readJson = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) return null as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Campagne indisponible.');
  }
  return data as T;
};

export const adService = {
  async getActive(): Promise<UserAdCampaign | null> {
    const response = await apiFetch(apiUrl('/api/ads/active'), {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    return readJson<UserAdCampaign | null>(response);
  },

  async markImpression(campaignId: string): Promise<void> {
    const response = await apiFetch(apiUrl(`/api/ads/${encodeURIComponent(campaignId)}/impression`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 || response.status === 404) return;
      throw new Error(typeof data?.error === 'string' ? data.error : 'Impression non enregistrée.');
    }
  },

  async dismiss(campaignId: string): Promise<void> {
    const response = await apiFetch(apiUrl(`/api/ads/${encodeURIComponent(campaignId)}/dismiss`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data?.error === 'string' ? data.error : 'Fermeture non enregistrée.');
    }
  },

  async click(campaignId: string): Promise<void> {
    const response = await apiFetch(apiUrl(`/api/ads/${encodeURIComponent(campaignId)}/click`), {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data?.error === 'string' ? data.error : 'Clic non enregistré.');
    }
  },
};
