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
 let enabled=false,present=true,interrupted=true;
 const calls=[];
 const handler=createMediaCleanup({...configuration,warn:()=>{},fetcher:async(url,init)=>{
  const path=new URL(url).pathname, body=init.body&&JSON.parse(init.body);
  calls.push({path,body,method:init.method});
  if(path.endsWith('_claim'))return Response.json(enabled?{status:'ok',id:run,items:[{id}]}:{status:'disabled'});
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
 assert.equal(calls.length,1);
 enabled=true;
 assert.equal((await invoke(handler,cron)).status,503);
 assert.deepEqual(await (await invoke(handler,cron)).json(),{status:'ok',attempted:1,removed:1,overdue:0});
 assert.equal(calls.filter(call=>call.method==='DELETE').length,1);
});
