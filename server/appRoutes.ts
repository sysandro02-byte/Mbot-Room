import type express from 'express';
import type { Server } from 'socket.io';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  mapMeeting,
  publicMeeting,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';

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
      const startsAt=new Date(request.body?.startsAt);const endsAt=new Date(request.body?.endsAt);const title=String(request.body?.title||'').trim().slice(0,200);
      if(!title||Number.isNaN(startsAt.getTime())||Number.isNaN(endsAt.getTime())||endsAt<=startsAt)return sendApiError(response,400,'VALIDATION_ERROR','Titre et horaires valides requis.');
      const id=createId();const result=await query(`INSERT INTO room_calendar_events (id,user_id,meeting_id,title,description,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,request.user!.id,request.body?.meetingId?Number(request.body.meetingId):null,title,String(request.body?.description||'').trim().slice(0,1000),startsAt.toISOString(),endsAt.toISOString()]);io.to(`user:${request.user!.id}`).emit('calendar:event-updated',result.rows[0]);response.status(201).json(result.rows[0]);
    }catch(error){next(error);}
  });
  app.put('/api/calendar/events/:eventId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query(`UPDATE room_calendar_events SET title=$3,description=$4,starts_at=$5,ends_at=$6,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[request.params.eventId,request.user!.id,String(request.body?.title||'').trim().slice(0,200),String(request.body?.description||'').trim().slice(0,1000),new Date(request.body?.startsAt).toISOString(),new Date(request.body?.endsAt).toISOString()]);if(!result.rows[0])return sendApiError(response,404,'CALENDAR_EVENT_NOT_FOUND','Événement introuvable.');io.to(`user:${request.user!.id}`).emit('calendar:event-updated',result.rows[0]);response.json(result.rows[0]);}catch(error){next(error);}
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
};
