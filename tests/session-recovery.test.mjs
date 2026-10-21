import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SessionRecovery } from '../lib/session-recovery.ts';
import { request, fetchWithDeadline, RequestTimeoutError } from '../lib/requests.ts';
import { createClient } from '@supabase/supabase-js';

const user=id=>({id,email:`${id}@example.invalid`,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const session=id=>({user:user(id),access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup(t,overrides={}){
 const history=[];
 const deps={getSession:async()=>({data:{session:session('owner')},error:null}),getRole:async()=> 'owner',online:()=>true,onChange:s=>history.push(s),timeoutMs:100,...overrides};
 const recovery=new SessionRecovery(deps);t.after(()=>recovery.stop());
 return {recovery,history,deps};
}

test('same-user token refresh and tab refocus never remove editor access',async t=>{
 const {recovery,history,deps}=setup(t);
 assert.equal(await recovery.recover(),true);
 const before=history.length, pending=deferred();deps.getRole=()=>pending.promise;
 recovery.observe(session('owner'));
 assert.equal(recovery.state.editor,true);
 await delay(2);assert.equal(recovery.state.editor,true);
 pending.resolve('owner');await delay(2);
 assert.ok(history.slice(before).every(s=>s.editor&&s.user.id==='owner'));
});

test('auth event callback defers all SDK-dependent work',async t=>{
 let inCallback=false,calls=0;
 const {recovery}=setup(t,{getRole:async()=>{assert.equal(inCallback,false);calls++;return 'owner';}});
 inCallback=true;recovery.observe(session('owner'));assert.equal(calls,0);inCallback=false;
 await delay(5);assert.equal(calls,1);assert.equal(recovery.state.editor,true);
});

test('offline and transient role errors preserve the workspace but fail recovery until verified',async t=>{
 let online=true,broken=false;
 const {recovery}=setup(t,{online:()=>online,getRole:async()=>{if(broken)throw new Error('Network interrupted');return 'owner';}});
 assert.equal(await recovery.recover(),true);
 online=false;recovery.offline();assert.equal(await recovery.recover(),false);
 assert.equal(recovery.state.editor,true);assert.equal(recovery.state.phase,'offline');
 online=true;broken=true;assert.equal(await recovery.recover(),false);
 assert.equal(recovery.state.editor,true);assert.equal(recovery.state.phase,'error');
 broken=false;assert.equal(await recovery.recover(),true);assert.equal(recovery.state.phase,'ready');
});

test('expired/revoked session returns to sign-in instead of remaining in recovery',async t=>{
 const {recovery,deps}=setup(t);await recovery.recover();
 deps.getSession=async()=>({data:{session:null},error:null});
 assert.equal(await recovery.recover(),false);assert.equal(recovery.state.user,null);
 assert.equal(recovery.state.editor,false);assert.equal(recovery.state.phase,'ready');
});

test('confirmed role revocation removes editor access',async t=>{
 const {recovery,deps}=setup(t);await recovery.recover();deps.getRole=async()=>null;
 assert.equal(await recovery.recover(),false);assert.equal(recovery.state.editor,false);assert.equal(recovery.state.phase,'ready');
});

test('late role response cannot restore a signed-out user',async t=>{
 const pending=deferred();const {recovery}=setup(t,{getRole:()=>pending.promise});
 const recovering=recovery.recover();await delay(2);recovery.observe(null);pending.resolve('owner');
 assert.equal(await recovering,false);assert.equal(recovery.state.user,null);assert.equal(recovery.state.editor,false);
});

test('late session read cannot undo sign-out or authorize a different account',async t=>{
 const pending=deferred();const {recovery,deps}=setup(t);await recovery.recover();
 deps.getSession=()=>pending.promise;deps.getRole=async id=>id==='owner'?'owner':null;
 const recovering=recovery.recover();await delay(2);recovery.observe(null);recovery.observe(session('visitor'));
 pending.resolve({data:{session:session('owner')},error:null});await recovering;await delay(2);
 assert.equal(recovery.state.user.id,'visitor');assert.equal(recovery.state.editor,false);
});

test('focus, visibility, and reconnect bursts share one session and membership request',async t=>{
 const pending=deferred();let sessions=0,roles=0;
 const {recovery}=setup(t,{getSession:()=>{sessions++;return pending.promise;},getRole:async()=>{roles++;return 'owner';}});
 const first=recovery.recover(),second=recovery.recover(),third=recovery.recover();
 assert.equal(first,second);assert.equal(second,third);
 pending.resolve({data:{session:session('owner')},error:null});
 assert.deepEqual(await Promise.all([first,second,third]),[true,true,true]);assert.equal(sessions,1);assert.equal(roles,1);
});

test('a hung session read times out, releases the recovery slot, and can be retried',async t=>{
 const {recovery,deps}=setup(t,{getSession:()=>new Promise(()=>{}),timeoutMs:5});
 assert.equal(await recovery.recover(),false);assert.equal(recovery.state.phase,'error');
 deps.getSession=async()=>({data:{session:session('owner')},error:null});
 assert.equal(await recovery.recover(),true);assert.equal(recovery.state.phase,'ready');
});

test('a hung membership read times out without losing edits or blocking the next attempt',async t=>{
 const {recovery,deps}=setup(t,{timeoutMs:5});await recovery.recover();
 deps.getRole=()=>new Promise(()=>{});assert.equal(await recovery.recover(),false);
 assert.equal(recovery.state.editor,true);assert.equal(recovery.state.phase,'error');
 deps.getRole=async()=> 'owner';assert.equal(await recovery.recover(),true);
});

test('provider cleanup prevents updates from late requests',async t=>{
 const pending=deferred();const {recovery,history}=setup(t,{getRole:()=>pending.promise});
 const recovering=recovery.recover();await delay(2);recovery.stop();const count=history.length;
 pending.resolve('owner');await recovering;assert.equal(history.length,count);
});

test('a timed-out mutation is aborted and never automatically replayed',async()=>{
 const pending=deferred();let attempts=0,signal;
 await assert.rejects(request(s=>{attempts++;signal=s;return pending.promise;},5),RequestTimeoutError);
 assert.equal(signal.aborted,true);pending.resolve({committed:true});await delay(2);assert.equal(attempts,1);
});

test('response body stalls are bounded, and a subsequent fetch succeeds',async t=>{
 const original=globalThis.fetch;let attempts=0;
 t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>{attempts++;return new Response(new ReadableStream({start(){}}));};
 await assert.rejects(fetchWithDeadline('https://example.invalid',undefined,5),RequestTimeoutError);
 assert.equal(attempts,1);
 globalThis.fetch=async()=>Response.json({ok:true});
 assert.deepEqual(await (await fetchWithDeadline('https://example.invalid',undefined,100)).json(),{ok:true});
});

test('the installed Supabase SDK refreshes an expired stored token and restores the editor',async t=>{
 const jwt=(id,expiry)=>`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,exp:expiry,iat:expiry-3600,role:'authenticated'})).toString('base64url')}.test-signature`;
 const expired={...session('owner'),access_token:jwt('owner',1),expires_at:1};
 const fresh=jwt('owner',Math.floor(Date.now()/1000)+3600);
 const storage=new Map([['gary-idle-regression',JSON.stringify(expired)]]);let refreshed=0,memberReads=0;
 const client=createClient('https://idle-regression.supabase.co','sb_publishable_regression_only',{
  auth:{storageKey:'gary-idle-regression',autoRefreshToken:false,detectSessionInUrl:false,persistSession:true,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
  global:{fetch:async(input,init)=>{
   const url=String(input);
   if(url.includes('/auth/v1/token')){refreshed++;return Response.json({...session('owner'),access_token:fresh,refresh_token:'rotated-test-token',expires_at:Math.floor(Date.now()/1000)+3600});}
   if(url.includes('/rest/v1/team_members')){memberReads++;assert.equal(new Headers(init.headers).get('Authorization'),`Bearer ${fresh}`);return Response.json([{role:'owner'}]);}
   throw new Error('Unexpected test request');
  }},
 });
 t.after(()=>client.auth.dispose());
 const recovery=new SessionRecovery({getSession:()=>client.auth.getSession(),getRole:async(id,signal)=>{const {data,error}=await client.from('team_members').select('role').eq('user_id',id).abortSignal(signal).maybeSingle();if(error)throw error;return data?.role??null;},online:()=>true,onChange:()=>{},timeoutMs:500});
 t.after(()=>recovery.stop());
 const {data}=client.auth.onAuthStateChange((_event,session)=>{recovery.observe(session);});t.after(()=>data.subscription.unsubscribe());
 assert.equal(await recovery.recover(),true);assert.equal(recovery.state.editor,true);
 assert.equal(refreshed,1);assert.ok(memberReads>=1);assert.equal(JSON.parse(storage.get('gary-idle-regression')).access_token,fresh);
});

test('wake event wiring coalesces bursts, waits for visibility, queues online recovery, and cleans up',async()=>{
 const {installRecoveryEvents}=await import('../lib/recovery-events.ts');
 const browser=new EventTarget(),page=Object.assign(new EventTarget(),{visibilityState:'hidden'});
 let count=0,offline=0;let pending=deferred();
 const remove=installRecoveryEvents(async()=>{count++;await pending.promise;},()=>{offline++;},browser,page);
 browser.dispatchEvent(new Event('focus'));await delay(1);assert.equal(count,0);
 page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));browser.dispatchEvent(new Event('focus'));browser.dispatchEvent(new Event('pageshow'));
 await delay(1);assert.equal(count,1);
 browser.dispatchEvent(new Event('offline'));assert.equal(offline,1);
 browser.dispatchEvent(new Event('online')); // Must not get lost behind the pending request.
 pending.resolve();await delay(2);assert.equal(count,2);
 remove();browser.dispatchEvent(new Event('focus'));browser.dispatchEvent(new Event('online'));await delay(1);assert.equal(count,2);
});
