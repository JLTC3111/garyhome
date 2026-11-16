import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);

// Keep the actual provider, language persistence and routing helpers. Substitute
// platform/network boundaries so these regressions never contact Auth or a DB.
async function harness(t,{url='/en/homes',storedLanguage='en',serverLanguage='en'}={}){
 const originals=new Map(),install=(key,value)=>{
  originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
  Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 };
 const browser=new EventTarget();browser.location=new URL(url,'https://www.garyhome.vn');
 const page=Object.assign(new EventTarget(),{visibilityState:'visible',cookie:'gary-language='+storedLanguage,documentElement:{lang:serverLanguage,dataset:{languagePending:''}}});
 const storage=new Map([['gary-language',storedLanguage]]),navigation=[],network=[];
 let pathname=browser.location.pathname,site,renderer;
 const router={push:(href,options)=>navigation.push({method:'push',href,options}),replace:(href,options)=>navigation.push({method:'replace',href,options})};
 install('window',browser);install('document',page);install('navigator',{onLine:true,language:storedLanguage==='vi'?'vi-VN':'en-US'});
 install('localStorage',{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)});
 install('IS_REACT_ACT_ENVIRONMENT',true);
 install('fetch',async input=>{
  network.push(String(input));assert.equal(String(input),'/api/config','Unexpected network request');
  return Response.json({configured:false});
 });
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const module={exports:{}};modules.set(file,module);
  const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='next/navigation')return {usePathname:()=>pathname,useRouter:()=>router};
   if(id==='./form-validation')return {FormValidationMessages:()=>null};
   if(id==='./swipe-toast')return {SwipeToast:()=>null};
   if(id==='./react-bits/lattice-loader')return {LatticeLoader:()=>null};
   if(id==='@/lib/browser-client')return {browserClient(){assert.fail('Language navigation must not construct an authenticated client');},publicBrowserClient(){assert.fail('Unconfigured fixture must not construct a client');}};
   if(id.startsWith('.')||id.startsWith('@/')){
    const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
    const resolved=[base,base+'.ts',base+'.tsx',base+'.json'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
    assert.ok(resolved,`Resolve ${id} from ${file}`);return load(resolved);
   }
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})',{filename:file})(module.exports,dependency,module);
  return module.exports;
 }
 const {SiteProvider,useSite}=load(path.join(root,'components/site-context.tsx'));
 const initial={content:{properties:[],neighbourhoods:[],authors:[],activities:[],editorial:[],settings:{}},configured:false,error:false,publicPath:pathname,exchangeRate:{usdToVnd:25000,updatedAt:new Date(Date.now()-60000).toISOString(),nextUpdateAt:new Date(Date.now()+3600000).toISOString()}};
 function Probe(){site=useSite();return React.createElement('span',null,site.t('Find a home','Tìm nhà'));}
 // These server props deliberately stay unchanged as the persistent layout
 // observes new usePathname values, including history back/forward traversal.
 const render=()=>React.createElement(SiteProvider,{initial,initialLanguage:serverLanguage},React.createElement(Probe));
 t.after(async()=>{
  if(renderer)await act(async()=>renderer.unmount());
  for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
 });
 await act(async()=>{renderer=TestRenderer.create(render());});
 async function navigate(href){
  browser.location=new URL(href,browser.location);pathname=browser.location.pathname;
  await act(async()=>renderer.update(render()));
 }
 async function storageLanguage(value){
  storage.set('gary-language',value);
  const event=Object.assign(new Event('storage'),{key:'gary-language',newValue:value});
  await act(async()=>browser.dispatchEvent(event));
 }
 return {renderer,browser,page,storage,navigation,network,navigate,storageLanguage,get site(){return site;}};
}

