import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStorageMedia} from '../lib/home-media-request.ts';
import {verifyObservationCycle} from '../lib/home-media-observation.ts';

const signal=new AbortController().signal;

test('Home storage inventory, scan, soft staging and restore work independently of the Edge worker',async()=>{
 const calls=[];
 const report={objects:4,bytes:120,candidates:1,enabled:false,items:[],runs:[]};
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async supplied=>{
   assert.equal(supplied,signal);return {data:report};
 }};}};
 const unavailable=()=>assert.fail('Non-destructive actions must not call the worker');
 const actions=['overview','inventory_scan','inventory_page','trash_page','removed_page','run_page','trash','restore'];
 for (const action of actions) {
  const result=await executeStorageMedia(db,{action,id:'test-id',offset:30},signal,unavailable);
  assert.deepEqual(result,{status:200,data:report});
 }
 assert.deepEqual(calls.map(c=>c.name==="home_media_inventory_files"?"inventory_page":c.args.p_action),actions);
 assert.deepEqual(calls[0],{name:'home_media_dashboard',args:{p_action:'overview',p_offset:30}});
 assert.deepEqual(calls[2],{name:'home_media_inventory_files',args:{p_offset:30,p_query:''}});
 assert.equal(calls.at(-1).args.p_id,'test-id');
});

test('Inventory Files only falls back to the old scan page when the live inventory RPC is missing',async()=>{
 const calls=[];
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>name==='home_media_inventory_files'?
  {error:{code:'PGRST202'}}:{data:{items:[],available:false}}};}};
 const result=await executeStorageMedia(db,{action:'inventory_page',query:'GH-601',offset:30},signal,()=>assert.fail('Read cannot dispatch worker'));
 assert.equal(result.status,200);
 assert.deepEqual(calls,[{name:'home_media_inventory_files',args:{p_offset:30,p_query:'GH-601'}},
  {name:'home_media_management',args:{p_action:'inventory_page',p_id:null,p_offset:30}}]);
});

test('Inventory Files returns a query timeout as an error with no empty-page fallback',async()=>{
 const calls=[];
 const db={rpc(name){calls.push(name);return {abortSignal:async()=>({error:{code:'57014'}})};}};
 const result=await executeStorageMedia(db,{action:'inventory_page',offset:30},signal,()=>assert.fail('Read cannot dispatch worker'));
 assert.deepEqual(result,{status:504,data:{error:'inventory_timeout'}});
 assert.deepEqual(calls,['home_media_inventory_files']);
});

test('Owner verification reads and writes only the observation RPC and reports its timeout',async()=>{
 const calls=[];
 const progress={status:'complete',checked:4,recorded:1};
 const db={rpc(name,args){calls.push([name,args]);return {abortSignal:async supplied=>{
  assert.equal(supplied,signal);return calls.length<3?{data:progress}:{error:{code:'57014'}};
 }};}};
 const noWorker=()=>assert.fail('Observation cannot dispatch the deletion worker');
 const step={action:'verify_unused',cycle:2,checked:32,start:false};
 assert.deepEqual(await executeStorageMedia(db,{action:'observation_status'},signal,noWorker),{status:200,data:progress});
 assert.deepEqual(await executeStorageMedia(db,{action:'verify_unused'},signal,noWorker),{status:400,data:{error:'invalid_request'}});
 assert.deepEqual(await executeStorageMedia(db,step,signal,noWorker),{status:200,data:progress});
 assert.deepEqual(await executeStorageMedia(db,step,signal,noWorker),{status:504,data:{error:'observation_timeout'}});
 assert.deepEqual(calls,[['home_media_observation',{p_verify:false}],
  ...Array(2).fill(['home_media_observation_step',{p_cycle:2,p_checked:32,p_start:false}])]);
});

test('Retry resumes the same cycle after a failed batch and reconciles an uncommitted timeout before sending again',async()=>{
 const calls=[];
 let progress={status:'running',cycle:3,checked:32,total:64,recorded:0,reset:0,lastSuccessfulAt:null,error:null};
 let mode='failed';
 const request=async step=>{
  calls.push(step??'read');
  if(!step)return progress;
  assert.deepEqual(step,{cycle:3,checked:32,start:false});
  if(mode==='failed')return progress={...progress,status:'failed',error:'observation_failed'};
  if(mode==='timeout'){mode='complete';throw new Error('observation_timeout');}
  return progress={...progress,status:'complete',checked:64,error:null,lastSuccessfulAt:new Date().toISOString()};
 };
 const options={request,publish:()=>{},wait:async()=>{calls.push('wait');},signal};
 await assert.rejects(verifyObservationCycle(3,options),/observation_failed/);
 mode='timeout';
 assert.equal(await verifyObservationCycle(3,options),'complete');
 assert.deepEqual(calls.map(call=>typeof call==='string'?call:'step'),['read','step','read','read','step','read','wait','step']);
});

