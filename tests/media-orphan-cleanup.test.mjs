import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaCleanup} from '../supabase/functions/media-orphan-cleanup/worker.mjs';

const owner='00000000-0000-4000-8000-000000000001', run='00000000-0000-4000-8000-000000000002';
const id='00000000-0000-4000-8000-000000000003', key='properties/fixture.webp';
const configuration={url:'https://project.example',publishable:'public-fixture',service:'internal-fixture',cronSecret:'cron-fixture'};
const invoke=(handler,headers,action='run')=>handler(new Request('https://edge.example/cleanup',{
 method:'POST',headers,body:JSON.stringify({action}),
}));
const cron={'x-gary-home-cleanup':configuration.cronSecret};

test('direct requests cannot select the service path without the dedicated scheduler credential',async()=>{
 const calls=[];
 const handler=createMediaCleanup({...configuration,fetcher:async(url,init)=>{
  calls.push({url,authorization:init.headers.Authorization});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:owner});
  return Response.json({message:'photo_rename.forbidden'},{status:403});
 }});
 assert.equal((await invoke(handler,{'x-gary-home-cleanup':'wrong',Authorization:'Bearer user-fixture'})).status,403);
 assert.equal((await invoke(handler,cron,'scan')).status,403);
 assert.equal((await invoke(handler,{})).status,401);
 assert.deepEqual(calls,[]);
 assert.equal((await invoke(handler,{Authorization:'Bearer staff-fixture'})).status,403);
 assert.deepEqual(calls.map(call=>call.authorization),['Bearer staff-fixture','Bearer staff-fixture']);
});

