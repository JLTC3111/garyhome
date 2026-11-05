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

async function harness(t,{value='',kind='property'}={}){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let renderer,externalValue,language,setValue,setLanguage;const emissions=[],validity=[];
 t.after(async()=>{if(renderer)await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 const Site=React.createContext(null),cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const dependency=id=>{if(id==='./site-context')return {useSite:()=>React.useContext(Site)};if(id.startsWith('@/'))return load(path.join(root,id.slice(2))+'.ts');return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(module.exports,dependency,module);return module.exports;
 }
 const {PublicUrlField}=load(path.join(root,'components/public-url-field.tsx'));
 function App(){[externalValue,setValue]=React.useState(value);[language,setLanguage]=React.useState('en');return React.createElement(Site.Provider,{value:{publicOrigin:'https://garyhome.vn',t:(en,vi)=>language==='vi'?vi:en}},React.createElement(PublicUrlField,{value:externalValue,kind,onChange:next=>{emissions.push(next);setValue(next);}}));}
 await act(async()=>{renderer=TestRenderer.create(React.createElement(App),{createNodeMock:node=>node.type==='input'?{setCustomValidity:message=>validity.push(message)}:null});});
 const input=()=>renderer.root.findByType('input'),alerts=()=>renderer.root.findAllByProps({role:'alert'});
 return {input,alerts,emissions,validity,value:()=>externalValue,
  change:async raw=>{await act(async()=>input().props.onChange({target:{value:raw}}));},
  blur:async()=>{await act(async()=>input().props.onBlur());},
  translate:async()=>{await act(async()=>setLanguage('vi'));},
  external:async next=>{await act(async()=>setValue(next));}
 };
}

test('complete HTTPS URLs can be typed character by character without expanding partial words',async t=>{
 const h=await harness(t),full='https://garyhome.vn/homes/typed-home';
 for(let length=1;length<=full.length;length++){const raw=full.slice(0,length);await h.change(raw);assert.equal(h.input().props.value,raw,`typing ${raw}`);}
 assert.equal(h.value(),'typed-home');assert.equal(h.validity.at(-1),'');await h.blur();assert.equal(h.input().props.value,full);
});

test('valid paste preserves typed formatting until blur while a bare word remains visibly invalid',async t=>{
 const h=await harness(t);const pasted='HTTPS://GARYHOME.VN/homes/pasted-home/';
 await h.change(pasted);assert.equal(h.input().props.value,pasted);assert.equal(h.value(),'pasted-home');assert.equal(h.validity.at(-1),'');
 await h.blur();assert.equal(h.input().props.value,'https://garyhome.vn/homes/pasted-home');
 await h.change('apartment');await h.blur();assert.equal(h.input().props.value,'apartment');assert.equal(h.value(),'apartment');assert.equal(h.input().props['aria-invalid'],true);assert.match(h.alerts()[0].children.join(''),/complete HTTPS URL/);assert.match(h.validity.at(-1),/complete HTTPS URL/);
 await h.change('https://garyhome.vn/homes/corrected-home');assert.equal(h.alerts().length,0);assert.equal(h.input().props['aria-invalid'],false);assert.equal(h.validity.at(-1),'');
});

test('language changes retain unfinished input and external record changes reset to the stored public URL',async t=>{
 const h=await harness(t,{value:'published-home'});assert.equal(h.input().props.value,'https://garyhome.vn/homes/published-home');assert.equal(h.value(),'published-home');assert.equal(h.emissions.length,0);
 await h.change('https://garyhome.vn/ho');await h.blur();const input=h.input();await h.translate();assert.equal(h.input(),input);assert.equal(h.input().props.value,'https://garyhome.vn/ho');assert.match(h.alerts()[0].children.join(''),/Dùng đường dẫn theo mẫu/);assert.match(h.validity.at(-1),/Dùng đường dẫn theo mẫu/);
 await h.external('another-published-home');assert.equal(h.input().props.value,'https://garyhome.vn/homes/another-published-home');assert.equal(h.alerts().length,0);assert.equal(h.validity.at(-1),'');
 await h.external('');assert.equal(h.input().props.value,'');assert.equal(h.alerts().length,0);assert.match(h.validity.at(-1),/Nhập đường dẫn đầy đủ/);
});

test('article and neighbourhood records show complete addresses without emitting a change',async t=>{
 for(const [kind,value,url]of [['article','renting-in-hanoi','https://garyhome.vn/tips-and-news/renting-in-hanoi'],['neighbourhood','tay-ho','https://garyhome.vn/homes?district=tay-ho']])await t.test(kind,async t=>{
  const h=await harness(t,{kind,value});assert.equal(h.input().props.value,url);await h.blur();assert.equal(h.input().props.value,url);assert.equal(h.emissions.length,0);
 });
});
