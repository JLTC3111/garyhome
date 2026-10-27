import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),loaded={exports:{}};
const source=ts.transpileModule(fs.readFileSync(new URL('../components/content-image.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,require,loaded);
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
