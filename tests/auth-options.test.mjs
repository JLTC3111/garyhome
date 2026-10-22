import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as requests from '../lib/requests.ts';

function endpoint(t,options={}){
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});const calls=[];
 globalThis.fetch=async(input,init)=>{
  calls.push({url:input,headers:new Headers(init.headers)});
  if(options.unavailable)throw new Error('Network unavailable');
  return Response.json({external:{google:true,facebook:false,apple:false,email:true},disable_signup:false,server_secret:'must-never-leave-the-server',...options.settings});
 };
 const db={from:()=>{const q={};for(const name of ['select','eq','abortSignal','maybeSingle'])q[name]=()=>q;
  q.then=(resolve,reject)=>Promise.resolve(options.missingMigration?{data:null,error:{code:'42P01'}}:{data:{email_domains:['garyhome.com','icue.vn']},error:null}).then(resolve,reject);return q;}};
 const server={backendConfig:()=>options.unconfigured?{url:'',key:''}:{url:'https://unit-test.invalid',key:'sb_publishable_test'},publicSupabase:()=>db};
 const compiled=ts.transpileModule(fs.readFileSync(new URL('../app/api/auth/options/route.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const loaded={exports:{}};vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})')(loaded.exports,id=>id==='@/lib/server'?server:requests,loaded);
 return {get:loaded.exports.GET,calls};
}
test('provider availability reflects Supabase flags without exposing settings or server credentials',async t=>{
 const h=endpoint(t),response=await h.get();assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{available:true,google:true,facebook:false,apple:false,email:true,signup:true,staffDomains:['garyhome.com','icue.vn']});
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(h.calls[0].headers.get('apikey'),'sb_publishable_test');assert.equal(h.calls[0].headers.get('authorization'),null);
});
test('Facebook availability is independent of Google and excludes provider credentials',async t=>{
 const h=endpoint(t,{settings:{external:{google:false,facebook:true,email:true},external_facebook_secret:'private-meta-secret'}});
 const response=await h.get();assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.facebook,true);assert.equal(data.google,false);
 assert.equal(JSON.stringify(data).includes('private-meta-secret'),false);assert.equal(JSON.stringify(data).includes('must-never-leave-the-server'),false);
});
test('customer social availability can load before the separate staff database migration',async t=>{
 const h=endpoint(t,{missingMigration:true}),response=await h.get();assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.google,true);assert.deepEqual(data.staffDomains,[]);
});
test('unavailable provider settings disable social choices while retaining email login',async t=>{
 const h=endpoint(t,{unavailable:true}),response=await h.get();assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{available:false,google:false,facebook:false,apple:false,email:true});
});
