import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
import {analyzeContent} from '../lib/seo-analysis/content.ts';
import {localizeContentFinding,seoText,seoSeverity} from '../lib/seo-analysis/localization.ts';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const paragraph='A useful original paragraph explains the tenancy agreement and the details to check before moving into the apartment.';
const base={url:'https://garyhome.vn/en/homes/user-authored-slug',language:'en',title:'USER_TITLE_EN',description:'USER_DESCRIPTION_EN',text:paragraph,headings:[{level:1,text:'USER_HEADING'}],links:[{href:'/en/services',text:'Services and property advice'}],images:[{src:'https://images.garyhome.vn/user-photo.jpg',alt:'USER_ALT'}]};
const variants=[
 {...base,title:'',description:'',text:'',headings:[],links:[],images:[]},
 {...base,title:'Home',links:[]},
 {...base,title:base.title.repeat(10),description:base.description.repeat(12),text:paragraph+'\n\n'+paragraph,headings:[{level:1,text:'One'},{level:3,text:'Gap'},{level:1,text:'Another'}],links:[{href:'/en/services',text:''}],images:[{src:'https://images.garyhome.vn/user-photo.jpg',alt:null},{src:'/other.jpg',alt:'photo'}],focusKeyword:'USER_FOCUS_PHRASE'},
 {...base,focusKeyword:'USER'}
];

test('every live content rule has complete Vietnamese copy with invariant identity severity and scores',()=>{
 const found=new Set();
 for(const input of variants){
  const result=analyzeContent(input),snapshot=JSON.stringify(result);
  for(const finding of result.findings){
   const vi=localizeContentFinding(finding,'vi');found.add(finding.id);
   for(const field of ['title','explanation','recommendation'])assert.notEqual(vi[field],finding[field],`${finding.id}.${finding.severity}.${field} translated`);
   assert.equal(vi.id,finding.id);assert.equal(vi.severity,finding.severity);assert.equal(vi.category,finding.category);
   assert.equal(localizeContentFinding(finding,'en'),finding,'canonical English evidence stays unchanged');
   if(finding.id!=='content-title-preview')assert.equal(vi.evidence,finding.evidence,'URLs and authored evidence are not translated');
  }
  assert.equal(JSON.stringify(result),snapshot,'presentation localization never edits stored findings or scores');
 }
 assert.equal(found.size,16,'all live rule IDs are exercised');
 assert.equal(seoSeverity('warning','vi'),'Cảnh báo');assert.equal(seoText('previewDevice','vi'),'Thiết bị xem trước');
});

test('dynamic readability, focus areas and character labels are translated without translating user values',()=>{
 const findings=analyzeContent(variants[2]).findings;
 const readability=localizeContentFinding(findings.find(f=>f.id==='content-readability'),'vi');
 assert.match(readability.explanation,/Phát hiện \d+ đơn vị từ và \d+ câu/);assert.doesNotMatch(readability.explanation,/Detected|sentences|word segments/);
 const focus=localizeContentFinding(findings.find(f=>f.id==='content-focus-topic'),'vi');
 assert.match(focus.explanation,/tiêu đề, mô tả, các tiêu đề mục, nội dung chính/);assert.equal(focus.evidence,'USER_FOCUS_PHRASE');
 const preview=localizeContentFinding(findings.find(f=>f.id==='content-title-preview'),'vi');assert.match(preview.evidence,/\d+ ký tự/);
 const urlFinding=localizeContentFinding(findings.find(f=>f.id==='content-image-alt'),'vi');assert.equal(urlFinding.evidence,'https://images.garyhome.vn/user-photo.jpg');
});

function loader(site){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const moduleValue={exports:{}};cache.set(file,moduleValue);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dependency(id){
   if(id==='./site-context')return {useSite:()=>site.current};
   if(id.startsWith('.')||id.startsWith('@/')){const target=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([target,target+'.ts',target+'.tsx'].find(p=>fs.existsSync(p)));}
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(moduleValue.exports,dependency,moduleValue);
  return moduleValue.exports;
 }
 return load(root+'/components/seo-editor-panel.tsx').SeoEditorPanel;
}
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join(' ');
test('listing live checklist switches all rule and accessibility copy while preserving draft content',async t=>{
 const site={current:{language:'vi'}},Panel=loader(site),inputs=[base,{...base,language:'vi',url:'https://garyhome.vn/vi/homes/user-authored-slug',title:'TIÊU_ĐỀ_NGƯỜI_DÙNG',description:'MÔ_TẢ_NGƯỜI_DÙNG'}],before=JSON.stringify(inputs);
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Panel,{inputs}));});t.after(async()=>{await act(async()=>view.unmount());});
 assert.ok(view.root.findByProps({'aria-label':'Phân tích SEO nội dung trực tiếp'}));
 assert.ok(view.root.findByProps({'aria-label':'Thiết bị xem trước'}));
 assert.match(text(view.toJSON()),/Đã có tiêu đề/);assert.match(text(view.toJSON()),/TIÊU_ĐỀ_NGƯỜI_DÙNG/);assert.doesNotMatch(text(view.toJSON()),/Title is present|Main content is present|Review clarity/);
 await act(async()=>view.root.findByType('input').props.onChange({target:{value:'USER_FOCUS_PHRASE'}}));
 assert.match(text(view.toJSON()),/USER_FOCUS_PHRASE/);assert.match(text(view.toJSON()),/Cụm từ trọng tâm chính xác/);
 site.current={language:'en'};await act(async()=>view.update(React.createElement(Panel,{inputs})));
 assert.ok(view.root.findByProps({'aria-label':'Live content SEO analysis'}));assert.match(text(view.toJSON()),/Title is present/);assert.match(text(view.toJSON()),/TIÊU_ĐỀ_NGƯỜI_DÙNG/);
 assert.equal(JSON.stringify(inputs),before);
});
