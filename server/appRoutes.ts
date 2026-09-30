import type express from 'express';
import type { Server } from 'socket.io';
import { getRuntimeReadiness } from './readiness.js';
import {
  AuthedRequest,
  authenticateToken,
  createId,
  getDatabaseType,
  getRawSessionTokenFromRequest,
  hashToken,
  hasDatabase,
  publicMeeting,
  query,
  requireAccountFeature,
  requireDatabase,
  sendApiError,
  toPublicUser,
} from './core.js';
import { createNotificationAndPush, getPushStatus } from './pushService.js';
import { sendTransactionalEmail } from './emailDelivery.js';
import { getPlatformSettings, isPlatformFeatureEnabled } from './platformSettings.js';
import { deleteCalendarEventFromGoogle, syncCalendarEventToGoogle } from './workspaceRoutes.js';
import { parseSupabaseRecordingMarker, requestSupabaseRecordingSigner, type RecordingDownloadTicket } from './supabaseRecordingStorage.js';

const safeImageUrl = (value: unknown, fallback = '') => {
  const raw=String(value||'').trim().slice(0,800000);
  if(!raw)return fallback;
  if(raw.startsWith('/')&&!raw.startsWith('//'))return raw;
  if(/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(raw))return raw;
  try{
    const url=new URL(raw);
    return url.protocol==='https:'?url.href:fallback;
  }catch{return fallback;}
};

const parseDate = (value: unknown) => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? null : date;
};

const directConversationKey=(left:number,right:number)=>[left,right].sort((a,b)=>a-b).join(':');
const normalizePhoneNumber=(value:unknown)=>String(value||'').replace(/\D/g,'').slice(0,40);

const areContacts=async(left:number,right:number)=>{
  const result=await query(
    `SELECT 1 FROM room_user_contacts
      WHERE user_id=$1 AND contact_user_id=$2
      LIMIT 1`,
    [left,right],
  );
  return Boolean(result.rows[0]);
};

const getConversationAccess=async(conversationId:string,userId:number)=>{
  const result=await query(
    `SELECT c.*,m.pinned,m.archived,m.notifications_enabled,m.last_read_at
       FROM room_conversations c
       JOIN room_conversation_members m ON m.conversation_id=c.id
      WHERE c.id=$1 AND m.user_id=$2
      LIMIT 1`,
    [conversationId,userId],
  );
  return result.rows[0]||null;
};

const ensureWorkGroupConversations=async(user:NonNullable<AuthedRequest['user']>)=>{
  const groups=await query(
    `SELECT DISTINCT g.id,g.owner_id,g.name
       FROM room_work_groups g
       LEFT JOIN room_work_group_members m ON m.group_id=g.id
      WHERE g.owner_id=$1 OR m.user_id=$1 OR lower(m.email)=lower($2)`,
    [user.id,user.email],
  );
  for(const group of groups.rows){
    let conversation=await query('SELECT id FROM room_conversations WHERE work_group_id=$1 LIMIT 1',[group.id]);
    let conversationId=String(conversation.rows[0]?.id||'');
    if(!conversationId){
      conversationId=createId();
      const inserted=await query(
        `INSERT INTO room_conversations (id,kind,title,created_by,work_group_id)
         VALUES ($1,'work_group',$2,$3,$4)
         ON CONFLICT (work_group_id) WHERE work_group_id IS NOT NULL
         DO UPDATE SET title=excluded.title,updated_at=now()
         RETURNING id`,
        [conversationId,String(group.name||'Groupe de travail').slice(0,180),Number(group.owner_id),group.id],
      );
      conversationId=String(inserted.rows[0]?.id||conversationId);
    }else{
      await query('UPDATE room_conversations SET title=$2,updated_at=updated_at WHERE id=$1',[conversationId,String(group.name||'Groupe de travail').slice(0,180)]);
    }
    const members=await query(
      `SELECT DISTINCT u.id
         FROM room_users u
        WHERE u.is_guest=false
          AND COALESCE(u.is_suspended,false)=false
          AND (
            u.id=$2 OR EXISTS(
              SELECT 1 FROM room_work_group_members gm
              WHERE gm.group_id=$1 AND gm.user_id=u.id
            )
          )`,
      [group.id,Number(group.owner_id)],
    );
    for(const member of members.rows){
      await query(
        `INSERT INTO room_conversation_members (conversation_id,user_id)
         VALUES ($1,$2) ON CONFLICT (conversation_id,user_id) DO NOTHING`,
        [conversationId,Number(member.id)],
      );
    }
  }
};

const conversationMessagePayload=async(row:any)=>{
  const file=row.file_id?await query(
    'SELECT id,name,mime_type,size_bytes,created_at FROM room_files WHERE id=$1 LIMIT 1',
    [row.file_id],
  ):null;
  return{
    id:String(row.id),
    conversationId:String(row.conversation_id),
    userId:Number(row.user_id),
    sender:String(row.sender||''),
    senderAvatar:String(row.sender_avatar||''),
    text:String(row.text||''),
    createdAt:new Date(row.created_at).toISOString(),
    file:file?.rows[0]?{
      id:String(file.rows[0].id),
      name:String(file.rows[0].name),
      mimeType:String(file.rows[0].mime_type),
      sizeBytes:Number(file.rows[0].size_bytes),
      createdAt:new Date(file.rows[0].created_at).toISOString(),
    }:null,
  };
};

