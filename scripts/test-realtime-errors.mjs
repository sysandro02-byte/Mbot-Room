import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as createSocket } from 'socket.io-client';

const port = 5200 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mbote-room-realtime-'));

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
      throw new Error(`Serveur de test arrete avant disponibilite: ${JSON.stringify(serverExit)}\n${serverOutput}`);
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

const waitForConnectError = (auth) => new Promise((resolve, reject) => {
  const socket = createSocket(baseUrl, {
    auth,
    timeout: 5_000,
    transports: ['websocket', 'polling'],
    reconnection: false,
  });
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Socket.IO connect_error attendu mais non recu.'));
  }, 8_000);

  socket.on('connect', () => {
    clearTimeout(timer);
    socket.close();
    reject(new Error('La connexion Socket.IO aurait du etre refusee.'));
  });
  socket.on('connect_error', (error) => {
    clearTimeout(timer);
    socket.close();
    resolve(error);
  });
});

const waitForConnectedSocket = (token) => new Promise((resolve, reject) => {
  const socket = createSocket(baseUrl, {
    auth: { token },
    timeout: 5_000,
    transports: ['websocket', 'polling'],
    reconnection: false,
  });
  const timer = setTimeout(() => {
    socket.close();
    reject(new Error('Connexion Socket.IO valide non etablie.'));
  }, 8_000);

  socket.on('connect', () => {
    clearTimeout(timer);
    resolve(socket);
  });
  socket.on('connect_error', (error) => {
    clearTimeout(timer);
    socket.close();
    reject(error);
  });
});

try {
  await waitForServer();

  const missingTokenError = await waitForConnectError({});
  assert.equal(missingTokenError.message, 'Session invalide.');
  assert.equal(missingTokenError.data?.code, 'REALTIME_AUTH_REQUIRED');
  assert.equal(missingTokenError.data?.error, 'Session invalide.');

  const login = await jsonRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'hote@mbote.local',
      password: 'MboteRoom2026!',
      rememberMe: true,
    }),
  });
  assert.equal(login.response.status, 200);
  assert.ok(login.data.token);

  const socket = await waitForConnectedSocket(login.data.token);
  const invalidJoin = await new Promise((resolve) => {
    socket.emit('meeting:join', { meetingId: 999_999 }, resolve);
  });
  assert.deepEqual(invalidJoin, {
    ok: false,
    code: 'REALTIME_MEETING_INVALID',
    error: 'Réunion invalide.',
  });
  socket.close();
} finally {
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
}
