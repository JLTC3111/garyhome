import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const require=createRequire(import.meta.url),root=path.resolve(new URL('..',import.meta.url).pathname);
function loader(overrides={}){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const result={exports:{}};cache.set(file,result);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dep(id){if(id in overrides)return overrides[id];if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.ts',base+'.tsx',base+'.json'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}return require(id);}
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(result.exports,dep,result);return result.exports;
 }
 return relative=>load(path.join(root,relative));
}
const routes=loader()('lib/localized-routes.ts');
test('public localized paths preserve filters and anchors and never prefix private routes or remote links',()=>{
 for(const value of ['/','/homes','/homes/apartment','/tips-and-news/renting','/privacy']){
  const vi=routes.localizedPath(value,'vi');assert.equal(routes.localizedRoute(vi).language,'vi');assert.equal(routes.localizedRoute(vi).path,value);assert.equal(routes.localizedPath(vi,'en'),routes.localizedPath(value,'en'));
 }
 assert.equal(routes.localizedPath('/homes?district=tay-ho#results','vi'),'/vi/homes?district=tay-ho#results');
 for(const value of ['/admin','/auth/reset','/api/admin/seo','/account','/saved','https://other.com/homes','//other.com/homes','/images/photo.jpg'])assert.equal(routes.localizedPath(value,'vi'),value);
});
test('proxy rewrites explicit language variants with verified upstream language and ignores client header spoofing',()=>{
 const {NextRequest}=require('next/server'),{proxy}=loader()('proxy.ts');
 const response=proxy(new NextRequest('https://www.garyhome.vn/vi/homes?district=tay-ho',{headers:{cookie:'gary-language=en; session=safe','x-gary-language':'en'}}));
 assert.equal(response.headers.get('x-middleware-rewrite'),'https://www.garyhome.vn/homes?district=tay-ho');
 assert.equal(response.headers.get('x-middleware-request-x-gary-language'),'vi');
 assert.equal(response.headers.get('x-middleware-request-cookie'),'session=safe; gary-language=vi');
 const legacy=proxy(new NextRequest('https://www.garyhome.vn/services',{headers:{'x-gary-language':'vi','x-gary-public-path':'/vi/services'}}));
 assert.equal(legacy.headers.get('x-middleware-request-x-gary-language'),null);assert.equal(legacy.headers.get('x-middleware-rewrite'),null);
 const privateRoute=proxy(new NextRequest('https://www.garyhome.vn/vi/admin'));assert.equal(privateRoute.headers.get('x-middleware-rewrite'),null);
});
test('retired About redirects before rendering, preserving locale instead of inheriting homepage canonical in a streamed 200 response',()=>{
 const {NextRequest}=require('next/server'),{proxy}=loader()('proxy.ts');
 for(const [source,target]of [['/about','/services'],['/en/about','/en/services'],['/vi/about','/vi/services']]){
  const response=proxy(new NextRequest('https://www.garyhome.vn'+source));assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://www.garyhome.vn'+target);
 }
});
test('server metadata has unique localized canonicals and reciprocal EN/VI alternates with explicit language taking precedence over cookies',async()=>{
 const requestHeaders=new Headers({'x-gary-language':'vi'});
 const load=loader({'next/headers':{headers:async()=>requestHeaders,cookies:async()=>({get:()=>({value:'en'})})},'./runtime-env':{runtimeEnv:{SITE_URL:'https://www.garyhome.vn'}},'./server':{loadContent:async()=>({content:{properties:[],editorial:[]},configured:false,error:false})}});
 const {pageMetadata,publicPageDescriptions}=load('lib/seo.ts');
 const {PUBLIC_LANDING_PATHS}=load('lib/public-routes.ts');
 const seen=new Set();
 for(const route of PUBLIC_LANDING_PATHS){
  const metadata=await pageMetadata(route);const preferred='https://www.garyhome.vn'+routes.localizedPath(route,'vi');
  assert.equal(metadata.alternates.canonical,preferred);assert.equal(metadata.alternates.languages.vi,preferred);assert.equal(metadata.alternates.languages.en,'https://www.garyhome.vn'+routes.localizedPath(route,'en'));assert.equal(metadata.openGraph.locale,'vi_VN');
  assert.ok(!seen.has(metadata.description),'each public landing page needs a page-specific description');seen.add(metadata.description);
  assert.equal(metadata.description,publicPageDescriptions[route][1]);
 }
 const privateMetadata=await pageMetadata('/admin',true);assert.equal(privateMetadata.alternates.canonical,'https://www.garyhome.vn/admin');assert.deepEqual(privateMetadata.alternates.languages,{});assert.equal(privateMetadata.robots.index,false);
 requestHeaders.set('x-gary-language','en');assert.equal((await pageMetadata('/homes')).alternates.canonical,'https://www.garyhome.vn/en/homes');
});
test('sitemap lists actual localized indexable pages with alternates and excludes the retired About alias',async()=>{
 const load=loader({'@/lib/server':{loadContent:async()=>({content:{properties:[],editorial:[]},configured:false,error:false})},'@/lib/seo':{siteUrl:()=> 'https://www.garyhome.vn'}});
 const entries=await load('app/sitemap.ts').default();
 assert.equal(entries.length,24);assert.ok(entries.every(entry=>/^https:\/\/www\.garyhome\.vn\/(en|vi)(?:\/|$)/.test(entry.url)));assert.ok(entries.every(entry=>!entry.url.endsWith('/about')));assert.equal(new Set(entries.map(entry=>entry.url)).size,entries.length);
 assert.ok(entries.every(entry=>entry.alternates.languages.en&&entry.alternates.languages.vi));
});
test('browser bootstrap respects explicit language URL over stale browser preference',()=>{
 const {LANGUAGE_BOOTSTRAP}=loader()('lib/language.ts');const values=new Map([['gary-language','en']]),document={documentElement:{lang:'vi',dataset:{}},cookie:''};
 vm.runInNewContext(LANGUAGE_BOOTSTRAP,{localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},location:{pathname:'/vi/homes'},document,window:{location:{protocol:'https:',pathname:'/vi/homes'}}});
 assert.equal(values.get('gary-language'),'vi');assert.match(document.cookie,/gary-language=vi/);assert.equal(document.documentElement.dataset.languagePending,undefined);
});
test('localized links are real server-rendered anchors and preserve legacy and private navigation',()=>{
 let pathname='/vi/homes';
 const Link=loader({'next/link':{__esModule:true,default:({href,...props})=>React.createElement('a',{href,...props})},'next/navigation':{usePathname:()=>pathname},'./site-context':{useSite:()=>({language:'vi'})}})('components/localized-link.tsx').default;
 assert.match(renderToStaticMarkup(React.createElement(Link,{href:'/contact'},'Contact')),/href="\/vi\/contact"/);
 assert.match(renderToStaticMarkup(React.createElement(Link,{href:'/admin'},'Studio')),/href="\/admin"/);
 pathname='/homes';assert.match(renderToStaticMarkup(React.createElement(Link,{href:'/contact'},'Contact')),/href="\/contact"/);
});
