import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {viewportBounds,clampWorkspace,resizeWorkspace,readPreference,writePreference} from '../shared/editor-workspace/geometry.js';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
async function harness(t,{busy=false,workspaceKey='property',resizable=false}={}){
 const descriptors=new Map();function set(key,value){descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const body={style:{overflow:'auto'}},calls=[],language={value:'en'};class Focusable {isConnected=true;focuses=0;focus(){this.focuses++;document.activeElement=this;}}const opener=new Focusable(),autofocusedClose=new Focusable();set('window',new EventTarget());set('document',{body,activeElement:opener});set('HTMLElement',Focusable);set('IS_REACT_ACT_ENVIRONMENT',true);
 const loaded={exports:{}};const source=ts.transpileModule(fs.readFileSync(root+'/components/editor-modal.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 function dependency(id){if(id==='./site-context')return {useSite:()=>({language:language.value,sessionPhase:'ready',reconnect(){}})};if(id==='./use-studio-text')return {useStudioText:()=>v=>v};if(id==='./site-preferences')return {SitePreferences:({studio})=>React.createElement('button',{'data-studio-preferences':studio},'Preferences')};if(id==='../shared/editor-workspace/index.js')return {attachEditorWorkspace:(element,options)=>{const call={element,options,refreshes:0,destroyed:false};calls.push(call);return {refresh(){call.refreshes++;},destroy(){call.destroyed=true;}};}};return require(id);}
 vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,dependency,loaded);
 let renderer,closes=0,submissions=0;const form=React.createElement('form',{onSubmit:event=>{event.preventDefault();submissions++;}},React.createElement('input',{defaultValue:'Unsaved draft'}),React.createElement('input',{type:'file'}),React.createElement('p',{role:'alert'},'Exact field error'),React.createElement('footer',{className:'gw-editor-actions'},React.createElement('button',{type:'submit'},'Save')));
 const render=()=>React.createElement(loaded.exports.EditorModal,{title:'Listing',subtitle:'PROPERTY EDITOR',workspaceKey,resizable,closeDisabled:busy,close:()=>closes++},form);
 const element={querySelector:selector=>({selector})};
 await act(async()=>{renderer=TestRenderer.create(render(),{createNodeMock:node=>{if(node.props.className?.startsWith('editor-dock')){document.activeElement=autofocusedClose;return element;}return null;}});});
 t.after(async()=>{await act(async()=>renderer.unmount());assert.ok(calls.every(call=>call.destroyed));assert.equal(body.style.overflow,'auto');assert.equal(opener.focuses,1,'Closing restores the original opener captured before commit autofocus');assert.equal(autofocusedClose.focuses,0,'Cleanup never restores focus to its own Close control');for(const [key,prior] of descriptors){if(prior)Object.defineProperty(globalThis,key,prior);else delete globalThis[key];}});
 return {renderer,body,calls,language,opener,autofocusedClose,render:async()=>act(async()=>renderer.update(render())),get closes(){return closes;},get submissions(){return submissions;},dock:()=>renderer.root.findByProps({role:'dialog'})};
}
test('all Home editor shells reuse one controller and keep the same form, upload and errors across locale/layout refreshes',async t=>{
 const h=await harness(t,{resizable:true});assert.equal(h.body.style.overflow,'hidden');assert.equal(document.activeElement,h.autofocusedClose,'The commit moved focus inside the editor before passive effects');assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.key,'gary-home:property');assert.equal(h.calls[0].options.anchor,'right');assert.equal(h.calls[0].options.presentation,'drawer');assert.deepEqual(h.calls[0].options.resizeEdges,['w']);assert.equal(h.calls[0].options.defaultWidth,1120);assert.ok(h.calls[0].options.header);assert.ok(h.calls[0].options.body);
 assert.equal(String(h.renderer.root.findByProps({className:'editor-flowing-edge'}).props['aria-hidden']),'true');
 assert.equal(h.dock().findAllByProps({'data-studio-preferences':true}).length,1);
 const form=h.renderer.root.findByType('form'),inputs=h.renderer.root.findAllByType('input'),error=h.renderer.root.findByProps({role:'alert'});
 h.language.value='vi';await h.render();assert.equal(h.calls.length,1);assert.equal(h.calls[0].options.language(),'vi');assert.ok(h.calls[0].refreshes>=2);assert.equal(h.renderer.root.findByType('form'),form);assert.deepEqual(h.renderer.root.findAllByType('input'),inputs);assert.equal(h.renderer.root.findByProps({role:'alert'}),error);
 await act(async()=>form.props.onSubmit({preventDefault(){}}));assert.equal(h.submissions,1);
 let stopped=false;await act(async()=>h.dock().props.onKeyDown({key:'Escape',stopPropagation(){stopped=true;}}));assert.equal(h.closes,1);assert.equal(stopped,true);
 const css=fs.readFileSync(root+'/app/editor-drawer.css','utf8');assert.match(css,/\.editor-scroll-body\{[^}]*overflow:auto/);assert.match(css,/\.gw-editor-actions\{[^}]*position:sticky/);assert.match(css,/@container editor \(max-width:720px\)/);assert.match(css,/@media\(max-width:720px\)/);
});
test('other Home content retains the original narrower drawer with its own preference key',async t=>{
 const h=await harness(t,{workspaceKey:'guide'});assert.equal(h.calls[0].options.presentation,'drawer');assert.equal(h.calls[0].options.defaultWidth,740);assert.equal(h.calls[0].options.key,'gary-home:guide');assert.deepEqual(h.calls[0].options.resizeEdges,['w']);assert.equal(h.renderer.root.findAllByProps({className:'editor-flowing-edge'}).length,0);
 const css=fs.readFileSync(root+'/app/editor-drawer.css','utf8');assert.match(css,/height:100dvh/);assert.match(css,/border-radius:0/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock\.gw-drawer/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock \.gw-editor-header \.icon-button:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--gw-accent\) 14%,var\(--gw-surface\)\);color:var\(--gw-ink\)\}/);assert.match(css,/\.editor-flowing-edge\{[^}]*linear-gradient\(180deg,#284d3e,#a6bd9b,#e7d6ab,#557c67,#284d3e\)/);assert.match(css,/keyframes editor-edge-flow/);assert.match(css,/\.editor-dock\.gw-maximized \.editor-flowing-edge,\.editor-dock\.gw-mobile \.editor-flowing-edge\{display:none\}/);assert.match(css,/prefers-reduced-motion:reduce\)\{\.editor-dock\{animation:none\}\.editor-flowing-edge\{animation:none\}/);
});
test('busy editor keeps its existing close guard for Escape, overlay and close button',async t=>{
 const h=await harness(t,{busy:true});await act(async()=>h.dock().props.onKeyDown({key:'Escape',stopPropagation(){}}));assert.equal(h.closes,0);assert.equal(h.renderer.root.findByProps({'aria-label':'Close editor'}).props.disabled,true);
 const overlay=h.renderer.root.findByProps({className:'editor-overlay'}),target={};await act(async()=>overlay.props.onClick({currentTarget:target,target}));assert.equal(h.closes,0);
});
test('shared geometry constrains every edge/corner while holding opposite edges fixed',()=>{
 const viewport={width:1440,height:1000},start={width:900,height:600,left:300,top:200};
 const northWest=resizeWorkspace(start,{x:-900,y:-900},'nw',viewport);assert.deepEqual(northWest,{width:1188,height:788,left:12,top:12});assert.equal(northWest.left+northWest.width,1200);assert.equal(northWest.top+northWest.height,800);
 assert.deepEqual(resizeWorkspace(start,{x:1000,y:1000},'se',viewport),{width:1128,height:788,left:300,top:200});
 assert.deepEqual(resizeWorkspace(start,{x:1000,y:1000},'nw',viewport),{width:640,height:400,left:560,top:400});
 for(const edge of ['n','s','e','w','ne','nw','se','sw']){const box=resizeWorkspace(start,{x:-10000,y:10000},edge,viewport);assert.ok(box.width>=640&&box.height>=400);assert.ok(box.left>=12&&box.top>=12);assert.ok(box.left+box.width<=1428&&box.top+box.height<=988);}
 assert.deepEqual(clampWorkspace({width:3000,height:3000}, {width:390,height:700}),{width:390,height:700,left:0,top:0});assert.equal(viewportBounds({width:390,height:700}).mobile,true);
});
test('shared preference protocol validates persisted size/fullscreen and survives blocked storage',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
 assert.equal(readPreference(storage,'property'),null);assert.equal(writePreference(storage,'property',{width:950,height:700,maximized:true}),true);assert.deepEqual(readPreference(storage,'property'),{width:950,height:700,maximized:true});
 values.set('property','{"schema":1,"width":-50,"height":700,"maximized":true}');assert.equal(readPreference(storage,'property'),null);
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};assert.equal(readPreference(blocked,'property'),null);assert.equal(writePreference(blocked,'property',{width:950,height:700,maximized:false}),false);
});
