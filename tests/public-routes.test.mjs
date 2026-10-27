import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as availability from '../lib/content-unavailable.ts';

const base=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const properties=JSON.parse(fs.readFileSync(path.join(base,'data/properties.json'))),editorial=JSON.parse(fs.readFileSync(path.join(base,'data/editorial.json')));
function route(file,result){
 const endpointModule={exports:{}},modules=new Map();let misses=0;
 function load(file){
  if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const dependency=id=>{
   if(id==='@/lib/content-unavailable')return availability;
   if(id==='@/lib/server')return {loadContent:async()=>result};
   if(id==='@/lib/seo')return {loadPageContent:async()=>result,propertyStructuredData:()=>({}),siteUrl:()=> 'https://gary.example'};
   if(id==='next/navigation')return {notFound(){misses++;throw new Error('NOT_FOUND');}};
   if(id==='next/headers')return {cookies:async()=>({get:()=>({value:'en'})})};
   if(id.startsWith('@/components/'))return {PropertyDetail(){},RentalGuidePage(){}};
   if(id.startsWith('@/'))return load(path.join(base,id.slice(2)+'.ts'));
   return require(id);
  };
  vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})',{filename:file})(m.exports,dependency,m);return m.exports;
 }
 Object.assign(endpointModule.exports,load(path.join(base,file)));return {page:slug=>endpointModule.exports.default({params:Promise.resolve({slug})}),get misses(){return misses;}};
}
test('a temporary content outage never publishes an incomplete fallback sitemap',async()=>{
 const failed=route('app/sitemap.ts',{error:true,content:{properties:[],editorial:[]}});
 await assert.rejects(failed.page(''),availability.ContentUnavailableError);
 const healthy=route('app/sitemap.ts',{error:false,content:{properties,editorial}});
 const urls=(await healthy.page('')).map(row=>row.url);assert.ok(urls.includes('https://gary.example/homes/'+properties[0].slug));assert.ok(urls.includes('https://gary.example/tips-and-news/'+editorial[0].slug));
});
for(const [file,slug] of [['app/homes/[slug]/page.tsx',properties[0].slug],['app/tips-and-news/[slug]/page.tsx',editorial[0].slug]]){
 test(file+' distinguishes a temporary backend failure from an absent record',async()=>{
  const failed=route(file,{error:true,content:{properties:[],editorial:[],neighbourhoods:[]}});
  await assert.rejects(failed.page(slug),availability.ContentUnavailableError);assert.equal(failed.misses,0);
  const healthy=route(file,{error:false,content:{properties:[],editorial:[],neighbourhoods:[]}});
  await assert.rejects(healthy.page(slug),/NOT_FOUND/);assert.equal(healthy.misses,1);
 });
 test(file+' renders a real published record after recovery',async()=>{
  const healthy=route(file,{error:false,content:{properties,editorial,neighbourhoods:[]}});
  const result=await healthy.page(slug);assert.ok(result);assert.equal(healthy.misses,0);
  if(file.startsWith('app/homes/'))assert.equal(result.props.children[1].props.property.id,properties[0].id,'Pass the selected server record to the detail view');
 });
}
