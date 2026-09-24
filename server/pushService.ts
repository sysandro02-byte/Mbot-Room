import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from 'node:crypto';
import { createId, query } from './core.js';
import { sendTransactionalEmail } from './emailDelivery.js';

type PushSubscriptionRecord = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  data?: Record<string, unknown>;
  silent?: boolean;
  vibrate?: number[];
};

const base64Url = (value: Buffer | string) =>
  Buffer.isBuffer(value)
    ? value.toString('base64url')
    : Buffer.from(value).toString('base64url');

const fromBase64Url = (value: string) => Buffer.from(value, 'base64url');

const hmac = (key: Buffer, data: Buffer) =>
  createHmac('sha256', key).update(data).digest();

const hkdfExpand = (prk: Buffer, info: Buffer, length: number) => {
  const first = hmac(prk, Buffer.concat([info, Buffer.from([1])]));
  return first.subarray(0, length);
};

const getVapidConfig = () => {
  const publicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:contacts@loukatech.com').trim();
  return { publicKey, privateKey, subject, configured: Boolean(publicKey && privateKey) };
};

export const getPushStatus = () => {
  const config = getVapidConfig();
  return {
    configured: config.configured,
    publicKey: config.configured ? config.publicKey : '',
    provider: config.configured ? 'web-push' : 'none',
  };
};

const createVapidAuthorization = (endpoint: string) => {
  const config = getVapidConfig();
  if (!config.configured) throw new Error('Web Push VAPID is not configured');

  const audienceUrl = new URL(endpoint);
  const audience = `${audienceUrl.protocol}//${audienceUrl.host}`;
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = base64Url(JSON.stringify({
    aud: audience,
    exp: now + 12 * 60 * 60,
    sub: config.subject,
  }));
  const signingInput = `${header}.${payload}`;

  const rawPublic = fromBase64Url(config.publicKey);
  const rawPrivate = fromBase64Url(config.privateKey);
  if (rawPublic.length !== 65 || rawPublic[0] !== 4 || rawPrivate.length !== 32) {
    throw new Error('Invalid VAPID key material');
  }
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64Url(rawPublic.subarray(1, 33)),
      y: base64Url(rawPublic.subarray(33, 65)),
      d: config.privateKey,
    },
    format: 'jwk',
  });
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const jwt = `${signingInput}.${base64Url(signature)}`;
  return `vapid t=${jwt}, k=${config.publicKey}`;
};

