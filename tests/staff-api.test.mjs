import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
import ts from 'typescript';import * as requests from '../lib/requests.ts';
const require=createRequire(import.meta.url),base=path.resolve(import.meta.dirname,'..');
const owner='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002',password='A private temporary password';
const rank=role=>({owner:4,admin:3,manager:2,editor:1}[role]||0);
function endpoint(options={}){
 const state={role:'owner',valid:true,existing:null,secret:true,members:[],profiles:[],rpc:[],creates:[],invites:[],confirms:[],resets:[],reads:[],trace:[],storedPassword:'Existing private password',secretReads:0,...options};
 const user={id:owner,email:'owner@protonmail.com',email_confirmed_at:'2026-10-01',user_metadata:{role:'owner'}};
 const client={auth:{getUser:async token=>({data:{user:state.valid&&token==='valid-token'?user:null},error:null}),resetPasswordForEmail:async(email,options)=>{state.resets.push({email,options});return {error:state.resetError||null};}},from(table){
  const q={};for(const name of ['select','eq','in','abortSignal','single','maybeSingle'])q[name]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve({data:table==='team_members'?(state.role?{role:state.role}:null):table==='staff_profiles'?state.profiles:{email_domains:['garyhome.com','icue.vn','gmail.com']},error:null}).then(resolve,reject);return q;
 },rpc(name,args){const q={abortSignal:()=>q,then(resolve,reject){
  state.rpc.push({name,args});state.trace.push(name);let value={data:null,error:null};
  if(name==='find_staff_account')value=state.protected?{data:null,error:{code:'42501'}}:['garyhome.com','icue.vn','gmail.com'].includes(args.target_email.split('@')[1])?{data:state.existing,error:null}:{data:null,error:{code:'23514'}};
  if(name==='assign_staff_account'){
   value=rank(state.role)<=rank(args.assigned_role)?{data:null,error:{code:'42501'}}
    :state.pendingAccount?{data:null,error:{code:'23514',message:'The existing login must confirm its email before staff access can be assigned'}}
    :{data:state.existing||target,error:null};
  }
  if(name==='set_staff_access')value=state.protected?{data:null,error:{code:'42501'}}:{data:args.target_user_id,error:null};
  if(name==='remove_staff_access')value=state.protected||!['owner','admin'].includes(state.role)?{data:null,error:{code:'42501'}}:{data:state.unconfirmedDelete?null:true,error:null};
  if(name==='staff_temporary_password_request')value={data:state.resetTarget||'assigned@gmail.com',error:state.passwordTargetError||(!['owner','admin','manager'].includes(state.role)?{code:'42501'}:null)};
  if(name==='staff_reset_email')value={data:state.resetTarget||'assigned@gmail.com',error:state.resetTargetError||null};
  if(name==='list_staff_accounts')value={data:state.members,error:null};
  return Promise.resolve(value).then(resolve,reject);
 }};return q;}};
 const admin={auth:{admin:{inviteUserByEmail:async(email,options)=>{
  state.invites.push({email,options});
  if(state.createError)return {data:{user:null},error:{code:state.createErrorCode||'unexpected_failure'}};
  if(state.revokeDuringCreate)state.role=null;
  return {data:{user:{id:target,email}},error:null};
 },createUser:async input=>{state.creates.push(input);if(state.createError)return {data:{user:null},error:state.createErrorCode?{code:state.createErrorCode}:new Error('Auth creation failed')};state.existing=target;if(state.revokeDuringCreate)state.role=null;return {data:{user:{id:target}},error:null};},getUserById:async id=>{state.reads.push(id);state.trace.push('getUserById');return {data:{user:{id:state.mismatchedLookupId||id,email:state.existingEmail||'staff@gmail.com',email_confirmed_at:state.pendingAccount?null:'2026-10-01'}},error:state.lookupError?new Error('Unavailable'):null};},updateUserById:async(id,input)=>{state.confirms.push({id,input});state.trace.push('updateUserById');const error=state.confirmError||state.passwordConfirmError&&input.password?new Error('Unconfirmed'):null;if(!error){if(input.password)state.storedPassword=input.password;if(input.email_confirm)state.pendingAccount=false;if(state.revokeDuringPassword)state.role=null;}return {data:{user:{id:state.mismatchedAuthId||id,email:state.existingEmail||(state.reads.length?'staff@gmail.com':state.resetTarget||'assigned@gmail.com'),email_confirmed_at:state.unconfirmedAuth?null:'2026-10-01'}},error};}}}};
 const server={publicSupabase:()=>client,staffAdminClient:()=>{state.secretReads++;return state.secret?admin:null;}};
 const modules=new Map();function load(file){if(file.endsWith('/lib/server.ts'))return server;if(modules.has(file))return modules.get(file).exports;const result={exports:{}};modules.set(file,result);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const dependency=id=>{if(id==='@/lib/requests')return requests;if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(base,id.slice(2)):path.resolve(path.dirname(file),id);return load(target.endsWith('.ts')?target:target+'.ts');}return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(result.exports,dependency,result);return result.exports;
 }
 async function send(method='POST',value={},headers={}){return load(path.join(base,'app/api/admin/team/route.ts'))[method](new Request('https://gary.example/api/admin/team',{method,headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(method==='POST'?{email:'staff@gmail.com',full_name:'Team Staff',role:'editor',mode:'create',...value}:value)})}));}
 async function sendReset(value={},headers={}){return load(path.join(base,'app/api/admin/team/reset-password/route.ts')).POST(new Request('https://gary.example/api/admin/team/reset-password',{method:'POST',headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},body:JSON.stringify({user_id:target,...value})}));}
 async function sendPassword(value={},headers={}){return load(path.join(base,'app/api/admin/team/set-password/route.ts')).POST(new Request('https://gary.example/api/admin/team/set-password',{method:'POST',headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},body:JSON.stringify({user_id:target,password,confirm_password:password,...value})}));}
 return {state,send,sendReset,sendPassword};
}

