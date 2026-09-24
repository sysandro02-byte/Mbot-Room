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
      country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true,
      termsVersion: '2026-09-24',
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

  const assertNoViewportOverflow = async (route) => {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
    // WebKit treats fetches interrupted by the next navigation as page errors.
    // Finish the route's network activity before moving to another screen.
    await page.waitForLoadState('networkidle');
    const metrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      Math.max(metrics.root, metrics.body) <= metrics.viewport + 2,
      `${name} ${route}: horizontal overflow root=${metrics.root} body=${metrics.body} viewport=${metrics.viewport}`,
    );
  };

  for (const route of ['/app', '/app/meetings', '/app/profile', '/app/settings', '/app/notifications', '/join']) {
    await assertNoViewportOverflow(route);
  }

  await page.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  assert.ok((await page.locator('body').innerText()).length > 40, `${name}: empty application`);
  assert.ok(!page.url().includes('/login'), `${name}: authenticated session redirected to login`);

  const avatar = page.locator('.global-header-avatar:visible');
  if (await avatar.count()) {
    await avatar.click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.global-header-profile-menu:visible').count(), 1, `${name}: profile menu did not open`);
    const dropdownMetrics = await page.evaluate(() => ({
      viewport: window.innerWidth,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(Math.max(dropdownMetrics.root, dropdownMetrics.body) <= dropdownMetrics.viewport + 2, `${name}: profile menu caused horizontal overflow`);
  }

  assert.deepEqual(errors, [], `${name}: browser errors before the network outage: ${errors.join(' | ')}`);

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
  // WebKit reports requests interrupted by Playwright's deliberate offline switch as page errors.
  // Treat only those localhost API cancellations as expected; errors before the switch still fail above.
  const unexpectedErrors = errors.filter((message) =>
    !/^\/127\.0\.0\.1:\d+\/api\/[^ ]+ due to access control checks\.$/.test(message)
  );
  assert.deepEqual(unexpectedErrors, [], `${name}: browser errors after reconnect: ${unexpectedErrors.join(' | ')}`);

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
  await runCase({
    name: 'Tablet 820x1180 WebKit',
    browserType: webkit,
    device: {
      viewport: { width: 820, height: 1180 },
      screen: { width: 820, height: 1180 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    session: sharedSession,
  });

  const responsiveBrowser = await chromium.launch({ headless: true });
  const responsiveContext = await responsiveBrowser.newContext();
  await responsiveContext.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
  }, { user: sharedSession.user, token: sharedSession.token });
  const responsivePage = await responsiveContext.newPage();
  const responsiveWidths = [320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440, 1920];
  for (const width of responsiveWidths) {
    await responsivePage.setViewportSize({ width, height: width <= 430 ? 844 : 1000 });
    await responsivePage.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
    await responsivePage.waitForLoadState('networkidle');
    const metrics = await responsivePage.evaluate(() => ({
      viewport: window.innerWidth,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    assert.ok(
      Math.max(metrics.root, metrics.body) <= metrics.viewport + 2,
      `Responsive ${width}px: horizontal overflow root=${metrics.root} body=${metrics.body} viewport=${metrics.viewport}`,
    );
  }
  await responsiveContext.close();
  await responsiveBrowser.close();
  console.log(`RESPONSIVE_WIDTHS_OK ${responsiveWidths.join(',')}`);

  const resumeBrowser = await chromium.launch({ headless: true });
  const resumeContext = await resumeBrowser.newContext({ ...devices['Pixel 7'] });
  await resumeContext.addInitScript(({ user, token }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
    localStorage.setItem('mboteroom-last-safe-route', '/app/settings');
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query.includes('display-mode: standalone')
      ? { matches: true, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } }
      : originalMatchMedia(query);
  }, { user: sharedSession.user, token: sharedSession.token });
  const resumePage = await resumeContext.newPage();
  await resumePage.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  await resumePage.waitForURL(/\/app\/settings/, { timeout: 5000 });
  assert.match(resumePage.url(), /\/app\/settings$/, 'Installed PWA must resume the last safe browser route');
  await resumeContext.close();
  await resumeBrowser.close();

  console.log('DEVICE_MATRIX_RESULT {"ok":true,"devices":4,"responsiveWidths":11,"networkRecovery":true,"responsive":true,"pwaResume":true}');
} finally {
  server.kill('SIGTERM');
}
