import crypto from 'node:crypto';
import type express from 'express';
import type { Server } from 'socket.io';
import {
  type AuthedRequest,
  authenticateToken,
  createId,
  query,
  requireDatabase,
  sendApiError,
} from './core.js';
import { sendTransactionalEmail } from './emailDelivery.js';

const GOOGLE_AUTH_URL='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL='https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API='https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPE='https://www.googleapis.com/auth/calendar.events';
const MAX_FILE_BYTES=10*1024*1024;
const ALLOWED_FILE_TYPES=new Set(['application/pdf','image/jpeg','image/png','image/webp','image/gif']);

const normalizeEmail=(value:unknown)=>String(value||'').trim().toLowerCase().slice(0,254);
const normalizeText=(value:unknown)=>String(value||'').trim();
const safeReturnTo=(value:unknown)=>{
  const path=String(value||'/app/calendar').trim();
  return path.startsWith('/')&&!path.startsWith('//')&&!path.includes('\\')?path:'/app/calendar';
};
const appOrigin=()=>String(process.env.MBOTE_ROOM_APP_URL||'').trim().replace(/\/+$/,'');
const googleConfigured=()=>Boolean(
  String(process.env.GOOGLE_CALENDAR_CLIENT_ID||'').trim()
  && String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET||'').trim()
  && String(process.env.GOOGLE_CALENDAR_REDIRECT_URI||'').trim()
  && String(process.env.GOOGLE_CALENDAR_TOKEN_SECRET||'').trim()
);

const tokenKey=()=>crypto.createHash('sha256').update(String(process.env.GOOGLE_CALENDAR_TOKEN_SECRET||'')).digest();
const encryptToken=(value:string)=>{
  if(!value)return '';
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',tokenKey(),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [iv,tag,encrypted].map((part)=>part.toString('base64url')).join('.');
};
const decryptToken=(value:string)=>{
  if(!value)return '';
  const [ivRaw,tagRaw,dataRaw]=value.split('.');
  if(!ivRaw||!tagRaw||!dataRaw)return '';
  const decipher=crypto.createDecipheriv('aes-256-gcm',tokenKey(),Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw,'base64url')),decipher.final()]).toString('utf8');
};

type GoogleConnection={user_id:number;access_token_enc:string;refresh_token_enc:string;expires_at:string|null;scope:string};
const getConnection=async(userId:number)=>{
  const result=await query('SELECT * FROM room_google_calendar_connections WHERE user_id=$1 LIMIT 1',[userId]);
  return (result.rows[0]||null) as GoogleConnection|null;
};

const refreshGoogleAccessToken=async(userId:number)=>{
  if(!googleConfigured())throw new Error('Google Calendar n’est pas encore configuré sur le serveur.');
  const connection=await getConnection(userId);
  if(!connection)throw new Error('Google Calendar n’est pas connecté.');
  const expiresAt=connection.expires_at?new Date(connection.expires_at).getTime():0;
  if(expiresAt>Date.now()+60_000)return decryptToken(connection.access_token_enc);
  const refreshToken=decryptToken(connection.refresh_token_enc);
  if(!refreshToken)throw new Error('Reconnectez Google Calendar pour renouveler l’autorisation.');
  const response=await fetch(GOOGLE_TOKEN_URL,{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:String(process.env.GOOGLE_CALENDAR_CLIENT_ID||''),
      client_secret:String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET||''),
      refresh_token:refreshToken,
      grant_type:'refresh_token',
    }),
    signal:AbortSignal.timeout(12_000),
  });
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!payload?.access_token)throw new Error('Impossible de renouveler la connexion Google Calendar.');
  const nextExpires=new Date(Date.now()+Number(payload.expires_in||3600)*1000).toISOString();
  await query(
    'UPDATE room_google_calendar_connections SET access_token_enc=$2,expires_at=$3,scope=COALESCE(NULLIF($4,\'\'),scope),updated_at=now() WHERE user_id=$1',
    [userId,encryptToken(String(payload.access_token)),nextExpires,String(payload.scope||'')],
  );
  return String(payload.access_token);
};

const googleRequest=async(userId:number,path:string,init:RequestInit={})=>{
  const accessToken=await refreshGoogleAccessToken(userId);
  return fetch(`${GOOGLE_CALENDAR_API}${path}`,{
    ...init,
    headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json',...(init.headers||{})},
    signal:init.signal||AbortSignal.timeout(15_000),
  });
};