const hydrateConversation=async(row:any,currentUserId:number)=>{
  const [members,lastMessage,unread,files]=await Promise.all([
    query(
      `SELECT u.id,u.name,u.username,u.email,u.avatar,u.organization,u.job_title,u.city,
              EXISTS(
                SELECT 1 FROM room_sessions s
                 WHERE s.user_id=u.id
                   AND s.expires_at::timestamptz>now()
                   AND COALESCE(s.last_activity,s.created_at::timestamptz)>now()-interval '5 minutes'
              ) AS online
         FROM room_conversation_members cm
         JOIN room_users u ON u.id=cm.user_id
        WHERE cm.conversation_id=$1
        ORDER BY u.name ASC`,
      [row.id],
    ),
    query(
      `SELECT m.*,u.name AS sender,u.avatar AS sender_avatar
         FROM room_conversation_messages m
         JOIN room_users u ON u.id=m.user_id
        WHERE m.conversation_id=$1 AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC LIMIT 1`,
      [row.id],
    ),
    query(
      `SELECT COUNT(*)::int AS count
         FROM room_conversation_messages
        WHERE conversation_id=$1 AND deleted_at IS NULL AND user_id<>$2
          AND created_at>COALESCE($3::timestamptz,'1970-01-01'::timestamptz)`,
      [row.id,currentUserId,row.last_read_at||null],
    ),
    query(
      `SELECT DISTINCT f.id,f.name,f.mime_type,f.size_bytes,f.created_at
         FROM room_conversation_messages m
         JOIN room_files f ON f.id=m.file_id
        WHERE m.conversation_id=$1 AND m.deleted_at IS NULL
        ORDER BY f.created_at DESC LIMIT 20`,
      [row.id],
    ),
  ]);
  const participants=members.rows.map((member:any)=>({
    id:Number(member.id),
    name:String(member.name||member.email||'Utilisateur'),
    username:String(member.username||''),
    email:String(member.email||''),
    avatar:String(member.avatar||''),
    organization:String(member.organization||''),
    jobTitle:String(member.job_title||''),
    city:String(member.city||''),
    online:Boolean(member.online),
  }));
  const other=participants.find((member:any)=>member.id!==currentUserId);
  const latest=lastMessage.rows[0]?await conversationMessagePayload(lastMessage.rows[0]):null;
  return{
    id:String(row.id),
    kind:row.kind==='work_group'?'work_group':'direct',
    title:row.kind==='direct'?(other?.name||String(row.title||'Conversation')):String(row.title||'Groupe de travail'),
    avatar:row.kind==='direct'?(other?.avatar||''):'',
    workGroupId:row.work_group_id?String(row.work_group_id):null,
    pinned:Boolean(row.pinned),
    archived:Boolean(row.archived),
    notificationsEnabled:row.notifications_enabled!==false,
    unreadCount:Number(unread.rows[0]?.count||0),
    lastMessage:latest,
    participants,
    files:files.rows.map((file:any)=>({
      id:String(file.id),name:String(file.name),mimeType:String(file.mime_type),
      sizeBytes:Number(file.size_bytes),createdAt:new Date(file.created_at).toISOString(),
    })),
    createdAt:new Date(row.created_at).toISOString(),
    updatedAt:new Date(latest?.createdAt||row.updated_at||row.created_at).toISOString(),
  };
};

