import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { io as createClient } from 'socket.io-client';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');

const port = Number(process.env.MBOTE_ROOM_BREAKOUT_TEST_PORT || 4321);
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
server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
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
  const data = text ? JSON.parse(text) : {};
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

const socketConnect = (token) => new Promise((resolve, reject) => {
  const socket = createClient(baseUrl, {
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { Origin: baseUrl },
  });
  const timer = setTimeout(() => reject(new Error('Socket timeout')), 10_000);
  socket.once('connect', () => {
    clearTimeout(timer);
    resolve(socket);
  });
  socket.once('connect_error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const socketAck = (socket, event, payload) => new Promise((resolve) => {
  socket.timeout(10_000).emit(event, payload, (error, response) => {
    if (error) resolve({ ok: false, error: error.message });
    else resolve(response);
  });
});

let hostSocket;
let participantSocket;

try {
  await waitForServer();

  const host = await register('Hôte Breakout', 'host.breakout@mbote.test');
  const participant = await register('Participant Breakout', 'participant.breakout@mbote.test');

  const created = await jsonRequest('/api/meetings', {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({
      title: 'Réunion sous-salles',
      description: 'Test isolation temps réel',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 30,
      settings: {
        waitingRoom: false,
        joinBeforeHost: true,
        chat: true,
        screenShare: true,
      },
    }),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  const meeting = created.data;

  const join = await jsonRequest(`/api/meetings/${meeting.id}/join-request`, {
    method: 'POST',
    headers: authHeaders(participant.token),
    body: JSON.stringify({}),
  });
  assert.equal(join.response.status, 200, JSON.stringify(join.data));

  const createBreakouts = await jsonRequest(`/api/meetings/${meeting.id}/breakouts`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ names: ['Atelier A', 'Atelier B'] }),
  });
  assert.equal(createBreakouts.response.status, 201, JSON.stringify(createBreakouts.data));
  assert.equal(createBreakouts.data.length, 2);
  const breakoutA = createBreakouts.data[0];

  const assignment = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/${breakoutA.id}/assign`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ userId: participant.user.id }),
  });
  assert.equal(assignment.response.status, 200, JSON.stringify(assignment.data));

  const opened = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/open`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(opened.response.status, 200, JSON.stringify(opened.data));
  assert.equal(opened.data.assignments, 1);

  const list = await jsonRequest(`/api/meetings/${meeting.id}/breakouts`, {
    headers: authHeaders(host.token),
  });
  assert.equal(list.response.status, 200, JSON.stringify(list.data));
  assert.ok(list.data.find((room) => room.id === breakoutA.id)?.members.some(
    (member) => Number(member.userId) === Number(participant.user.id),
  ));

  hostSocket = await socketConnect(host.token);
  participantSocket = await socketConnect(participant.token);

  const hostJoin = await socketAck(hostSocket, 'meeting:join', {
    meetingId: meeting.id,
    media: { audio: true, video: true, screen: false },
  });
  assert.equal(hostJoin.ok, true, JSON.stringify(hostJoin));

  const participantJoin = await socketAck(participantSocket, 'meeting:join', {
    meetingId: meeting.id,
    breakoutRoomId: breakoutA.id,
    media: { audio: true, video: true, screen: false },
  });
  assert.equal(participantJoin.ok, true, JSON.stringify(participantJoin));

  assert.equal(hostJoin.participants.length, 0);
  assert.equal(participantJoin.participants.length, 0);

  const crossRoomSignal = await socketAck(participantSocket, 'meeting:offer', {
    meetingId: meeting.id,
    targetSocketId: hostSocket.id,
    offer: { type: 'offer', sdp: 'cross-room-isolation-test' },
  });
  assert.equal(crossRoomSignal.ok, false);
  assert.equal(crossRoomSignal.code, 'REALTIME_TARGET_INVALID');

  const closed = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/close`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(closed.response.status, 200, JSON.stringify(closed.data));

  console.log('Breakout room persistence + realtime isolation checks passed.');
} finally {
  participantSocket?.close();
  hostSocket?.close();
  if (!server.killed) server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    sleep(5_000),
  ]);
}
