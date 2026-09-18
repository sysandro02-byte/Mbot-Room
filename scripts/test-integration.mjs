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
  await new Promise((resolve) => mockEgressServer.close(() => resolve()));
  await new Promise((resolve) => mockTranscriptionServer.close(() => resolve()));
}
