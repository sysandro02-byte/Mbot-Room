import crypto from 'node:crypto';
import type express from 'express';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  createSession,
  createToken,
  hashPassword,
  hashToken,
  verifyPasswordHash,
  mapMeeting,
  normalizeEmail,
  normalizeText,
  publicMeeting,
  query,
  requireDatabase,
  SESSION_COOKIE_NAME,
  getRawSessionTokenFromRequest,
  getConfiguredAdminEmails,
  touchSessionActivity,
  sendApiError,
  toPublicUser,
  validateMeetingPassword,
} from './core.js';
import { sendTransactionalEmail } from './emailDelivery.js';
import { resolveAllowedClientOrigin } from './originPolicy.js';
import { isPlatformFeatureEnabled } from './platformSettings.js';

const challenges = new Map<string, { profile: any; createdAt: number }>();
const oauthStates = new Map<string, { redirectTo: string; clientOrigin: string; createdAt: number }>();
const TEMP_AUTH_STATE_TTL_MS = 10 * 60_000;
const MAX_TEMP_AUTH_STATES = 5_000;

const pruneTemporaryAuthStates = () => {
  const cutoff = Date.now() - TEMP_AUTH_STATE_TTL_MS;
  for (const [key, value] of challenges) {
    if (value.createdAt < cutoff) challenges.delete(key);
  }
  for (const [key, value] of oauthStates) {
    if (value.createdAt < cutoff) oauthStates.delete(key);
  }
  while (challenges.size > MAX_TEMP_AUTH_STATES) {
    const oldest = challenges.keys().next().value;
    if (!oldest) break;
    challenges.delete(oldest);
  }
  while (oauthStates.size > MAX_TEMP_AUTH_STATES) {
    const oldest = oauthStates.keys().next().value;
    if (!oldest) break;
    oauthStates.delete(oldest);
  }
};

const sessionCookieOptions = (expiresAt?: string) => {
  const sameSiteValue = String(process.env.MBOTE_ROOM_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
  const sameSite: 'lax' | 'strict' | 'none' =
    sameSiteValue === 'strict' || sameSiteValue === 'none' ? sameSiteValue : 'lax';
  const secure = process.env.NODE_ENV === 'production' || sameSite === 'none';
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
    ...(process.env.MBOTE_ROOM_COOKIE_DOMAIN ? { domain: process.env.MBOTE_ROOM_COOKIE_DOMAIN } : {}),
  };
};

const attachSessionCookie = (response: express.Response, session: { token: string; expiresAt?: string }) => {
  response.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
};

const clearSessionCookie = (response: express.Response) => {
  response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
};

const wantsBearerSession = (request: express.Request) =>
  String(request.headers['x-mbote-room-session-mode'] || '').trim().toLowerCase() === 'bearer';

const publicSessionPayload = (
  request: express.Request,
  session: Awaited<ReturnType<typeof createSession>>,
) => ({
  user: session.user,
  expiresAt: session.expiresAt,
  ...(wantsBearerSession(request) ? { token: session.token } : {}),
});

const respondWithSession = (
  request: express.Request,
  response: express.Response,
  session: Awaited<ReturnType<typeof createSession>>,
  status = 200,
) => {
  attachSessionCookie(response, session);
  response.status(status).json(publicSessionPayload(request, session));
};

const createAvatar = (name: string) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'MBoté')}&background=3156eb&color=fff&bold=true`;

const safeRedirectPath = (value: unknown) => {
  const raw=String(value||'/app').trim();
  if(!raw.startsWith('/')||raw.startsWith('//')||raw.includes('\\')||raw.length>1500)return '/app';
  if(/[\u0000-\u001f]/.test(raw))return '/app';
  return raw;
};

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

const findAndLinkExternalUser = async (profile: ReturnType<typeof normalizeExternalProfile>) => {
  if (!profile) throw new Error('Profil MBoté invalide');
  const existing = await query(
    `SELECT * FROM room_users
      WHERE is_guest=false
        AND COALESCE(is_suspended,false)=false
        AND (lower(email)=lower($1) OR mbote_user_id=$2)
      LIMIT 1`,
    [profile.email, profile.id],
  );
  if (!existing.rows[0]) return null;
  const updated = await query(
    `UPDATE room_users
        SET name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
            username = CASE WHEN $3 <> '' THEN $3 ELSE username END,
            avatar = CASE WHEN $4 <> '' THEN $4 ELSE avatar END,
            phone_number = CASE WHEN $5 <> '' THEN $5 ELSE phone_number END,
            mbote_user_id = $6
      WHERE id = $1 RETURNING *`,
    [existing.rows[0].id, profile.name, profile.username, profile.avatar, profile.phoneNumber, profile.id],
  );
  return updated.rows[0];
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

const meetingCapacity = (meeting: Awaited<ReturnType<typeof findMeeting>>) => {
  const configured = Number(meeting?.settings?.participantCapacity || 100);
  return Number.isFinite(configured) ? Math.max(2, Math.min(1000, Math.floor(configured))) : 100;
};

const acceptedMemberCount = async (meetingId: number) => {
  const result = await query(`SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'`, [meetingId]);
  return Number(result.rows[0]?.count || 0);
};

