import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import postcss from 'postcss';
import {viewportBounds,clampWorkspace,resizeWorkspace,readPreference,writePreference} from '../shared/editor-workspace/geometry.js';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
async function harness(t,{busy=false,workspaceKey='property',resizable=false,width=1440}={}){
 const descriptors=new Map();function set(key,value){descriptors.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});}
 const body={style:{overflow:'auto'}},calls=[],language={value:'en'};class Focusable {isConnected=true;focuses=0;focus(){this.focuses++;document.activeElement=this;}}const opener=new Focusable(),autofocusedClose=new Focusable();set('window',new EventTarget());set('document',{body,activeElement:opener});set('HTMLElement',Focusable);set('IS_REACT_ACT_ENVIRONMENT',true);
 const loaded={exports:{}};const source=ts.transpileModule(fs.readFileSync(root+'/components/editor-modal.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 function dependency(id){if(id==='./motion-primitives/overlay-exit')return {useOverlayExit:()=>false};if(id==='./site-context')return {useSite:()=>({language:language.value,t:(en,vi)=>language.value==='vi'?vi:en,sessionPhase:'ready',reconnect(){}})};if(id==='./use-studio-text')return {useStudioText:()=>v=>v};if(id==='./listing-copy-button')return {ListingCopyButton:()=>null};if(id==='./site-preferences')return {SitePreferences:({studio})=>React.createElement('button',{'data-studio-preferences':studio},'Preferences')};if(id==='../shared/editor-workspace/index.js')return {attachEditorWorkspace:(element,options)=>{const call={element,options,refreshes:0,destroyed:false};calls.push(call);return {refresh(){call.refreshes++;},destroy(){call.destroyed=true;}};}};return require(id);}
 vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,dependency,loaded);
 let renderer,closes=0,submissions=0;const form=React.createElement('form',{onSubmit:event=>{event.preventDefault();submissions++;}},React.createElement('input',{defaultValue:'Unsaved draft'}),React.createElement('input',{type:'file'}),React.createElement('p',{role:'alert'},'Exact field error'),React.createElement('footer',{className:'gw-editor-actions'},React.createElement('button',{type:'submit'},'Save')));
 const render=()=>React.createElement(loaded.exports.EditorModal,{title:'Listing',subtitle:'PROPERTY EDITOR',workspaceKey,resizable,closeDisabled:busy,close:()=>closes++},form);
 const frames=new Map();let nextFrame=0,layouts=0;
 const viewport=Object.assign(new EventTarget(),{height:800,scale:1,offsetTop:0});
 const bodyScroll={scrollTop:0,contains:node=>node===field,getBoundingClientRect:()=>({top:64,bottom:viewport.height+viewport.offsetTop})};
 const field={matches:()=>true,getBoundingClientRect:()=>({top:459-bodyScroll.scrollTop,bottom:499-bodyScroll.scrollTop})};
 const vars=new Map(),attrs=new Map();
 const view=Object.assign(new EventTarget(),{innerWidth:width,innerHeight:800,visualViewport:viewport,
  matchMedia:()=>({get matches(){return view.innerWidth<=768;}}),
  requestAnimationFrame(callback){const id=++nextFrame;frames.set(id,callback);return id;},
  cancelAnimationFrame(id){frames.delete(id);}
 });
 const element=Object.assign(new EventTarget(),{querySelector:selector=>selector==='.editor-scroll-body'?bodyScroll:{selector},
  getBoundingClientRect(){layouts++;},ownerDocument:{defaultView:view,get activeElement(){return document.activeElement;}},
  style:{setProperty:(name,value)=>vars.set(name,value)},toggleAttribute:(name,value)=>attrs.set(name,value)});
 await act(async()=>{renderer=TestRenderer.create(render(),{createNodeMock:node=>{if(node.props.className?.startsWith('editor-dock')){if(workspaceKey!=='property')document.activeElement=autofocusedClose;return element;}if(node.props['aria-label']==='Close editor')return autofocusedClose;return null;}});});
 t.after(async()=>{await act(async()=>renderer.unmount());assert.ok(calls.every(call=>call.destroyed));assert.equal(body.style.overflow,'auto');assert.equal(opener.focuses,1,'Closing restores the original opener captured before commit autofocus');assert.equal(autofocusedClose.focuses,Number(workspaceKey==='property'),'Cleanup never restores focus to its own Close control');for(const [key,prior] of descriptors){if(prior)Object.defineProperty(globalThis,key,prior);else delete globalThis[key];}});
 return {renderer,body,calls,language,opener,autofocusedClose,frames,viewport,view,bodyScroll,field,vars,attrs,get layouts(){return layouts;},render:async()=>act(async()=>renderer.update(render())),get closes(){return closes;},get submissions(){return submissions;},dock:()=>renderer.root.findByProps({role:'dialog'})};
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
test('listing drawer commits its offscreen state and enters on the next frame without remounting the form',async t=>{
 const h=await harness(t),overlay=()=>h.renderer.root.findByProps({className:'editor-overlay'});
 const form=h.renderer.root.findByType('form');
 assert.equal(overlay().props['data-listing-drawer'],true);
 assert.equal(overlay().props['data-listing-entered'],undefined);
 assert.equal(h.layouts,1);
 assert.equal(h.frames.size,1);
 const frame=[...h.frames.values()][0];
 await act(async()=>frame());
 assert.equal(overlay().props['data-listing-entered'],true);
 assert.equal(h.renderer.root.findByType('form'),form);
 const css=fs.readFileSync(root+'/app/ui-motion.css','utf8');
 assert.match(css,/\[data-listing-drawer\][^{}]*> \.editor-dock \{\s*transform: translateX\(100%\)/);
 assert.match(css,/transition: transform 250ms/);
 assert.match(css,/\[data-listing-drawer\]\[data-ui-exiting\] > \.editor-dock \{ transition: transform 180ms/);
 assert.match(css,/\[data-listing-drawer\] > \.editor-dock\.gw-resizing \{ transition: none/);
});
test('other Home content retains the original narrower drawer with its own preference key',async t=>{
 const h=await harness(t,{workspaceKey:'guide'});assert.equal(h.calls[0].options.presentation,'drawer');assert.equal(h.calls[0].options.defaultWidth,740);assert.equal(h.calls[0].options.key,'gary-home:guide');assert.deepEqual(h.calls[0].options.resizeEdges,['w']);assert.equal(h.renderer.root.findAllByProps({className:'editor-flowing-edge'}).length,0);
 const css=fs.readFileSync(root+'/app/editor-drawer.css','utf8');assert.match(css,/height:100dvh/);assert.match(css,/border-radius:0/);assert.match(css,/prefers-reduced-motion:reduce/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock\.gw-drawer/);assert.match(css,/\.editor-dock\.gw-editor\.gw-editor\{--gw-surface:var\(--paper,#faf9f6\);--gw-ink:var\(--ink,#243c31\);--gw-line:var\(--line,#d9dfd3\)\}/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock\.gw-drawer\{--paper:var\(--home-surface\);--gw-surface:var\(--home-surface\);--gw-ink:var\(--home-text\);--gw-line:var\(--home-border\);--gw-accent:var\(--home-accent\)\}/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock :is\(\.gw-editor-header,\.gw-editor-actions\)\{background:var\(--gw-surface\);color:var\(--gw-ink\);border-color:var\(--gw-line\)\}/);assert.match(css,/html\[data-home-theme=dark\] \.editor-dock \.gw-editor-header \.icon-button:hover:not\(:disabled\)\{background:color-mix\(in srgb,var\(--gw-accent\) 14%,var\(--gw-surface\)\);color:var\(--gw-ink\)\}/);assert.match(css,/\.editor-flowing-edge\{[^}]*linear-gradient\(180deg,#284d3e,#a6bd9b,#e7d6ab,#557c67,#284d3e\)/);assert.match(css,/keyframes editor-edge-flow/);assert.match(css,/\.editor-dock\.gw-maximized \.editor-flowing-edge,\.editor-dock\.gw-mobile \.editor-flowing-edge\{display:none\}/);
 const reduced=postcss.parse(css).nodes.filter(node=>node.type==='atrule'&&node.name==='media'&&node.params==='(prefers-reduced-motion:reduce)').flatMap(node=>node.nodes);
 for(const selector of ['.editor-dock','.editor-flowing-edge','.listing-editor-tools-panel']){
  const rule=reduced.find(rule=>rule.type==='rule'&&rule.selectors.includes(selector));
  assert.equal(rule?.nodes.find(node=>node.prop==='animation')?.value,'none',selector);
 }
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

test('the listing editor follows keyboard resize and viewport pan while keeping the focused field and form',async t=>{
 const h=await harness(t,{width:390}),form=h.renderer.root.findByType('form');
 document.activeElement=h.field;
 Object.assign(h.viewport,{height:360,offsetTop:16});
 h.viewport.dispatchEvent(new Event('resize'));
 assert.equal(h.attrs.get('data-listing-keyboard'),true);
 assert.equal(h.vars.get('--listing-viewport-top'),'16px');
 assert.equal(h.bodyScroll.scrollTop,131);
 h.viewport.offsetTop=24;
 h.viewport.dispatchEvent(new Event('scroll'));
 assert.equal(h.vars.get('--listing-viewport-top'),'24px');
 h.viewport.scale=1.5;
 h.viewport.dispatchEvent(new Event('resize'));
 assert.equal(h.attrs.get('data-listing-keyboard'),false,'pinch zoom does not change the footer mode');
 assert.equal(h.vars.get('--listing-viewport-top'),'0px');
 Object.assign(h.viewport,{height:360,scale:1,offsetTop:0});
 h.view.innerWidth=768;
 h.view.dispatchEvent(new Event('resize'));
 assert.equal(h.attrs.get('data-listing-keyboard'),true);
 h.view.innerWidth=1440;
 h.view.dispatchEvent(new Event('resize'));
 assert.equal(h.attrs.get('data-listing-keyboard'),false);
 assert.equal(h.renderer.root.findByType('form'),form);
 assert.equal(document.activeElement,h.field);
});

test('phone and tablet breakpoint rules keep navigation, editor controls and themes usable at the requested widths',()=>{
 const read=name=>postcss.parse(fs.readFileSync(root+'/app/'+name+'.css','utf8'));
 const editor=read('editor-drawer'),nav=read('studio-navigation'),light=read('globals'),palette=read('public-theme'),accounts=read('header-account');
 function rules(sheet,selector,width){
  const values={};
  sheet.walkRules(rule=>{
   if(!rule.selectors.includes(selector))return;
   if(rule.parent.name==='media'){
    const limit=/^\(max-width:\s*(\d+)px\)$/.exec(rule.parent.params);
    const above=/^\(width > (\d+)px\)$/.exec(rule.parent.params);
    if(!(limit&&width<=Number(limit[1]))&&!(above&&width>Number(above[1])))return;
   }
   for(const choice of rule.nodes)if(choice.type==='decl')values[choice.prop]=choice.value;
  });
  return values;
 }
 const luminance=hex=>hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).reduce((sum,value,index)=>
  sum+[.2126,.7152,.0722][index]*(value<=.04045?value/12.92:((value+.055)/1.055)**2.4),0);
 const contrast=(ink,background)=>{
  const [low,high]=[luminance(ink),luminance(background)].sort((a,b)=>a-b);
  return (high+.05)/(low+.05);
 };
 for(const width of [320,375,390,430,768]){
  const phone=width<=680;
  assert.equal(rules(nav,'.admin-main',width).width,phone?'100%':'calc(100% - var(--studio-sidebar-width))');
  assert.equal(rules(nav,'.admin-navigation-toggle',width).display,phone?'grid':'none');
  assert.equal(rules(nav,'.admin-topbar>.back-navigation',width).display,phone?'none':undefined);
  assert.equal(rules(nav,'.admin-topbar-actions>.studio-notifications',width).display,phone?'none':undefined);
  assert.equal(rules(nav,'.studio-notifications--embedded .studio-notification-panel',width).position,phone?'static':undefined);
  assert.equal(rules(nav,'.admin-sidebar nav.branched-menu',width)['overflow-y'],'auto');
  assert.equal(rules(nav,'.admin-sidebar-bottom',width)['flex-shrink'],'0');
  assert.equal(rules(accounts,'.staff-account-menu .header-account-trigger > svg',width).display,phone?'block':undefined);
  assert.equal(rules(accounts,'.admin-shell[data-sidebar="collapsed"] .staff-account-menu .header-account-trigger > :not(.header-account-avatar)',width).display,phone?undefined:'none');
  assert.equal(rules(nav,'.admin-sidebar>.studio-label',width).display,phone?'none':undefined);
  assert.equal(rules(nav,'.admin-sidebar>.brand .brand-tagline',width).display,phone?'none':undefined);
  assert.equal(rules(editor,'[data-listing-drawer] .gw-editor-toggle',width).display,phone?'none':undefined);
  assert.equal(viewportBounds({width,height:800}).mobile,phone);
  assert.equal(rules(editor,'[data-listing-drawer] .editor-drawer>.gw-editor-header h2',width)['-webkit-line-clamp'],'2');
  assert.equal(rules(editor,'[data-listing-drawer] .editor-scroll-body',width)['overflow-x'],'hidden');
  const footer=rules(editor,'[data-listing-drawer] .editor-scroll-body .listing-editor-actions',width);
  assert.equal(footer['grid-template-columns'],'repeat(2,minmax(0,1fr))');
  assert.match(footer['padding-block'],/safe-area-inset-bottom/);
  assert.equal(rules(editor,'[data-listing-drawer] .listing-editor-actions>.button',width)['min-height'],'44px');
  const menu=rules(editor,'.listing-editor-tools-panel',width);
  assert.match(menu.width,/min\(296px,calc\(100vw - var\(--listing-inset-left\) - var\(--listing-inset-right\)\)\)/);
  assert.match(menu.animation,/home-listing-tools-in/);
  assert.equal(menu.color,'var(--ink)');
  assert.equal(menu.background,'var(--paper)');
 }
 const lightTokens=rules(light,':root',320),darkTokens=rules(palette,':root',320);
 assert.ok(contrast(lightTokens['--ink'],lightTokens['--paper'])>=4.5);
 assert.ok(contrast(darkTokens['--home-text'],darkTokens['--home-surface'])>=4.5);
 assert.equal(rules(accounts,'.staff-account-summary',320)['white-space'],'normal');
 assert.equal(rules(accounts,'.staff-account-email',320)['overflow-wrap'],'anywhere');
 assert.equal(rules(accounts,'.staff-account-role',320).color,'var(--account-secondary)');
 assert.ok(contrast(lightTokens['--ink'],rules(nav,'.admin-sidebar',320).background)>=4.5);
 assert.ok(contrast(darkTokens['--home-secondary'],darkTokens['--home-surface'])>=4.5);
});
