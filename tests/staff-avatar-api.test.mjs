import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';import * as requests from '../lib/requests.ts';
const base=path.resolve(import.meta.dirname,'..');
function endpoint(avatar){
 const state={calls:[],filters:[]};const db={from(table){state.calls.push(table);const query={};for(const fn of ['select','abortSignal','maybeSingle'])query[fn]=()=>query;query.eq=(key,value)=>{state.filters.push({key,value});return query;};query.then=(resolve,reject)=>Promise.resolve({data:avatar?{avatar_path:avatar}:null,error:null}).then(resolve,reject);return query;},storage:{from(bucket){return {getPublicUrl:path=>({data:{publicUrl:'https://project.supabase.co/storage/v1/object/public/'+bucket+'/'+path}})};}}};
 const file=base+'/app/api/staff-avatar/[userId]/route.ts',exports={};const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInThisContext('(function(exports,require){'+code+'\n})',{filename:file})(exports,id=>id==='@/lib/server'?{publicSupabase:token=>{assert.equal(token,undefined);return db;}}:requests);
 return {state,async get(userId){return exports.GET(new Request('https://gary.example/api/staff-avatar/'+userId),{params:Promise.resolve({userId})});}};
}
test('the photo endpoint uses the anonymous RLS reader and redirects a published portrait without caching the lookup',async()=>{
 const uid='30000000-0000-4000-8000-000000000001',avatar=uid+'/40000000-0000-4000-8000-000000000001.png',h=endpoint(avatar),response=await h.get(uid);assert.equal(response.status,307);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('location'),'https://project.supabase.co/storage/v1/object/public/staff-avatars/'+avatar);assert.deepEqual(h.state.filters,[{key:'user_id',value:uid}]);
});
test('unpublished and malformed portrait IDs return 404 and never expose a private profile',async()=>{
 const h=endpoint(null);assert.equal((await h.get('30000000-0000-4000-8000-000000000001')).status,404);
 const before=h.state.calls.length;assert.equal((await h.get('../private')).status,404);assert.equal(h.state.calls.length,before);
});
