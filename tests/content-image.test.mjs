import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),loaded={exports:{}};
const origin='https://duyiihsmaqfgwezmsnjs.supabase.co';
const publicMedia=origin+'/storage/v1/object/public/property-media/';
function dependency(path) {
 const dependencyModule={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(dependencyModule.exports,id=>id==='./property-photo-files'?dependency('../lib/property-photo-files.ts'):require(id),dependencyModule);
 return dependencyModule.exports;
}
const source=ts.transpileModule(fs.readFileSync(new URL('../components/content-image.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,id=>id==='@/lib/optimized-property-images'?dependency('../lib/optimized-property-images.ts'):require(id),loaded);
const {ContentImage}=loaded.exports;
test('public raster images render real responsive optimizer URLs and retain image semantics',()=>{
 const html=renderToStaticMarkup(React.createElement(ContentImage,{src:'/images/brand/gary-home-logo.png',alt:'Gary Home',width:220,height:64,sizes:'(max-width: 640px) 193px, 220px',loading:'eager',className:'brand-test'}));
 assert.match(html,/srcSet="[^"]*\/_next\/image\?url=%2Fimages%2Fbrand/);assert.match(html,/sizes="\(max-width: 640px\) 193px, 220px"/);assert.match(html,/alt="Gary Home"/);assert.match(html,/width="220"/);assert.match(html,/class="brand-test"/);
});
test('remote and signed URLs, SVGs, GIFs and API paths remain native',()=>{
 for(const src of [
  origin+'/storage/v1/object/sign/property-media/private.jpg?token=fixture',
  origin+'/storage/v1/render/image/public/another-bucket/cover.jpg?width=200',
  'https://remote.example/storage/v1/render/image/public/property-media/cover.jpg?width=200',
  '//remote.example/photo.jpg','/svg/whatsapp.svg','/images/animated.gif','/api/private-photo',
 ]){
  const html=renderToStaticMarkup(React.createElement(ContentImage,{src,alt:'Supplied photo',width:400,height:300,loading:'lazy'}));
  assert.ok(html.includes('src="'+src+'"'));assert.doesNotMatch(html,/_next\/image|srcSet=/);
 }
});

test('covers, editor previews and thumbnails use the mixed-format originals when no variants exist',()=>{
 const stored=['properties/living%20room.JPG','properties/floorplan.png','properties/kitchen.webp']
  .map(key=>publicMedia+key);
 for(const presentation of [
  {width:1200,height:800,loading:'eager'},
  {width:320,height:210,loading:'lazy'},
  {width:72,height:48,loading:'lazy'},
 ]){
  const html=renderToStaticMarkup(React.createElement('div',null,stored.map(src=>
   React.createElement(ContentImage,{...presentation,src,key:src,alt:'Listing photo'}))));
  assert.deepEqual([...html.matchAll(/<img\b[^>]*\ssrc="([^"]+)"/g)].map(match=>match[1]),stored);
  assert.doesNotMatch(html,/srcset=|\/_next\/image|\/render\/image\//i);
 }
});

test('legacy property transform URLs request the same stored object directly',()=>{
 const key='properties/room%20(2).JPEG';
 const src=origin+'/storage/v1/render/image/public/property-media/'+key+'?width=200&resize=cover';
 const html=renderToStaticMarkup(React.createElement(ContentImage,{src,alt:'Room',width:400,height:300,loading:'lazy'}));
 assert.ok(html.includes('src="'+publicMedia+key+'"'));
 assert.doesNotMatch(html,/srcset=|\/_next\/image|\/render\/image\/|resize=cover/i);
 assert.match(html,/loading="lazy"/);
});
