import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// This suite targets the already deployed production services.
const frontendUrl = String(process.env.MBOTE_ROOM_FRONTEND_URL || 'https://mbote-room.vercel.app').replace(/\/+$/, '');
const backendUrl = String(process.env.MBOTE_ROOM_BACKEND_URL || 'https://mbote-room-api.onrender.com').replace(/\/+$/, '');
const appUrl = String(process.env.MBOTE_ROOM_SMOKE_APP_URL || backendUrl).replace(/\/+$/, '');
const runSuffix = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, Date.now()]
  .filter(Boolean)
  .join('-')
  .replace(/[^a-zA-Z0-9-]/g, '')
  .slice(-48) || String(Date.now());
const hostEmail = `prod.smoke.host+${runSuffix}@mbote.test`;
const guestName = `Invité Smoke ${runSuffix}`;
const password = 'MboteRoom-Smoke-2026!';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForFrontendPwa = async () => {
  const deadline = Date.now() + 5 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const [manifestResponse, workerResponse] = await Promise.all([
        fetch(`${frontendUrl}/manifest.webmanifest`, { cache: 'no-store' }),
        fetch(`${frontendUrl}/sw.js`, { cache: 'no-store' }),
      ]);
      const manifest = await manifestResponse.json().catch(() => null);
      const worker = await workerResponse.text().catch(() => '');
      last = JSON.stringify({
        manifestStatus: manifestResponse.status,
        workerStatus: workerResponse.status,
        display: manifest?.display,
        description: manifest?.description,
        workerLength: worker.length,
      });
      if (
        manifestResponse.ok
        && workerResponse.ok
        && manifest?.display === 'standalone'
        && Array.isArray(manifest?.shortcuts)
        && manifest.shortcuts.length >= 3
        && /LoukaTech/i.test(String(manifest?.description || ''))
        && /addEventListener\(['"]push['"]/i.test(worker)
        && /notificationclick/i.test(worker)
      ) {
        return { manifest, workerResponse };
      }
    } catch {}
    await sleep(5_000);
  }
  throw new Error(`Production frontend PWA did not reach the expected manifest/service worker. Last state: ${last || 'unavailable'}`);
};

const waitForProductionCommit = async () => {
  const expected = String(process.env.GITHUB_SHA || '').trim();
  if (!expected) return;
  const deadline = Date.now() + 8 * 60_000;
  let lastSeen = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendUrl}/api/health`, { headers: { Origin: frontendUrl } });
      const data = await response.json().catch(() => ({}));
      lastSeen = String(data?.deployment?.commit || '');
      if (response.ok && lastSeen === expected) return;
    } catch {}
    await sleep(5_000);
  }
  throw new Error(`Production backend did not reach commit ${expected}. Last deployed commit: ${lastSeen || 'unknown'}`);
};

const parseBody = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { text }; }
};

const api = async (path, options = {}, token = '') => {
  const response = await fetch(`${backendUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Origin: frontendUrl,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  return { response, data: await parseBody(response) };
};

const authBearer = { 'X-MBote-Room-Session-Mode': 'bearer' };

const waitForRemoteMedia = async (page, name, timeout = 35_000) => {
  await page.waitForFunction((participantName) => {
    const tiles = Array.from(document.querySelectorAll('.room-v2-tile'));
    const tile = tiles.find((candidate) => candidate.textContent?.includes(participantName) && !candidate.textContent?.includes('(vous)'));
    const video = tile?.querySelector('video');
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream)) return false;
    const tracks = stream.getTracks();
    return Boolean(
      video
      && !video.paused
      && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && tracks.some((track) => track.kind === 'video' && track.readyState === 'live')
      && tracks.some((track) => track.kind === 'audio' && track.readyState === 'live')
      && video.videoWidth > 0
      && video.videoHeight > 0
    );
  }, name, { timeout });
};

