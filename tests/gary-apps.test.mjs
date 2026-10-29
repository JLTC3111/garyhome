import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
function loader(){
 const modules=new Map();
 function load(file){
  if(modules.has(file))return modules.get(file).exports;
  const loaded={exports:{}};modules.set(file,loaded);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dep=id=>id.startsWith('.')?load(path.resolve(path.dirname(file),id+'.ts')):require(id);
  vm.runInThisContext('(function(exports,require,module){'+js+'\n})',{filename:file})(loaded.exports,dep,loaded);
  return loaded.exports;
 }
 return {components:load(root+'/shared/gary-apps/gary-apps.tsx'),catalogue:load(root+'/shared/gary-apps/catalogue.ts')};
}

async function harness(t,kind='menu',initial={}){
 const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document'),oldAct=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
 const document=new EventTarget(),listeners=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
 document.addEventListener=(type,handler)=>{listeners.add(handler);add(type,handler);};document.removeEventListener=(type,handler)=>{listeners.delete(handler);remove(type,handler);};
 Object.defineProperty(globalThis,'document',{value:document,writable:true,configurable:true});Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{value:true,writable:true,configurable:true});
 const {components}=loader(),Component=kind==='menu'?components.GaryAppsMenu:components.GaryAppsDirectory;
 let renderer,follows=0,opens=0;const focus=[],nodes=new Map();
 const props={language:'en',currentApp:'home',onFollow:()=>follows++,onOpen:()=>opens++,...initial};
 const links=()=>renderer.root.findAllByType('a').map(node=>{if(!nodes.has(node.props.href))nodes.set(node.props.href,{href:node.props.href,focus:()=>focus.push(node.props.href)});return nodes.get(node.props.href);});
 const summary={focus:()=>focus.push('summary')},details={querySelectorAll:()=>links(),contains:target=>target===summary||[...nodes.values()].includes(target)};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Component,props),{createNodeMock:element=>element.type==='details'?details:element.type==='summary'?summary:null});});
 const update=async values=>{Object.assign(props,values);await act(async()=>renderer.update(React.createElement(Component,props)));};
 const toggle=async()=>{await act(async()=>renderer.root.findByType('summary').props.onClick({preventDefault(){}}));};
 const key=async(value,target=summary)=>{let prevented=false;await act(async()=>renderer.root.findByType('details').props.onKeyDown({key:value,target,preventDefault(){prevented=true;},stopPropagation(){}}));return prevented;};
 t.after(async()=>{await act(async()=>renderer.unmount());if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;if(oldAct)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',oldAct);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 return {renderer,props,document,listeners,summary,details,links,focus,update,toggle,key,get follows(){return follows;},get opens(){return opens;}};
}

test('the shared catalogue uses the three confirmed sites and rejects cross-origin overrides',()=>{
 const {catalogue:{GARY_APPS,GARY_GOALS,garyAppHref}}=loader();
 assert.deepEqual(GARY_APPS.map(app=>app.url),['https://garyhome.vn/','https://jobs.garyhome.vn/','https://visa.garyhome.vn/']);
 assert.equal(GARY_APPS.length,3);assert.equal(GARY_GOALS.length,4);assert.equal(GARY_GOALS.find(goal=>goal.id==='travel').app,'jobs');
 assert.equal(garyAppHref('home','/homes','home'),'/homes');assert.equal(garyAppHref('jobs','/#opportunities','home'),'https://jobs.garyhome.vn/#opportunities');assert.equal(garyAppHref('jobs','/#life','jobs'),'/#life');
 for(const bad of ['https://elsewhere.invalid/','//elsewhere.invalid/path','javascript:alert(1)'])assert.throws(()=>garyAppHref('jobs',bad));
});

test('the directory renders useful server HTML with all three sites and local navigation for the current site',()=>{
 const {components:{GaryAppsDirectory,GaryAppsMenu}}=loader();
 const html=renderToString(React.createElement(React.Fragment,null,React.createElement(GaryAppsDirectory,{language:'en',currentApp:'home'}),React.createElement(GaryAppsMenu,{language:'en',currentApp:'home'})));
 for(const name of ['Gary Home','Gary Jobs','Gary Visa Service','Find a home','Find a job','Obtain a visa','Explore Vietnam'])assert.ok(html.includes(name),name);
 assert.ok(html.includes('href="/homes"'));assert.ok(html.includes('href="https://jobs.garyhome.vn/#life"'));assert.ok(html.includes('<details'));assert.ok(html.includes('<summary'));assert.ok(!html.includes('opacity:0'));
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
});

test('service links separate same-site navigation from new-tab external destinations and translate every card',async t=>{
 const h=await harness(t,'directory');
 for(const link of h.renderer.root.findAllByType('a'))if(link.props.href.startsWith('/'))assert.equal(link.props.target,undefined);else{assert.equal(link.props.target,'_blank');assert.equal(link.props.rel,'noopener noreferrer');}
 await h.update({language:'vi',currentApp:'jobs'});const content=JSON.stringify(h.renderer.toJSON());assert.match(content,/Tìm việc làm/);assert.match(content,/Du lịch Việt Nam/);assert.match(content,/Hỗ trợ visa/);assert.match(content,/Tìm nơi để gọi là nhà/);
 for(const name of ['Tìm Nhà','Tìm Việc','Dịch Vụ Visa'])assert.ok(content.includes(name),name);assert.doesNotMatch(content,/Gary (Home|Jobs|Visa Service)/);
 assert.ok(h.renderer.root.findAllByType('a').some(link=>link.props.href==='/#opportunities'));assert.ok(h.renderer.root.findAllByType('a').some(link=>link.props.href==='https://garyhome.vn/homes'));
});

test('the apps menu preserves its open state through translation, closes outside and cleans up listeners',async t=>{
 const h=await harness(t);assert.equal(h.renderer.root.findByType('details').props.open,false);assert.equal(h.listeners.size,0);
 await h.toggle();assert.equal(h.renderer.root.findByType('summary').props['aria-expanded'],true);assert.equal(h.listeners.size,1);assert.equal(h.opens,1);
 await h.update({language:'vi'});assert.equal(h.renderer.root.findByType('details').props.open,true);assert.equal(h.renderer.root.findByType('summary').props['aria-label'],'Khám phá các trang và dịch vụ Gary');
 const menu=JSON.stringify(h.renderer.toJSON());for(const name of ['Tìm Nhà','Tìm Việc','Dịch Vụ Visa'])assert.ok(menu.includes(name),name);
 await act(async()=>h.document.dispatchEvent(new Event('pointerdown')));assert.equal(h.renderer.root.findByType('details').props.open,false);assert.equal(h.listeners.size,0);
});

test('the apps disclosure supports keyboard navigation, Escape focus restoration and follow callbacks',async t=>{
 const h=await harness(t);assert.equal(await h.key('ArrowDown'),true);assert.equal(h.renderer.root.findByType('details').props.open,true);assert.equal(h.focus.at(-1),'/');
 await h.key('ArrowDown',h.links()[0]);assert.equal(h.focus.at(-1),'https://jobs.garyhome.vn/');await h.key('End',h.links()[1]);assert.equal(h.focus.at(-1),'/services#gary-services');
 await h.key('Escape',h.links()[1]);assert.equal(h.renderer.root.findByType('details').props.open,false);assert.equal(h.focus.at(-1),'summary');
 await h.toggle();await act(async()=>h.renderer.root.findAllByType('a')[1].props.onClick());assert.equal(h.follows,1);assert.equal(h.renderer.root.findByType('details').props.open,false);
});

test('focus stays inside an open apps menu but tabbing away closes the disclosure',async t=>{
 const h=await harness(t);await h.toggle();
 await act(async()=>h.renderer.root.findByType('details').props.onBlur({currentTarget:h.details,relatedTarget:h.links()[0]}));assert.equal(h.renderer.root.findByType('details').props.open,true);
 await act(async()=>h.renderer.root.findByType('details').props.onBlur({currentTarget:h.details,relatedTarget:null}));assert.equal(h.renderer.root.findByType('details').props.open,false);
});
