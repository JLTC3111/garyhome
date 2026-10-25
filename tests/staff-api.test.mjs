import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as requests from '../lib/requests.ts';

const require=createRequire(import.meta.url),base=path.resolve(import.meta.dirname,'..');
function endpoint(options={}){
 const state={role:'owner',valid:true,existing:'00000000-0000-4000-8000-000000000002',secret:true,members:[],rpc:[],invites:[],resets:[],secretReads:0,tokens:[],...options};
 const user={id:'00000000-0000-4000-8000-000000000001',email:'owner@protonmail.com',email_confirmed_at:'2026-10-01T00:00:00Z',user_metadata:{role:'owner'}};
 const client={auth:{getUser:async token=>({data:{user:state.valid&&token==='valid-token'?user:null},error:null}),resetPasswordForEmail:async(email,options)=>{state.resets.push({email,options});if(state.resetThrow)throw new Error("Network unavailable");return {error:state.resetError||null};}},from(table){
  const q={};for(const name of ['select','eq','abortSignal','single','maybeSingle'])q[name]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve({data:table==='team_members'?(state.role?{role:state.role}:null):{email_domains:['garyhome.com','icue.vn','gmail.com']},error:null}).then(resolve,reject);return q;
 },rpc(name,args){
  const q={abortSignal:()=>q,then(resolve,reject){
   state.rpc.push({name,args});let result={data:null,error:null};
   if(name==='find_staff_account')result=['garyhome.com','icue.vn','gmail.com'].includes(args.target_email.split('@')[1])?{data:state.existing,error:null}:{data:null,error:{code:'23514'}};
   if(name==='assign_staff_account')result=['owner','admin'].includes(state.role)?{data:state.existing||'00000000-0000-4000-8000-000000000002',error:null}:{data:null,error:{code:'42501'}};
   if(name==='set_staff_access')result=state.protected?{data:null,error:{code:'42501'}}:{data:args.target_user_id,error:null};
   if(name==='remove_staff_access')result=state.protected?{data:null,error:{code:'42501'}}:{data:state.unconfirmedDelete?null:true,error:null};
   if(name==='staff_reset_email')result={data:state.resetTarget??state.rpc.findLast(call=>call.name==='assign_staff_account')?.args.target_email??'assigned@gmail.com',error:state.resetTargetError??null};
   if(name==='list_staff_accounts')result={data:state.members,error:null};
   return Promise.resolve(result).then(resolve,reject);
  }};return q;
 }};
 const admin={auth:{admin:{inviteUserByEmail:async(email,options)=>{state.invites.push({email,options});if(state.revokeDuringInvite)state.role=null;return {data:{user:{id:'00000000-0000-4000-8000-000000000002'}},error:state.inviteError?new Error('Delivery unavailable'):null};}}}};
 const server={publicSupabase:token=>{state.tokens.push(token);return client;},staffAdminClient:()=>{state.secretReads++;return state.secret?admin:null;}};
 const modules=new Map();
 function load(file){
  if(file.endsWith('/lib/server.ts'))return server;
  if(modules.has(file))return modules.get(file).exports;
  const loaded={exports:{}};modules.set(file,loaded);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const dependency=id=>{
   if(id==='@/lib/requests')return requests;
   if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(base,id.slice(2)):path.resolve(path.dirname(file),id);return load(target.endsWith('.ts')?target:target+'.ts');}
   return require(id);
  };
  vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})',{filename:file})(loaded.exports,dependency,loaded);return loaded.exports;
 }
 const route=load(path.join(base,'app/api/admin/team/route.ts'));
 async function send(method='POST',value={},headers={}){
  const request=new Request('https://gary.example/api/admin/team',{method,headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(method==='POST'?{email:'staff@garyhome.com',full_name:'Team Staff',role:'editor',...value}:value)})});
  return route[method](request);
 }
 async function sendReset(value={},headers={}){return load(path.join(base,'app/api/admin/team/reset-password/route.ts')).POST(new Request('https://gary.example/api/admin/team/reset-password',{method:'POST',headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},body:JSON.stringify({user_id:'00000000-0000-4000-8000-000000000002',...value})}));}
 return {state,send,sendReset};
}

