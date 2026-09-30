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

  const updateProfile = await jsonRequest('/api/profile', {
    method: 'PUT',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({
      name: 'Admin Smoke',
      username: 'admin.smoke',
      organization: 'LoukaTech Smoke',
      jobTitle: 'Validation',
      city: 'Brazzaville',
      country: 'Congo',
      address: 'Brazzaville, Congo',
      bio: 'Profil utilisé pour valider MBotéRoom.',
      profileVisible: true,
      personalMeetingId: '9876543210',
    }),
  });
  assert.equal(updateProfile.response.status, 200, JSON.stringify(updateProfile.data));
  assert.equal(updateProfile.data.user?.bio, 'Profil utilisé pour valider MBotéRoom.');
  assert.equal(updateProfile.data.user?.profileVisible, true);
  assert.equal(updateProfile.data.user?.personalMeetingId, '9876543210');

  const personalMeeting = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({
      title: 'Réunion avec ID personnel',
      startTime: new Date(Date.now() + 90 * 60_000).toISOString(),
      duration: 30,
      settings: { waitingRoom: true, chat: true },
    }),
  });
  assert.equal(personalMeeting.response.status, 201, JSON.stringify(personalMeeting.data));
  assert.equal(personalMeeting.data.settings?.meetingAccessId, '9876543210');

  const updatePreferences = await jsonRequest('/api/preferences', {
    method: 'PUT',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({ language: 'fr', timezone: 'Africa/Brazzaville' }),
  });
  assert.equal(updatePreferences.response.status, 200, JSON.stringify(updatePreferences.data));
  assert.equal(updatePreferences.data.timezone, 'Africa/Brazzaville');

  const createRecording = await jsonRequest(`/api/meetings/${createMeeting.data.id}/recordings`, {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({
      storageUrl: 'https://media.example.test/mboteroom-smoke.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1048576,
      durationSeconds: 125,
    }),
  });
  assert.equal(createRecording.response.status, 201, JSON.stringify(createRecording.data));
  assert.ok(createRecording.data.id);

  const recordingStats = await jsonRequest('/api/recordings/stats', {
    headers: authHeaders(verified.data.token),
  });
  assert.equal(recordingStats.response.status, 200, JSON.stringify(recordingStats.data));
  assert.ok(recordingStats.data.count >= 1);
  assert.ok(recordingStats.data.durationSeconds >= 125);
  assert.ok(recordingStats.data.sizeBytes >= 1048576);

  const favoriteRecording = await jsonRequest(`/api/recordings/${createRecording.data.id}`, {
    method: 'PATCH',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({ favorite: true }),
  });
  assert.equal(favoriteRecording.response.status, 200, JSON.stringify(favoriteRecording.data));
  assert.equal(favoriteRecording.data.favorite, true);

  const recordingAccess = await jsonRequest(`/api/recordings/${createRecording.data.id}/access`, {
    headers: authHeaders(verified.data.token),
  });
  assert.equal(recordingAccess.response.status, 200, JSON.stringify(recordingAccess.data));
  assert.equal(recordingAccess.data.url, 'https://media.example.test/mboteroom-smoke.mp4');

  const googleStatus = await jsonRequest('/api/calendar/google/status', {
    headers: authHeaders(verified.data.token),
  });
  assert.equal(googleStatus.response.status, 200, JSON.stringify(googleStatus.data));
  assert.equal(googleStatus.data.connected, false);

  const createGroup = await jsonRequest('/api/work-groups', {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({
      name: 'Équipe smoke',
      description: 'Validation groupes, fichiers et appels',
      emails: ['membre.un@mbote.test', 'membre.deux@mbote.test'],
    }),
  });
  assert.equal(createGroup.response.status, 201, JSON.stringify(createGroup.data));
  assert.ok(createGroup.data.id);
  assert.equal(createGroup.data.isOwner, true);
  assert.ok(createGroup.data.members.length >= 3);

  const groupConversation = await jsonRequest(`/api/conversations/work-group/${createGroup.data.id}`, {
    method: 'POST',
    headers: authHeaders(verified.data.token),
  });
  assert.equal(groupConversation.response.status, 201, JSON.stringify(groupConversation.data));
  assert.ok(groupConversation.data.id);
  const emailCountBeforeGroupMessage = sentEmails.length;
  const groupMessage = await jsonRequest(`/api/conversations/${groupConversation.data.id}/messages`, {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({ text: 'Message réservé aux membres qui ont un compte MBotéRoom.' }),
  });
  assert.equal(groupMessage.response.status, 201, JSON.stringify(groupMessage.data));
  const groupMessageEmails = sentEmails.slice(emailCountBeforeGroupMessage);
  assert.ok(groupMessageEmails.some((mail) => String(mail.to || '') === 'membre.un@mbote.test'), 'External group member one should receive an email notification');
  assert.ok(groupMessageEmails.some((mail) => String(mail.to || '') === 'membre.deux@mbote.test'), 'External group member two should receive an email notification');

  const pdfUpload = await fetch(`${baseUrl}/api/files/upload`, {
    method: 'POST',
    headers: {
      ...authHeaders(verified.data.token),
      Origin: baseUrl,
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('workspace-smoke.pdf'),
      'X-Work-Group-Id': createGroup.data.id,
    },
    body: Buffer.from('%PDF-1.4\n% MBoteRoom smoke PDF\n'),
  });
  const uploadedPdf = await pdfUpload.json().catch(() => ({}));
  assert.equal(pdfUpload.status, 201, JSON.stringify(uploadedPdf));
  assert.equal(uploadedPdf.name, 'workspace-smoke.pdf');

  const attachCall = await jsonRequest(`/api/work-groups/${createGroup.data.id}/calls`, {
    method: 'POST',
    headers: authHeaders(verified.data.token),
    body: JSON.stringify({ meetingId: createMeeting.data.id, callType: 'video' }),
  });
  assert.equal(attachCall.response.status, 201, JSON.stringify(attachCall.data));

  const groupDetail = await jsonRequest(`/api/work-groups/${createGroup.data.id}`, {
    headers: authHeaders(verified.data.token),
  });
  assert.equal(groupDetail.response.status, 200, JSON.stringify(groupDetail.data));
  assert.ok(groupDetail.data.files.some((item) => item.id === uploadedPdf.id));
  assert.ok(groupDetail.data.calls.some((item) => Number(item.meetingId) === Number(createMeeting.data.id)));

  const profileStats = await jsonRequest('/api/profile/stats', {
    headers: authHeaders(verified.data.token),
  });
  assert.equal(profileStats.response.status, 200, JSON.stringify(profileStats.data));
  assert.ok(profileStats.data.meetings >= 1);
  assert.ok(profileStats.data.files >= 1);

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
    const expectedUnavailableLuna = response.url().endsWith('/api/admin/ai/compose')
      && response.request().method() === 'POST'
      && response.status() === 503;
    if (response.url().startsWith(baseUrl) && response.status() >= 500 && !expectedUnavailableLuna) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  const routes = [
    ['/app', 'Bienvenue sur'],
    ['/app/meetings', 'Réunions'],
    ['/app/search', 'Recherche'],
    ['/app/calendar', 'Calendrier'],
    ['/app/live', 'Live'],
    ['/app/live/new', 'Créer un live'],
    ['/app/recordings', 'Enregistrements'],
    ['/app/files', 'Fichiers'],
    ['/app/groups', 'Groupes de travail'],
    ['/app/messages', 'Messages'],
    ['/app/contacts', 'Contacts'],
    ['/app/notifications', 'Centre de notifications'],
    ['/app/whiteboard', 'Tableau blanc'],
    ['/app/polls', 'Sondages'],
    ['/app/settings', 'Paramètres'],
    ['/app/profile', 'Modifier le profil'],
    ['/join', 'Rejoindre'],
    ['/admin', 'Tableau de bord'],
    ['/aide', 'Centre d’aide MBotéRoom'],
  ];

  for (const [route, expectedText] of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForFunction(() => !document.querySelector('.route-loading'), undefined, { timeout: 15_000 });
    await page.waitForTimeout(250);

    assert.ok(!page.url().includes('/login'), `${route} unexpectedly redirected to login`);
    if (route === '/admin') {
      await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 10_000 });
      assert.equal(await page.locator('.global-app-header').count(), 0, 'Admin must render only its dedicated header');
      assert.equal(await page.locator('.admin-mobile-menu').count(), 1, 'Admin must render one menu trigger');
      assert.equal(await page.locator('.admin-topbar [aria-label="Notifications administrateur"]').count(), 1, 'Admin must render one notification trigger');
      assert.equal(await page.getByRole('link', { name: 'Réunion', exact: true }).count(), 1, 'Admin menu must expose one direct meeting creation entry');

      const adminMenu = page.locator('.admin-mobile-menu');
      await adminMenu.evaluate((element) => element.click());
      await page.waitForFunction(() => document.querySelector('.admin-sidebar')?.classList.contains('is-open'));
      assert.equal(await page.locator('.admin-sidebar-overlay').count(), 1, 'Opening the admin menu must render one overlay');
      await page.locator('.admin-sidebar-overlay').evaluate((element) => element.click());
      await page.waitForFunction(() => !document.querySelector('.admin-sidebar')?.classList.contains('is-open'));
      assert.equal(await page.locator('.admin-sidebar-overlay').count(), 0, 'Closing the admin menu must remove the overlay');

      await page.getByRole('link', { name: 'Communications', exact: true }).click();
      await page.waitForFunction(() => window.location.hash === '#admin-broadcasts');
      await page.getByRole('heading', { name: 'Communication & audience', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });

      const aiIntent = page.getByLabel('Instruction pour Luna IA');
      await aiIntent.fill('Informer les utilisateurs de la maintenance planifiée ce soir.');
      const aiGenerateButton = page.getByRole('button', { name: 'Générer le message avec IA' });
      await aiGenerateButton.waitFor({ state: 'visible', timeout: 10_000 });
      assert.equal(await aiGenerateButton.count(), 1, 'Communications must expose one AI message generation action');
      const aiResponse = page.waitForResponse((response) => response.url().endsWith('/api/admin/ai/compose') && response.request().method() === 'POST');
      await aiGenerateButton.click();
      assert.equal((await aiResponse).status(), 503, 'The test environment must report the intentionally unconfigured Luna provider');
      await page.getByRole('status').filter({ hasText: 'Luna IA est momentanément indisponible.' }).waitFor({ state: 'visible', timeout: 10_000 });

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await page.waitForFunction(() => !document.querySelector('.route-loading'), undefined, { timeout: 15_000 });
      assert.ok(!page.url().includes('/login'), 'Admin session must survive a page reload');
      await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 10_000 });
      assert.equal(await page.locator('.global-app-header').count(), 0, 'Reloaded admin must still render only its dedicated header');
      assert.equal(await page.locator('.admin-topbar [aria-label="Notifications administrateur"]').count(), 1, 'Reloaded admin must keep one notification trigger');
      await page.getByRole('heading', { name: 'Communication & audience', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    } else {
      const globalHeader = page.locator('.global-app-header');
      await globalHeader.waitFor({ state: 'visible', timeout: 10_000 });
      const headerPosition = await globalHeader.evaluate((element) => getComputedStyle(element).position);
      const headerTop = await globalHeader.evaluate((element) => getComputedStyle(element).top);
      assert.equal(headerPosition, 'sticky', `${route} global header must remain sticky while scrolling`);
      assert.equal(headerTop, '0px', `${route} global header must stay attached to the top`);
    }
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
    assert.ok(body.includes(expectedText), `${route} should render "${expectedText}". Body: ${body.slice(0, 500)}`);

    const visibleFunctionalError = await page.locator(
      '.real-feature-error, .real-dashboard-error, .utility-error, .admin-inline-error, .admin-dashboard-page [role="alert"]'
    ).filter({ visible: true }).allTextContents().catch(() => []);
    assert.deepEqual(visibleFunctionalError, [], `${route} rendered functional errors: ${visibleFunctionalError.join(' | ')}`);
  }

  await page.goto('/app/live', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.getByRole('heading', { name: 'Live', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.locator('.live-feed-hero > button').filter({ hasText: 'Créer un live' }).count(), 1, 'Live feed must expose one primary creation action in its header');
  assert.equal(await page.getByPlaceholder('Rechercher un live, un créateur, un sujet…').count(), 1, 'Live feed must expose search');
  assert.equal(await page.getByRole('button', { name: 'Tendance', exact: true }).count(), 1, 'Live feed must expose trending discovery');
  assert.equal(await page.locator('.app-shell-bottom-nav a[href="/app/live"]').count(), 1, 'Mobile navigation must expose Live');

  await page.goto('/app/live/new', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.getByRole('heading', { name: 'Créer un live', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await page.getByLabel('Choisir une couverture').count(), 1, 'Live creation must expose real cover image upload');
  assert.equal(await page.getByText('Activer le chat', { exact: true }).count(), 1, 'Live creation must expose chat configuration');
  assert.equal(await page.getByText('Inviter des co-animateurs', { exact: true }).count(), 1, 'Live creation must expose co-host configuration');
  assert.equal(await page.getByText('Enregistrer le live', { exact: true }).count(), 1, 'Live creation must expose recording configuration');
  assert.equal(await page.getByText('Mode modération', { exact: true }).count(), 1, 'Live creation must expose moderation configuration');

  // Real compact/mobile interaction regression: use an actual Playwright click,
  // not element.click(), so hit-testing and responsive layering are validated.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('.route-loading'), undefined, { timeout: 15_000 });
  await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 10_000 });

  const mobileMenuButton = page.locator('.admin-mobile-menu');
  const mobileBellButton = page.locator('.admin-topbar [aria-label="Notifications administrateur"]');
  const mobileAvatarButton = page.locator('.admin-topbar-avatar');
  const [menuBox, bellBox, avatarBox] = await Promise.all([
    mobileMenuButton.boundingBox(),
    mobileBellButton.boundingBox(),
    mobileAvatarButton.boundingBox(),
  ]);
  assert.ok(menuBox && bellBox && avatarBox, 'Admin mobile header controls must be visible');
  assert.ok(Math.abs(menuBox.y - bellBox.y) < 16, 'Admin mobile notification control must stay on the same row as the menu');
  assert.ok(Math.abs(menuBox.y - avatarBox.y) < 16, 'Admin mobile avatar must stay on the same row as the menu');

  await mobileMenuButton.click();
  await page.locator('#admin-navigation.is-open').waitFor({ state: 'visible', timeout: 5_000 });
  assert.equal(await mobileMenuButton.getAttribute('aria-expanded'), 'true', 'Admin mobile menu must expose its open state');
  assert.equal(await page.locator('.admin-sidebar-overlay').count(), 1, 'Admin mobile menu must render exactly one dismiss overlay');

  await page.locator('.admin-sidebar-close').click();
  await page.waitForFunction(() => !document.querySelector('#admin-navigation')?.classList.contains('is-open'));
  assert.equal(await mobileMenuButton.getAttribute('aria-expanded'), 'false', 'Admin mobile menu must expose its closed state');

  await mobileMenuButton.click();
  await page.locator('#admin-navigation.is-open').waitFor({ state: 'visible', timeout: 5_000 });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#admin-navigation')?.classList.contains('is-open'));
  assert.equal(await mobileMenuButton.getAttribute('aria-expanded'), 'false', 'Escape must close the admin mobile menu');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('.route-loading'), undefined, { timeout: 15_000 });
  assert.ok(!page.url().includes('/login'), 'Admin session must remain active after a compact/mobile reload');
  await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 10_000 });

  await page.locator('.admin-mobile-menu').click();
  await page.locator('#admin-navigation.is-open').waitFor({ state: 'visible', timeout: 5_000 });
  const adminCalendarLink = page.getByRole('link', { name: 'Calendrier', exact: true });
  await adminCalendarLink.waitFor({ state: 'visible', timeout: 5_000 });
  await adminCalendarLink.click();
  await page.getByRole('heading', { name: 'Calendrier administrateur', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok(page.url().includes('/admin/calendar'), 'Admin calendar menu must open the protected administrator calendar');
  assert.equal(await page.getByLabel('Type d’activité').count(), 1, 'Admin calendar must expose activity types');
  assert.equal(await page.getByLabel('Priorité').count(), 1, 'Admin calendar must expose event priority');
  assert.equal(await page.getByLabel('Lieu / canal').count(), 1, 'Admin calendar must expose location or channel');
  const typeOptions = await page.getByLabel('Type d’activité').locator('option').allTextContents();
  assert.ok(typeOptions.some((value) => /Client \/ partenaire/i.test(value)), 'Admin calendar must support client/partner appointments');
  assert.ok(typeOptions.some((value) => /Événement LoukaTech/i.test(value)), 'Admin calendar must support LoukaTech events');
  assert.ok(typeOptions.some((value) => /Échéance/i.test(value)), 'Admin calendar must support deadlines');
  assert.equal(await page.getByRole('button', { name: /Nouvelle réunion/i }).count(), 1, 'Admin calendar must offer a direct meeting creation action');

  await page.getByRole('button', { name: /Retour administration/i }).click();
  await page.locator('.admin-topbar').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.admin-mobile-menu').click();
  await page.locator('#admin-navigation.is-open').waitFor({ state: 'visible', timeout: 5_000 });
  const adminMeetingLink = page.getByRole('link', { name: 'Réunion', exact: true });
  await adminMeetingLink.waitFor({ state: 'visible', timeout: 5_000 });
  await adminMeetingLink.click();
  await page.getByRole('heading', { name: 'Planifier une réunion', exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.ok(page.url().includes('/reunions'), 'Admin meeting menu must open the meeting creation route');
  assert.equal(await page.getByLabel('Invités (emails)').count(), 1, 'Admin meeting creation must allow inviting partners and clients by email');
  assert.equal(await page.getByRole('button', { name: 'Créer la réunion', exact: true }).count(), 1, 'Admin meeting creation must expose the create action');
  const adminMeetingNotice = (await page.locator('.real-meeting-notice').allTextContents().catch(() => [])).join(' ');
  assert.match(adminMeetingNotice, /partenaires|clients|LoukaTech/i, 'Admin meeting creation must explain its partner/client/team use case');

  assert.deepEqual(serverErrors, [], `Server 5xx responses detected:\n${serverErrors.join('\n')}`);
  assert.deepEqual(pageErrors, [], `Browser errors detected:\n${pageErrors.join('\n')}`);

  const finalMe = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  });
  assert.equal(finalMe.status, 200);
  assert.equal(finalMe.data.user?.email, 'admin.smoke@mbote.test');

  const deleteGroup = await jsonRequest(`/api/work-groups/${createGroup.data.id}`, {
    method: 'DELETE',
    headers: authHeaders(verified.data.token),
  });
  assert.equal(deleteGroup.response.status, 204);

  console.log('Authenticated multi-page application smoke checks passed, including profile, recordings, work groups and file upload.');
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
