import { createSign } from 'node:crypto';
import { query } from './core.js';
import type { PushPayload } from './pushService.js';

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };
const getCredentials = (): ServiceAccount | null => {
  try {
    const account = JSON.parse(String(process.env.FCM_SERVICE_ACCOUNT_JSON || '')) as ServiceAccount;
    if (!account || typeof account !== 'object' || !account.client_email || !account.private_key || !account.project_id) return null;
    return account;
  } catch { return null; }
};
const projectId = () => String(process.env.FCM_PROJECT_ID || '').trim();
export const isNativePushConfigured = () =>
  Boolean(projectId() && /^[a-z][a-z0-9:-]{3,100}$/i.test(projectId()) && getCredentials()?.project_id === projectId());

let accessCache: { token: string; expiresAt: number } | null = null;
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken = async (): Promise<string> => {
  if (accessCache && accessCache.expiresAt > Date.now() + 60_000) return accessCache.token;
  const credentials = getCredentials();
  if (!credentials || !isNativePushConfigured()) throw new Error('FCM not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const content = header + '.' + claim;
  const privateKey = credentials.private_key;
  if (!privateKey) throw new Error('FCM credentials missing a private key');
  const signature = createSign('RSA-SHA256').update(content).end().sign(privateKey, 'base64url');
  const assertion = content + '.' + signature;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.access_token !== 'string') throw new Error('FCM OAuth token request failed');
  accessCache = { token: data.access_token, expiresAt: Date.now() + Math.min(3300, Number(data.expires_in) || 3300) * 1000 };
  return accessCache.token;
};

export const validNativeToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 32 && value.length <= 4096 && /^[a-zA-Z0-9:_-]+$/.test(value);

export const sendNativePushToUsers = async (userIds: number[], payload: PushPayload) => {
  const uniqueIds = [...new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!uniqueIds.length || !isNativePushConfigured()) return { sent: 0, failed: 0, stale: 0 };
  const result = await query(
    `SELECT n.id,n.token,COALESCE(pref.preferences,'{}'::jsonb) AS preferences
       FROM room_native_push_tokens n
       LEFT JOIN room_user_preferences pref ON pref.user_id=n.user_id
      WHERE n.user_id=ANY($1::int[])
        AND COALESCE((pref.preferences->>'notifications')::boolean,true)=true`,
    [uniqueIds],
  );
  if (!result.rows.length) return { sent: 0, failed: 0, stale: 0 };
  const bearer = await accessToken();
  let sent = 0, failed = 0, stale = 0;
  for (const row of result.rows) {
    const pref = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
    const privatePreview = pref.lockScreenPreview === false;
    const safePath = /^\/(?:app|reunions|join)(?:\/|$)/.test(String(payload.url || '')) ? String(payload.url) : '/app/notifications';
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId())}/messages:send`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: row.token,
          notification: {
            title: privatePreview ? 'MBotéRoom' : String(payload.title || 'MBotéRoom').slice(0, 120),
            body: privatePreview ? 'Vous avez une nouvelle activité.' : String(payload.body || '').slice(0, 500),
          },
          data: { path: safePath },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: pref.notificationSounds === false ? 'mboteroom_silent' : 'mboteroom_updates',
              default_vibrate_timings: pref.vibration === true,
            },
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (response?.ok) { sent += 1; continue; }
    const error = await response?.json().catch(() => ({})) || {};
    const code = String(error?.error?.details?.find?.((item: any) => item?.errorCode)?.errorCode || '');
    if (code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && response?.status === 400)) {
      stale += 1;
      await query('DELETE FROM room_native_push_tokens WHERE id=$1', [row.id]).catch(() => undefined);
    } else {
      failed += 1;
      // Do not log FCM device registration tokens or service-account credentials.
      console.warn('[MBotéRoom FCM] delivery error', response?.status || 'network_error', code.slice(0, 48));
    }
  }
  return { sent, failed, stale };
};
