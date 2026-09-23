import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import pg from 'pg';
import { chromium } from 'playwright';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const port = Number(process.env.MBOTE_ROOM_APP_SMOKE_PORT || 4335);
const baseUrl = `http://127.0.0.1:${port}`;
const mailRelayPort = port + 1;
const sentEmails = [];
const mailRelay = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk.toString();
  sentEmails.push(JSON.parse(raw));
  response.statusCode = 202;
  response.end(JSON.stringify({ success: true }));
});
await new Promise((resolve) => mailRelay.listen(mailRelayPort, '127.0.0.1', resolve));

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
    ADMIN_EMAILS: 'admin.smoke@mbote.test',
    MBOTE_MAIL_RELAY_URL: `http://127.0.0.1:${mailRelayPort}/email`,
    MBOTE_ROOM_MAIL_SECRET: 'smoke-mail-secret',
    RESEND_API_KEY: '',
    GROQ_API_KEY: '',
    GROQ_TRANSCRIPTION_API_KEY: '',
    LIVEKIT_URL: '',
    LIVEKIT_API_KEY: '',
    LIVEKIT_API_SECRET: '',
    TURN_URLS: '',
    TURN_SHARED_SECRET: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error(`Server unavailable.\n${serverOutput}`);
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

const authHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'X-MBote-Room-Session-Mode': 'bearer',
});

let browser;
let context;

try {
  const health = await waitForServer();
  assert.equal(health.ok, true);
  assert.equal(health.database?.type, 'postgres');
  assert.equal(health.readiness?.database?.persistent, true);
  assert.equal(health.readiness?.testReady, true);

  const register = await jsonRequest('/api/auth/admin/register', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({
      name: 'Admin Smoke',
      email: 'admin.smoke@mbote.test',
      password: 'Password2026!',
    }),
  });
  assert.equal(register.response.status, 201, JSON.stringify(register.data));
  assert.equal(register.response.headers.get('set-cookie'), null);
  const otp = sentEmails.at(-1)?.text?.match(/est (\d{6})\./)?.[1];
  assert.ok(otp, 'Admin registration must send a verification code');
  const verified = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ challengeId: register.data.challengeId, code: otp }),
  });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
  assert.ok(verified.data.token);
  assert.equal(verified.data.user?.role, 'admin');

  const setCookie = verified.response.headers.get('set-cookie') || '';
  assert.match(setCookie, /mbote_room_session=/);
  assert.match(setCookie, /HttpOnly/i);
  const cookiePair = setCookie.split(';')[0];
  const separator = cookiePair.indexOf('=');
  const cookieName = cookiePair.slice(0, separator);
  const cookieValue = cookiePair.slice(separator + 1);
  assert.ok(cookieName && cookieValue);

  const createMeeting = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({
      title: 'Réunion smoke écrans',
      description: 'Validation navigation complète',
      startTime: new Date(Date.now() + 60 * 60_000).toISOString(),
      duration: 45,
      settings: {
        waitingRoom: false,
        joinBeforeHost: true,
        chat: true,
        reactions: true,
        screenShare: true,
        lunaSummary: true,
        isPublic: false,
      },
    }),
  });
  assert.equal(createMeeting.response.status, 201, JSON.stringify(createMeeting.data));

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({ baseURL: baseUrl });
  await context.addCookies([{
    name: cookieName,
    value: cookieValue,
    url: baseUrl,
    httpOnly: true,
    sameSite: 'Lax',
  }]);
  await context.addInitScript(({ user, expiresAt }) => {
    localStorage.setItem('user', JSON.stringify(user));
    if (expiresAt) localStorage.setItem('sessionExpiresAt', expiresAt);
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
  }, {
    user: verified.data.user,
    expiresAt: verified.data.expiresAt || '',
  });

  const page = await context.newPage();
  const pageErrors = [];
  const serverErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const value = message.text();
      if (!/favicon|ResizeObserver/i.test(value)) pageErrors.push(value);
    }
  });
  page.on('response', (response) => {
    if (response.url().startsWith(baseUrl) && response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const routes = [
    ['/app', 'Bienvenue sur'],
    ['/app/meetings', 'Réunions'],
    ['/app/search', 'Recherche'],
    ['/app/calendar', 'Calendrier'],
    ['/app/recordings', 'Enregistrements'],
    ['/app/messages', 'Messages'],
    ['/app/contacts', 'Contacts'],
    ['/app/notifications', 'Centre de notifications'],
    ['/app/whiteboard', 'Tableau blanc'],
    ['/app/polls', 'Sondages'],
    ['/app/settings', 'Paramètres'],
    ['/app/profile', 'Mon profil'],
    ['/join', 'Rejoindre'],
    ['/admin', 'Tableau de bord'],
    ['/aide', 'Centre d’aide MBotéRoom'],
  ];

  for (const [route, expectedText] of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector('.route-loading'), undefined, { timeout: 15_000 });
    await page.waitForTimeout(250);

    assert.ok(!page.url().includes('/login'), `${route} unexpectedly redirected to login`);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    assert.ok(body.includes(expectedText), `${route} should render "${expectedText}". Body: ${body.slice(0, 500)}`);

    const visibleFunctionalError = await page.locator(
      '.real-feature-error, .real-dashboard-error, .utility-error, .admin-inline-error, .admin-dashboard-page [role="alert"]'
    ).filter({ visible: true }).allTextContents().catch(() => []);
    assert.deepEqual(visibleFunctionalError, [], `${route} rendered functional errors: ${visibleFunctionalError.join(' | ')}`);
  }

  assert.deepEqual(serverErrors, [], `Server 5xx responses detected:\n${serverErrors.join('\n')}`);
  assert.deepEqual(pageErrors, [], `Browser errors detected:\n${pageErrors.join('\n')}`);

  const finalMe = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  });
  assert.equal(finalMe.status, 200);
  assert.equal(finalMe.data.user?.email, 'admin.smoke@mbote.test');

  console.log('Authenticated multi-page application smoke checks passed.');
} catch (error) {
  console.error(`APP_SMOKE_SERVER_OUTPUT\n${serverOutput}`);
  throw error;
} finally {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  if (!server.killed) server.kill('SIGTERM');
  await new Promise((resolve) => mailRelay.close(resolve));
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
}
