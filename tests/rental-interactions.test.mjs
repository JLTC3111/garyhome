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
 return {gallery:load(path.join(root,'components/property-gallery.tsx'))};
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

test('legacy language preferences are migrated before paint and valid language writes persist a secure cookie',async t=>{
 const p=await platform(t);p.stored.set('gary-language','vi');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);
 assert.equal(p.page.documentElement.dataset.languagePending,'');assert.match(p.page.cookie,/gary-language=vi;.*Secure/);
 persistLanguage('en');assert.equal(p.stored.get('gary-language'),'en');assert.match(p.page.cookie,/gary-language=en;/);
 delete p.page.documentElement.dataset.languagePending;p.stored.set('gary-language','untrusted');
 vm.runInThisContext(LANGUAGE_BOOTSTRAP);assert.equal(p.page.documentElement.dataset.languagePending,undefined);
});
