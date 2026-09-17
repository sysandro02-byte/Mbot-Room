import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { chromium } from '@playwright/test';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required for the video meeting test');

const port = Number(process.env.MBOTE_ROOM_VIDEO_TEST_PORT || 4317);
const baseUrl = `http://127.0.0.1:${port}`;
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false });
await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
await pool.end();

const server = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    PGSSLMODE: 'disable',
    MBOTE_ROOM_ALLOWED_ORIGINS: baseUrl,
    MBOTE_ROOM_APP_URL: baseUrl,
    ADMIN_EMAILS: '',
    RESEND_API_KEY: '',
    GROQ_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
let serverExit = null;
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.on('error', (error) => { serverOutput += `\nSpawn error: ${error.message}`; });
server.on('exit', (code, signal) => { serverExit = { code, signal }; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverExit) throw new Error(`Server exited early: ${JSON.stringify(serverExit)}\n${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await sleep(150);
  }
  throw new Error(`Server unavailable at ${baseUrl}.\n${serverOutput}`);
};

const jsonRequest = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { text }; }
  }
  return { response, data };
};

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

const register = async (name, email) => {
  const result = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password: 'Password2026!' }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data;
};

const openAuthenticatedMeeting = async (browser, session, meetingId) => {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    locale: 'fr-FR',
  });
  await context.grantPermissions(['camera', 'microphone'], { origin: baseUrl });
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
  }, { user: session.user, token: session.token });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  await page.goto(`${baseUrl}/reunions/${meetingId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.room-v2-shell').waitFor({ state: 'visible', timeout: 20_000 });
  return { context, page, browserErrors };
};

const waitForRemoteMedia = async (page, participantName, timeout = 25_000) => {
  await page.waitForFunction((name) => {
    const tiles = Array.from(document.querySelectorAll('.room-v2-tile'));
    const tile = tiles.find((candidate) => candidate.textContent?.includes(name) && !candidate.textContent?.includes('(vous)'));
    if (!tile) return false;
    const video = tile.querySelector('video');
    const stream = video?.srcObject;
    if (!(stream instanceof MediaStream)) return false;
    const tracks = stream.getTracks();
    const videoTrack = tracks.find((track) => track.kind === 'video');
    const audioTrack = tracks.find((track) => track.kind === 'audio');
    return Boolean(video && !video.paused && videoTrack?.readyState === 'live' && audioTrack?.readyState === 'live' && video.videoWidth > 0 && video.videoHeight > 0);
  }, participantName, { timeout });
};

const waitForRemoteCameraState = async (page, participantName, enabled, timeout = 15_000) => {
  await page.waitForFunction(({ name, expected }) => {
    const tiles = Array.from(document.querySelectorAll('.room-v2-tile'));
    const tile = tiles.find((candidate) => candidate.textContent?.includes(name) && !candidate.textContent?.includes('(vous)'));
    if (!tile) return false;
    return Boolean(tile.querySelector('video')) === expected;
  }, { name: participantName, expected: enabled }, { timeout });
};

const waitForRemoteMicState = async (page, participantName, muted, timeout = 15_000) => {
  await page.waitForFunction(({ name, expectedMuted }) => {
    const tiles = Array.from(document.querySelectorAll('.room-v2-tile'));
    const tile = tiles.find((candidate) => candidate.textContent?.includes(name) && !candidate.textContent?.includes('(vous)'));
    if (!tile) return false;
    return Boolean(tile.querySelector('[aria-label="Micro coupé"]')) === expectedMuted;
  }, { name: participantName, expectedMuted: muted }, { timeout });
};

const clickControl = async (page, label) => {
  const button = page.locator('.room-v2-control').filter({ hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
};

let browser;
let hostContext;
let participantContext;

try {
  await waitForServer();

  const host = await register('Hôte Vidéo', 'host.video@mbote.test');
  const participant = await register('Participant Vidéo', 'participant.video@mbote.test');

  const created = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'Réunion vidéo automatisée',
      description: 'Deux navigateurs Chromium avec caméra et micro simulés',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 30,
      settings: {
        password: 'VideoRoom2026!',
        waitingRoom: false,
        chat: true,
        reactions: true,
        screenShare: true,
        joinBeforeHost: false,
        lunaSummary: false,
      },
    }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const meeting = created.data;

  const join = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ password: 'VideoRoom2026!' }),
  });
  assert.equal(join.response.status, 200, JSON.stringify(join.data));
  assert.equal(join.data.status, 'accepted');

  const start = await jsonRequest(`/api/meetings/${meeting.id}/start-notify`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
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

  const hostRoom = await openAuthenticatedMeeting(browser, host, meeting.id);
  hostContext = hostRoom.context;
  const participantRoom = await openAuthenticatedMeeting(browser, participant, meeting.id);
  participantContext = participantRoom.context;

  await Promise.all([
    waitForRemoteMedia(hostRoom.page, 'Participant Vidéo'),
    waitForRemoteMedia(participantRoom.page, 'Hôte Vidéo'),
  ]);

  await clickControl(participantRoom.page, 'Caméra');
  await waitForRemoteCameraState(hostRoom.page, 'Participant Vidéo', false);
  await clickControl(participantRoom.page, 'Caméra');
  await waitForRemoteMedia(hostRoom.page, 'Participant Vidéo');

  await clickControl(participantRoom.page, 'Micro');
  await waitForRemoteMicState(hostRoom.page, 'Participant Vidéo', true);
  await clickControl(participantRoom.page, 'Micro');
  await waitForRemoteMicState(hostRoom.page, 'Participant Vidéo', false);

  await participantContext.setOffline(true);
  await hostRoom.page.waitForFunction(() => {
    return !Array.from(document.querySelectorAll('.room-v2-tile')).some((tile) => tile.textContent?.includes('Participant Vidéo'));
  }, undefined, { timeout: 15_000 });
  await participantContext.setOffline(false);

  await Promise.all([
    waitForRemoteMedia(hostRoom.page, 'Participant Vidéo', 30_000),
    waitForRemoteMedia(participantRoom.page, 'Hôte Vidéo', 30_000),
  ]);

  const persisted = await jsonRequest(`/api/meetings/${meeting.id}/participants`, { headers: authHeaders(host.token) });
  assert.equal(persisted.response.status, 200, JSON.stringify(persisted.data));
  assert.ok(persisted.data.some((item) => Number(item.userId) === Number(participant.user.id) && item.status === 'accepted'));

  await mkdir('test-artifacts', { recursive: true });
  await hostRoom.page.screenshot({ path: 'test-artifacts/video-host.png', fullPage: true });
  await participantRoom.page.screenshot({ path: 'test-artifacts/video-participant.png', fullPage: true });

  assert.deepEqual(hostRoom.browserErrors, [], `Host browser errors: ${hostRoom.browserErrors.join('\n')}`);
  assert.deepEqual(participantRoom.browserErrors, [], `Participant browser errors: ${participantRoom.browserErrors.join('\n')}`);

  console.log('Two-browser camera + microphone + reconnect video meeting checks passed.');
} finally {
  await participantContext?.close().catch(() => undefined);
  await hostContext?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (!server.killed) server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
}
