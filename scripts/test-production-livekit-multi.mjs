import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const frontendUrl=String(process.env.MBOTE_ROOM_FRONTEND_URL||'https://mbote-room.vercel.app').replace(/\/+$/,'');
const backendUrl=String(process.env.MBOTE_ROOM_BACKEND_URL||'https://mbote-room-api.onrender.com').replace(/\/+$/,'');
const appUrl=String(process.env.MBOTE_ROOM_SMOKE_APP_URL||'https://mboteroom.loukatech.com').replace(/\/+$/,'');
const suffix=[process.env.GITHUB_RUN_ID,process.env.GITHUB_RUN_ATTEMPT,Date.now()].filter(Boolean).join('-').replace(/[^a-zA-Z0-9-]/g,'').slice(-48)||String(Date.now());
const password='MboteRoom-LiveKit-2026!';
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

const parseBody=async(response)=>{
  const text=await response.text();
  if(!text)return {};
  try{return JSON.parse(text);}catch{return {text};}
};

const api=async(path,options={},token='')=>{
  const response=await fetch(backendUrl+path,{
    ...options,
    headers:{
      'Content-Type':'application/json',
      Origin:frontendUrl,
      ...(token?{Authorization:'Bearer '+token}:{}),
      ...(options.headers||{}),
    },
  });
  return {response,data:await parseBody(response)};
};

const authBearer={'X-MBote-Room-Session-Mode':'bearer'};

