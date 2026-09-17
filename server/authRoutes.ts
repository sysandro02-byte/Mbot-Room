import type express from 'express';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  createSession,
  createToken,
  hashPassword,
  hashToken,
  mapMeeting,
  normalizeEmail,
  normalizeText,
  publicMeeting,
  query,
  requireDatabase,
  sendApiError,
  toPublicUser,
  validateMeetingPassword,
} from './core.js';

const challenges = new Map<string, { profile: any; createdAt: number }>();
const oauthStates = new Map<string, { redirectTo: string; clientOrigin: string; createdAt: number }>();

const createAvatar = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'MBoté')}&background=3156eb&color=fff&bold=true`;

const getOrigin = (request: express.Request) => {
  const proto = String(request.headers['x-forwarded-proto'] || request.protocol || 'https').split(',')[0];
  const host = String(request.headers['x-forwarded-host'] || request.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
};

const normalizeExternalProfile = (value: any) => {
  const source = value?.user || value?.profile || value;
  const id = String(source?.id || source?.sub || source?.userId || source?.user_id || '').trim();
  if (!id) return null;
  const email = normalizeEmail(source?.email) || `mbote-${id}@oauth.mbote.local`;
  return {
    id,
    email,
    username: normalizeText(source?.username || source?.preferred_username || email.split('@')[0]).toLowerCase(),
    name: normalizeText(source?.name || source?.displayName || source?.username || 'Utilisateur MBoté'),
    avatar: String(source?.avatar || source?.picture || source?.avatar_url || source?.avatarUrl || ''),
    phoneNumber: String(source?.phoneNumber || source?.phone_number || ''),
  };
};

const upsertExternalUser = async (profile: ReturnType<typeof normalizeExternalProfile>) => {
  if (!profile) throw new Error('Profil MBoté invalide');
  const existing = await query(
    `SELECT * FROM room_users WHERE lower(email) = lower($1) OR mbote_user_id = $2 LIMIT 1`,
    [profile.email, profile.id],
  );
  if (existing.rows[0]) {
    const updated = await query(
      `UPDATE room_users
          SET name = $2, username = $3, avatar = CASE WHEN $4 <> '' THEN $4 ELSE avatar END,
              phone_number = CASE WHEN $5 <> '' THEN $5 ELSE phone_number END,
              mbote_user_id = $6
        WHERE id = $1 RETURNING *`,
      [existing.rows[0].id, profile.name, profile.username, profile.avatar, profile.phoneNumber, profile.id],
    );
    return updated.rows[0];
  }
  const generated = hashPassword(createToken());
  const inserted = await query(
    `INSERT INTO room_users
      (name, username, email, avatar, password_hash, password_salt, is_guest, created_at, phone_number, mbote_user_id, role)
     VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,'user') RETURNING *`,
    [profile.name, profile.username, profile.email, profile.avatar || createAvatar(profile.name), generated.hash, generated.salt, new Date().toISOString(), profile.phoneNumber, profile.id],
  );
  return inserted.rows[0];
};

const findMeeting = async (value: unknown) => {
  const normalized = String(value || '').replace(/\s+/g, '').toLowerCase();
  if (!normalized) return null;
  const result = await query(`SELECT * FROM room_meetings ORDER BY id DESC`);
  return result.rows.map(mapMeeting).find((meeting) =>
    String(meeting.id) === normalized
    || meeting.meeting_link.toLowerCase() === normalized
    || String(meeting.settings.meetingAccessId || '').toLowerCase() === normalized
    || meeting.meeting_link.slice(-6).toLowerCase() === normalized
  ) || null;
};

const sendResetEmail = async (email: string, resetUrl: string) => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: String(process.env.MEETING_INVITE_FROM || 'MBotéRoom <onboarding@resend.dev>'),
      to: [email],
      subject: 'Réinitialisation de votre mot de passe MBotéRoom',
      text: `Utilisez ce lien pour réinitialiser votre mot de passe : ${resetUrl}`,
    }),
  }).catch(() => null);
  return Boolean(response?.ok);
};

export const registerAuthRoutes = (app: express.Express) => {
  app.post('/api/auth/register', requireDatabase, async (request, response, next) => {
    try {
      const name = normalizeText(request.body?.name).slice(0, 120);
      const email = normalizeEmail(request.body?.email);
      const password = String(request.body?.password || '');
      const username = normalizeText(request.body?.username || email.split('@')[0]).toLowerCase().slice(0, 80);
      if (!name || !email || !password) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Nom, email et mot de passe sont requis.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendApiError(response, 400, 'INVALID_EMAIL', 'Email invalide.');
      if (password.length < 8) return sendApiError(response, 400, 'PASSWORD_TOO_SHORT', 'Le mot de passe doit contenir au moins 8 caractères.');
      const duplicate = await query('SELECT 1 FROM room_users WHERE lower(email) = lower($1) LIMIT 1', [email]);
      if (duplicate.rows[0]) return sendApiError(response, 409, 'EMAIL_ALREADY_EXISTS', 'Un compte existe déjà avec cet email.');
      const userCount = await query(`SELECT COUNT(*)::int AS count FROM room_users WHERE is_guest = false`);
      const passwordData = hashPassword(password);
      const role = Number(userCount.rows[0]?.count || 0) === 0 ? 'admin' : 'user';
      const inserted = await query(
        `INSERT INTO room_users
          (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,phone_number,organization,job_title,role)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11) RETURNING *`,
        [name, username, email, createAvatar(name), passwordData.hash, passwordData.salt, new Date().toISOString(), normalizeText(request.body?.phoneNumber).slice(0, 40), normalizeText(request.body?.organization).slice(0, 120), normalizeText(request.body?.jobTitle).slice(0, 120), role],
      );
      response.status(201).json(await createSession(Number(inserted.rows[0].id), true));
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', requireDatabase, async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      const result = await query('SELECT * FROM room_users WHERE lower(email) = lower($1) LIMIT 1', [email]);
      const user = result.rows[0];
      if (!user) return sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');
      const password = String(request.body?.password || '');
      const passwordData = hashPassword(password, user.password_salt);
      if (passwordData.hash !== user.password_hash) return sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');
      response.json(await createSession(Number(user.id), Boolean(request.body?.rememberMe)));
    } catch (error) { next(error); }
  });

  app.post('/api/auth/guest-join', requireDatabase, async (request, response, next) => {
    try {
      const name = normalizeText(request.body?.name).slice(0, 100);
      const meeting = await findMeeting(request.body?.meetingCode);
      if (!name) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Votre nom est requis.');
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (!validateMeetingPassword(meeting, request.body?.password)) return sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
      const ban = await query('SELECT 1 FROM room_meeting_bans b JOIN room_users u ON u.id=b.user_id WHERE b.meeting_id=$1 AND lower(u.email)=lower($2) LIMIT 1', [meeting.id, normalizeEmail(request.body?.email || '')]);
      if (ban.rows[0]) return sendApiError(response, 403, 'MEETING_BANNED', 'Accès à cette réunion refusé.');
      const randomPassword = hashPassword(createToken());
      const guestEmail = `guest-${createId()}@guest.mbote.local`;
      const inserted = await query(
        `INSERT INTO room_users (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,role)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,'guest') RETURNING *`,
        [name, `guest-${createId().slice(0, 8)}`, guestEmail, createAvatar(name), randomPassword.hash, randomPassword.salt, new Date().toISOString()],
      );
      const user = toPublicUser(inserted.rows[0]);
      const status = meeting.settings.waitingRoom === false ? 'accepted' : 'requested';
      await query(
        `INSERT INTO room_lobby (meeting_id,user_id,status,name,avatar)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (meeting_id,user_id) DO UPDATE SET status=excluded.status,name=excluded.name,avatar=excluded.avatar`,
        [meeting.id, user.id, status, user.name, user.avatar],
      );
      if (status === 'accepted') {
        await query(
          `INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at)
           VALUES ($1,$2,'participant','accepted',now())
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),updated_at=now()`,
          [meeting.id, user.id],
        );
      }
      const session = await createSession(user.id, false);
      response.status(201).json({ ...session, meeting: { ...publicMeeting(meeting), settings: { ...publicMeeting(meeting).settings } }, lobbyStatus: status });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', requireDatabase, authenticateToken, (request: AuthedRequest, response) => {
    response.json({ user: request.user });
  });

  app.post('/api/auth/logout', requireDatabase, authenticateToken, async (request, response, next) => {
    try {
      const [scheme, rawToken] = String(request.headers.authorization || '').split(' ');
      if (scheme?.toLowerCase() === 'bearer' && rawToken) await query('DELETE FROM room_sessions WHERE token_hash=$1', [hashToken(rawToken)]);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/api/auth/forgot-password', requireDatabase, async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      const userResult = await query(`SELECT * FROM room_users WHERE lower(email)=lower($1) AND is_guest=false LIMIT 1`, [email]);
      if (userResult.rows[0]) {
        const rawToken = createToken();
        await query(
          `INSERT INTO room_password_resets (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 minutes')`,
          [hashToken(rawToken), userResult.rows[0].id],
        );
        const appUrl = String(process.env.MBOTE_ROOM_APP_URL || getOrigin(request)).replace(/\/+$/, '');
        await sendResetEmail(email, `${appUrl}/mot-de-passe-oublie?token=${encodeURIComponent(rawToken)}`);
      }
      response.json({ success: true, message: 'Si ce compte existe, un lien de réinitialisation a été envoyé.' });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/reset-password', requireDatabase, async (request, response, next) => {
    try {
      const token = String(request.body?.token || '');
      const password = String(request.body?.password || '');
      if (password.length < 8) return sendApiError(response, 400, 'PASSWORD_TOO_SHORT', 'Le mot de passe doit contenir au moins 8 caractères.');
      const reset = await query(`SELECT * FROM room_password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() LIMIT 1`, [hashToken(token)]);
      if (!reset.rows[0]) return sendApiError(response, 400, 'PASSWORD_RESET_INVALID', 'Lien de réinitialisation invalide ou expiré.');
      const passwordData = hashPassword(password);
      await query('UPDATE room_users SET password_hash=$2,password_salt=$3 WHERE id=$1', [reset.rows[0].user_id, passwordData.hash, passwordData.salt]);
      await query('UPDATE room_password_resets SET used_at=now() WHERE token_hash=$1', [hashToken(token)]);
      await query('DELETE FROM room_sessions WHERE user_id=$1', [reset.rows[0].user_id]);
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/mbote/credentials', requireDatabase, async (request, response, next) => {
    try {
      const loginUrl = String(process.env.MBOTE_AUTH_LOGIN_URL || '').trim();
      if (!loginUrl) return sendApiError(response, 503, 'MBOTE_AUTH_NOT_CONFIGURED', 'Authentification MBoté non configurée.');
      const upstream = await fetch(loginUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: request.body?.identifier, identifier: request.body?.identifier, password: request.body?.password }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      if (!upstream?.ok) return sendApiError(response, 401, 'MBOTE_CREDENTIALS_INVALID', 'Identifiants MBoté incorrects.');
      const data = await upstream.json().catch(() => null);
      let profile = normalizeExternalProfile(data);
      const accessToken = data?.token || data?.access_token;
      const profileUrl = String(process.env.MBOTE_AUTH_PROFILE_URL || '').trim();
      if (!profile && accessToken && profileUrl) {
        const profileResponse = await fetch(profileUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
        if (profileResponse?.ok) profile = normalizeExternalProfile(await profileResponse.json().catch(() => null));
      }
      if (!profile) return sendApiError(response, 502, 'EXTERNAL_AUTH_PROFILE_UNAVAILABLE', 'Profil MBoté indisponible.');
      const challengeId = createToken();
      challenges.set(challengeId, { profile, createdAt: Date.now() });
      response.json({ challengeId, profile });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/mbote/authorize', requireDatabase, async (request, response, next) => {
    try {
      const challengeId = String(request.body?.challengeId || '');
      const challenge = challenges.get(challengeId);
      challenges.delete(challengeId);
      if (!challenge || Date.now() - challenge.createdAt > 10 * 60_000) return sendApiError(response, 400, 'EXTERNAL_AUTH_STATE_INVALID', 'Autorisation MBoté expirée.');
      const user = await upsertExternalUser(challenge.profile);
      response.json(await createSession(Number(user.id), true));
    } catch (error) { next(error); }
  });

  app.get('/api/auth/mbote/start', requireDatabase, (request, response) => {
    const authorizeUrl = String(process.env.MBOTE_AUTH_AUTHORIZE_URL || '').trim();
    const clientId = String(process.env.MBOTE_AUTH_CLIENT_ID || '').trim();
    const redirectUri = String(process.env.MBOTE_AUTH_REDIRECT_URI || `${getOrigin(request)}/api/auth/mbote/callback`).trim();
    if (!authorizeUrl || !clientId) return sendApiError(response, 503, 'MBOTE_AUTH_NOT_CONFIGURED', 'OAuth MBoté non configuré.');
    const state = createToken();
    const redirectTo = String(request.query.redirect || '/app');
    const clientOrigin = String(process.env.MBOTE_ROOM_APP_URL || getOrigin(request)).replace(/\/+$/, '');
    oauthStates.set(state, { redirectTo: redirectTo.startsWith('/') ? redirectTo : '/app', clientOrigin, createdAt: Date.now() });
    const url = new URL(authorizeUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    response.json({ url: url.toString() });
  });

  app.get('/api/auth/mbote/callback', requireDatabase, async (request, response, next) => {
    try {
      const state = String(request.query.state || '');
      const code = String(request.query.code || '');
      const stored = oauthStates.get(state);
      oauthStates.delete(state);
      if (!stored || Date.now() - stored.createdAt > 10 * 60_000 || !code) return sendApiError(response, 400, 'EXTERNAL_AUTH_STATE_INVALID', 'Retour OAuth MBoté invalide.');
      const tokenUrl = String(process.env.MBOTE_AUTH_TOKEN_URL || '').trim();
      const profileUrl = String(process.env.MBOTE_AUTH_PROFILE_URL || '').trim();
      const clientId = String(process.env.MBOTE_AUTH_CLIENT_ID || '').trim();
      const clientSecret = String(process.env.MBOTE_AUTH_CLIENT_SECRET || '').trim();
      const redirectUri = String(process.env.MBOTE_AUTH_REDIRECT_URI || `${getOrigin(request)}/api/auth/mbote/callback`).trim();
      if (!tokenUrl || !profileUrl) return sendApiError(response, 503, 'MBOTE_AUTH_NOT_CONFIGURED', 'OAuth MBoté incomplet.');
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenResponse.ok) return sendApiError(response, 502, 'EXTERNAL_AUTH_PROFILE_UNAVAILABLE', 'Échange OAuth MBoté impossible.');
      const tokenData = await tokenResponse.json();
      const profileResponse = await fetch(profileUrl, { headers: { Authorization: `Bearer ${tokenData.access_token || tokenData.token}` }, signal: AbortSignal.timeout(15000) });
      if (!profileResponse.ok) return sendApiError(response, 502, 'EXTERNAL_AUTH_PROFILE_UNAVAILABLE', 'Profil MBoté indisponible.');
      const profile = normalizeExternalProfile(await profileResponse.json());
      const user = await upsertExternalUser(profile);
      const session = await createSession(Number(user.id), true);
      const hash = new URLSearchParams({ mboteToken: session.token, mboteUser: JSON.stringify(session.user), redirect: stored.redirectTo });
      response.redirect(`${stored.clientOrigin}/login#${hash.toString()}`);
    } catch (error) { next(error); }
  });
};
