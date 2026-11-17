import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const origin='https://www.garyhome.vn';

// Exercise the public route/Metadata API contracts with deterministic CMS data.
// This does not request the backend or mutate Auth, Storage or application data.
function loader(overrides={}){
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  const module={exports:{}};modules.set(file,module);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependency=id=>{
   if(Object.hasOwn(overrides,id))return overrides[id];
   if(id.startsWith('.')||id.startsWith('@/')){
    const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);
    const resolved=[base,base+'.ts',base+'.tsx',base+'.json'].find(item=>fs.existsSync(item)&&fs.statSync(item).isFile());
    assert.ok(resolved,`Resolve ${id} from ${file}`);return load(resolved);
   }
   return require(id);
  };
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(module.exports,dependency,module);
  return module.exports;
 }
 return relative=>load(path.join(root,relative));
}

const routes=loader()('lib/localized-routes.ts');
const {NextRequest}=require('next/server');

test('all indexable page types preserve exact query/hash context when switching locale',()=>{
 const {PUBLIC_LANDING_PATHS}=loader()('lib/public-routes.ts');
 for(const base of [...PUBLIC_LANDING_PATHS,'/homes/can-ho-tay-ho','/tips-and-news/hanoi-rental-update']){
  const context='?district=tay-ho&amenity=Lake+view&amenity=Balcony&page=2#availability';
  const vi=routes.localizedPath(base+context,'vi');
  const en=routes.localizedPath(vi,'en');
  assert.equal(vi,'/vi'+(base==='/'?'':base)+context);
  assert.equal(en,'/en'+(base==='/'?'':base)+context);
  assert.equal(routes.localizedPath(en,'vi'),vi);
 }
 for(const value of ['/admin?tab=team#profile','/account','/login','/saved','/cart','/auth/reset?code=abc','/api/config','/images/home.jpg','/favicon.ico','https://example.org/homes','//example.org/homes']){
  assert.equal(routes.localizedPath(value,'vi'),value,`Do not localize ${value}`);
 }
});

test('legacy public pages redirect permanently and deterministically, preserving deep links and query',()=>{
 const {proxy}=loader()('proxy.ts');
 const query='?district=tay-ho&sort=price&amenity=Balcony&amenity=Lake+view';
 for(const host of ['garyhome.vn','www.garyhome.vn']){
  for(const [source,target]of [['/','/en'],['/homes','/en/homes'],['/homes/can-ho-tay-ho','/en/homes/can-ho-tay-ho'],['/tips-and-news/hanoi-update','/en/tips-and-news/hanoi-update'],['/about','/en/services']]){
   const response=proxy(new NextRequest('https://'+host+source+query,{headers:{cookie:'gary-language=vi','accept-language':'vi-VN,vi;q=0.9','x-gary-language':'vi'}}));
   assert.equal(response.status,308,source);
   assert.equal(response.headers.get('location'),origin+target+query,source);
  }
 }
});

test('explicit public locales normalize host and trailing slash without changing language or parameters',()=>{
 const {proxy}=loader()('proxy.ts');
 for(const [source,target]of [['/vi/','/vi'],['/en/homes/','/en/homes'],['/vi/about','/vi/services'],['/en/about/','/en/services']]){
  const response=proxy(new NextRequest('https://www.garyhome.vn'+source+'?ref=search'));
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),origin+target+'?ref=search');
 }
 for(const language of ['en','vi']){
  const response=proxy(new NextRequest('https://garyhome.vn/'+language+'/homes/can-ho?view=map'));
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),origin+'/'+language+'/homes/can-ho?view=map');
 }
});