test('staff invitations require a current management role and same-origin bearer request',async()=>{
 for(const options of [{role:null},{role:'editor'},{valid:false}]){
  const h=endpoint(options);
  assert.ok([401,403].includes((await h.send()).status));
  assert.equal(h.state.invites.length,0);
  assert.equal(h.state.rpc.length,0);
  assert.equal(h.state.secretReads,0);
 }
 const h=endpoint();
 assert.equal((await h.send('POST',{}, {authorization:''})).status,401);
 assert.equal((await h.send('POST',{}, {origin:'https://evil.invalid'})).status,403);
});

test('onboarding rejects password or email-confirmation fields and the old endpoint is retired',async()=>{
 for(const payload of [{password},{confirm_password:password},{replace_password:true},{email_confirm:true},{actor_role:'owner'}]){
  const h=endpoint({existing:target});
  for(const mode of ['create','assign']){
   assert.equal((await h.send('POST',{mode,...payload})).status,400);
   assert.deepEqual(h.state.rpc,[]);
  }
  const retired=await h.sendPassword(payload);
  assert.equal(retired.status,410);
  assert.equal(retired.headers.get('cache-control'),'private, no-store');
  assert.equal((await retired.json()).code,'credential_operation_retired');
  assert.deepEqual(h.state.invites,[]);
  assert.deepEqual(h.state.creates,[]);
  assert.deepEqual(h.state.confirms,[]);
  assert.equal(h.state.secretReads,0);
 }
});

test('the Owner, Admin and Manager can invite and assign only roles below their own',async()=>{
 for(const mode of ['create','assign'])for(const actor of ['owner','admin','manager'])for(const role of ['owner','admin','manager','editor']){
  const h=endpoint({role:actor,existing:mode==='assign'?target:null});
  const response=await h.send('POST',{mode,role});
  const allowed=rank(role)<rank(actor);
  assert.equal(response.status,allowed?(mode==='assign'?200:202):role==='owner'?400:403,actor+' → '+role);
  assert.equal(h.state.invites.length,allowed&&mode==='create'?1:0);
 }
});

test('an email invitation grants no Home role even if the inviter loses access during delivery',async()=>{
 const h=endpoint({revokeDuringCreate:true});
 const response=await h.send('POST',{email:'  STAFF@GMAIL.COM  ',role:'manager'});
 assert.equal(response.status,202);
 assert.deepEqual(h.state.invites,[{email:'staff@gmail.com',options:{data:{full_name:'Team Staff'},redirectTo:'https://gary.example/auth/invite'}}]);
 assert.deepEqual(h.state.rpc.map(c=>c.name),['find_staff_account']);
 assert.deepEqual(await response.json(),{invited:true});
 assert.equal((await h.send('POST',{mode:'assign'})).status,403);
});

test('verified existing logins receive Home membership without a service key or Auth credential operation',async()=>{
 const h=endpoint({existing:target,secret:false});
 const response=await h.send('POST',{mode:'assign'});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{user_id:target,confirmed:true});
 assert.deepEqual(h.state.rpc.map(c=>c.name),['find_staff_account','assign_staff_account']);
 assert.deepEqual(h.state.invites,[]);
 assert.deepEqual(h.state.creates,[]);
 assert.deepEqual(h.state.reads,[]);
 assert.deepEqual(h.state.confirms,[]);
 assert.equal(h.state.secretReads,0);
});

test('pending signups cannot receive Home membership and already registered logins are never invited over',async()=>{
 const h=endpoint({existing:target,pendingAccount:true});
 const response=await h.send('POST',{mode:'assign'});
 assert.equal(response.status,409);
 assert.equal((await response.json()).code,'unverified_login');
 assert.equal((await h.send()).status,409);
 assert.deepEqual(h.state.invites,[]);
 assert.deepEqual(h.state.confirms,[]);
 assert.equal(h.state.storedPassword,'Existing private password');
 const missing=endpoint();
 assert.equal((await missing.send('POST',{mode:'assign'})).status,404);
 assert.deepEqual(missing.state.invites,[]);
 const race=endpoint({createError:true,createErrorCode:'email_exists'});
 const conflict=await race.send();
 assert.equal(conflict.status,409);
 assert.equal((await conflict.json()).code,'existing_login');
 assert.equal(race.state.rpc.some(c=>c.name==='assign_staff_account'),false);
});