const validatePasswordStrength = (password: string) => {
  if (password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Utilisez au moins une majuscule, une minuscule, un chiffre et un caractère spécial.';
  }
  if (/\s/.test(password)) return 'Le mot de passe ne doit pas contenir d’espace.';
  return '';
};

const escapeEmailHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const emailFrame = (title: string, subtitle: string, content: string, footer = 'Cet e-mail a été envoyé automatiquement par MBotéRoom.') => [
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
  '<body style="margin:0;background:#f4f7fc;font-family:Inter,Arial,sans-serif;color:#17213c">',
  '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fc;padding:30px 12px"><tr><td align="center">',
  '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border:1px solid #e2e8f4;border-radius:24px;overflow:hidden;box-shadow:0 16px 48px rgba(22,34,69,.08)">',
  '<tr><td style="padding:28px 34px;background:linear-gradient(135deg,#13224d,#3156eb 62%,#6046f4);color:#fff">',
  '<div style="font-size:25px;font-weight:850">MBoté<span style="color:#c0cbff">Room</span></div><div style="margin-top:6px;font-size:13px;opacity:.84">Réunions professionnelles, simples et sécurisées</div></td></tr>',
  '<tr><td style="padding:34px"><h1 style="margin:0 0 10px;font-size:28px;line-height:1.2;color:#15203d">'+escapeEmailHtml(title)+'</h1>',
  '<p style="margin:0 0 25px;color:#68758f;font-size:16px;line-height:1.65">'+escapeEmailHtml(subtitle)+'</p>'+content+'</td></tr>',
  '<tr><td style="padding:19px 34px;border-top:1px solid #edf1f7;background:#fafcff;color:#7a879d;font-size:12px;line-height:1.6">'+escapeEmailHtml(footer)+'<br>MBotéRoom est une application créée par LoukaTech.<br>© LoukaTech · MBotéRoom</td></tr>',
  '</table></td></tr></table></body></html>'
].join('');

const primaryEmailButton = (label: string, url: string) =>
  '<a href="'+escapeEmailHtml(url)+'" style="display:inline-block;padding:13px 20px;border-radius:12px;background:#3156eb;color:#fff;text-decoration:none;font-weight:800">'+escapeEmailHtml(label)+'</a>';

const sendResetEmail = async (email: string, resetUrl: string) => sendTransactionalEmail({
  to: email,
  subject: 'Réinitialisez votre mot de passe MBotéRoom',
  text: 'Une demande de réinitialisation a été reçue pour votre compte. Ce lien expire dans 30 minutes : '+resetUrl,
  html: emailFrame(
    'Réinitialisation du mot de passe',
    'Nous avons reçu une demande pour définir un nouveau mot de passe sur votre compte.',
    '<div style="padding:14px 16px;border-radius:13px;background:#fff8e8;border:1px solid #ffe2a9;color:#785b19;font-size:14px;line-height:1.6">Ce lien est temporaire et expire après 30 minutes. Si vous n’êtes pas à l’origine de cette demande, ne faites rien.</div>'+
    '<p style="margin:26px 0 0">'+primaryEmailButton('Définir un nouveau mot de passe', resetUrl)+'</p>',
    'Ne communiquez jamais votre mot de passe ou un code de sécurité à une autre personne.'
  ),
});