const googleEventBody=(row:any)=>({
  summary:String(row.title||'Réunion MBotéRoom'),
  description:String(row.description||''),
  start:{dateTime:new Date(row.starts_at).toISOString()},
  end:{dateTime:new Date(row.ends_at).toISOString()},
  extendedProperties:{private:{mboteroomEventId:String(row.id)}},
});

export const syncCalendarEventToGoogle=async(userId:number,row:any)=>{
  if(!googleConfigured())return row;
  const connection=await getConnection(userId);
  if(!connection)return row;
  try{
    const body=googleEventBody(row);
    let response:Response;
    if(row.google_event_id){
      response=await googleRequest(userId,`/calendars/primary/events/${encodeURIComponent(row.google_event_id)}`,{method:'PATCH',body:JSON.stringify(body)});
    }else{
      response=await googleRequest(userId,'/calendars/primary/events?sendUpdates=none',{method:'POST',body:JSON.stringify(body)});
    }
    if(!response.ok)return row;
    const googleEvent=await response.json().catch(()=>null);
    if(googleEvent?.id&&!row.google_event_id){
      const updated=await query('UPDATE room_calendar_events SET google_event_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',[row.id,userId,String(googleEvent.id)]);
      return updated.rows[0]||row;
    }
  }catch(error){console.warn('Google Calendar event sync failed',error);}
  return row;
};

export const deleteCalendarEventFromGoogle=async(userId:number,googleEventId:string|null|undefined)=>{
  if(!googleEventId||!googleConfigured())return;
  const connection=await getConnection(userId);
  if(!connection)return;
  try{await googleRequest(userId,`/calendars/primary/events/${encodeURIComponent(googleEventId)}?sendUpdates=none`,{method:'DELETE'});}catch(error){console.warn('Google Calendar delete failed',error);}
};

const syncGoogleCalendar=async(userId:number)=>{
  const timeMin=new Date(Date.now()-30*86400_000).toISOString();
  const timeMax=new Date(Date.now()+365*86400_000).toISOString();
  const list=await googleRequest(userId,`/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`);
  if(!list.ok)throw new Error('Impossible de lire Google Calendar.');
  const payload=await list.json().catch(()=>({items:[]}));
  const items=Array.isArray(payload?.items)?payload.items:[];
  let imported=0;
  for(const event of items){
    if(!event?.id||event.status==='cancelled')continue;
    const startRaw=event.start?.dateTime||event.start?.date;
    const endRaw=event.end?.dateTime||event.end?.date;
    if(!startRaw||!endRaw)continue;
    const startsAt=new Date(startRaw);
    const endsAt=new Date(endRaw);
    if(Number.isNaN(startsAt.getTime())||Number.isNaN(endsAt.getTime()))continue;
    const mboteId=String(event.extendedProperties?.private?.mboteroomEventId||'');
    if(mboteId){
      await query(
        `UPDATE room_calendar_events SET title=$3,description=$4,starts_at=$5,ends_at=$6,google_event_id=$7,updated_at=now()
         WHERE id=$1 AND user_id=$2`,
        [mboteId,userId,String(event.summary||'Événement Google').slice(0,200),String(event.description||'').slice(0,1000),startsAt.toISOString(),endsAt.toISOString(),String(event.id)],
      );
      continue;
    }
    const id=createId();
    const result=await query(
      `INSERT INTO room_calendar_events (id,user_id,title,description,starts_at,ends_at,google_event_id,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'google')
       ON CONFLICT (user_id,google_event_id) WHERE google_event_id IS NOT NULL
       DO UPDATE SET title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now()
       RETURNING id`,
      [id,userId,String(event.summary||'Événement Google').slice(0,200),String(event.description||'').slice(0,1000),startsAt.toISOString(),endsAt.toISOString(),String(event.id)],
    );
    if(result.rows[0])imported+=1;
  }

  const unsynced=await query(`SELECT * FROM room_calendar_events WHERE user_id=$1 AND source='mboteroom' AND google_event_id IS NULL ORDER BY starts_at ASC LIMIT 500`,[userId]);
  let pushed=0;
  for(const row of unsynced.rows){
    const synced=await syncCalendarEventToGoogle(userId,row);
    if(synced?.google_event_id)pushed+=1;
  }
  return{imported,pushed,totalGoogle:items.length};
};