const encryptPayload = (subscription: PushSubscriptionRecord, payload: Buffer) => {
  const userPublicKey = fromBase64Url(subscription.keys.p256dh);
  const authSecret = fromBase64Url(subscription.keys.auth);
  if (userPublicKey.length !== 65 || userPublicKey[0] !== 4 || authSecret.length < 16) {
    throw new Error('Invalid push subscription keys');
  }

  const sender = createECDH('prime256v1');
  sender.generateKeys();
  const senderPublicKey = sender.getPublicKey();
  const sharedSecret = sender.computeSecret(userPublicKey);

  const prkKey = hmac(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKey,
    senderPublicKey,
  ]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const record = Buffer.concat([payload, Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  return Buffer.concat([
    salt,
    recordSize,
    Buffer.from([senderPublicKey.length]),
    senderPublicKey,
    ciphertext,
  ]);
};

const sendSubscription = async (subscription: PushSubscriptionRecord, payload: PushPayload) => {
  const body = encryptPayload(subscription, Buffer.from(JSON.stringify(payload)));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: createVapidAuthorization(subscription.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (response.ok || response.status === 201) return { ok: true, stale: false };
  if (response.status === 404 || response.status === 410) return { ok: false, stale: true };
  const detail = await response.text().catch(() => '');
  throw new Error(`Push endpoint rejected request (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
};

export const sendPushToUsers = async (userIds: number[], payload: PushPayload) => {
  const uniqueIds = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!uniqueIds.length || !getVapidConfig().configured) return { sent: 0, failed: 0, stale: 0 };

  const result = await query(
    `SELECT ps.id,ps.user_id,ps.endpoint,ps.p256dh,ps.auth,ps.expiration_time,
            COALESCE(pref.preferences,'{}'::jsonb) AS preferences
       FROM room_push_subscriptions ps
       LEFT JOIN room_user_preferences pref ON pref.user_id=ps.user_id
      WHERE ps.user_id = ANY($1::int[])
        AND COALESCE((pref.preferences->>'notifications')::boolean,true)=true`,
    [uniqueIds],
  );

  let sent = 0;
  let failed = 0;
  let stale = 0;
  for (const row of result.rows) {
    try {
      const preferences = row.preferences && typeof row.preferences === 'object' ? row.preferences : {};
      const privatePreview = preferences.lockScreenPreview === false;
      const notificationSounds = preferences.notificationSounds !== false;
      const vibration = preferences.vibration === true;
      const delivery = await sendSubscription({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
        expirationTime: row.expiration_time ? Number(row.expiration_time) : null,
      }, {
        ...payload,
        title: privatePreview ? 'MBotéRoom' : payload.title,
        body: privatePreview ? 'Vous avez une nouvelle activité.' : payload.body,
        silent: !notificationSounds,
        vibrate: vibration ? [120, 70, 120] : [],
      });
      if (delivery.ok) sent += 1;
      if (delivery.stale) {
        stale += 1;
        await query('DELETE FROM room_push_subscriptions WHERE id=$1', [row.id]);
      }
    } catch (error) {
      const message=error instanceof Error?error.message:String(error);
      if(message.includes('Invalid push subscription keys')){
        stale += 1;
        await query('DELETE FROM room_push_subscriptions WHERE id=$1',[row.id]).catch(()=>undefined);
        console.warn('[MBotéRoom push] removed invalid subscription:', row.id);
        continue;
      }
      failed += 1;
      console.warn('[MBotéRoom push] delivery failed:', message);
    }
  }
  return { sent, failed, stale };
};

export const createNotificationAndPush = async (
  userId: number,
  payload: PushPayload & { type: string },
) => {
  const id = createId();
  const data = { ...(payload.data || {}), url: payload.url || payload.data?.url || '/app/notifications' };
  const result = await query(
    `INSERT INTO room_notifications (id,user_id,type,title,body,data)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING *`,
    [id, userId, payload.type, payload.title, payload.body, JSON.stringify(data)],
  );
  const pushDelivery=await sendPushToUsers([userId], {
    title: payload.title,
    body: payload.body,
    url: String(data.url || '/app/notifications'),
    tag: payload.tag || payload.type,
    icon: payload.icon || '/icons/mbote-room-192.png',
    badge: payload.badge || '/icons/mbote-room-192.png',
    data,
  }).catch((error)=>{
    console.warn('[MBotéRoom push] delivery pipeline failed:',error instanceof Error?error.message:error);
    return {sent:0,failed:1,stale:0};
  });

  if (payload.type !== 'PUSH_TEST') {
    const recipient = await query(
      `SELECT u.email,COALESCE(pref.preferences,'{}'::jsonb) AS preferences
         FROM room_users u
         LEFT JOIN room_user_preferences pref ON pref.user_id=u.id
        WHERE u.id=$1 LIMIT 1`,
      [userId],
    ).catch(() => ({ rows: [] as any[] }));
    const row = recipient.rows[0];
    const emailEnabled = row?.preferences?.emailNotifications === true;
    const email = String(row?.email || '').trim();
    if (emailEnabled && email) {
      const appUrl = String(process.env.MBOTE_ROOM_APP_URL || '').replace(/\/+$/, '');
      const target = String(data.url || '/app/notifications');
      const link = appUrl && target.startsWith('/') ? appUrl + target : '';
      await sendTransactionalEmail({
        to: email,
        subject: `MBotéRoom · ${payload.title}`,
        text: [payload.title, payload.body, link].filter(Boolean).join('\n\n'),
      }).catch(() => false);
    }
  }
  const row = result.rows[0];
  return {
    ...row,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    readAt: row?.read_at ? new Date(row.read_at).toISOString() : null,
    pushDelivery,
  };
};