const sendWelcomeEmail = async (email: string, name: string, appUrl: string) => {
  const feature = (title: string, body: string) =>
    '<div style="margin:0 0 10px;padding:14px 16px;border:1px solid #e6ebf4;border-radius:13px"><strong style="color:#22325a">'+escapeEmailHtml(title)+'</strong><div style="margin-top:4px;color:#71809b;font-size:14px;line-height:1.5">'+escapeEmailHtml(body)+'</div></div>';
  return sendTransactionalEmail({
    to: email,
    subject: 'Bienvenue sur MBotéRoom — votre espace est prêt',
    text: 'Bonjour '+name+'. Votre compte '+email+' est prêt. Vous pouvez créer des réunions HD, inviter des participants, utiliser Luna IA, le chat, les sondages, les sous-salles et le partage d’écran. Pour votre sécurité, votre mot de passe n’est jamais envoyé en clair. Un code OTP sera demandé à chaque connexion. '+appUrl,
    html: emailFrame(
      'Bienvenue '+name+' !',
      'Votre espace MBotéRoom est prêt pour vos réunions, votre équipe et Luna IA.',
      '<div style="padding:16px 18px;border-radius:14px;background:#f2f5ff;border:1px solid #dde5ff"><div style="font-size:12px;color:#73809b">Compte MBotéRoom</div><div style="margin-top:5px;font-weight:800;color:#1b294e">'+escapeEmailHtml(email)+'</div><div style="margin-top:8px;color:#66728d;font-size:13px;line-height:1.55">Pour votre sécurité, MBotéRoom ne conserve pas et n’envoie jamais votre mot de passe en clair. À chaque nouvelle connexion, un code OTP est envoyé à cette adresse.</div></div>'+
      '<h2 style="margin:28px 0 14px;font-size:18px;color:#182442">Découvrez MBotéRoom</h2>'+
      feature('Réunions HD', 'Audio, vidéo, partage d’écran et gestion des périphériques.')+
      feature('Collaboration', 'Chat, réactions, sondages, sous-salles et outils de travail en équipe.')+
      feature('Luna IA', 'Résumé des échanges, décisions, points clés et actions à suivre.')+
      feature('Sécurité avancée', 'Salle d’attente, verrouillage, rôles hôte/co-hôte et OTP à la connexion.')+
      '<p style="margin:26px 0 0">'+primaryEmailButton('Ouvrir MBotéRoom', appUrl)+'</p>',
      'Votre mot de passe reste secret. MBotéRoom ne vous demandera jamais de communiquer votre mot de passe ou votre code OTP par e-mail.'
    ),
  });
};

const sendLoginOtpEmail = async (email: string, name: string, code: string, expiresMinutes = 10) => sendTransactionalEmail({
  to: email,
  subject: code+' · Votre code de connexion MBotéRoom',
  text: 'Bonjour '+name+'. Votre code de connexion MBotéRoom est '+code+'. Il expire dans '+expiresMinutes+' minutes. Si vous n’êtes pas à l’origine de cette tentative, ignorez ce message.',
  html: emailFrame(
    'Confirmez votre connexion',
    'Bonjour '+name+', saisissez ce code dans MBotéRoom. Il expire dans '+expiresMinutes+' minutes.',
    '<div style="margin:26px 0;padding:22px;border-radius:16px;background:#121c3e;text-align:center"><div style="font-size:12px;color:#aab8dd;text-transform:uppercase;letter-spacing:1.5px">Code à usage unique</div><div style="margin-top:8px;color:#fff;font-size:38px;font-weight:900;letter-spacing:9px">'+escapeEmailHtml(code)+'</div></div>'+
    '<p style="margin:0;color:#71809b;font-size:13px;line-height:1.6">Ce code ne peut être utilisé qu’une seule fois. Ne le partagez avec personne, même avec une personne prétendant travailler pour LoukaTech.</p>',
    'Si vous n’avez pas tenté de vous connecter, ignorez ce message. Aucun accès n’est accordé sans le code.'
  ),
});

const createOtpCode = () => String(crypto.randomInt(100000, 1000000));

const issueLoginOtp = async (user: any, rememberMe = false) => {
  await query('DELETE FROM room_login_otps WHERE user_id=$1 OR expires_at<=now() OR consumed_at IS NOT NULL', [user.id]);
  const challengeId = createId();
  const code = createOtpCode();
  const expiresMinutes = 10;
  await query(
    `INSERT INTO room_login_otps (challenge_id,user_id,code_hash,remember_me,expires_at)
     VALUES ($1,$2,$3,$4,now()+interval '10 minutes')`,
    [challengeId, user.id, hashToken(code), rememberMe],
  );
  const delivered = await sendLoginOtpEmail(
    String(user.email),
    String(user.name || user.username || 'Utilisateur'),
    code,
    expiresMinutes,
  ).catch(() => false);
  if (!delivered) {
    await query('DELETE FROM room_login_otps WHERE challenge_id=$1', [challengeId]);
    return null;
  }
  const [local, domain] = String(user.email).split('@');
  const emailHint = local && domain ? local.slice(0, 2)+'***@'+domain : 'votre adresse e-mail';
  return { otpRequired: true as const, challengeId, emailHint, expiresInSeconds: expiresMinutes * 60 };
};

const canRegisterAdminEmail = async (email: string, inviteToken = '') => {
  const normalizedEmail = normalizeEmail(email);
  const allowedAdmins = getConfiguredAdminEmails();
  if (allowedAdmins.includes(normalizedEmail)) return true;

  if (inviteToken) {
    const invite = await query(
      `SELECT id
         FROM room_admin_invites
        WHERE lower(email)=lower($1)
          AND token_hash=$2
          AND consumed_at IS NULL
          AND expires_at>now()
        LIMIT 1`,
      [normalizedEmail, hashToken(inviteToken)],
    );
    if (invite.rows[0]) return true;
  }

  const activeAdmins = await query(
    "SELECT COUNT(*)::int AS count FROM room_users WHERE role='admin' AND COALESCE(is_suspended,false)=false",
  );
  return Number(activeAdmins.rows[0]?.count || 0) === 0;
};

