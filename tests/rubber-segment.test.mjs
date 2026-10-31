import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToString} from 'react-dom/server';
import ts from 'typescript';

const require=createRequire(import.meta.url),motion=require('motion/react');
const items=[{value:'en',label:'English',lang:'en'},{value:'vi',label:'Tiếng Việt',lang:'vi'}];

async function harness(t){
 const previous=new Map(),callbacks=new Set(),observers=[],animations=[],changes=[],buttons=new Map();
 const media={matches:false,addEventListener:(_type,callback)=>callbacks.add(callback),removeEventListener:(_type,callback)=>callbacks.delete(callback)};
 const browser=Object.assign(new EventTarget(),{matchMedia:()=>media});
 const values={window:browser,document:{fonts:{ready:Promise.resolve()}},IS_REACT_ACT_ENVIRONMENT:true,ResizeObserver:class{constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.closed=true;}}};
 for(const [name,value]of Object.entries(values)){previous.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});}
 const modules=new Map();
 function load(url){
  if(modules.has(url.href))return modules.get(url.href).exports;
  const loaded={exports:{}};modules.set(url.href,loaded);
  const source=ts.transpileModule(fs.readFileSync(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   // Keep real motion values and transforms; replace only frame animation and the DOM renderer.
   if(id==='motion/react')return {...motion,animate(value,target,options){animations.push({target,options});value.set(target);return Promise.resolve();},m:{div:({children,style,...props})=>React.createElement('div',{...props,style:Object.fromEntries(Object.entries(style??{}).map(([key,value])=>[key,value?.get?.()??value]))},children)}};
   if(id.startsWith('.'))return load(new URL(id+'.ts',url));
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:url.pathname})(loaded.exports,dependency,loaded);
  return loaded.exports;
 }
 const RubberSegment=load(new URL('../components/react-bits/rubber-segment.tsx',import.meta.url)).default;
 let renderer,selected,disable,focused,mounts=0;
 function Example(){
  const [value,setValue]=React.useState('en'),[disabled,setDisabled]=React.useState(false),[draft,setDraft]=React.useState('');selected=value;disable=setDisabled;
  React.useEffect(()=>{mounts++;},[]);
  return React.createElement(React.Fragment,null,React.createElement('input',{value:draft,onChange:event=>setDraft(event.target.value)}),React.createElement(RubberSegment,{items,value,disabled,'aria-label':'Language',onChange:next=>{changes.push(next);setValue(next);}}));
 }
 t.after(async()=>{
  if(renderer)await act(async()=>renderer.unmount());
  assert.equal(callbacks.size,0);assert.ok(observers.every(observer=>observer.closed));
  for(const [name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}
 });
 const nodeMock=element=>{
  if(element.props.role==='radiogroup')return {dataset:{},getBoundingClientRect:()=>({left:100,width:208})};
  if(element.props.role==='radio'){
   const index=element.props.lang==='vi'?1:0;
   const node={dataset:{},setPointerCapture(){},focus(){focused=index;},getBoundingClientRect:()=>({left:104+100*index,right:204+100*index})};buttons.set(index,node);return node;
  }
  return null;
 };
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Example),{createNodeMock:nodeMock});});
 return {renderer,RubberSegment,buttons,animations,changes,media,callbacks,get selected(){return selected;},get focused(){return focused;},get mounts(){return mounts;},disable,group:()=>renderer.root.findByProps({role:'radiogroup'}),radio:index=>renderer.root.findAllByType('button')[index]};
}

test('segments render the server selection and support native clicks, keyboard navigation and disabled controls without losing drafts',async t=>{
 const p=await harness(t),html=renderToString(React.createElement(p.RubberSegment,{items,value:'vi','aria-label':'Language'}));
 assert.equal((html.match(/role="radio"/g)||[]).length,2);assert.match(html,/<button[^>]*aria-checked="true"[^>]*lang="vi"/);
 await act(async()=>p.renderer.root.findByType('input').props.onChange({target:{value:'Keep these rental notes'}}));
 await act(async()=>p.radio(1).props.onClick({detail:0}));assert.equal(p.selected,'vi');assert.equal(p.radio(1).props.tabIndex,0);assert.equal(p.radio(0).props.tabIndex,-1);
 for(const [key,expected,index]of [['Home','en',0],['End','vi',1],['ArrowLeft','en',0],['ArrowRight','vi',1]]){
  let prevented=false;await act(async()=>p.radio(index===0?1:0).props.onKeyDown({key,preventDefault(){prevented=true;}}));assert.equal(prevented,true);assert.equal(p.selected,expected);assert.equal(p.focused,index);
 }
 await act(async()=>p.disable(true));const before=p.changes.length;
 await act(async()=>p.radio(0).props.onClick({detail:0}));assert.equal(p.selected,'vi');assert.equal(p.changes.length,before);assert.ok(p.renderer.root.findAllByType('button').every(button=>button.props.disabled));
 assert.equal(p.renderer.root.findByType('input').props.value,'Keep these rental notes');assert.equal(p.mounts,1);
});

test('drag releases commit once, canceled drags preserve selection and live reduced motion cancels pending spring handoffs',async t=>{
 const p=await harness(t),pointer=(x,time)=>({pointerId:7,clientX:x,timeStamp:time});
 await act(async()=>p.radio(0).props.onPointerDown({...pointer(154,10),button:0,currentTarget:p.buttons.get(0)}));
 await act(async()=>p.group().props.onPointerMove(pointer(176,30)));
 await act(async()=>p.group().props.onPointerMove(pointer(280,60)));
 await act(async()=>p.group().props.onPointerUp(pointer(282,80)));
 assert.equal(p.selected,'vi');assert.deepEqual(p.changes,['vi']);
 await act(async()=>p.radio(0).props.onClick({detail:1}));assert.equal(p.selected,'vi');assert.deepEqual(p.changes,['vi']);
 await act(async()=>p.radio(1).props.onPointerDown({...pointer(254,1000),button:0,currentTarget:p.buttons.get(1)}));
 await act(async()=>p.group().props.onPointerMove(pointer(240,1020)));
 await act(async()=>p.group().props.onPointerMove(pointer(130,1040)));
 await act(async()=>p.group().props.onPointerCancel(pointer(130,1060)));
 assert.equal(p.selected,'vi');assert.deepEqual(p.changes,['vi']);
 await act(async()=>p.radio(0).props.onClick({detail:1}));assert.equal(p.selected,'en');const animationCount=p.animations.length;
 await act(async()=>{p.media.matches=true;for(const callback of p.callbacks)callback();});
 assert.equal(p.group().props['data-reduced-motion'],true);await act(async()=>delay(200));assert.equal(p.animations.length,animationCount);
 await act(async()=>p.radio(1).props.onClick({detail:1}));assert.equal(p.selected,'vi');assert.equal(p.animations.length,animationCount);
});