const waitForStableProduction=async()=>{
  const expected=String(process.env.GITHUB_SHA||'').trim();
  const deadline=Date.now()+8*60_000;
  let stable=0;
  let lastSeen='';
  while(Date.now()<deadline){
    try{
      const response=await fetch(backendUrl+'/api/health',{headers:{Origin:frontendUrl},cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      lastSeen=String(data?.deployment?.commit||'');
      const commitReady=!expected||lastSeen===expected;
      const ready=response.ok&&data?.ok===true&&data?.readiness?.productionReady===true&&data?.readiness?.integrations?.livekit===true;
      if(commitReady&&ready){
        stable+=1;
        if(stable>=3)return data;
      }else{
        stable=0;
      }
    }catch{
      stable=0;
    }
    await sleep(5000);
  }
  throw new Error('Production did not become stable for commit '+(expected||'current')+'. Last deployed commit: '+(lastSeen||'unknown'));
};

const waitForRemoteMedia=async(page,name,timeout=50000)=>{
  await page.waitForFunction((participantName)=>{
    const tiles=Array.from(document.querySelectorAll('.room-v2-tile'));
    const tile=tiles.find((candidate)=>candidate.textContent?.includes(participantName)&&!candidate.textContent?.includes('(vous)'));
    const video=tile?.querySelector('video');
    const stream=video?.srcObject;
    if(!(stream instanceof MediaStream))return false;
    const tracks=stream.getTracks();
    return Boolean(
      video
      && !video.paused
      && video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA
      && tracks.some((track)=>track.kind==='video'&&track.readyState==='live')
      && tracks.some((track)=>track.kind==='audio'&&track.readyState==='live')
      && video.videoWidth>0
      && video.videoHeight>0
    );
  },name,{timeout});
};

const openRoom=async(browser,session,meeting,label)=>{
  const context=await browser.newContext({
    locale:'fr-FR',
    permissions:['camera','microphone'],
  });
  await context.grantPermissions(['camera','microphone'],{origin:appUrl});
  await context.addInitScript(({user,token})=>{
    localStorage.setItem('user',JSON.stringify(user));
    localStorage.setItem('token',token);
    localStorage.setItem('sessionExpiresAt',new Date(Date.now()+2*60*60_000).toISOString());
  },{user:session.user,token:session.token});

  const page=await context.newPage();
  const browserErrors=[];
  const livekitSockets=[];
  page.on('pageerror',(error)=>browserErrors.push(error.message));
  page.on('console',(message)=>{
    if(message.type()==='error'&&!/favicon|ResizeObserver/i.test(message.text()))browserErrors.push(message.text());
  });
  page.on('websocket',(webSocket)=>{
    if(/livekit\.cloud/i.test(webSocket.url()))livekitSockets.push(webSocket.url());
  });

  await page.goto(appUrl+'/reunions/'+meeting.id,{waitUntil:'domcontentloaded',timeout:45000});
  try{
    await page.locator('.room-v2-shell').waitFor({state:'visible',timeout:45000});
  }catch(error){
    const diagnostics=await page.evaluate(()=>({
      href:location.href,
      title:document.title,
      body:document.body?.innerText?.slice(0,2500)||'',
      user:localStorage.getItem('user'),
      hasToken:Boolean(localStorage.getItem('token')),
    })).catch(()=>({href:page.url(),title:'',body:'',user:null,hasToken:false}));
    throw new Error(label+' meeting shell unavailable: '+JSON.stringify(diagnostics),{cause:error});
  }
  return {context,page,browserErrors,livekitSockets,label};
};

let browser;
const opened=[];
const meetings=[];
let host=null;

try{
  const stableHealth=await waitForStableProduction();
  assert.equal(stableHealth.readiness?.integrations?.livekit,true);
  await sleep(5000);

  const before=await api('/api/health');
  assert.equal(before.response.status,200,JSON.stringify(before.data));
  assert.equal(before.data.ok,true);
  assert.equal(before.data.readiness?.integrations?.livekit,true,'LiveKit must be green before the production concurrency test');

  const mediaBefore=await api('/api/media/status');
  assert.equal(mediaBefore.response.status,200,JSON.stringify(mediaBefore.data));
  assert.equal(mediaBefore.data.livekitReady,true);
  assert.equal(mediaBefore.data.preferredMode,'livekit');

  const legal=await api('/api/public/legal/terms');
  assert.equal(legal.response.status,200,JSON.stringify(legal.data));
  assert.ok(String(legal.data.version||'').length>0);

  const register=await api('/api/auth/register',{
    method:'POST',
    headers:authBearer,
    body:JSON.stringify({
      name:'Hôte LiveKit '+suffix,
      email:'prod.livekit.host+'+suffix+'@mbote.test',
      password,
      termsAccepted:true,
      termsVersion:legal.data.version,
    }),
  });
  assert.equal(register.response.status,201,JSON.stringify(register.data));
  assert.ok(register.data.token);
  host=register.data;

  for(let index=1;index<=10;index+=1){
    const created=await api('/api/meetings',{
      method:'POST',
      body:JSON.stringify({
        title:'LiveKit production multi '+index+' '+suffix,
        description:'Validation réelle de plusieurs réunions LiveKit simultanées.',
        startTime:new Date(Date.now()-30_000).toISOString(),
        duration:30,
        settings:{
          password,
          waitingRoom:false,
          joinBeforeHost:true,
          externalAccess:true,
          participantCapacity:30,
          participantAudio:true,
          participantVideo:true,
          screenShare:true,
          chat:true,
        },
      }),
    },host.token);
    assert.equal(created.response.status,201,JSON.stringify(created.data));
    meetings.push(created.data);
  }

  await Promise.all(meetings.map(async(meeting)=>{
    const started=await api('/api/meetings/'+meeting.id+'/start-notify',{method:'POST'},host.token);
    assert.equal(started.response.status,200,JSON.stringify(started.data));
  }));

  const mediaSessions=await Promise.all(meetings.map(async(meeting)=>{
    const session=await api('/api/meetings/'+meeting.id+'/media-session',{},host.token);
    assert.equal(session.response.status,200,JSON.stringify(session.data));
    assert.equal(session.data.mode,'livekit');
    assert.ok(/^wss:\/\/[^/]+\.livekit\.cloud/i.test(String(session.data.serverUrl||'')),JSON.stringify(session.data));
    assert.equal(session.data.roomName,'mboteroom-'+meeting.id);
    assert.ok(String(session.data.participantToken||'').split('.').length===3);
    return session.data;
  }));
  assert.equal(new Set(mediaSessions.map((item)=>item.roomName)).size,10,'Each meeting must receive its own LiveKit room');

  const livePairs=[];
  for(let index=0;index<3;index+=1){
    const meeting=meetings[index];
    const guestName='Invité LiveKit '+(index+1)+' '+suffix;
    const guest=await api('/api/auth/guest-join',{
      method:'POST',
      headers:authBearer,
      body:JSON.stringify({
        name:guestName,
        meetingCode:meeting.meeting_link,
        password,
        termsAccepted:true,
        termsVersion:legal.data.version,
      }),
    });
    assert.equal(guest.response.status,201,JSON.stringify(guest.data));
    assert.equal(guest.data.lobbyStatus,'accepted');
    assert.ok(guest.data.token);

    const guestMedia=await api('/api/meetings/'+meeting.id+'/media-session',{},guest.data.token);
    assert.equal(guestMedia.response.status,200,JSON.stringify(guestMedia.data));
    assert.equal(guestMedia.data.mode,'livekit');
    livePairs.push({meeting,guest:guest.data,guestName});
  }

  browser=await chromium.launch({
    headless:true,
    args:[
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  for(const pair of livePairs){
    const [hostRoom,guestRoom]=await Promise.all([
      openRoom(browser,host,pair.meeting,'host-'+pair.meeting.id),
      openRoom(browser,pair.guest,pair.meeting,'guest-'+pair.meeting.id),
    ]);
    opened.push(hostRoom,guestRoom);
    pair.hostRoom=hostRoom;
    pair.guestRoom=guestRoom;
  }

  await Promise.all(livePairs.flatMap((pair)=>[
    waitForRemoteMedia(pair.hostRoom.page,pair.guestName),
    waitForRemoteMedia(pair.guestRoom.page,host.user.name),
  ]));

  await sleep(5000);

  for(const room of opened){
    assert.ok(room.livekitSockets.length>0,room.label+' did not open a websocket to LiveKit Cloud');
    assert.deepEqual(room.browserErrors,[],room.label+' browser errors: '+room.browserErrors.join(' | '));
  }

  const during=await api('/api/health');
  assert.equal(during.response.status,200,JSON.stringify(during.data));
  assert.equal(during.data.readiness?.integrations?.livekit,true,'LiveKit lost readiness during simultaneous meetings');

  const mediaDuring=await api('/api/media/status');
  assert.equal(mediaDuring.response.status,200,JSON.stringify(mediaDuring.data));
  assert.equal(mediaDuring.data.livekitReady,true);
  assert.equal(mediaDuring.data.preferredMode,'livekit');

  console.log('LIVEKIT_MULTI_PRODUCTION_RESULT',JSON.stringify({
    ok:true,
    livekitBefore:before.data.readiness?.integrations?.livekit,
    livekitDuring:during.data.readiness?.integrations?.livekit,
    meetingsCreated:meetings.length,
    livekitRoomsIssued:mediaSessions.length,
    simultaneousMediaMeetings:livePairs.length,
    simultaneousBrowserParticipants:opened.length,
    webSocketConnections:opened.reduce((total,room)=>total+room.livekitSockets.length,0),
    serverUrl:mediaSessions[0]?.serverUrl||'',
  }));
}finally{
  await Promise.all(opened.map((room)=>room.context.close().catch(()=>undefined)));
  await browser?.close().catch(()=>undefined);

  if(host?.token){
    await Promise.all(meetings.map(async(meeting)=>{
      await api('/api/meetings/'+meeting.id+'/end',{method:'POST'},host.token).catch(()=>undefined);
      await api('/api/meetings/'+meeting.id,{method:'DELETE'},host.token).catch(()=>undefined);
    }));
  }

  const after=await api('/api/health').catch(()=>null);
  const mediaAfter=await api('/api/media/status').catch(()=>null);
  console.log('LIVEKIT_MULTI_PRODUCTION_AFTER',JSON.stringify({
    livekit:after?.data?.readiness?.integrations?.livekit??null,
    productionReady:after?.data?.readiness?.productionReady??null,
    blockers:after?.data?.readiness?.blockers??null,
    livekitReady:mediaAfter?.data?.livekitReady??null,
    preferredMode:mediaAfter?.data?.preferredMode??null,
  }));
}
