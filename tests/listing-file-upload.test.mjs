import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..');
function harness(t){
 const state={uploads:[],progress:[],token:'first',user:'owner',aborts:0},controller=new AbortController();t.after(()=>controller.abort());
 let now=1000,sequence=0;const timers=new Map();
 class Upload {constructor(file,options){this.file=file;this.options=options;this.url=options.uploadUrl||null;state.uploads.push(this);}start(){this.started=true;}async abort(){state.aborts++;}}
 const client={auth:{getSession:async()=>({data:{session:{access_token:state.token,user:{id:state.user}}},error:null})},storage:{from:bucket=>({getPublicUrl:p=>({data:{publicUrl:'https://media.example/'+bucket+'/'+p}})})}};
 const source=ts.transpileModule(fs.readFileSync(base+'/lib/listing-file-upload.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const loaded={exports:{}};function dependency(id){if(id==='tus-js-client')return {Upload};if(id==='./browser-client')return {browserBackendConfig:()=>({url:'https://exampleproject.supabase.co',publishableKey:'public-key'})};throw new Error(id);}
 class ClockDate extends Date {static now(){return now;}}
 vm.runInThisContext('(function(exports,require,module,setTimeout,clearTimeout,Date){'+source+'\n})')(loaded.exports,dependency,loaded,(fn,delay)=>{timers.set(++sequence,{fn,at:now+delay});return sequence;},id=>timers.delete(id),ClockDate);
 const file=new File(['1234567890'],'Căn hộ * lake view.JPG',{type:'image/jpeg'});
 const run=(overrides={})=>{const pending=loaded.exports.uploadListingFile({client,file,bucket:'property-media',path:'properties/uuid.jpg',contentType:'image/jpeg',originalFilename:file.name,signal:controller.signal,onProgress:value=>state.progress.push(value),...overrides});pending.catch(()=>{});return pending;};
 const advance=milliseconds=>{now+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}};
 const request=()=>{const headers={};return {headers,setHeader:(k,v)=>headers[k]=v,getUnderlyingObject:()=>({})};};
 return {state,controller,run,advance,request,file,api:loaded.exports,timers};
}
const turn=()=>new Promise(setImmediate);
test('listing uploads use private in-memory resumable sessions, required chunks, original metadata and refreshed credentials',async t=>{
 const h=harness(t),pending=h.run();await turn();const {options}=h.state.uploads[0];
 assert.equal(options.chunkSize,6*1024*1024);assert.equal(options.storeFingerprintForResuming,false);assert.equal(options.uploadDataDuringCreation,true);
 assert.match(options.endpoint,/exampleproject\.storage\.supabase\.co/);assert.deepEqual(JSON.parse(options.metadata.metadata),{original_filename:h.file.name});
 const first=h.request();await options.onBeforeRequest(first);h.state.token='refreshed';const next=h.request();await options.onBeforeRequest(next);
 assert.equal(first.headers.authorization,'Bearer first');assert.equal(next.headers.authorization,'Bearer refreshed');assert.equal(next.headers.apikey,'public-key');
 options.onProgress(5,10);assert.equal(h.state.progress.at(-1).percent,50);options.onProgress(10,10);assert.equal(h.state.progress.at(-1).percent,99);
 options.onSuccess();assert.equal(await pending,'https://media.example/property-media/properties/uuid.jpg');assert.equal(h.state.progress.at(-1).percent,100);assert.equal(h.timers.size,0);
});
test('a progressing upload continues for more than 120 seconds without a total deadline',async t=>{
 const h=harness(t),pending=h.run();await turn();const {options}=h.state.uploads[0];
 for(let bytes=1;bytes<=5;bytes++){h.advance(60000);options.onProgress(bytes,10);}
 assert.equal(h.state.aborts,0);options.onSuccess();await pending;assert.ok(h.state.progress.at(-1).lastActivityAt-h.state.progress[0].startedAt>=300000);
});
test('120 seconds without progress aborts transport, retains its resume URL and allows retry',async t=>{
 const h=harness(t),pending=h.run();await turn();const upload=h.state.uploads[0];upload.url='https://upload.example/resume-id';upload.options.onProgress(4,10);
 h.advance(119999);assert.equal(h.state.aborts,0);h.advance(1);await assert.rejects(pending,/No upload progress for 120 seconds/);assert.equal(h.state.aborts,1);
 const retry=h.run();await turn();const second=h.state.uploads[1];assert.equal(second.options.uploadUrl,upload.url);second.options.onSuccess();await retry;
 const fresh=h.run();await turn();assert.equal(h.state.uploads[2].options.uploadUrl,undefined);h.state.uploads[2].options.onSuccess();await fresh;
});
test('cancellation aborts transport and ignores late progress and success callbacks',async t=>{
 const h=harness(t),pending=h.run();await turn();const {options}=h.state.uploads[0];h.controller.abort();await assert.rejects(pending,{name:'AbortError'});const count=h.state.progress.length;
 options.onProgress(10,10);options.onSuccess();options.onAfterResponse();assert.equal(h.state.progress.length,count);assert.equal(h.timers.size,0);assert.equal(h.state.aborts,1);
});
test('resumable URLs and request credentials cannot cross signed-in accounts',async t=>{
 const h=harness(t),pending=h.run();await turn();h.state.uploads[0].url='https://upload.example/private-owner-url';h.state.user='other';
 const request=h.request();await assert.rejects(h.state.uploads[0].options.onBeforeRequest(request),/account changed/);assert.deepEqual(request.headers,{});
 h.state.uploads[0].options.onError(new Error('account changed'));await assert.rejects(pending,/account changed/);
 const next=h.run();await turn();assert.equal(h.state.uploads[1].options.uploadUrl,undefined);h.state.uploads[1].options.onSuccess();await next;
});
test('only transient network and server errors retry automatically; terminal permissions remain actionable',async t=>{
 const h=harness(t),pending=h.run();await turn();const {options}=h.state.uploads[0],issue=status=>({originalResponse:{getStatus:()=>status}});
 assert.equal(options.onShouldRetry(issue(503),0,options),true);assert.equal(h.state.progress.at(-1).retrying,true);
 assert.equal(options.onShouldRetry(issue(403),0,options),false);assert.equal(options.onShouldRetry(issue(0),99,options),false);
 options.onError(Object.assign(new Error('forbidden'),issue(403)));await assert.rejects(pending,error=>error.status===403);assert.equal(h.timers.size,0);
 assert.throws(()=>h.api.listingUploadEndpoint('http://remote.example'));assert.equal(h.api.listingUploadEndpoint('https://custom.example'),'https://custom.example/storage/v1/upload/resumable');
});
