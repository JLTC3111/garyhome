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

async function harness(t,{reduced=false,duration=4500}={}){
 const old=new Map(),timers=new Map(),page=new EventTarget(),browser=new EventTarget(),listeners=new Map(),animation=[];
 let now=0,next=0,dismissed=0,renderer;
 page.visibilityState='visible';browser.matchMedia=()=>({matches:reduced,addEventListener(){},removeEventListener(){}});
 const add=browser.addEventListener.bind(browser),remove=browser.removeEventListener.bind(browser);
 browser.addEventListener=(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);add(type,fn);};
 browser.removeEventListener=(type,fn)=>{listeners.get(type)?.delete(fn);remove(type,fn);};
 const values={IS_REACT_ACT_ENVIRONMENT:true,window:browser,document:page,ResizeObserver:class{observe(){}disconnect(){}},setTimeout:(fn,ms=0)=>{const id=++next;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
 for(const [key,value]of Object.entries(values)){old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});}
 const originalNow=Date.now;Date.now=()=>now;
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());Date.now=originalNow;for(const [key,value]of old){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const motion={
  useMotionValue(initial){const ref=React.useRef();if(!ref.current)ref.current={value:initial,get(){return this.value;},set(value){this.value=value;},stop(){}};return ref.current;},
  useTransform(input,map){return {get:()=>Array.isArray(input)?map(input.map(value=>value.get())):map(input.get())};},
  animate(value,target,options){animation.push(options);value.set(target);return Promise.resolve();},
  m:Object.fromEntries(['div','button'].map(tag=>[tag,React.forwardRef(function Surface(props,ref){return React.createElement(tag,{...props,ref},props.children);})]))
 };
 const cache=new Map();function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependency=id=>{if(id==='motion/react')return motion;if(id.startsWith('.')){const base=path.resolve(path.dirname(file),id);return load(['.tsx','.ts'].map(ext=>base+ext).find(f=>fs.existsSync(f)));}return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(module.exports,dependency,module);return module.exports;
 }
 const {SwipeToast}=load(path.join(root,'components/swipe-toast.tsx'));
 const view=(message='Property saved.',language='en')=>React.createElement(SwipeToast,{duration,dismiss:()=>dismissed++,dismissLabel:language==='vi'?'Đóng thông báo':'Dismiss notification',actionsLabel:language==='vi'?'Thao tác thông báo':'Notification actions',releaseLabel:language==='vi'?'Thả tay để đóng thông báo':'Release to dismiss'},message);
 const nodes=()=>({offsetWidth:360,setAttribute(){},removeAttribute(){},setPointerCapture(){},releasePointerCapture(){},contains:()=>false});
 await act(async()=>{renderer=TestRenderer.create(view(),{createNodeMock:nodes});});
 const host=()=>renderer.root.findByProps({className:'toast'}),surface=()=>renderer.root.findByProps({className:'swipe-row__surface'}),row=()=>renderer.root.findByProps({className:'swipe-row'});
 const advance=async ms=>{await act(async()=>{const end=now+ms;for(;;){const entry=[...timers].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await Promise.resolve();}now=end;});};
 const pointer=async(type,x,y=0)=>{await act(async()=>{const event=new Event(type);Object.assign(event,{pointerId:1,clientX:x,clientY:y});browser.dispatchEvent(event);});};
 return {renderer,host,surface,row,timers,listeners,animation,advance,pointer,dismissed:()=>dismissed,
  down:async(x=300,y=0)=>{await act(async()=>surface().props.onPointerDown({button:0,pointerId:1,clientX:x,clientY:y,pointerType:'touch',target:{closest:()=>null}}));},
  translate:async()=>{await act(async()=>renderer.update(view('Đã lưu tin đăng.','vi')));},
  hidden:async value=>{await act(async()=>{page.visibilityState=value?'hidden':'visible';page.dispatchEvent(new Event('visibilitychange'));});},
  unmount:async()=>{await act(async()=>renderer.unmount());renderer=null;}
 };
}

test('toast expiry pauses for hover, focus, hidden pages and translation preserves the remaining time',async t=>{
 const h=await harness(t);assert.equal(h.host().props.role,'status');
 await h.advance(1000);await act(async()=>h.host().props.onPointerEnter({pointerType:'mouse'}));await h.advance(10000);assert.equal(h.dismissed(),0);
 await act(async()=>h.host().props.onFocusCapture());await act(async()=>h.host().props.onPointerLeave());await h.advance(10000);assert.equal(h.dismissed(),0);
 await act(async()=>h.host().props.onBlurCapture({currentTarget:{contains:()=>false},relatedTarget:null}));
 await h.advance(1000);await h.hidden(true);await h.advance(10000);assert.equal(h.dismissed(),0);
 const row=h.row();await h.translate();assert.equal(h.row(),row);assert.equal(h.renderer.root.findByProps({className:'swipe-toast-close'}).props['aria-label'],'Đóng thông báo');
 await h.hidden(false);await h.advance(2499);assert.equal(h.dismissed(),0);await h.advance(1);assert.equal(h.dismissed(),1);
});

test('partial swipe reveals localized dismissal, pauses expiry and keyboard can close or commit it',async t=>{
 const h=await harness(t);await h.down();await h.pointer('pointermove',230);await h.pointer('pointerup',230);
 assert.equal(h.row().props['data-open'],'');await h.advance(10000);assert.equal(h.dismissed(),0);
 const toggle=()=>h.renderer.root.findByProps({className:'swipe-row__toggle'});
 await act(async()=>toggle().props.onKeyDown({key:'Escape',preventDefault(){}}));assert.equal(h.row().props['data-open'],undefined);
 await act(async()=>toggle().props.onKeyDown({key:'ArrowLeft',preventDefault(){}}));
 await act(async()=>toggle().props.onKeyDown({key:'Delete',preventDefault(){}}));await h.advance(200);assert.equal(h.dismissed(),1);
});

test('full swipe dismisses, while pointer cancellation and vertical scrolling keep the notification',async t=>{
 const h=await harness(t,{duration:0});await h.down();await h.pointer('pointermove',-100);await h.pointer('pointercancel',-100);await h.advance(1000);assert.equal(h.dismissed(),0);assert.equal(h.row().props['data-phase'],'idle');
 await h.down();await h.pointer('pointermove',290,90);await h.pointer('pointerup',290,90);assert.equal(h.dismissed(),0);assert.equal(h.row().props['data-open'],undefined);
 await h.down();await h.pointer('pointermove',-100);await h.pointer('pointerup',-100);await h.advance(200);assert.equal(h.dismissed(),1);
});

test('visible close works without swiping and unmount cancels timers and pointer listeners',async t=>{
 const h=await harness(t,{reduced:true});await act(async()=>h.renderer.root.findByProps({className:'swipe-toast-close'}).props.onClick());assert.equal(h.dismissed(),1);
 await h.down();await h.pointer('pointermove',230);await h.pointer('pointerup',230);assert.equal(h.animation.length,0,'reduced-motion snap changes position without animation');
 await h.down();assert.ok([...h.listeners.values()].some(set=>set.size));await h.unmount();assert.equal(h.timers.size,0);assert.ok([...h.listeners.values()].every(set=>set.size===0));
});