test('staff creation requires a verified current owner/admin, never user metadata',async()=>{
 for(const options of [{role:null},{role:'editor'},{valid:false}]){
  const h=endpoint(options),response=await h.send();assert.ok([401,403].includes(response.status));
  assert.equal(h.state.invites.length,0);assert.equal(h.state.rpc.length,0);assert.equal(h.state.secretReads,0);
 }
 const h=endpoint();assert.equal((await h.send('POST',{}, {authorization:''})).status,401);assert.equal((await h.send('POST',{}, {origin:'https://evil.invalid'})).status,403);
});
test('unapproved domains are rejected before an account or invitation is created',async()=>{
 const h=endpoint({existing:null});assert.equal((await h.send('POST',{email:'personal@example.invalid'})).status,400);
 assert.equal(h.state.invites.length,0);assert.equal(h.state.secretReads,0);
});
test('administrators cannot use the account API to appoint administrators or owners',async()=>{
 const h=endpoint({role:'admin'});
 assert.equal((await h.send('POST',{role:'admin'})).status,403);assert.equal((await h.send('POST',{role:'owner'})).status,400);
 assert.equal(h.state.invites.length,0);assert.equal(h.state.rpc.length,0);
});
test('an existing account is assigned and receives a fresh password email without an invitation secret',async()=>{
 const h=endpoint({secret:false}),response=await h.send();assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{user_id:h.state.existing,invited:false,email_status:'requested'});assert.equal(h.state.secretReads,0);assert.equal(h.state.invites.length,0);
 assert.deepEqual(h.state.rpc.map(call=>call.name),['find_staff_account','assign_staff_account','staff_reset_email']);assert.deepEqual(h.state.tokens,['valid-token']);
 assert.deepEqual(h.state.resets,[{email:'staff@garyhome.com',options:{redirectTo:'https://gary.example/auth/reset'}}]);
});
test('the second allowed company domain is accepted for an explicitly assigned account',async()=>{
 const h=endpoint({secret:false}),response=await h.send('POST',{email:'colleague@icue.vn'});
 assert.equal(response.status,200);assert.equal(h.state.rpc.findLast(call=>call.name==='assign_staff_account').args.target_email,'colleague@icue.vn');
});
test('a new staff account receives an invitation and is assigned only after Auth succeeds',async()=>{
 const h=endpoint({existing:null}),response=await h.send('POST',{email:'  NEW@GARYHOME.COM  ',role:'admin',actor_role:'owner'});
 assert.equal(response.status,201);assert.equal((await response.json()).invited,true);
 assert.equal(h.state.invites.length,1);assert.equal(h.state.invites[0].email,'new@garyhome.com');
 assert.deepEqual(h.state.invites[0].options,{redirectTo:'https://gary.example/auth/invite',data:{full_name:'Team Staff'}});
 assert.deepEqual(h.state.rpc.map(call=>call.name),['find_staff_account','assign_staff_account']);
});
test('missing invitation configuration and failed delivery never grant staff permissions',async()=>{
 for(const options of [{secret:false},{inviteError:true}]){
  const h=endpoint({existing:null,...options}),response=await h.send();assert.ok([409,503].includes(response.status));
  assert.equal(h.state.rpc.filter(call=>call.name==='assign_staff_account').length,0);
 }
});
test('revoking the actor during a pending invitation prevents the delayed role assignment',async()=>{
 const h=endpoint({existing:null,revokeDuringInvite:true}),response=await h.send();assert.equal(response.status,409);
 assert.match((await response.json()).error,/invitation email was requested, but staff access was not confirmed/);
});
test('staff access changes remain protected by the database and reject role escalation',async()=>{
 const h=endpoint({protected:true});
 assert.equal((await h.send('PATCH',{user_id:'00000000-0000-4000-8000-000000000002',role:'editor',active:false})).status,403);
 assert.equal((await h.send('PATCH',{user_id:'00000000-0000-4000-8000-000000000002',role:'owner',active:true})).status,400);
});
test('the directory paginates and never returns the server key or caches private data',async()=>{
 const members=Array.from({length:51},(_,i)=>({user_id:String(i),email:String(i).padStart(3,'0')+'@garyhome.com'}));
 const h=endpoint({members}),response=await h.send('GET');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const data=await response.json();assert.equal(data.members.length,50);assert.equal(data.next,members[49].email);assert.equal(data.invitationsEnabled,true);
 assert.ok(!('secret'in data));assert.ok(!('key'in data));assert.ok(!('access_token'in data));
});


