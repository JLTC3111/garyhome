import test from 'node:test';
import assert from 'node:assert/strict';
import {publicIntakeHarness} from './helpers/public-intake-harness.mjs';

const userId='10000000-0000-4000-8000-000000000001';
const details={name:'A Customer',email:'customer@example.invalid',consent:true,message:'A property search enquiry.'};
const incoming=(headers={})=>new Request('https://gary.example/api/enquiries',{method:'POST',headers});

test('trusted intake uses only the service RPC and passes verified identity separately from form fields',async()=>{
 const h=publicIntakeHarness({vercel:true}),result=await h.savePublicIntake(incoming({'x-forwarded-for':'192.0.2.20'}),'enquiry',details,userId);
 assert.ok(result.data);assert.equal(h.state.calls.length,1);
 const call=h.state.calls[0];assert.equal(call.name,'submit_public_intake');assert.equal(call.args.channel,'enquiry');assert.equal(call.args.verified_user,userId);assert.deepEqual(call.args.details,details);
 assert.match(call.args.client_key,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(call).includes('192.0.2.20'));
});
test('trusted visitor keys ignore forged platform headers and isolate different visitor addresses',async()=>{
 for(const vercel of [true,false]){
  const h=publicIntakeHarness({vercel}),trusted=vercel?'x-forwarded-for':'cf-connecting-ip',untrusted=vercel?'cf-connecting-ip':'x-forwarded-for';
  await h.savePublicIntake(incoming({[trusted]:'192.0.2.20',[untrusted]:'198.51.100.1'}),'feedback',details,null);
  await h.savePublicIntake(incoming({[trusted]:'192.0.2.20',[untrusted]:'198.51.100.2'}),'feedback',details,userId);
  await h.savePublicIntake(incoming({[trusted]:'192.0.2.21',[untrusted]:'198.51.100.2'}),'feedback',details,null);
  const keys=h.state.calls.map(call=>call.args.client_key);assert.equal(keys[0],keys[1]);assert.notEqual(keys[1],keys[2]);
 }
});
test('independent application instances share the durable quota and cannot reset it by signing in',async()=>{
 const buckets=new Map(),backend={calls:[],respond(args){const key=args.channel+':'+args.client_key,count=buckets.get(key)||0;if(count>=5)return {data:null,error:null};buckets.set(key,count+1);return {data:'90000000-0000-4000-8000-000000000001',error:null};}};
 const request=incoming({'x-forwarded-for':'192.0.2.20'});
 for(let i=0;i<5;i++)assert.ok((await publicIntakeHarness({vercel:true,backend}).savePublicIntake(request,'feedback',details,i%2?userId:null)).data);
 assert.equal((await publicIntakeHarness({vercel:true,backend}).savePublicIntake(request,'feedback',details,userId)).data,null);
 assert.ok((await publicIntakeHarness({vercel:true,backend}).savePublicIntake(request,'assistance',details,null)).data);
 assert.equal(backend.calls.length,7);
});
test('missing service configuration, SQL rejection and transport failure never replay an intake write',async()=>{
 const missing=publicIntakeHarness({backend:{calls:[],unavailable:true}}),result=await missing.savePublicIntake(incoming(),'enquiry',details,null);
 assert.equal(result.data,null);assert.equal(result.error.code,'UNAVAILABLE');assert.equal(missing.state.calls.length,0);
 const denied=publicIntakeHarness({backend:{calls:[],data:null,error:{code:'42501'}}});assert.equal((await denied.savePublicIntake(incoming(),'enquiry',details,null)).error.code,'42501');assert.equal(denied.state.calls.length,1);
 const failed=publicIntakeHarness({backend:{calls:[],throwError:new Error('Uncertain outcome')}});await assert.rejects(failed.savePublicIntake(incoming(),'enquiry',details,null),/Uncertain outcome/);assert.equal(failed.state.calls.length,1);
});
