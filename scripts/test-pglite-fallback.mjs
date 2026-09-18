import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const port = Number(process.env.MBOTE_ROOM_PGLITE_TEST_PORT || 4327);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = join(tmpdir(), 'mboteroom-pglite-ci');

await rm(dataDir, { recursive: true, force: true });

const server = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    DATABASE_URL: '',
    DATABASE_MODE: 'pglite-test',
    PGLITE_DATA_DIR: dataDir,
    MBOTE_ROOM_ALLOWED_ORIGINS: baseUrl,
    MBOTE_ROOM_APP_URL: baseUrl,
    ADMIN_EMAILS: '',
    RESEND_API_KEY: '',
    GROQ_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
let exitState = null;
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });
server.on('exit', (code, signal) => { exitState = { code, signal }; });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestJson = async (path, options = {}) => {
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

const waitForHealth = async () => {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (exitState) throw new Error(`PGlite server exited early: ${JSON.stringify(exitState)}\n${output}`);
    try {
      const result = await requestJson('/api/health');
      if (result.response.ok) return result;
    } catch {
      // PGlite initdb and migrations are still starting.
    }
    await sleep(200);
  }
  throw new Error(`PGlite server did not become healthy.\n${output}`);
};

try {
  const health = await waitForHealth();
  assert.equal(health.data.ok, true);
  assert.equal(health.data.database?.connected, true);
  assert.equal(health.data.database?.type, 'pglite-test');
  assert.equal(Number(health.data.database?.users || 0), 0);
  assert.equal(Number(health.data.database?.meetings || 0), 0);

  const register = await requestJson('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test PGlite',
      email: 'pglite.test@mbote.test',
      password: 'Password2026!',
    }),
  });
  assert.equal(register.response.status, 201, JSON.stringify(register.data));
  assert.equal(register.data.token, undefined, 'Browser response must not expose bearer token');
  const setCookie = register.response.headers.get('set-cookie') || '';
  assert.match(setCookie, /mbote_room_session=/);
  assert.match(setCookie, /HttpOnly/i);
  const cookie = setCookie.split(';')[0];

  const me = await requestJson('/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal(me.response.status, 200, JSON.stringify(me.data));
  assert.equal(me.data.user?.email, 'pglite.test@mbote.test');

  const meeting = await requestJson('/api/meetings', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify({
      title: 'Réunion test Render',
      description: 'Validation du mode PGlite explicitement réservé au test.',
      startTime: new Date(Date.now() + 60_000).toISOString(),
      duration: 30,
      settings: {
        waitingRoom: true,
        chat: true,
        reactions: true,
        screenShare: true,
      },
    }),
  });
  assert.equal(meeting.response.status, 201, JSON.stringify(meeting.data));
  assert.ok(meeting.data.id);
  assert.ok(meeting.data.meeting_link);

  const after = await requestJson('/api/health');
  assert.equal(after.response.status, 200, JSON.stringify(after.data));
  assert.equal(Number(after.data.database?.users), 1);
  assert.equal(Number(after.data.database?.meetings), 1);
  assert.equal(after.data.database?.type, 'pglite-test');

  const logout = await requestJson('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(logout.response.status, 204);

  const expired = await requestJson('/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal(expired.response.status, 401);

  console.log('PGlite Render test database fallback checks passed.');
} finally {
  if (!server.killed) server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
}
