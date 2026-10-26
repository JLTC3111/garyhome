import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
import ts from 'typescript';import * as requests from '../lib/requests.ts';
const require=createRequire(import.meta.url),base=path.resolve(import.meta.dirname,'..');
const owner='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002',password='A private temporary password';
const rank=role=>({owner:4,admin:3,manager:2,editor:1}[role]||0);
function endpoint(options={}){
 const state={role:'owner',valid:true,existing:null,secret:true,members:[],profiles:[],rpc:[],creates:[],confirms:[],resets:[],secretReads:0,...options};
 const user={id:owner,email:'owner@protonmail.com',email_confirmed_at:'2026-10-01',user_metadata:{role:'owner'}};
 const client={auth:{getUser:async token=>({data:{user:state.valid&&token==='valid-token'?user:null},error:null}),resetPasswordForEmail:async(email,options)=>{state.resets.push({email,options});return {error:state.resetError||null};}},from(table){
  const q={};for(const name of ['select','eq','in','abortSignal','single','maybeSingle'])q[name]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve({data:table==='team_members'?(state.role?{role:state.role}:null):table==='staff_profiles'?state.profiles:{email_domains:['garyhome.com','icue.vn','gmail.com']},error:null}).then(resolve,reject);return q;
 },rpc(name,args){const q={abortSignal:()=>q,then(resolve,reject){
  state.rpc.push({name,args});let value={data:null,error:null};
  if(name==='find_staff_account')value=state.protected?{data:null,error:{code:'42501'}}:['garyhome.com','icue.vn','gmail.com'].includes(args.target_email.split('@')[1])?{data:state.existing,error:null}:{data:null,error:{code:'23514'}};
  if(name==='assign_staff_account')value=rank(state.role)>rank(args.assigned_role)?{data:state.existing||target,error:null}:{data:null,error:{code:'42501'}};
  if(name==='set_staff_access')value=state.protected?{data:null,error:{code:'42501'}}:{data:args.target_user_id,error:null};
  if(name==='remove_staff_access')value=state.protected||!['owner','admin'].includes(state.role)?{data:null,error:{code:'42501'}}:{data:state.unconfirmedDelete?null:true,error:null};
  if(name==='staff_temporary_password_request')value={data:state.resetTarget||'assigned@gmail.com',error:state.passwordTargetError||(!['owner','admin','manager'].includes(state.role)?{code:'42501'}:null)};
  if(name==='staff_reset_email')value={data:state.resetTarget||'assigned@gmail.com',error:state.resetTargetError||null};
  if(name==='list_staff_accounts')value={data:state.members,error:null};
  return Promise.resolve(value).then(resolve,reject);
 }};return q;}};
 const admin={auth:{admin:{createUser:async input=>{state.creates.push(input);if(state.createError)return {data:{user:null},error:state.createErrorCode?{code:state.createErrorCode}:new Error('Auth creation failed')};state.existing=target;if(state.revokeDuringCreate)state.role=null;return {data:{user:{id:target}},error:null};},updateUserById:async(id,input)=>{state.confirms.push({id,input});return {data:{user:{id:state.mismatchedAuthId||id,email:state.resetTarget||'assigned@gmail.com',email_confirmed_at:state.unconfirmedAuth?null:'2026-10-01'}},error:state.confirmError||state.passwordConfirmError&&input.password?new Error('Unconfirmed'):null};}}}};
 const server={publicSupabase:()=>client,staffAdminClient:()=>{state.secretReads++;return state.secret?admin:null;}};
 const modules=new Map();function load(file){if(file.endsWith('/lib/server.ts'))return server;if(modules.has(file))return modules.get(file).exports;const result={exports:{}};modules.set(file,result);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const dependency=id=>{if(id==='@/lib/requests')return requests;if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(base,id.slice(2)):path.resolve(path.dirname(file),id);return load(target.endsWith('.ts')?target:target+'.ts');}return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(result.exports,dependency,result);return result.exports;
 }
 async function send(method='POST',value={},headers={}){return load(path.join(base,'app/api/admin/team/route.ts'))[method](new Request('https://gary.example/api/admin/team',{method,headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(method==='POST'?{email:'staff@gmail.com',full_name:'Team Staff',role:'editor',mode:'create',...(value.mode==='assign'?{}:{password,confirm_password:password}),...value}:value)})}));}
 async function sendReset(value={},headers={}){return load(path.join(base,'app/api/admin/team/reset-password/route.ts')).POST(new Request('https://gary.example/api/admin/team/reset-password',{method:'POST',headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},body:JSON.stringify({user_id:target,...value})}));}
 async function sendPassword(value={},headers={}){return load(path.join(base,'app/api/admin/team/set-password/route.ts')).POST(new Request('https://gary.example/api/admin/team/set-password',{method:'POST',headers:{authorization:'Bearer valid-token',origin:'https://gary.example','content-type':'application/json',...headers},body:JSON.stringify({user_id:target,password,confirm_password:password,...value})}));}
 return {state,send,sendReset,sendPassword};
}

