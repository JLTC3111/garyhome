import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { ContentReadError, readPublishedContent } from '../lib/public-content.ts';
import { fetchWithDeadline } from '../lib/requests.ts';

const listingImages=['cover.jpg','floorplan.png','kitchen.webp'].map(name=>'https://public-content-test.invalid/storage/v1/object/public/property-media/'+name);
const content={editorial:[],properties:[{id:'published-home',status:'published',images:listingImages}],neighbourhoods:[{slug:'tay-ho',image:''}],settings:{id:'main',hero_title_en:'Live data',hero_image:''},authors:[],activities:[],propertyOrders:{}};
function database(fetch){return createClient('https://public-content-test.invalid','sb_publishable_test',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch}});}
function responseFor(input){const url=new URL(input),table=url.pathname.split('/').at(-1),data=table==='site_settings'?content.settings:table==='listing_authors'?content.authors:table==='site_activities'?content.activities:table==='home_public_properties'?content.properties:table==='property_display_orders'?[]:table==='editorial_articles'?content.editorial:content[table];return Response.json(Array.isArray(data)?data.slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||500)):data);}

test('the real SDK loads only published homes, retaining the ordered image URLs',async()=>{
 const calls=[];
 const result=await readPublishedContent(database(async(input,init)=>{
  calls.push({url:new URL(input),method:init.method});
  const response=responseFor(input);
  if(new Headers(init.headers).get('prefer')?.includes('count=exact')){
   const rows=await response.clone().json();
   response.headers.set('content-range',rows.length?`0-${rows.length-1}/${rows.length}`:'*/0');
  }
  return response;
 }));
 assert.deepEqual(result,content);assert.equal(calls.length,7);assert.ok(calls.every(call=>call.method==='GET'));
 assert.equal(calls.find(call=>call.url.pathname.endsWith('/home_public_properties')).url.searchParams.get('status'),'eq.published');
 assert.equal(calls.find(call=>call.url.pathname.endsWith('/site_settings')).url.searchParams.get('id'),'eq.main');
});

test('permission errors identify the failed table without embedding server messages in diagnostics',async()=>{
 const db=database(async input=>new URL(input).pathname.endsWith('/neighbourhoods')
  ?Response.json({code:'42501',message:'Private diagnostic that must not be logged'},{status:403}):responseFor(input));
 await assert.rejects(readPublishedContent(db),error=>{
  assert.ok(error instanceof ContentReadError);assert.equal(error.resource,'neighbourhoods');assert.equal(error.status,403);assert.equal(error.code,'42501');
  assert.doesNotMatch(error.message,/Private diagnostic/);return true;
 });
});

test('a missing settings row never turns a fallback into a successful live response',async()=>{
 const db=database(async input=>new URL(input).pathname.endsWith('/site_settings')
  ?Response.json({code:'PGRST116',message:'No settings row'},{status:406}):responseFor(input));
 await assert.rejects(readPublishedContent(db),error=>error instanceof ContentReadError&&error.resource==='site_settings'&&error.code==='PGRST116');
});

test('empty published results are valid and do not restore reference homes',async()=>{
 const db=database(async input=>new URL(input).pathname.endsWith('/home_public_properties')?Response.json([]):responseFor(input));
 assert.deepEqual((await readPublishedContent(db)).properties,[]);
});

test('public recovery cancellation reaches every SDK read',async()=>{
 const controller=new AbortController(),signals=[];
 const db=database(async(_input,init)=>{
  signals.push(init.signal);
  return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
 });
 const reading=readPublishedContent(db,controller.signal);
 await new Promise(resolve=>setTimeout(resolve,5));controller.abort();
 await assert.rejects(reading,ContentReadError);assert.equal(signals.length,7);assert.ok(signals.every(signal=>signal.aborted));
});

