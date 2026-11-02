import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {propertyMapLocation} from '../lib/property-map.ts';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const home={address:'Đặng Thai Mai, Tây Hồ',district_slug:'tay-ho'};

test('an author address or coordinates take precedence over the public street and district',()=>{
  for(const address of ['  12 Đặng Thai Mai, Tây Hồ, Hà Nội  ',' 21.0693, 105.8196 ']){
    const map=propertyMapLocation({...home,map_address:address},{name:'Tây Hồ'});
    assert.equal(map.exact,true);
    assert.equal(map.label,address.trim());
    assert.equal(new URL(map.embedUrl).searchParams.get('q'),address.trim());
    assert.equal(new URL(map.externalUrl).searchParams.get('query'),address.trim());
  }
});

test('missing exact locations fall back to the public street, district and finally Hanoi',()=>{
  for(const map_address of [undefined,null,'',' \n ']){
    const map=propertyMapLocation({...home,map_address},{name:'Tây Hồ'});
    assert.equal(map.exact,false);
    assert.equal(map.label,home.address);
    assert.equal(map.query,home.address+', Hanoi, Vietnam');
  }
  assert.equal(propertyMapLocation({...home,address:'  '},{name:'Tây Hồ'}).query,'Tây Hồ, Hanoi, Vietnam');
  assert.equal(propertyMapLocation({...home,address:''}).query,'tay ho, Hanoi, Vietnam');
  const city=propertyMapLocation({address:'',district_slug:''});
  assert.equal(city.query,'Hanoi, Vietnam');
  assert.equal(city.label,'Hanoi, Vietnam');
});

test('special address characters stay inside the map query and cannot replace its host or options',()=>{
  const address='12 Ngõ A & B #3?output=evil&z=1, Hà Nội';
  const map=propertyMapLocation({...home,map_address:address});
  const embed=new URL(map.embedUrl),external=new URL(map.externalUrl);
  assert.equal(embed.origin,'https://www.google.com');
  assert.equal(embed.searchParams.get('q'),address);
  assert.equal(embed.searchParams.get('output'),'embed');
  assert.equal(embed.searchParams.get('z'),'17');
  assert.equal(embed.hash,'');
  assert.equal(external.origin,'https://www.google.com');
  assert.equal(external.searchParams.get('api'),'1');
  assert.equal(external.searchParams.get('query'),address);
  assert.equal(external.hash,'');
});

async function harness(t,property){
  const old=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let language='en';
  const source=ts.transpileModule(fs.readFileSync(root+'/components/property-map.tsx','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
  }).outputText;
  const loaded={exports:{}};
  const dependency=id=>id==='./site-context'?{useSite:()=>({t:(en,vi)=>language==='vi'?vi:en})}:
    id==='@/lib/property-map'?{propertyMapLocation}:require(id);
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})')(loaded.exports,dependency,loaded);
  const view=()=>React.createElement(loaded.exports.PropertyMap,{property,district:{name:'Tây Hồ'}});
  let renderer;
  await act(async()=>{renderer=TestRenderer.create(view());});
  t.after(async()=>{
    await act(async()=>renderer.unmount());
    if(old)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',old);
    else delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return {renderer,async update(next,locale=language){property=next;language=locale;await act(async()=>renderer.update(view()));}};
}

test('map embeds load lazily and carry the author precision, destination and translated accessible title',async t=>{
  const property={...home,map_address:'21.0693, 105.8196'},h=await harness(t,property);
  let iframe=h.renderer.root.findByType('iframe');
  assert.equal(iframe.props.loading,'lazy');
  assert.equal(iframe.props.allowFullScreen,true);
  assert.match(iframe.props.title,/author-provided/);
  assert.equal(new URL(iframe.props.src).searchParams.get('q'),property.map_address);
  assert.ok(h.renderer.root.findByProps({className:'property-map-precision'}).children.includes('Author-provided location'));
  const link=h.renderer.root.findByType('a');
  assert.equal(new URL(link.props.href).searchParams.get('query'),property.map_address);
  assert.equal(link.props.target,'_blank');
  assert.equal(link.props.rel,'noreferrer');
  await h.update(property,'vi');
  iframe=h.renderer.root.findByType('iframe');
  assert.match(iframe.props.title,/do người đăng cung cấp/);
  assert.ok(h.renderer.root.findByProps({className:'property-map-precision'}).children.includes('Vị trí do người đăng cung cấp'));
  assert.ok(h.renderer.root.findByType('a').children.includes('Mở trong Google Maps'));
});

test('removing an exact location replaces both map destinations and explains the approximate area in either language',async t=>{
  const h=await harness(t,{...home,map_address:'12 Đặng Thai Mai, Hà Nội'});
  await h.update({...home,map_address:' '});
  const iframe=h.renderer.root.findByType('iframe');
  assert.match(iframe.props.title,/approximate property area/);
  assert.equal(new URL(iframe.props.src).searchParams.get('q'),home.address+', Hanoi, Vietnam');
  assert.equal(new URL(h.renderer.root.findByType('a').props.href).searchParams.get('query'),home.address+', Hanoi, Vietnam');
  assert.ok(h.renderer.root.findByProps({className:'property-map-precision'}).children.includes('Approximate location'));
  assert.match(h.renderer.root.findByProps({className:'muted small'}).children.join(''),/exact viewing address/);
  await h.update({...home,map_address:null},'vi');
  assert.ok(h.renderer.root.findByProps({className:'property-map-precision'}).children.includes('Vị trí gần đúng'));
  assert.match(h.renderer.root.findByType('iframe').props.title,/khu vực gần đúng/);
  assert.match(h.renderer.root.findByProps({className:'muted small'}).children.join(''),/địa chỉ xem nhà chính xác/);
});
