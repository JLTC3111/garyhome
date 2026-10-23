import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {LANGUAGE_BOOTSTRAP,persistLanguage} from '../lib/language.ts';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const rental=id=>({id,status:'published',listing_type:'rent',availability:'on_request'});

function loadComponents(site){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const loadedModule={exports:{}};cache.set(file,loadedModule);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./site-context')return {useSite:()=>site.current};
   if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([target,target+'.ts',target+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(loadedModule.exports,dependency,loadedModule);
  return loadedModule.exports;
 }
 return {gallery:load(path.join(root,'components/property-gallery.tsx')),cart:load(path.join(root,'components/cart-context.tsx'))};
}

async function platform(t){
 const old=new Map(),stored=new Map();
 class HTMLElement {focus(){page.activeElement=this;this.focused=true;}}
 const opener=new HTMLElement(),first=new HTMLElement(),last=new HTMLElement();
 const page={body:{style:{overflow:'clip'}},activeElement:opener,documentElement:{lang:'en',dataset:{}},cookie:''};
 const values={IS_REACT_ACT_ENVIRONMENT:true,HTMLElement,document:page,window:{location:{protocol:'https:'}},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}};
 for(const [key,value]of Object.entries(values)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 let renderer;
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const [key,value]of old){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;},querySelectorAll(){return [first,last];}};
 return {page,stored,opener,dialog,first,last,async mount(element){await act(async()=>{renderer=TestRenderer.create(element,{createNodeMock:node=>node.type==='dialog'?dialog:null});});return renderer;}};
}

test('gallery survives image shrink/removal, unlocks scrolling and reopens without an undefined photo',async t=>{
 const p=await platform(t),site={current:{t:(en)=>en}}, {gallery:{PropertyGallery}}=loadComponents(site);
 const view=images=>React.createElement(PropertyGallery,{images,title:'A real rental'}),renderer=await p.mount(view(['one.jpg','two.jpg','three.jpg']));
 const button=label=>renderer.root.findAllByType('button').find(n=>n.props['aria-label']===label);
 await act(async()=>button('Open photo 3').props.onClick());
 assert.equal(p.dialog.open,true);assert.equal(p.page.body.style.overflow,'hidden');
 await act(async()=>renderer.update(view(['one.jpg'])));
 const stage=renderer.root.findByProps({className:'rental-lightbox-stage'});
 assert.equal(stage.findByType('img').props.src,'one.jpg');
 await act(async()=>renderer.update(view([])));
 assert.equal(p.dialog.open,false);assert.equal(p.page.body.style.overflow,'clip');
 assert.equal(renderer.root.findAllByType('dialog').length,0);
 await act(async()=>renderer.update(view(['new.jpg'])));
 await act(async()=>button('Open property gallery').props.onClick());
 assert.equal(p.dialog.open,true);
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,'new.jpg');
 await act(async()=>button('Close gallery').props.onClick());
 assert.equal(p.page.body.style.overflow,'clip');assert.equal(p.opener.focused,true);
});

test('gallery keeps its current image on translation, supports keyboard navigation, traps focus and handles failed photos',async t=>{
 const p=await platform(t),site={current:{t:en=>en}}, {gallery:{PropertyGallery}}=loadComponents(site);
 const view=()=>React.createElement(PropertyGallery,{images:['one.jpg','two.jpg'],title:'Rental'}),renderer=await p.mount(view());
 await act(async()=>renderer.root.findAllByType('button').find(n=>n.props['aria-label']==='Open photo 2').props.onClick());
 site.current.t=(_en,vi)=>vi;await act(async()=>renderer.update(view()));
 const modal=()=>renderer.root.findByType('dialog');
 assert.equal(modal().props['aria-label'],'Thư viện ảnh bất động sản');
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img').props.src,'two.jpg');
 await act(async()=>modal().props.onKeyDown({key:'ArrowRight',preventDefault(){}}));
 const photo=renderer.root.findByProps({className:'rental-lightbox-stage'}).findByType('img');assert.equal(photo.props.src,'one.jpg');
 await act(async()=>photo.props.onError());
 assert.equal(renderer.root.findByProps({className:'rental-lightbox-stage'}).findAllByType('img').length,0);
 p.page.activeElement=p.last;let prevented=false;
 await act(async()=>modal().props.onKeyDown({key:'Tab',currentTarget:p.dialog,preventDefault(){prevented=true;}}));
 assert.equal(prevented,true);assert.equal(p.page.activeElement,p.first);
 await act(async()=>modal().props.onCancel({preventDefault(){}}));
 assert.equal(p.dialog.open,false);assert.equal(p.page.activeElement,p.opener);assert.equal(p.page.body.style.overflow,'clip');
});

