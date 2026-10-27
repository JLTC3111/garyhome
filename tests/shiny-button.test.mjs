import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToString} from 'react-dom/server';
import {LazyMotion,domAnimation} from 'motion/react';
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
 const html=renderToString(React.createElement(LazyMotion,{features:domAnimation,strict:true},element));assert.match(html,/Visa support · Gary Visa Service/);assert.match(html,/data-shiny-active="false"/);assert.doesNotMatch(html,/opacity:0|scale\(0/);assert.equal((html.match(/Visa support · Gary Visa Service/g)||[]).length,1);
 await act(async()=>{renderer=TestRenderer.create(element);});const link=renderer.root.findByType('a');assert.equal(link.props.href,'https://garyvisaservice.vercel.app/');assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');assert.equal(link.findByProps({className:'shiny-button-rim'}).props['aria-hidden'],'true');
 let clicks=0;await act(async()=>renderer.update(React.createElement(ShinyButton,{onClick:()=>clicks++},'Continue')));const button=renderer.root.findByType('button');assert.equal(button.props.type,'button');button.props.onClick();assert.equal(clicks,1);
 await act(async()=>renderer.update(React.createElement(ShinyButton,{type:'submit',disabled:true},'Save')));assert.equal(renderer.root.findByType('button').props.type,'submit');assert.equal(renderer.root.findByType('button').props.disabled,true);
});
async function shineHarness(t,{canHover=false}={}){
 const old=new Map(),observers=[],intervals=new Map(),page=new EventTarget();page.visibilityState='visible';let now=0,next=0;
 const media=value=>({matches:value,listeners:new Set(),addEventListener(_type,cb){this.listeners.add(cb);},removeEventListener(_type,cb){this.listeners.delete(cb);}}),reduced=media(false),hover=media(canHover);
 const node=new EventTarget(),listeners=new Map();node.focusVisible=false;node.matches=selector=>selector===':focus-visible'&&node.focusVisible;
 const add=node.addEventListener.bind(node),remove=node.removeEventListener.bind(node);
 node.addEventListener=(type,cb)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(cb);add(type,cb);};node.removeEventListener=(type,cb)=>{listeners.get(type)?.delete(cb);remove(type,cb);};
 const values={IS_REACT_ACT_ENVIRONMENT:true,document:page,window:{matchMedia:query=>query.includes('prefers-reduced-motion')?reduced:hover},IntersectionObserver:class{constructor(cb){this.cb=cb;observers.push(this);}observe(element){this.element=element;}disconnect(){this.closed=true;}},setInterval:(callback,ms)=>{const id=++next;intervals.set(id,{callback,ms,at:now+ms});return id;},clearInterval:id=>intervals.delete(id)};
 for(const [key,value]of Object.entries(values)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});}
 let renderer;t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const [key,d]of old){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}});
 const ShinyButton=loadComponent();const view=(label='Contact us',disabled)=>disabled===undefined?React.createElement(ShinyButton,{href:'/contact'},label):React.createElement(ShinyButton,{disabled},label);
 await act(async()=>{renderer=TestRenderer.create(view(),{createNodeMock:element=>['a','button'].includes(element.type)?node:null});});
 const native=()=>renderer.root.findAll(n=>typeof n.type==='string'&&['a','button'].includes(n.type)&&n.props.className?.includes('shiny-button'))[0];
 const motion=()=>renderer.root.findAll(n=>n.props.animate&&n.props.className?.includes('shiny-button'))[0].props;
 const fire=async(type,pointerType='mouse')=>{await act(async()=>{const event=new Event(type);Object.defineProperty(event,'pointerType',{value:pointerType});node.dispatchEvent(event);});};
 const advance=async ms=>{await act(async()=>{const end=now+ms;for(;;){const due=[...intervals.values()].filter(job=>job.at<=end).sort((a,b)=>a.at-b.at)[0];if(!due)break;now=due.at;due.at+=due.ms;due.callback();}now=end;});};
 return {page,node,observers,intervals,listeners,renderer,motion,native,fire,advance,active:()=>native().props['data-shiny-active'],
  inView:async value=>{await act(async()=>observers.at(-1).cb([{isIntersecting:value}]));},
  visibility:async value=>{await act(async()=>{page.visibilityState=value;page.dispatchEvent(new Event('visibilitychange'));});},
  preference:async value=>{await act(async()=>{reduced.matches=value;for(const cb of [...reduced.listeners])cb();});},
  capability:async value=>{await act(async()=>{hover.matches=value;for(const cb of [...hover.listeners])cb();});},
  complete:async()=>{await act(async()=>motion().onAnimationComplete({'--x':'-100%'}));},
  translate:async()=>{await act(async()=>renderer.update(view('Liên hệ')));},
  disabled:async value=>{await act(async()=>renderer.update(view('Save',value)));},
  unmount:async()=>{await act(async()=>renderer.unmount());renderer=null;assert.equal(intervals.size,0);assert.ok(observers.every(o=>o.closed));assert.ok([...listeners.values()].every(set=>set.size===0));assert.equal(reduced.listeners.size,0);assert.equal(hover.listeners.size,0);},
 };
}

