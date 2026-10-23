import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {createRequire} from 'node:module';import React from 'react';import TestRenderer,{act} from 'react-test-renderer';import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
async function harness(t){
 class Element{}class HTMLElement extends Element{}
 const browser=Object.assign(new EventTarget(),{Element,HTMLElement,history:{length:1}}),document=Object.assign(new EventTarget(),{body:{style:{}},documentElement:{}});
 class FormDataBoundary{constructor(values){this.values=values;}get(name){return this.values[name]??null;}}
 const globals={window:browser,document,Element,HTMLElement,FormData:FormDataBoundary,IS_REACT_ACT_ENVIRONMENT:true},previous=Object.entries(globals).map(([k,v])=>{const old=Object.getOwnPropertyDescriptor(globalThis,k);Object.defineProperty(globalThis,k,{value:v,writable:true,configurable:true});return [k,old];});
 let renderer,language='en',pathname='/',responseError=null;const calls=[],navigation=[];
 const property={id:'c6e53881-53a0-45cf-bdce-7fe020b0a610',listing_code:'GH-000001',status:'published',listing_type:'rent',availability:'on_request',address:'Hanoi'};
 const site={user:null,configured:true,content:{properties:[property],settings:{contact_phone:'+84 356 175 046'}},t:(en,vi)=>language==='vi'?vi:en,accountTask:async job=>job({auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}})}},new AbortController().signal)};
 const modules=new Map();function load(file){if(modules.has(file))return modules.get(file).exports;const m={exports:{}};modules.set(file,m);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;function dep(id){
  if(id==='./site-context')return {useSite:()=>site};if(id==='next/link')return {__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
  if(id==='next/navigation')return {usePathname:()=>pathname,useRouter:()=>({back:()=>navigation.push('back'),push:href=>navigation.push(href)})};
  if(id==='@/lib/requests')return {fetchWithDeadline:async(url,init)=>{calls.push({url,headers:init.headers,body:JSON.parse(init.body)});if(responseError)throw responseError;return Response.json({ok:true},{status:201});}};
  if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.ts',base+'.tsx'].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile()));}return require(id);
 }vm.runInThisContext('(function(exports,require,module){'+code+'\n})',{filename:file})(m.exports,dep,m);return m.exports;}
 let component,props;async function render(name,nextProps={}){component=load(root+'/components/'+(name==='BackNavigation'?'back-navigation':'customer-submission-form')+'.tsx')[name];props=nextProps;await act(async()=>{renderer=TestRenderer.create(React.createElement(component,props));});return renderer;}
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());for(const[k,old]of previous)if(old)Object.defineProperty(globalThis,k,old);else delete globalThis[k];});
 return {site,property,calls,navigation,browser,render,get renderer(){return renderer;},path(value){pathname=value;},error(value){responseError=value;},async language(value){language=value;await act(async()=>renderer.update(React.createElement(component,props)));}};
}
test('back navigation uses browser history and a safe direct-entry fallback with translated labels',async t=>{
 const h=await harness(t);h.path('/homes/example');const r=await h.render('BackNavigation');await act(async()=>r.root.findByType('button').props.onClick());assert.deepEqual(h.navigation,['/homes']);
 h.browser.history.length=3;await act(async()=>r.root.findByType('button').props.onClick());assert.deepEqual(h.navigation,['/homes','back']);await h.language('vi');assert.equal(r.root.findByType('button').props['aria-label'],'Quay lại trang trước');h.path('/');await h.language('en');assert.equal(r.toJSON(),null);
});
test('feedback retains its selected rating through language changes and sends an authenticated private submission',async t=>{
 const h=await harness(t);h.site.user={id:'customer',email:'customer@example.invalid'};const r=await h.render('CustomerSubmissionForm',{kind:'feedback'});
 await act(async()=>r.root.findAllByType('input').find(n=>n.props.name==='rating'&&n.props.value===4).props.onChange());await h.language('vi');assert.equal(r.root.findAllByType('input').find(n=>n.props.name==='rating'&&n.props.value===4).props.checked,true);
 await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{name:'A Customer',email:'customer@example.invalid',consent:'on',publish_consent:null,message:'A helpful experience.'}}));
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/feedback');assert.equal(h.calls[0].headers.Authorization,'Bearer test-session');assert.equal(h.calls[0].body.rating,4);assert.equal(h.calls[0].body.publish_consent,false);assert.ok(!('user_id' in h.calls[0].body));assert.ok(r.root.findByProps({role:'status'}));
});
test('assistance records the linked property and who, where and when without creating a viewing request',async t=>{
 const h=await harness(t),r=await h.render('CustomerSubmissionForm',{kind:'assistance',property:h.property});
 const fields={name:'A Customer',email:'customer@example.invalid',consent:'on',helper_name:'Named Helper',channel:'zalo',helped_where:'Zalo conversation',helped_on:'2026-01-12',helped_time:'14:30',notes:'The viewing introduction'};
 await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:fields}));
 assert.equal(h.calls[0].url,'/api/assistance');for(const key of ['helper_name','channel','helped_where','helped_on','helped_time'])assert.equal(h.calls[0].body[key],fields[key]);assert.equal(h.calls[0].body.property_id,h.property.id);assert.ok(!('preferred_date' in h.calls[0].body));assert.ok(!('status' in h.calls[0].body));
});
test('an ambiguous timeout leaves the form available and never automatically replays a submission',async t=>{
 const h=await harness(t),r=await h.render('CustomerSubmissionForm',{kind:'feedback'});h.error(Error('Timed out'));
 await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){},currentTarget:{name:'A Customer',email:'customer@example.invalid',consent:'on',message:'A helpful experience.'}}));
 assert.equal(h.calls.length,1);assert.match(r.root.findByProps({role:'alert'}).children.join(''),/could not be confirmed/);assert.equal(r.root.findAllByType('button').find(n=>n.props.type==='submit').props.disabled,false);await h.language('vi');assert.equal(h.calls.length,1);assert.ok(r.root.findByType('form'));
});