test('database and worker failures have separate actionable codes without provider details',async()=>{
 const unavailable=()=>assert.fail('Inventory must not call a worker');
 const db=code=>({rpc(){return {abortSignal:async()=>({error:{code,message:'Private fixture details'}})};}});
 assert.equal((await executeStorageMedia(db('PGRST202'),{action:'status'},signal,unavailable)).data.error,'inventory_rpc_missing');
 assert.equal((await executeStorageMedia(db('42501'),{action:'scan'},signal,unavailable)).status,403);
 assert.equal((await executeStorageMedia(db('unknown'),{action:'scan'},signal,unavailable)).data.error,'inventory_unavailable');
 assert.deepEqual(await executeStorageMedia(db('57014'),{action:'inventory_scan'},signal,unavailable),{status:504,data:{error:'inventory_timeout'}});
 const old={rpc(){return {abortSignal:async()=>({error:{code:'22023',message:'listing_cleanup.invalid_manifest'}})};}};
 assert.deepEqual(await executeStorageMedia(old,{action:'overview'},signal,unavailable),{status:503,data:{error:'inventory_panel_upgrade'}});
 const ready={rpc(){return {abortSignal:async()=>({data:{crossAppProtection:true}})};}};
 const res=await executeStorageMedia(ready,{action:'run'},signal,async()=>new Response('Provider details',{status:404}));
 assert.deepEqual(res,{status:503,data:{error:'cleanup_worker_missing'}});
 const missing=await executeStorageMedia(db('unknown'),{action:'worker_status'},signal,async()=>new Response('Provider details',{status:404}));
 assert.deepEqual(missing,{status:503,data:{error:'cleanup_worker_missing'}});
});

test('permanent requests require authenticated cross-application readiness before calling the worker',async()=>{
 const unavailable=()=>assert.fail('No permanent operation should reach the worker');
 const db=code=>({rpc(name,args){
   assert.equal(name,'home_media_dashboard');assert.equal(args.p_action,'readiness');
   return {abortSignal:async()=>({error:{code}})};
 }});
 assert.deepEqual(await executeStorageMedia(db('PGRST202'),{action:'purge'},signal,unavailable),
   {status:503,data:{error:'cross_app_protection_required'}});
 assert.equal((await executeStorageMedia(db('42501'),{action:'run'},signal,unavailable)).status,403);
 assert.equal((await executeStorageMedia(db('57014'),{action:'purge'},signal,unavailable)).data.error,'cross_app_protection_unconfirmed');
 const legacy={rpc(name){return {abortSignal:async()=>name==='home_media_dashboard'?{error:{code:'PGRST202'}}:{data:{objects:3}}};}};
 assert.deepEqual(await executeStorageMedia(legacy,{action:'overview'},signal,unavailable),{status:200,data:{objects:3}});
});

test('bulk manifest and exact receipt use the Owner-only read routes',async()=>{
 const calls=[];
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:{items:[]}})};}};
 const worker=()=>assert.fail('Selection and receipt reads cannot run cleanup');
 await executeStorageMedia(db,{action:'trash_manifest',offset:150},signal,worker);
 await executeStorageMedia(db,{action:'trash_receipt',id:'selected-id',expiresAt:'saved expiry'},signal,worker);
 assert.deepEqual(calls,[
  {name:'home_media_dashboard',args:{p_action:'trash_manifest',p_offset:0}},
  {name:'home_media_trash_receipt',args:{p_id:'selected-id',p_expiry:'saved expiry'}},
 ]);
 const denied={rpc(){return {abortSignal:async()=>({error:{code:'42501'}})};}};
 assert.equal((await executeStorageMedia(denied,{action:'trash_manifest'},signal,worker)).status,403);
});

test('Owner orphan actions use the guarded review RPC and report missing review setup separately',async()=>{
 const calls=[];
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:{result:'fixture'}})};}};
 const worker=()=>assert.fail('Orphan review must stay on the authenticated database path');
 for(const operation of ['page','verify','hold','release','enroll']){
  const input={action:'orphan_'+operation,objectId:'fixture',offset:30};
  assert.equal((await executeStorageMedia(db,input,signal,worker)).status,200);
  assert.deepEqual(calls.at(-1),{name:'home_media_review',args:{p_action:operation,p_payload:input}});
 }
 const missing={rpc(){return {abortSignal:async()=>({error:{code:'PGRST202',message:'discarded provider detail'}})};}};
 assert.deepEqual(await executeStorageMedia(missing,{action:'orphan_page'},signal,worker),{status:503,data:{error:'orphan_review_setup'}});
});

test('retention preview reads an Owner page without calling the cleanup worker',async()=>{
 const db={rpc(name,args){
  assert.equal(name,'home_media_retention_preview');
  assert.deepEqual(args,{p_offset:30,p_query:'GH-645'});
  return {abortSignal:async supplied=>{assert.equal(supplied,signal);return {data:{items:[],automatic:false}};}};
 }};
 const worker=()=>assert.fail('Retention preview must stay on the read-only database path');
 assert.deepEqual(await executeStorageMedia(db,{action:'retention_page',query:'GH-645',offset:30},signal,worker),
  {status:200,data:{items:[],automatic:false}});
 const missing={rpc(){return {abortSignal:async()=>({error:{code:'PGRST202'}})};}};
 assert.deepEqual(await executeStorageMedia(missing,{action:'retention_page'},signal,worker),{status:503,data:{error:'retention_setup'}});
});

test('unused-media manifests and receipts use their own Owner reads',async()=>{
 const calls=[];
 const db={rpc(name,args){calls.push({name,args});return {abortSignal:async()=>({data:{status:'eligible'}})};}};
 const noWorker=()=>assert.fail('Eligibility and receipts are read-only');
 await executeStorageMedia(db,{action:'retention_manifest',query:'GH-645'},signal,noWorker);
 await executeStorageMedia(db,{action:'retention_receipt',id:'id',expiresAt:'expiry'},signal,noWorker);
 assert.deepEqual(calls,[
  {name:'home_media_retention_manifest',args:{p_query:'GH-645'}},
  {name:'home_media_unused_receipt',args:{p_id:'id',p_expiry:'expiry'}},
 ]);
 const denied={rpc(){return {abortSignal:async()=>({error:{code:'42501'}})};}};
 assert.equal((await executeStorageMedia(denied,{action:'purge_unused'},signal,noWorker)).status,403);
});