const linkPendingWorkGroupMemberships = async (userId: number, email: string) => {
  if (!userId || !email) return;
  await query(
    `UPDATE room_work_group_members
        SET user_id=$1
      WHERE user_id IS NULL AND lower(email)=lower($2)`,
    [userId, email],
  );
};


const currentTermsVersion = async () => {
  const result = await query("SELECT version FROM room_legal_documents WHERE key='terms' LIMIT 1");
  return String(result.rows[0]?.version || '2026-09-24');
};

const validateTermsAcceptance = async (body: any) => {
  const version = await currentTermsVersion();
  const accepted = body?.termsAccepted === true && String(body?.termsVersion || '') === version;
  return { accepted, version };
};


export const registerAuthRoutes = (app: express.Express) => {
  app.post('/api/auth/register', requireDatabase, async (request, response, next) => {
    try {
      if (!(await isPlatformFeatureEnabled('registrationEnabled'))) {
        return sendApiError(response, 403, 'REGISTRATION_DISABLED', 'La création de nouveaux comptes est temporairement fermée.');
      }
      const name = normalizeText(request.body?.name).slice(0, 120);
      const email = normalizeEmail(request.body?.email);
      const password = String(request.body?.password || '');
      const username = normalizeText(request.body?.username || email.split('@')[0]).toLowerCase().slice(0, 80);
      if (!name || !email || !password) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Nom, email et mot de passe sont requis.');
      const terms = await validateTermsAcceptance(request.body);
      if (!terms.accepted) return sendApiError(response, 400, 'TERMS_NOT_ACCEPTED', 'Vous devez lire et accepter la version actuelle des conditions d’utilisation.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendApiError(response, 400, 'INVALID_EMAIL', 'Email invalide.');
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return sendApiError(response, 400, 'PASSWORD_WEAK', passwordError);
      const duplicate = await query('SELECT 1 FROM room_users WHERE lower(email) = lower($1) LIMIT 1', [email]);
      if (duplicate.rows[0]) return sendApiError(response, 409, 'EMAIL_ALREADY_EXISTS', 'Un compte existe déjà avec cet email.');
      const passwordData = hashPassword(password);
      if (getConfiguredAdminEmails().includes(email)) {
        return sendApiError(response, 403, 'ADMIN_REGISTRATION_REQUIRED', 'Utilisez l’espace administrateur pour créer ce compte.');
      }
      const role = 'user';
      const birthDate = normalizeText(request.body?.birthDate).slice(0, 10);
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        return sendApiError(response, 400, 'INVALID_BIRTH_DATE', 'La date de naissance est invalide.');
      }
      const inserted = await query(
        `INSERT INTO room_users
          (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,phone_number,organization,job_title,country,city,birth_date,birth_place,address,role,terms_accepted_at,terms_version)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),$17) RETURNING *`,
        [
          name,
          username,
          email,
          createAvatar(name),
          passwordData.hash,
          passwordData.salt,
          new Date().toISOString(),
          normalizeText(request.body?.phoneNumber).slice(0, 40),
          normalizeText(request.body?.organization).slice(0, 120),
          normalizeText(request.body?.jobTitle).slice(0, 120),
          normalizeText(request.body?.country).slice(0, 120),
          normalizeText(request.body?.city).slice(0, 120),
          birthDate,
          normalizeText(request.body?.birthPlace).slice(0, 160),
          normalizeText(request.body?.address).slice(0, 240),
          role,
          terms.version,
        ],
      );
      await linkPendingWorkGroupMemberships(Number(inserted.rows[0].id), email);
      const session = await createSession(Number(inserted.rows[0].id), true);
      const appUrl = String(process.env.MBOTE_ROOM_APP_URL || resolveAllowedClientOrigin(request.headers.origin, getOrigin(request))).replace(/\/+$/, '');
      const welcomeEmailSent = await sendWelcomeEmail(email, name, appUrl).catch(() => false);
      attachSessionCookie(response, session);
      response.status(201).json({
        ...publicSessionPayload(request, session),
        accountCreated: true,
        welcomeEmailSent,
        security: { otpRequiredOnNextLogin: true, passwordEmailed: false },
      });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/admin/register', requireDatabase, async (request, response, next) => {
    try {
      const name = normalizeText(request.body?.name).slice(0, 120);
      const email = normalizeEmail(request.body?.email);
      const password = String(request.body?.password || '');
      const inviteToken = String(request.body?.inviteToken || '').trim();
      if (!name || !email || !password) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Nom, e-mail et mot de passe sont requis.');
      if (!(await canRegisterAdminEmail(email, inviteToken))) {
        return sendApiError(response, 403, 'ADMIN_INVITE_REQUIRED', 'Un compte administrateur existe déjà. Demandez une invitation administrateur depuis le backoffice, ou utilisez le compte administrateur existant.');
      }
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return sendApiError(response, 400, 'PASSWORD_WEAK', passwordError);
      await query(`DELETE FROM room_users WHERE lower(email)=lower($1) AND role='admin' AND is_suspended=true
        AND EXISTS (SELECT 1 FROM room_login_otps WHERE user_id=room_users.id AND purpose='admin_register' AND expires_at<=now())
        AND NOT EXISTS (SELECT 1 FROM room_login_otps WHERE user_id=room_users.id AND purpose='admin_register' AND expires_at>now() AND consumed_at IS NULL)`, [email]);
      const duplicate = await query('SELECT 1 FROM room_users WHERE lower(email)=lower($1) LIMIT 1', [email]);
      if (duplicate.rows[0]) return sendApiError(response, 409, 'EMAIL_ALREADY_EXISTS', 'Un compte existe déjà avec cette adresse.');
      const passwordData = hashPassword(password);
      const username = normalizeText(request.body?.username || email.split('@')[0]).toLowerCase().slice(0, 80);
      const inserted = await query(
        `INSERT INTO room_users
          (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,phone_number,organization,job_title,role,is_suspended)
         VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9,$10,'admin',true) RETURNING *`,
        [name, username, email, createAvatar(name), passwordData.hash, passwordData.salt, new Date().toISOString(), normalizeText(request.body?.phoneNumber).slice(0,40), normalizeText(request.body?.organization).slice(0,120), normalizeText(request.body?.jobTitle).slice(0,120)],
      );
      const challenge = await issueLoginOtp(inserted.rows[0], true);
      if (!challenge) {
        await query('DELETE FROM room_users WHERE id=$1 AND is_suspended=true', [inserted.rows[0].id]);
        return sendApiError(response, 503, 'OTP_DELIVERY_FAILED', 'Impossible d’envoyer le code de vérification. Réessayez dans quelques instants.');
      }
      await query("UPDATE room_login_otps SET purpose='admin_register' WHERE challenge_id=$1", [challenge.challengeId]);
      response.status(201).json(challenge);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login', requireDatabase, async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      const result = await query("SELECT * FROM room_users WHERE lower(email) = lower($1) AND is_guest=false AND COALESCE(is_suspended,false)=false AND COALESCE(account_status,'active')<>'banned' LIMIT 1", [email]);
      const user = result.rows[0];
      if (!user) return sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');
      const adminOnly = request.body?.adminOnly === true;
      if (adminOnly && user.role !== 'admin') {
        return sendApiError(response, 403, 'ADMIN_ACCESS_REQUIRED', 'Ce compte n’est pas autorisé à accéder au backoffice.');
      }
      const password = String(request.body?.password || '');
      if (!verifyPasswordHash(password, String(user.password_salt || ''), String(user.password_hash || ''))) {
        return sendApiError(response, 401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect.');
      }

      await linkPendingWorkGroupMemberships(Number(user.id), String(user.email));
      await query('DELETE FROM room_login_otps WHERE user_id=$1 OR expires_at<=now() OR consumed_at IS NOT NULL', [user.id]);
      const challengeId = createId();
      const code = createOtpCode();
      const expiresMinutes = 10;
      await query(
        `INSERT INTO room_login_otps (challenge_id,user_id,code_hash,remember_me,expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '10 minutes')`,
        [challengeId, user.id, hashToken(code), Boolean(request.body?.rememberMe)],
      );
      const delivered = await sendLoginOtpEmail(String(user.email), String(user.name || user.username || 'Utilisateur'), code, expiresMinutes).catch(() => false);
      if (!delivered) {
        await query('DELETE FROM room_login_otps WHERE challenge_id=$1', [challengeId]);
        return sendApiError(response, 503, 'OTP_DELIVERY_FAILED', 'Impossible d’envoyer le code de connexion. Réessayez dans quelques instants.');
      }
      const [local, domain] = String(user.email).split('@');
      const emailHint = local && domain ? local.slice(0, 2)+'***@'+domain : 'votre adresse e-mail';
      response.json({ otpRequired: true, challengeId, emailHint, expiresInSeconds: expiresMinutes * 60 });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login/otp', requireDatabase, async (request, response, next) => {
    try {
      const challengeId = String(request.body?.challengeId || '');
      const code = String(request.body?.code || '').replace(/\D/g, '').slice(0, 6);
      if (!challengeId || code.length !== 6) return sendApiError(response, 400, 'OTP_INVALID', 'Saisissez le code à 6 chiffres reçu par e-mail.');
      const result = await query(
        `SELECT o.*,u.email,u.name,u.username FROM room_login_otps o
         JOIN room_users u ON u.id=o.user_id
         WHERE o.challenge_id=$1 AND (COALESCE(u.is_suspended,false)=false OR (o.purpose='admin_register' AND u.role='admin')) LIMIT 1`,
        [challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
        return sendApiError(response, 400, 'OTP_EXPIRED', 'Ce code a expiré. Recommencez la connexion.');
      }
      if (Number(challenge.attempts || 0) >= 5) {
        await query('UPDATE room_login_otps SET consumed_at=now() WHERE challenge_id=$1', [challengeId]);
        return sendApiError(response, 429, 'OTP_TOO_MANY_ATTEMPTS', 'Trop de tentatives. Recommencez la connexion.');
      }
      if (hashToken(code) !== String(challenge.code_hash)) {
        await query('UPDATE room_login_otps SET attempts=attempts+1 WHERE challenge_id=$1', [challengeId]);
        return sendApiError(response, 401, 'OTP_INVALID', 'Code incorrect. Vérifiez l’e-mail reçu.');
      }
      if (challenge.purpose === 'admin_register') {
        const activated = await query("UPDATE room_users SET is_suspended=false WHERE id=$1 AND role='admin' AND is_suspended=true RETURNING id", [challenge.user_id]);
        if (!activated.rows[0]) return sendApiError(response, 403, 'ADMIN_REGISTRATION_INVALID', 'Cette création de compte n’est plus disponible.');
        await query(
          `UPDATE room_admin_invites
              SET consumed_at=COALESCE(consumed_at,now())
            WHERE lower(email)=lower($1)
              AND consumed_at IS NULL
              AND expires_at>now()`,
          [normalizeEmail(challenge.email)],
        );
        const appUrl = String(process.env.MBOTE_ROOM_APP_URL || resolveAllowedClientOrigin(request.headers.origin, getOrigin(request))).replace(/\/+$/, '');
        await sendWelcomeEmail(String(challenge.email), String(challenge.name), appUrl).catch(() => false);
      }
      await query('UPDATE room_login_otps SET consumed_at=now() WHERE challenge_id=$1', [challengeId]);
      const session = await createSession(Number(challenge.user_id), Boolean(challenge.remember_me));
      respondWithSession(request, response, session);
    } catch (error) { next(error); }
  });

  app.post('/api/auth/login/otp/resend', requireDatabase, async (request, response, next) => {
    try {
      const challengeId = String(request.body?.challengeId || '');
      const result = await query(
        `SELECT o.*,u.email,u.name,u.username,u.role,u.is_suspended FROM room_login_otps o
         JOIN room_users u ON u.id=o.user_id
         WHERE o.challenge_id=$1
           AND o.consumed_at IS NULL
           AND (COALESCE(u.is_suspended,false)=false OR (o.purpose='admin_register' AND u.role='admin'))
         LIMIT 1`,
        [challengeId],
      );
      const challenge = result.rows[0];
      if (!challenge) return sendApiError(response, 400, 'OTP_EXPIRED', 'Session OTP expirée. Recommencez la connexion.');
      const lastSentAt = new Date(challenge.created_at).getTime();
      const resendDelayMs = 30_000;
      if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < resendDelayMs) {
        const retryAfter = Math.max(1, Math.ceil((resendDelayMs - (Date.now() - lastSentAt)) / 1000));
        response.setHeader('Retry-After', String(retryAfter));
        return sendApiError(response, 429, 'OTP_RESEND_TOO_SOON', `Patientez ${retryAfter} seconde(s) avant de demander un nouveau code.`);
      }
      const code = createOtpCode();
      await query(
        `UPDATE room_login_otps SET code_hash=$2,attempts=0,expires_at=now()+interval '10 minutes',created_at=now() WHERE challenge_id=$1`,
        [challengeId, hashToken(code)],
      );
      const delivered = await sendLoginOtpEmail(String(challenge.email), String(challenge.name || challenge.username || 'Utilisateur'), code, 10).catch(() => false);
      if (!delivered) return sendApiError(response, 503, 'OTP_DELIVERY_FAILED', 'Impossible de renvoyer le code pour le moment.');
      response.json({ success: true, expiresInSeconds: 600 });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/guest-join', requireDatabase, async (request, response, next) => {
    try {
      if (!(await isPlatformFeatureEnabled('guestAccessEnabled'))) {
        return sendApiError(response, 403, 'GUEST_ACCESS_DISABLED', 'L’accès invité est temporairement indisponible.');
      }
      const name = normalizeText(request.body?.name).slice(0, 100);
      const meeting = await findMeeting(request.body?.meetingCode);
      if (!name) return sendApiError(response, 400, 'VALIDATION_ERROR', 'Votre nom est requis.');
      const terms = await validateTermsAcceptance(request.body);
      if (!terms.accepted) return sendApiError(response, 400, 'TERMS_NOT_ACCEPTED', 'Vous devez lire et accepter les conditions d’utilisation avant de rejoindre en invité.');
      if (!meeting) return sendApiError(response, 404, 'MEETING_NOT_FOUND', 'Réunion introuvable.');
      if (meeting.status === 'ended' || meeting.status === 'cancelled') {
        return sendApiError(response, 410, 'MEETING_ENDED', 'Cette réunion est terminée ou annulée.');
      }
      if (meeting.settings.externalAccess === false) {
        return sendApiError(response, 403, 'MEETING_EXTERNAL_ACCESS_DISABLED', 'Les comptes invités ne sont pas autorisés dans cette réunion.');
      }
      if (meeting.settings.locked === true) {
        return sendApiError(response, 423, 'MEETING_LOCKED', 'La réunion est verrouillée par l’hôte.');
      }
      if (!validateMeetingPassword(meeting, request.body?.password)) {
        return sendApiError(response, 403, 'MEETING_PASSWORD_INVALID', 'Mot de passe de réunion incorrect.');
      }

      const hostHasStarted = meeting.is_active || meeting.status === 'live';
      const blockedUntilHost = !hostHasStarted && meeting.settings.joinBeforeHost !== true;
      const status = !blockedUntilHost && meeting.settings.waitingRoom === false ? 'accepted' : 'requested';

      if (status === 'accepted' && await acceptedMemberCount(meeting.id) >= meetingCapacity(meeting)) {
        return sendApiError(response, 409, 'MEETING_CAPACITY_REACHED', 'La capacité maximale de la réunion est atteinte.');
      }

      const randomPassword = hashPassword(createToken());
      const guestEmail = `guest-${createId()}@guest.mbote.local`;
      const inserted = await query(
        `INSERT INTO room_users (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,role,terms_accepted_at,terms_version)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7,'guest',now(),$8) RETURNING *`,
        [name, `guest-${createId().slice(0, 8)}`, guestEmail, createAvatar(name), randomPassword.hash, randomPassword.salt, new Date().toISOString(), terms.version],
      );
      const user = toPublicUser(inserted.rows[0]);

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
           ON CONFLICT (meeting_id,user_id) DO UPDATE SET role='participant',status='accepted',joined_at=COALESCE(room_meeting_members.joined_at,now()),left_at=NULL,updated_at=now()`,
          [meeting.id, user.id],
        );
      }

      const session = await createSession(user.id, false);
      attachSessionCookie(response, session);
      response.status(201).json({
        ...publicSessionPayload(request, session),
        meeting: { ...publicMeeting(meeting), settings: { ...publicMeeting(meeting).settings } },
        lobbyStatus: status,
      });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', requireDatabase, authenticateToken, (request: AuthedRequest, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.json({ user: request.user });
  });

  app.post('/api/auth/activity', requireDatabase, async (request, response, next) => {
    try {
      const rawToken = getRawSessionTokenFromRequest(request);
      const touched = await touchSessionActivity(rawToken);
      if (!touched) return sendApiError(response, 401, 'SESSION_IDLE_EXPIRED', 'Votre session a expiré après 5 minutes d’inactivité.');
      response.setHeader('Cache-Control', 'no-store');
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/api/auth/logout', requireDatabase, async (request, response, next) => {
    try {
      const rawToken = getRawSessionTokenFromRequest(request);
      if (rawToken) await query('DELETE FROM room_sessions WHERE token_hash=$1', [hashToken(rawToken)]);
      clearSessionCookie(response);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.post('/api/auth/forgot-password', requireDatabase, async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      const adminFlow = request.body?.admin === true;
      const userResult = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? await query(`SELECT * FROM room_users WHERE lower(email)=lower($1) AND is_guest=false LIMIT 1`, [email])
        : { rows: [] };
      if (adminFlow && userResult.rows[0] && String(userResult.rows[0].role) !== 'admin') {
        userResult.rows = [];
      }
      if (userResult.rows[0]) {
        const rawToken = createToken();
        await query('DELETE FROM room_password_resets WHERE user_id=$1 OR expires_at<=now()', [userResult.rows[0].id]);
        await query(
          `INSERT INTO room_password_resets (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '30 minutes')`,
          [hashToken(rawToken), userResult.rows[0].id],
        );
        const appUrl = String(process.env.MBOTE_ROOM_APP_URL || getOrigin(request)).replace(/\/+$/, '');
        const resetPath = adminFlow ? '/admin/mot-de-passe-oublie' : '/mot-de-passe-oublie';
        const delivered = await sendResetEmail(email, `${appUrl}${resetPath}#reset=${encodeURIComponent(rawToken)}`);
        if (!delivered) {
          await query('DELETE FROM room_password_resets WHERE token_hash=$1', [hashToken(rawToken)]);
          console.warn('MBotéRoom password reset email delivery failed');
        }
      }
      response.json({ success: true, message: 'Si ce compte existe, un lien de réinitialisation a été envoyé.' });
    } catch (error) { next(error); }
  });

  app.post('/api/auth/reset-password', requireDatabase, async (request, response, next) => {
    try {
      const token = String(request.body?.token || '');
      const password = String(request.body?.password || '');
      if (!token) return sendApiError(response, 400, 'PASSWORD_RESET_INVALID', 'Lien de réinitialisation invalide ou expiré.');
      const passwordError = validatePasswordStrength(password);
      if (passwordError) return sendApiError(response, 400, 'PASSWORD_WEAK', passwordError);
      const reset = await query(`SELECT * FROM room_password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() LIMIT 1`, [hashToken(token)]);
      if (!reset.rows[0]) return sendApiError(response, 400, 'PASSWORD_RESET_INVALID', 'Lien de réinitialisation invalide ou expiré.');
      const passwordData = hashPassword(password);
      await query('UPDATE room_users SET password_hash=$2,password_salt=$3 WHERE id=$1', [reset.rows[0].user_id, passwordData.hash, passwordData.salt]);
      await query('UPDATE room_password_resets SET used_at=now() WHERE token_hash=$1', [hashToken(token)]);
      await query('DELETE FROM room_sessions WHERE user_id=$1', [reset.rows[0].user_id]);
      response.json({ success: true, message: 'Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter.' });
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
      pruneTemporaryAuthStates();
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
      const user = await findAndLinkExternalUser(challenge.profile);
      if (!user) return sendApiError(response, 403, 'ACCOUNT_NOT_REGISTERED', 'Aucun compte MBotéRoom actif n’est associé à ce compte MBoté. Créez d’abord votre compte MBotéRoom.');
      const otp = await issueLoginOtp(user, true);
      if (!otp) return sendApiError(response, 503, 'OTP_DELIVERY_FAILED', 'Impossible d’envoyer le code de connexion. Réessayez dans quelques instants.');
      response.json(otp);
    } catch (error) { next(error); }
  });

  app.get('/api/auth/mbote/start', requireDatabase, (request, response) => {
    const authorizeUrl = String(process.env.MBOTE_AUTH_AUTHORIZE_URL || '').trim();
    const clientId = String(process.env.MBOTE_AUTH_CLIENT_ID || '').trim();
    const redirectUri = String(process.env.MBOTE_AUTH_REDIRECT_URI || `${getOrigin(request)}/api/auth/mbote/callback`).trim();
    if (!authorizeUrl || !clientId) return sendApiError(response, 503, 'MBOTE_AUTH_NOT_CONFIGURED', 'OAuth MBoté non configuré.');
    pruneTemporaryAuthStates();
    const state = createToken();
    const redirectTo = safeRedirectPath(request.query.redirect);
    const clientOrigin = resolveAllowedClientOrigin(
      request.headers.origin,
      process.env.MBOTE_ROOM_APP_URL || getOrigin(request),
    );
    oauthStates.set(state, { redirectTo, clientOrigin, createdAt: Date.now() });
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
      const user = await findAndLinkExternalUser(profile);
      if (!user) {
        const failure = new URLSearchParams({ externalAuth: 'failed', reason: 'Aucun compte MBotéRoom actif n’est associé à ce compte MBoté. Créez d’abord votre compte MBotéRoom.' });
        response.redirect(`${stored.clientOrigin}/login?${failure.toString()}`);
        return;
      }
      const otp = await issueLoginOtp(user, true);
      if (!otp) {
        const failure = new URLSearchParams({ externalAuth: 'failed', reason: 'Impossible d’envoyer le code OTP de connexion.' });
        response.redirect(`${stored.clientOrigin}/login?${failure.toString()}`);
        return;
      }
      const hash = new URLSearchParams({
        otpChallengeId: otp.challengeId,
        otpEmailHint: otp.emailHint,
        otpExpiresInSeconds: String(otp.expiresInSeconds),
        redirect: stored.redirectTo,
      });
      response.redirect(`${stored.clientOrigin}/login#${hash.toString()}`);
    } catch (error) { next(error); }
  });
};
