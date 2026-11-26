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
 for (const action of ['status','scan','trash','restore']) {
  const result=await executeStorageMedia(db,{action,id:'test-id',offset:30},signal,unavailable);
  assert.deepEqual(result,{status:200,data:report});
 }
 assert.deepEqual(calls.map(c=>c.args.p_action),['status','scan','trash','restore']);
 assert.equal(calls[0].args.p_id,null);
 assert.equal(calls.at(-1).args.p_id,'test-id');
});

test('database and worker failures have separate actionable codes without provider details',async()=>{
 const unavailable=()=>assert.fail('Inventory must not call a worker');
 const db=code=>({rpc(){return {abortSignal:async()=>({error:{code,message:'Private fixture details'}})};}});
 assert.equal((await executeStorageMedia(db('PGRST202'),{action:'status'},signal,unavailable)).data.error,'inventory_rpc_missing');
 assert.equal((await executeStorageMedia(db('42501'),{action:'scan'},signal,unavailable)).status,403);
 assert.equal((await executeStorageMedia(db('unknown'),{action:'scan'},signal,unavailable)).data.error,'inventory_unavailable');
 const res=await executeStorageMedia(db('unknown'),{action:'run'},signal,async()=>new Response('Provider details',{status:404}));
 assert.deepEqual(res,{status:503,data:{error:'cleanup_worker_missing'}});
});