test('explicit locale routes use URL language over stale preferences and retain the public request path',()=>{
 const {proxy}=loader()('proxy.ts');
 for(const [language,stale]of [['en','vi'],['vi','en']]){
  const response=proxy(new NextRequest(origin+'/'+language+'/homes/can-ho?ref=search',{headers:{cookie:`gary-language=${stale}; session=safe`,'x-gary-language':stale,'x-gary-public-path':'/spoofed','accept-language':stale}}));
  assert.equal(response.headers.get('x-middleware-rewrite'),null);
  assert.equal(response.headers.get('x-middleware-request-x-gary-language'),language);
  assert.equal(response.headers.get('x-middleware-request-x-gary-public-path'),'/'+language+'/homes/can-ho');
  assert.match(response.headers.get('x-middleware-request-cookie'),/session=safe/);
  assert.match(response.headers.get('x-middleware-request-cookie'),new RegExp('gary-language='+language));
 }
});

test('staff/auth/API/assets do not receive public locale or hostname redirects; preview remains testable',()=>{
 const {proxy}=loader()('proxy.ts');
 for(const pathname of ['/login','/account','/auth/reset','/api/config','/favicon.ico','/favicon.png','/images/home.jpg']){
  const response=proxy(new NextRequest('https://www.garyhome.vn'+pathname,{headers:{'x-gary-language':'vi','x-gary-public-path':'/vi/homes'}}));
  assert.equal(response.headers.get('location'),null,pathname);
  assert.equal(response.headers.get('x-middleware-rewrite'),null,pathname);
  assert.equal(response.headers.get('x-middleware-request-x-gary-language'),null,pathname);
 }
 const staff='https://staff.garyhome.vn/admin';
 for(const [source,query] of [['https://www.garyhome.vn/admin',''],['https://www.garyhome.vn/admin/','?tab=team'],['https://garyhome.vn/en/admin','?tab=team'],['https://www.garyhome.vn/vi/admin','?section=seo']]){
  const response=proxy(new NextRequest(source+query));
  assert.equal(response.status,308,source);
  assert.equal(response.headers.get('location'),staff+query,source);
 }
 for(const source of ['https://staff.garyhome.vn/','https://staff.garyhome.vn/en/admin?tab=team','https://staff.garyhome.vn/admin/']){
  const response=proxy(new NextRequest(source));
  assert.equal(response.status,308,source);
  assert.equal(response.headers.get('location'),source.includes('tab=team')?staff+'?tab=team':staff,source);
 }
 const stay=proxy(new NextRequest('https://staff.garyhome.vn/admin?tab=team'));
 assert.equal(stay.headers.get('location'),null);
 assert.equal(stay.headers.get('x-middleware-request-x-gary-language'),null);
 const staffHome=proxy(new NextRequest('https://staff.garyhome.vn/homes?view=map'));
 assert.equal(staffHome.status,308);assert.equal(staffHome.headers.get('location'),origin+'/en/homes?view=map');
 const staffAccount=proxy(new NextRequest('https://staff.garyhome.vn/en/account?next=saved'));
 assert.equal(staffAccount.headers.get('location'),origin+'/account?next=saved');
 const staffAuth=proxy(new NextRequest('https://staff.garyhome.vn/auth/reset?code=abc'));
 assert.equal(staffAuth.headers.get('location'),null);
 for(const [source,target] of [['https://customers.garyhome.vn/','/account'],['https://customers.garyhome.vn/account?ref=email','/account?ref=email'],['https://customers.garyhome.vn/vi/account','/account'],['https://customers.garyhome.vn/auth/reset?code=abc','/auth/reset?code=abc'],['https://customers.garyhome.vn/en/homes?view=map','/en/homes?view=map']]){
  const response=proxy(new NextRequest(source));
  assert.equal(response.status,308,source);
  assert.equal(response.headers.get('location'),origin+target,source);
 }
 const previewAdmin=proxy(new NextRequest('http://localhost:3000/admin'));
 assert.equal(previewAdmin.headers.get('location'),null);
 const preview=proxy(new NextRequest('http://localhost:3000/vi/homes?view=map'));
 assert.equal(preview.headers.get('location'),null);
 assert.equal(preview.headers.get('x-middleware-rewrite'),null);
 assert.equal(preview.headers.get('x-middleware-request-x-gary-language'),'vi');
});