test('scheduled removal is gated, validates the target, and reconciles an interrupted acknowledgement without another delete',async()=>{
 let enabled=false,present=true,interrupted=true,verificationTimeout=false;
 const calls=[];
 const handler=createMediaCleanup({...configuration,warn:()=>{},fetcher:async(url,init)=>{
  const path=new URL(url).pathname, body=init.body&&JSON.parse(init.body);
  calls.push({path,body,method:init.method});
  if(path.endsWith('_claim'))return Response.json(enabled?{status:'ok',id:run,items:[{id}]}:{status:'disabled'});
  if(path.endsWith('_observe_hourly'))return verificationTimeout?Response.json({code:'57014'},{status:500}):Response.json({status:'complete'});
  if(path.endsWith('_target')) {
   assert.equal(body.p_replacement_verified,true);
   return Response.json({bucket:'property-media',name:key,present});
  }
  if(path.endsWith('/object/property-media')) {
   assert.equal(init.method,'DELETE');
   assert.deepEqual(body,{prefixes:[key]});
   present=false;
   return Response.json([{name:key}]);
  }
  if(path.endsWith('_settle')) {
   assert.equal(body.p_ok,true);
   if(interrupted){interrupted=false;throw new Error('Fixture interruption after Storage removal');}
   return Response.json(!present);
  }
  if(path.endsWith('_finish'))return Response.json(0);
  throw new Error('Unexpected request');
 }});
 assert.equal((await (await invoke(handler,cron)).json()).status,'disabled');
 assert.deepEqual(calls.map(call=>call.path.split('/').at(-1)),['home_media_claim','home_media_observe_hourly']);
 enabled=true;
 assert.equal((await invoke(handler,cron)).status,503);
 assert.match(calls.at(-1).path,/_observe_hourly$/,'cleanup failure still permits observation');
 verificationTimeout=true;
 assert.deepEqual(await (await invoke(handler,cron)).json(),{status:'ok',attempted:1,removed:1,overdue:0,
  observation:{status:'failed',error:'observation_timeout'}});
 assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('the scheduler caps the number of pending observation batches per run',async()=>{
 const calls=[];
 const handler=createMediaCleanup({...configuration,fetcher:async (url,init)=>{
  const action=new URL(url).pathname.split('/').at(-1);calls.push(action);
  if(action==='home_media_claim')return Response.json({status:'disabled'});
  assert.equal(action,calls.length===2?'home_media_observe_hourly':'home_media_observe_hourly_step');
  assert.deepEqual(JSON.parse(init.body),calls.length===2?{}:{p_cycle:8,p_checked:32*(calls.length-2)});
  return Response.json({status:'running',cycle:8,checked:32*(calls.length-1)});
 }});
 assert.deepEqual(await (await invoke(handler,cron)).json(),{status:'disabled',observation:{status:'running',cycle:8,checked:1024}});
 assert.deepEqual(calls,['home_media_claim','home_media_observe_hourly',...Array(31).fill('home_media_observe_hourly_step')]);
});

test('the scheduler ends its continuation when the Owner has completed the cycle',async()=>{
 const calls=[];
 const handler=createMediaCleanup({...configuration,fetcher:async url=>{
  const action=new URL(url).pathname.split('/').at(-1);calls.push(action);
  if(action==='home_media_claim')return Response.json({status:'disabled'});
  if(action==='home_media_observe_hourly')return Response.json({status:'running',cycle:2,checked:32});
  return Response.json({status:'complete',cycle:2,checked:64});
 }});
 assert.equal((await (await invoke(handler,cron)).json()).observation.status,'complete');
 assert.deepEqual(calls,['home_media_claim','home_media_observe_hourly','home_media_observe_hourly_step']);
});

test('worker health checks require a verified Owner and never claim a cleanup run',async()=>{
 const calls=[];
 const handler=createMediaCleanup({...configuration,fetcher:async (url,init)=>{
  const path=new URL(url).pathname;calls.push(path);
  if(path==='/auth/v1/user')return Response.json({id:owner});
  assert.match(path,/_management$/);assert.deepEqual(JSON.parse(init.body),{p_action:'authorize'});
  return init.headers.Authorization==='Bearer owner-fixture'?Response.json({actor:owner}):Response.json({}, {status:403});
 }});
 assert.equal((await invoke(handler,cron,'health')).status,403);
 assert.equal((await invoke(handler,{Authorization:'Bearer staff-fixture'},'health')).status,403);
 assert.deepEqual(await (await invoke(handler,{Authorization:'Bearer owner-fixture'},'health')).json(),{status:'ok',cronConfigured:true,manualUnused:true});
 assert.equal(calls.length,4);
});

test('Owner unused-media removal uses a separate claim and honours the final target check',async()=>{
 const expiresAt='2099-11-26T12:00:00.000Z',video='staff/listing/fixture.mp4',calls=[];
 let protectedNow=true;
 const handler=createMediaCleanup({...configuration,warn:()=>{},fetcher:async(url,init)=>{
  const path=new URL(url).pathname,args=init.body&&JSON.parse(init.body);
  calls.push({path,method:init.method});
  if(path.endsWith('/auth/v1/user'))return Response.json({id:owner});
  if(path.endsWith('_management'))return Response.json({actor:owner});
  if(path.endsWith('_claim_unused')){
   assert.deepEqual(args,{p_actor:owner,p_item:id,p_expiry:expiresAt});
   return Response.json({status:'ok',id:run,items:[{id}]});
  }
  if(path.endsWith('_target'))return Response.json(protectedNow?null:{bucket:'listing-videos',name:video,present:true});
  if(path.endsWith('/object/listing-videos')){
   assert.equal(init.method,'DELETE');assert.deepEqual(args,{prefixes:[video]});
   return Response.json([{name:video}]);
  }
  if(path.endsWith('_settle'))return Response.json(true);
  if(path.endsWith('_finish'))return Response.json(0);
  throw new Error('Unexpected request');
 }});
 const request=headers=>handler(new Request('https://edge.example/cleanup',{
  method:'POST',headers,body:JSON.stringify({action:'purge_unused',id,expiresAt,confirm:true}),
 }));
 assert.equal((await request(cron)).status,403);
 assert.deepEqual(calls,[]);
 const signed={Authorization:'Bearer owner-fixture'};
 assert.equal((await request(signed)).status,409);
 assert.equal(calls.some(call=>call.method==='DELETE'),false);
 protectedNow=false;
 assert.equal((await (await request(signed)).json()).removed,1);
 assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});

test('early purge requires an explicit exact-item confirmation from a signed Owner',async()=>{
 const expiresAt='2099-11-26T12:00:00.000Z';
 const calls=[];
 const handler=createMediaCleanup({...configuration,warn:()=>{},fetcher:async(url,init)=>{
  const path=new URL(url).pathname;
  const args=init.body&&JSON.parse(init.body);
  calls.push({path,args});
  if(path.endsWith('/auth/v1/user'))return Response.json({id:owner});
  if(path.endsWith('_management'))return Response.json({actor:owner});
  if(path.endsWith('_claim'))return Response.json({status:'ok',id:run,items:[{id}]});
  if(path.endsWith('_target'))return Response.json({bucket:'property-media',name:key,present:true});
  if(path.endsWith('/object/property-media'))return Response.json([{name:key}]);
  if(path.endsWith('_settle'))return Response.json(true);
  if(path.endsWith('_finish'))return Response.json(0);
  throw new Error('Unexpected request');
 }});
 const request=(headers,confirm)=>handler(new Request('https://edge.example/cleanup',{
  method:'POST',headers,body:JSON.stringify({action:'purge',id,expiresAt,confirm}),
 }));
 const signed={Authorization:'Bearer owner-fixture'};
 assert.equal((await request(signed,false)).status,400);
 assert.equal((await request(cron,true)).status,403);
 assert.deepEqual(calls,[]);
 assert.equal((await (await request(signed,true)).json()).removed,1);
 assert.deepEqual(calls.find(call=>call.path.endsWith('_claim')).args,{p_actor:owner,p_item:id,p_expiry:expiresAt});
});
