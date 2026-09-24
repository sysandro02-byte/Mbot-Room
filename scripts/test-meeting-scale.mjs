import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { io as createClient } from 'socket.io-client';

const databaseUrl=String(process.env.DATABASE_URL||'');
assert.ok(databaseUrl,'DATABASE_URL is required for the meeting scale test');

const port=3917;
const baseUrl='http://127.0.0.1:'+port;
const server=spawn(process.execPath,['dist/server.js'],{
  env:{
    ...process.env,
    PORT:String(port),
    PGSSLMODE:'disable',
    NODE_ENV:'test',
    MBOTE_ROOM_TEST_DATABASE:'1',
    MBOTE_ROOM_APP_URL:baseUrl,
    MEDIA_TRANSPORT:'auto',
    LIVEKIT_URL:'ws://127.0.0.1:7880',
    LIVEKIT_API_KEY:'scale-test-key',
    LIVEKIT_API_SECRET:'scale-test-secret',
    LIVEKIT_TOKEN_TTL_SECONDS:'900',
  },
  stdio:['ignore','pipe','pipe'],
});

let serverOutput='';
server.stdout.on('data',(chunk)=>{serverOutput+=chunk.toString();});
server.stderr.on('data',(chunk)=>{serverOutput+=chunk.toString();});
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

const waitForServer=async()=>{
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    try{
      const response=await fetch(baseUrl+'/api/health');
      if(response.ok)return;
    }catch{}
    await sleep(150);
  }
  throw new Error('Scale test server unavailable.\n'+serverOutput);
};

const jsonRequest=async(path,token,options={})=>{
  const response=await fetch(baseUrl+path,{
    ...options,
    headers:{
      'Content-Type':'application/json',
      Origin:baseUrl,
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(options.headers||{}),
    },
  });
  const text=await response.text();
  let data={};
  try{data=text?JSON.parse(text):{};}catch{data={text};}
  return {response,data};
};

const hashToken=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const pool=new pg.Pool({connectionString:databaseUrl,ssl:false});
const sockets=[];

const createSessionUser=async(label,index)=>{
  const suffix=crypto.randomBytes(5).toString('hex');
  const email='scale-'+label+'-'+index+'-'+suffix+'@mbote.test';
  const now=new Date().toISOString();
  const inserted=await pool.query(
    "INSERT INTO room_users (name,username,email,avatar,password_hash,password_salt,is_guest,created_at,role,account_status,feature_restrictions) VALUES ($1,$2,$3,'','','',false,$4,'user','active','[]'::jsonb) RETURNING id,name,email",
    ['Scale '+label+' '+index,'scale-'+label+'-'+index+'-'+suffix,email,now],
  );
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query(
    "INSERT INTO room_sessions (token_hash,user_id,created_at,expires_at,last_activity) VALUES ($1,$2,$3,$4,now())",
    [hashToken(token),Number(inserted.rows[0].id),now,new Date(Date.now()+60*60*1000).toISOString()],
  );
  return {id:Number(inserted.rows[0].id),name:String(inserted.rows[0].name),email,token};
};

const connectParticipant=(user,meetingId)=>new Promise((resolve,reject)=>{
  const socket=createClient(baseUrl,{
    transports:['websocket'],
    auth:{token:user.token},
    extraHeaders:{Origin:baseUrl},
    reconnection:false,
    timeout:15000,
  });
  sockets.push(socket);
  const timer=setTimeout(()=>{socket.close();reject(new Error('Socket timeout for user '+user.id));},20000);
  socket.once('connect_error',(error)=>{clearTimeout(timer);reject(error);});
  socket.once('connect',()=>{
    socket.timeout(15000).emit('meeting:join',{
      meetingId,
      media:{audio:false,video:false,screen:false},
    },(error,response)=>{
      clearTimeout(timer);
      if(error)return reject(error);
      if(!response?.ok)return reject(new Error('Join rejected: '+JSON.stringify(response)));
      resolve(response);
    });
  });
});

const joinInBatches=async(users,meetingId,batchSize=20)=>{
  const responses=[];
  for(let index=0;index<users.length;index+=batchSize){
    const batch=users.slice(index,index+batchSize);
    responses.push(...await Promise.all(batch.map((user)=>connectParticipant(user,meetingId))));
  }
  return responses;
};

