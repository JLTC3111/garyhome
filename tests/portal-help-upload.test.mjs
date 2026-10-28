import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';
const base=path.resolve(import.meta.dirname,'..');
function harness(t){
 const state={uploads:[],progress:[],token:'first-session',userId:'owner',aborts:0},controller=new AbortController();t.after(()=>controller.abort());
 class Upload{constructor(file,options){state.uploads.push(this);this.file=file;this.options=options;}start(){state.started=true;}async abort(){state.aborts++;}}
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file).exports;const loaded={exports:{}};modules.set(file,loaded);const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;function dependency(id){if(id==='tus-js-client')return {Upload};if(id==='./browser-client')return {browserBackendConfig:supplied=>{assert.equal(supplied,client);return {url:'https://exampleproject.supabase.co',publishableKey:'sb_publishable_test'};}};return load(path.resolve(path.dirname(file),id.endsWith('.ts')?id:id+'.ts'));}vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,dependency,loaded);return loaded.exports;}
 const api=load(base+'/lib/portal-help-upload.ts'),client={auth:{getSession:async()=>({data:{session:{user:{id:state.userId},access_token:state.token}},error:null})}};
 const run=file=>{const pending=api.uploadHelpFile({client,userId:'owner',file,path:'owner/guide/file.mp4',signal:controller.signal,onProgress:value=>state.progress.push(value)});pending.catch(()=>{});return pending;};
 const request=()=>{const headers={};return {headers,setHeader:(key,value)=>{headers[key]=value;},getUnderlyingObject:()=>({})};};
 return {state,controller,run,request,api};
}
test('video uploads use 6 MB resumable chunks and fresh account credentials on each request',async t=>{
 const h=harness(t),pending=h.run(new File(['video-test'],'walkthrough.mp4',{type:'video/mp4'}));await new Promise(setImmediate);
 const {options}=h.state.uploads[0];assert.equal(options.chunkSize,6*1024*1024);assert.equal(options.storeFingerprintForResuming,false);assert.equal(options.metadata.bucketName,'portal-guides');assert.equal(options.metadata.objectName,'owner/guide/file.mp4');assert.match(options.endpoint,/exampleproject\.storage\.supabase\.co/);
 const first=h.request();await options.onBeforeRequest(first);h.state.token='renewed-session';const second=h.request();await options.onBeforeRequest(second);assert.equal(first.headers.authorization,'Bearer first-session');assert.equal(second.headers.authorization,'Bearer renewed-session');assert.equal(second.headers.apikey,'sb_publishable_test');
 options.onProgress(6,10);options.onSuccess();await pending;assert.deepEqual(h.state.progress,[60,100]);
});
test('cancelling an upload aborts transport and ignores late success/progress events',async t=>{
 const h=harness(t),pending=h.run(new File(['pdf'],'guide.pdf',{type:'application/pdf'}));await new Promise(setImmediate);const {options}=h.state.uploads[0];h.controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(h.state.aborts,1);options.onProgress(1,1);options.onSuccess();assert.deepEqual(h.state.progress,[]);
});
test('a different signed-in account cannot inherit a pending upload',async t=>{
 const h=harness(t),pending=h.run(new File(['gif'],'steps.gif',{type:'image/gif'}));await new Promise(setImmediate);h.state.userId='different-customer';const request=h.request();await assert.rejects(h.state.uploads[0].options.onBeforeRequest(request),/session_changed/);assert.deepEqual(request.headers,{});h.state.uploads[0].options.onError(new Error());await assert.rejects(pending,/upload_connection/);
});
test('unsupported files and already-cancelled requests never start transport; endpoints reject unsafe protocols',async t=>{
 const h=harness(t);await assert.rejects(h.run(new File(['svg'],'bad.svg',{type:'image/svg+xml'})),/file_limits/);h.controller.abort();await assert.rejects(h.run(new File(['pdf'],'ok.pdf',{type:'application/pdf'})),{name:'AbortError'});assert.equal(h.state.uploads.length,0);assert.throws(()=>h.api.helpUploadEndpoint('http://remote.example'),/upload_connection/);assert.equal(h.api.helpUploadEndpoint('https://custom.example'),'https://custom.example/storage/v1/upload/resumable');
});
