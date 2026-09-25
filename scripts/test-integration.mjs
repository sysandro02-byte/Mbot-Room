import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import pg from 'pg';
import { io as createSocket } from 'socket.io-client';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

const port = Number(process.env.MBOTE_ROOM_TEST_PORT || 4307);
const baseUrl = `http://127.0.0.1:${port}`;
const egressPort = port + 1;
const egressBaseUrl = `http://127.0.0.1:${egressPort}`;
const egressRequests = [];
let mockEgressStatus = 'EGRESS_ACTIVE';

const mockEgressServer = createServer(async (request, response) => {
  let rawBody = '';
  for await (const chunk of request) rawBody += chunk.toString();
  const body = rawBody ? JSON.parse(rawBody) : {};
  egressRequests.push({ path: request.url, authorization: request.headers.authorization || '', body });

  const nowNs = String(BigInt(Date.now()) * 1_000_000n);
  response.setHeader('Content-Type', 'application/json');

  if (request.url?.endsWith('/StartEgress')) {
    mockEgressStatus = 'EGRESS_ACTIVE';
    response.end(JSON.stringify({
      egress_id: 'EG_TEST_RECORDING_1',
      room_name: body.room_name,
      status: 'EGRESS_ACTIVE',
      started_at: nowNs,
      file_results: [],
    }));
    return;
  }

  if (request.url?.endsWith('/ListEgress')) {
    response.end(JSON.stringify({
      items: [{
        egress_id: 'EG_TEST_RECORDING_1',
        room_name: body.room_name || '',
        status: mockEgressStatus,
        started_at: nowNs,
        file_results: mockEgressStatus === 'EGRESS_COMPLETE' ? [{
          filename: 'mboteroom-test.mp4',
          duration: '5000000000',
          size: '245760',
          location: 'https://storage.test/mboteroom-test.mp4',
        }] : [],
      }],
    }));
    return;
  }

  if (request.url?.endsWith('/StopEgress')) {
    mockEgressStatus = 'EGRESS_COMPLETE';
    response.end(JSON.stringify({
      egress_id: body.egress_id,
      status: 'EGRESS_COMPLETE',
      started_at: nowNs,
      ended_at: nowNs,
      file_results: [{
        filename: 'mboteroom-test.mp4',
        duration: '5000000000',
        size: '245760',
        location: 'https://storage.test/mboteroom-test.mp4',
      }],
    }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'Unknown mock Egress method' }));
});
await new Promise((resolve) => mockEgressServer.listen(egressPort, '127.0.0.1', resolve));

const transcriptionPort = port + 2;
const transcriptionRequests = [];
const mockTranscriptionServer = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  transcriptionRequests.push({
    method: request.method,
    authorization: request.headers.authorization || '',
    contentType: request.headers['content-type'] || '',
    bodyText: body.toString('utf8'),
  });
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({
    text: 'Décision CI issue du micro réel',
    language: 'fr',
  }));
});
await new Promise((resolve) => mockTranscriptionServer.listen(transcriptionPort, '127.0.0.1', resolve));

const mailRelayPort = port + 3;
const mailRelayRequests = [];
const mockMailRelayServer = createServer(async (request, response) => {
  let rawBody = '';
  for await (const chunk of request) rawBody += chunk.toString();
  mailRelayRequests.push({
    path: request.url,
    secret: request.headers['x-mbote-room-mail-secret'] || '',
    body: rawBody ? JSON.parse(rawBody) : {},
  });
  response.statusCode = 202;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ success: true }));
});
await new Promise((resolve) => mockMailRelayServer.listen(mailRelayPort, '127.0.0.1', resolve));

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
    MBOTE_ROOM_ALLOWED_ORIGIN_PATTERNS: 'https://mbote-room-*.vercel.app',
    MBOTE_ROOM_APP_URL: baseUrl,
    MBOTE_MAIL_RELAY_URL: `http://127.0.0.1:${mailRelayPort}/email`,
    MBOTE_ROOM_MAIL_SECRET: 'integration-mail-secret',
    BREVO_API_KEY: '',
    ADMIN_EMAILS: 'host.integration@mbote.test',
    RESEND_API_KEY: '',
    GROQ_API_KEY: '',
    GROQ_TRANSCRIPTION_API_KEY: 'transcription-test-key',
    GROQ_TRANSCRIPTION_URL: `http://127.0.0.1:${transcriptionPort}/transcriptions`,
    GROQ_TRANSCRIPTION_MODEL: 'whisper-large-v3-turbo',
    CAPTION_CHUNK_SECONDS: '10',
    MEDIA_TRANSPORT: 'livekit',
    LIVEKIT_URL: `ws://127.0.0.1:${egressPort}`,
    LIVEKIT_API_KEY: 'test-api-key',
    LIVEKIT_API_SECRET: 'test-api-secret',
    LIVEKIT_TOKEN_TTL_SECONDS: '900',
    LIVEKIT_EGRESS_ENABLED: 'true',
    LIVEKIT_EGRESS_USE_SERVER_DEFAULT_STORAGE: 'true',
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
      if (response.ok) return response.json();
    } catch {
      // Server is still starting.
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

const decodeAndVerifyJwt = (token, secret) => {
  const [header, payload, signature] = String(token || '').split('.');
  assert.ok(header && payload && signature, 'JWT must have three parts');
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  assert.equal(signature, expected, 'JWT signature must match');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

const register = async (name, email, admin = false) => {
  const result = await jsonRequest(admin ? '/api/auth/admin/register' : '/api/auth/register', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ name, email, password: 'Password2026!', country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true, termsVersion: '2026-09-24' }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  let session = result;
  if (admin) {
    assert.equal(result.response.headers.get('set-cookie'), null, 'Admin registration must not create a session before email verification');
    assert.ok(result.data.challengeId);
    const mail = mailRelayRequests.at(-1);
    const code = String(mail?.body?.text || '').match(/est (\d{6})\./)?.[1];
    assert.ok(code, 'Admin registration must send a verification code');
    session = await jsonRequest('/api/auth/login/otp', {
      method: 'POST', headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
      body: JSON.stringify({ challengeId: result.data.challengeId, code }),
    });
    assert.equal(session.response.status, 200, JSON.stringify(session.data));
  }
  assert.ok(session.data.token);
  assert.ok(session.data.user?.id);
  const setCookie = session.response.headers.get('set-cookie') || '';
  assert.match(setCookie, /mbote_room_session=/);
  assert.match(setCookie, /HttpOnly/i);
  return {
    ...session.data,
    cookie: setCookie.split(';')[0],
  };
};

const socketConnect = (token) => new Promise((resolve, reject) => {
  const socket = createSocket(baseUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: 5_000,
  });
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Socket.IO connection timeout'));
  }, 7_000);
  socket.once('connect', () => {
    clearTimeout(timer);
    resolve(socket);
  });
  socket.once('connect_error', (error) => {
    clearTimeout(timer);
    socket.close();
    reject(error);
  });
});

const socketConnectWithCookie = (cookie) => new Promise((resolve, reject) => {
  const socket = createSocket(baseUrl, {
    extraHeaders: { Cookie: cookie, Origin: baseUrl },
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: 5_000,
  });
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Cookie-authenticated Socket.IO connection timeout'));
  }, 7_000);
  socket.once('connect', () => {
    clearTimeout(timer);
    resolve(socket);
  });
  socket.once('connect_error', (error) => {
    clearTimeout(timer);
    socket.close();
    reject(error);
  });
});