test('browser public recovery ignores stored staff tokens and login callback URLs',async t=>{
 const descriptors=new Map();
 const setGlobal=(key,value)=>{descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});};
 t.after(()=>{for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const storedReads=[],calls=[];
 setGlobal('localStorage',{getItem:key=>{storedReads.push(key);return JSON.stringify({access_token:'staff-private-token',refresh_token:'staff-refresh-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'staff'}});},setItem(){},removeItem(){}});
 setGlobal('window',Object.assign(new EventTarget(),{location:new URL('https://gary.example/#access_token=staff-private-token&refresh_token=staff-refresh-token&type=recovery')}));
 setGlobal('document',Object.assign(new EventTarget(),{visibilityState:'visible'}));
 setGlobal('fetch',async(input,init)=>{calls.push({url:new URL(input),headers:new Headers(init.headers)});return responseFor(input);});
 const source=fs.readFileSync(new URL('../lib/browser-client.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const loaded={exports:{}};
 vm.runInThisContext('(function(exports,require,module){'+compiled+'\n})')(loaded.exports,id=>id==='@supabase/supabase-js'?{createClient}:id==='./requests'?{fetchWithDeadline}:null,loaded);
 const db=loaded.exports.publicBrowserClient('https://public-content-test.invalid','sb_publishable_test');
 assert.equal((await db.auth.getSession()).data.session,null);
 assert.deepEqual(await readPublishedContent(db),content);
 assert.equal(storedReads.length,0);assert.equal(calls.length,9);
 assert.ok(calls.every(call=>call.url.pathname.startsWith('/rest/v1/')&&call.headers.get('apikey')==='sb_publishable_test'&&!call.headers.get('authorization')?.includes('staff-private-token')));
});

test('published catalogue exhausts the real SDK ranges and propagates later-page failures',async()=>{
 const homes=Array.from({length:1001},(_,id)=>({id:String(id).padStart(6,'0'),slug:'home-'+id,images:[]}));
 const offsets=[];
 const capped=database(async input=>{
  const url=new URL(input);
  if(!url.pathname.endsWith('/home_public_properties'))return responseFor(input);
  const from=Number(url.searchParams.get('offset')||0);offsets.push(from);
  assert.equal(url.searchParams.get('order'),'sort_order.asc,id.asc');
  return Response.json(homes.slice(from,from+200));
 });
 assert.deepEqual((await readPublishedContent(capped)).properties,homes);
 assert.deepEqual(offsets,[0,200,400,600,800,1000,1001]);
 const failing=database(async input=>{
  const url=new URL(input);
  return url.pathname.endsWith('/home_public_properties')&&Number(url.searchParams.get('offset'))>0
   ?Response.json({code:'42501',message:'Private failure'},{status:403}):responseFor(input);
 });
 await assert.rejects(readPublishedContent(failing),error=>error instanceof ContentReadError&&error.resource==='properties'&&error.code==='42501');
});

test('contact and staff shell reads skip the catalogue, and listing details fetch only their listing and three neighbours',async()=>{
 const queries=[];
 const property={...content.properties[0],slug:'sample-home',district_slug:'tay-ho'};
 const db=database(async input=>{
  const url=new URL(input);
  queries.push(url);
  if(url.pathname.endsWith('/home_public_properties')) {
   return Response.json(url.searchParams.has('slug')?[property]:[]);
  }
  return responseFor(input);
 });
 for(const path of ['/vi/contact','/admin']){
  queries.length=0;
  const result=await readPublishedContent(db,undefined,path);
  assert.equal(result.properties.length,0);
  assert.deepEqual([...new Set(queries.map(url=>url.pathname.split('/').at(-1)))].sort(),['neighbourhoods','site_settings']);
 }
 queries.length=0;
 const detail=await readPublishedContent(db,undefined,'/vi/homes/sample-home');
 assert.deepEqual(detail.properties,[property]);
 const listings=queries.filter(url=>url.pathname.endsWith('/home_public_properties'));
 assert.equal(listings.length,2);
 assert.equal(listings[0].searchParams.get('slug'),'eq.sample-home');
 assert.equal(listings[1].searchParams.get('district_slug'),'eq.tay-ho');
 assert.equal(listings[1].searchParams.get('limit'),'3');
 assert.equal(queries.some(url=>url.pathname.endsWith('/editorial_articles')),false);
});

test('a missing production backend leaves sample listings out of the published response',async()=>{
 const source=fs.readFileSync(new URL('../lib/server.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const result={exports:{}},process={env:{NODE_ENV:'production'}},seed={...content,editorial:[{id:'example'}]};
 vm.runInNewContext('(function(exports,require,process){'+code+'\n})')(
  result.exports,name=>({'./runtime-env':{runtimeEnv:{}},'./seed':{seed}}[name]||{}),process
 );
 const live=await result.exports.loadContent();
 assert.equal(live.error,true);
 assert.equal(live.configured,false);
 assert.equal(live.content.properties.length,0);
 assert.equal(live.content.editorial.length,0);
 process.env.NODE_ENV='development';
 const preview=await result.exports.loadContent();
 assert.equal(preview.error,false);
 assert.equal(preview.content,seed);
});
