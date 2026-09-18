import crypto from 'node:crypto';
import type express from 'express';
import { AuthedRequest, authenticateToken, requireDatabase } from './core.js';

const splitUrls = (value: string | undefined) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

export const registerRtcRoutes = (app: express.Express) => {
  app.get('/api/rtc/config', requireDatabase, authenticateToken, (request: AuthedRequest, response) => {
    const stunUrls = splitUrls(process.env.STUN_URLS);
    const turnUrls = splitUrls(process.env.TURN_URLS);
    const sharedSecret = String(process.env.TURN_SHARED_SECRET || '').trim();
    const ttlSeconds = Math.max(300, Math.min(86400, Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600)));

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: stunUrls.length ? stunUrls : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ];

    let turnConfigured = false;
    let expiresAt: string | null = null;

    if (turnUrls.length && sharedSecret && request.user) {
      const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
      const username = `${expires}:${request.user.id}`;
      const credential = crypto.createHmac('sha1', sharedSecret).update(username).digest('base64');
      iceServers.push({ urls: turnUrls, username, credential });
      turnConfigured = true;
      expiresAt = new Date(expires * 1000).toISOString();
    }

    response.setHeader('Cache-Control', 'no-store');
    response.json({
      iceServers,
      iceCandidatePoolSize: 6,
      turnConfigured,
      expiresAt,
    });
  });
};
