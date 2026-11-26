import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStorageMedia} from '../lib/home-media-request.ts';

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
 assert.deepEqual(calls.map(c=>c.args.p_action),actions);
 assert.equal(calls[0].args.p_id,null);
 assert.equal(calls.at(-1).args.p_id,'test-id');
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
 const res=await executeStorageMedia(db('unknown'),{action:'run'},signal,async()=>new Response('Provider details',{status:404}));
 assert.deepEqual(res,{status:503,data:{error:'cleanup_worker_missing'}});
 const missing=await executeStorageMedia(db('unknown'),{action:'worker_status'},signal,async()=>new Response('Provider details',{status:404}));
 assert.deepEqual(missing,{status:503,data:{error:'cleanup_worker_missing'}});
});
