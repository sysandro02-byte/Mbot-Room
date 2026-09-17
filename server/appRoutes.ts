import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  publicMeeting,
  query,
  requireDatabase,
  sendApiError,
  toPublicUser,
} from './core.js';

const parseDate = (value: unknown) => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const registerAppRoutes = (app: express.Express, io: Server) => {
  app.get('/api/health', async (_request, response) => {
    if (!process.env.DATABASE_URL) {
      response.status(503).json({ ok:false,service:'mbote-room',database:{configured:false,connected:false,type:'postgres'} });
      return;
    }
    try {
      const result = await query(`SELECT now() AS now,(SELECT COUNT(*)::int FROM room_users) AS users,(SELECT COUNT(*)::int FROM room_meetings) AS meetings`);
      response.json({ ok:true,service:'mbote-room',database:{configured:true,connected:true,type:'postgres',users:Number(result.rows[0].users),meetings:Number(result.rows[0].meetings)},serverTime:result.rows[0].now });
    } catch (error) {
      response.status(503).json({ ok:false,service:'mbote-room',database:{configured:true,connected:false,type:'postgres'},error:error instanceof Error?error.message:'Database unavailable' });
    }
  });

  app.get('/api/public/meetings', requireDatabase, async (_request,response,next)=>{
    try {
      const result=await query(`SELECT * FROM room_meetings WHERE status<>'cancelled' AND (settings->>'isPublic'='true' OR settings->>'visibility'='public') ORDER BY start_time ASC LIMIT 20`);
      response.json(result.rows.map(publicMeeting));
    } catch(error){next(error);}
  });

  app.get('/api/profile', requireDatabase, authenticateToken, (request:AuthedRequest,response)=>{
    response.json({user:request.user});
  });

  app.put('/api/profile', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const name=String(request.body?.name||request.user!.name).trim().slice(0,120);
      const username=String(request.body?.username||request.user!.username).trim().toLowerCase().replace(/\s+/g,'').slice(0,80);
      const avatar=String(request.body?.avatar??request.user!.avatar).trim().slice(0,1000);
      const phoneNumber=String(request.body?.phoneNumber??request.user!.phoneNumber??'').trim().slice(0,40);
      const organization=String(request.body?.organization??request.user!.organization??'').trim().slice(0,120);
      const jobTitle=String(request.body?.jobTitle??request.user!.jobTitle??'').trim().slice(0,120);
      if(!name||!username)return sendApiError(response,400,'VALIDATION_ERROR','Nom et nom d’utilisateur requis.');
      const duplicate=await query('SELECT 1 FROM room_users WHERE lower(username)=lower($1) AND id<>$2 LIMIT 1',[username,request.user!.id]);
      if(duplicate.rows[0])return sendApiError(response,409,'USERNAME_ALREADY_EXISTS','Ce nom d’utilisateur est déjà utilisé.');
      const result=await query(`UPDATE room_users SET name=$2,username=$3,avatar=$4,phone_number=$5,organization=$6,job_title=$7 WHERE id=$1 RETURNING *`,[request.user!.id,name,username,avatar,phoneNumber,organization,jobTitle]);
      const user=toPublicUser(result.rows[0]);
      io.to(`user:${user.id}`).emit('profile:updated',user);
      response.json({user});
    }catch(error){next(error);}
  });

  app.get('/api/preferences', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query('SELECT preferences FROM room_user_preferences WHERE user_id=$1 LIMIT 1',[request.user!.id]);response.json(result.rows[0]?.preferences||{});}catch(error){next(error);}
  });

  app.put('/api/preferences', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const allowed=['language','theme','notifications','audio','video','defaultMic','defaultCamera','background','timezone','accessibility'];
      const preferences:Record<string,unknown>={}; for(const key of allowed){if(Object.prototype.hasOwnProperty.call(request.body||{},key))preferences[key]=request.body[key];}
      const result=await query(`INSERT INTO room_user_preferences (user_id,preferences) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET preferences=room_user_preferences.preferences||excluded.preferences,updated_at=now() RETURNING preferences`,[request.user!.id,JSON.stringify(preferences)]);
      response.json(result.rows[0]?.preferences||{});
    }catch(error){next(error);}
  });

  app.get('/api/calendar/events', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query('SELECT * FROM room_calendar_events WHERE user_id=$1 ORDER BY starts_at ASC',[request.user!.id]);response.json(result.rows);}catch(error){next(error);}
  });
  app.post('/api/calendar/events', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const startsAt=parseDate(request.body?.startsAt);const endsAt=parseDate(request.body?.endsAt);const title=String(request.body?.title||'').trim().slice(0,200);
      if(!title||!startsAt||!endsAt||endsAt<=startsAt)return sendApiError(response,400,'VALIDATION_ERROR','Titre et horaires valides requis.');
      const id=createId();const result=await query(`INSERT INTO room_calendar_events (id,user_id,meeting_id,title,description,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,request.user!.id,request.body?.meetingId?Number(request.body.meetingId):null,title,String(request.body?.description||'').trim().slice(0,1000),startsAt.toISOString(),endsAt.toISOString()]);io.to(`user:${request.user!.id}`).emit('calendar:event-updated',result.rows[0]);response.status(201).json(result.rows[0]);
    }catch(error){next(error);}
  });
  app.put('/api/calendar/events/:eventId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const startsAt=parseDate(request.body?.startsAt);const endsAt=parseDate(request.body?.endsAt);if(!startsAt||!endsAt||endsAt<=startsAt)return sendApiError(response,400,'VALIDATION_ERROR','Horaires invalides.');
      const result=await query(`UPDATE room_calendar_events SET title=$3,description=$4,starts_at=$5,ends_at=$6,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[request.params.eventId,request.user!.id,String(request.body?.title||'').trim().slice(0,200),String(request.body?.description||'').trim().slice(0,1000),startsAt.toISOString(),endsAt.toISOString()]);if(!result.rows[0])return sendApiError(response,404,'CALENDAR_EVENT_NOT_FOUND','Événement introuvable.');io.to(`user:${request.user!.id}`).emit('calendar:event-updated',result.rows[0]);response.json(result.rows[0]);
    }catch(error){next(error);}
  });
  app.delete('/api/calendar/events/:eventId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{await query('DELETE FROM room_calendar_events WHERE id=$1 AND user_id=$2',[request.params.eventId,request.user!.id]);io.to(`user:${request.user!.id}`).emit('calendar:event-updated',{id:request.params.eventId,deleted:true});response.status(204).end();}catch(error){next(error);}});

  app.get('/api/notifications', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query(`SELECT * FROM room_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[request.user!.id]);response.json(result.rows.map((row)=>({...row,createdAt:new Date(row.created_at).toISOString(),readAt:row.read_at?new Date(row.read_at).toISOString():null})));}catch(error){next(error);}
  });
  app.post('/api/notifications/:notificationId/read', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{const result=await query('UPDATE room_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *',[request.params.notificationId,request.user!.id]);if(!result.rows[0])return sendApiError(response,404,'NOTIFICATION_NOT_FOUND','Notification introuvable.');response.json(result.rows[0]);}catch(error){next(error);}});
  app.post('/api/notifications/read-all', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{await query('UPDATE room_notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1',[request.user!.id]);response.json({success:true});}catch(error){next(error);}});

  app.get('/api/contacts', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(`SELECT DISTINCT u.id,u.name,u.username,u.email,u.avatar,u.is_guest
        FROM room_meeting_members mine
        JOIN room_meeting_members other ON other.meeting_id=mine.meeting_id AND other.user_id<>mine.user_id
        JOIN room_users u ON u.id=other.user_id
        WHERE mine.user_id=$1 AND other.status='accepted'
        ORDER BY u.name ASC LIMIT 200`,[request.user!.id]);
      response.json(result.rows);
    }catch(error){next(error);}
  });

  app.get('/api/recordings', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(`SELECT r.*,m.title,m.start_time FROM room_recordings r JOIN room_meetings m ON m.id=r.meeting_id WHERE m.host_id=$1 OR m.co_host_id=$1 OR EXISTS(SELECT 1 FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.user_id=$1 AND mm.status='accepted') ORDER BY r.created_at DESC`,[request.user!.id]);
      response.json(result.rows);
    }catch(error){next(error);}
  });

  app.get('/api/whiteboards', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query('SELECT id,owner_id,meeting_id,title,document,created_at,updated_at FROM room_whiteboards WHERE owner_id=$1 ORDER BY updated_at DESC',[request.user!.id]);response.json(result.rows);}catch(error){next(error);}
  });
  app.post('/api/whiteboards', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const id=createId();const title=String(request.body?.title||'Tableau blanc').trim().slice(0,160);const document=request.body?.document&&typeof request.body.document==='object'?request.body.document:{strokes:[]};const result=await query(`INSERT INTO room_whiteboards (id,owner_id,meeting_id,title,document) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,[id,request.user!.id,request.body?.meetingId?Number(request.body.meetingId):null,title,JSON.stringify(document)]);response.status(201).json(result.rows[0]);}catch(error){next(error);}
  });
  app.put('/api/whiteboards/:whiteboardId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const title=String(request.body?.title||'Tableau blanc').trim().slice(0,160);const document=request.body?.document&&typeof request.body.document==='object'?request.body.document:{strokes:[]};const result=await query(`UPDATE room_whiteboards SET title=$3,document=$4::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,[request.params.whiteboardId,request.user!.id,title,JSON.stringify(document)]);if(!result.rows[0])return sendApiError(response,404,'WHITEBOARD_NOT_FOUND','Tableau introuvable.');io.to(`user:${request.user!.id}`).emit('whiteboard:updated',result.rows[0]);response.json(result.rows[0]);}catch(error){next(error);}
  });
  app.delete('/api/whiteboards/:whiteboardId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{await query('DELETE FROM room_whiteboards WHERE id=$1 AND owner_id=$2',[request.params.whiteboardId,request.user!.id]);response.status(204).end();}catch(error){next(error);}});
};