test('explicit URL language wins over stale server and browser preferences during hydration',async t=>{
 const h=await harness(t,{url:'/vi/homes?district=tay-ho#results',serverLanguage:'en',storedLanguage:'en'});
 assert.equal(h.site.language,'vi');assert.equal(h.site.publicPath,'/vi/homes');
 assert.equal(h.page.documentElement.lang,'vi');assert.equal(h.page.documentElement.dataset.languagePending,undefined);
 assert.equal(h.storage.get('gary-language'),'vi');assert.equal(h.site.t('Find a home','Tìm nhà'),'Tìm nhà');
 assert.deepEqual(h.navigation,[]);assert.deepEqual(h.network,['/api/config']);
});

test('persistent provider follows back/forward pathname changes without fresh server props or lost filters',async t=>{
 const h=await harness(t,{url:'/en/homes?district=tay-ho&sort=price#results'});
 const visits=['/vi/homes?district=tay-ho&sort=price#results','/en/homes?district=tay-ho&sort=price#results','/vi/homes?district=tay-ho&sort=price#results'];
 for(const href of visits){
  h.storage.set('gary-language',href.startsWith('/vi')?'en':'vi');
  await h.navigate(href);
  const language=href.startsWith('/vi')?'vi':'en';
  assert.equal(h.site.language,language);assert.equal(h.page.documentElement.lang,language);
  assert.equal(h.site.publicPath,'/'+language+'/homes');assert.equal(h.storage.get('gary-language'),language);
  assert.equal(h.site.t('Find a home','Tìm nhà'),language==='vi'?'Tìm nhà':'Find a home');
  assert.equal(h.browser.location.pathname+h.browser.location.search+h.browser.location.hash,href);
 }
 assert.deepEqual(h.navigation,[],'History traversal must not create replacement/push loops');
 assert.deepEqual(h.network,['/api/config'],'Language history must not reconnect or refetch private data');
});

test('language switch retains detail context, repeated query values and fragment in router navigation',async t=>{
 const h=await harness(t,{url:'/en/homes/can-ho-tay-ho?amenity=Balcony&amenity=Lake+view&currency=VND#availability'});
 await act(async()=>h.site.setLanguage('vi'));
 assert.equal(h.site.language,'vi');assert.equal(h.page.documentElement.lang,'vi');
 assert.deepEqual(h.navigation,[{method:'push',href:'/vi/homes/can-ho-tay-ho?amenity=Balcony&amenity=Lake+view&currency=VND#availability',options:{scroll:false}}]);
 await h.navigate(h.navigation[0].href);
 await act(async()=>h.site.setLanguage('en'));
 assert.deepEqual(h.navigation[1],{method:'push',href:'/en/homes/can-ho-tay-ho?amenity=Balcony&amenity=Lake+view&currency=VND#availability',options:{scroll:false}});
 assert.deepEqual(h.network,['/api/config']);
});

test('cross-tab language storage updates cannot override an explicit locale URL',async t=>{
 const h=await harness(t,{url:'/vi/tips-and-news/hanoi-update?ref=newsletter#sources',serverLanguage:'vi',storedLanguage:'vi'});
 const before=h.browser.location.href;
 await h.storageLanguage('en');
 assert.equal(h.site.language,'vi');assert.equal(h.storage.get('gary-language'),'vi');assert.equal(h.page.documentElement.lang,'vi');
 assert.equal(h.browser.location.href,before);assert.deepEqual(h.navigation,[]);
});

test('private portal and auth language preferences do not prefix or navigate their routes',async t=>{
 const h=await harness(t,{url:'/admin?section=team#profile',storedLanguage:'vi'});
 assert.equal(h.site.language,'vi');
 await act(async()=>h.site.setLanguage('en'));
 assert.equal(h.site.language,'en');assert.deepEqual(h.navigation,[]);
 await h.navigate('/auth/reset?mode=password#form');
 await act(async()=>h.site.setLanguage('vi'));
 assert.equal(h.site.language,'vi');assert.deepEqual(h.navigation,[]);
 assert.equal(h.browser.location.pathname+h.browser.location.search+h.browser.location.hash,'/auth/reset?mode=password#form');
 assert.deepEqual(h.network,['/api/config']);
});
