import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { io as createSocket } from 'socket.io-client';

if (process.env.MBOTE_ROOM_TEST_DATABASE !== '1') {
  throw new Error('Refusing to reset a database without MBOTE_ROOM_TEST_DATABASE=1');
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

const port = Number(process.env.MBOTE_ROOM_TEST_PORT || 4307);
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

const register = async (name, email) => {
  const result = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password: 'Password2026!' }),
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  assert.ok(result.data.token);
  assert.ok(result.data.user?.id);
  return result.data;
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

const socketAck = (socket, event, payload) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Socket ack timeout: ${event}`)), 7_000);
  socket.emit(event, payload, (response) => {
    clearTimeout(timer);
    resolve(response);
  });
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

  await expectRejectedSocket();

  const host = await register('Hôte Integration', 'host.integration@mbote.test');
  assert.equal(host.user.role, 'admin');

  const participant = await register('Participant Integration', 'participant.integration@mbote.test');
  assert.equal(participant.user.role, 'user');
  const outsider = await register('Participant Bloqué', 'outsider.integration@mbote.test');
  assert.equal(outsider.user.role, 'user');

  const hostMe = await jsonRequest('/api/auth/me', { headers: authHeaders(host.token) });
  assert.equal(hostMe.response.status, 200);
  assert.equal(hostMe.data.user.email, 'host.integration@mbote.test');

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
        lunaSummary: false,
      },
    }),
  });
  assert.equal(createMeeting.response.status, 201, JSON.stringify(createMeeting.data));
  const meeting = createMeeting.data;
  assert.ok(meeting.id);
  assert.ok(meeting.meeting_link);
  assert.equal(meeting.settings?.passwordHash, undefined);
  assert.equal(meeting.settings?.passwordSalt, undefined);

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

  const unlockMeeting = await jsonRequest(`/api/meetings/${meeting.id}/lock`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ locked: false }),
  });
  assert.equal(unlockMeeting.response.status, 200, JSON.stringify(unlockMeeting.data));
  assert.equal(unlockMeeting.data.locked, false);

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

  const createBreakouts = await jsonRequest(`/api/meetings/${meeting.id}/breakouts`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ names: ['Atelier A', 'Atelier B'] }),
  });
  assert.equal(createBreakouts.response.status, 201, JSON.stringify(createBreakouts.data));
  assert.equal(createBreakouts.data.length, 2);
  const breakoutA = createBreakouts.data[0];

  const assignBreakout = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/${breakoutA.id}/assign`, {
    method: 'POST',
    headers: authHeaders(host.token),
    body: JSON.stringify({ userId: participant.user.id }),
  });
  assert.equal(assignBreakout.response.status, 200, JSON.stringify(assignBreakout.data));

  const openBreakouts = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/open`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(openBreakouts.response.status, 200, JSON.stringify(openBreakouts.data));
  assert.equal(openBreakouts.data.assignments, 1);

  const breakoutList = await jsonRequest(`/api/meetings/${meeting.id}/breakouts`, { headers: authHeaders(host.token) });
  assert.equal(breakoutList.response.status, 200, JSON.stringify(breakoutList.data));
  assert.ok(breakoutList.data.find((room) => room.id === breakoutA.id)?.members.some((member) => Number(member.userId) === Number(participant.user.id)));

  hostSocket = await socketConnect(host.token);
  participantSocket = await socketConnect(participant.token);

  const hostJoin = await socketAck(hostSocket, 'meeting:join', {
    meetingId: meeting.id,
    media: { audio: true, video: true, screen: false },
  });
  assert.equal(hostJoin.ok, true, JSON.stringify(hostJoin));
  assert.equal(hostJoin.participants.length, 0);

  const participantJoin = await socketAck(participantSocket, 'meeting:join', {
    meetingId: meeting.id,
    breakoutRoomId: breakoutA.id,
    media: { audio: true, video: false, screen: false },
  });
  assert.equal(participantJoin.ok, true, JSON.stringify(participantJoin));
  assert.equal(participantJoin.participants.length, 0);

  const crossRoomSignal = await socketAck(participantSocket, 'meeting:offer', {
    meetingId: meeting.id,
    targetSocketId: hostSocket.id,
    offer: { type: 'offer', sdp: 'cross-room-test' },
  });
  assert.equal(crossRoomSignal.ok, false);
  assert.equal(crossRoomSignal.code, 'REALTIME_TARGET_INVALID');

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

  const closeBreakouts = await jsonRequest(`/api/meetings/${meeting.id}/breakouts/close`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(closeBreakouts.response.status, 200, JSON.stringify(closeBreakouts.data));

  const end = await jsonRequest(`/api/meetings/${meeting.id}/end`, {
    method: 'POST',
    headers: authHeaders(host.token),
  });
  assert.equal(end.response.status, 200, JSON.stringify(end.data));
  assert.equal(end.data.meeting?.status, 'ended');

  const ended = await jsonRequest(`/api/meetings/${meeting.id}/ended`, { headers: authHeaders(host.token) });
  assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
  assert.equal(ended.data.status, 'ended');
  assert.ok(Array.isArray(ended.data.participants));
  assert.ok(ended.data.participants.length >= 2);

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
}