async function cartHarness(t,{user=null,rows={},reads=new Map(),writes=new Map()}={}){
 const p=await platform(t),calls=[];
 const client={from(table){assert.equal(table,'rental_cart');const filters={};let operation='read',payload;
  const query={select(){return this;},eq(key,value){filters[key]=value;return this;},in(key,value){filters[key]=value;return this;},abortSignal(){return this;},insert(value){operation='insert';payload=value;return this;},delete(){operation='delete';return this;},then(resolve,reject){calls.push({operation,filters:{...filters},payload});const pending=operation==='read'?reads.get(filters.user_id):writes.get(filters.user_id||payload?.user_id);return (pending?.promise||Promise.resolve({data:rows[filters.user_id]||[],error:null})).then(resolve,reject);}};return query;
 }};
 const messages=[],site={current:{user,client,sessionPhase:'ready',content:{properties:Array.from({length:14},(_,i)=>rental('p'+i))},t:en=>en,notice:m=>messages.push(m),accountTask:job=>job(client,new AbortController().signal)}};
 const {cart:{CartProvider,useCart}}=loadComponents(site);let cart;
 function Probe(){cart=useCart();return null;}
 const view=()=>React.createElement(CartProvider,null,React.createElement(Probe)),renderer=await p.mount(view());
 return {...p,calls,messages,site,reads,writes,get cart(){return cart;},async update(values){Object.assign(site.current,values);await act(async()=>renderer.update(view()));}};
}

test('guest cart persists valid rentals, caps at 12 and removes only successfully submitted selections',async t=>{
 const h=await cartHarness(t);
 for(let i=0;i<13;i++)await act(async()=>h.cart.toggle('p'+i));
 assert.equal(h.cart.ids.length,12);assert.equal(h.messages.length,1);
 assert.equal(JSON.parse(h.stored.get('gary-rental-cart')).length,12);
 await act(async()=>h.cart.toggle('not-public'));assert.equal(h.cart.ids.length,12);
 await act(async()=>h.cart.removeSubmitted(['p0','p1']));
 assert.equal(h.cart.ids.length,10);assert.ok(h.cart.ids.includes('p2'));
 assert.deepEqual(JSON.parse(h.stored.get('gary-rental-cart')),h.cart.ids);
});

test('late cart reads and writes cannot reveal a previous account’s selection',async t=>{
 const a=deferred(),b=deferred(),reads=new Map([['alice',a],['bob',b]]),h=await cartHarness(t,{user:{id:'alice'},reads});
 await h.update({user:{id:'bob'}});assert.deepEqual(h.cart.ids,[]);
 await act(async()=>a.resolve({data:[{property_id:'p0'}],error:null}));assert.deepEqual(h.cart.ids,[]);
 await act(async()=>b.resolve({data:[{property_id:'p1'}],error:null}));assert.deepEqual(h.cart.ids,['p1']);
 const write=deferred();h.writes.set('bob',write);let saving;
 await act(async()=>{saving=h.cart.toggle('p2');});
 await h.update({user:null});assert.deepEqual(h.cart.ids,[]);assert.deepEqual(h.cart.pending,[]);
 await act(async()=>{write.resolve({error:null});await saving;});assert.deepEqual(h.cart.ids,[]);
});

test('an old refresh cannot overwrite a completed cart edit',async t=>{
 const h=await cartHarness(t,{user:{id:'alice'},rows:{alice:[{property_id:'p0'}]}});
 const pending=deferred();h.reads.set('alice',pending);await act(async()=>h.cart.retry());
 await act(async()=>h.cart.toggle('p1'));assert.deepEqual(h.cart.ids,['p0','p1']);
 await act(async()=>pending.resolve({data:[{property_id:'p0'}],error:null}));
 assert.deepEqual(h.cart.ids,['p0','p1']);
});

test('concurrent additions reserve cart space while network writes are pending',async t=>{
 const h=await cartHarness(t,{user:{id:'alice'}}),pending=deferred();h.writes.set('alice',pending);
 const jobs=[];await act(async()=>{for(let i=0;i<13;i++)jobs.push(h.cart.toggle('p'+i));});
 assert.equal(h.cart.pending.length,12);assert.equal(h.messages.length,1);
 await act(async()=>{pending.resolve({error:null});await Promise.all(jobs);});
 assert.equal(h.cart.ids.length,12);assert.equal(new Set(h.cart.ids).size,12);
});

test('legacy language preferences are migrated before paint and valid language writes persist a secure cookie',async t=>{
 const p=await platform(t);p.stored.set('gary-language','vi');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);
 assert.equal(p.page.documentElement.dataset.languagePending,'');assert.match(p.page.cookie,/gary-language=vi;.*Secure/);
 persistLanguage('en');assert.equal(p.stored.get('gary-language'),'en');assert.match(p.page.cookie,/gary-language=en;/);
 delete p.page.documentElement.dataset.languagePending;p.stored.set('gary-language','untrusted');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);assert.equal(p.page.documentElement.dataset.languagePending,undefined);
});
