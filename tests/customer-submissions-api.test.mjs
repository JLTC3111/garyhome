import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {createRequire} from 'node:module';
import { readJsonBody, BodyReadError } from '../lib/request-body.ts';
const require=createRequire(import.meta.url);
function endpoint(valid=true){
 const records=[];const verified=[];const client={auth:{getUser:async token=>{verified.push(token);return {data:{user:valid?{id:'verified'}:null},error:valid?null:Error()};}},from:table=>({insert:async record=>{records.push({table,record});return {error:null};}})};
 function load(file){const m={exports:{}};const source=ts.transpileModule(fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInThisContext('(function(exports,require,module,process){'+source+'\n})')(m.exports,id=>id==='./request-body'?{readJsonBody,BodyReadError}:id==='./server'?{publicSupabase:()=>client}:id==='./submissions'?load('submissions.ts'):require(id),m,{env:{VERCEL:'1'}});return m.exports;}
 const {submitCustomerInput}=load('submission-server.ts');
 const send=(kind,fields={},headers={})=>submitCustomerInput(new Request('https://gary.example/api/'+kind,{method:'POST',headers:{'content-type':'application/json',origin:'https://gary.example','x-forwarded-for':'192.0.2.1',...headers},body:JSON.stringify({name:'A Customer',email:'customer@example.invalid',consent:true,...(kind==='feedback'?{rating:4,message:'A helpful property search.'}:{property_id:'c6e53881-53a0-45cf-bdce-7fe020b0a610',helper_name:'A Helper',channel:'zalo',helped_where:'Zalo conversation',helped_on:'2026-01-12'}),...fields})}),kind);
 return {send,records,verified};
}
test('both submission endpoints strip forged identity and workflow fields',async()=>{
 for(const kind of ['feedback','assistance']){const {send,records}=endpoint();assert.equal((await send(kind,{user_id:'someone-else',status:'verified',reviewed_by:'forged',credited_staff_id:'forged',internal_notes:'forged'})).status,201);assert.equal(records[0].table,kind==='feedback'?'feedback_submissions':'property_assistance');for(const field of ['user_id','status','reviewed_by','credited_staff_id','internal_notes','website'])assert.ok(!(field in records[0].record));}
});
test('submission validation rejects absent consent, invalid dates, unknown channels and honeypot content',async()=>{
 const {send,records}=endpoint();for(const fields of [{rating:0},{rating:6},{message:'short'},{consent:false},{website:'spam'}])assert.equal((await send('feedback',fields)).status,400);
 for(const fields of [{helped_on:'2026-02-30'},{helped_on:'2999-01-01'},{channel:'unknown'},{helped_time:'27:00'},{helper_name:''},{helped_where:''}])assert.equal((await send('assistance',fields)).status,400);assert.equal(records.length,0);
});
test('bearer sessions are verified and invalid sessions do not become guest submissions',async()=>{
 let e=endpoint();assert.equal((await e.send('feedback',{}, {authorization:'Bearer customer-token'})).status,201);assert.deepEqual(e.verified,['customer-token']);e=endpoint(false);assert.equal((await e.send('assistance',{}, {authorization:'Bearer expired-token'})).status,401);assert.equal(e.records.length,0);
});
test('cross-origin, malformed credentials and oversized submissions are rejected',async()=>{
 const {send,records}=endpoint();assert.equal((await send('feedback',{}, {origin:'https://other.example'})).status,403);assert.equal((await send('feedback',{}, {authorization:'Basic token'})).status,401);assert.equal((await send('feedback',{}, {'content-length':'20000'})).status,413);assert.equal(records.length,0);
});
test('abuse limits use the platform-owned visitor header independently for each submission type',async()=>{
 const {send}=endpoint();for(let i=0;i<5;i++)assert.equal((await send('feedback',{}, {'cf-connecting-ip':'198.51.100.'+i})).status,201);assert.equal((await send('feedback')).status,429);assert.equal((await send('feedback',{}, {'x-forwarded-for':'192.0.2.2'})).status,201);assert.equal((await send('assistance')).status,201);
});
