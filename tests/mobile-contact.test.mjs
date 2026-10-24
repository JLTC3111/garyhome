import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';
import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);

async function harness(t){
 class TrackedTarget extends EventTarget{
  listeners=new Map();
  addEventListener(type,callback,options){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);super.addEventListener(type,callback,options);}
  removeEventListener(type,callback,options){this.listeners.get(type)?.delete(callback);super.removeEventListener(type,callback,options);}
  count(type){return this.listeners.get(type)?.size||0;}
 }
 const media=Object.assign(new TrackedTarget(),{matches:true}),page=new TrackedTarget(),browser=Object.assign(new TrackedTarget(),{matchMedia:()=>media});
 const globals={window:browser,document:page,IS_REACT_ACT_ENVIRONMENT:true},old=Object.entries(globals).map(([name,value])=>{const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});return [name,previous];});
 let renderer,language='en',focusCount=0;
 const site={language,content:{settings:{whatsapp_phone:'0363327342',zalo_phone:'0363327342'}},t:(en,vi)=>language==='vi'?vi:en};
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file).exports;const result={exports:{}};modules.set(file,result);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dep(id){if(id==='./site-context')return {useSite:()=>site};if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.tsx',base+'.ts'].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile()));}return require(id);}
  vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(result.exports,dep,result);return result.exports;
 }
 const {FloatingContact}=load(root+'/components/floating-contact.tsx'),view=()=>React.createElement(FloatingContact);
 const dock={contains:node=>!!node?.insideDock},toggle={focus(){focusCount++;}};
 await act(async()=>{renderer=TestRenderer.create(view(),{createNodeMock:node=>node.props.className==='mobile-contact-dock'?dock:node.props.className==='mobile-contact-toggle'?toggle:null});});
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const[name,previous]of old)if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
 return {site,page,browser,media,get renderer(){return renderer;},get focusCount(){return focusCount;},button:()=>renderer.root.findByProps({className:'mobile-contact-toggle'}),panel:()=>renderer.root.findByProps({role:'group'}),async refresh(vi){if(vi){language=vi;site.language=vi;}await act(async()=>renderer.update(view()));},async unmount(){await act(async()=>renderer.unmount());renderer=null;}};
}

test('mobile chat starts collapsed, expands accessible separate links and closes after following a service',async t=>{
 const h=await harness(t);assert.equal(h.button().props['aria-expanded'],false);assert.equal(h.panel().props.inert,true);assert.equal(h.panel().props['aria-hidden'],true);assert.equal(h.button().props['aria-controls'],h.panel().props.id);
 await act(async()=>h.button().props.onClick());assert.equal(h.button().props['aria-expanded'],true);assert.equal(h.panel().props.inert,false);
 assert.equal(h.panel().findByType('img').props.src,'/svg/contact-widget-03-transparent.svg');
 const links=h.panel().findAllByType('a');assert.deepEqual(links.map(a=>a.props.href),['https://wa.me/84363327342','https://zalo.me/0363327342']);assert.ok(links.every(a=>a.props['aria-label']&&a.props.target==='_blank'));
 await act(async()=>links[0].props.onClick());assert.equal(h.button().props['aria-expanded'],false);assert.equal(h.focusCount,1);
});
test('Escape, outside taps and viewport changes close the panel and release listeners',async t=>{
 const h=await harness(t),open=async()=>act(async()=>h.button().props.onClick());
 await open();assert.equal(h.page.count('pointerdown'),1);assert.equal(h.browser.count('keydown'),1);assert.equal(h.media.count('change'),1);
 const escape=new Event('keydown',{cancelable:true});Object.defineProperty(escape,'key',{value:'Escape'});await act(async()=>h.browser.dispatchEvent(escape));assert.equal(h.button().props['aria-expanded'],false);assert.equal(h.focusCount,1);assert.equal(h.page.count('pointerdown'),0);
 await open();const inside=new Event('pointerdown');Object.defineProperty(inside,'target',{value:{insideDock:true}});await act(async()=>h.page.dispatchEvent(inside));assert.equal(h.button().props['aria-expanded'],true);
 await act(async()=>h.page.dispatchEvent(new Event('pointerdown')));assert.equal(h.button().props['aria-expanded'],false);assert.equal(h.focusCount,1);
 await open();h.media.matches=false;await act(async()=>h.media.dispatchEvent(new Event('change')));assert.equal(h.button().props['aria-expanded'],false);assert.equal(h.browser.count('keydown'),0);
 h.media.matches=true;await open();await h.unmount();assert.equal(h.page.count('pointerdown'),0);assert.equal(h.browser.count('keydown'),0);assert.equal(h.media.count('change'),0);
});
test('language changes preserve the expanded panel and removed channels never leave dead links',async t=>{
 const h=await harness(t);await act(async()=>h.button().props.onClick());const artwork=h.panel().findByType('img');
 await h.refresh('vi');assert.equal(h.button().props['aria-label'],'Đóng lựa chọn liên hệ');assert.equal(h.button().props['aria-expanded'],true);assert.strictEqual(h.panel().findByType('img'),artwork);assert.match(h.panel().findAllByType('a')[0].props['aria-label'],/^Liên hệ Gary Home qua WhatsApp$/);
 h.site.content.settings.zalo_phone='';await h.refresh();assert.equal(h.panel().findAllByType('a').length,1);assert.equal(h.panel().findByType('a').props.href,'https://wa.me/84363327342');
 h.site.content.settings.whatsapp_phone='';await h.refresh();assert.equal(h.renderer.toJSON(),null);assert.equal(h.page.count('pointerdown'),0);
});
