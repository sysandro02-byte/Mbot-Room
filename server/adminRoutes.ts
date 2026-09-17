import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  adminPermissions,
  authenticateToken,
  createId,
  mapMeeting,
  normalizeText,
  publicMeeting,
  query,
  requireAdmin,
  requireDatabase,
  sendApiError,
} from './core.js';

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

  app.get('/api/public/guest-access-slides', requireDatabase, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides WHERE is_active=true ORDER BY created_at ASC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.get('/api/admin/guest-access-slides', ...adminApi, async (_request,response,next)=>{try{const result=await query('SELECT * FROM room_guest_access_slides ORDER BY updated_at DESC');response.json(result.rows.map(rowToSlide));}catch(error){next(error);}});
  app.post('/api/admin/guest-access-slides', ...adminApi, async (request,response,next)=>{try{const title=normalizeText(request.body?.title).slice(0,160);const body=normalizeText(request.body?.body).slice(0,1200);if(!title||!body)return sendApiError(response,400,'SLIDE_CONTENT_REQUIRED','Titre et contenu requis.');const id=createId();const result=await query(`INSERT INTO room_guest_access_slides (id,title,body,image_url,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[id,title,body,String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);response.status(201).json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.put('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{const result=await query(`UPDATE room_guest_access_slides SET title=$2,body=$3,image_url=$4,is_active=$5,updated_at=now() WHERE id=$1 RETURNING *`,[request.params.slideId,normalizeText(request.body?.title).slice(0,160),normalizeText(request.body?.body).slice(0,1200),String(request.body?.imageUrl||'').slice(0,1000),request.body?.isActive!==false]);if(!result.rows[0])return sendApiError(response,404,'SLIDE_NOT_FOUND','Slide introuvable.');response.json(rowToSlide(result.rows[0]));}catch(error){next(error);}});
  app.delete('/api/admin/guest-access-slides/:slideId', ...adminApi, async (request,response,next)=>{try{await query('DELETE FROM room_guest_access_slides WHERE id=$1',[request.params.slideId]);response.status(204).end();}catch(error){next(error);}});
};
