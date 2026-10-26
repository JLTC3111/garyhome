import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToString} from 'react-dom/server';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
function loadComponent(){
 const cache=new Map();function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const m={exports:{}};cache.set(file,m);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependency=id=>{
   if(id==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
   if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id)+'.ts');
   return require(id);
  };
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(m.exports,dependency,m);return m.exports;
 }
 return load(path.join(root,'components/magicui/shiny-button.tsx')).ShinyButton;
}
test('shiny links preserve native destinations and labels; normal buttons do not accidentally submit a form',async t=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let renderer;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 const ShinyButton=loadComponent(),element=React.createElement(ShinyButton,{href:'https://garyvisaservice.vercel.app/',target:'_blank',rel:'noopener noreferrer'},'Visa support · Gary Visa Service');
 const html=renderToString(element);assert.match(html,/Visa support · Gary Visa Service/);assert.match(html,/data-shiny-active="false"/);assert.doesNotMatch(html,/opacity:0|scale\(0/);
 await act(async()=>{renderer=TestRenderer.create(element);});const link=renderer.root.findByType('a');assert.equal(link.props.href,'https://garyvisaservice.vercel.app/');assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');assert.equal(link.findByProps({className:'shiny-button-glint'}).props['aria-hidden'],'true');
 let clicks=0;await act(async()=>renderer.update(React.createElement(ShinyButton,{onClick:()=>clicks++},'Continue')));const button=renderer.root.findByType('button');assert.equal(button.props.type,'button');button.props.onClick();assert.equal(clicks,1);
 await act(async()=>renderer.update(React.createElement(ShinyButton,{type:'submit',disabled:true},'Save')));assert.equal(renderer.root.findByType('button').props.type,'submit');assert.equal(renderer.root.findByType('button').props.disabled,true);
});
test('shine pauses offscreen or in a hidden tab, reacts to reduced motion and releases observers',async t=>{
 const old=new Map(),mediaListeners=new Set(),observers=[],page=new EventTarget();page.visibilityState='visible';
 const media={matches:false,addEventListener:(_type,cb)=>mediaListeners.add(cb),removeEventListener:(_type,cb)=>mediaListeners.delete(cb)};
 for(const [key,value]of Object.entries({IS_REACT_ACT_ENVIRONMENT:true,document:page,window:{matchMedia:()=>media},IntersectionObserver:class{constructor(cb){this.cb=cb;observers.push(this);}observe(node){this.node=node;}disconnect(){this.closed=true;}}})){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 let renderer;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const [key,d]of old){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}});
 const ShinyButton=loadComponent(),node={dataset:{}},view=label=>React.createElement(ShinyButton,{href:'/contact'},label);
 await act(async()=>{renderer=TestRenderer.create(view('Contact us'),{createNodeMock:element=>element.type==='a'?node:null});});
 assert.equal(node.dataset.shinyActive,'false');await act(async()=>observers.at(-1).cb([{isIntersecting:true}]));assert.equal(node.dataset.shinyActive,'true');
 const link=renderer.root.findByType('a');await act(async()=>renderer.update(view('Liên hệ')));assert.equal(renderer.root.findByType('a'),link);assert.equal(node.dataset.shinyActive,'true');
 await act(async()=>{page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));});assert.equal(node.dataset.shinyActive,'false');
 await act(async()=>{page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));});assert.equal(node.dataset.shinyActive,'true');
 await act(async()=>observers.at(-1).cb([{isIntersecting:false}]));assert.equal(node.dataset.shinyActive,'false');
 await act(async()=>{media.matches=true;for(const cb of [...mediaListeners])cb();});await act(async()=>observers.at(-1).cb([{isIntersecting:true}]));assert.equal(node.dataset.shinyActive,'false');
 await act(async()=>renderer.unmount());renderer=null;assert.equal(node.dataset.shinyActive,'false');assert.ok(observers.every(o=>o.closed));assert.equal(mediaListeners.size,0);
});