test('disallowed email domains, protected targets and invite delivery failures are handled before granting access',async()=>{
 const bad=endpoint();
 assert.equal((await bad.send('POST',{email:'staff@example.invalid'})).status,400);
 assert.equal(bad.state.secretReads,0);
 const protectedAccount=endpoint({existing:target,protected:true});
 assert.equal((await protectedAccount.send('POST',{mode:'assign'})).status,403);
 assert.equal(protectedAccount.state.secretReads,0);
 for(const options of [{secret:false},{createError:true}]){
  const h=endpoint(options);
  assert.equal((await h.send()).status,503);
  assert.equal(h.state.rpc.some(c=>c.name==='assign_staff_account'),false);
 }
});

test('role updates are checked both by hierarchy and protected database targets',async()=>{
 const h=endpoint({role:'manager'});assert.equal((await h.send('PATCH',{user_id:target,role:'manager',active:true})).status,403);
 assert.equal((await h.send('PATCH',{user_id:target,role:'editor',active:true})).status,200);
 const blocked=endpoint({protected:true});assert.equal((await blocked.send('PATCH',{user_id:target,role:'editor',active:false})).status,403);
});

test('directory responses include current photos, paginate and never expose credentials',async()=>{
 const members=Array.from({length:51},(_,i)=>({user_id:String(i),role:'editor',email:String(i).padStart(3,'0')+'@garyhome.com'}));
 const h=endpoint({members,profiles:[{user_id:'0',avatar_path:'portrait.jpg'}]}),response=await h.send('GET');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');const body=await response.json();assert.equal(body.members.length,50);assert.equal(body.next,members[49].email);assert.equal(body.directCreationEnabled,true);assert.equal(body.members[0].avatar_path,'portrait.jpg');assert.ok(!('secret'in body));assert.ok(!('password'in body));
});

test('only owners and admins can delete lower staff assignments; Auth identities are retained',async()=>{
 const h=endpoint(),response=await h.send('DELETE',{user_id:target});assert.equal(response.status,200);assert.deepEqual(h.state.rpc,[{name:'remove_staff_access',args:{target_user_id:target}}]);assert.equal(h.state.secretReads,0);
 for(const options of [{role:'manager'},{role:null},{valid:false},{protected:true}]){const h=endpoint(options);assert.ok([401,403].includes((await h.send('DELETE',{user_id:target})).status));}
});

test('optional password recovery uses the database-approved email and fixed same-origin destination',async()=>{
 const h=endpoint(),response=await h.sendReset({email:'attacker@evil.invalid',redirectTo:'https://evil.invalid'});assert.equal(response.status,200);assert.deepEqual(h.state.resets,[{email:'assigned@gmail.com',options:{redirectTo:'https://gary.example/auth/reset'}}]);assert.deepEqual(h.state.rpc.map(c=>c.name),['staff_reset_email','log_staff_password_link']);assert.equal(h.state.secretReads,0);
});

test('recovery respects protected roles, failed delivery and sending limits',async()=>{
 for(const options of [{role:'editor'},{valid:false},{resetTargetError:{code:'42501'}},{resetTargetError:{code:'23514'}}]){const h=endpoint(options),response=await h.sendReset();assert.ok([401,403,409].includes(response.status));assert.equal(h.state.resets.length,0);}
 for(const resetError of [{code:'over_email_send_rate_limit',status:429},{code:'email_address_not_authorized',status:403}]){const h=endpoint({resetError}),response=await h.sendReset();assert.equal(response.status,resetError.status===429?429:503);assert.ok((await response.json()).error);assert.equal(h.state.rpc.at(-1).args.failed,true);}
});

test('the team directory includes peers and lower roles and filters higher roles before sending a response',async()=>{
 const roles=['owner','admin','manager','editor'],members=roles.map(role=>({user_id:role,email:role+'@gmail.com',role,display_name:role}));
 for(const actor of roles){const h=endpoint({role:actor,members}),response=await h.send('GET');assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.members.map(member=>member.role),roles.filter(target=>rank(target)<=rank(actor)));if(actor==='editor'){assert.deepEqual(body.domains,[]);assert.equal(body.directCreationEnabled,false);assert.equal(h.state.secretReads,0);}}
 for(const role of [null,'customer','bogus']){const h=endpoint({role,members});assert.equal((await h.send('GET')).status,403);}
 const invalid=endpoint({role:'editor',valid:false});assert.equal((await invalid.send('GET')).status,401);
});
