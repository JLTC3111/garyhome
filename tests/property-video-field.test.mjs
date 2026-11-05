import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import ts from 'typescript';import {setTimeout as delay} from 'node:timers/promises';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',one='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',two='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validFile=()=>{const bytes=new Uint8Array(24);new DataView(bytes.buffer).setUint32(0,24);bytes.set(new TextEncoder().encode('ftypisom'),4);return new File([bytes],'tour.mp4',{type:'video/mp4'});};
async function harness(t,disabled=false){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let settle;const pending=new Promise(resolve=>settle=resolve),uploads=[],changes=[],busy=[];
 const site={user:{id:uid},demo:false,t:en=>en,editorTask:async run=>run({storage:{from:bucket=>({upload(path,file,options){uploads.push({bucket,path,file,options});return pending;},getPublicUrl:path=>({data:{publicUrl:'https://duyiihsmaqfgwezmsnjs.supabase.co/storage/v1/object/public/listing-videos/'+path}})})}},new AbortController().signal)};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file).exports;const result={exports:{}};cache.set(file,result);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;function dep(id){if(id==='./site-context')return {useSite:()=>site};if(id==='./use-studio-text')return {useStudioText:()=>en=>en};if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}return require(id);}vm.runInThisContext('(function(exports,require,module){'+js+'\n})')(result.exports,dep,result);return result.exports;}
 const {PropertyVideoField}=load(root+'/components/property-video-field.tsx');let renderer;
 const view=id=>React.createElement(PropertyVideoField,{disabled,property:{id,video_url:null},onChange:value=>changes.push(value),onUploadingChange:value=>busy.push(value)});
 await act(async()=>{renderer=TestRenderer.create(view(one));});
 t.after(async()=>{await act(async()=>renderer.unmount());if(prior)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',prior);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 const input=()=>renderer.root.findByProps({name:'property_video'});
 return {renderer,uploads,changes,busy,input,async choose(files){await act(async()=>{input().props.onChange({target:{files,value:'chosen'}});await delay(5);});},async finish(){await act(async()=>{settle({data:{path:'video'},error:null});await delay(5);});},async switchListing(){await act(async()=>renderer.update(view(two)));}};
}
test('one MP4 uploads with the correct content type and notifies the parent while saving is blocked',async t=>{
 const h=await harness(t);assert.equal(h.input().props.multiple,undefined);await h.choose([validFile()]);assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].bucket,'listing-videos');assert.match(h.uploads[0].path,new RegExp('^'+uid+'/'+one+'/'));assert.deepEqual(h.uploads[0].options,{upsert:false,contentType:'video/mp4',cacheControl:'31536000'});assert.equal(h.input().props.disabled,true);assert.equal(h.busy.at(-1),true);await h.finish();assert.equal(h.changes.length,1);assert.match(h.changes[0],/listing-videos\/.*\.mp4$/);assert.equal(h.input().props.disabled,false);assert.equal(h.busy.at(-1),false);
});
test('multiple and disguised files are explained before any storage write',async t=>{
 const h=await harness(t);await h.choose([validFile(),validFile()]);assert.match(h.renderer.root.findByProps({role:'alert'}).children.join(''),/only one MP4/);await h.choose([new File(['not MP4'],'renamed.mp4',{type:'video/mp4'})]);assert.match(h.renderer.root.findByProps({role:'alert'}).children.join(''),/not a valid MP4/);assert.equal(h.uploads.length,0);assert.equal(h.changes.length,0);
});
test('a late upload never attaches to a different listing after the editor changes',async t=>{
 const h=await harness(t);await h.choose([validFile()]);await h.switchListing();assert.equal(h.input().props.disabled,false);await h.finish();assert.equal(h.changes.length,0);assert.equal(h.busy.at(-1),false);
});

test('video upload cannot start while the listing save is in flight',async t=>{
 const h=await harness(t,true);assert.equal(h.input().props.disabled,true);
 await h.choose([validFile()]);assert.equal(h.uploads.length,0);assert.equal(h.changes.length,0);
});
