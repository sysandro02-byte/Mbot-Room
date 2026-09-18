import assert from 'node:assert/strict';
import { mkdir, stat } from 'node:fs/promises';
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
    MEDIA_TRANSPORT: 'livekit',
    LIVEKIT_URL: 'wss://livekit.video.test.invalid',
    LIVEKIT_API_KEY: 'video-test-key',
    LIVEKIT_API_SECRET: 'video-test-secret',
    LIVEKIT_TOKEN_TTL_SECONDS: '900',
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

const openAuthenticatedMeeting = async (browser, session, meetingId, label) => {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    locale: 'fr-FR',
  });
  await context.grantPermissions(['camera', 'microphone'], { origin: baseUrl });
  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
  }, { user: session.user, token: session.token });
  await context.addInitScript(() => {
    class FailingLiveKitRoom {
      remoteParticipants = new Map();
      activeSpeakers = [];
      localParticipant = {
        trackPublications: new Map(),
        publishTrack: async () => ({ isMuted: false }),
        unpublishTrack: async () => undefined,
      };
      listeners = new Map();
      on(event, listener) {
        const values = this.listeners.get(event) || [];
        values.push(listener);
        this.listeners.set(event, values);
        return this;
      }
      off(event, listener) {
        const values = this.listeners.get(event) || [];
        this.listeners.set(event, values.filter((value) => value !== listener));
        return this;
      }
      async connect() {
        throw new Error('CI LiveKit intentionally unavailable');
      }
      async disconnect() {}
    }
    window.LivekitClient = {
      Room: FailingLiveKitRoom,
      RoomEvent: {
        TrackSubscribed: 'trackSubscribed',
        TrackUnsubscribed: 'trackUnsubscribed',
        TrackMuted: 'trackMuted',
        TrackUnmuted: 'trackUnmuted',
        ParticipantConnected: 'participantConnected',
        ParticipantDisconnected: 'participantDisconnected',
        ParticipantMetadataChanged: 'participantMetadataChanged',
        ActiveSpeakersChanged: 'activeSpeakersChanged',
        Disconnected: 'disconnected',
        Reconnecting: 'reconnecting',
        Reconnected: 'reconnected',
      },
      Track: {
        Kind: { Audio: 'audio', Video: 'video' },
        Source: {
          Camera: 'camera',
          Microphone: 'microphone',
          ScreenShare: 'screen_share',
          ScreenShareAudio: 'screen_share_audio',
        },
      },
    };
  });

  await context.addInitScript(({ transcript }) => {
    class TestSpeechRecognition {
      continuous = true;
      interimResults = true;
      lang = 'fr-FR';
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      started = false;
      start() {
        if (this.started) return;
        this.started = true;
        setTimeout(() => {
          if (!this.started || !this.onresult) return;
          this.onresult({
            resultIndex: 0,
            results: {
              0: { isFinal: true, 0: { transcript }, length: 1 },
              length: 1,
            },
          });
        }, 350);
      }
      stop() {
        this.started = false;
        this.onend?.();
      }
      abort() {
        this.started = false;
      }
    }
    window.SpeechRecognition = TestSpeechRecognition;
    window.webkitSpeechRecognition = TestSpeechRecognition;
  }, { transcript: `Sous-titre automatique ${label}` });

  await context.addInitScript(() => {
    if (!navigator.mediaDevices) return;
    const fakeDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      let frame = 0;
      const draw = () => {
        if (!ctx) return;
        ctx.fillStyle = frame % 2 ? '#1e3a8a' : '#172554';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.font = '48px sans-serif';
        ctx.fillText('MBotéRoom partage écran CI', 80, 120);
        frame += 1;
      };
      draw();
      const timer = setInterval(draw, 250);
      const stream = canvas.captureStream(15);
      stream.getVideoTracks()[0]?.addEventListener('ended', () => clearInterval(timer), { once: true });
      return stream;
    };
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: fakeDisplayMedia });
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on('pageerror', (error) => {
    browserErrors.push(error.message);
    console.error(`[${label}:pageerror] ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      browserErrors.push(message.text());
      console.error(`[${label}:console] ${message.text()}`);
    }
  });
  await page.goto(`${baseUrl}/reunions/${meetingId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.room-v2-shell').waitFor({ state: 'visible', timeout: 20_000 });
  return { context, page, browserErrors, label };
};

const mediaDiagnostics = async (page) => page.evaluate(() => ({
  href: location.href,
  bodyText: document.body.innerText.slice(0, 2500),
  tiles: Array.from(document.querySelectorAll('.room-v2-tile')).map((tile) => {
    const video = tile.querySelector('video');
    const stream = video?.srcObject;
    return {
      text: tile.textContent?.replace(/\s+/g, ' ').trim(),
      hasVideo: Boolean(video),
      paused: video?.paused ?? null,
      readyState: video?.readyState ?? null,
      networkState: video?.networkState ?? null,
      videoWidth: video?.videoWidth ?? null,
      videoHeight: video?.videoHeight ?? null,
      stream: stream instanceof MediaStream ? {
        active: stream.active,
        tracks: stream.getTracks().map((track) => ({
          id: track.id,
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      } : null,
    };
  }),
}));

const waitForRemoteMedia = async (page, participantName, timeout = 25_000) => {
  try {
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
      return Boolean(
        video
        && !video.paused
        && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && videoTrack?.readyState === 'live'
        && audioTrack?.readyState === 'live'
        && video.videoWidth > 0
        && video.videoHeight > 0
      );
    }, participantName, { timeout });
  } catch (error) {
    const snapshot = await mediaDiagnostics(page).catch((cause) => ({ diagnosticsError: String(cause) }));
    console.error(`MEDIA_DIAGNOSTICS ${participantName}: ${JSON.stringify(snapshot, null, 2)}`);
    throw error;
  }
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
let participantTwoContext;
let hostRoom;
let participantRoom;
let participantTwoRoom;

try {
  await waitForServer();

  const host = await register('Hôte Vidéo', 'host.video@mbote.test');
  const participant = await register('Participant Vidéo', 'participant.video@mbote.test');
  const participantTwo = await register('Participant Deux', 'participant.two@mbote.test');

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
  assert.equal(join.data.status, 'requested');

  const joinTwo = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(participantTwo.token),
    body: JSON.stringify({ password: 'VideoRoom2026!' }),
  });
  assert.equal(joinTwo.response.status, 200, JSON.stringify(joinTwo.data));
  assert.equal(joinTwo.data.status, 'requested');

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

  hostRoom = await openAuthenticatedMeeting(browser, host, meeting.id, 'host');
  hostContext = hostRoom.context;
  participantRoom = await openAuthenticatedMeeting(browser, participant, meeting.id, 'participant');
  participantContext = participantRoom.context;
  participantTwoRoom = await openAuthenticatedMeeting(browser, participantTwo, meeting.id, 'participant-two');
  participantTwoContext = participantTwoRoom.context;

  await Promise.all([
    waitForRemoteMedia(hostRoom.page, 'Participant Vidéo'),
    waitForRemoteMedia(hostRoom.page, 'Participant Deux'),
    waitForRemoteMedia(participantRoom.page, 'Hôte Vidéo'),
    waitForRemoteMedia(participantRoom.page, 'Participant Deux'),
    waitForRemoteMedia(participantTwoRoom.page, 'Hôte Vidéo'),
    waitForRemoteMedia(participantTwoRoom.page, 'Participant Vidéo'),
  ]);

  const transportBadge = hostRoom.page.locator('[data-testid="media-transport-status"]');
  await transportBadge.waitFor({ state: 'visible', timeout: 10_000 });
  assert.match(await transportBadge.innerText(), /Mesh actif/);
  assert.match(await transportBadge.innerText(), /secours/);

  await hostRoom.page.waitForFunction(() => {
    const indicator = document.querySelector('[data-testid="network-quality"]');
    const level = indicator?.getAttribute('data-level');
    return Boolean(indicator && level && level !== 'offline');
  }, undefined, { timeout: 15_000 });

  await hostRoom.page.locator('[data-testid="speaker-view-button"]').click();
  await hostRoom.page.locator('[data-testid="speaker-layout"]').waitFor({ state: 'visible', timeout: 10_000 });
  const pinButton = hostRoom.page.locator('[data-testid="pin-participant"]').first();
  await pinButton.waitFor({ state: 'visible', timeout: 10_000 });
  await pinButton.click();
  await hostRoom.page.locator('[data-testid="unpin-participant"]').first().waitFor({ state: 'visible', timeout: 10_000 });
  await hostRoom.page.locator('[data-testid="gallery-view-button"]').click();
  await hostRoom.page.locator('[data-testid="gallery-layout"]').waitFor({ state: 'visible', timeout: 10_000 });
  await waitForRemoteMedia(hostRoom.page, 'Participant Vidéo');

  const deviceButton = hostRoom.page.locator('[data-testid="device-settings-button"]');
  await deviceButton.waitFor({ state: 'visible', timeout: 10_000 });
  await deviceButton.click();
  const devicePanel = hostRoom.page.locator('[data-testid="device-settings-panel"]');
  await devicePanel.waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok(await devicePanel.locator('select').count() >= 3, 'Device panel should expose microphone, camera and speaker selectors');
  assert.ok(await devicePanel.locator('select').nth(0).locator('option').count() >= 1, 'At least one microphone should be available in the fake media environment');
  assert.ok(await devicePanel.locator('select').nth(1).locator('option').count() >= 1, 'At least one camera should be available in the fake media environment');
  await deviceButton.click();
  await devicePanel.waitFor({ state: 'hidden', timeout: 10_000 });

  await clickControl(participantRoom.page, 'Caméra');
  await waitForRemoteCameraState(hostRoom.page, 'Participant Vidéo', false);
  await clickControl(participantRoom.page, 'Caméra');
  await waitForRemoteMedia(hostRoom.page, 'Participant Vidéo');

  await clickControl(participantRoom.page, 'Partager');
  await hostRoom.page.waitForFunction(() => {
    const tile = Array.from(document.querySelectorAll('.room-v2-tile')).find((candidate) => candidate.textContent?.includes('Participant Vidéo') && !candidate.textContent?.includes('(vous)'));
    const video = tile?.querySelector('video');
    return Boolean(tile?.classList.contains('is-screen') && video && video.videoWidth > 0 && video.videoHeight > 0);
  }, undefined, { timeout: 15_000 });
  await clickControl(participantRoom.page, 'Partager');
  await hostRoom.page.waitForFunction(() => {
    const tile = Array.from(document.querySelectorAll('.room-v2-tile')).find((candidate) => candidate.textContent?.includes('Participant Vidéo') && !candidate.textContent?.includes('(vous)'));
    return Boolean(tile && !tile.classList.contains('is-screen'));
  }, undefined, { timeout: 15_000 });
  await waitForRemoteMedia(hostRoom.page, 'Participant Vidéo');

  await clickControl(participantRoom.page, 'Micro');
  await waitForRemoteMicState(hostRoom.page, 'Participant Vidéo', true);
  await clickControl(participantRoom.page, 'Micro');
  await waitForRemoteMicState(hostRoom.page, 'Participant Vidéo', false);

  await clickControl(participantRoom.page, 'Main');
  await hostRoom.page.waitForFunction(() => {
    const tile = Array.from(document.querySelectorAll('.room-v2-tile')).find((candidate) => candidate.textContent?.includes('Participant Vidéo') && !candidate.textContent?.includes('(vous)'));
    return Boolean(tile?.querySelector('[aria-label="Main levée"]'));
  }, undefined, { timeout: 10_000 });
  await clickControl(participantRoom.page, 'Baisser la main');
  await hostRoom.page.waitForFunction(() => {
    const tile = Array.from(document.querySelectorAll('.room-v2-tile')).find((candidate) => candidate.textContent?.includes('Participant Vidéo') && !candidate.textContent?.includes('(vous)'));
    return Boolean(tile && !tile.querySelector('[aria-label="Main levée"]'));
  }, undefined, { timeout: 10_000 });

  const recordingDownload = hostRoom.page.waitForEvent('download', { timeout: 20_000 });
  await clickControl(hostRoom.page, 'Enregistrer');
  await hostRoom.page.waitForFunction(() => document.body.innerText.includes('Enregistrement composite démarré pour 3 flux.'), undefined, { timeout: 10_000 });
  await sleep(2_500);
  await clickControl(hostRoom.page, 'Stop rec.');
  const download = await recordingDownload;
  await mkdir('test-artifacts', { recursive: true });
  const recordingPath = 'test-artifacts/meeting-composite.webm';
  await download.saveAs(recordingPath);
  const recordingInfo = await stat(recordingPath);
  assert.ok(recordingInfo.size > 15_000, `Composite recording should contain media data, got ${recordingInfo.size} bytes`);

  await clickControl(hostRoom.page, 'Sous-titres');
  await clickControl(participantRoom.page, 'Sous-titres');
  await hostRoom.page.waitForFunction(() => {
    const overlay = document.querySelector('[data-testid="caption-overlay"]');
    return Boolean(overlay?.textContent?.includes('Sous-titre automatique participant'));
  }, undefined, { timeout: 12_000 });

  await participantRoom.page.locator('[data-testid="reaction-button"]').click();
  await participantRoom.page.locator('[data-testid="reaction-panel"]').waitFor({ state: 'visible', timeout: 10_000 });
  await participantRoom.page.locator('[data-testid="reaction-panel"] button').filter({ hasText: '👏' }).click();
  await hostRoom.page.waitForFunction(() => {
    const tile = Array.from(document.querySelectorAll('.room-v2-tile')).find((candidate) => candidate.textContent?.includes('Participant Vidéo') && !candidate.textContent?.includes('(vous)'));
    return Boolean(tile?.querySelector('[aria-label="Réaction 👏"]'));
  }, undefined, { timeout: 10_000 });

  await participantContext.setOffline(true);
  await hostRoom.page.waitForFunction(() => {
    return !Array.from(document.querySelectorAll('.room-v2-tile')).some((tile) => tile.textContent?.includes('Participant Vidéo'));
  }, undefined, { timeout: 15_000 });
  await participantContext.setOffline(false);

  await Promise.all([
    waitForRemoteMedia(hostRoom.page, 'Participant Vidéo', 30_000),
    waitForRemoteMedia(hostRoom.page, 'Participant Deux', 30_000),
    waitForRemoteMedia(participantRoom.page, 'Hôte Vidéo', 30_000),
    waitForRemoteMedia(participantRoom.page, 'Participant Deux', 30_000),
    waitForRemoteMedia(participantTwoRoom.page, 'Hôte Vidéo', 30_000),
    waitForRemoteMedia(participantTwoRoom.page, 'Participant Vidéo', 30_000),
  ]);

  const persisted = await jsonRequest(`/api/meetings/${meeting.id}/participants`, { headers: authHeaders(host.token) });
  assert.equal(persisted.response.status, 200, JSON.stringify(persisted.data));
  assert.ok(persisted.data.some((item) => Number(item.userId) === Number(participant.user.id) && item.status === 'accepted'));

  await mkdir('test-artifacts', { recursive: true });
  await hostRoom.page.screenshot({ path: 'test-artifacts/video-host.png', fullPage: true });
  await participantRoom.page.screenshot({ path: 'test-artifacts/video-participant.png', fullPage: true });
  await participantTwoRoom.page.screenshot({ path: 'test-artifacts/video-participant-two.png', fullPage: true });

  assert.deepEqual(hostRoom.browserErrors, [], `Host browser errors: ${hostRoom.browserErrors.join('\n')}`);
  assert.deepEqual(participantRoom.browserErrors, [], `Participant browser errors: ${participantRoom.browserErrors.join('\n')}`);
  assert.deepEqual(participantTwoRoom.browserErrors, [], `Participant two browser errors: ${participantTwoRoom.browserErrors.join('\n')}`);

  console.log('Three-browser camera + microphone + reconnect video meeting checks passed.');
} catch (error) {
  await mkdir('test-artifacts', { recursive: true }).catch(() => undefined);
  if (hostRoom?.page) {
    console.error(`HOST_DIAGNOSTICS ${JSON.stringify(await mediaDiagnostics(hostRoom.page).catch((cause) => ({ error: String(cause) })), null, 2)}`);
    await hostRoom.page.screenshot({ path: 'test-artifacts/failure-host.png', fullPage: true }).catch(() => undefined);
  }
  if (participantRoom?.page) {
    console.error(`PARTICIPANT_DIAGNOSTICS ${JSON.stringify(await mediaDiagnostics(participantRoom.page).catch((cause) => ({ error: String(cause) })), null, 2)}`);
    await participantRoom.page.screenshot({ path: 'test-artifacts/failure-participant.png', fullPage: true }).catch(() => undefined);
  }
  if (participantTwoRoom?.page) {
    console.error(`PARTICIPANT_TWO_DIAGNOSTICS ${JSON.stringify(await mediaDiagnostics(participantTwoRoom.page).catch((cause) => ({ error: String(cause) })), null, 2)}`);
    await participantTwoRoom.page.screenshot({ path: 'test-artifacts/failure-participant-two.png', fullPage: true }).catch(() => undefined);
  }
  console.error(`SERVER_OUTPUT\n${serverOutput}`);
  throw error;
} finally {
  await participantTwoContext?.close().catch(() => undefined);
  await participantContext?.close().catch(() => undefined);
  await hostContext?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (!server.killed) server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
}