const socketAck = (socket, event, payload) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Socket ack timeout: ${event}`)), 7_000);
  socket.emit(event, payload, (response) => {
    clearTimeout(timer);
    resolve(response);
  });
});

const waitForSocketEvent = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off(event, handler);
    reject(new Error(`Socket event timeout: ${event}`));
  }, 7_000);
  const handler = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    socket.off(event, handler);
    resolve(payload);
  };
  socket.on(event, handler);
});

const expectRejectedSocket = (token = '') => new Promise((resolve, reject) => {
  const socket = createSocket(baseUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: false,
    timeout: 4_000,
  });
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Expected Socket.IO authentication rejection'));
  }, 6_000);
  socket.once('connect', () => {
    clearTimeout(timer);
    socket.close();
    reject(new Error('Unauthenticated Socket.IO connection was accepted'));
  });
  socket.once('connect_error', (error) => {
    clearTimeout(timer);
    const code = error?.data?.code;
    socket.close();
    assert.equal(code, 'REALTIME_AUTH_REQUIRED');
    resolve();
  });
});

let hostSocket;
let participantSocket;

try {
  const health = await waitForServer();
  assert.equal(health.ok, true);
  assert.equal(health.database?.connected, true);
  assert.equal(health.database?.type, 'postgres');

  assert.equal(health.media?.topology, 'mesh');
  assert.equal(health.media?.turnConfigured, false);

  const publicTerms = await jsonRequest('/api/public/legal/terms');
  assert.equal(publicTerms.response.status, 200, JSON.stringify(publicTerms.data));
  assert.equal(publicTerms.data.version, '2026-09-24');
  assert.ok(String(publicTerms.data.body||'').length > 80);

  const publicSecurityPage = await jsonRequest('/api/public/pages/security');
  assert.equal(publicSecurityPage.response.status, 200, JSON.stringify(publicSecurityPage.data));
  assert.equal(publicSecurityPage.data.key, 'security');
  assert.ok(String(publicSecurityPage.data.body || '').length > 80);

  const registrationWithoutTerms = await jsonRequest('/api/auth/register', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ name: 'Sans Conditions', email: 'sans.conditions@mbote.test', password: 'Password2026!' }),
  });
  assert.equal(registrationWithoutTerms.response.status, 400, JSON.stringify(registrationWithoutTerms.data));
  assert.equal(registrationWithoutTerms.data.code, 'TERMS_NOT_ACCEPTED');

  const previewOrigin = 'https://mbote-room-pr-123.vercel.app';
  const corsPreflight = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: previewOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-mbote-room-session-mode',
    },
  });
  assert.equal(corsPreflight.status, 204);
  assert.equal(corsPreflight.headers.get('access-control-allow-origin'), previewOrigin);
  assert.match(corsPreflight.headers.get('access-control-allow-headers') || '', /X-MBote-Room-Session-Mode/i);

  const blockedPreflight = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://unrelated-project.vercel.app',
      'Access-Control-Request-Method': 'POST',
    },
  });
  assert.equal(blockedPreflight.status, 403);

  await expectRejectedSocket();

  const host = await register('Hôte Integration', 'host.integration@mbote.test', true);
  assert.equal(host.user.role, 'admin');
  const hostWelcomeMail = mailRelayRequests.at(-1);
  assert.equal(hostWelcomeMail?.body?.to, 'host.integration@mbote.test');
  assert.match(String(hostWelcomeMail?.body?.subject || ''), /Bienvenue sur MBotéRoom/i);
  assert.doesNotMatch(String(hostWelcomeMail?.body?.text || ''), /Password2026!/i, 'Welcome email must never expose the password');

  const deniedSecondAdmin = await jsonRequest('/api/auth/admin/register', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ name: 'Admin Sans Invitation', email: 'second.admin@mbote.test', password: 'Password2026!' }),
  });
  assert.equal(deniedSecondAdmin.response.status, 403, JSON.stringify(deniedSecondAdmin.data));
  assert.equal(deniedSecondAdmin.data.code, 'ADMIN_INVITE_REQUIRED');

  const adminInvite = await jsonRequest('/api/admin/admin-invites', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ email: 'second.admin@mbote.test' }),
  });
  assert.equal(adminInvite.response.status, 201, JSON.stringify(adminInvite.data));
  const inviteUrl = new URL(adminInvite.data.invitePath, baseUrl);
  const inviteToken = inviteUrl.searchParams.get('invite');
  assert.ok(inviteToken, 'Admin invite must expose a one-time invitation token to the authenticated creator');

  const invitedAdminRegister = await jsonRequest('/api/auth/admin/register', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({
      name: 'Second Admin Integration',
      email: 'second.admin@mbote.test',
      password: 'Password2026!',
      inviteToken,
    }),
  });
  assert.equal(invitedAdminRegister.response.status, 201, JSON.stringify(invitedAdminRegister.data));
  const invitedAdminOtpMail = mailRelayRequests.at(-1);
  const invitedAdminOtp = String(invitedAdminOtpMail?.body?.text || '').match(/\b\d{6}\b/)?.[0];
  assert.ok(invitedAdminOtp, 'Invited admin registration must send an OTP');
  const invitedAdminVerify = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ challengeId: invitedAdminRegister.data.challengeId, code: invitedAdminOtp }),
  });
  assert.equal(invitedAdminVerify.response.status, 200, JSON.stringify(invitedAdminVerify.data));
  assert.equal(invitedAdminVerify.data.user?.role, 'admin');
  assert.ok(invitedAdminVerify.data.token);

  const updatedSecurityPage = await jsonRequest('/api/admin/public-pages/security', {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'Sécurité MBotéRoom CI',
      body: 'Contenu dynamique de sécurité utilisé par le test d’intégration. Cette page est stockée dans PostgreSQL et modifiable depuis les API administrateur.',
    }),
  });
  assert.equal(updatedSecurityPage.response.status, 200, JSON.stringify(updatedSecurityPage.data));
  const reloadedSecurityPage = await jsonRequest('/api/public/pages/security');
  assert.equal(reloadedSecurityPage.response.status, 200, JSON.stringify(reloadedSecurityPage.data));
  assert.equal(reloadedSecurityPage.data.title, 'Sécurité MBotéRoom CI');

  const browserLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'host.integration@mbote.test',
      password: 'Password2026!',
      rememberMe: true,
    }),
  });
  assert.equal(browserLogin.response.status, 200, JSON.stringify(browserLogin.data));
  assert.equal(browserLogin.data.otpRequired, true);
  assert.ok(browserLogin.data.challengeId);
  assert.equal(browserLogin.response.headers.get('set-cookie'), null, 'Password step must not create a session before OTP');
  const browserOtpMail = mailRelayRequests.at(-1);
  assert.equal(browserOtpMail?.body?.to, 'host.integration@mbote.test');
  const browserOtp = String(browserOtpMail?.body?.text || '').match(/\b\d{6}\b/)?.[0];
  assert.ok(browserOtp, 'Login OTP email must contain a six-digit code');

  const wrongBrowserOtp = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    body: JSON.stringify({ challengeId: browserLogin.data.challengeId, code: '000000' }),
  });
  assert.equal(wrongBrowserOtp.response.status, 401);
  assert.equal(wrongBrowserOtp.data.code, 'OTP_INVALID');

  const browserOtpVerify = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    body: JSON.stringify({ challengeId: browserLogin.data.challengeId, code: browserOtp }),
  });
  assert.equal(browserOtpVerify.response.status, 200, JSON.stringify(browserOtpVerify.data));
  assert.equal(browserOtpVerify.data.token, undefined, 'Browser OTP session must not expose a bearer token');
  const browserSetCookie = browserOtpVerify.response.headers.get('set-cookie') || '';
  assert.match(browserSetCookie, /mbote_room_session=/);
  assert.match(browserSetCookie, /HttpOnly/i);
  assert.match(browserSetCookie, /SameSite=Lax/i);
  const browserCookie = browserSetCookie.split(';')[0];

  const reusedBrowserOtp = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    body: JSON.stringify({ challengeId: browserLogin.data.challengeId, code: browserOtp }),
  });
  assert.equal(reusedBrowserOtp.response.status, 400);
  assert.equal(reusedBrowserOtp.data.code, 'OTP_EXPIRED');

  const browserMe = await jsonRequest('/api/auth/me', { headers: { Cookie: browserCookie } });
  assert.equal(browserMe.response.status, 200, JSON.stringify(browserMe.data));
  assert.equal(browserMe.data.user.email, 'host.integration@mbote.test');

  const browserActivity = await jsonRequest('/api/auth/activity', {
    method: 'POST',
    headers: { Cookie: browserCookie },
  });
  assert.equal(browserActivity.response.status, 204, JSON.stringify(browserActivity.data));

  const idleToken = crypto.randomBytes(32).toString('base64url');
  const idleNow = new Date();
  const idleDb = new pg.Pool({ connectionString: databaseUrl, ssl: false });
  await idleDb.query(
    `INSERT INTO room_sessions (token_hash,user_id,created_at,expires_at,last_activity)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      crypto.createHash('sha256').update(idleToken).digest('hex'),
      host.user.id,
      idleNow.toISOString(),
      new Date(idleNow.getTime()+60*60_000).toISOString(),
      new Date(idleNow.getTime()-6*60_000).toISOString(),
    ],
  );
  await idleDb.end();
  const idleExpired = await jsonRequest('/api/auth/me', { headers: authHeaders(idleToken) });
  assert.equal(idleExpired.response.status, 401, 'Server must reject a session inactive for more than five minutes');

  const browserLogout = await jsonRequest('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: browserCookie },
  });
  assert.equal(browserLogout.response.status, 204);
  const browserMeAfterLogout = await jsonRequest('/api/auth/me', { headers: { Cookie: browserCookie } });
  assert.equal(browserMeAfterLogout.response.status, 401);

  const passwordResetUser = await register('Compte Réinitialisation', 'reset.integration@mbote.test');
  const mailsBeforeReset = mailRelayRequests.length;
  const forgotPassword = await jsonRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'reset.integration@mbote.test' }),
  });
  assert.equal(forgotPassword.response.status, 200, JSON.stringify(forgotPassword.data));
  assert.equal(forgotPassword.data.success, true);
  assert.equal(mailRelayRequests.length, mailsBeforeReset + 1);
  const resetMail = mailRelayRequests.at(-1);
  assert.equal(resetMail.secret, 'integration-mail-secret');
  assert.equal(resetMail.body.to, 'reset.integration@mbote.test');
  assert.match(String(resetMail.body.subject || ''), /Réinitialisez votre mot de passe MBotéRoom/i);
  const resetLink = String(resetMail.body.text || '').match(/https?:\/\/\S+/)?.[0];
  assert.ok(resetLink, 'Password reset email must contain a link');
  const resetUrl = new URL(resetLink);
  assert.equal(resetUrl.origin, baseUrl);
  assert.equal(resetUrl.pathname, '/mot-de-passe-oublie');
  assert.equal(resetUrl.searchParams.has('token'), false, 'Password reset token must not appear in the query string');
  const resetHash = new URLSearchParams(resetUrl.hash.replace(/^#/, ''));
  const resetToken = resetHash.get('reset');
  assert.ok(resetToken, 'Password reset link must contain its one-time token in the URL fragment');

  const shortResetPassword = await jsonRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'court' }),
  });
  assert.equal(shortResetPassword.response.status, 400);
  assert.equal(shortResetPassword.data.code, 'PASSWORD_WEAK');

  const resetPassword = await jsonRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'NouveauPassword2026!' }),
  });
  assert.equal(resetPassword.response.status, 200, JSON.stringify(resetPassword.data));
  assert.equal(resetPassword.data.success, true);

  const reusedResetToken = await jsonRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetToken, password: 'EncorePassword2026!' }),
  });
  assert.equal(reusedResetToken.response.status, 400);
  assert.equal(reusedResetToken.data.code, 'PASSWORD_RESET_INVALID');

  const oldPasswordLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'reset.integration@mbote.test', password: 'Password2026!' }),
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ email: 'reset.integration@mbote.test', password: 'NouveauPassword2026!' }),
  });
  assert.equal(newPasswordLogin.response.status, 200, JSON.stringify(newPasswordLogin.data));
  assert.equal(newPasswordLogin.data.otpRequired, true);
  assert.ok(newPasswordLogin.data.challengeId);
  const resetLoginOtpMail = mailRelayRequests.at(-1);
  const resetLoginOtp = String(resetLoginOtpMail?.body?.text || '').match(/\b\d{6}\b/)?.[0];
  assert.ok(resetLoginOtp, 'Password login after reset must send an OTP');
  const newPasswordOtpVerify = await jsonRequest('/api/auth/login/otp', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ challengeId: newPasswordLogin.data.challengeId, code: resetLoginOtp }),
  });
  assert.equal(newPasswordOtpVerify.response.status, 200, JSON.stringify(newPasswordOtpVerify.data));
  assert.ok(newPasswordOtpVerify.data.token);

  const resetUserOldSession = await jsonRequest('/api/auth/me', { headers: authHeaders(passwordResetUser.token) });
  assert.equal(resetUserOldSession.response.status, 401, 'Password reset must revoke existing sessions');

  const participant = await register('Participant Integration', 'participant.integration@mbote.test');
  assert.equal(participant.user.role, 'user');
  const outsider = await register('Participant Bloqué', 'outsider.integration@mbote.test');
  assert.equal(outsider.user.role, 'user');
  const bannedMessagingUser = await register('Compte Bannissement Messagerie', 'banned.messaging.integration@mbote.test');
  assert.equal(bannedMessagingUser.user.role, 'user');
  const attacker = await register('Attaquant Integration', 'attacker.integration@mbote.test');
  assert.equal(attacker.user.role, 'user');

  const moveAttacker = await jsonRequest('/api/admin/users/'+attacker.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ city: 'Pointe-Noire' }),
  });
  assert.equal(moveAttacker.response.status, 200, JSON.stringify(moveAttacker.data));

  const tamperedToken = participant.token.slice(0,-1) + (participant.token.endsWith('a') ? 'b' : 'a');
  const tamperedSession = await jsonRequest('/api/auth/me', { headers: authHeaders(tamperedToken) });
  assert.equal(tamperedSession.response.status, 401, 'A falsified bearer token must be rejected');

  const hostileOrigin = await fetch(baseUrl+'/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(hostileOrigin.status, 403, 'Untrusted origins must be rejected');

  const serverSource = await fetch(baseUrl+'/server.js', { headers: { Origin: baseUrl } });
  assert.equal(serverSource.status, 404, 'Server source must not be publicly exposed');
  const sourceMap = await fetch(baseUrl+'/assets/app.js.map', { headers: { Origin: baseUrl } });
  assert.equal(sourceMap.status, 404, 'Source maps must not be publicly exposed');

  const sqlLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
    body: JSON.stringify({ email: "' OR 1=1--@evil.test", password: "x' OR '1'='1" }),
  });
  assert.ok(sqlLogin.response.status >= 400 && sqlLogin.response.status < 500, JSON.stringify(sqlLogin.data));
  assert.equal(Boolean(sqlLogin.data.challengeId), false, 'SQL injection input must never create an auth challenge');

  const sqlAdminSearch = await jsonRequest('/api/admin/users?q='+encodeURIComponent("' OR 1=1--"), {
    headers: authHeaders(host.token),
  });
  assert.equal(sqlAdminSearch.response.status, 200, JSON.stringify(sqlAdminSearch.data));
  assert.equal(sqlAdminSearch.data.length, 0, 'Parameterized admin search must not expand SQL predicates');


  const quarantineOutsider = await jsonRequest('/api/admin/users/'+outsider.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ accountStatus: 'quarantined' }),
  });
  assert.equal(quarantineOutsider.response.status, 200, JSON.stringify(quarantineOutsider.data));
  assert.equal(quarantineOutsider.data.accountStatus, 'quarantined');
  const quarantinedCreateMeeting = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(outsider.token),
    body: JSON.stringify({ title: 'Doit être bloquée', startTime: new Date().toISOString(), duration: 30 }),
  });
  assert.equal(quarantinedCreateMeeting.response.status, 403, JSON.stringify(quarantinedCreateMeeting.data));
  assert.equal(quarantinedCreateMeeting.data.code, 'ACCOUNT_QUARANTINED');

  const restrictOutsider = await jsonRequest('/api/admin/users/'+outsider.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ accountStatus: 'active', featureRestrictions: ['meetings'] }),
  });
  assert.equal(restrictOutsider.response.status, 200, JSON.stringify(restrictOutsider.data));
  assert.deepEqual(restrictOutsider.data.featureRestrictions, ['meetings']);
  const restrictedCreateMeeting = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(outsider.token),
    body: JSON.stringify({ title: 'Toujours bloquée', startTime: new Date().toISOString(), duration: 30 }),
  });
  assert.equal(restrictedCreateMeeting.response.status, 403, JSON.stringify(restrictedCreateMeeting.data));
  assert.equal(restrictedCreateMeeting.data.code, 'FEATURE_RESTRICTED');
  const restoreOutsider = await jsonRequest('/api/admin/users/'+outsider.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ accountStatus: 'active', featureRestrictions: [] }),
  });
  assert.equal(restoreOutsider.response.status, 200, JSON.stringify(restoreOutsider.data));

  const userToUserConversation = await jsonRequest('/api/conversations/direct', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ contactUserId: outsider.user.id }),
  });
  assert.equal(userToUserConversation.response.status, 201, JSON.stringify(userToUserConversation.data));
  const outsiderMessageSocket = await socketConnect(outsider.token);
  const userToUserRealtime = waitForSocketEvent(
    outsiderMessageSocket,
    'conversation:message',
    (payload) => payload?.conversationId === userToUserConversation.data.id && payload?.text === 'Message user vers user CI',
  );
  const userToUserSend = await jsonRequest('/api/conversations/'+encodeURIComponent(userToUserConversation.data.id)+'/messages', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ text: 'Message user vers user CI' }),
  });
  assert.equal(userToUserSend.response.status, 201, JSON.stringify(userToUserSend.data));
  const receivedUserToUser = await userToUserRealtime;
  assert.equal(receivedUserToUser.sender, 'Participant Integration');
  const outsiderThread = await jsonRequest('/api/conversations/'+encodeURIComponent(userToUserConversation.data.id)+'/messages', {
    headers: authHeaders(outsider.token),
  });
  assert.equal(outsiderThread.response.status, 200, JSON.stringify(outsiderThread.data));
  assert.ok(outsiderThread.data.some((item) => item.text === 'Message user vers user CI' && Number(item.userId) === Number(participant.user.id)));
  outsiderMessageSocket.close();

  const idorThread = await jsonRequest('/api/conversations/'+encodeURIComponent(userToUserConversation.data.id)+'/messages', {
    headers: authHeaders(attacker.token),
  });
  assert.equal(idorThread.response.status, 403, 'A non-member must not read another direct conversation');


  const adminToUserConversation = await jsonRequest('/api/conversations/direct', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ contactUserId: participant.user.id }),
  });
  assert.equal(adminToUserConversation.response.status, 201, JSON.stringify(adminToUserConversation.data));
  const participantDirectSocket = await socketConnect(participant.token);
  const adminToUserRealtime = waitForSocketEvent(
    participantDirectSocket,
    'conversation:message',
    (payload) => payload?.conversationId === adminToUserConversation.data.id && payload?.text === 'Message admin vers user CI',
  );
  const adminToUserSend = await jsonRequest('/api/conversations/'+encodeURIComponent(adminToUserConversation.data.id)+'/messages', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ text: 'Message admin vers user CI' }),
  });
  assert.equal(adminToUserSend.response.status, 201, JSON.stringify(adminToUserSend.data));
  const receivedAdminToUser = await adminToUserRealtime;
  assert.equal(receivedAdminToUser.sender, 'Hôte Integration');
  const participantThread = await jsonRequest('/api/conversations/'+encodeURIComponent(adminToUserConversation.data.id)+'/messages', {
    headers: authHeaders(participant.token),
  });
  assert.equal(participantThread.response.status, 200, JSON.stringify(participantThread.data));
  assert.ok(participantThread.data.some((item) => item.text === 'Message admin vers user CI' && Number(item.userId) === Number(host.user.id)));
  participantDirectSocket.close();

  const banMessagingAccount = await jsonRequest('/api/admin/users/'+bannedMessagingUser.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ accountStatus: 'banned' }),
  });
  assert.equal(banMessagingAccount.response.status, 200, JSON.stringify(banMessagingAccount.data));
  const bannedDirectorySearch = await jsonRequest('/api/contacts/search?q=Compte%20Bannissement%20Messagerie', {
    headers: authHeaders(participant.token),
  });
  assert.equal(bannedDirectorySearch.response.status, 200, JSON.stringify(bannedDirectorySearch.data));
  assert.equal(bannedDirectorySearch.data.some((item) => Number(item.id) === Number(bannedMessagingUser.user.id)), false);
  const bannedDirectAttempt = await jsonRequest('/api/conversations/direct', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ contactUserId: bannedMessagingUser.user.id }),
  });
  assert.equal(bannedDirectAttempt.response.status, 404, JSON.stringify(bannedDirectAttempt.data));

  const deniedAdAdmin = await jsonRequest('/api/admin/ads', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ title: 'Interdit', body: 'Ne doit jamais être créé', isActive: true }),
  });
  assert.equal(deniedAdAdmin.response.status, 403, 'A normal user must not create advertising campaigns');

  const unsafeAd = await jsonRequest('/api/admin/ads', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'URL dangereuse',
      body: 'Test de sécurité',
      actionLabel: 'Ouvrir',
      actionUrl: 'javascript:alert(1)',
      isActive: true,
    }),
  });
  assert.equal(unsafeAd.response.status, 400, JSON.stringify(unsafeAd.data));
  assert.equal(unsafeAd.data.code, 'AD_ACTION_INVALID');

  const createdAd = await jsonRequest('/api/admin/ads', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: '<img src=x onerror=alert(1)>',
      body: '<script>alert("xss")</script> Ceci doit rester du texte.',
      actionLabel: 'Voir',
      actionUrl: '/app/notifications',
      audience: {
        role: 'user',
        accountStatus: 'active',
        country: 'Congo-Brazzaville',
        city: 'Brazzaville',
      },
      isActive: true,
      maxImpressionsPerUser: 2,
      cooldownHours: 0,
      dismissible: true,
      priority: 900,
    }),
  });
  assert.equal(createdAd.response.status, 201, JSON.stringify(createdAd.data));
  assert.equal(createdAd.data.title, '<img src=x onerror=alert(1)>');

  const activeAd = await jsonRequest('/api/ads/active', { headers: authHeaders(participant.token) });
  assert.equal(activeAd.response.status, 200, JSON.stringify(activeAd.data));
  assert.equal(activeAd.data.id, createdAd.data.id);
  assert.equal(activeAd.data.body, '<script>alert("xss")</script> Ceci doit rester du texte.');

  const excludedAd = await jsonRequest('/api/ads/active', { headers: authHeaders(attacker.token) });
  assert.equal(excludedAd.response.status, 204, 'A user outside the targeted city must not receive the campaign');

  const forgedAdClick = await jsonRequest('/api/ads/'+encodeURIComponent(createdAd.data.id)+'/click', {
    method: 'POST',
    headers: authHeaders(attacker.token),
  });
  assert.equal(forgedAdClick.response.status, 403, 'A non-targeted account must not forge advertising statistics');

  const impression = await jsonRequest('/api/ads/'+encodeURIComponent(createdAd.data.id)+'/impression', {
    method: 'POST',
    headers: authHeaders(participant.token),
  });
  assert.equal(impression.response.status, 200, JSON.stringify(impression.data));
  const adClick = await jsonRequest('/api/ads/'+encodeURIComponent(createdAd.data.id)+'/click', {
    method: 'POST',
    headers: authHeaders(participant.token),
  });
  assert.equal(adClick.response.status, 200, JSON.stringify(adClick.data));
  const adDismiss = await jsonRequest('/api/ads/'+encodeURIComponent(createdAd.data.id)+'/dismiss', {
    method: 'POST',
    headers: authHeaders(participant.token),
  });
  assert.equal(adDismiss.response.status, 200, JSON.stringify(adDismiss.data));

  const adStats = await jsonRequest('/api/admin/ads', { headers: authHeaders(host.token) });
  assert.equal(adStats.response.status, 200, JSON.stringify(adStats.data));
  const testedAd = adStats.data.find((item) => item.id === createdAd.data.id);
  assert.equal(testedAd.impressions, 1);
  assert.equal(testedAd.clicks, 1);
  assert.equal(testedAd.dismissals, 1);
  assert.equal(testedAd.uniqueViewers, 1);

  const audienceOptions = await jsonRequest('/api/admin/broadcasts/audience-options', { headers: authHeaders(host.token) });
  assert.equal(audienceOptions.response.status, 200, JSON.stringify(audienceOptions.data));
  assert.ok(Number(audienceOptions.data.totals?.users || 0) >= 3);

  const audiencePreview = await jsonRequest('/api/admin/broadcasts/preview', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      audience: {
        role: 'user',
        accountStatus: 'active',
        country: 'Congo-Brazzaville',
        city: 'Brazzaville',
      },
    }),
  });
  assert.equal(audiencePreview.response.status, 200, JSON.stringify(audiencePreview.data));
  assert.ok(audiencePreview.data.count >= 3);

  const participantBroadcastSocket = await socketConnect(participant.token);
  const participantBroadcastEvent = waitForSocketEvent(
    participantBroadcastSocket,
    'notification:new',
    (payload) => payload?.type === 'ADMIN_BROADCAST' && payload?.title === 'Information ciblée CI',
  );
  const sentBroadcast = await jsonRequest('/api/admin/broadcasts', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'Information ciblée CI',
      body: 'Message administrateur ciblé par pays et ville.',
      actionPath: '/app/notifications',
      push: false,
      audience: {
        role: 'user',
        accountStatus: 'active',
        country: 'Congo-Brazzaville',
        city: 'Brazzaville',
      },
    }),
  });
  assert.equal(sentBroadcast.response.status, 201, JSON.stringify(sentBroadcast.data));
  assert.ok(sentBroadcast.data.recipientCount >= 3);
  const realtimeBroadcast = await participantBroadcastEvent;
  assert.equal(realtimeBroadcast.body, 'Message administrateur ciblé par pays et ville.');
  participantBroadcastSocket.close();

  const participantNotifications = await jsonRequest('/api/notifications', { headers: authHeaders(participant.token) });
  assert.equal(participantNotifications.response.status, 200, JSON.stringify(participantNotifications.data));
  assert.ok(participantNotifications.data.some((item) => item.type === 'ADMIN_BROADCAST' && item.title === 'Information ciblée CI'));

  const broadcastHistory = await jsonRequest('/api/admin/broadcasts', { headers: authHeaders(host.token) });
  assert.equal(broadcastHistory.response.status, 200, JSON.stringify(broadcastHistory.data));
  assert.equal(broadcastHistory.data[0]?.title, 'Information ciblée CI');

  const aiInsights = await jsonRequest('/api/admin/ai/insights', { headers: authHeaders(host.token) });
  assert.equal(aiInsights.response.status, 200, JSON.stringify(aiInsights.data));
  assert.equal(aiInsights.data.provider, 'local-metrics');

  const hostMe = await jsonRequest('/api/auth/me', { headers: authHeaders(host.token) });
  assert.equal(hostMe.response.status, 200);
  assert.equal(hostMe.data.user.email, 'host.integration@mbote.test');

  const hostMeCookieOnly = await jsonRequest('/api/auth/me', {
    headers: { Cookie: host.cookie },
  });
  assert.equal(hostMeCookieOnly.response.status, 200, JSON.stringify(hostMeCookieOnly.data));
  assert.equal(hostMeCookieOnly.data.user.email, 'host.integration@mbote.test');

  const cookieSocket = await socketConnectWithCookie(host.cookie);
  assert.equal(cookieSocket.connected, true);
  cookieSocket.close();

  const rtcConfig = await jsonRequest('/api/rtc/config', { headers: authHeaders(host.token) });
  assert.equal(rtcConfig.response.status, 200, JSON.stringify(rtcConfig.data));
  assert.ok(Array.isArray(rtcConfig.data.iceServers));
  assert.ok(rtcConfig.data.iceServers.length >= 1);
  assert.equal(rtcConfig.data.turnConfigured, false);

  const deniedAdmin = await jsonRequest('/api/admin/dashboard', { headers: authHeaders(participant.token) });
  assert.equal(deniedAdmin.response.status, 403);
  assert.equal(deniedAdmin.data.code, 'ADMIN_ACCESS_DENIED');

  const adminDashboard = await jsonRequest('/api/admin/dashboard', { headers: authHeaders(host.token) });
  assert.equal(adminDashboard.response.status, 200, JSON.stringify(adminDashboard.data));

  let rateLimitedStatus = 0;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const bruteForce = await jsonRequest('/api/auth/login', {
      method: 'POST',
      headers: { 'X-MBote-Room-Session-Mode': 'bearer' },
      body: JSON.stringify({ email: 'rate.attack@mbote.test', password: 'WrongPassword2026!' }),
    });
    rateLimitedStatus = bruteForce.response.status;
  }
  assert.equal(rateLimitedStatus, 429, 'Repeated login attempts must be rate limited');


  const createMeeting = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'Réunion intégration réelle',
      description: 'Validation PostgreSQL + Socket.IO',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 60,
      settings: {
        password: 'RoomPass2026!',
        waitingRoom: true,
        participantCapacity: 2,
        chat: true,
        reactions: true,
        joinBeforeHost: false,
        lunaSummary: true,
      },
    }),
  });
  assert.equal(createMeeting.response.status, 201, JSON.stringify(createMeeting.data));
  const meeting = createMeeting.data;
  assert.ok(meeting.id);
  assert.ok(meeting.meeting_link);
  assert.equal(meeting.settings?.passwordHash, undefined);
  assert.equal(meeting.settings?.passwordSalt, undefined);

  const reportMailCount = mailRelayRequests.length;
  const report = await jsonRequest('/api/reports', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({
      type: 'meeting',
      meetingId: meeting.id,
      title: 'Réunion à vérifier',
      description: 'Le participant signale un problème de modération pendant cette réunion.',
      pageUrl: baseUrl+'/reunions/'+meeting.meeting_link,
    }),
  });
  assert.equal(report.response.status, 201, JSON.stringify(report.data));
  assert.equal(report.data.type, 'meeting');
  const reportMails = mailRelayRequests.slice(reportMailCount);
  assert.ok(reportMails.some((mail)=>mail.body?.to==='contacts@loukatech.com'), 'Support mailbox must receive the report');
  assert.ok(reportMails.some((mail)=>mail.body?.to==='host.integration@mbote.test'), 'Application admin must receive a report copy');
  const adminReports = await jsonRequest('/api/admin/reports', { headers: authHeaders(host.token) });
  assert.equal(adminReports.response.status, 200, JSON.stringify(adminReports.data));
  assert.ok(adminReports.data.some((item)=>item.id===report.data.id));
  const adminNotifications = await jsonRequest('/api/notifications', { headers: authHeaders(host.token) });
  assert.equal(adminNotifications.response.status, 200, JSON.stringify(adminNotifications.data));
  assert.ok(adminNotifications.data.some((item)=>item.type==='USER_REPORT'&&String(item.data?.reportId||'')===String(report.data.id)), 'Admin should receive an in-app notification for a new report');

  const wrongPassword = await jsonRequest('/api/meetings/join-lookup', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ value: meeting.meeting_link, password: 'wrong' }),
  });
  assert.equal(wrongPassword.response.status, 403);
  assert.equal(wrongPassword.data.code, 'MEETING_PASSWORD_INVALID');

  const lookup = await jsonRequest('/api/meetings/join-lookup', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ value: meeting.meeting_link, password: 'RoomPass2026!' }),
  });
  assert.equal(lookup.response.status, 200, JSON.stringify(lookup.data));

  const joinRequest = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ password: 'RoomPass2026!' }),
  });
  assert.equal(joinRequest.response.status, 200, JSON.stringify(joinRequest.data));
  assert.equal(joinRequest.data.status, 'requested');

  const lobby = await jsonRequest(`/api/meetings/${meeting.id}/lobby`, { headers: authHeaders(host.token) });
  assert.equal(lobby.response.status, 200);
  assert.ok(lobby.data.some((item) => Number(item.user_id) === Number(participant.user.id) && item.status === 'requested'));

  const admitAll = await jsonRequest(`/api/meetings/${meeting.id}/lobby/admit-all`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(admitAll.response.status, 200, JSON.stringify(admitAll.data));
  assert.equal(admitAll.data.admitted, 1);
  assert.ok(admitAll.data.userIds.includes(Number(participant.user.id)));

  const start = await jsonRequest(`/api/meetings/${meeting.id}/start-notify`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(start.response.status, 200, JSON.stringify(start.data));
  assert.equal(start.data.meeting?.is_active, true);

  const participants = await jsonRequest(`/api/meetings/${meeting.id}/participants`, { headers: authHeaders(host.token) });
  assert.equal(participants.response.status, 200);
  assert.ok(participants.data.some((item) => Number(item.userId) === Number(host.user.id)));
  assert.ok(participants.data.some((item) => Number(item.userId) === Number(participant.user.id)));

  const transcriptionStatus = await jsonRequest('/api/transcription/status');
  assert.equal(transcriptionStatus.response.status, 200, JSON.stringify(transcriptionStatus.data));
  assert.equal(transcriptionStatus.data.configured, true);
  assert.equal(transcriptionStatus.data.model, 'whisper-large-v3-turbo');
  assert.equal(transcriptionStatus.data.chunkSeconds, 10);

  const audioResponse = await fetch(`${baseUrl}/api/meetings/${meeting.id}/transcription/chunk?language=fr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${participant.token}`,
      Origin: baseUrl,
      'Content-Type': 'audio/webm',
    },
    body: Buffer.alloc(2048, 7),
  });
  const audioCaption = await audioResponse.json();
  assert.equal(audioResponse.status, 201, JSON.stringify(audioCaption));
  assert.equal(audioCaption.text, 'Décision CI issue du micro réel');
  assert.equal(audioCaption.provider, 'groq-whisper');
  assert.equal(audioCaption.language, 'fr');

  assert.equal(transcriptionRequests.length, 1);
  assert.equal(transcriptionRequests[0].authorization, 'Bearer transcription-test-key');
  assert.match(transcriptionRequests[0].contentType, /^multipart\/form-data; boundary=/);
  assert.match(transcriptionRequests[0].bodyText, /whisper-large-v3-turbo/);
  assert.match(transcriptionRequests[0].bodyText, /mboteroom-caption\.webm/);

  const browserCaption = await jsonRequest(`/api/meetings/${meeting.id}/captions/text`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ text: 'Sous-titre navigateur CI', language: 'fr-FR' }),
  });
  assert.equal(browserCaption.response.status, 201, JSON.stringify(browserCaption.data));
  assert.equal(browserCaption.data.provider, 'browser-speech');

  const persistedCaptions = await jsonRequest(`/api/meetings/${meeting.id}/captions`, {
    headers: authHeaders(host.token),
  });
  assert.equal(persistedCaptions.response.status, 200, JSON.stringify(persistedCaptions.data));
  assert.ok(persistedCaptions.data.some((item) => item.text === 'Décision CI issue du micro réel' && item.provider === 'groq-whisper'));
  assert.ok(persistedCaptions.data.some((item) => item.text === 'Sous-titre navigateur CI' && item.provider === 'browser-speech'));

  const mediaStatus = await jsonRequest('/api/media/status');
  assert.equal(mediaStatus.response.status, 200, JSON.stringify(mediaStatus.data));
  assert.equal(mediaStatus.data.preferredMode, 'livekit');
  assert.equal(mediaStatus.data.browserTransport, 'mesh');
  assert.equal(mediaStatus.data.livekitReady, true);
  assert.equal(mediaStatus.data.serverRecordingReady, true);

  const hostMediaSession = await jsonRequest(`/api/meetings/${meeting.id}/media-session`, {
    headers: authHeaders(host.token),
  });
  assert.equal(hostMediaSession.response.status, 200, JSON.stringify(hostMediaSession.data));
  assert.equal(hostMediaSession.data.mode, 'livekit');
  assert.equal(hostMediaSession.data.serverUrl, egressBaseUrl.replace(/^http:/, 'ws:'));
  const hostSfuPayload = decodeAndVerifyJwt(hostMediaSession.data.participantToken, 'test-api-secret');
  assert.equal(hostSfuPayload.iss, 'test-api-key');
  assert.equal(hostSfuPayload.sub, `mboteroom-user-${host.user.id}`);
  assert.equal(hostSfuPayload.name, 'Hôte Integration');
  const hostSfuMetadata = JSON.parse(hostSfuPayload.metadata);
  assert.equal(Number(hostSfuMetadata.mboteRoomUserId), Number(host.user.id));
  assert.equal(hostSfuMetadata.displayName, 'Hôte Integration');
  assert.equal(hostSfuPayload.video?.room, `mboteroom-${meeting.id}`);
  assert.equal(hostSfuPayload.video?.roomJoin, true);

  const participantMediaSession = await jsonRequest(`/api/meetings/${meeting.id}/media-session`, {
    headers: authHeaders(participant.token),
  });
  assert.equal(participantMediaSession.response.status, 200, JSON.stringify(participantMediaSession.data));
  const participantSfuPayload = decodeAndVerifyJwt(participantMediaSession.data.participantToken, 'test-api-secret');
  assert.equal(participantSfuPayload.sub, `mboteroom-user-${participant.user.id}`);
  assert.equal(participantSfuPayload.video?.room, `mboteroom-${meeting.id}`);

  const outsiderMediaSession = await jsonRequest(`/api/meetings/${meeting.id}/media-session`, {
    headers: authHeaders(outsider.token),
  });
  assert.equal(outsiderMediaSession.response.status, 403);
  assert.equal(outsiderMediaSession.data.code, 'MEETING_ACCESS_DENIED');

  const recordingCapability = await jsonRequest('/api/recording/status');
  assert.equal(recordingCapability.response.status, 200, JSON.stringify(recordingCapability.data));
  assert.equal(recordingCapability.data.ready, true);
  assert.equal(recordingCapability.data.livekitReady, true);
  assert.equal(recordingCapability.data.egressEnabled, true);
  assert.equal(recordingCapability.data.storageReady, true);

  const startRecording = await jsonRequest(`/api/meetings/${meeting.id}/recordings/start`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ layout: 'grid' }),
  });
  assert.equal(startRecording.response.status, 201, JSON.stringify(startRecording.data));
  assert.equal(startRecording.data.provider, 'livekit');
  assert.equal(startRecording.data.provider_recording_id, 'EG_TEST_RECORDING_1');
  assert.ok(['active', 'starting'].includes(startRecording.data.status));
  const recordingId = startRecording.data.id;

  const startEgressRequest = egressRequests.find((item) => item.path?.endsWith('/StartEgress'));
  assert.ok(startEgressRequest, 'StartEgress request should reach the mock LiveKit service');
  assert.equal(startEgressRequest.body.room_name, `mboteroom-${meeting.id}`);
  assert.equal(startEgressRequest.body.template?.layout, 'grid');
  assert.equal(startEgressRequest.body.outputs?.[0]?.file?.file_type, 'MP4');
  const roomRecordToken = String(startEgressRequest.authorization).replace(/^Bearer\s+/i, '');
  const roomRecordPayload = decodeAndVerifyJwt(roomRecordToken, 'test-api-secret');
  assert.equal(roomRecordPayload.iss, 'test-api-key');
  assert.equal(roomRecordPayload.video?.roomRecord, true);

  const duplicateRecording = await jsonRequest(`/api/meetings/${meeting.id}/recordings/start`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ layout: 'speaker' }),
  });
  assert.equal(duplicateRecording.response.status, 409, JSON.stringify(duplicateRecording.data));
  assert.equal(duplicateRecording.data.code, 'RECORDING_ALREADY_ACTIVE');

  const recordingStatus = await jsonRequest(`/api/meetings/${meeting.id}/recordings/${recordingId}/status`, {
    headers: authHeaders(participant.token),
  });
  assert.equal(recordingStatus.response.status, 200, JSON.stringify(recordingStatus.data));
  assert.equal(recordingStatus.data.provider_recording_id, 'EG_TEST_RECORDING_1');
  assert.equal(recordingStatus.data.status, 'active');

  const stopRecording = await jsonRequest(`/api/meetings/${meeting.id}/recordings/${recordingId}/stop`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(stopRecording.response.status, 200, JSON.stringify(stopRecording.data));
  assert.equal(stopRecording.data.status, 'complete');
  assert.equal(stopRecording.data.storage_url, 'https://storage.test/mboteroom-test.mp4');
  assert.equal(Number(stopRecording.data.size_bytes), 245760);
  assert.equal(Number(stopRecording.data.duration_seconds), 5);

  const persistedRecordings = await jsonRequest(`/api/meetings/${meeting.id}/recordings`, {
    headers: authHeaders(host.token),
  });
  assert.equal(persistedRecordings.response.status, 200, JSON.stringify(persistedRecordings.data));
  assert.ok(persistedRecordings.data.some((item) =>
    item.id === recordingId
    && item.provider === 'livekit'
    && item.status === 'complete'
    && item.storage_url === 'https://storage.test/mboteroom-test.mp4'
  ));

  const muteAll = await jsonRequest(`/api/meetings/${meeting.id}/participants/mute-all`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(muteAll.response.status, 200, JSON.stringify(muteAll.data));
  assert.equal(muteAll.data.muted, 1);
  assert.ok(muteAll.data.userIds.includes(Number(participant.user.id)));

  const mutedParticipants = await jsonRequest(`/api/meetings/${meeting.id}/participants`, { headers: authHeaders(host.token) });
  assert.equal(mutedParticipants.response.status, 200);
  assert.equal(
    mutedParticipants.data.find((item) => Number(item.userId) === Number(participant.user.id))?.mutedByHost,
    true,
  );

  const lockMeeting = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ locked: true }),
  });
  assert.equal(lockMeeting.response.status, 200, JSON.stringify(lockMeeting.data));
  assert.equal(lockMeeting.data.locked, true);

  const lockedJoin = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(outsider.token),
    body: JSON.stringify({ password: 'RoomPass2026!' }),
  });
  assert.equal(lockedJoin.response.status, 423, JSON.stringify(lockedJoin.data));
  assert.equal(lockedJoin.data.code, 'MEETING_LOCKED');

  const lockedGuestJoin = await jsonRequest('/api/auth/guest-join', {
    method: 'POST',
    body: JSON.stringify({ name: 'Invité verrouillé', meetingCode: meeting.meeting_link, password: 'RoomPass2026!', country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true, termsVersion: '2026-09-24' }),
  });
  assert.equal(lockedGuestJoin.response.status, 423, JSON.stringify(lockedGuestJoin.data));
  assert.equal(lockedGuestJoin.data.code, 'MEETING_LOCKED');

  const unlockMeeting = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ locked: false }),
  });
  assert.equal(unlockMeeting.response.status, 200, JSON.stringify(unlockMeeting.data));
  assert.equal(unlockMeeting.data.locked, false);

  const promoteCoHost = await jsonRequest(`/api/meetings/${meeting.id}/participants/${participant.user.id}`, {
    method: 'PATCH',
    headers: authHeaders(host.token),
    body: JSON.stringify({ role: 'cohost' }),
  });
  assert.equal(promoteCoHost.response.status, 200, JSON.stringify(promoteCoHost.data));
  assert.equal(promoteCoHost.data.role, 'cohost');

  const coHostEndDenied = await jsonRequest(`/api/meetings/${meeting.id}/end`, {
    method: 'POST',
    headers: authHeaders(participant.token),
  });
  assert.equal(coHostEndDenied.response.status, 403, JSON.stringify(coHostEndDenied.data));

  const coHostLock = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ locked: true }),
  });
  assert.equal(coHostLock.response.status, 200, JSON.stringify(coHostLock.data));
  const coHostUnlock = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ locked: false }),
  });
  assert.equal(coHostUnlock.response.status, 200, JSON.stringify(coHostUnlock.data));

  const demoteCoHost = await jsonRequest(`/api/meetings/${meeting.id}/participants/${participant.user.id}`, {
    method: 'PATCH',
    headers: authHeaders(host.token),
    body: JSON.stringify({ role: 'participant' }),
  });
  assert.equal(demoteCoHost.response.status, 200, JSON.stringify(demoteCoHost.data));
  assert.equal(demoteCoHost.data.role, 'participant');

  const participantPollDenied = await jsonRequest(`/api/meetings/${meeting.id}/polls`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ question: 'Interdit ?', options: ['Oui', 'Non'] }),
  });
  assert.equal(participantPollDenied.response.status, 403, JSON.stringify(participantPollDenied.data));

  const unlockedJoin = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(outsider.token),
    body: JSON.stringify({ password: 'RoomPass2026!' }),
  });
  assert.equal(unlockedJoin.response.status, 200, JSON.stringify(unlockedJoin.data));
  assert.equal(unlockedJoin.data.status, 'requested');

  const capacityAdmitAll = await jsonRequest(`/api/meetings/${meeting.id}/lobby/admit-all`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(capacityAdmitAll.response.status, 200, JSON.stringify(capacityAdmitAll.data));
  assert.equal(capacityAdmitAll.data.admitted, 0);

  const lobbyAtCapacity = await jsonRequest(`/api/meetings/${meeting.id}/lobby`, { headers: authHeaders(host.token) });
  assert.equal(lobbyAtCapacity.response.status, 200);
  assert.ok(lobbyAtCapacity.data.some((item) => Number(item.user_id) === Number(outsider.user.id) && item.status === 'requested'));

  const message = await jsonRequest(`/api/meetings/${meeting.id}/messages`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ text: 'Message réellement persisté.' }),
  });
  assert.equal(message.response.status, 201, JSON.stringify(message.data));

  const messageList = await jsonRequest(`/api/meetings/${meeting.id}/messages`, { headers: authHeaders(host.token) });
  assert.equal(messageList.response.status, 200);
  assert.ok(messageList.data.some((item) => item.text === 'Message réellement persisté.'));

  const catchUp = await jsonRequest(`/api/meetings/${meeting.id}/luna/catch-up`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ minutes: 15 }),
  });
  assert.equal(catchUp.response.status, 200, JSON.stringify(catchUp.data));
  assert.equal(catchUp.data.available, true);
  assert.equal(catchUp.data.private, true);
  assert.equal(catchUp.data.minutes, 15);
  assert.ok(Array.isArray(catchUp.data.keyPoints));
  assert.ok(catchUp.data.keyPoints.length > 0);
  assert.ok(Number(catchUp.data.sources?.chat || 0) >= 1);

  const poll = await jsonRequest(`/api/meetings/${meeting.id}/polls`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ question: 'Le test passe-t-il ?', options: ['Oui', 'Non'] }),
  });
  assert.equal(poll.response.status, 201, JSON.stringify(poll.data));
  assert.equal(poll.data.options.length, 2);

  const vote = await jsonRequest(`/api/meetings/${meeting.id}/polls/${poll.data.id}/vote`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ optionId: poll.data.options[0].id }),
  });
  assert.equal(vote.response.status, 200, JSON.stringify(vote.data));
  assert.equal(vote.data.options[0].votes, 1);

  hostSocket = await socketConnect(host.token);
  participantSocket = await socketConnect(participant.token);

  const hostJoin = await socketAck(hostSocket, 'meeting:join', {
    meetingId: meeting.id,
    media: { audio: true, video: true, screen: false },
  });
  assert.equal(hostJoin.ok, true, JSON.stringify(hostJoin));

  const participantJoin = await socketAck(participantSocket, 'meeting:join', {
    meetingId: meeting.id,
    media: { audio: true, video: false, screen: false },
  });
  assert.equal(participantJoin.ok, true, JSON.stringify(participantJoin));


  const temporaryHostEventPromise = waitForSocketEvent(
    participantSocket,
    'meeting:host-changed',
    (payload) => payload?.temporary === true,
  );
  hostSocket.close();
  hostSocket = null;
  const temporaryHostEvent = await temporaryHostEventPromise;
  assert.equal(Number(temporaryHostEvent.hostId), Number(participant.user.id));

  const duringFailover = await jsonRequest(`/api/meetings/${meeting.id}/participants`, {
    headers: authHeaders(participant.token),
  });
  assert.equal(duringFailover.response.status, 200, JSON.stringify(duringFailover.data));
  assert.equal(
    duringFailover.data.find((item) => Number(item.userId) === Number(participant.user.id))?.role,
    'host',
  );

  const actingHostLock = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ locked: true }),
  });
  assert.equal(actingHostLock.response.status, 200, JSON.stringify(actingHostLock.data));
  const actingHostUnlock = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ locked: false }),
  });
  assert.equal(actingHostUnlock.response.status, 200, JSON.stringify(actingHostUnlock.data));

  const restoredHostEventPromise = waitForSocketEvent(
    participantSocket,
    'meeting:host-changed',
    (payload) => payload?.temporary === false,
  );
  hostSocket = await socketConnect(host.token);
  const hostRejoin = await socketAck(hostSocket, 'meeting:join', {
    meetingId: meeting.id,
    media: { audio: true, video: true, screen: false },
  });
  assert.equal(hostRejoin.ok, true, JSON.stringify(hostRejoin));
  const restoredHostEvent = await restoredHostEventPromise;
  assert.equal(Number(restoredHostEvent.hostId), Number(host.user.id));

  const afterRestore = await jsonRequest(`/api/meetings/${meeting.id}/participants`, {
    headers: authHeaders(host.token),
  });
  assert.equal(afterRestore.response.status, 200, JSON.stringify(afterRestore.data));
  assert.equal(
    afterRestore.data.find((item) => Number(item.userId) === Number(host.user.id))?.role,
    'host',
  );
  assert.equal(
    afterRestore.data.find((item) => Number(item.userId) === Number(participant.user.id))?.role,
    'participant',
  );

  const realtimeMessage = await socketAck(participantSocket, 'meeting:chat-message', {
    meetingId: meeting.id,
    text: 'Message Socket.IO persistant',
  });
  assert.equal(realtimeMessage.ok, true, JSON.stringify(realtimeMessage));

  const mediaUpdate = await socketAck(participantSocket, 'meeting:media-updated', {
    meetingId: meeting.id,
    media: { audio: false, video: true, screen: false },
  });
  assert.equal(mediaUpdate.ok, true, JSON.stringify(mediaUpdate));

  const invalidSignal = await socketAck(participantSocket, 'meeting:offer', {
    meetingId: meeting.id,
    targetSocketId: 'not-a-real-socket',
    offer: { type: 'offer', sdp: 'test' },
  });
  assert.equal(invalidSignal.ok, false);
  assert.equal(invalidSignal.code, 'REALTIME_TARGET_INVALID');

  const persistedRealtimeMessages = await jsonRequest(`/api/meetings/${meeting.id}/messages`, { headers: authHeaders(host.token) });
  assert.ok(persistedRealtimeMessages.data.some((item) => item.text === 'Message Socket.IO persistant'));

  const end = await jsonRequest(`/api/meetings/${meeting.id}/end`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(end.response.status, 200, JSON.stringify(end.data));
  assert.equal(end.data.meeting?.status, 'ended');

  const endedJoin = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ password: 'RoomPass2026!' }),
  });
  assert.equal(endedJoin.response.status, 410, JSON.stringify(endedJoin.data));
  assert.equal(endedJoin.data.code, 'MEETING_ENDED');

  const endedGuestJoin = await jsonRequest('/api/auth/guest-join', {
    method: 'POST',
    body: JSON.stringify({ name: 'Invité trop tard', meetingCode: meeting.meeting_link, password: 'RoomPass2026!', country: 'Congo-Brazzaville', city: 'Brazzaville', termsAccepted: true, termsVersion: '2026-09-24' }),
  });
  assert.equal(endedGuestJoin.response.status, 410, JSON.stringify(endedGuestJoin.data));
  assert.equal(endedGuestJoin.data.code, 'MEETING_ENDED');

  const ended = await jsonRequest(`/api/meetings/${meeting.id}/ended`, { headers: authHeaders(host.token) });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.status, 'ended');
  assert.ok(Array.isArray(ended.data.participants));
  assert.ok(ended.data.participants.length >= 2);

  const restarted = await jsonRequest(`/api/meetings/${meeting.id}/restart`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(restarted.response.status, 201, JSON.stringify(restarted.data));
  assert.equal(restarted.data.meeting?.status, 'live');
  assert.equal(restarted.data.meeting?.is_active, true);
  assert.notEqual(Number(restarted.data.meeting?.id), Number(meeting.id));
  assert.equal(restarted.data.meeting?.settings?.meetingAccessId, meeting.settings?.meetingAccessId);

  const restartedLookup = await jsonRequest('/api/meetings/join-lookup', {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({ value: meeting.settings?.meetingAccessId, password: 'RoomPass2026!' }),
  });
  assert.equal(restartedLookup.response.status, 200, JSON.stringify(restartedLookup.data));
  assert.equal(Number(restartedLookup.data.id), Number(restarted.data.meeting.id));

  const banOutsider = await jsonRequest('/api/admin/users/'+outsider.user.id, {
    method: 'PUT',
    headers: authHeaders(host.token),
    body: JSON.stringify({ accountStatus: 'banned' }),
  });
  assert.equal(banOutsider.response.status, 200, JSON.stringify(banOutsider.data));
  assert.equal(banOutsider.data.accountStatus, 'banned');
  const bannedSession = await jsonRequest('/api/auth/me', { headers: authHeaders(outsider.token) });
  assert.equal(bannedSession.response.status, 401, 'Banning a user must revoke their existing sessions');

  const finalHealth = await jsonRequest('/api/health');
  assert.equal(finalHealth.response.status, 200);
  assert.equal(finalHealth.data.database?.connected, true);

  console.log('PostgreSQL + REST + Socket.IO integration checks passed.');
} finally {
  participantSocket?.close();
  hostSocket?.close();
  if (!server.killed) server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
  await new Promise((resolve) => mockEgressServer.close(() => resolve()));
  await new Promise((resolve) => mockTranscriptionServer.close(() => resolve()));
  await new Promise((resolve) => mockMailRelayServer.close(() => resolve()));
}