const openMeeting = async (browser, session, meetingId, label) => {
  const context = await browser.newContext({
    locale: 'fr-FR',
    permissions: ['camera', 'microphone'],
  });
  await context.grantPermissions(['camera', 'microphone'], { origin: appUrl });

  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
    localStorage.setItem('sessionExpiresAt', new Date(Date.now() + 2 * 60 * 60_000).toISOString());
  }, { user: session.user, token: session.token });

  await context.addInitScript(() => {
    window.__mboteSmokeIceCandidates = [];
    window.__mboteSmokePeerConnections = 0;
    const NativePeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class SmokePeerConnection extends NativePeerConnection {
      constructor(configuration = {}) {
        super({ ...configuration, iceTransportPolicy: 'relay' });
        window.__mboteSmokePeerConnections += 1;
        this.addEventListener('icecandidate', (event) => {
          const candidate = event.candidate?.candidate;
          if (candidate) window.__mboteSmokeIceCandidates.push(candidate);
        });
      }
    };
  });

  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon|ResizeObserver/i.test(message.text())) {
      browserErrors.push(message.text());
    }
  });

  await page.goto(`${appUrl}/reunions/${meetingId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  try {
    await page.locator('.room-v2-shell').waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      text: document.body?.innerText?.slice(0, 2000) || '',
    })).catch(() => ({ href: page.url(), title: '', text: '' }));
    throw new Error(`${label} meeting UI unavailable at exact production app: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
  return { context, page, browserErrors, label };
};

let browser;
let hostRoom;
let guestRoom;
let meeting = null;
let host = null;
let guest = null;