const readRawBody=async(request:express.Request,maxBytes=MAX_FILE_BYTES)=>{
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of request){
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=buffer.length;
    if(size>maxBytes)throw Object.assign(new Error('Fichier trop volumineux.'),{code:'FILE_TOO_LARGE'});
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const groupAccess=async(groupId:string,user:NonNullable<AuthedRequest['user']>)=>{
  const result=await query(
    `SELECT g.*,CASE WHEN g.owner_id=$2 THEN true ELSE false END AS is_owner
       FROM room_work_groups g
      WHERE g.id=$1
        AND (g.owner_id=$2 OR EXISTS(
          SELECT 1 FROM room_work_group_members m
          WHERE m.group_id=g.id AND (m.user_id=$2 OR lower(m.email)=lower($3))
        ))
      LIMIT 1`,
    [groupId,user.id,user.email],
  );
  return result.rows[0]||null;
};

const groupPayload=async(group:any)=>{
  const [members,calls,files]=await Promise.all([
    query(`SELECT m.email,m.user_id,m.role,COALESCE(u.name,m.email) AS name,u.avatar
      FROM room_work_group_members m LEFT JOIN room_users u ON u.id=m.user_id
      WHERE m.group_id=$1 ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,lower(m.email)`,[group.id]),
    query(`SELECT c.id,c.group_id,c.meeting_id,c.call_type,c.created_by,c.created_at,
      m.title,m.start_time,m.duration,m.status,m.meeting_link,m.is_active
      FROM room_work_group_calls c JOIN room_meetings m ON m.id=c.meeting_id
      WHERE c.group_id=$1 ORDER BY m.start_time DESC LIMIT 100`,[group.id]),
    query(`SELECT f.id,f.name,f.mime_type,f.size_bytes,f.created_at,gf.uploaded_by
      FROM room_work_group_files gf JOIN room_files f ON f.id=gf.file_id
      WHERE gf.group_id=$1 ORDER BY gf.created_at DESC LIMIT 100`,[group.id]),
  ]);
  return{
    id:String(group.id),ownerId:Number(group.owner_id),name:String(group.name),description:String(group.description||''),
    isOwner:Boolean(group.is_owner),createdAt:new Date(group.created_at).toISOString(),updatedAt:new Date(group.updated_at).toISOString(),
    members:members.rows.map((row)=>({email:row.email,userId:row.user_id?Number(row.user_id):null,role:row.role,name:row.name,avatar:row.avatar||''})),
    calls:calls.rows.map((row)=>({id:row.id,meetingId:Number(row.meeting_id),callType:row.call_type,title:row.title,startTime:new Date(row.start_time).toISOString(),duration:Number(row.duration),status:row.status,meetingLink:row.meeting_link,isActive:Boolean(row.is_active),createdAt:new Date(row.created_at).toISOString()})),
    files:files.rows.map((row)=>({id:row.id,name:row.name,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),createdAt:new Date(row.created_at).toISOString(),uploadedBy:Number(row.uploaded_by)})),
  };
};

