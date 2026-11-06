import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setImmediate as nextTurn} from 'node:timers/promises';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const jpeg=new Uint8Array([0xff,0xd8,0xff,0xe0,0,0,0,0]);
const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const webp=new Uint8Array([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,32]);
function avif(brand='avif',compatible='mif1'){
 const bytes=new Uint8Array(24);new DataView(bytes.buffer).setUint32(0,24);
 bytes.set(new TextEncoder().encode('ftyp'+brand),4);bytes.set(new TextEncoder().encode(compatible),16);return bytes;
}

function harness(t,{session=true,configured=true,transport}={}){
 const calls=[],cache=new Map();
 const db={};
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./listing-file-upload')return {uploadListingFile:async input=>{
    if(!configured)throw new Error('Connect Supabase before uploading.');
    if(!session)throw new Error('Your sign-in expired. Reconnect and try uploading again.');
    calls.push(input);if(transport)return transport(input);
    return 'https://unit-test.invalid/storage/v1/object/public/'+input.bucket+'/'+input.path;
   }};
   if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id+'.ts'));
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(loaded.exports,dependency,loaded);
  return loaded.exports;
 }
 return {...load(path.join(root,'lib/property-image-upload.ts')),db,calls};
}

test('image bytes determine type when renamed JPEG files have empty, nonstandard or misleading MIME labels',async t=>{
 const h=harness(t);
 for(const mime of ['', 'image/jpg','application/octet-stream','image/png']){
  const file=new File([jpeg],'3-bedroom-apartment-tay-ho-*-*-*.jpg',{type:mime});
  const prepared=await h.preparePropertyImage(file);
  assert.equal(prepared.contentType,'image/jpeg');assert.equal(prepared.extension,'jpg');assert.equal(prepared.body.type,'image/jpeg');
  assert.deepEqual(new Uint8Array(await prepared.body.arrayBuffer()),jpeg);
 }
 for(const [bytes,type,extension] of [[png,'image/png','png'],[webp,'image/webp','webp'],[avif(),'image/avif','avif'],[avif('mif1','avif'),'image/avif','avif']]){
  const prepared=await h.preparePropertyImage(new File([bytes],'renamed.JPG',{type:'application/octet-stream'}));
  assert.equal(prepared.contentType,type);assert.equal(prepared.extension,extension);
 }
});

test('empty, oversized and unsupported image contents are rejected before a storage request',async t=>{
 const h=harness(t);
 await assert.rejects(h.preparePropertyImage(new File([],'empty.jpg',{type:'image/jpeg'})),/not empty/);
 await assert.rejects(h.preparePropertyImage({size:8*1024*1024+1,slice(){throw new Error('must not read oversized file');}}),/8 MB or smaller/);
 for(const body of ['<svg>not a JPEG</svg>',avif('heic')])await assert.rejects(h.uploadPropertyImage(h.db,new File([body],'fake.jpg',{type:'image/jpeg'})),/not a supported image/);
 assert.equal(h.calls.length,0);
});

test('image uploads use resumable transport with random keys, normalized MIME and exact original filenames',async t=>{
 const h=harness(t),names=['3-bedroom-apartment-tay-ho-*-*-*.jpg','Căn hộ 3 phòng ngủ (lake view).JPG','same-name.jpg','same-name.jpg'];
 for(const name of names){
  const url=await h.uploadPropertyImage(h.db,new File([jpeg],name,{type:''}));
  assert.match(url,/^https:\/\/unit-test\.invalid\/storage\/v1\/object\/public\/property-media\/properties\/[\da-f-]{36}\.jpg$/);
 }
 assert.equal(new Set(h.calls.map(call=>call.path)).size,names.length);
 for(const [index,call] of h.calls.entries()){
  assert.match(call.path,/^properties\/[\da-f-]{36}\.jpg$/);assert.equal(call.bucket,'property-media');
  assert.equal(call.file.type,'image/jpeg');assert.equal(call.contentType,'image/jpeg');
  assert.equal(call.originalFilename,names[index]);assert.equal(call.resumeKey.name,names[index]);
 }
 const retryFile=new File([jpeg],'retry.JPG');await h.uploadPropertyImage(h.db,retryFile);await h.uploadPropertyImage(h.db,retryFile);
 assert.notEqual(h.calls.at(-1).path,h.calls.at(-2).path,'a completed file can be uploaded again to a fresh destination');
});

test('missing authentication is explained before uploading',async t=>{
 const h=harness(t,{session:false});
 await assert.rejects(h.uploadPropertyImage(h.db,new File([jpeg],'home.jpg')),/sign-in expired/);assert.equal(h.calls.length,0);
});

test('image uploads forward cancellation and progress to the resumable transport',async t=>{
 let started;const requestStarted=new Promise(resolve=>started=resolve),progress=[];
 const h=harness(t,{transport:input=>{input.onProgress({percent:40});started();return new Promise((_,reject)=>input.signal.addEventListener('abort',()=>reject(input.signal.reason),{once:true}));}});
 const controller=new AbortController(),upload=h.uploadPropertyImage(h.db,new File([jpeg],'home.jpg'),controller.signal,{onProgress:value=>progress.push(value)});
 await requestStarted;controller.abort();await assert.rejects(upload,/interrupted/);
 assert.equal(h.calls[0].signal.aborted,true);assert.deepEqual(progress,[{percent:40}]);
 await nextTurn();
});

test('upload errors distinguish permissions, authentication, size, type and connection timeouts',t=>{
 const h=harness(t);
 for(const [error,pattern] of [
  [{status:413},/8 MB or smaller/],[{code:'InvalidMimeType'},/not a supported image/],
  [{statusCode:'401'},/sign-in expired/],[{status:403},/permission to upload/],[{code:'42501'},/permission to upload/],
  [{name:'RequestTimeoutError',message:'The request timed out. It may have reached the server.'},/image upload timed out/],
  [new TypeError('Failed to fetch'),/connection failed/],[{name:'AbortError'},/interrupted/],[{},/Couldn’t upload this image/],
 ]){
  const message=h.imageUploadError(error);assert.match(message,pattern);assert.equal(h.imageUploadError(new Error(message)),message);
 }
});