try {
  await waitForProductionCommit();

  const frontend = await fetch(frontendUrl, { redirect: 'follow' });
  assert.equal(frontend.ok, true, `Frontend HTTP ${frontend.status}`);
  assert.match(await frontend.text(), /MBot[eé]Room|MBot[eé] Room/i);
  const pwa = await waitForFrontendPwa();
  assert.match(String(pwa.workerResponse.headers.get('cache-control') || ''), /no-cache|no-store|max-age=0/i);

  const health = await api('/api/health');
  assert.equal(health.response.status, 200, JSON.stringify(health.data));
  assert.equal(health.data.ok, true);
  assert.equal(health.data.database?.type, 'postgres');
  assert.equal(health.data.database?.connected, true);
  assert.equal(health.data.readiness?.productionReady, true);
  assert.equal(health.data.readiness?.integrations?.turn, true);
  assert.equal(health.data.readiness?.integrations?.groq, true);
  assert.equal(health.data.readiness?.integrations?.email, true);
  assert.equal(health.data.readiness?.integrations?.push, true);

  const authPreflight = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: frontendUrl,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-mbote-room-session-mode',
    },
  });
  assert.equal(authPreflight.status, 204);
  assert.equal(authPreflight.headers.get('access-control-allow-origin'), frontendUrl);
  assert.match(authPreflight.headers.get('access-control-allow-headers') || '', /X-MBote-Room-Session-Mode/i);

  const previewOrigin = 'https://mbote-room-production-smoke.vercel.app';
  const previewPreflight = await fetch(`${backendUrl}/api/auth/register`, {
    method: 'OPTIONS',
    headers: {
      Origin: previewOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-mbote-room-session-mode',
    },
  });
  assert.equal(previewPreflight.status, 204);
  assert.equal(previewPreflight.headers.get('access-control-allow-origin'), previewOrigin);

  const officialOrigin = 'https://mboteroom.loukatech.com';
  const officialPreflight = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: officialOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-mbote-room-session-mode',
    },
  });
  assert.equal(officialPreflight.status, 204);
  assert.equal(officialPreflight.headers.get('access-control-allow-origin'), officialOrigin);

  const unrelatedPreflight = await fetch(`${backendUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://not-mbote-room.vercel.app',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(unrelatedPreflight.status, 403);

  const register = await api('/api/auth/register', {
    method: 'POST',
    headers: authBearer,
    body: JSON.stringify({
      name: `Hôte Smoke ${runSuffix}`,
      email: hostEmail,
      password,
      country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true,
      termsVersion: '2026-09-24',
    }),
  });
  assert.equal(register.response.status, 201, JSON.stringify(register.data));
  assert.ok(register.data.token);
  host = register.data;

  const pushConfig = await api('/api/push/config', {}, host.token);
  assert.equal(pushConfig.response.status, 200, JSON.stringify(pushConfig.data));
  assert.equal(pushConfig.data.configured, true);
  assert.ok(String(pushConfig.data.publicKey || '').length > 40);

  const fakeEndpoint = `https://push.invalid/${runSuffix}`;
  const subscribe = await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: fakeEndpoint,
      expirationTime: null,
      keys: {
        p256dh: 'BHVz0gL-lqNhWjE1mY9zMxhUGzxwXxPlQ-bq6mYE7hehzU4SJt0PqY1tv-fake-smoke-key',
        auth: 'c21va2UtYXV0aC1rZXk',
      },
      platform: 'production-smoke',
    }),
  }, host.token);
  assert.equal(subscribe.response.status, 201, JSON.stringify(subscribe.data));
  const pushTest = await api('/api/push/test', { method: 'POST' }, host.token);
  assert.equal(pushTest.response.status, 200, JSON.stringify(pushTest.data));
  const unsubscribe = await api('/api/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: fakeEndpoint }),
  }, host.token);
  assert.equal(unsubscribe.response.status, 200, JSON.stringify(unsubscribe.data));

  const created = await api('/api/meetings', {
    method: 'POST',
    body: JSON.stringify({
      title: `Smoke production ${runSuffix}`,
      description: 'Validation réelle frontend Vercel + backend Render + PostgreSQL Supabase + TURN + Luna',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 30,
      settings: {
        password,
        waitingRoom: true,
        participantAudio: true,
        participantVideo: true,
        chat: true,
        reactions: true,
        screenShare: true,
        lunaSummary: true,
        externalAccess: true,
        joinBeforeHost: false,
      },
    }),
  }, host.token);
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  meeting = created.data;
  assert.ok(meeting.id);
  assert.ok(meeting.meeting_link);

  const guestJoin = await api('/api/auth/guest-join', {
    method: 'POST',
    headers: authBearer,
    body: JSON.stringify({
      name: guestName,
      meetingCode: meeting.meeting_link,
      password,
      country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true,
      termsVersion: '2026-09-24',
    }),
  });
  assert.equal(guestJoin.response.status, 201, JSON.stringify(guestJoin.data));
  assert.equal(guestJoin.data.lobbyStatus, 'requested');
  assert.ok(guestJoin.data.token);
  guest = guestJoin.data;

  const lobby = await api(`/api/meetings/${meeting.id}/lobby`, {}, host.token);
  assert.equal(lobby.response.status, 200, JSON.stringify(lobby.data));
  assert.ok(lobby.data.some((item) => Number(item.user_id) === Number(guest.user.id) && item.status === 'requested'));

  const admit = await api(`/api/meetings/${meeting.id}/lobby/respond`, {
    method: 'POST',
    body: JSON.stringify({ userId: Number(guest.user.id), status: 'accepted' }),
  }, host.token);
  assert.equal(admit.response.status, 200, JSON.stringify(admit.data));
  assert.equal(admit.data.success, true);

  const participants = await api(`/api/meetings/${meeting.id}/participants`, {}, host.token);
  assert.equal(participants.response.status, 200, JSON.stringify(participants.data));
  assert.ok(participants.data.some((item) => Number(item.userId) === Number(guest.user.id) && item.status === 'accepted'));

  const rtcConfig = await api('/api/rtc/config', {}, host.token);
  assert.equal(rtcConfig.response.status, 200, JSON.stringify(rtcConfig.data));
  assert.equal(rtcConfig.data.turnConfigured, true);
  assert.ok(Array.isArray(rtcConfig.data.iceServers));
  assert.ok(rtcConfig.data.iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => String(url).startsWith('turn:') || String(url).startsWith('turns:'));
  }));

  const start = await api(`/api/meetings/${meeting.id}/start-notify`, {
    method: 'POST',
  }, host.token);
  assert.equal(start.response.status, 200, JSON.stringify(start.data));

  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  hostRoom = await openMeeting(browser, host, meeting.id, 'host');
  guestRoom = await openMeeting(browser, guest, meeting.id, 'guest');

  await Promise.all([
    waitForRemoteMedia(hostRoom.page, guestName),
    waitForRemoteMedia(guestRoom.page, host.user.name),
  ]);

  await Promise.all([
    hostRoom.page.waitForFunction(() => (window.__mboteSmokeIceCandidates || []).some((value) => /\btyp relay\b/.test(value)), undefined, { timeout: 30_000 }),
    guestRoom.page.waitForFunction(() => (window.__mboteSmokeIceCandidates || []).some((value) => /\btyp relay\b/.test(value)), undefined, { timeout: 30_000 }),
  ]);

  const relayDiagnostics = {
    host: await hostRoom.page.evaluate(() => ({
      peerConnections: window.__mboteSmokePeerConnections || 0,
      relayCandidates: (window.__mboteSmokeIceCandidates || []).filter((value) => /\btyp relay\b/.test(value)).length,
    })),
    guest: await guestRoom.page.evaluate(() => ({
      peerConnections: window.__mboteSmokePeerConnections || 0,
      relayCandidates: (window.__mboteSmokeIceCandidates || []).filter((value) => /\btyp relay\b/.test(value)).length,
    })),
  };
  assert.ok(relayDiagnostics.host.peerConnections > 0);
  assert.ok(relayDiagnostics.guest.peerConnections > 0);
  assert.ok(relayDiagnostics.host.relayCandidates > 0);
  assert.ok(relayDiagnostics.guest.relayCandidates > 0);

  const guestChat = await api(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Ce message invité doit rester bloqué par défaut.' }),
  }, guest.token);
  assert.equal(guestChat.response.status, 403, JSON.stringify(guestChat.data));
  assert.equal(guestChat.data.code, 'GUEST_CHAT_DISABLED');

  const hostChat = await api(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Décision smoke: le test TURN et WebRTC de production est validé.' }),
  }, host.token);
  assert.equal(hostChat.response.status, 201, JSON.stringify(hostChat.data));

  const luna = await api('/api/ai/luna', {
    method: 'POST',
    body: JSON.stringify({
      meetingId: Number(meeting.id),
      prompt: 'Confirme en une phrase que tu peux répondre dans cette réunion de test.',
    }),
  }, host.token);
  assert.equal(luna.response.status, 200, JSON.stringify(luna.data));
  assert.equal(luna.data.configured, true);
  assert.ok(String(luna.data.answer || '').trim().length > 0);

  const summary = await api(`/api/meetings/${meeting.id}/summary/generate`, {
    method: 'POST',
  }, host.token);
  assert.equal(summary.response.status, 200, JSON.stringify(summary.data));
  assert.ok(Array.isArray(summary.data.bullets));
  assert.ok(Array.isArray(summary.data.decisions));
  assert.ok(Array.isArray(summary.data.actions));

  const ended = await api(`/api/meetings/${meeting.id}/end`, {
    method: 'POST',
  }, host.token);
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.success, true);
  assert.equal(ended.data.meeting?.status, 'ended');

  assert.deepEqual(hostRoom.browserErrors, [], `Host browser errors: ${hostRoom.browserErrors.join('\n')}`);
  assert.deepEqual(guestRoom.browserErrors, [], `Guest browser errors: ${guestRoom.browserErrors.join('\n')}`);

  console.log('PRODUCTION_SMOKE_RESULT', JSON.stringify({
    ok: true,
    frontendUrl,
    backendUrl,
    appUrl,
    meetingId: meeting.id,
    meetingLink: meeting.meeting_link,
    hostEmail,
    hostUserId: host.user.id,
    guestUserId: guest.user.id,
    relayDiagnostics,
    lunaConfigured: true,
    summaryGenerated: true,
    pushConfigured: true,
    pwaVerified: true,
    meetingEnded: true,
  }));
} finally {
  await guestRoom?.context?.close().catch(() => undefined);
  await hostRoom?.context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);

  if (meeting?.id && host?.token) {
    await api(`/api/meetings/${meeting.id}`, { method: 'DELETE' }, host.token).catch(() => undefined);
  }

  console.log('PRODUCTION_SMOKE_CLEANUP', JSON.stringify({
    meetingId: meeting?.id || null,
    hostEmail,
    hostUserId: host?.user?.id || null,
    guestUserId: guest?.user?.id || null,
  }));

  await sleep(250);
}
