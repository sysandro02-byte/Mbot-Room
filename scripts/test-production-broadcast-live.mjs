import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';

const frontendUrl=String(process.env.MBOTE_ROOM_FRONTEND_URL||'https://mbote-room.vercel.app').replace(/\/+$/,'');
const backendUrl=String(process.env.MBOTE_ROOM_BACKEND_URL||'https://mbote-room-api.onrender.com').replace(/\/+$/,'');
const appUrl=String(process.env.MBOTE_ROOM_SMOKE_APP_URL||backendUrl).replace(/\/+$/,'');
const suffix=[process.env.GITHUB_RUN_ID,process.env.GITHUB_RUN_ATTEMPT,Date.now()].filter(Boolean).join('-').replace(/[^a-zA-Z0-9-]/g,'').slice(-48)||String(Date.now());
const password='MbR!'+randomBytes(18).toString('base64url')+'9a';
const hostEmail=`prod.broadcast.host+${suffix}@mbote.test`;
const viewerEmail=`prod.broadcast.viewer+${suffix}@mbote.test`;
const authBearer={'X-MBote-Room-Session-Mode':'bearer'};

const parseBody=async(response)=>{
  const text=await response.text();
  if(!text)return {};
  try{return JSON.parse(text);}catch{return {text};}
};

const api=async(path,options={},token='')=>{
  const response=await fetch(`${backendUrl}${path}`,{
    ...options,
    headers:{
      'Content-Type':'application/json',
      Origin:frontendUrl,
      ...(token?{Authorization:`Bearer ${token}`}:{}),
      ...(options.headers||{}),
    },
  });
  return {response,data:await parseBody(response)};
};

const register=async(name,email)=>{
  const result=await api('/api/auth/register',{
    method:'POST',
    headers:authBearer,
    body:JSON.stringify({
      name,email,password,
      country:'Congo-Brazzaville',
      city:'Brazzaville',
      termsAccepted:true,
      termsVersion:'2026-09-24',
    }),
  });
  assert.equal(result.response.status,201,JSON.stringify(result.data));
  assert.ok(result.data.token);
  assert.ok(result.data.user?.id);
  return result.data;
};

const openLive=async(browser,session,liveId,label)=>{
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
  page.on('pageerror',(error)=>browserErrors.push(error.message));
  page.on('console',(message)=>{
    if(message.type()==='error'&&!/favicon|ResizeObserver/i.test(message.text()))browserErrors.push(message.text());
  });

  await page.goto(`${appUrl}/app/live/${liveId}`,{waitUntil:'domcontentloaded',timeout:30_000});
  await page.locator('.live-room-page').waitFor({state:'attached',timeout:30_000});
  return {context,page,browserErrors,label};
};

const waitForMainVideo=async(page,timeout=45_000)=>{
  await page.waitForFunction(()=>{
    const video=document.querySelector('video.live-main-video');
    const stream=video?.srcObject;
    if(!(stream instanceof MediaStream))return false;
    const liveVideo=stream.getVideoTracks().some((track)=>track.readyState==='live');
    return Boolean(video&&liveVideo&&!video.paused&&video.readyState>=HTMLMediaElement.HAVE_CURRENT_DATA&&video.videoWidth>0&&video.videoHeight>0);
  },undefined,{timeout});
};

let browser;
let hostRoom;
let viewerRoom;
let host;
let viewer;
let live;