try{
  await waitForServer();

  const host=await createSessionUser('host',1);
  await pool.query("UPDATE room_users SET role='admin' WHERE id=$1",[host.id]);

  const createMeeting=async(title,capacity)=>{
    const created=await jsonRequest('/api/meetings',host.token,{
      method:'POST',
      body:JSON.stringify({
        title,
        description:'Automated concurrency and capacity validation',
        startTime:new Date(Date.now()-60000).toISOString(),
        duration:120,
        settings:{
          participantCapacity:capacity,
          waitingRoom:false,
          joinBeforeHost:true,
          participantAudio:true,
          participantVideo:true,
          screenShare:true,
          chat:true,
        },
      }),
    });
    assert.equal(created.response.status,201,JSON.stringify(created.data));
    const started=await jsonRequest('/api/meetings/'+created.data.id+'/start-notify',host.token,{method:'POST'});
    assert.equal(started.response.status,200,JSON.stringify(started.data));
    return started.data.meeting;
  };

  const largeMeeting=await createMeeting('Scale · 120 participants',180);
  const meetingTwo=await createMeeting('Scale · simultaneous B',60);
  const meetingThree=await createMeeting('Scale · simultaneous C',60);

  const largeUsers=[];
  const groupTwo=[];
  const groupThree=[];
  for(let index=1;index<=120;index+=1)largeUsers.push(await createSessionUser('large',index));
  for(let index=1;index<=25;index+=1)groupTwo.push(await createSessionUser('b',index));
  for(let index=1;index<=25;index+=1)groupThree.push(await createSessionUser('c',index));

  const addMembers=async(meetingId,users)=>{
    await pool.query(
      "INSERT INTO room_meeting_members (meeting_id,user_id,role,status) SELECT $1,unnest($2::int[]),'participant','accepted' ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='accepted',role='participant',updated_at=now()",
      [meetingId,users.map((user)=>user.id)],
    );
  };
  await Promise.all([
    addMembers(largeMeeting.id,largeUsers),
    addMembers(meetingTwo.id,groupTwo),
    addMembers(meetingThree.id,groupThree),
  ]);

  const [largeJoins,twoJoins,threeJoins]=await Promise.all([
    joinInBatches(largeUsers,largeMeeting.id),
    joinInBatches(groupTwo,meetingTwo.id),
    joinInBatches(groupThree,meetingThree.id),
  ]);
  assert.equal(largeJoins.length,120);
  assert.equal(twoJoins.length,25);
  assert.equal(threeJoins.length,25);
  assert.ok(largeJoins.every((result)=>result.ok===true));
  assert.ok(twoJoins.every((result)=>result.ok===true));
  assert.ok(threeJoins.every((result)=>result.ok===true));

  const counts=await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'",[largeMeeting.id]),
    pool.query("SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'",[meetingTwo.id]),
    pool.query("SELECT COUNT(*)::int AS count FROM room_meeting_members WHERE meeting_id=$1 AND status='accepted'",[meetingThree.id]),
  ]);
  assert.equal(Number(counts[0].rows[0].count),121);
  assert.equal(Number(counts[1].rows[0].count),26);
  assert.equal(Number(counts[2].rows[0].count),26);

  const mediaStatus=await jsonRequest('/api/media/status','');
  assert.equal(mediaStatus.response.status,200,JSON.stringify(mediaStatus.data));
  assert.equal(mediaStatus.data.livekitReady,true);
  assert.equal(mediaStatus.data.preferredMode,'livekit');

  let mediaSuccess=0;
  for(let index=0;index<largeUsers.length;index+=20){
    const results=await Promise.all(largeUsers.slice(index,index+20).map(async(user)=>{
      const session=await jsonRequest('/api/meetings/'+largeMeeting.id+'/media-session',user.token);
      assert.equal(session.response.status,200,JSON.stringify(session.data));
      assert.equal(session.data.mode,'livekit');
      assert.equal(session.data.roomName,'mboteroom-'+largeMeeting.id);
      assert.ok(String(session.data.participantToken||'').split('.').length===3);
      assert.ok(session.data.permissions?.canPublishSources?.includes('camera'));
      assert.ok(session.data.permissions?.canPublishSources?.includes('microphone'));
      return true;
    }));
    mediaSuccess+=results.filter(Boolean).length;
  }
  assert.equal(mediaSuccess,120);

  console.log('Meeting scale checks passed: 170 concurrent realtime participants across 3 meetings, including 120 in one room; 120 LiveKit media sessions issued.');
}finally{
  sockets.forEach((socket)=>socket.close());
  await pool.end().catch(()=>undefined);
  if(!server.killed)server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve)=>server.once('exit',resolve)),
    sleep(5000),
  ]);
}
