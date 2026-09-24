import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  adminPermissions,
  authenticateToken,
  createId,
  createToken,
  hashToken,
  mapMeeting,
  normalizeEmail,
  normalizeText,
  publicMeeting,
  query,
  requireAdmin,
  requireDatabase,
  sendApiError,
} from './core.js';
import { getPlatformSettings, updatePlatformSettings } from './platformSettings.js';

const rowToTip = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  actionLabel: String(row.action_label || ''),
  actionPath: String(row.action_path || ''),
  isActive: Boolean(row.is_active),
  startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : undefined,
  endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : undefined,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToSlide = (row: any) => ({
  id: String(row.id),
  title: String(row.title || ''),
  body: String(row.body || ''),
  imageUrl: String(row.image_url || ''),
  isActive: Boolean(row.is_active),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToHomeSlide = (row: any) => ({
  slot: Number(row.slot),
  title: String(row.title || ''),
  body: String(row.body || ''),
  imageUrl: String(row.image_url || ''),
  actionLabel: String(row.action_label || ''),
  actionPath: String(row.action_path || ''),
  isActive: Boolean(row.is_active),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const rowToLoginBranding = (row: any) => ({
  wordmarkUrl: String(row?.wordmark_url || '/icons/mboteroom-wordmark.png'),
  illustrationUrl: String(row?.illustration_url || '/images/meeting-black-team.svg'),
  updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
});

const safeManagedImageUrl = (value: unknown) => {
  const imageUrl = String(value || '').trim().slice(0, 1000);
  if (!imageUrl) return '';
  if (imageUrl.startsWith('/') && !imageUrl.startsWith('//') && !imageUrl.includes('\\')) return imageUrl;
  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
};

const safeHomeSlidePath = (value: unknown) => {
  const path = String(value || '').trim().slice(0, 300);
  if (!path) return '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '';
  return path;
};

const periodDays = (period: unknown) => {
  const value = String(period || '30d');
  if (value === '7d') return 7;
  if (value === '90d') return 90;
  if (value === '365d') return 365;
  return 30;
};

const realSparkline = async (days: number) => {
  const result = await query(
    `WITH series AS (
       SELECT generate_series(current_date - ($1::int - 1), current_date, interval '1 day')::date AS day
     )
     SELECT to_char(s.day,'DD/MM') AS label,
            COUNT(DISTINCT m.id)::int AS meetings,
            COUNT(DISTINCT u.id)::int AS users
       FROM series s
       LEFT JOIN room_meetings m ON m.created_at::date=s.day AND m.status<>'cancelled'
       LEFT JOIN room_users u ON u.created_at::timestamptz::date=s.day
      GROUP BY s.day ORDER BY s.day`, [Math.min(days, 31)],
  );
  return result.rows.map((row) => ({ label: row.label, meetings: Number(row.meetings), users: Number(row.users) }));
};

export const registerAdminRoutes = (app: express.Express, io: Server) => {
  const adminApi = [requireDatabase, authenticateToken, requireAdmin] as const;

  app.get('/api/admin/settings', ...adminApi, async (_request, response, next) => {
    try {
      response.json(await getPlatformSettings());
    } catch (error) { next(error); }
  });

  app.put('/api/admin/settings', ...adminApi, async (request, response, next) => {
    try {
      const settings = await updatePlatformSettings({
        registrationEnabled: typeof request.body?.registrationEnabled === 'boolean' ? request.body.registrationEnabled : undefined,
        guestAccessEnabled: typeof request.body?.guestAccessEnabled === 'boolean' ? request.body.guestAccessEnabled : undefined,
        meetingCreationEnabled: typeof request.body?.meetingCreationEnabled === 'boolean' ? request.body.meetingCreationEnabled : undefined,
        lunaEnabled: typeof request.body?.lunaEnabled === 'boolean' ? request.body.lunaEnabled : undefined,
        recordingEnabled: typeof request.body?.recordingEnabled === 'boolean' ? request.body.recordingEnabled : undefined,
        publicMeetingsEnabled: typeof request.body?.publicMeetingsEnabled === 'boolean' ? request.body.publicMeetingsEnabled : undefined,
        premiumPaymentEnabled: typeof request.body?.premiumPaymentEnabled === 'boolean' ? request.body.premiumPaymentEnabled : undefined,
        guestRaiseHandEnabled: typeof request.body?.guestRaiseHandEnabled === 'boolean' ? request.body.guestRaiseHandEnabled : undefined,
        guestRecordingEnabled: typeof request.body?.guestRecordingEnabled === 'boolean' ? request.body.guestRecordingEnabled : undefined,
        guestScreenShareEnabled: typeof request.body?.guestScreenShareEnabled === 'boolean' ? request.body.guestScreenShareEnabled : undefined,
        guestLunaEnabled: typeof request.body?.guestLunaEnabled === 'boolean' ? request.body.guestLunaEnabled : undefined,
        guestTranscriptionEnabled: typeof request.body?.guestTranscriptionEnabled === 'boolean' ? request.body.guestTranscriptionEnabled : undefined,
        guestChatEnabled: typeof request.body?.guestChatEnabled === 'boolean' ? request.body.guestChatEnabled : undefined,
      });
      io.emit('admin:settings-updated', settings);
      response.json(settings);
    } catch (error) { next(error); }
  });

  app.get('/api/admin/admin-invites', ...adminApi, async (_request: AuthedRequest, response, next) => {
    try {
      await query("DELETE FROM room_admin_invites WHERE consumed_at IS NULL AND expires_at<=now()-interval '7 days'");
      const result = await query(
        `SELECT id,email,expires_at,consumed_at,created_at
           FROM room_admin_invites
          ORDER BY created_at DESC
          LIMIT 100`,
      );
      response.json(result.rows.map((row) => ({
        id: String(row.id),
        email: String(row.email || ''),
        expiresAt: new Date(row.expires_at).toISOString(),
        consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
      })));
    } catch (error) { next(error); }
  });

  app.post('/api/admin/admin-invites', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendApiError(response,400,'ADMIN_INVITE_EMAIL_INVALID','Saisissez une adresse e-mail valide.');
      }
      const existing = await query('SELECT id,role FROM room_users WHERE lower(email)=lower($1) LIMIT 1',[email]);
      if (existing.rows[0]?.role === 'admin') {
        return sendApiError(response,409,'ADMIN_ALREADY_EXISTS','Cette adresse appartient déjà à un compte administrateur.');
      }
      const token = createToken();
      const id = createId();
      await query(
        `UPDATE room_admin_invites
            SET consumed_at=COALESCE(consumed_at,now())
          WHERE lower(email)=lower($1) AND consumed_at IS NULL`,
        [email],
      );
      const result = await query(
        `INSERT INTO room_admin_invites (id,email,token_hash,created_by,expires_at)
         VALUES ($1,$2,$3,$4,now()+interval '24 hours')
         RETURNING id,email,expires_at,consumed_at,created_at`,
        [id,email,hashToken(token),request.user!.id],
      );
      const invitePath = '/admin/inscription?invite='+encodeURIComponent(token)+'&email='+encodeURIComponent(email);
      io.to(`user:${request.user!.id}`).emit('admin:invite-created',{id,email,expiresAt:result.rows[0].expires_at});
      response.status(201).json({
        id:String(result.rows[0].id),
        email:String(result.rows[0].email),
        invitePath,
        expiresAt:new Date(result.rows[0].expires_at).toISOString(),
        consumedAt:null,
        createdAt:new Date(result.rows[0].created_at).toISOString(),
      });
    } catch (error) { next(error); }
  });

  app.delete('/api/admin/admin-invites/:inviteId', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query(
        `UPDATE room_admin_invites
            SET consumed_at=COALESCE(consumed_at,now())
          WHERE id=$1
          RETURNING id`,
        [request.params.inviteId],
      );
      if (!result.rows[0]) return sendApiError(response,404,'ADMIN_INVITE_NOT_FOUND','Invitation introuvable.');
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get('/api/admin/users', ...adminApi, async (request, response, next) => {
    try {
      const search = normalizeText(request.query.q).toLowerCase().slice(0,120);
      const term = search ? `%${search}%` : '%';
      const result = await query(
        `SELECT id,name,username,email,phone_number,organization,job_title,role,is_guest,is_suspended,created_at
           FROM room_users
          WHERE (lower(name) LIKE $1 OR lower(email) LIKE $1 OR lower(username) LIKE $1)
          ORDER BY is_guest ASC, created_at::timestamptz DESC
          LIMIT 250`,
        [term],
      );
      response.json(result.rows.map((row)=>({
        id:Number(row.id),
        name:String(row.name||''),
        username:String(row.username||''),
        email:String(row.email||''),
        phoneNumber:String(row.phone_number||''),
        organization:String(row.organization||''),
        jobTitle:String(row.job_title||''),
        role:String(row.role||'user'),
        isGuest:Boolean(row.is_guest),
        isSuspended:Boolean(row.is_suspended),
        createdAt:new Date(row.created_at).toISOString(),
      })));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/users/:userId', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const userId = Number(request.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) return sendApiError(response,400,'USER_INVALID','Utilisateur invalide.');
      const current = await query('SELECT * FROM room_users WHERE id=$1 LIMIT 1',[userId]);
      const row = current.rows[0];
      if (!row) return sendApiError(response,404,'USER_NOT_FOUND','Utilisateur introuvable.');
      const requestedSuspended = typeof request.body?.isSuspended === 'boolean' ? request.body.isSuspended : Boolean(row.is_suspended);
      if (userId === request.user!.id && requestedSuspended) {
        return sendApiError(response,400,'ADMIN_SELF_SUSPEND_FORBIDDEN','Vous ne pouvez pas suspendre votre propre compte.');
      }
      const name = normalizeText(request.body?.name ?? row.name).slice(0,120) || String(row.name);
      const organization = normalizeText(request.body?.organization ?? row.organization).slice(0,120);
      const jobTitle = normalizeText(request.body?.jobTitle ?? row.job_title).slice(0,120);
      const phoneNumber = normalizeText(request.body?.phoneNumber ?? row.phone_number).slice(0,40);
      const updated = await query(
        `UPDATE room_users
            SET name=$2,organization=$3,job_title=$4,phone_number=$5,is_suspended=$6
          WHERE id=$1
          RETURNING id,name,username,email,phone_number,organization,job_title,role,is_guest,is_suspended,created_at`,
        [userId,name,organization,jobTitle,phoneNumber,requestedSuspended],
      );
      if (requestedSuspended) {
        await query('DELETE FROM room_sessions WHERE user_id=$1',[userId]);
        io.in(`user:${userId}`).disconnectSockets(true);
      }
      io.emit('admin:user-updated',{userId,isSuspended:requestedSuspended});
      response.json({
        id:Number(updated.rows[0].id),
        name:String(updated.rows[0].name||''),
        username:String(updated.rows[0].username||''),
        email:String(updated.rows[0].email||''),
        phoneNumber:String(updated.rows[0].phone_number||''),
        organization:String(updated.rows[0].organization||''),
        jobTitle:String(updated.rows[0].job_title||''),
        role:String(updated.rows[0].role||'user'),
        isGuest:Boolean(updated.rows[0].is_guest),
        isSuspended:Boolean(updated.rows[0].is_suspended),
        createdAt:new Date(updated.rows[0].created_at).toISOString(),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/users/:userId/revoke-sessions', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const userId = Number(request.params.userId);
      if (!Number.isSafeInteger(userId) || userId <= 0) return sendApiError(response, 400, 'USER_INVALID', 'Utilisateur invalide.');
      if (userId === request.user!.id) return sendApiError(response, 400, 'ADMIN_SELF_REVOKE_FORBIDDEN', 'Utilisez la déconnexion pour fermer votre session.');
      const user = await query('SELECT id FROM room_users WHERE id=$1 LIMIT 1', [userId]);
      if (!user.rows[0]) return sendApiError(response, 404, 'USER_NOT_FOUND', 'Utilisateur introuvable.');
      await query('DELETE FROM room_sessions WHERE user_id=$1', [userId]);
      io.in(`user:${userId}`).disconnectSockets(true);
      io.emit('admin:user-updated', { userId, sessionsRevoked: true });
      response.json({ success: true });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/dashboard', ...adminApi, async (request, response, next) => {
    try {
      const days = periodDays(request.query.period);
      const [usersResult, meetingsResult, liveResult, recordingsResult, guestsResult, bansResult, minutesResult, liveMeetingsResult] = await Promise.all([
        query(`SELECT COUNT(*)::int AS count FROM room_users WHERE created_at::timestamptz >= now() - ($1::int || ' days')::interval`, [days]),
        query(`SELECT COUNT(*)::int AS count FROM room_meetings WHERE status<>'cancelled' AND created_at >= now() - ($1::int || ' days')::interval`, [days]),
        query(`SELECT COUNT(*)::int AS count FROM room_meetings WHERE status='live' AND is_active=true`),
        query(`SELECT COUNT(*)::int AS count FROM room_recordings`),
        query(`SELECT COUNT(*)::int AS count FROM room_users WHERE is_guest=true`),
        query(`SELECT COUNT(DISTINCT user_id)::int AS count FROM room_meeting_bans`),
        query(`SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at,now())-started_at))/60),0)::int AS minutes FROM room_meetings WHERE started_at IS NOT NULL`),
        query(`SELECT * FROM room_meetings WHERE status='live' AND is_active=true ORDER BY started_at DESC LIMIT 20`),
      ]);
      const allUsers = await query(`SELECT COUNT(*)::int AS count FROM room_users`);
      const usage = await realSparkline(days);
      const totalUsers = Number(allUsers.rows[0]?.count || 0);
      const guests = Number(guestsResult.rows[0]?.count || 0);
      const activities = await query(`
        SELECT 'meeting' AS type,id::text AS id,title AS title,'Réunion créée' AS description,created_at AS created_at FROM room_meetings
        UNION ALL
        SELECT 'user' AS type,id::text AS id,name AS title,'Compte créé' AS description,created_at::timestamptz AS created_at FROM room_users
        ORDER BY created_at DESC LIMIT 10
      `);
      const stats = [
        { id:'users',label:'Utilisateurs total',value:Number(usersResult.rows[0]?.count||0),evolution:0,helper:`${days} derniers jours`,points:usage.map((x)=>x.users) },
        { id:'meetings',label:'Réunions créées',value:Number(meetingsResult.rows[0]?.count||0),evolution:0,helper:`${days} derniers jours`,points:usage.map((x)=>x.meetings) },
        { id:'live',label:'Réunions en direct',value:Number(liveResult.rows[0]?.count||0),evolution:0,helper:'En ce moment',points:usage.map((x)=>x.meetings) },
        { id:'hours',label:'Heures de réunion',value:Math.round(Number(minutesResult.rows[0]?.minutes||0)/60),suffix:'h',evolution:0,helper:'Durée réelle terminée',points:usage.map(()=>0) },
        { id:'recordings',label:'Enregistrements',value:Number(recordingsResult.rows[0]?.count||0),evolution:0,helper:'Stockage réel déclaré',points:usage.map(()=>0) },
      ];
      response.json({
        stats,
        liveMeetings: liveMeetingsResult.rows.map(publicMeeting),
        recentActivity: activities.rows.map((row)=>({ id:`${row.type}-${row.id}`,type:row.type,title:row.title,description:row.description,createdAt:new Date(row.created_at).toISOString() })),
        usage,
        distribution:{ active:Math.max(0,totalUsers-guests),guests,inactive:0,banned:Number(bansResult.rows[0]?.count||0) },
        countries:[],
        permissions:adminPermissions,
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/search', ...adminApi, async (request, response, next) => {
    try {
      const term = `%${normalizeText(request.query.q).toLowerCase()}%`;
      const [meetings, users] = await Promise.all([
        query(`SELECT * FROM room_meetings WHERE lower(title) LIKE $1 OR lower(meeting_link) LIKE $1 ORDER BY created_at DESC LIMIT 20`, [term]),
        query(`SELECT id,name,email FROM room_users WHERE lower(name) LIKE $1 OR lower(email) LIKE $1 ORDER BY name LIMIT 20`, [term]),
      ]);
      response.json({ meetings: meetings.rows.map(publicMeeting), users: users.rows });
    } catch (error) { next(error); }
  });

  app.post('/api/admin/meetings/:meetingId/join', ...adminApi, async (request: AuthedRequest, response, next) => {
    try {
      const result = await query('SELECT * FROM room_meetings WHERE id=$1 LIMIT 1',[Number(request.params.meetingId)]);
      if(!result.rows[0]) return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      const meeting=mapMeeting(result.rows[0]);
      await query(`INSERT INTO room_meeting_members (meeting_id,user_id,role,status,joined_at) VALUES ($1,$2,'cohost','accepted',now()) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',role='cohost',updated_at=now()`,[meeting.id,request.user!.id]);
      response.json({success:true,meeting:publicMeeting(result.rows[0])});
    }catch(error){next(error);}
  });

  app.get('/api/dashboard/tips', requireDatabase, authenticateToken, async (_request,response,next)=>{
    try{const result=await query(`SELECT * FROM room_dashboard_tips WHERE is_active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now()) ORDER BY created_at ASC`);response.json(result.rows.map(rowToTip));}catch(error){next(error);}
  });

  app.get('/api/admin/dashboard-tips', ...adminApi, async (_request,response,next)=>{
    try{const result=await query('SELECT * FROM room_dashboard_tips ORDER BY updated_at DESC');response.json(result.rows.map(rowToTip));}catch(error){next(error);}
  });
  app.post('/api/admin/dashboard-tips', ...adminApi, async (request,response,next)=>{
    try{const body=normalizeText(request.body?.body).slice(0,1000);if(!body)return sendApiError(response,400,'TIP_BODY_REQUIRED','Le contenu de l’astuce est requis.');const id=createId();const result=await query(`INSERT INTO room_dashboard_tips (id,title,body,action_label,action_path,is_active,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,normalizeText(request.body?.title).slice(0,160),body,normalizeText(request.body?.actionLabel).slice(0,80),String(request.body?.actionPath||'').slice(0,300),request.body?.isActive!==false,request.body?.startsAt||null,request.body?.endsAt||null]);const tip=rowToTip(result.rows[0]);io.emit('dashboard:tips-updated',tip);response.status(201).json(tip);}catch(error){next(error);}
  });
  app.put('/api/admin/dashboard-tips/:tipId', ...adminApi, async (request,response,next)=>{
    try{const result=await query(`UPDATE room_dashboard_tips SET title=$2,body=$3,action_label=$4,action_path=$5,is_active=$6,updated_at=now() WHERE id=$1 RETURNING *`,[request.params.tipId,normalizeText(request.body?.title).slice(0,160),normalizeText(request.body?.body).slice(0,1000),normalizeText(request.body?.actionLabel).slice(0,80),String(request.body?.actionPath||'').slice(0,300),request.body?.isActive!==false]);if(!result.rows[0])return sendApiError(response,404,'TIP_NOT_FOUND','Astuce introuvable.');const tip=rowToTip(result.rows[0]);io.emit('dashboard:tips-updated',tip);response.json(tip);}catch(error){next(error);}
  });
  app.delete('/api/admin/dashboard-tips/:tipId', ...adminApi, async (request,response,next)=>{try{await query('DELETE FROM room_dashboard_tips WHERE id=$1',[request.params.tipId]);io.emit('dashboard:tips-updated');response.status(204).end();}catch(error){next(error);}});

  app.get('/api/public/login-branding', requireDatabase, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_login_branding WHERE id=1 LIMIT 1');
      response.setHeader('Cache-Control','no-store');
      response.json(rowToLoginBranding(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/login-branding', ...adminApi, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_login_branding WHERE id=1 LIMIT 1');
      response.setHeader('Cache-Control','no-store');
      response.json(rowToLoginBranding(result.rows[0]));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/login-branding', ...adminApi, async (request,response,next)=>{
    try {
      const wordmarkUrl = safeManagedImageUrl(request.body?.wordmarkUrl);
      const illustrationUrl = safeManagedImageUrl(request.body?.illustrationUrl);
      if (!wordmarkUrl || !illustrationUrl) {
        return sendApiError(response,400,'LOGIN_BRANDING_IMAGE_INVALID','Utilisez un chemin interne valide ou une URL HTTPS pour chaque image.');
      }
      const result = await query(
        `INSERT INTO room_login_branding (id,wordmark_url,illustration_url,updated_at)
         VALUES (1,$1,$2,now())
         ON CONFLICT (id) DO UPDATE SET wordmark_url=excluded.wordmark_url,illustration_url=excluded.illustration_url,updated_at=now()
         RETURNING *`,
        [wordmarkUrl,illustrationUrl],
      );
      const branding = rowToLoginBranding(result.rows[0]);
      io.emit('login:branding-updated', branding);
      response.json(branding);
    } catch (error) { next(error); }
  });

  app.get('/api/dashboard/slides', requireDatabase, authenticateToken, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_home_slides WHERE is_active=true ORDER BY slot ASC');
      response.json(result.rows.map(rowToHomeSlide));
    } catch (error) { next(error); }
  });

  app.get('/api/admin/home-slides', ...adminApi, async (_request,response,next)=>{
    try {
      const result = await query('SELECT * FROM room_home_slides ORDER BY slot ASC');
      response.json(result.rows.map(rowToHomeSlide));
    } catch (error) { next(error); }
  });

  app.put('/api/admin/home-slides/:slot', ...adminApi, async (request,response,next)=>{
    try {
      const slot = Number(request.params.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 4) return sendApiError(response,400,'HOME_SLIDE_SLOT_INVALID','L’emplacement doit être compris entre 1 et 4.');
      const title = normalizeText(request.body?.title).slice(0,120);
      const body = normalizeText(request.body?.body).slice(0,420);
      const actionLabel = normalizeText(request.body?.actionLabel).slice(0,50);
      const actionPath = safeHomeSlidePath(request.body?.actionPath);
      const imageUrl = String(request.body?.imageUrl || '').trim().slice(0,1000);
      if (!title || !body) return sendApiError(response,400,'HOME_SLIDE_CONTENT_REQUIRED','Le titre et le message du slide sont requis.');
      if (request.body?.actionPath && !actionPath) return sendApiError(response,400,'HOME_SLIDE_PATH_INVALID','La destination du bouton doit être une route interne valide.');
      const result = await query(
        `INSERT INTO room_home_slides (slot,title,body,image_url,action_label,action_path,is_active,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (slot) DO UPDATE SET
           title=excluded.title,
           body=excluded.body,
           image_url=excluded.image_url,
           action_label=excluded.action_label,
           action_path=excluded.action_path,
           is_active=excluded.is_active,
           updated_at=now()
         RETURNING *`,
        [slot,title,body,imageUrl,actionLabel,actionPath,request.body?.isActive!==false],
      );
      const slide = rowToHomeSlide(result.rows[0]);
      io.emit('dashboard:slides-updated', slide);
      response.json(slide);
    } catch (error) { next(error); }
  });

  app.get('/api/public/guest-access-slides', requireDatabase, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides WHERE is_active=true ORDER BY created_at ASC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.get('/api/admin/guest-access-slides', ...adminApi, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides ORDER BY updated_at DESC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.post('/api/admin/guest-access-slides', ...adminApi, async (request,response,next)=>{try{const title=normalizeText(request.body?.title).slice(0,160);const body=normalizeText(request.body?.body).slice(0,1200);if(!title||!body)return sendApiError(response,400,'SLIDE_CONTENT_REQUIRED','Titre et contenu requis.');const id=createId();const result=await query(`INSERT INTO room_guest_access_slides (id,title,body,image_url,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[id,title,body,String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);response.status(201).json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.put('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{const result=await query(`UPDATE room_guest_access_slides SET title=$2,body=$3,image_url=$4,is_active=$5,updated_at=now() WHERE id=$1 RETURNING *`,[request.params.slideId,normalizeText(request.body?.title).slice(0,160),normalizeText(request.body?.body).slice(0,1200),String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);if(!result.rows[0])return sendApiError(response,404,'SLIDE_NOT_FOUND','Slide introuvable.');response.json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.delete('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{await query('DELETE FROM room_guest_access_slides WHERE id=$1',[request.params.slideId]);response.status(204).end();}catch(error){next(error);}});
};
