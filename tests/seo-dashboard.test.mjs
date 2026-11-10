import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import ts from 'typescript';
const require=createRequire(import.meta.url),root=path.resolve(new URL('..',import.meta.url).pathname);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const finding=(id,severity)=>({id,category:'technical',severity,title:id,explanation:'Observed public page response',recommendation:'Review the published route.'});
function fixture(status='completed'){
 const pages=[
  {url:'https://garyhome.vn/en/about',finalUrl:'https://garyhome.vn/en/about',language:'en',indexable:true,status:200,content:{score:100,findings:[]},technical:{score:100,findings:[finding('technical-http','passed')]}},
  {url:'https://garyhome.vn/en/restricted',finalUrl:'https://garyhome.vn/en/restricted',language:'en',indexable:false,status:200,content:{score:100,findings:[]},technical:{score:50,findings:[finding('technical-indexability','critical')]}},
  {url:'https://garyhome.vn/404',finalUrl:'https://garyhome.vn/404',language:'en',indexable:false,status:404,content:{score:null,findings:[]},technical:{score:0,findings:[finding('technical-http','critical')]}},
 ];
 const run={id:'10000000-0000-4000-8000-000000000001',created_at:'2026-11-10T09:00:00Z',finished_at:null,status,scope:'site',trigger:'manual',target_url:null,content_score:100,technical_score:50,page_count:3,critical_count:2,state:{pages,status,queue:[],skippedUrls:[]}};
 return {runs:[run],selectedRun:run,activeRun:status==='running'?run:null,settings:{weeklyEnabled:false,nextRunAt:'2026-11-11T00:00:00Z',limits:{maxUrls:500,maxDepth:4,concurrency:2,requestIntervalMs:1000,timeoutMs:10000,maxDurationMs:900000}}};
}
function loader(site,fetcher){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;
  const result={exports:{}};cache.set(file,result);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function dep(id){
   if(id==='./site-context')return {useSite:()=>site.current};
   if(id==='@/lib/requests')return {fetchWithDeadline:fetcher};
   if(id.startsWith('.')||id.startsWith('@/')){const base=id.startsWith('@/')?path.join(root,id.slice(2)):path.resolve(path.dirname(file),id);return load([base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)));}
   return require(id);
  }
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(result.exports,dep,result);return result.exports;
 }
 return load(root+'/components/seo-audit-dashboard.tsx').SeoAuditDashboard;
}
function text(node){return typeof node==='string'?node:(node?.children||[]).map(text).join(' ');}
function siteValue(id='staff-one'){const value={user:{id},language:'en',staffRole:'manager',demo:false};value.client={auth:{getSession:async()=>({data:{session:{user:value.user,access_token:'test-token'}}})}};return value;}

test('dashboard keeps critical technical findings visible on content tab and separates noindex from failed responses',async t=>{
 const site={current:siteValue()},snapshot=fixture(),calls=[];
 const Component=loader(site,async(url,init)=>{calls.push({url,init});return Response.json(snapshot);});
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 assert.equal(view.root.findAllByProps({className:'seo-page'}).length,3,'default view includes unsuccessful public URLs');
 assert.ok(view.root.findByProps({'aria-label':'Critical technical issues'}));
 await act(async()=>view.root.findAllByProps({role:'tab'}).find(tab=>text(tab)==='Content SEO').props.onClick());
 assert.ok(view.root.findByProps({'aria-label':'Critical technical issues'}),'content tab must not hide indexing blockers');
 const indexing=view.root.findAllByType('select').find(select=>select.findAllByType('option').some(option=>option.props.value==='noindex'));
 await act(async()=>indexing.props.onChange({target:{value:'noindex'}}));
 const matches=view.root.findAllByProps({className:'seo-page'});assert.equal(matches.length,1);assert.match(text(matches[0]),/restricted/);assert.doesNotMatch(text(matches[0]),/404/);
 const manual=view.root.findAllByType('button').find(button=>text(button).includes('Run site audit'));
 await act(async()=>manual.props.onClick());assert.deepEqual(JSON.parse(calls.at(-1).init.body),{action:'start'});
});

test('a delayed response from a previous staff account cannot reveal its report after an account change',async t=>{
 let release,requests=0;const delayed=new Promise(resolve=>{release=resolve;});
 const site={current:siteValue()},old=fixture();old.selectedRun.state.pages[0].url='https://garyhome.vn/old-account-report';
 const next={...fixture(),selectedRun:null,runs:[]};
 const Component=loader(site,async()=>++requests===1?delayed:Response.json(next));
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 site.current=siteValue('staff-two');await act(async()=>view.update(React.createElement(Component)));
 await act(async()=>release(Response.json(old)));
 assert.doesNotMatch(JSON.stringify(view.toJSON()),/old-account-report/);assert.equal(view.root.findAllByProps({className:'seo-page'}).length,0);
});

test('active audit polling advances the persisted run, then stops after completion',async t=>{
 const originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout,pending=[];
 globalThis.setTimeout=(fn,delay,...args)=>delay===2500?(pending.push(fn),987654):originalTimer(fn,delay,...args);
 globalThis.clearTimeout=id=>id===987654?undefined:originalClear(id);
 t.after(()=>{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;});
 const site={current:siteValue()},calls=[];
 const Component=loader(site,async(url,init)=>{calls.push({url,init});return Response.json(fixture(calls.length===1?'running':'completed'));});
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 assert.equal(pending.length,1);await act(async()=>pending.shift()());
 assert.deepEqual(JSON.parse(calls.at(-1).init.body),{action:'advance',runId:fixture().selectedRun.id});assert.equal(pending.length,0);
});
