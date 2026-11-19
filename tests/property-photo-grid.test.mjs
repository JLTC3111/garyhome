import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url);
const sourceA='https://media.example/properties/a.jpg',sourceB='https://media.example/properties/b.jpg';
function loadGrid(){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./use-studio-text')return {useStudioText:()=>((message,values={})=>message.replace(/\{(\w+)\}/g,(_,key)=>String(values[key])))};
   if(id==='./site-context')return {useSite:()=>({t:en=>en})};
   if(id.startsWith('@/'))return load(path.join(root,id.slice(2))+'.ts');
   if(id.startsWith('.')&&id.endsWith('.ts'))return load(path.resolve(path.dirname(file),id));
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+js+'\n})',{filename:file})(loaded.exports,dependency,loaded);
  return loaded.exports;
 }
 return load(path.join(root,'components/property-photo-grid.tsx')).PropertyPhotoGrid;
}

async function harness(t,props){
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const Grid=loadGrid(),covers=[],removals=[];let renderer;
 const allProps={images:[sourceA,sourceB],makeCover:index=>covers.push(index),remove:index=>removals.push(index),...props};
 await act(async()=>{renderer=TestRenderer.create(React.createElement(Grid,allProps));});
 t.after(async()=>{await act(async()=>renderer.unmount());if(previous)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',previous);else delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 return {renderer,covers,removals,async update(next){await act(async()=>renderer.update(React.createElement(Grid,{...allProps,...next})));}};
}

test('photo captions contain the complete long, special and Unicode filename with its original extension',async t=>{
 const long='3-bedroom-apartment-'+('tay-ho-lake-view-pets-allowed-'.repeat(10))+'Ảnh đặc biệt * #1.JPG';
 const unicode='Căn hộ Tây Hồ – 3 phòng (Ảnh 1).JPEG';
 const h=await harness(t,{filenames:{[sourceA]:long,[sourceB]:unicode}});
 const captions=h.renderer.root.findAllByType('figcaption');
 assert.equal(captions[0].findAllByType('span')[1].children.join(''),long);
 assert.equal(captions[1].findAllByType('span')[1].children.join(''),unicode);
 assert.equal(captions[0].findAllByType('span')[0].children.join(''),'Original filename');
 assert.equal(captions[0].props.title,undefined,'the full name is visible text rather than tooltip-only');
 const css=fs.readFileSync(path.join(root,'app/rental.css'),'utf8'),rule=css.match(/\.editor-photo-filename\{([^}]+)\}/)?.[1];
 assert.ok(rule);assert.match(rule,/white-space:normal/);assert.match(rule,/overflow-wrap:anywhere/);assert.doesNotMatch(rule,/text-overflow|line-clamp/);
});

test('filenames render as escaped text rather than HTML',()=>{
 const Grid=loadGrid(),filename='3-bedroom-<img onerror=alert(1)>-&"\'-tay-ho.JPG';
 const html=renderToStaticMarkup(React.createElement(Grid,{images:[sourceA],filenames:{[sourceA]:filename},makeCover(){},remove(){}}));
 assert.match(html,/&lt;img onerror=alert\(1\)&gt;/);assert.match(html,/&amp;/);assert.doesNotMatch(html,/<img onerror=/);
 assert.match(html,/-tay-ho\.JPG/);
});

test('legacy URLs show their full decoded stored filename while unnamed inline images are explicit',async t=>{
 const source='https://media.example/3-bedroom-apartment-tay-ho-%2A-%2A-%2A.jpg?token=ignored';
 const h=await harness(t,{images:[source,'data:image/jpeg;base64,AAAA']});
 const names=h.renderer.root.findAllByType('figcaption').map(caption=>caption.findAllByType('span')[1].children.join(''));
 assert.deepEqual(names,['3-bedroom-apartment-tay-ho-*-*-*.jpg','Filename unavailable']);
 const captions=h.renderer.root.findAllByType('figcaption');assert.equal(captions[0].props['data-filename-source'],'stored');assert.equal(captions[0].findAllByType('span')[0].children.join(''),'Stored filename');
 assert.equal(captions[1].props['data-filename-source'],'unavailable');assert.match(h.renderer.root.findByProps({className:'small muted image-filename-note'}).children.join(''),/Original upload names were not recorded/);
});

test('cover and removal controls target the correct image and are disabled during a listing save',async t=>{
 const h=await harness(t,{}),buttons=()=>h.renderer.root.findAllByType('button');
 assert.equal(buttons().length,3);assert.ok(!buttons().some(button=>button.props['aria-label']==='Make photo 1 cover'));
 await act(async()=>buttons().find(button=>button.props['aria-label']==='Make photo 2 cover').props.onClick());
 await act(async()=>buttons().find(button=>button.props['aria-label']==='Remove photo 1').props.onClick());
 assert.deepEqual(h.covers,[1]);assert.deepEqual(h.removals,[0]);
 await h.update({disabled:true});assert.ok(buttons().every(button=>button.props.disabled===true));
 assert.equal(h.renderer.root.findAllByProps({className:'editor-photo-order'})[0].children.join(''),'COVER');
});

test('existing UUID uploads show the complete stored basename and extension without inventing an original name',async t=>{
 const filename='045efb4c-c106-45d6-866c-460b52874c48.JPG',url='https://media.example/properties/'+filename;
 const h=await harness(t,{images:[url]});const caption=h.renderer.root.findByType('figcaption');
 assert.equal(caption.findAllByType('span')[1].children.join(''),filename);assert.equal(caption.props['data-filename-source'],'stored');
 await h.update({images:[url],filenames:{[url]:'3-bedroom-apartment-tay-ho-lake-view-001.JPG'}});
 assert.equal(h.renderer.root.findByType('figcaption').props['data-filename-source'],'original');
 assert.equal(h.renderer.root.findAllByProps({className:'small muted image-filename-note'}).length,0);
});

test('one photo editor opens by default and retains independent edits across selection and reordering',async t=>{
 let metadata={[sourceA]:{description_en:'First caption',description_vi:'Chú thích đầu',alt_en:'First alt'},
  [sourceB]:{description_en:'Second caption',alt_vi:'Ảnh sau'}};
 const filenames={[sourceA]:'Living room.JPG',[sourceB]:'Balcony.JPG'},moves=[];
 const h=await harness(t,{filenames,metadata,move:(from,to)=>moves.push([from,to]),
  onMetadataChange:(src,patch)=>{metadata={...metadata,[src]:{...metadata[src],...patch}};}});
 const panel=()=>h.renderer.root.findByProps({className:'editor-photo-panel'});
 const values=()=>panel().findAllByType('textarea').map(field=>field.props.value);
 const button=label=>h.renderer.root.findByProps({'aria-label':label});
 assert.equal(h.renderer.root.findAllByType('details').length,0);
 assert.equal(button('Edit photo 1').props['aria-pressed'],true);
 assert.deepEqual(values(),['First caption','Chú thích đầu','First alt','']);
 const newValue={target:{value:'Ảnh phòng khách'}};
 await act(async()=>panel().findAllByType('textarea')[3].props.onChange(newValue));
 await act(async()=>panel().findByType('input').props.onChange({target:{checked:true}}));
 await h.update({metadata});
 await act(async()=>button('Edit photo 2').props.onClick());
 assert.deepEqual(values(),['Second caption','','','Ảnh sau']);
 assert.equal(panel().findByType('input').props.checked,false);
 await act(async()=>button('Edit photo 1').props.onClick());
 assert.deepEqual(values(),['First caption','Chú thích đầu','First alt','Ảnh phòng khách']);
 assert.equal(panel().findByType('input').props.checked,true);
 await act(async()=>panel().findAllByType('button').find(control=>control.children.join('')==='Move later').props.onClick());
 assert.deepEqual(moves,[[0,1]]);
 await h.update({images:[sourceB,sourceA],metadata});
 assert.equal(button('Edit photo 2').props['aria-pressed'],true);
 assert.equal(panel().findByType('img').props.src,sourceA);
 assert.equal(values()[3],'Ảnh phòng khách');
 await h.update({images:[sourceB,'https://media.example/properties/replacement.jpg'],metadata});
 assert.equal(values()[0],'Second caption');
 await act(async()=>button('Edit photo 2').props.onClick());
 assert.deepEqual(values(),['','','','']);
});

test('photo editor uses a width-gated field grid and draws a single thumbnail focus ring',()=>{
 const css=fs.readFileSync(path.join(root,'app/editor-drawer.css'),'utf8');
 assert.match(css,/\.editor-photo-fields\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/@container listing-photo \(min-width:520px\)\s*\{\s*\.editor-photo-fields\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/\.editor-photo-filename-option\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\)/);
 assert.match(css,/\.editor-photo-card:has\(\.editor-photo-select:focus-visible\)\s*\{[^}]*outline:2px[^}]*outline-offset:2px[^}]*box-shadow:none/);
 assert.match(css,/\.editor-photo-select:focus-visible\s*\{\s*outline:none/);
});
