import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
const password = 'MbR!'+randomBytes(18).toString('base64url')+'9a';

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

const deployedContainsExpectedCommit = (expected, deployed) => {
  if (!expected || !deployed) return false;
  if (expected === deployed) return true;
  if (!/^[0-9a-f]{40}$/i.test(expected) || !/^[0-9a-f]{40}$/i.test(deployed)) return false;
  try {
    execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', deployed], {
      stdio: 'ignore',
      timeout: 30_000,
    });
  } catch {
    try {
      execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', 'main'], {
        stdio: 'ignore',
        timeout: 30_000,
      });
    } catch {}
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', expected, deployed], {
      stdio: 'ignore',
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
};

const waitForProductionCommit = async () => {
  const expected = String(process.env.GITHUB_SHA || '').trim();
  if (!expected) return;
  const deadline = Date.now() + 8 * 60_000;
  let lastSeen = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendUrl}/api/health`, { headers: { Origin: frontendUrl }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      lastSeen = String(data?.deployment?.commit || '').trim();
      if (response.ok && deployedContainsExpectedCommit(expected, lastSeen)) {
        console.log('PRODUCTION_COMMIT_READY', JSON.stringify({
          expected,
          deployed: lastSeen,
          exact: expected === lastSeen,
        }));
        return;
      }
    } catch {}
    await sleep(5_000);
  }
  throw new Error(`Production backend did not reach commit ${expected} or a newer descendant. Last deployed commit: ${lastSeen || 'unknown'}`);
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
    await page.locator('.room-v2-shell').waitFor({ state: 'attached', timeout: 30_000 });
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
  const invalidSubscribe = await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: fakeEndpoint,
      expirationTime: null,
      keys: {
        p256dh: 'invalid-smoke-key',
        auth: 'invalid-auth',
      },
      platform: 'production-smoke',
    }),
  }, host.token);
  assert.equal(invalidSubscribe.response.status, 400, JSON.stringify(invalidSubscribe.data));

  const validShapeEndpoint = `https://push.invalid/shape/${runSuffix}`;
  const subscribe = await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: validShapeEndpoint,
      expirationTime: null,
      keys: {
        p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'),
        auth: Buffer.alloc(16, 2).toString('base64url'),
      },
      platform: 'production-smoke',
    }),
  }, host.token);
  assert.equal(subscribe.response.status, 201, JSON.stringify(subscribe.data));
  const unsubscribe = await api('/api/push/subscribe', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint: validShapeEndpoint }),
  }, host.token);
  assert.equal(unsubscribe.response.status, 200, JSON.stringify(unsubscribe.data));

  const pushTest = await api('/api/push/test', { method: 'POST' }, host.token);
  assert.equal(pushTest.response.status, 409, JSON.stringify(pushTest.data));

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

  const mediaStatus = await api('/api/media/status');
  assert.equal(mediaStatus.response.status, 200, JSON.stringify(mediaStatus.data));
  assert.ok(['mesh', 'livekit'].includes(String(mediaStatus.data.preferredMode || '')));
  if (mediaStatus.data.preferredMode === 'livekit') assert.equal(mediaStatus.data.livekitReady, true);
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

  if (mediaStatus.data.preferredMode === 'mesh') {
    await Promise.all([
      hostRoom.page.waitForFunction(() => (window.__mboteSmokeIceCandidates || []).some((value) => /\btyp relay\b/.test(value)), undefined, { timeout: 30_000 }),
      guestRoom.page.waitForFunction(() => (window.__mboteSmokeIceCandidates || []).some((value) => /\btyp relay\b/.test(value)), undefined, { timeout: 30_000 }),
    ]);
  }

  const relayDiagnostics = {
    transport: mediaStatus.data.preferredMode,
    host: await hostRoom.page.evaluate(() => ({
      peerConnections: window.__mboteSmokePeerConnections || 0,
      relayCandidates: (window.__mboteSmokeIceCandidates || []).filter((value) => /\btyp relay\b/.test(value)).length,
    })),
    guest: await guestRoom.page.evaluate(() => ({
      peerConnections: window.__mboteSmokePeerConnections || 0,
      relayCandidates: (window.__mboteSmokeIceCandidates || []).filter((value) => /\btyp relay\b/.test(value)).length,
    })),
  };
  console.log('PRODUCTION_MEDIA_DIAGNOSTICS', JSON.stringify(relayDiagnostics));
  assert.ok(relayDiagnostics.host.peerConnections > 0);
  assert.ok(relayDiagnostics.guest.peerConnections > 0);
  if (mediaStatus.data.preferredMode === 'mesh') {
    assert.ok(relayDiagnostics.host.relayCandidates > 0);
    assert.ok(relayDiagnostics.guest.relayCandidates > 0);
  } else {
    assert.equal(mediaStatus.data.livekitReady, true);
  }

  const guestChat = await api(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Ce message invité doit rester bloqué par défaut.' }),
  }, guest.token);
  assert.equal(guestChat.response.status, 403, JSON.stringify(guestChat.data));
  assert.equal(guestChat.data.code, 'GUEST_CHAT_DISABLED');

  const guestControlDisabled = async (label) => guestRoom.page.locator('button.room-v2-control').filter({ hasText: label }).first().isDisabled();
  assert.equal(await guestControlDisabled('Partager'), true, 'Guest screen share must be disabled before promotion');
  assert.equal(await guestControlDisabled('Main'), true, 'Guest hand raise must be disabled before promotion');
  assert.equal(await guestControlDisabled('Enregistrer'), true, 'Guest recording must be disabled before promotion');

  const promoteGuest = await api(`/api/meetings/${meeting.id}/participants/${guest.user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'cohost' }),
  }, host.token);
  assert.equal(promoteGuest.response.status, 200, JSON.stringify(promoteGuest.data));
  assert.equal(promoteGuest.data.role, 'cohost');

  await guestRoom.page.waitForFunction(() => {
    const labels = ['Partager', 'Main', 'Enregistrer'];
    const controls = [...document.querySelectorAll('button.room-v2-control')];
    return labels.every((label) => controls.some((button) => button.textContent?.includes(label) && !button.disabled));
  }, undefined, { timeout: 15_000 });

  const elevatedGuestChat = await api(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Message co-hôte invité: les droits élevés sont actifs.' }),
  }, guest.token);
  assert.equal(elevatedGuestChat.response.status, 201, JSON.stringify(elevatedGuestChat.data));

  const elevatedGuestLuna = await api('/api/ai/luna', {
    method: 'POST',
    body: JSON.stringify({
      meetingId: Number(meeting.id),
      prompt: 'Réponds uniquement: droits co-hôte actifs.',
    }),
  }, guest.token);
  assert.equal(elevatedGuestLuna.response.status, 200, JSON.stringify(elevatedGuestLuna.data));

  const guestHandControl = guestRoom.page.locator('button.room-v2-control').filter({ hasText: 'Main' }).first();
  await guestHandControl.click();
  await guestRoom.page.locator('button.room-v2-control').filter({ hasText: 'Baisser la main' }).first().waitFor({ state: 'visible', timeout: 10_000 });

  await hostRoom.page.getByTestId('participants-view-button').click();
  const hostGuestRow = hostRoom.page.locator('.room-v2-rail-participants article').filter({ hasText: guestName }).first();
  await hostGuestRow.waitFor({ state: 'visible', timeout: 10_000 });
  await hostGuestRow.locator('.room-v2-rail-hand').waitFor({ state: 'visible', timeout: 10_000 });

  await guestRoom.page.locator('button.room-v2-control').filter({ hasText: 'Baisser la main' }).first().click();
  await hostGuestRow.locator('.room-v2-rail-hand').waitFor({ state: 'hidden', timeout: 10_000 });

  const demoteGuest = await api(`/api/meetings/${meeting.id}/participants/${guest.user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'participant' }),
  }, host.token);
  assert.equal(demoteGuest.response.status, 200, JSON.stringify(demoteGuest.data));
  assert.equal(demoteGuest.data.role, 'participant');

  await guestRoom.page.waitForFunction(() => {
    const labels = ['Partager', 'Main', 'Enregistrer'];
    const controls = [...document.querySelectorAll('button.room-v2-control')];
    return labels.every((label) => controls.some((button) => button.textContent?.includes(label) && button.disabled));
  }, undefined, { timeout: 15_000 });

  const demotedGuestChat = await api(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: 'Ce message doit être rebloqué après révocation.' }),
  }, guest.token);
  assert.equal(demotedGuestChat.response.status, 403, JSON.stringify(demotedGuestChat.data));
  assert.equal(demotedGuestChat.data.code, 'GUEST_CHAT_DISABLED');

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

  await guestRoom.page.locator('button.room-v2-leave').click();
  const guestLeaveModal = guestRoom.page.locator('.room-v2-confirm-modal');
  await guestLeaveModal.waitFor({ state: 'visible', timeout: 10_000 });
  await guestLeaveModal.getByRole('button', { name: 'Quitter la réunion' }).click();
  await guestRoom.page.waitForURL((url) => url.pathname === '/reunions', { timeout: 15_000 });

  await hostRoom.page.locator('button.room-v2-control').filter({ hasText: 'Plus' }).first().click();
  await hostRoom.page.getByTestId('end-meeting-for-all').click();
  const hostEndModal = hostRoom.page.locator('.room-v2-confirm-modal');
  await hostEndModal.waitFor({ state: 'visible', timeout: 10_000 });
  await hostEndModal.getByRole('button', { name: 'Terminer pour tous' }).click();
  await hostRoom.page.waitForURL((url) => /\/reunions\/[^/]+\/terminee$/.test(url.pathname), { timeout: 20_000 });

  const ended = await api(`/api/meetings/${meeting.id}/ended`, {}, host.token);
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.status, 'ended');

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
    leaveButtonVerified: true,
    endForAllButtonVerified: true,
    raisedHandBroadcastVerified: true,
    guestModeratorPromotionVerified: true,
    guestModeratorRevocationVerified: true,
  }));
} finally {
  await guestRoom?.context?.close().catch(() => undefined);
  await hostRoom?.context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);

  if (meeting?.id && host?.token) {
    await api(`/api/meetings/${meeting.id}`, { method: 'DELETE' }, host.token).catch(() => undefined);
  }
  if (host?.token) {
    await api('/api/auth/test-account-cleanup', {
      method: 'DELETE',
      body: JSON.stringify({ guestUserId: guest?.user?.id || null }),
    }, host.token).catch(() => undefined);
  }

  console.log('PRODUCTION_SMOKE_CLEANUP', JSON.stringify({
    meetingId: meeting?.id || null,
    hostEmail,
    hostUserId: host?.user?.id || null,
    guestUserId: guest?.user?.id || null,
  }));

  await sleep(250);
}