export const registerAppRoutes = (app: express.Express, io: Server) => {
  app.get('/api/health', async (_request, response) => {
    const databaseType = getDatabaseType();
    if (!hasDatabase()) {
      response.status(503).json({
        ok:false,
        service:'mbote-room',
        database:{configured:false,connected:false,type:databaseType},
        readiness:getRuntimeReadiness(databaseType),
      });
      return;
    }
    try {
      const result = await query(`SELECT now() AS now,(SELECT COUNT(*)::int FROM room_users) AS users,(SELECT COUNT(*)::int FROM room_meetings) AS meetings`);
      response.json({
        ok:true,
        service:'mbote-room',
        database:{configured:true,connected:true,type:databaseType,users:Number(result.rows[0].users),meetings:Number(result.rows[0].meetings)},
        media:{
          topology:'mesh',
          turnConfigured:Boolean(
            (String(process.env.TURN_URLS||'').trim() && String(process.env.TURN_SHARED_SECRET||'').trim())
            || (String(process.env.MBOTEROOM_TURN_URL||'').trim()
              && String(process.env.MBOTEROOM_TURN_USERNAME||'').trim()
              && String(process.env.MBOTEROOM_TURN_CREDENTIAL||'').trim())
          ),
          turnCredentialTtlSeconds:Number(process.env.TURN_CREDENTIAL_TTL_SECONDS||3600),
        },
        readiness:getRuntimeReadiness(databaseType),
        deployment:{
          commit:String(process.env.RENDER_GIT_COMMIT||'').slice(0,40),
          branch:String(process.env.RENDER_GIT_BRANCH||'').slice(0,80),
        },
        serverTime:result.rows[0].now,
      });
    } catch (error) {
      response.status(503).json({
        ok:false,
        service:'mbote-room',
        database:{configured:true,connected:false,type:databaseType},
        readiness:getRuntimeReadiness(databaseType),
        deployment:{
          commit:String(process.env.RENDER_GIT_COMMIT||'').slice(0,40),
          branch:String(process.env.RENDER_GIT_BRANCH||'').slice(0,80),
        },
        error:process.env.NODE_ENV==='production'?'Database unavailable':error instanceof Error?error.message:'Database unavailable',
      });
    }
  });

  app.get('/api/platform/settings', requireDatabase, authenticateToken, async (_request,response,next)=>{
    try{
      const settings=await getPlatformSettings();
      const configuredUrl=String(process.env.MBOTE_PREMIUM_CHECKOUT_URL||'').trim();
      let premiumCheckoutUrl='';
      if(configuredUrl.startsWith('/')&&!configuredUrl.startsWith('//'))premiumCheckoutUrl=configuredUrl;
      else{
        try{
          const parsed=new URL(configuredUrl);
          if(parsed.protocol==='https:')premiumCheckoutUrl=parsed.href;
        }catch{/* no checkout configured */}
      }
      response.json({
        ...settings,
        premiumCheckoutReady:Boolean(settings.premiumPaymentEnabled&&premiumCheckoutUrl),
        premiumCheckoutUrl:settings.premiumPaymentEnabled?premiumCheckoutUrl:'',
      });
    }catch(error){next(error);}
  });

  app.get('/api/public/meetings', requireDatabase, async (_request,response,next)=>{
    try {
      if (!(await isPlatformFeatureEnabled('publicMeetingsEnabled'))) return response.json([]);
      const result=await query(`SELECT * FROM room_meetings WHERE status<>'cancelled' AND (settings->>'isPublic'='true' OR settings->>'visibility'='public') ORDER BY start_time ASC LIMIT 20`);
      response.json(result.rows.map(publicMeeting));
    } catch(error){next(error);}
  });

  app.get('/api/profile', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query('SELECT * FROM room_users WHERE id=$1 LIMIT 1',[request.user!.id]);
      if(!result.rows[0])return sendApiError(response,404,'PROFILE_NOT_FOUND','Profil introuvable.');
      response.json({user:toPublicUser(result.rows[0])});
    }catch(error){next(error);}
  });

  app.get('/api/profile/stats', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const [meetings,participants,files,minutes]=await Promise.all([
        query(`SELECT COUNT(DISTINCT m.id)::int AS count
                 FROM room_meetings m
                 LEFT JOIN room_meeting_members mm ON mm.meeting_id=m.id
                WHERE m.host_id=$1 OR m.co_host_id=$1 OR mm.user_id=$1`,[request.user!.id]),
        query(`SELECT COUNT(DISTINCT mm2.user_id)::int AS count
                 FROM room_meeting_members mine
                 JOIN room_meeting_members mm2 ON mm2.meeting_id=mine.meeting_id AND mm2.user_id<>mine.user_id
                 JOIN room_users u ON u.id=mm2.user_id AND u.is_guest=false
                WHERE mine.user_id=$1`,[request.user!.id]),
        query('SELECT COUNT(*)::int AS count FROM room_files WHERE owner_id=$1',[request.user!.id]),
        query(`SELECT COALESCE(SUM(
                  EXTRACT(EPOCH FROM (COALESCE(m.ended_at,now())-COALESCE(m.started_at,m.start_time::timestamptz)))/60
                ),0)::int AS minutes
                 FROM room_meetings m
                WHERE m.status='ended' AND (m.host_id=$1 OR m.co_host_id=$1 OR EXISTS(
                  SELECT 1 FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.user_id=$1
                ))`,[request.user!.id]),
      ]);
      response.json({
        meetings:Number(meetings.rows[0]?.count||0),
        participants:Number(participants.rows[0]?.count||0),
        files:Number(files.rows[0]?.count||0),
        meetingMinutes:Number(minutes.rows[0]?.minutes||0),
      });
    }catch(error){next(error);}
  });

  app.put('/api/profile', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const name=String(request.body?.name||request.user!.name).trim().slice(0,120);
      const username=String(request.body?.username||request.user!.username).trim().toLowerCase().replace(/\s+/g,'').slice(0,80);
      const avatar=safeImageUrl(request.body?.avatar,request.user!.avatar);
      const phoneNumber=String(request.body?.phoneNumber??request.user!.phoneNumber??'').trim().slice(0,40);
      const organization=String(request.body?.organization??request.user!.organization??'').trim().slice(0,120);
      const jobTitle=String(request.body?.jobTitle??request.user!.jobTitle??'').trim().slice(0,120);
      const country=String(request.body?.country??request.user!.country??'').trim().slice(0,120);
      const city=String(request.body?.city??request.user!.city??'').trim().slice(0,120);
      const address=String(request.body?.address??request.user!.address??'').trim().slice(0,240);
      const bio=String(request.body?.bio??request.user!.bio??'').trim().slice(0,300);
      const profileVisible=typeof request.body?.profileVisible==='boolean'?request.body.profileVisible:request.user!.profileVisible!==false;
      const personalMeetingId=String(request.body?.personalMeetingId??request.user!.personalMeetingId??'').replace(/\s+/g,'').trim();
      if(!name||!username)return sendApiError(response,400,'VALIDATION_ERROR','Nom et nom d’utilisateur requis.');
      const normalizedPhone=normalizePhoneNumber(phoneNumber);
      if(normalizedPhone){
        const duplicatePhone=await query(
          `SELECT 1 FROM room_users
            WHERE is_guest=false
              AND NULLIF(regexp_replace(phone_number, '[^0-9]', '', 'g'), '')=$1 AND id<>$2
            LIMIT 1`,
          [normalizedPhone,request.user!.id],
        );
        if(duplicatePhone.rows[0])return sendApiError(response,409,'PHONE_ALREADY_EXISTS','Un compte existe déjà avec ce numéro de téléphone.');
      }
      if(personalMeetingId&&!/^\d{6,12}$/.test(personalMeetingId))return sendApiError(response,400,'PERSONAL_MEETING_ID_INVALID','L’ID personnel doit contenir entre 6 et 12 chiffres.');
      const duplicate=await query('SELECT 1 FROM room_users WHERE lower(username)=lower($1) AND id<>$2 LIMIT 1',[username,request.user!.id]);
      if(duplicate.rows[0])return sendApiError(response,409,'USERNAME_ALREADY_EXISTS','Ce nom d’utilisateur est déjà utilisé.');
      if(personalMeetingId){
        const duplicateMeetingId=await query('SELECT 1 FROM room_users WHERE personal_meeting_id=$1 AND id<>$2 LIMIT 1',[personalMeetingId,request.user!.id]);
        if(duplicateMeetingId.rows[0])return sendApiError(response,409,'PERSONAL_MEETING_ID_ALREADY_USED','Cet ID personnel est déjà utilisé.');
      }
      const previousPersonalMeetingId=String(request.user!.personalMeetingId||'');
      const result=await query(
        `UPDATE room_users
            SET name=$2,username=$3,avatar=$4,phone_number=$5,organization=$6,job_title=$7,
                country=$8,city=$9,address=$10,bio=$11,profile_visible=$12,personal_meeting_id=$13
          WHERE id=$1 RETURNING *`,
        [request.user!.id,name,username,avatar,phoneNumber,organization,jobTitle,country,city,address,bio,profileVisible,personalMeetingId],
      );
      if(personalMeetingId&&personalMeetingId!==previousPersonalMeetingId){
        const hostedMeetings=await query('SELECT id,settings FROM room_meetings WHERE host_id=$1',[request.user!.id]);
        for(const row of hostedMeetings.rows){
          const settings=typeof row.settings==='string'?JSON.parse(row.settings||'{}'):(row.settings||{});
          settings.meetingAccessId=personalMeetingId;
          await query('UPDATE room_meetings SET settings=$2::jsonb,updated_at=now() WHERE id=$1',[Number(row.id),JSON.stringify(settings)]);
        }
      }
      const user=toPublicUser(result.rows[0]);
      io.to(`user:${user.id}`).emit('profile:updated',user);
      response.json({user});
    }catch(error){next(error);}
  });

  app.get('/api/security/sessions', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const currentHash=hashToken(getRawSessionTokenFromRequest(request));
      const result=await query(
        `SELECT token_hash,created_at,expires_at,last_activity
           FROM room_sessions
          WHERE user_id=$1 AND expires_at::timestamptz>now()
          ORDER BY COALESCE(last_activity,created_at::timestamptz) DESC`,
        [request.user!.id],
      );
      response.json(result.rows.map((row,index)=>({
        id:String(row.token_hash).slice(0,16),
        current:String(row.token_hash)===currentHash,
        createdAt:new Date(row.created_at).toISOString(),
        expiresAt:new Date(row.expires_at).toISOString(),
        lastActivity:new Date(row.last_activity||row.created_at).toISOString(),
        label:index===0?'Appareil récent':'Session MBotéRoom',
      })));
    }catch(error){next(error);}
  });

  app.delete('/api/security/sessions/:sessionId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const prefix=String(request.params.sessionId||'').replace(/[^a-f0-9]/gi,'').slice(0,16);
      if(prefix.length<8)return sendApiError(response,400,'SESSION_INVALID','Session invalide.');
      const currentHash=hashToken(getRawSessionTokenFromRequest(request));
      const result=await query(
        `SELECT token_hash FROM room_sessions WHERE user_id=$1 AND token_hash LIKE $2 LIMIT 1`,
        [request.user!.id, prefix+'%'],
      );
      const tokenHash=String(result.rows[0]?.token_hash||'');
      if(!tokenHash)return sendApiError(response,404,'SESSION_NOT_FOUND','Session introuvable.');
      if(tokenHash===currentHash)return sendApiError(response,400,'CURRENT_SESSION','Utilisez le bouton Se déconnecter pour fermer la session actuelle.');
      await query('DELETE FROM room_sessions WHERE user_id=$1 AND token_hash=$2',[request.user!.id,tokenHash]);
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.post('/api/security/sessions/revoke-others', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const currentHash=hashToken(getRawSessionTokenFromRequest(request));
      const result=await query('DELETE FROM room_sessions WHERE user_id=$1 AND token_hash<>$2 RETURNING token_hash',[request.user!.id,currentHash]);
      response.json({success:true,revoked:Number(result.rowCount||0)});
    }catch(error){next(error);}
  });

  app.get('/api/preferences', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query('SELECT preferences FROM room_user_preferences WHERE user_id=$1 LIMIT 1',[request.user!.id]);response.json(result.rows[0]?.preferences||{});}catch(error){next(error);}
  });

  app.put('/api/preferences', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const allowed=[
        'language','theme','notifications','emailNotifications','audio','video','defaultMic','defaultCamera','background','timezone','accessibility',
        'textSize','notificationSounds','vibration','lockScreenPreview','autoArchiveDays','mediaDownload','chatBackground',
        'noiseReduction','hdVideo','lunaAutoSummary','lunaRealtimeTranslation','lunaActionSuggestions','dataSaver',
        'waitingRoomDefault','meetingLockDefault','participantAudioAllowed','participantVideoAllowed','screenShareAllowed',
        'automaticLogoutMinutes',
      ];
      const preferences:Record<string,unknown>={}; for(const key of allowed){if(Object.prototype.hasOwnProperty.call(request.body||{},key))preferences[key]=request.body[key];}
      if(Object.prototype.hasOwnProperty.call(preferences,'automaticLogoutMinutes')){
        const minutes=Number(preferences.automaticLogoutMinutes);
        if(![0,5,15,30,60,240].includes(minutes)){
          return sendApiError(response,400,'AUTOMATIC_LOGOUT_INVALID','Choisissez une durée de déconnexion automatique valide.');
        }
        preferences.automaticLogoutMinutes=minutes;
      }
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
      const metadata=request.body?.metadata&&typeof request.body.metadata==='object'&&!Array.isArray(request.body.metadata)?request.body.metadata:{};
      const id=createId();const result=await query(`INSERT INTO room_calendar_events (id,user_id,meeting_id,title,description,starts_at,ends_at,metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,[id,request.user!.id,request.body?.meetingId?Number(request.body.meetingId):null,title,String(request.body?.description||'').trim().slice(0,1000),startsAt.toISOString(),endsAt.toISOString(),JSON.stringify(metadata)]);
      const synced=await syncCalendarEventToGoogle(request.user!.id,result.rows[0]);
      io.to(`user:${request.user!.id}`).emit('calendar:event-updated',synced);
      response.status(201).json(synced);
    }catch(error){next(error);}
  });
  app.put('/api/calendar/events/:eventId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const startsAt=parseDate(request.body?.startsAt);const endsAt=parseDate(request.body?.endsAt);if(!startsAt||!endsAt||endsAt<=startsAt)return sendApiError(response,400,'VALIDATION_ERROR','Horaires invalides.');
      const metadata=request.body?.metadata&&typeof request.body.metadata==='object'&&!Array.isArray(request.body.metadata)?request.body.metadata:{};
      const result=await query(`UPDATE room_calendar_events SET title=$3,description=$4,starts_at=$5,ends_at=$6,metadata=$7::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,[request.params.eventId,request.user!.id,String(request.body?.title||'').trim().slice(0,200),String(request.body?.description||'').trim().slice(0,1000),startsAt.toISOString(),endsAt.toISOString(),JSON.stringify(metadata)]);
      if(!result.rows[0])return sendApiError(response,404,'CALENDAR_EVENT_NOT_FOUND','Événement introuvable.');
      const synced=await syncCalendarEventToGoogle(request.user!.id,result.rows[0]);
      io.to(`user:${request.user!.id}`).emit('calendar:event-updated',synced);
      response.json(synced);
    }catch(error){next(error);}
  });
  app.delete('/api/calendar/events/:eventId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{
    const existing=await query('SELECT google_event_id FROM room_calendar_events WHERE id=$1 AND user_id=$2 LIMIT 1',[request.params.eventId,request.user!.id]);
    if(existing.rows[0])await deleteCalendarEventFromGoogle(request.user!.id,existing.rows[0].google_event_id);
    await query('DELETE FROM room_calendar_events WHERE id=$1 AND user_id=$2',[request.params.eventId,request.user!.id]);
    io.to(`user:${request.user!.id}`).emit('calendar:event-updated',{id:request.params.eventId,deleted:true});
    response.status(204).end();
  }catch(error){next(error);}});

  app.get('/api/push/config', requireDatabase, authenticateToken, (_request:AuthedRequest,response)=>{
    response.json(getPushStatus());
  });

  app.post('/api/push/subscribe', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const endpoint=String(request.body?.endpoint||'').trim();
      const p256dh=String(request.body?.keys?.p256dh||'').trim();
      const auth=String(request.body?.keys?.auth||'').trim();
      const expirationTime=request.body?.expirationTime==null?null:Number(request.body.expirationTime);
      const platform=String(request.body?.platform||'web').trim().slice(0,40);
      const userAgent=String(request.headers['user-agent']||'').slice(0,500);
      if(!endpoint||!p256dh||!auth)return sendApiError(response,400,'PUSH_SUBSCRIPTION_INVALID','Abonnement push invalide.');
      if(!/^https:\/\//i.test(endpoint))return sendApiError(response,400,'PUSH_ENDPOINT_INVALID','Endpoint push invalide.');
      const p256dhBytes=Buffer.from(p256dh,'base64url');
      const authBytes=Buffer.from(auth,'base64url');
      if(p256dhBytes.length!==65||p256dhBytes[0]!==4||authBytes.length<16){
        return sendApiError(response,400,'PUSH_SUBSCRIPTION_INVALID','Clés de notification invalides. Réactivez les notifications sur cet appareil.');
      }
      const id=createId();
      const result=await query(
        `INSERT INTO room_push_subscriptions (id,user_id,endpoint,p256dh,auth,expiration_time,user_agent,platform)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
           expiration_time=excluded.expiration_time,user_agent=excluded.user_agent,platform=excluded.platform,updated_at=now()
         RETURNING id,user_id,endpoint,platform,created_at,updated_at`,
        [id,request.user!.id,endpoint,p256dh,auth,Number.isFinite(expirationTime as number)?expirationTime:null,userAgent,platform],
      );
      response.status(201).json({success:true,subscription:result.rows[0]});
    }catch(error){next(error);}
  });

  app.delete('/api/push/subscribe', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const endpoint=String(request.body?.endpoint||'').trim();
      if(endpoint)await query('DELETE FROM room_push_subscriptions WHERE user_id=$1 AND endpoint=$2',[request.user!.id,endpoint]);
      else await query('DELETE FROM room_push_subscriptions WHERE user_id=$1',[request.user!.id]);
      response.json({success:true});
    }catch(error){next(error);}
  });

  app.post('/api/push/test', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const notification=await createNotificationAndPush(request.user!.id,{
        type:'PUSH_TEST',
        title:'Notifications MBotéRoom activées',
        body:'Les notifications push sont prêtes sur cet appareil.',
        url:'/app/notifications',
        tag:'mboteroom-push-test',
        data:{source:'settings'},
      });
      io.to(`user:${request.user!.id}`).emit('notification:new',notification);
      const delivery=notification.pushDelivery||{sent:0,failed:0,stale:0};
      if(delivery.sent<1){
        return sendApiError(
          response,
          409,
          'PUSH_DELIVERY_FAILED',
          'Aucun appareil n’a reçu la notification. Réactivez les notifications sur cet appareil puis réessayez.',
        );
      }
      response.json({success:true,delivery});
    }catch(error){next(error);}
  });

  app.get('/api/notifications', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{const result=await query(`SELECT * FROM room_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,[request.user!.id]);response.json(result.rows.map((row)=>({...row,createdAt:new Date(row.created_at).toISOString(),readAt:row.read_at?new Date(row.read_at).toISOString():null})));}catch(error){next(error);}
  });
  app.post('/api/notifications/:notificationId/read', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{const result=await query('UPDATE room_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *',[request.params.notificationId,request.user!.id]);if(!result.rows[0])return sendApiError(response,404,'NOTIFICATION_NOT_FOUND','Notification introuvable.');const row=result.rows[0];response.json({...row,createdAt:new Date(row.created_at).toISOString(),readAt:row.read_at?new Date(row.read_at).toISOString():null});}catch(error){next(error);}});
  app.post('/api/notifications/read-all', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{try{await query('UPDATE room_notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1',[request.user!.id]);response.json({success:true});}catch(error){next(error);}});

  app.get('/api/contacts', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `WITH accessible_groups AS (
           SELECT DISTINCT g.id,g.owner_id
             FROM room_work_groups g
             LEFT JOIN room_work_group_members mine ON mine.group_id=g.id
            WHERE g.owner_id=$1 OR mine.user_id=$1 OR lower(mine.email)=lower($2)
         ),
         candidates AS (
           SELECT c.contact_user_id AS id,false AS shared_group,true AS saved
             FROM room_user_contacts c WHERE c.user_id=$1
           UNION ALL
           SELECT ag.owner_id AS id,true AS shared_group,false AS saved FROM accessible_groups ag
           UNION ALL
           SELECT gm.user_id AS id,true AS shared_group,false AS saved
             FROM room_work_group_members gm
             JOIN accessible_groups ag ON ag.id=gm.group_id
            WHERE gm.user_id IS NOT NULL
         )
         SELECT u.id,u.name,u.username,u.email,u.avatar,u.organization,u.job_title,u.city,
                cand.shared_group,cand.saved,COALESCE(uc.favorite,false) AS favorite,
                EXISTS(
                  SELECT 1 FROM room_sessions s
                   WHERE s.user_id=u.id AND s.expires_at::timestamptz>now()
                     AND COALESCE(s.last_activity,s.created_at::timestamptz)>now()-interval '5 minutes'
                ) AS online
           FROM candidates cand
           JOIN room_users u ON u.id=cand.id
           LEFT JOIN room_user_contacts uc ON uc.user_id=$1 AND uc.contact_user_id=u.id
          WHERE u.id<>$1 AND u.is_guest=false AND COALESCE(u.is_suspended,false)=false AND COALESCE(u.account_status,'active')<>'banned'
          ORDER BY u.name ASC`,
        [request.user!.id,request.user!.email],
      );
      const map=new Map<number,any>();
      for(const row of result.rows){
        const id=Number(row.id);
        const current=map.get(id)||{
          id,name:String(row.name||row.email),username:String(row.username||''),email:String(row.email||''),
          avatar:String(row.avatar||''),organization:String(row.organization||''),jobTitle:String(row.job_title||''),
          city:String(row.city||''),online:Boolean(row.online),favorite:Boolean(row.favorite),saved:false,sharedGroup:false,
        };
        current.saved=current.saved||Boolean(row.saved);
        current.sharedGroup=current.sharedGroup||Boolean(row.shared_group);
        current.favorite=current.favorite||Boolean(row.favorite);
        current.online=current.online||Boolean(row.online);
        map.set(id,current);
      }
      response.json([...map.values()]);
    }catch(error){next(error);}
  });

  app.get('/api/contacts/search', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const search=String(request.query.q||'').trim().toLowerCase().slice(0,120);
      if(search.length<2)return response.json([]);
      const result=await query(
        `SELECT u.id,u.name,u.username,u.email,u.avatar,u.organization,u.job_title,u.city,
                EXISTS(
                  SELECT 1 FROM room_sessions s
                   WHERE s.user_id=u.id AND s.expires_at::timestamptz>now()
                     AND COALESCE(s.last_activity,s.created_at::timestamptz)>now()-interval '5 minutes'
                ) AS online,
                EXISTS(SELECT 1 FROM room_user_contacts c WHERE c.user_id=$1 AND c.contact_user_id=u.id) AS saved,
                COALESCE((SELECT favorite FROM room_user_contacts c WHERE c.user_id=$1 AND c.contact_user_id=u.id LIMIT 1),false) AS favorite
           FROM room_users u
          WHERE u.id<>$1 AND u.is_guest=false AND COALESCE(u.is_suspended,false)=false AND COALESCE(u.account_status,'active')<>'banned'
            AND (lower(u.name) LIKE $2 OR lower(u.email) LIKE $2 OR lower(u.username) LIKE $2
              OR regexp_replace(COALESCE(u.phone_number,''), '[^0-9]', '', 'g') LIKE $4)
          ORDER BY CASE WHEN lower(u.name)=$3 THEN 0 ELSE 1 END,u.name ASC
          LIMIT 30`,
        [request.user!.id,`%${search}%`,search,`%${normalizePhoneNumber(search)}%`],
      );
      response.json(result.rows.map((row:any)=>({
        id:Number(row.id),name:String(row.name||row.email),username:String(row.username||''),email:String(row.email||''),
        avatar:String(row.avatar||''),organization:String(row.organization||''),jobTitle:String(row.job_title||''),
        city:String(row.city||''),online:Boolean(row.online),favorite:Boolean(row.favorite),saved:Boolean(row.saved),sharedGroup:false,
      })));
    }catch(error){next(error);}
  });

  app.post('/api/contacts/:contactUserId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const contactUserId=Number(request.params.contactUserId);
      const target=await query('SELECT id,is_guest FROM room_users WHERE id=$1 AND COALESCE(is_suspended,false)=false LIMIT 1',[contactUserId]);
      if(!target.rows[0]||Boolean(target.rows[0].is_guest)||contactUserId===request.user!.id){
        return sendApiError(response,404,'CONTACT_NOT_FOUND','Ce compte MBotéRoom est introuvable.');
      }
      return sendApiError(response,410,'CONTACT_REQUEST_REQUIRED','Envoyez une demande de contact ; elle devra être acceptée avant de pouvoir discuter.');
    }catch(error){next(error);}
  });

  app.get('/api/contact-requests', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT r.id,r.status,r.created_at,u.id AS user_id,u.name,u.username,u.email,u.avatar,u.organization,u.job_title,u.city
           FROM room_contact_requests r
           JOIN room_users u ON u.id=r.requester_user_id
          WHERE r.recipient_user_id=$1 AND r.status='pending'
          ORDER BY r.created_at DESC`,
        [request.user!.id],
      );
      response.json(result.rows.map((row:any)=>({
        id:String(row.id),status:String(row.status),createdAt:new Date(row.created_at).toISOString(),
        user:{id:Number(row.user_id),name:String(row.name||row.email),username:String(row.username||''),email:String(row.email||''),avatar:String(row.avatar||''),organization:String(row.organization||''),jobTitle:String(row.job_title||''),city:String(row.city||'')},
      })));
    }catch(error){next(error);}
  });

  app.post('/api/contact-requests', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const recipientUserId=Number(request.body?.contactUserId||0);
      const target=await query("SELECT id,name,is_guest FROM room_users WHERE id=$1 AND COALESCE(is_suspended,false)=false AND COALESCE(account_status,'active')<>'banned' LIMIT 1",[recipientUserId]);
      if(!target.rows[0]||Boolean(target.rows[0].is_guest)||recipientUserId===request.user!.id)return sendApiError(response,404,'CONTACT_NOT_FOUND','Ce compte MBotéRoom est introuvable.');
      if(await areContacts(request.user!.id,recipientUserId))return response.json({success:true,status:'accepted',alreadyContact:true});
      const reverse=await query(`SELECT id FROM room_contact_requests WHERE requester_user_id=$1 AND recipient_user_id=$2 AND status='pending' LIMIT 1`,[recipientUserId,request.user!.id]);
      if(reverse.rows[0]){
        await query(`UPDATE room_contact_requests SET status='accepted',responded_at=now() WHERE id=$1`,[reverse.rows[0].id]);
        await query(`INSERT INTO room_user_contacts (user_id,contact_user_id) VALUES ($1,$2),($2,$1) ON CONFLICT (user_id,contact_user_id) DO NOTHING`,[request.user!.id,recipientUserId]);
        return response.json({success:true,status:'accepted'});
      }
      const pending=await query(`SELECT id FROM room_contact_requests WHERE requester_user_id=$1 AND recipient_user_id=$2 AND status='pending' LIMIT 1`,[request.user!.id,recipientUserId]);
      if(pending.rows[0])return response.json({success:true,status:'pending',requestId:String(pending.rows[0].id)});
      const id=createId();
      await query(`INSERT INTO room_contact_requests (id,requester_user_id,recipient_user_id) VALUES ($1,$2,$3)`,[id,request.user!.id,recipientUserId]);
      const notification=await createNotificationAndPush(recipientUserId,{type:'CONTACT_REQUEST',title:'Nouvelle demande de contact',body:`${request.user!.name} souhaite vous ajouter à ses contacts.`,url:'/app/contacts',tag:`contact-request-${id}`,data:{requestId:id,requesterUserId:request.user!.id}});
      io.to(`user:${recipientUserId}`).emit('contact:request',notification);
      response.status(201).json({success:true,status:'pending',requestId:id});
    }catch(error){next(error);}
  });

  app.patch('/api/contact-requests/:requestId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const status=request.body?.status==='accepted'?'accepted':request.body?.status==='rejected'?'rejected':'';
      if(!status)return sendApiError(response,400,'CONTACT_REQUEST_STATUS_INVALID','Choisissez d’accepter ou de refuser la demande.');
      const result=await query(`UPDATE room_contact_requests SET status=$3,responded_at=now() WHERE id=$1 AND recipient_user_id=$2 AND status='pending' RETURNING requester_user_id`,[request.params.requestId,request.user!.id,status]);
      const requestRow=result.rows[0];
      if(!requestRow)return sendApiError(response,404,'CONTACT_REQUEST_NOT_FOUND','Cette demande de contact est introuvable ou a déjà été traitée.');
      const requesterUserId=Number(requestRow.requester_user_id);
      if(status==='accepted'){
        await query(`INSERT INTO room_user_contacts (user_id,contact_user_id) VALUES ($1,$2),($2,$1) ON CONFLICT (user_id,contact_user_id) DO NOTHING`,[requesterUserId,request.user!.id]);
        const notification=await createNotificationAndPush(requesterUserId,{type:'CONTACT_REQUEST_ACCEPTED',title:'Demande de contact acceptée',body:`${request.user!.name} est maintenant dans vos contacts.`,url:'/app/contacts',tag:`contact-accepted-${request.params.requestId}`,data:{contactUserId:request.user!.id}});
        io.to(`user:${requesterUserId}`).emit('contact:accepted',notification);
      }
      response.json({success:true,status});
    }catch(error){next(error);}
  });

  app.patch('/api/contacts/:contactUserId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const contactUserId=Number(request.params.contactUserId);
      const favorite=Boolean(request.body?.favorite);
      const result=await query(
        `INSERT INTO room_user_contacts (user_id,contact_user_id,favorite)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id,contact_user_id) DO UPDATE SET favorite=excluded.favorite
         RETURNING favorite`,
        [request.user!.id,contactUserId,favorite],
      );
      response.json({success:true,favorite:Boolean(result.rows[0]?.favorite)});
    }catch(error){next(error);}
  });

  app.delete('/api/contacts/:contactUserId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      await query('DELETE FROM room_user_contacts WHERE user_id=$1 AND contact_user_id=$2',[request.user!.id,Number(request.params.contactUserId)]);
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.get('/api/conversations', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      await ensureWorkGroupConversations(request.user!);
      const rows=await query(
        `SELECT c.*,m.pinned,m.archived,m.notifications_enabled,m.last_read_at
           FROM room_conversations c
           JOIN room_conversation_members m ON m.conversation_id=c.id
          WHERE m.user_id=$1
          ORDER BY m.pinned DESC,c.updated_at DESC,c.created_at DESC
          LIMIT 100`,
        [request.user!.id],
      );
      const payload:Awaited<ReturnType<typeof hydrateConversation>>[]=[];
      for(const row of rows.rows)payload.push(await hydrateConversation(row,request.user!.id));
      response.json(payload);
    }catch(error){next(error);}
  });

  app.post('/api/conversations/direct', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const targetUserId=Number(request.body?.contactUserId||0);
      const target=await query(
        "SELECT id,name,email,is_guest FROM room_users WHERE id=$1 AND COALESCE(is_suspended,false)=false AND COALESCE(account_status,'active')<>'banned' LIMIT 1",
        [targetUserId],
      );
      if(!target.rows[0]||Boolean(target.rows[0].is_guest)||targetUserId===request.user!.id){
        return sendApiError(response,404,'CONTACT_NOT_FOUND','Ce compte MBotéRoom est introuvable.');
      }
      if(!(await areContacts(request.user!.id,targetUserId))){
        return sendApiError(response,403,'CONTACT_REQUEST_REQUIRED','Cette personne doit accepter votre demande de contact avant de démarrer une discussion.');
      }
      const key=directConversationKey(request.user!.id,targetUserId);
      const id=createId();
      const inserted=await query(
        `INSERT INTO room_conversations (id,kind,title,created_by,direct_key)
         VALUES ($1,'direct','',$2,$3)
         ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL
         DO UPDATE SET updated_at=room_conversations.updated_at
         RETURNING *`,
        [id,request.user!.id,key],
      );
      const conversation=inserted.rows[0];
      for(const userId of [request.user!.id,targetUserId]){
        await query(
          `INSERT INTO room_conversation_members (conversation_id,user_id,archived)
           VALUES ($1,$2,false)
           ON CONFLICT (conversation_id,user_id) DO UPDATE SET archived=false`,
          [conversation.id,userId],
        );
      }
      const member=await query(
        'SELECT c.*,m.pinned,m.archived,m.notifications_enabled,m.last_read_at FROM room_conversations c JOIN room_conversation_members m ON m.conversation_id=c.id WHERE c.id=$1 AND m.user_id=$2',
        [conversation.id,request.user!.id],
      );
      response.status(201).json(await hydrateConversation(member.rows[0],request.user!.id));
    }catch(error){next(error);}
  });

  app.post('/api/conversations/work-group/:groupId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      await ensureWorkGroupConversations(request.user!);
      const result=await query(
        `SELECT c.*,m.pinned,m.archived,m.notifications_enabled,m.last_read_at
           FROM room_conversations c
           JOIN room_conversation_members m ON m.conversation_id=c.id
          WHERE c.work_group_id=$1 AND m.user_id=$2 LIMIT 1`,
        [request.params.groupId,request.user!.id],
      );
      if(!result.rows[0])return sendApiError(response,404,'GROUP_CONVERSATION_NOT_FOUND','Cette conversation de groupe est introuvable.');
      await query('UPDATE room_conversation_members SET archived=false WHERE conversation_id=$1 AND user_id=$2',[result.rows[0].id,request.user!.id]);
      response.status(201).json(await hydrateConversation({...result.rows[0],archived:false},request.user!.id));
    }catch(error){next(error);}
  });

  app.get('/api/conversations/:conversationId/messages', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const access=await getConversationAccess(request.params.conversationId,request.user!.id);
      if(!access)return sendApiError(response,403,'CONVERSATION_ACCESS_DENIED','Vous n’avez pas accès à cette conversation.');
      const rows=await query(
        `SELECT m.*,u.name AS sender,u.avatar AS sender_avatar
           FROM room_conversation_messages m
           JOIN room_users u ON u.id=m.user_id
          WHERE m.conversation_id=$1 AND m.deleted_at IS NULL
          ORDER BY m.created_at DESC LIMIT 200`,
        [request.params.conversationId],
      );
      const payload:Awaited<ReturnType<typeof conversationMessagePayload>>[]=[];
      for(const row of rows.rows.reverse())payload.push(await conversationMessagePayload(row));
      response.json(payload);
    }catch(error){next(error);}
  });

  app.post('/api/conversations/:conversationId/messages', requireDatabase, authenticateToken, requireAccountFeature('messages'), async (request:AuthedRequest,response,next)=>{
    try{
      const access=await getConversationAccess(request.params.conversationId,request.user!.id);
      if(!access)return sendApiError(response,403,'CONVERSATION_ACCESS_DENIED','Vous n’avez pas accès à cette conversation.');
      if(access.kind==='work_group'&&request.user!.isGuest)return sendApiError(response,403,'GROUP_ACCOUNT_REQUIRED','Seuls les membres disposant d’un compte MBotéRoom peuvent écrire dans un groupe.');
      const text=String(request.body?.text||'').trim().slice(0,4000);
      const fileId=String(request.body?.fileId||'').trim()||null;
      if(!text&&!fileId)return sendApiError(response,400,'MESSAGE_EMPTY','Écrivez un message ou joignez un fichier.');
      if(fileId){
        const file=await query('SELECT id FROM room_files WHERE id=$1 AND owner_id=$2 LIMIT 1',[fileId,request.user!.id]);
        if(!file.rows[0])return sendApiError(response,403,'FILE_ACCESS_DENIED','Cette pièce jointe n’est pas disponible.');
      }
      const id=createId();
      const inserted=await query(
        `INSERT INTO room_conversation_messages (id,conversation_id,user_id,text,file_id)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING *`,
        [id,request.params.conversationId,request.user!.id,text,fileId],
      );
      await query('UPDATE room_conversations SET updated_at=now() WHERE id=$1',[request.params.conversationId]);
      const row={...inserted.rows[0],sender:request.user!.name,sender_avatar:request.user!.avatar};
      const payload=await conversationMessagePayload(row);
      const recipients=await query(
        `SELECT cm.user_id,cm.notifications_enabled
           FROM room_conversation_members cm
          WHERE cm.conversation_id=$1 AND cm.user_id<>$2`,
        [request.params.conversationId,request.user!.id],
      );
      for(const recipient of recipients.rows){
        const userId=Number(recipient.user_id);
        const userRoom=`user:${userId}`;
        const hasLiveDevice=(io.sockets.adapter.rooms.get(userRoom)?.size||0)>0;
        io.to(userRoom).emit('conversation:message',payload);
        if(recipient.notifications_enabled!==false&&!hasLiveDevice){
          const notification=await createNotificationAndPush(userId,{
            type:'MESSAGE_OFFLINE',
            title:request.user!.name||'Nouveau message',
            body:text||'Vous a envoyé une pièce jointe.',
            url:`/app/messages?conversation=${encodeURIComponent(request.params.conversationId)}`,
            tag:`conversation-${request.params.conversationId}`,
            data:{conversationId:request.params.conversationId,messageId:id,senderId:request.user!.id},
          });
          io.to(userRoom).emit('notification:new',notification);
        }
      }
      if(access.kind==='work_group'&&access.work_group_id){
        const externalMembers=await query(
          `SELECT email FROM room_work_group_members
            WHERE group_id=$1 AND user_id IS NULL AND lower(email)<>lower($2)`,
          [access.work_group_id,request.user!.email],
        );
        const appUrl=String(process.env.MBOTE_ROOM_APP_URL||'').replace(/\/+$/,'');
        await Promise.all(externalMembers.rows.map((member)=>sendTransactionalEmail({
          to:String(member.email||''),
          subject:`MBotéRoom · Nouveau message dans ${String(access.title||'votre groupe')}`,
          text:[
            `${request.user!.name} a publié un nouveau message dans le groupe « ${String(access.title||'MBotéRoom')} ».`,
            text||'Une pièce jointe a été partagée.',
            appUrl?'Créez ou connectez votre compte MBotéRoom pour participer : '+appUrl+'/connexion':'',
            'Les membres sans compte reçoivent uniquement ces notifications par e-mail et ne peuvent pas écrire dans le groupe.',
          ].filter(Boolean).join('\n\n'),
        }).catch(()=>false)));
      }
      response.status(201).json(payload);
    }catch(error){next(error);}
  });

  app.post('/api/conversations/:conversationId/read', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        'UPDATE room_conversation_members SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2 RETURNING conversation_id',
        [request.params.conversationId,request.user!.id],
      );
      if(!result.rows[0])return sendApiError(response,404,'CONVERSATION_NOT_FOUND','Conversation introuvable.');
      response.json({success:true});
    }catch(error){next(error);}
  });

  app.patch('/api/conversations/:conversationId/settings', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const access=await getConversationAccess(request.params.conversationId,request.user!.id);
      if(!access)return sendApiError(response,404,'CONVERSATION_NOT_FOUND','Conversation introuvable.');
      const pinned=typeof request.body?.pinned==='boolean'?request.body.pinned:Boolean(access.pinned);
      const archived=typeof request.body?.archived==='boolean'?request.body.archived:Boolean(access.archived);
      const notificationsEnabled=typeof request.body?.notificationsEnabled==='boolean'?request.body.notificationsEnabled:access.notifications_enabled!==false;
      await query(
        `UPDATE room_conversation_members
            SET pinned=$3,archived=$4,notifications_enabled=$5
          WHERE conversation_id=$1 AND user_id=$2`,
        [request.params.conversationId,request.user!.id,pinned,archived,notificationsEnabled],
      );
      response.json({success:true,pinned,archived,notificationsEnabled});
    }catch(error){next(error);}
  });

  app.get('/api/recordings', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT r.*,m.title,m.description,m.start_time,m.host_name,
                COALESCE((SELECT COUNT(*)::int FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.status='accepted'),0) AS participant_count,
                COALESCE(state.favorite,false) AS favorite
           FROM room_recordings r
           JOIN room_meetings m ON m.id=r.meeting_id
           LEFT JOIN room_recording_user_state state ON state.recording_id=r.id AND state.user_id=$1
          WHERE COALESCE(state.hidden,false)=false
            AND (m.host_id=$1 OR m.co_host_id=$1 OR EXISTS(
              SELECT 1 FROM room_meeting_members mm
               WHERE mm.meeting_id=m.id AND mm.user_id=$1 AND mm.status='accepted'
            ))
          ORDER BY COALESCE(state.favorite,false) DESC,r.created_at DESC`,
        [request.user!.id],
      );
      response.json(result.rows);
    }catch(error){next(error);}
  });

  app.get('/api/recordings/stats', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(r.duration_seconds),0)::bigint AS duration_seconds,
                COALESCE(SUM(r.size_bytes),0)::bigint AS size_bytes,
                MAX(r.created_at) AS latest_at
           FROM room_recordings r
           JOIN room_meetings m ON m.id=r.meeting_id
           LEFT JOIN room_recording_user_state state ON state.recording_id=r.id AND state.user_id=$1
          WHERE COALESCE(state.hidden,false)=false
            AND (m.host_id=$1 OR m.co_host_id=$1 OR EXISTS(
              SELECT 1 FROM room_meeting_members mm
               WHERE mm.meeting_id=m.id AND mm.user_id=$1 AND mm.status='accepted'
            ))`,
        [request.user!.id],
      );
      const quotaBytes=Math.max(0,Number(process.env.MBOTE_RECORDING_STORAGE_QUOTA_BYTES||5368709120));
      response.json({
        count:Number(result.rows[0]?.count||0),
        durationSeconds:Number(result.rows[0]?.duration_seconds||0),
        sizeBytes:Number(result.rows[0]?.size_bytes||0),
        latestAt:result.rows[0]?.latest_at?new Date(result.rows[0].latest_at).toISOString():null,
        quotaBytes,
      });
    }catch(error){next(error);}
  });

  app.patch('/api/recordings/:recordingId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const recording=await query(
        `SELECT r.id FROM room_recordings r
           JOIN room_meetings m ON m.id=r.meeting_id
          WHERE r.id=$1 AND (m.host_id=$2 OR m.co_host_id=$2 OR EXISTS(
            SELECT 1 FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.user_id=$2 AND mm.status='accepted'
          )) LIMIT 1`,
        [request.params.recordingId,request.user!.id],
      );
      if(!recording.rows[0])return sendApiError(response,404,'RECORDING_NOT_FOUND','Enregistrement introuvable.');
      const favorite=Boolean(request.body?.favorite);
      const result=await query(
        `INSERT INTO room_recording_user_state (recording_id,user_id,favorite,hidden)
         VALUES ($1,$2,$3,false)
         ON CONFLICT (recording_id,user_id) DO UPDATE SET favorite=excluded.favorite,hidden=false,updated_at=now()
         RETURNING favorite,hidden`,
        [request.params.recordingId,request.user!.id,favorite],
      );
      response.json({success:true,favorite:Boolean(result.rows[0]?.favorite)});
    }catch(error){next(error);}
  });

  app.delete('/api/recordings/:recordingId', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const recording=await query(
        `SELECT r.id FROM room_recordings r
           JOIN room_meetings m ON m.id=r.meeting_id
          WHERE r.id=$1 AND (m.host_id=$2 OR m.co_host_id=$2 OR EXISTS(
            SELECT 1 FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.user_id=$2 AND mm.status='accepted'
          )) LIMIT 1`,
        [request.params.recordingId,request.user!.id],
      );
      if(!recording.rows[0])return sendApiError(response,404,'RECORDING_NOT_FOUND','Enregistrement introuvable.');
      await query(
        `INSERT INTO room_recording_user_state (recording_id,user_id,favorite,hidden)
         VALUES ($1,$2,false,true)
         ON CONFLICT (recording_id,user_id) DO UPDATE SET hidden=true,favorite=false,updated_at=now()`,
        [request.params.recordingId,request.user!.id],
      );
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.get('/api/recordings/:recordingId/access', requireDatabase, authenticateToken, async (request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT r.storage_url,r.status,r.mime_type
           FROM room_recordings r
           JOIN room_meetings m ON m.id=r.meeting_id
          WHERE r.id=$1 AND (m.host_id=$2 OR m.co_host_id=$2 OR $3='admin' OR EXISTS(
            SELECT 1 FROM room_meeting_members mm WHERE mm.meeting_id=m.id AND mm.user_id=$2 AND mm.status='accepted'
          )) LIMIT 1`,
        [request.params.recordingId,request.user!.id,request.user!.role],
      );
      const row=result.rows[0];
      if(!row)return sendApiError(response,404,'RECORDING_NOT_FOUND','Enregistrement introuvable.');
      const storageUrl=String(row.storage_url||'').trim();
      const marker=parseSupabaseRecordingMarker(storageUrl);
      if(marker){
        const signed=await requestSupabaseRecordingSigner<RecordingDownloadTicket>(request,{
          action:'download',
          recordingId:String(request.params.recordingId),
          download:String(request.query.download||'')==='1',
        });
        return response.json({
          url:signed.url,
          status:String(row.status||'ready'),
          mimeType:String(row.mime_type||'video/mp4'),
          storage:'supabase',
          expiresInSeconds:signed.expiresInSeconds,
        });
      }
      if(!/^https:\/\//i.test(storageUrl))return sendApiError(response,409,'RECORDING_NOT_READY','Le fichier de cet enregistrement n’est pas encore disponible.');
      response.json({url:storageUrl,status:String(row.status||'ready'),mimeType:String(row.mime_type||'video/mp4'),storage:'external'});
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
