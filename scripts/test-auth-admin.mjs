import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const port = 4100 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbote-room-auth-admin-'));

const server = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    MBOTE_ROOM_DATA_DIR: dataDir,
    MBOTE_ROOM_DISABLE_POSTGRES: '1',
    DATABASE_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
let serverExit = null;
server.stdout.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on('data', (chunk) => {
  serverOutput += chunk.toString();
});
server.on('error', (error) => {
  serverOutput += `\nSpawn error: ${error.message}`;
});
server.on('exit', (code, signal) => {
  serverExit = { code, signal };
});

const waitForServer = async () => {
  const deadline = Date.now() + 75_000;
  while (Date.now() < deadline) {
    if (serverExit) {
      throw new Error(`Serveur de test arrêté avant disponibilité: ${JSON.stringify(serverExit)}\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Serveur de test indisponible sur ${baseUrl}.\n${serverOutput}`);
};

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
};

try {
  await waitForServer();

  const missingAuth = await jsonRequest('/api/admin/dashboard');
  assert.equal(missingAuth.response.status, 401);
  assert.equal(missingAuth.data.code, 'AUTH_REQUIRED');

  const mboteAuthNotConfigured = await jsonRequest('/api/auth/mbote/start');
  assert.equal(mboteAuthNotConfigured.response.status, 503);
  assert.equal(mboteAuthNotConfigured.data.code, 'EXTERNAL_AUTH_NOT_CONFIGURED');

  const adminLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'hote@mbote.local',
      password: 'MboteRoom2026!',
      rememberMe: true,
    }),
  });
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.data.user.role, 'admin');
  assert.ok(adminLogin.data.user.permissions.includes('admin.dashboard.view'));
  assert.ok(adminLogin.data.expiresAt);

  const adminDashboard = await jsonRequest('/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${adminLogin.data.token}` },
  });
  assert.equal(adminDashboard.response.status, 200);
  assert.ok(Array.isArray(adminDashboard.data.stats));

  const userRegister = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Utilisateur Test',
      email: 'user.test@mbote.local',
      password: 'Password2026!',
    }),
  });
  assert.equal(userRegister.response.status, 201);
  assert.equal(userRegister.data.user.role, 'user');
  assert.deepEqual(userRegister.data.user.permissions, []);

  const forgotPassword = await jsonRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'user.test@mbote.local' }),
  });
  assert.equal(forgotPassword.response.status, 200);
  assert.equal(forgotPassword.data.success, true);
  assert.ok(forgotPassword.data.resetUrl);

  const deniedDashboard = await jsonRequest('/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
  });
  assert.equal(deniedDashboard.response.status, 403);
  assert.equal(deniedDashboard.data.code, 'ADMIN_ACCESS_DENIED');

  const meetingPasswordError = await jsonRequest('/api/meetings/join-lookup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
    body: JSON.stringify({
      value: '1',
      password: 'incorrect',
    }),
  });
  assert.equal(meetingPasswordError.response.status, 403);
  assert.equal(meetingPasswordError.data.code, 'MEETING_PASSWORD_INVALID');

  const meetingNotFound = await jsonRequest('/api/meetings/link/inconnue', {
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
  });
  assert.equal(meetingNotFound.response.status, 404);
  assert.equal(meetingNotFound.data.code, 'MEETING_NOT_FOUND');

  const updateForbidden = await jsonRequest('/api/meetings/1', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
    body: JSON.stringify({ title: 'Modification interdite' }),
  });
  assert.equal(updateForbidden.response.status, 403);
  assert.equal(updateForbidden.data.code, 'MEETING_HOST_REQUIRED');

  const lobbyForbidden = await jsonRequest('/api/meetings/1/lobby/respond', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
    body: JSON.stringify({ userId: 1, status: 'accepted' }),
  });
  assert.equal(lobbyForbidden.response.status, 403);
  assert.equal(lobbyForbidden.data.code, 'LOBBY_HOST_REQUIRED');

  const mediaForbidden = await jsonRequest('/api/meetings/1/media-requests', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
    body: JSON.stringify({ targetUserId: 1, kind: 'mic' }),
  });
  assert.equal(mediaForbidden.response.status, 403);
  assert.equal(mediaForbidden.data.code, 'MEETING_HOST_REQUIRED');

  const mediaMissing = await jsonRequest('/api/meetings/1/media-requests/missing/respond', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminLogin.data.token}` },
    body: JSON.stringify({ status: 'accepted' }),
  });
  assert.equal(mediaMissing.response.status, 404);
  assert.equal(mediaMissing.data.code, 'MEDIA_REQUEST_NOT_FOUND');

  const lunaPromptMissing = await jsonRequest('/api/ai/luna', {
    method: 'POST',
    headers: { Authorization: `Bearer ${userRegister.data.token}` },
    body: JSON.stringify({ meetingId: 1, prompt: '' }),
  });
  assert.equal(lunaPromptMissing.response.status, 400);
  assert.equal(lunaPromptMissing.data.code, 'LUNA_PROMPT_REQUIRED');

  const badLogin = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'user.test@mbote.local',
      password: 'mauvais',
    }),
  });
  assert.equal(badLogin.response.status, 401);
  assert.equal(badLogin.data.code, 'INVALID_CREDENTIALS');
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