test('desktop shine waits for mouse hover or keyboard focus, runs once and never creates an idle timer',async t=>{
 const h=await shineHarness(t,{canHover:true});await h.inView(true);assert.equal(h.active(),false);assert.equal(h.intervals.size,0);
 await h.fire('pointerenter','touch');assert.equal(h.active(),false);
 await h.fire('pointerenter');assert.equal(h.active(),true);assert.equal(h.motion().animate['--x'],'-100%');assert.equal(h.motion().transition.repeat,0);
 await h.complete();await h.advance(120000);assert.equal(h.intervals.size,0);assert.equal(h.active(),true);
 const link=h.native();await h.translate();assert.equal(h.native(),link);assert.equal(h.active(),true);
 await h.fire('pointerleave');assert.equal(h.active(),false);assert.equal(h.motion().animate['--x'],'100%');
 await h.fire('focus');assert.equal(h.active(),false);h.node.focusVisible=true;await h.fire('focus');assert.equal(h.active(),true);
 await h.fire('blur');assert.equal(h.active(),false);await h.fire('pointerenter');assert.equal(h.active(),true);await h.inView(false);assert.equal(h.active(),false);await h.inView(true);assert.equal(h.active(),false);
 await h.unmount();
});

test('touch shine fires once per 60 seconds, preserves its schedule across translation and stops between sweeps',async t=>{
 const h=await shineHarness(t);assert.equal(h.active(),false);await h.inView(true);assert.equal(h.intervals.size,1);assert.equal(h.native().props['data-shiny-mode'],'timed');
 await h.fire('pointerenter','touch');await h.fire('focus');assert.equal(h.active(),false);
 await h.advance(30000);const link=h.native();await h.translate();assert.equal(h.native(),link);await h.advance(29999);assert.equal(h.active(),false);
 await h.advance(1);assert.equal(h.active(),true);assert.equal(h.motion().transition.repeat,0);await h.complete();assert.equal(h.active(),false);
 await h.advance(59999);assert.equal(h.active(),false);await h.advance(1);assert.equal(h.active(),true);await h.complete();assert.equal(h.active(),false);assert.equal(h.intervals.size,1);
 await h.unmount();
});

test('hidden/offscreen touch buttons have no timer, resume with a fresh minute and respect motion, disabled and input changes',async t=>{
 const h=await shineHarness(t);await h.inView(true);await h.advance(30000);await h.visibility('hidden');assert.equal(h.intervals.size,0);await h.advance(180000);assert.equal(h.active(),false);
 await h.visibility('visible');assert.equal(h.intervals.size,1);await h.advance(59999);assert.equal(h.active(),false);await h.advance(1);assert.equal(h.active(),true);await h.complete();
 await h.inView(false);assert.equal(h.intervals.size,0);await h.advance(120000);await h.inView(true);await h.advance(59999);assert.equal(h.active(),false);
 await h.preference(true);await h.inView(true);assert.equal(h.intervals.size,0);await h.advance(120000);assert.equal(h.active(),false);
 await h.preference(false);await h.inView(true);assert.equal(h.intervals.size,1);await h.disabled(true);await h.inView(true);assert.equal(h.intervals.size,0);assert.equal(h.active(),false);
 await h.disabled(false);await h.inView(true);assert.equal(h.intervals.size,1);await h.capability(true);assert.equal(h.intervals.size,0);assert.equal(h.active(),false);await h.fire('pointerenter');assert.equal(h.active(),true);
 await h.capability(false);assert.equal(h.active(),false);assert.equal(h.intervals.size,1);await h.advance(59999);assert.equal(h.active(),false);await h.advance(1);assert.equal(h.active(),true);
 await h.unmount();
});
