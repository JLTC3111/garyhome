import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
async function harness(t,role='owner'){
 const old=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let renderer,language='en',rpcError=null;const calls=[],properties=JSON.parse(fs.readFileSync(root+'/data/properties.json','utf8')).slice(0,3);
 const site={user:role?{id:'account'}:null,staffRole:role,language,content:{properties,neighbourhoods:[],propertyOrders:{}},t:(en,vi)=>language==='vi'?vi:en,setContent:change=>{site.content=change(site.content);},editorTask:async job=>job({rpc(name,input){calls.push({name,input});return {abortSignal:async()=>({error:rpcError})};}},new AbortController().signal)};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file).exports;const result={exports:{}};cache.set(file,result);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;function dep(id){if(id==='next/image')return {__esModule:true,default:props=>React.createElement('img',props)};
   if(id==='./site-context')return {useSite:()=>site};if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile()));}return require(id);}vm.runInThisContext('(function(exports,require,module){'+js+'\n})')(result.exports,dep,result);return result.exports;}
 const {PropertyOrderControls}=load(root+'/components/property-order-controls.tsx');const view=()=>React.createElement(PropertyOrderControls,{scope:'home',properties});await act(async()=>{renderer=TestRenderer.create(view());});
 t.after(async()=>{await act(async()=>renderer.unmount());if(old)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',old);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 return {renderer,calls,site,properties,async language(vi){language=vi;site.language=vi;await act(async()=>renderer.update(view()));},error(value){rpcError=value;}};
}
const button=(r,label)=>r.root.findAllByType('button').find(node=>node.props['aria-label']===label||node.children.includes(label));
test('card ordering is hidden from customers and ordinary staff',async t=>{
 const h=await harness(t,'editor');assert.equal(h.renderer.toJSON(),null);
});
test('a manager can rearrange with arrows, retain the draft through translation and save the correct scope',async t=>{
 const h=await harness(t,'manager');await act(async()=>button(h.renderer,'Arrange cards').props.onClick());
 const ids=()=>h.renderer.root.findAllByType('li').map(row=>row.findByType('strong').children.join(''));
 const initial=ids(),last=initial.at(-1);await act(async()=>button(h.renderer,`Move ${last} up`).props.onClick());const moved=ids();assert.notDeepEqual(moved,initial);
 await h.language('vi');assert.deepEqual(ids(),moved);await act(async()=>button(h.renderer,'Lưu thứ tự').props.onClick());
 assert.equal(h.calls[0].name,'save_property_order');assert.equal(h.calls[0].input.order_scope,'home');assert.deepEqual(h.calls[0].input.expected_property_ids,[]);assert.deepEqual(h.site.content.propertyOrders.home,h.calls[0].input.ordered_property_ids);assert.equal(h.renderer.root.findAllByType('li').length,0);
});
test('a conflicting order leaves the draft visible instead of claiming a save succeeded',async t=>{
 const h=await harness(t);await act(async()=>button(h.renderer,'Arrange cards').props.onClick());h.error({code:'40001'});await act(async()=>button(h.renderer,'Save order').props.onClick());assert.equal(h.renderer.root.findAllByType('li').length,3);assert.match(h.renderer.root.findByProps({role:'alert'}).children.join(''),/order changed/);assert.equal(h.site.content.propertyOrders.home,undefined);
});