try{
  const mediaStatus=await api('/api/media/status');
  assert.equal(mediaStatus.response.status,200,JSON.stringify(mediaStatus.data));
  assert.equal(mediaStatus.data.livekitReady,true,'LiveKit must be configured for broadcast Live');
  assert.equal(mediaStatus.data.preferredMode,'livekit','Broadcast Live must use LiveKit in production');

  host=await register(`Hôte Broadcast ${suffix}`,hostEmail);
  viewer=await register(`Spectateur Broadcast ${suffix}`,viewerEmail);

  const created=await api('/api/live',{
    method:'POST',
    body:JSON.stringify({
      title:`Live smoke ${suffix}`,
      description:'Validation production du Live MBotéRoom',
      category:'tech',
      visibility:'public',
      startNow:true,
      chatEnabled:true,
      cohostsEnabled:true,
      recordingEnabled:false,
      moderationEnabled:true,
    }),
  },host.token);
  assert.equal(created.response.status,201,JSON.stringify(created.data));
  live=created.data;
  assert.equal(live.status,'live');
  assert.ok(live.id);
  assert.ok(live.meetingId);

  const feed=await api('/api/live/feed?mode=live',{},viewer.token);
  assert.equal(feed.response.status,200,JSON.stringify(feed.data));
  assert.ok(Array.isArray(feed.data));
  assert.ok(feed.data.some((item)=>String(item.id)===String(live.id)&&item.status==='live'),'Created Live must appear in viewer feed');

  const hostJoin=await api(`/api/live/${encodeURIComponent(live.id)}/join`,{method:'POST',body:'{}'},host.token);
  assert.equal(hostJoin.response.status,200,JSON.stringify(hostJoin.data));
  assert.equal(hostJoin.data.role,'host');

  const viewerJoin=await api(`/api/live/${encodeURIComponent(live.id)}/join`,{method:'POST',body:'{}'},viewer.token);
  assert.equal(viewerJoin.response.status,200,JSON.stringify(viewerJoin.data));
  assert.equal(viewerJoin.data.role,'viewer');
  assert.ok(Number(viewerJoin.data.viewerCount)>=1);

  const hostMedia=await api(`/api/meetings/${live.meetingId}/media-session`,{},host.token);
  const viewerMedia=await api(`/api/meetings/${live.meetingId}/media-session`,{},viewer.token);
  assert.equal(hostMedia.response.status,200,JSON.stringify(hostMedia.data));
  assert.equal(viewerMedia.response.status,200,JSON.stringify(viewerMedia.data));
  assert.equal(hostMedia.data.mode,'livekit');
  assert.equal(viewerMedia.data.mode,'livekit');
  assert.match(String(hostMedia.data.serverUrl||''),/^wss:\/\//i);
  assert.match(String(viewerMedia.data.serverUrl||''),/^wss:\/\//i);
  assert.ok(String(hostMedia.data.participantToken||'').length>40);
  assert.ok(String(viewerMedia.data.participantToken||'').length>40);

  const comment=await api(`/api/live/${encodeURIComponent(live.id)}/comments`,{
    method:'POST',
    body:JSON.stringify({text:'Commentaire smoke du Live MBotéRoom'}),
  },viewer.token);
  assert.equal(comment.response.status,201,JSON.stringify(comment.data));

  const like=await api(`/api/live/${encodeURIComponent(live.id)}/like`,{
    method:'POST',
    body:'{}',
  },viewer.token);
  assert.equal(like.response.status,200,JSON.stringify(like.data));
  assert.equal(like.data.liked,true);

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

  hostRoom=await openLive(browser,host,live.id,'host');
  await waitForMainVideo(hostRoom.page);

  viewerRoom=await openLive(browser,viewer,live.id,'viewer');
  await waitForMainVideo(viewerRoom.page);

  await viewerRoom.page.waitForFunction(()=>{
    const wait=document.querySelector('.live-video-wait');
    return !wait||!wait.textContent?.includes('Connexion au serveur média');
  },undefined,{timeout:15_000});

  const viewerVideo=await viewerRoom.page.evaluate(()=>{
    const video=document.querySelector('video.live-main-video');
    const stream=video?.srcObject;
    return {
      paused:Boolean(video?.paused),
      readyState:Number(video?.readyState||0),
      width:Number(video?.videoWidth||0),
      height:Number(video?.videoHeight||0),
      tracks:stream instanceof MediaStream?stream.getTracks().map((track)=>({kind:track.kind,state:track.readyState,enabled:track.enabled})):[]
    };
  });
  assert.ok(viewerVideo.width>0&&viewerVideo.height>0,JSON.stringify(viewerVideo));
  assert.ok(viewerVideo.tracks.some((track)=>track.kind==='video'&&track.state==='live'),JSON.stringify(viewerVideo));

  const comments=await api(`/api/live/${encodeURIComponent(live.id)}/comments`,{},host.token);
  assert.equal(comments.response.status,200,JSON.stringify(comments.data));
  assert.ok(comments.data.some((item)=>item.text==='Commentaire smoke du Live MBotéRoom'));

  assert.deepEqual(hostRoom.browserErrors,[],`Host Live browser errors: ${hostRoom.browserErrors.join('\n')}`);
  assert.deepEqual(viewerRoom.browserErrors,[],`Viewer Live browser errors: ${viewerRoom.browserErrors.join('\n')}`);

  const end=await api(`/api/live/${encodeURIComponent(live.id)}/end`,{method:'POST',body:'{}'},host.token);
  assert.equal(end.response.status,200,JSON.stringify(end.data));
  assert.equal(end.data.status,'ended');

  console.log('BROADCAST_LIVE_SMOKE_RESULT',JSON.stringify({
    ok:true,
    liveId:live.id,
    meetingId:live.meetingId,
    hostUserId:host.user.id,
    viewerUserId:viewer.user.id,
    transport:hostMedia.data.mode,
    serverUrlProtocol:String(hostMedia.data.serverUrl).split(':')[0],
    viewerVideo,
    feedVisible:true,
    commentVerified:true,
    likeVerified:true,
    ended:true,
  }));
}finally{
  await viewerRoom?.context?.close().catch(()=>undefined);
  await hostRoom?.context?.close().catch(()=>undefined);
  await browser?.close().catch(()=>undefined);

  if(live?.id&&host?.token){
    await api(`/api/live/${encodeURIComponent(live.id)}/end`,{method:'POST',body:'{}'},host.token).catch(()=>undefined);
  }
  if(host?.token){
    await api('/api/auth/test-account-cleanup',{
      method:'DELETE',
      body:JSON.stringify({guestUserId:viewer?.user?.id||null}),
    },host.token).catch(()=>undefined);
  }
  console.log('BROADCAST_LIVE_SMOKE_CLEANUP',JSON.stringify({
    liveId:live?.id||null,
    hostUserId:host?.user?.id||null,
    viewerUserId:viewer?.user?.id||null,
  }));
}
