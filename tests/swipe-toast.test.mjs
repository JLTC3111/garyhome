import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import ts from 'typescript';

const module = {exports:{}};
const source = ts.transpileModule(readFileSync(new URL('../components/swipe-toast.tsx',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}
}).outputText;
vm.runInThisContext(`(function(exports, require){${source}\n})`)(module.exports,createRequire(import.meta.url));
const {SwipeToast} = module.exports;

async function harness(t, options = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const page = new EventTarget(), timers = new Map();
  let now = 0, id = 0, dismissed = 0, captured, rendered;
  page.hidden = false;
  page.defaultView = {
    setTimeout(fn, delay) { const key=++id; timers.set(key,{fn,at:now+delay}); return key; },
    clearTimeout(key) { timers.delete(key); },
    performance:{now:()=>now},
    matchMedia:()=>({matches:true})
  };
  const offsets = new Map();
  const node = {
    ownerDocument:page, dataset:{}, contains:()=>false,
    setPointerCapture(key){captured=key;}, hasPointerCapture:key=>key===captured, releasePointerCapture(){captured=undefined;},
    style:{setProperty:(key,value)=>offsets.set(key,value), removeProperty:key=>offsets.delete(key)}
  };
  const view = (language = 'en') => React.createElement(SwipeToast,{language,dismiss:()=>dismissed++,...options},'Listing saved');
  await act(async()=>{rendered=TestRenderer.create(view(),{createNodeMock:()=>node});});
  t.after(async()=>{await act(async()=>rendered?.unmount()); delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
  const card = () => rendered.root.findByProps({className:'action-toast'});
  const close = () => rendered.root.findByProps({'data-success-close':true});
  const advance = async ms => {
    await act(async()=>{
      now+=ms;
      for(const [key,entry] of timers)if(entry.at<=now){timers.delete(key);entry.fn();}
    });
  };
  return {
    card, close, advance, offsets, timers, dismissed:()=>dismissed,
    translate:async()=>act(async()=>rendered.update(view('vi'))),
    visibility:async hidden=>act(async()=>{page.hidden=hidden;page.dispatchEvent(new Event('visibilitychange'));}),
    pointer:async(name,y,time)=>act(async()=>card().props[name]({
      button:0,pointerId:1,pointerType:'touch',clientY:y,timeStamp:time,currentTarget:node,target:{closest:()=>null}
    })),
    unmount:async()=>{await act(async()=>rendered.unmount());rendered=null;}
  };
}

test('default expiry pauses for hover, focus and hidden pages and survives language changes',async t=>{
  const h=await harness(t);
  await h.advance(1000);
  await act(async()=>h.card().props.onPointerEnter({pointerType:'mouse'}));
  await h.advance(10000);
  await act(async()=>{h.card().props.onFocusCapture({relatedTarget:null});h.card().props.onPointerLeave();});
  await h.advance(10000);
  await act(async()=>h.card().props.onBlurCapture({currentTarget:{contains:()=>false},relatedTarget:null}));
  await h.advance(1000);
  await h.visibility(true);
  await h.advance(10000);
  assert.equal(h.dismissed(),0);
  const card=h.card();
  await h.translate();
  assert.equal(h.card(),card);
  assert.equal(h.close().props.children,'Đóng');
  await h.visibility(false);
  await h.advance(2499);
  assert.equal(h.dismissed(),0);
  await h.advance(1);
  assert.equal(h.dismissed(),1);
});

test('downward swipe dismisses, while an upward drag and pointer cancellation keep the toast',async t=>{
  const h=await harness(t,{duration:0});
  await h.pointer('onPointerDown',100,0);
  await h.pointer('onPointerMove',20,100);
  assert.ok(Math.abs(parseFloat(h.offsets.get('--toast-offset')))<24);
  await h.pointer('onPointerUp',20,110);
  await h.pointer('onPointerDown',100,200);
  await h.pointer('onPointerMove',180,300);
  await h.pointer('onPointerCancel',180,301);
  assert.equal(h.dismissed(),0);
  assert.equal(h.offsets.size,0);
  await h.pointer('onPointerDown',100,500);
  await h.pointer('onPointerMove',150,700);
  await h.pointer('onPointerUp',150,710);
  assert.equal(h.dismissed(),1);
});

test('optional close, Escape, assertive errors and timer cleanup work without swiping',async t=>{
  const h=await harness(t,{closeButton:false,tone:'error'});
  assert.equal(h.card().props.tabIndex,0);
  assert.equal(h.card().findByProps({role:'alert'}).props['aria-atomic'],'true');
  await act(async()=>h.card().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}}));
  assert.equal(h.dismissed(),1);
  await h.unmount();
  assert.equal(h.timers.size,0);
});

test('Undo runs the supplied reversal once and Close can dismiss directly',async t=>{
  let undone=0;
  const h=await harness(t,{action:{label:'Undo',run:()=>undone++}});
  await act(async()=>h.card().findByProps({className:'action-toast-undo'}).props.onClick());
  assert.equal(undone,1);
  assert.equal(h.dismissed(),1);
  await act(async()=>h.close().props.onClick());
  assert.equal(h.dismissed(),2);
});
