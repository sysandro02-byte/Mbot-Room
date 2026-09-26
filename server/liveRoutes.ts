import crypto from 'node:crypto';
import type express from 'express';
import type { Server } from 'socket.io';
import {
  type AuthedRequest,
  authenticateToken,
  createId,
  createMeetingAccessId,
  createMeetingLink,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';
import { createNotificationAndPush } from './pushService.js';

const categories = new Set(['business','music','games','events','wellness','education','tech','community','other']);
const visibilities = new Set(['public','private','followers']);
const clean = (value:unknown,max=500)=>String(value||'').trim().slice(0,max);
const liveUrl=(id:string,token='')=>`/app/live/${id}${token?`?invite=${encodeURIComponent(token)}`:''}`;

const mapLive=(row:any)=>({
  id:String(row.id),meetingId:Number(row.meeting_id),hostId:Number(row.host_id),
  hostName:String(row.host_name||''),hostAvatar:String(row.host_avatar||''),
  title:String(row.title||''),description:String(row.description||''),category:String(row.category||'other'),
  visibility:String(row.visibility||'public'),coverUrl:String(row.cover_url||''),status:String(row.status||'scheduled'),
  scheduledFor:row.scheduled_for?new Date(row.scheduled_for).toISOString():null,
  startedAt:row.started_at?new Date(row.started_at).toISOString():null,
  endedAt:row.ended_at?new Date(row.ended_at).toISOString():null,
  chatEnabled:row.chat_enabled!==false,cohostsEnabled:row.cohosts_enabled!==false,
  recordingEnabled:row.recording_enabled===true,moderationEnabled:row.moderation_enabled!==false,
  viewerCount:Number(row.viewer_count||0),peakViewerCount:Number(row.peak_viewer_count||0),
  likeCount:Number(row.like_count||0),commentCount:Number(row.comment_count||0),shareCount:Number(row.share_count||0),
  isLiked:Boolean(row.is_liked),isFollowing:Boolean(row.is_following),isHost:Boolean(row.is_host),
  canComment:Boolean(row.can_comment),canRequestParticipation:Boolean(row.can_request_participation),
  shareUrl:liveUrl(String(row.id),String(row.share_token||'')),
});

const loadLive=async(id:string,userId:number)=>{
  const result=await query(`
    SELECT l.*,u.name AS host_name,u.avatar AS host_avatar,
      (l.host_id=$2) AS is_host,
      EXISTS(SELECT 1 FROM room_live_likes x WHERE x.live_id=l.id AND x.user_id=$2) AS is_liked,
      EXISTS(SELECT 1 FROM room_live_follows f WHERE f.creator_id=l.host_id AND f.follower_id=$2) AS is_following,
      (SELECT COUNT(*)::int FROM room_live_comments c WHERE c.live_id=l.id AND c.deleted_at IS NULL) AS comment_count
    FROM room_live_sessions l JOIN room_users u ON u.id=l.host_id
    WHERE l.id=$1 LIMIT 1`,[id,userId]);
  return result.rows[0]||null;
};

const allowed=async(row:any,user:NonNullable<AuthedRequest['user']>,invite='')=>{
  if(Number(row.host_id)===user.id||user.role==='admin')return true;
  if(row.visibility==='public')return true;
  if(row.visibility==='private')return Boolean(invite&&crypto.timingSafeEqual(Buffer.from(String(row.share_token||'')),Buffer.from(invite)));
  if(row.visibility==='followers'){
    const result=await query('SELECT 1 FROM room_live_follows WHERE creator_id=$1 AND follower_id=$2 LIMIT 1',[row.host_id,user.id]);
    return Boolean(result.rows[0]);
  }
  return false;
};

export const registerLiveRoutes=(app:express.Express,io:Server)=>{
  const protectedApi=[requireDatabase,authenticateToken] as const;

  app.get('/api/live/feed',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const q=clean(request.query.q,120).toLowerCase();
      const category=clean(request.query.category,40).toLowerCase();
      const user=request.user!;
      const result=await query(`
        SELECT l.*,u.name AS host_name,u.avatar AS host_avatar,
          (l.host_id=$1) AS is_host,
          EXISTS(SELECT 1 FROM room_live_likes x WHERE x.live_id=l.id AND x.user_id=$1) AS is_liked,
          EXISTS(SELECT 1 FROM room_live_follows f WHERE f.creator_id=l.host_id AND f.follower_id=$1) AS is_following,
          (SELECT COUNT(*)::int FROM room_live_comments c WHERE c.live_id=l.id AND c.deleted_at IS NULL) AS comment_count
        FROM room_live_sessions l JOIN room_users u ON u.id=l.host_id
        WHERE l.status IN ('live','scheduled')
          AND (
            l.host_id=$1 OR l.visibility='public'
            OR (l.visibility='followers' AND EXISTS(SELECT 1 FROM room_live_follows f WHERE f.creator_id=l.host_id AND f.follower_id=$1))
          )
          AND ($2='' OR l.category=$2)
          AND ($3='' OR lower(l.title) LIKE '%'||$3||'%' OR lower(l.description) LIKE '%'||$3||'%' OR lower(u.name) LIKE '%'||$3||'%')
        ORDER BY CASE WHEN l.status='live' THEN 0 ELSE 1 END,l.viewer_count DESC,l.scheduled_for ASC
        LIMIT 100`,[user.id,category&&categories.has(category)?category:'',q]);
      response.json(result.rows.map((row:any)=>mapLive({...row,can_comment:!user.isGuest&&row.chat_enabled!==false,can_request_participation:!user.isGuest&&row.cohosts_enabled!==false})));
    }catch(error){next(error);}
  });

  app.post('/api/live',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const user=request.user!;
      if(user.isGuest)return sendApiError(response,403,'LIVE_ACCOUNT_REQUIRED','Créez un compte pour lancer un Live.');
      const title=clean(request.body?.title,100);
      if(!title)return sendApiError(response,400,'LIVE_TITLE_REQUIRED','Ajoutez un titre au Live.');
      const category=categories.has(clean(request.body?.category,40).toLowerCase())?clean(request.body.category,40).toLowerCase():'other';
      const visibility=visibilities.has(clean(request.body?.visibility,20).toLowerCase())?clean(request.body.visibility,20).toLowerCase():'public';
      const scheduledRaw=request.body?.scheduledFor?new Date(request.body.scheduledFor):new Date();
      const scheduledFor=Number.isFinite(scheduledRaw.getTime())?scheduledRaw:new Date();
      const startNow=request.body?.startNow===true||scheduledFor.getTime()<=Date.now()+30_000;
      const meetingLink=createMeetingLink();
      const settings={
        liveBroadcast:true,
        liveCategory:category,
        participantAudio:false,participantVideo:false,screenShare:false,
        chat:true,reactions:true,recording:request.body?.recordingEnabled===true,
        lunaSummary:true,encryption:true,linkSharing:true,externalAccess:true,
        joinBeforeHost:false,visibility,isPublic:visibility==='public',
        meetingAccessId:createMeetingAccessId(),
      };
      const meeting=await query(`INSERT INTO room_meetings(title,description,host_id,host_name,host_avatar,start_time,duration,meeting_link,is_active,settings,participant_count,status,started_at)
        VALUES($1,$2,$3,$4,$5,$6,240,$7,$8,$9::jsonb,1,$10,$11) RETURNING *`,[
          title,clean(request.body?.description,500),user.id,user.name,user.avatar||'',scheduledFor.toISOString(),meetingLink,startNow,JSON.stringify(settings),
          startNow?'live':'scheduled',startNow?new Date().toISOString():null,
        ]);
      await query(`INSERT INTO room_meeting_members(meeting_id,user_id,role,status,joined_at) VALUES($1,$2,'host','accepted',now())
        ON CONFLICT(meeting_id,user_id) DO UPDATE SET role='host',status='accepted',left_at=NULL,updated_at=now()`,[meeting.rows[0].id,user.id]);
      const id=createId();const shareToken=crypto.randomBytes(24).toString('base64url');
      const result=await query(`INSERT INTO room_live_sessions(id,meeting_id,host_id,title,description,category,visibility,cover_url,status,scheduled_for,started_at,chat_enabled,cohosts_enabled,recording_enabled,moderation_enabled,share_token)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[
          id,meeting.rows[0].id,user.id,title,clean(request.body?.description,500),category,visibility,clean(request.body?.coverUrl,1000),
          startNow?'live':'scheduled',scheduledFor.toISOString(),startNow?new Date().toISOString():null,
          request.body?.chatEnabled!==false,request.body?.cohostsEnabled!==false,request.body?.recordingEnabled===true,request.body?.moderationEnabled!==false,shareToken,
        ]);
      io.to('admins').emit('live:created',{liveId:id,hostId:user.id,status:result.rows[0].status});
      response.status(201).json(mapLive({...result.rows[0],host_name:user.name,host_avatar:user.avatar,is_host:true,is_liked:false,is_following:false,comment_count:0,can_comment:true,can_request_participation:false}));
    }catch(error){next(error);}
  });

  app.get('/api/live/:liveId',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);
      if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(!(await allowed(row,request.user!,clean(request.query.invite,200))))return sendApiError(response,403,'LIVE_ACCESS_DENIED','Ce Live est privé.');
      response.json(mapLive({...row,can_comment:!request.user!.isGuest&&row.chat_enabled!==false,can_request_participation:!request.user!.isGuest&&row.cohosts_enabled!==false}));
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/start',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);
      if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(Number(row.host_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'LIVE_HOST_REQUIRED','Seul l’hôte peut démarrer ce Live.');
      const now=new Date().toISOString();
      const updated=await query(`UPDATE room_live_sessions SET status='live',started_at=COALESCE(started_at,$2),updated_at=now() WHERE id=$1 RETURNING *`,[row.id,now]);
      await query(`UPDATE room_meetings SET status='live',is_active=true,started_at=COALESCE(started_at,$2::timestamptz),updated_at=now() WHERE id=$1`,[row.meeting_id,now]);
      const followers=await query('SELECT follower_id FROM room_live_follows WHERE creator_id=$1 LIMIT 500',[row.host_id]);
      await Promise.all(followers.rows.map((item:any)=>createNotificationAndPush(Number(item.follower_id),{
        type:'LIVE_STARTED',title:`${row.host_name} est en direct`,body:row.title,url:liveUrl(row.id),tag:`live-${row.id}`,data:{liveId:row.id},
      }).then((notification)=>io.to(`user:${item.follower_id}`).emit('notification:new',notification)).catch(()=>undefined)));
      io.to(`live:${row.id}`).emit('live:status',{liveId:row.id,status:'live',startedAt:now});
      response.json(mapLive({...updated.rows[0],host_name:row.host_name,host_avatar:row.host_avatar,is_host:true}));
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/end',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);
      if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(Number(row.host_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'LIVE_HOST_REQUIRED','Seul l’hôte peut terminer ce Live.');
      const now=new Date().toISOString();
      await query(`UPDATE room_live_sessions SET status='ended',ended_at=$2,viewer_count=0,updated_at=now() WHERE id=$1`,[row.id,now]);
      await query(`UPDATE room_meetings SET status='ended',is_active=false,ended_at=$2::timestamptz,updated_at=now() WHERE id=$1`,[row.meeting_id,now]);
      io.to(`live:${row.id}`).emit('live:status',{liveId:row.id,status:'ended',endedAt:now});
      response.json({success:true,status:'ended'});
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/join',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);
      if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(row.status!=='live')return sendApiError(response,409,'LIVE_NOT_ACTIVE','Ce Live n’est pas encore en direct.');
      if(!(await allowed(row,request.user!,clean(request.body?.inviteToken,200))))return sendApiError(response,403,'LIVE_ACCESS_DENIED','Ce Live est privé.');
      await query(`INSERT INTO room_meeting_members(meeting_id,user_id,role,status,joined_at) VALUES($1,$2,'participant','accepted',now())
        ON CONFLICT(meeting_id,user_id) DO UPDATE SET status='accepted',left_at=NULL,updated_at=now()`,[row.meeting_id,request.user!.id]);
      await query(`INSERT INTO room_live_viewers(live_id,user_id,joined_at,last_seen_at,left_at) VALUES($1,$2,now(),now(),NULL)
        ON CONFLICT(live_id,user_id) DO UPDATE SET joined_at=now(),last_seen_at=now(),left_at=NULL`,[row.id,request.user!.id]);
      const count=await query(`SELECT COUNT(*)::int AS count FROM room_live_viewers WHERE live_id=$1 AND left_at IS NULL AND last_seen_at>now()-interval '2 minutes'`,[row.id]);
      const viewers=Number(count.rows[0]?.count||0);
      await query('UPDATE room_live_sessions SET viewer_count=$2,peak_viewer_count=GREATEST(peak_viewer_count,$2),updated_at=now() WHERE id=$1',[row.id,viewers]);
      io.to(`live:${row.id}`).emit('live:presence',{liveId:row.id,viewerCount:viewers});
      response.json({success:true,meetingId:Number(row.meeting_id),viewerCount:viewers,role:Number(row.host_id)===request.user!.id?'host':'viewer'});
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/leave',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const id=String(request.params.liveId);
      await query('UPDATE room_live_viewers SET left_at=now(),last_seen_at=now() WHERE live_id=$1 AND user_id=$2',[id,request.user!.id]);
      const count=await query(`SELECT COUNT(*)::int AS count FROM room_live_viewers WHERE live_id=$1 AND left_at IS NULL AND last_seen_at>now()-interval '2 minutes'`,[id]);
      const viewers=Number(count.rows[0]?.count||0);
      await query('UPDATE room_live_sessions SET viewer_count=$2,updated_at=now() WHERE id=$1',[id,viewers]);
      io.to(`live:${id}`).emit('live:presence',{liveId:id,viewerCount:viewers});
      response.json({success:true,viewerCount:viewers});
    }catch(error){next(error);}
  });

  app.get('/api/live/:liveId/comments',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const result=await query(`SELECT c.id,c.user_id,c.text,c.created_at,u.name,u.avatar FROM room_live_comments c JOIN room_users u ON u.id=c.user_id
        WHERE c.live_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 150`,[request.params.liveId]);
      response.json(result.rows.reverse().map((r:any)=>({id:r.id,userId:Number(r.user_id),name:r.name,avatar:r.avatar||'',text:r.text,createdAt:new Date(r.created_at).toISOString()})));
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/comments',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      if(request.user!.isGuest)return sendApiError(response,403,'LIVE_COMMENT_ACCOUNT_REQUIRED','Connectez-vous avec un compte pour commenter.');
      const row=await loadLive(String(request.params.liveId),request.user!.id);
      if(!row||row.chat_enabled===false)return sendApiError(response,403,'LIVE_CHAT_DISABLED','Le chat est désactivé.');
      const text=clean(request.body?.text,500);if(!text)return sendApiError(response,400,'LIVE_COMMENT_EMPTY','Écrivez un commentaire.');
      const id=createId();
      const result=await query('INSERT INTO room_live_comments(id,live_id,user_id,text) VALUES($1,$2,$3,$4) RETURNING *',[id,row.id,request.user!.id,text]);
      const payload={id,userId:request.user!.id,name:request.user!.name,avatar:request.user!.avatar||'',text,createdAt:new Date(result.rows[0].created_at).toISOString()};
      io.to(`live:${row.id}`).emit('live:comment',payload);response.status(201).json(payload);
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/like',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const id=String(request.params.liveId);
      const existing=await query('SELECT 1 FROM room_live_likes WHERE live_id=$1 AND user_id=$2',[id,request.user!.id]);
      const liked=!existing.rows[0];
      if(liked)await query('INSERT INTO room_live_likes(live_id,user_id) VALUES($1,$2)',[id,request.user!.id]);
      else await query('DELETE FROM room_live_likes WHERE live_id=$1 AND user_id=$2',[id,request.user!.id]);
      const count=await query('SELECT COUNT(*)::int AS count FROM room_live_likes WHERE live_id=$1',[id]);
      const likeCount=Number(count.rows[0]?.count||0);await query('UPDATE room_live_sessions SET like_count=$2 WHERE id=$1',[id,likeCount]);
      io.to(`live:${id}`).emit('live:likes',{liveId:id,likeCount});response.json({liked,likeCount});
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/share',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{const result=await query('UPDATE room_live_sessions SET share_count=share_count+1 WHERE id=$1 RETURNING share_count,share_token',[request.params.liveId]);if(!result.rows[0])return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');response.json({shareCount:Number(result.rows[0].share_count),url:liveUrl(String(request.params.liveId),String(result.rows[0].share_token||''))});}catch(error){next(error);}
  });

  app.post('/api/live/:liveId/follow',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(Number(row.host_id)===request.user!.id)return sendApiError(response,400,'LIVE_SELF_FOLLOW','Vous êtes déjà le créateur.');
      const existing=await query('SELECT 1 FROM room_live_follows WHERE creator_id=$1 AND follower_id=$2',[row.host_id,request.user!.id]);const following=!existing.rows[0];
      if(following)await query('INSERT INTO room_live_follows(creator_id,follower_id) VALUES($1,$2)',[row.host_id,request.user!.id]);else await query('DELETE FROM room_live_follows WHERE creator_id=$1 AND follower_id=$2',[row.host_id,request.user!.id]);
      response.json({following});
    }catch(error){next(error);}
  });

  app.post('/api/live/:liveId/participation-requests',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      if(request.user!.isGuest)return sendApiError(response,403,'LIVE_PARTICIPATION_ACCOUNT_REQUIRED','Créez un compte pour demander à participer.');
      const row=await loadLive(String(request.params.liveId),request.user!.id);if(!row||row.cohosts_enabled===false)return sendApiError(response,403,'LIVE_COHOSTS_DISABLED','Les demandes de participation sont fermées.');
      await query(`INSERT INTO room_live_participation_requests(live_id,user_id,status) VALUES($1,$2,'pending')
        ON CONFLICT(live_id,user_id) DO UPDATE SET status='pending',created_at=now(),responded_at=NULL`,[row.id,request.user!.id]);
      io.to(`live:${row.id}:host`).emit('live:participation-request',{liveId:row.id,userId:request.user!.id,name:request.user!.name,avatar:request.user!.avatar||''});
      response.status(201).json({success:true,status:'pending'});
    }catch(error){next(error);}
  });

  app.get('/api/live/:liveId/participation-requests',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(Number(row.host_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'LIVE_HOST_REQUIRED','Accès hôte requis.');
      const result=await query(`SELECT r.*,u.name,u.avatar FROM room_live_participation_requests r JOIN room_users u ON u.id=r.user_id WHERE r.live_id=$1 ORDER BY r.created_at DESC`,[row.id]);
      response.json(result.rows.map((r:any)=>({userId:Number(r.user_id),name:r.name,avatar:r.avatar||'',status:r.status,createdAt:new Date(r.created_at).toISOString()})));
    }catch(error){next(error);}
  });

  app.patch('/api/live/:liveId/participation-requests/:userId',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const row=await loadLive(String(request.params.liveId),request.user!.id);if(!row)return sendApiError(response,404,'LIVE_NOT_FOUND','Live introuvable.');
      if(Number(row.host_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'LIVE_HOST_REQUIRED','Accès hôte requis.');
      const target=Number(request.params.userId);const status=request.body?.status==='accepted'?'accepted':'rejected';
      await query('UPDATE room_live_participation_requests SET status=$3,responded_at=now() WHERE live_id=$1 AND user_id=$2',[row.id,target,status]);
      if(status==='accepted'){
        await query('UPDATE room_meetings SET co_host_id=$2,updated_at=now() WHERE id=$1',[row.meeting_id,target]);
        await query(`INSERT INTO room_meeting_members(meeting_id,user_id,role,status,joined_at) VALUES($1,$2,'cohost','accepted',now())
          ON CONFLICT(meeting_id,user_id) DO UPDATE SET role='cohost',status='accepted',left_at=NULL,updated_at=now()`,[row.meeting_id,target]);
      }
      io.to(`user:${target}`).emit('live:participation-response',{liveId:row.id,status});response.json({success:true,status});
    }catch(error){next(error);}
  });
};