test('property and news metadata have distinct translations, self canonicals and reciprocal alternates',async()=>{
 const properties=JSON.parse(fs.readFileSync(path.join(root,'data/properties.json'),'utf8'));
 const editorial=JSON.parse(fs.readFileSync(path.join(root,'data/editorial.json'),'utf8'));
 const neighbourhoods=[];
 const requestHeaders=new Headers();
 const load=loader({'next/headers':{headers:async()=>requestHeaders,cookies:async()=>({get:()=>({value:requestHeaders.get('x-gary-language')==='vi'?'en':'vi'})})},'./runtime-env':{runtimeEnv:{SITE_URL:'https://garyhome.vn'}},'./server':{loadContent:async()=>({content:{properties,editorial,neighbourhoods},configured:false,error:false})}});
 const seo=load('lib/seo.ts'),property=properties.find(row=>row.status==='published'),article=editorial.find(row=>row.status==='published');
 assert.ok(property&&article,'Use actual published fixtures');
 const paired=[];
 for(const language of ['en','vi']){
  requestHeaders.set('x-gary-language',language);
  const results=[await seo.propertyMetadata(property.slug),await seo.guideMetadata(article.slug)];
  for(const [index,path]of ['/homes/'+property.slug,'/tips-and-news/'+article.slug].entries()){
   const meta=results[index],expected=origin+'/'+language+path;
   assert.equal(meta.alternates.canonical,expected);
   assert.equal(meta.openGraph.url,expected);
   assert.equal(meta.alternates.languages.en,origin+'/en'+path);
   assert.equal(meta.alternates.languages.vi,origin+'/vi'+path);
   assert.equal(meta.openGraph.locale,language==='vi'?'vi_VN':'en_US');
   assert.ok(meta.title.absolute.length>10);assert.ok(meta.description.length>30);
  }
  assert.equal(results[1].title.absolute,article['title_'+language]+' | Gary Home');
  assert.equal(results[1].description,article['summary_'+language]);
  paired.push(results);
 }
 for(const index of [0,1]){
  assert.notEqual(paired[0][index].title.absolute,paired[1][index].title.absolute);
  assert.notEqual(paired[0][index].description,paired[1][index].description);
 }
});

test('sitemap pairs every published record across locales and excludes drafts, private and legacy URLs',async()=>{
 const properties=JSON.parse(fs.readFileSync(path.join(root,'data/properties.json'),'utf8'));
 const editorial=JSON.parse(fs.readFileSync(path.join(root,'data/editorial.json'),'utf8'));
 const property=properties.find(row=>row.status==='published'),article=editorial.find(row=>row.status==='published');
 const content={properties:[property,{...property,id:'draft-property',slug:'private-draft-property',status:'draft'}],editorial:[article,{...article,id:'draft-article',slug:'private-draft-article',status:'draft'}]};
 const load=loader({'@/lib/server':{loadContent:async()=>({content,configured:false,error:false})},'@/lib/seo':{siteUrl:()=>origin}});
 const entries=await load('app/sitemap.ts').default();
 const urls=new Set(entries.map(entry=>entry.url));
 const {PUBLIC_LANDING_PATHS}=load('lib/public-routes.ts');
 assert.equal(entries.length,(PUBLIC_LANDING_PATHS.length+2)*2);
 assert.equal(urls.size,entries.length);
 for(const entry of entries){
  const url=new URL(entry.url),locale=routes.localizedRoute(url.pathname);
  assert.equal(url.origin,origin);assert.ok(locale,'Every sitemap URL has a locale');
  assert.ok(!entry.url.includes('private-draft'));assert.equal(url.search,'');assert.equal(url.hash,'');
  assert.equal(entry.alternates.languages[locale.language],entry.url);
  for(const language of ['en','vi'])assert.ok(urls.has(entry.alternates.languages[language]),'Alternate is present in sitemap');
 }
 for(const language of ['en','vi']){
  assert.ok(urls.has(origin+'/'+language+'/homes/'+property.slug));
  assert.ok(urls.has(origin+'/'+language+'/tips-and-news/'+article.slug));
 }
});