export const registerWorkspaceRoutes=(app:express.Express,io:Server)=>{
  const protectedApi=[requireDatabase,authenticateToken] as const;

  app.get('/api/calendar/google/status',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const connection=await getConnection(request.user!.id);
      response.json({configured:googleConfigured(),connected:Boolean(connection),scope:connection?.scope||''});
    }catch(error){next(error);}
  });

  app.post('/api/calendar/google/connect',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      if(!googleConfigured())return sendApiError(response,503,'GOOGLE_CALENDAR_NOT_CONFIGURED','Google Calendar n’est pas encore configuré par l’administrateur.');
      const state=crypto.randomBytes(32).toString('hex');
      await query('DELETE FROM room_google_oauth_states WHERE expires_at<now()');
      await query('INSERT INTO room_google_oauth_states (state,user_id,return_to,expires_at) VALUES ($1,$2,$3,now()+interval \'10 minutes\')',[state,request.user!.id,safeReturnTo(request.body?.returnTo)]);
      const params=new URLSearchParams({
        client_id:String(process.env.GOOGLE_CALENDAR_CLIENT_ID),
        redirect_uri:String(process.env.GOOGLE_CALENDAR_REDIRECT_URI),
        response_type:'code',
        scope:GOOGLE_SCOPE,
        access_type:'offline',
        include_granted_scopes:'true',
        prompt:'consent',
        state,
      });
      response.json({url:`${GOOGLE_AUTH_URL}?${params.toString()}`});
    }catch(error){next(error);}
  });

  app.get('/api/calendar/google/callback',requireDatabase,async(request,response,next)=>{
    try{
      const state=String(request.query.state||'');
      const code=String(request.query.code||'');
      const stateResult=await query('DELETE FROM room_google_oauth_states WHERE state=$1 AND expires_at>now() RETURNING *',[state]);
      const saved=stateResult.rows[0];
      if(!saved||!code)return response.redirect(`${appOrigin()}/app/calendar?google=failed`);
      const tokenResponse=await fetch(GOOGLE_TOKEN_URL,{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({
          code,
          client_id:String(process.env.GOOGLE_CALENDAR_CLIENT_ID||''),
          client_secret:String(process.env.GOOGLE_CALENDAR_CLIENT_SECRET||''),
          redirect_uri:String(process.env.GOOGLE_CALENDAR_REDIRECT_URI||''),
          grant_type:'authorization_code',
        }),
        signal:AbortSignal.timeout(12_000),
      });
      const payload=await tokenResponse.json().catch(()=>null);
      if(!tokenResponse.ok||!payload?.access_token)return response.redirect(`${appOrigin()}/app/calendar?google=failed`);
      const current=await getConnection(Number(saved.user_id));
      const refresh=String(payload.refresh_token||'')|| (current?decryptToken(current.refresh_token_enc):'');
      await query(
        `INSERT INTO room_google_calendar_connections (user_id,access_token_enc,refresh_token_enc,expires_at,scope)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE SET access_token_enc=excluded.access_token_enc,
           refresh_token_enc=CASE WHEN excluded.refresh_token_enc<>'' THEN excluded.refresh_token_enc ELSE room_google_calendar_connections.refresh_token_enc END,
           expires_at=excluded.expires_at,scope=excluded.scope,updated_at=now()`,
        [Number(saved.user_id),encryptToken(String(payload.access_token)),encryptToken(refresh),new Date(Date.now()+Number(payload.expires_in||3600)*1000).toISOString(),String(payload.scope||GOOGLE_SCOPE)],
      );
      response.redirect(`${appOrigin()}${safeReturnTo(saved.return_to)}?google=connected`);
    }catch(error){next(error);}
  });

  app.post('/api/calendar/google/sync',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      if(!googleConfigured())return sendApiError(response,503,'GOOGLE_CALENDAR_NOT_CONFIGURED','Google Calendar n’est pas encore configuré.');
      if(!(await getConnection(request.user!.id)))return sendApiError(response,409,'GOOGLE_CALENDAR_NOT_CONNECTED','Connectez d’abord votre Google Calendar.');
      const result=await syncGoogleCalendar(request.user!.id);
      io.to(`user:${request.user!.id}`).emit('calendar:event-updated',{sync:true});
      response.json({success:true,...result});
    }catch(error){next(error);}
  });

  app.delete('/api/calendar/google/connection',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{await query('DELETE FROM room_google_calendar_connections WHERE user_id=$1',[request.user!.id]);response.json({success:true});}catch(error){next(error);}
  });

  app.get('/api/files',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT DISTINCT f.id,f.owner_id,f.name,f.mime_type,f.size_bytes,f.created_at
         FROM room_files f
         LEFT JOIN room_work_group_files gf ON gf.file_id=f.id
         LEFT JOIN room_work_group_members gm ON gm.group_id=gf.group_id
         LEFT JOIN room_work_groups g ON g.id=gf.group_id
         WHERE f.owner_id=$1 OR g.owner_id=$1 OR gm.user_id=$1 OR lower(gm.email)=lower($2)
         ORDER BY f.created_at DESC LIMIT 300`,
        [request.user!.id,request.user!.email],
      );
      response.json(result.rows.map((row)=>({id:row.id,ownerId:Number(row.owner_id),name:row.name,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),createdAt:new Date(row.created_at).toISOString()})));
    }catch(error){next(error);}
  });

  app.post('/api/files/upload',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const mime=String(request.headers['content-type']||'').split(';')[0].toLowerCase();
      if(!ALLOWED_FILE_TYPES.has(mime))return sendApiError(response,415,'FILE_TYPE_NOT_ALLOWED','Seuls les fichiers PDF et images sont autorisés.');
      const rawName=decodeURIComponent(String(request.headers['x-file-name']||'fichier')).replace(/[\\/\0]/g,' ').trim().slice(0,180);
      const name=rawName||'fichier';
      const content=await readRawBody(request);
      if(!content.length)return sendApiError(response,400,'FILE_EMPTY','Le fichier est vide.');
      const id=createId();
      const inserted=await query(
        'INSERT INTO room_files (id,owner_id,name,mime_type,size_bytes,content) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,owner_id,name,mime_type,size_bytes,created_at',
        [id,request.user!.id,name,mime,content.length,content],
      );
      const groupId=String(request.headers['x-work-group-id']||'').trim();
      if(groupId){
        const group=await groupAccess(groupId,request.user!);
        if(!group){await query('DELETE FROM room_files WHERE id=$1',[id]);return sendApiError(response,403,'GROUP_ACCESS_DENIED','Vous n’avez pas accès à ce groupe.');}
        await query('INSERT INTO room_work_group_files (group_id,file_id,uploaded_by) VALUES ($1,$2,$3)',[groupId,id,request.user!.id]);
        io.to(`work-group:${groupId}`).emit('work-group:file-added',{groupId,fileId:id});
      }
      const row=inserted.rows[0];
      response.status(201).json({id:row.id,ownerId:Number(row.owner_id),name:row.name,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),createdAt:new Date(row.created_at).toISOString()});
    }catch(error:any){
      if(error?.code==='FILE_TOO_LARGE')return sendApiError(response,413,'FILE_TOO_LARGE','Le fichier dépasse la limite de 10 Mo.');
      next(error);
    }
  });

  app.get('/api/files/:fileId/content',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT f.* FROM room_files f
         WHERE f.id=$1 AND (
           f.owner_id=$2 OR EXISTS(
             SELECT 1 FROM room_work_group_files gf
             JOIN room_work_groups g ON g.id=gf.group_id
             LEFT JOIN room_work_group_members gm ON gm.group_id=g.id
             WHERE gf.file_id=f.id AND (g.owner_id=$2 OR gm.user_id=$2 OR lower(gm.email)=lower($3))
           )
         ) LIMIT 1`,
        [request.params.fileId,request.user!.id,request.user!.email],
      );
      const file=result.rows[0];
      if(!file)return sendApiError(response,404,'FILE_NOT_FOUND','Fichier introuvable.');
      response.setHeader('Content-Type',file.mime_type);
      response.setHeader('Content-Length',String(file.size_bytes));
      response.setHeader('Content-Disposition',`inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      response.setHeader('Cache-Control','private, max-age=300');
      response.send(file.content);
    }catch(error){next(error);}
  });

  app.delete('/api/files/:fileId',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const result=await query('DELETE FROM room_files WHERE id=$1 AND owner_id=$2 RETURNING id',[request.params.fileId,request.user!.id]);
      if(!result.rows[0])return sendApiError(response,404,'FILE_NOT_FOUND','Fichier introuvable ou suppression non autorisée.');
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.get('/api/work-groups',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const result=await query(
        `SELECT DISTINCT g.*,CASE WHEN g.owner_id=$1 THEN true ELSE false END AS is_owner
         FROM room_work_groups g
         LEFT JOIN room_work_group_members m ON m.group_id=g.id
         WHERE g.owner_id=$1 OR m.user_id=$1 OR lower(m.email)=lower($2)
         ORDER BY g.updated_at DESC`,
        [request.user!.id,request.user!.email],
      );
      const rows=await Promise.all(result.rows.map(groupPayload));
      response.json(rows);
    }catch(error){next(error);}
  });

  app.post('/api/work-groups',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const name=normalizeText(request.body?.name).slice(0,120);
      const description=normalizeText(request.body?.description).slice(0,600);
      const emails=[...new Set((Array.isArray(request.body?.emails)?request.body.emails:[]).map(normalizeEmail).filter(Boolean))].slice(0,50);
      if(!name)return sendApiError(response,400,'GROUP_NAME_REQUIRED','Le nom du groupe est requis.');
      const id=createId();
      await query('BEGIN');
      try{
        const inserted=await query('INSERT INTO room_work_groups (id,owner_id,name,description) VALUES ($1,$2,$3,$4) RETURNING *',[id,request.user!.id,name,description]);
        await query(`INSERT INTO room_work_group_members (group_id,email,user_id,role) VALUES ($1,$2,$3,'owner')`,[id,normalizeEmail(request.user!.email),request.user!.id]);
        for(const email of emails.filter((value)=>value!==normalizeEmail(request.user!.email))){
          const found=await query('SELECT id FROM room_users WHERE lower(email)=lower($1) AND is_guest=false LIMIT 1',[email]);
          await query(`INSERT INTO room_work_group_members (group_id,email,user_id,role) VALUES ($1,$2,$3,'member') ON CONFLICT DO NOTHING`,[id,email,found.rows[0]?.id||null]);
        }
        await query('COMMIT');
        const group={...inserted.rows[0],is_owner:true};
        const payload=await groupPayload(group);
        response.status(201).json(payload);
        const origin=appOrigin();
        void Promise.all(emails.map((email)=>sendTransactionalEmail({
          to:email,
          subject:`Invitation au groupe MBotéRoom : ${name}`,
          text:`${request.user!.name} vous a ajouté au groupe « ${name} » sur MBotéRoom. Ouvrez ${origin}/app/groups pour accéder au groupe.`,
          html:`<p><strong>${request.user!.name}</strong> vous a ajouté au groupe <strong>${name}</strong> sur MBotéRoom.</p><p><a href="${origin}/app/groups">Ouvrir le groupe</a></p>`,
        }).catch(()=>false)));
      }catch(error){await query('ROLLBACK');throw error;}
    }catch(error){next(error);}
  });

  app.get('/api/work-groups/:groupId',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const group=await groupAccess(request.params.groupId,request.user!);
      if(!group)return sendApiError(response,404,'GROUP_NOT_FOUND','Groupe introuvable.');
      response.json(await groupPayload(group));
    }catch(error){next(error);}
  });

  app.delete('/api/work-groups/:groupId',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const group=await groupAccess(request.params.groupId,request.user!);
      if(!group)return sendApiError(response,404,'GROUP_NOT_FOUND','Groupe introuvable.');
      if(Number(group.owner_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'GROUP_OWNER_REQUIRED','Seul le propriétaire du groupe peut le supprimer.');
      await query('DELETE FROM room_work_groups WHERE id=$1',[request.params.groupId]);
      io.to(`work-group:${request.params.groupId}`).emit('work-group:deleted',{groupId:request.params.groupId});
      response.status(204).end();
    }catch(error){next(error);}
  });

  app.post('/api/work-groups/:groupId/calls',...protectedApi,async(request:AuthedRequest,response,next)=>{
    try{
      const group=await groupAccess(request.params.groupId,request.user!);
      if(!group)return sendApiError(response,404,'GROUP_NOT_FOUND','Groupe introuvable.');
      const meetingId=Number(request.body?.meetingId||0);
      const callType=request.body?.callType==='audio'?'audio':'video';
      const meeting=await query('SELECT id,host_id FROM room_meetings WHERE id=$1 AND status<>\'cancelled\' LIMIT 1',[meetingId]);
      if(!meeting.rows[0])return sendApiError(response,404,'MEETING_NOT_FOUND','Réunion introuvable.');
      if(Number(meeting.rows[0].host_id)!==request.user!.id&&request.user!.role!=='admin')return sendApiError(response,403,'MEETING_HOST_REQUIRED','Vous devez être l’hôte de cet appel.');
      const id=createId();
      await query(
        `INSERT INTO room_work_group_calls (id,group_id,meeting_id,call_type,created_by)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (group_id,meeting_id) DO UPDATE SET call_type=excluded.call_type RETURNING id`,
        [id,request.params.groupId,meetingId,callType,request.user!.id],
      );
      io.to(`work-group:${request.params.groupId}`).emit('work-group:call-added',{groupId:request.params.groupId,meetingId,callType});
      response.status(201).json({success:true,id,meetingId,callType});
    }catch(error){next(error);}
  });
};