test('Gmail can be explicitly assigned or invited without granting permissions merely by domain',async()=>{
 for(const existing of ['00000000-0000-4000-8000-000000000002',null]){
  const h=endpoint({existing}),response=await h.send('POST',{email:'New.Colleague@GMAIL.COM'});
  assert.ok([200,201].includes(response.status));assert.equal(h.state.rpc.findLast(call=>call.name==='assign_staff_account').args.target_email,'new.colleague@gmail.com');
  assert.equal(h.state.invites.length,existing?0:1);
 }
});
test('staff deletion uses the protected membership RPC, never Auth account deletion',async()=>{
 const value={user_id:'00000000-0000-4000-8000-000000000002'};
 const h=endpoint(),response=await h.send('DELETE',value);assert.equal(response.status,200);
 assert.deepEqual(h.state.rpc,[{name:'remove_staff_access',args:{target_user_id:value.user_id}}]);assert.equal(h.state.secretReads,0);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 for(const options of [{role:'manager'},{role:null},{valid:false},{protected:true}]){
  const blocked=endpoint(options);assert.ok([401,403].includes((await blocked.send('DELETE',value)).status));assert.equal(blocked.state.secretReads,0);
 }
 const failed=endpoint({unconfirmedDelete:true});assert.equal((await failed.send('DELETE',value)).status,409);
 assert.equal((await h.send('DELETE',{user_id:'not-a-uuid'})).status,400);
});
test('staff reset sends to the database-approved email and a fixed same-origin recovery path',async()=>{
 const h=endpoint({secret:false}),response=await h.sendReset({email:'attacker@elsewhere.invalid',redirectTo:'https://evil.invalid'});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});
 assert.deepEqual(h.state.rpc,[{name:'staff_reset_email',args:{target_user_id:'00000000-0000-4000-8000-000000000002'}}]);
 assert.deepEqual(h.state.resets,[{email:'assigned@gmail.com',options:{redirectTo:'https://gary.example/auth/reset'}}]);
 assert.equal(h.state.secretReads,0);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('staff reset rejects non-admin sessions, protected or inactive targets and invalid origins before sending email',async()=>{
 for(const options of [{role:'editor'},{role:'manager'},{valid:false},{resetTargetError:{code:'42501'}},{resetTargetError:{code:'23514'}}]){
  const h=endpoint(options),response=await h.sendReset();assert.ok([401,403,409].includes(response.status));assert.deepEqual(h.state.resets,[]);
 }
 const h=endpoint();assert.equal((await h.sendReset({}, {origin:'https://evil.invalid'})).status,403);
 assert.equal((await h.sendReset({user_id:'invalid'})).status,400);assert.deepEqual(h.state.resets,[]);
});
test('reset delivery failures are actionable and never report success',async()=>{
 for(const resetError of [{code:'over_email_send_rate_limit',status:429},{code:'unexpected_failure',status:500}]){
  const h=endpoint({resetError}),response=await h.sendReset();assert.equal(response.status,resetError.status===429?429:503);
  const result=await response.json();assert.ok(result.error);assert.equal(result.ok,undefined);assert.equal(h.state.resets.length,1);
 }
});


test('re-adding an existing staff account requests another setup email without creating a duplicate Auth user',async()=>{
 const h=endpoint(),first=await h.send('POST',{email:'staff@gmail.com'}),second=await h.send('POST',{email:'staff@gmail.com'});
 assert.equal(first.status,200);assert.equal(second.status,200);assert.equal((await second.json()).email_status,'requested');
 assert.equal(h.state.invites.length,0);assert.equal(h.state.resets.length,2);assert.ok(h.state.resets.every(r=>r.email==='staff@gmail.com'));
 assert.equal(h.state.secretReads,0);
});
test('assignment success and email failure are reported separately, with no automatic email replay',async()=>{
 for(const resetError of [{code:'email_address_not_authorized',status:403},{code:'over_email_send_rate_limit',status:429},{code:'unexpected_failure',status:500}]){
  const h=endpoint({resetError}),response=await h.send();assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.user_id,h.state.existing);assert.equal(data.email_status,'failed');assert.ok(data.email_error);assert.equal(h.state.resets.length,1);
  if(resetError.code==='email_address_not_authorized')assert.match(data.email_error,/Configure custom SMTP/);
  if(resetError.status===429)assert.match(data.email_error,/sending limit/);
 }
 const uncertain=endpoint({resetThrow:true}),response=await uncertain.send();assert.equal((await response.json()).email_status,'unconfirmed');assert.equal(uncertain.state.resets.length,1);
});
test('a fresh protected lookup stops email after assignment when the actor no longer has permission',async()=>{
 const h=endpoint({resetTargetError:{code:'42501'}}),response=await h.send();const data=await response.json();
 assert.equal(response.status,200);assert.equal(data.email_status,'failed');assert.equal(data.user_id,h.state.existing);assert.equal(h.state.resets.length,0);
});
