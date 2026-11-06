import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
async function harness(t){
 const descriptors=new Map();function set(key,value){descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const body={style:{overflow:'auto',cursor:'',userSelect:''}},browser=Object.assign(new EventTarget(),{innerWidth:1440});set('window',browser);set('document',{body,activeElement:null});set('HTMLElement',class{});set('IS_REACT_ACT_ENVIRONMENT',true);
 const loaded={exports:{}};const source=ts.transpileModule(fs.readFileSync(root+'/components/editor-modal.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 function dependency(id){if(id==='./site-context')return {useSite:()=>({sessionPhase:'ready',reconnect(){}})};if(id==='./use-studio-text')return {useStudioText:()=>v=>v};if(id==='./language-switcher')return {LanguageSwitcher:()=>React.createElement('button',null,'EN')};return require(id);}
 vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,dependency,loaded);
 let renderer,closes=0;const content=React.createElement('input',{defaultValue:'Unsaved draft'});
 await act(async()=>{renderer=TestRenderer.create(React.createElement(loaded.exports.EditorModal,{title:'Listing',subtitle:'PROPERTY EDITOR',resizable:true,close:()=>closes++},content),{createNodeMock:element=>element.props.className?.startsWith('editor-dock')?{getBoundingClientRect:()=>({width:1120})}:null});});
 t.after(async()=>{await act(async()=>renderer.unmount());for(const [key,prior] of descriptors){if(prior)Object.defineProperty(globalThis,key,prior);else delete globalThis[key];}});
 return {renderer,body,browser,api:loaded.exports,get closes(){return closes;},dock:()=>renderer.root.findByProps({role:'dialog'}),handle:()=>renderer.root.findByProps({role:'separator'})};
}
test('listing editor resizes from the left by pointer and keyboard within viewport bounds',async t=>{
 const h=await harness(t);assert.equal(h.body.style.overflow,'hidden');assert.match(h.dock().props.className,/resizable/);assert.equal(h.handle().props['aria-orientation'],'vertical');
 const target={focus(){},setPointerCapture(){},hasPointerCapture(){return true;},releasePointerCapture(){}};
 await act(async()=>h.handle().props.onPointerDown({button:0,clientX:320,pointerId:1,currentTarget:target,preventDefault(){}}));assert.equal(h.body.style.cursor,'ew-resize');
 await act(async()=>h.handle().props.onPointerMove({clientX:100}));assert.equal(h.dock().props.style['--editor-width'],'1340px');
 await act(async()=>h.handle().props.onPointerMove({clientX:-1000}));assert.equal(h.dock().props.style['--editor-width'],'1416px');
 await act(async()=>h.handle().props.onPointerUp({pointerId:1,currentTarget:target}));assert.equal(h.body.style.cursor,'');assert.equal(h.body.style.userSelect,'');
 await act(async()=>h.handle().props.onKeyDown({key:'Home',preventDefault(){}}));assert.equal(h.dock().props.style['--editor-width'],'640px');
 await act(async()=>h.handle().props.onKeyDown({key:'ArrowLeft',preventDefault(){}}));assert.equal(h.dock().props.style['--editor-width'],'1152px');
 h.browser.innerWidth=900;await act(async()=>h.browser.dispatchEvent(new Event('resize')));assert.equal(h.dock().props.style['--editor-width'],'876px');
 assert.equal(h.api.editorWidth(400,375),351);
});
test('full-screen toggle preserves form elements and Escape closes through the guarded callback',async t=>{
 const h=await harness(t),input=h.renderer.root.findByType('input');await act(async()=>h.renderer.root.findByProps({'aria-label':'Full-screen editor'}).props.onClick());
 assert.match(h.dock().props.className,/fullscreen/);assert.equal(h.renderer.root.findAllByProps({role:'separator'}).length,0);assert.equal(h.renderer.root.findByType('input'),input);
 await act(async()=>h.renderer.root.findByProps({'aria-label':'Exit full screen'}).props.onClick());assert.doesNotMatch(h.dock().props.className,/fullscreen/);assert.equal(h.renderer.root.findByType('input'),input);
 let stopped=false;await act(async()=>h.dock().props.onKeyDown({key:'Escape',stopPropagation(){stopped=true;}}));assert.equal(h.closes,1);assert.equal(stopped,true);
 const css=fs.readFileSync(root+'/app/editor-drawer.css','utf8');assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/@media\(max-width:720px\)/);assert.match(css,/\.editor-flowing-edge/);
});
