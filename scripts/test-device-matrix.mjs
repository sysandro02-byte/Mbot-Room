import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { chromium, webkit, devices } from '@playwright/test';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const port = Number(process.env.MBOTE_ROOM_DEVICE_TEST_PORT || 4321);
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
    MBOTE_ROOM_REQUIRE_CI_GATE: 'false',
    GROQ_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk.toString(); });
server.stderr.on('data', (chunk) => { output += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Device matrix server unavailable.\n${output}`);
};

const register = async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
      'X-MBote-Room-Session-Mode': 'bearer',
    },
    body: JSON.stringify({
      name: 'Device Matrix',
      email: 'device.matrix@mbote.test',
      password: 'Password2026!',
    }),
  });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.ok(data.token);
  return data;
};

const runCase = async ({ name, browserType, device, session }) => {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    ...(device || {}),
    locale: 'fr-FR',
  });

  await context.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
  }, { user: session.user, token: session.token });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('body').innerText()).length > 40, `${name}: empty application`);
  assert.ok(!page.url().includes('/login'), `${name}: authenticated session redirected to login`);

  await context.setOffline(true);
  const offlineFailed = await page.evaluate(async () => {
    try {
      await fetch('/api/health', { cache: 'no-store' });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(offlineFailed, true, `${name}: network outage was not observable`);

  await context.setOffline(false);
  const recovered = await page.evaluate(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (response.ok) return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  });
  assert.equal(recovered, true, `${name}: application did not recover after reconnect`);
  assert.deepEqual(errors, [], `${name}: browser errors: ${errors.join(' | ')}`);

  await context.close();
  await browser.close();
  console.log(`DEVICE_MATRIX_OK ${name}`);
};

try {
  await waitForServer();
  const sharedSession = await register();
  await runCase({ name: 'PC Chromium', browserType: chromium, session: sharedSession });
  await runCase({ name: 'Android Pixel 7', browserType: chromium, device: devices['Pixel 7'], session: sharedSession });
  await runCase({ name: 'iPhone 15 WebKit', browserType: webkit, device: devices['iPhone 15'], session: sharedSession });
  console.log('DEVICE_MATRIX_RESULT {"ok":true,"devices":3,"networkRecovery":true}');
} finally {
  server.kill('SIGTERM');
}
