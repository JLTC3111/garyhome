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
 const state={role:'owner',valid:true,existing:'00000000-0000-4000-8000-000000000002',secret:true,members:[],rpc:[],invites:[],secretReads:0,tokens:[],...options};
 const user={id:'00000000-0000-4000-8000-000000000001',email:'owner@protonmail.com',email_confirmed_at:'2026-10-01T00:00:00Z',user_metadata:{role:'owner'}};
 const client={auth:{getUser:async token=>({data:{user:state.valid&&token==='valid-token'?user:null},error:null})},from(table){
  const q={};for(const name of ['select','eq','abortSignal','single','maybeSingle'])q[name]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve({data:table==='team_members'?(state.role?{role:state.role}:null):{email_domains:['garyhome.com','icue.vn']},error:null}).then(resolve,reject);return q;
 },rpc(name,args){
  const q={abortSignal:()=>q,then(resolve,reject){
   state.rpc.push({name,args});let result={data:null,error:null};
   if(name==='find_staff_account')result=['garyhome.com','icue.vn'].includes(args.target_email.split('@')[1])?{data:state.existing,error:null}:{data:null,error:{code:'23514'}};
   if(name==='assign_staff_account')result=['owner','admin'].includes(state.role)?{data:state.existing||'00000000-0000-4000-8000-000000000002',error:null}:{data:null,error:{code:'42501'}};
   if(name==='set_staff_access')result=state.protected?{data:null,error:{code:'42501'}}:{data:args.target_user_id,error:null};
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
 return {state,send};
}

test('staff creation requires a verified current owner/admin, never user metadata',async()=>{
 for(const options of [{role:null},{role:'editor'},{valid:false}]){
  const h=endpoint(options),response=await h.send();assert.ok([401,403].includes(response.status));
  assert.equal(h.state.invites.length,0);assert.equal(h.state.rpc.length,0);assert.equal(h.state.secretReads,0);
 }
 const h=endpoint();assert.equal((await h.send('POST',{}, {authorization:''})).status,401);assert.equal((await h.send('POST',{}, {origin:'https://evil.invalid'})).status,403);
});
test('company-domain validation happens before an account or invitation is created',async()=>{
 const h=endpoint({existing:null});assert.equal((await h.send('POST',{email:'personal@gmail.com'})).status,400);
 assert.equal(h.state.invites.length,0);assert.equal(h.state.secretReads,0);
});
test('administrators cannot use the account API to appoint administrators or owners',async()=>{
 const h=endpoint({role:'admin'});
 assert.equal((await h.send('POST',{role:'admin'})).status,403);assert.equal((await h.send('POST',{role:'owner'})).status,400);
 assert.equal(h.state.invites.length,0);assert.equal(h.state.rpc.length,0);
});
test('an existing company account can be assigned without a server secret or email',async()=>{
 const h=endpoint({secret:false}),response=await h.send();assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{user_id:h.state.existing,invited:false});assert.equal(h.state.secretReads,0);assert.equal(h.state.invites.length,0);
 assert.deepEqual(h.state.rpc.map(call=>call.name),['find_staff_account','assign_staff_account']);assert.deepEqual(h.state.tokens,['valid-token']);
});
test('the second allowed company domain is accepted for an explicitly assigned account',async()=>{
 const h=endpoint({secret:false}),response=await h.send('POST',{email:'colleague@icue.vn'});
 assert.equal(response.status,200);assert.equal(h.state.rpc.at(-1).args.target_email,'colleague@icue.vn');
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
 assert.match((await response.json()).error,/invitation was sent, but staff access was not confirmed/);
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