test('direct staff creation requires a verified current management role and same-origin bearer request',async()=>{
 for(const options of [{role:null},{role:'editor'},{valid:false}]){const h=endpoint(options),response=await h.send();assert.ok([401,403].includes(response.status));assert.equal(h.state.creates.length,0);assert.equal(h.state.rpc.length,0);assert.equal(h.state.secretReads,0);}
 const h=endpoint();assert.equal((await h.send('POST',{}, {authorization:''})).status,401);assert.equal((await h.send('POST',{}, {origin:'https://evil.invalid'})).status,403);
});
test('password and confirmation are validated before any account or membership write',async()=>{
 for(const input of [{password:'short',confirm_password:'short'},{confirm_password:'A different password'},{password:undefined,confirm_password:undefined}]){const h=endpoint(),response=await h.send('POST',input);assert.equal(response.status,400);assert.deepEqual(h.state.creates,[]);assert.deepEqual(h.state.rpc,[]);}
});
test('Owner, Admin and Manager can create any lower role and cannot create peers or higher roles',async()=>{
 for(const actor of ['owner','admin','manager'])for(const role of ['owner','admin','manager','editor']){
  const h=endpoint({role:actor}),response=await h.send('POST',{role,actor_role:'owner'});
  assert.equal(response.status,rank(role)<rank(actor)?201:role==='owner'?400:403,actor+' → '+role);
  assert.equal(h.state.creates.length,rank(role)<rank(actor)?1:0);
 }
});
test('new staff are created with the entered password and confirmed email, with roles assigned through the guarded database',async()=>{
 const h=endpoint(),response=await h.send('POST',{email:'  STAFF@GMAIL.COM  ',role:'manager'});assert.equal(response.status,201);
 assert.deepEqual(h.state.creates,[{email:'staff@gmail.com',password,email_confirm:true,user_metadata:{full_name:'Team Staff'}}]);
 assert.deepEqual(h.state.rpc.map(c=>c.name),['find_staff_account','assign_staff_account']);assert.equal(h.state.rpc[1].args.assigned_role,'manager');
 const body=await response.json();assert.deepEqual(body,{user_id:target,created:true,confirmed:true});assert.ok(!JSON.stringify(body).includes(password));assert.deepEqual(h.state.resets,[]);
});
test('an existing login is assigned and confirmed without replacing its password or sending onboarding email',async()=>{
 const h=endpoint({existing:target}),response=await h.send('POST',{mode:'assign',password:undefined,confirm_password:undefined});assert.equal(response.status,200);
 assert.deepEqual(h.state.confirms,[{id:target,input:{email_confirm:true}}]);assert.equal(h.state.creates.length,0);assert.equal(h.state.resets.length,0);assert.equal((await response.json()).created,false);
});
test('create and assign modes reject mismatched account state without duplicate accounts',async()=>{
 const existing=endpoint({existing:target});assert.equal((await existing.send()).status,409);assert.equal(existing.state.creates.length,0);
 const missing=endpoint();assert.equal((await missing.send('POST',{mode:'assign',password:undefined,confirm_password:undefined})).status,404);assert.equal(missing.state.confirms.length,0);
});
test('unsupported domains and protected targets are rejected before privileged Auth changes',async()=>{
 const bad=endpoint();assert.equal((await bad.send('POST',{email:'staff@example.invalid'})).status,400);assert.equal(bad.state.secretReads,0);
 const protectedAccount=endpoint({existing:target,protected:true});assert.equal((await protectedAccount.send('POST',{mode:'assign'})).status,403);assert.equal(protectedAccount.state.confirms.length,0);assert.equal(protectedAccount.state.secretReads,0);
});
test('missing server key and failed Auth creation never grant a staff role',async()=>{
 for(const options of [{secret:false},{createError:true}]){const h=endpoint(options),response=await h.send();assert.equal(response.status,503);assert.equal(h.state.rpc.some(c=>c.name==='assign_staff_account'),false);}
});
test('revoking the creator during account creation prevents delayed role assignment and reports the partial outcome',async()=>{
 const h=endpoint({revokeDuringCreate:true}),response=await h.send();assert.equal(response.status,409);assert.match((await response.json()).error,/account was created, but staff access was not confirmed/);assert.equal(h.state.creates.length,1);
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


test('temporary passwords are explicitly set on the approved existing staff Auth identity without changing roles or sending emails',async()=>{
 const h=endpoint({existing:target}),response=await h.sendPassword();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(h.state.confirms,[{id:target,input:{password,email_confirm:true}}]);assert.deepEqual(h.state.rpc,[{name:'staff_temporary_password_request',args:{target_user_id:target,failed:false}}]);
 assert.deepEqual(h.state.creates,[]);assert.deepEqual(h.state.resets,[]);const result=await response.json();assert.deepEqual(result,{ok:true,password_set:true,confirmed:true});assert.ok(!JSON.stringify(result).includes(password));
});
test('temporary password writes validate matching passwords and the verified management session first',async()=>{
 for(const input of [{password:'short',confirm_password:'short'},{confirm_password:'A different temporary password'},{user_id:'not-a-uuid'},{role:'owner'}]){const h=endpoint(),r=await h.sendPassword(input);assert.equal(r.status,400);assert.deepEqual(h.state.rpc,[]);assert.deepEqual(h.state.confirms,[]);}
 for(const options of [{role:null},{role:'editor'},{valid:false}]){const h=endpoint(options);assert.ok([401,403].includes((await h.sendPassword()).status));assert.deepEqual(h.state.confirms,[]);assert.equal(h.state.secretReads,0);}
 const h=endpoint();assert.equal((await h.sendPassword({}, {origin:'https://evil.invalid'})).status,403);assert.equal((await h.sendPassword({}, {authorization:''})).status,401);assert.deepEqual(h.state.confirms,[]);
});
test('protected, disabled, unassigned and revoked staff cannot have passwords changed through the management endpoint',async()=>{
 for(const passwordTargetError of [{code:'42501'},{code:'23514'},{code:'PGRST202'}]){const h=endpoint({passwordTargetError});assert.ok([400,403,503].includes((await h.sendPassword()).status));assert.deepEqual(h.state.confirms,[]);}
 const h=endpoint({secret:false});assert.equal((await h.sendPassword()).status,503);assert.deepEqual(h.state.rpc,[]);assert.deepEqual(h.state.confirms,[]);
});
test('Auth failures and identity or confirmation mismatches never report a password success or expose the password',async()=>{
 for(const options of [{confirmError:true},{mismatchedAuthId:owner},{unconfirmedAuth:true}]){const h=endpoint(options),r=await h.sendPassword();assert.equal(r.status,503);assert.deepEqual(h.state.rpc.map(x=>x.args.failed),[false,true]);const body=await r.text();assert.ok(!body.includes(password));assert.doesNotMatch(body,/password_set/);}
});


test('existing-login conflicts provide a recoverable code without creating a duplicate identity',async()=>{
 const h=endpoint({existing:target}),r=await h.send();assert.equal(r.status,409);assert.equal((await r.json()).code,'existing_login');assert.equal(h.state.creates.length,0);assert.equal(h.state.confirms.length,0);
 const race=endpoint({createError:true,createErrorCode:'email_exists'}),conflict=await race.send();assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'existing_login');assert.equal(race.state.rpc.some(x=>x.name==='assign_staff_account'),false);
});
test('restoring an existing login can explicitly set the entered temporary password after fresh role assignment',async()=>{
 const h=endpoint({existing:target}),r=await h.send('POST',{mode:'assign',replace_password:true,password,confirm_password:password});assert.equal(r.status,200);
 assert.deepEqual(h.state.rpc.map(x=>x.name),['find_staff_account','assign_staff_account','staff_temporary_password_request']);assert.deepEqual(h.state.confirms.map(x=>x.input),[{email_confirm:true},{password,email_confirm:true}]);assert.equal(h.state.creates.length,0);assert.equal(h.state.resets.length,0);assert.deepEqual(await r.json(),{user_id:target,created:false,confirmed:true,password_set:true});
});
test('existing-password replacement needs explicit consent and reports partial assignment without claiming password success',async()=>{
 const preserve=endpoint({existing:target}),rejected=await preserve.send('POST',{mode:'assign',password,confirm_password:password});assert.equal(rejected.status,400);assert.equal((await rejected.json()).code,'password_choice_required');assert.deepEqual(preserve.state.confirms,[]);
 const failure=endpoint({existing:target,passwordConfirmError:true}),r=await failure.send('POST',{mode:'assign',replace_password:true,password,confirm_password:password});assert.equal(r.status,409);const body=await r.json();assert.equal(body.code,'staff_access_assigned_password_unconfirmed');assert.ok(!body.password_set);assert.ok(!JSON.stringify(body).includes(password));assert.ok(failure.state.rpc.some(x=>x.name==='assign_staff_account'));assert.equal(failure.state.rpc.at(-1).args.failed,true);
});

test('the team directory includes peers and lower roles and filters higher roles before sending a response',async()=>{
 const roles=['owner','admin','manager','editor'],members=roles.map(role=>({user_id:role,email:role+'@gmail.com',role,display_name:role}));
 for(const actor of roles){const h=endpoint({role:actor,members}),response=await h.send('GET');assert.equal(response.status,200);const body=await response.json();assert.deepEqual(body.members.map(member=>member.role),roles.filter(target=>rank(target)<=rank(actor)));if(actor==='editor'){assert.deepEqual(body.domains,[]);assert.equal(body.directCreationEnabled,false);assert.equal(h.state.secretReads,0);}}
 for(const role of [null,'customer','bogus']){const h=endpoint({role,members});assert.equal((await h.send('GET')).status,403);}
 const invalid=endpoint({role:'editor',valid:false});assert.equal((await invalid.send('GET')).status,401);
});
test('read-only directory access never permits staff to call any team management or password endpoint',async()=>{
 const h=endpoint({role:'editor'});for(const method of ['POST','PATCH','DELETE'])assert.equal((await h.send(method,method==='POST'?{}:{user_id:target,role:'editor',active:false})).status,403);assert.equal((await h.sendReset()).status,403);assert.equal((await h.sendPassword()).status,403);assert.deepEqual(h.state.creates,[]);assert.deepEqual(h.state.confirms,[]);assert.deepEqual(h.state.resets,[]);assert.equal(h.state.secretReads,0);
});
