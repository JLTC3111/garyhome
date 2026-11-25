import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),loaded={exports:{}};
const {ImageConfigContext}=require('next/dist/shared/lib/image-config-context.shared-runtime');
const {imageConfigDefault}=require('next/dist/shared/lib/image-config');
function dependency(path) {
 const module={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(module.exports,id=>id==='./property-photo-files'?dependency('../lib/property-photo-files.ts'):require(id),module);
 return module.exports;
}
const source=ts.transpileModule(fs.readFileSync(new URL('../components/content-image.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,id=>id==='@/lib/optimized-property-images'?dependency('../lib/optimized-property-images.ts'):require(id),loaded);
const {ContentImage}=loaded.exports;
test('public raster images render real responsive optimizer URLs and retain image semantics',()=>{
 const html=renderToStaticMarkup(React.createElement(ContentImage,{src:'/images/brand/gary-home-logo.png',alt:'Gary Home',width:220,height:64,sizes:'(max-width: 640px) 193px, 220px',loading:'eager',className:'brand-test'}));
 assert.match(html,/srcSet="[^"]*\/_next\/image\?url=%2Fimages%2Fbrand/);assert.match(html,/sizes="\(max-width: 640px\) 193px, 220px"/);assert.match(html,/alt="Gary Home"/);assert.match(html,/width="220"/);assert.match(html,/class="brand-test"/);
});
test('remote CMS URLs, SVGs, GIFs and API paths remain native and never enter the image optimizer',()=>{
 for(const src of ['https://project.supabase.co/storage/v1/object/public/photo.jpg','//remote.example/photo.jpg','/svg/whatsapp.svg','/images/animated.gif','/api/private-photo']){
  const html=renderToStaticMarkup(React.createElement(ContentImage,{src,alt:'Supplied photo',width:400,height:300,loading:'lazy'}));
  assert.ok(html.includes('src="'+src+'"'));assert.doesNotMatch(html,/_next\/image|srcSet=/);
 }
});

test('legacy property transform URLs resolve to the public object through the Next optimizer',()=>{
 const prefix='https://duyiihsmaqfgwezmsnjs.supabase.co';
 const src=prefix+'/storage/v1/render/image/public/property-media/properties/room.jpg?width=200';
 const {propertyImageRemotePattern}=dependency('../lib/optimized-property-images.ts');
 const html=renderToStaticMarkup(React.createElement(ImageConfigContext.Provider,{value:{...imageConfigDefault,remotePatterns:[propertyImageRemotePattern]}},
   React.createElement(ContentImage,{src,alt:'Room',width:400,height:300,loading:'lazy'})));
 assert.match(html,/\/_next\/image\?url=/);
 assert.ok(html.includes(encodeURIComponent(prefix+'/storage/v1/object/public/property-media/properties/room.jpg')));
 assert.doesNotMatch(html,/render(%2F|\/)image|width%3D200/);
 assert.match(html,/loading="lazy"/);
});
