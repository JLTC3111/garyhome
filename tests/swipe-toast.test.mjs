import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import postcss from 'postcss';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import ts from 'typescript';

const module = {exports:{}};
const source = ts.transpileModule(readFileSync(new URL('../components/swipe-toast.tsx',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}
}).outputText;
vm.runInThisContext(`(function(exports, require){${source}\n})`)(module.exports,createRequire(import.meta.url));
const {SwipeToast} = module.exports;

async function harness(t, options = {}, message = 'Listing saved') {
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
  const view = (language = 'en') => React.createElement(SwipeToast,{language,dismiss:()=>dismissed++,...options},message);
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

test('the fuse bar and single timeout share the longer reading duration',async t=>{
  const h=await harness(t,{},'A'.repeat(220));
  const fuse=()=>h.card().findByProps({className:'action-toast-fuse'});
  assert.equal(fuse().type,'span');
  assert.equal(fuse().props['aria-hidden'],'true');
  assert.equal(fuse().props.style['--toast-duration'],'6700ms');
  assert.equal(h.timers.size,1);
  await h.advance(4500);
  assert.equal(h.dismissed(),0);
  await act(async()=>h.card().props.onPointerEnter({pointerType:'mouse'}));
  assert.equal(fuse().props['data-paused'],true);
  assert.equal(h.timers.size,0);
  await act(async()=>h.card().props.onPointerLeave());
  await h.advance(2200);
  assert.equal(h.dismissed(),1);
});

test('success toasts mark with the Lucide circle check',async t=>{
  const h=await harness(t);
  const icon=h.card().findByProps({className:'action-toast-mark'}).findByType('svg');
  assert.match(icon.props.className,/\blucide-circle-check\b/);
});

test('both resolved themes bind the surface, fuse edge and colors, title, icon and buttons',()=>{
  const css=postcss.parse(readFileSync(new URL('../app/swipe-toast.css',import.meta.url),'utf8'));
  const declarations=selector=>Object.fromEntries(css.nodes.find(rule=>rule.selector===selector).nodes
    .filter(node=>node.type==='decl').map(({prop,value})=>[prop,value]));
  const token=(selector,prop)=>declarations(selector)[prop].match(/^var\((--[^)]+)\)$/)[1];
  const title=token('.action-toast-content','color'), inset=token('.action-toast-fuse','inset');
  const light=declarations('.action-toast');
  const dark={...light,...declarations('html[data-home-theme="dark"] .action-toast')};
  assert.deepEqual([light['--toast-surface'],dark['--toast-surface']],['#fff','#27272a']);
  assert.deepEqual([light['--toast-fuse'],dark['--toast-fuse']],['#10b981','#ffffff']);
  assert.deepEqual([light[inset],dark[inset]],['auto 0 0','auto 0 0']);
  assert.deepEqual([light[title],dark[title]],['var(--toast-ink)','#f5f5f5']);
  assert.deepEqual([light['--toast-success-icon'],dark['--toast-success-icon']],['#171717','#ffffff']);
  const fuse=declarations('.action-toast-fuse'), button=declarations('.action-toast button');
  assert.match(fuse.background,/^linear-gradient\(\s*90deg,\s*transparent 0%,[\s\S]*var\(--toast-fuse\) 38%,\s*var\(--toast-fuse\) 62%,[\s\S]*transparent 100%\s*\)$/);
  assert.equal(fuse.animation,'action-toast-burn var(--toast-duration) linear forwards');
  assert.equal(declarations('.action-toast-fuse[data-paused]')['animation-play-state'],'paused');
  const burn=css.nodes.find(node=>node.type==='atrule'&&node.name==='keyframes'&&node.params==='action-toast-burn');
  assert.deepEqual(burn.nodes.map(frame=>[frame.selector,frame.nodes[0].value]),[['from','scaleX(1)'],['to','scaleX(0)']]);
  assert.deepEqual([button.background,button.color,button.height,button['border-radius']],['var(--toast-title)','var(--toast-surface)','24px','5px']);
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
  assert.equal(h.card().findByProps({className:'action-toast-mark'}).children.join(''),'×');
  assert.equal(h.card().findByProps({role:'alert'}).props['aria-atomic'],'true');
  await act(async()=>h.card().props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}}));
  assert.equal(h.dismissed(),1);
  await h.unmount();
  assert.equal(h.timers.size,0);
});

test('Undo runs the supplied reversal once and Close can dismiss directly',async t=>{
  let undone=0;
  const h=await harness(t,{action:{label:'Undo',run:()=>undone++}});
  await act(async()=>h.card().findByProps({className:'action-toast-undo'}).props.onClick({detail:1}));
  assert.equal(undone,1);
  assert.equal(h.dismissed(),1);
  await act(async()=>h.close().props.onClick({detail:0}));
  assert.equal(h.dismissed(),2);
});
