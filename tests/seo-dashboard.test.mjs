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

test('uninspected pages remain neutral and unscored, with distinct failed skipped and pending outcomes',async t=>{
 const snapshot=fixture();
 snapshot.selectedRun.state.pages=[
  {url:'https://garyhome.vn/timeout',finalUrl:'https://garyhome.vn/timeout',language:'en',indexable:false,status:0,content:{score:100,findings:[{...finding('fabricated-content','passed'),category:'content'}]},technical:{score:0,findings:[finding('fabricated-critical','critical')]},crawlError:'Request timed out'},
  {url:'https://garyhome.vn/blocked',finalUrl:'https://garyhome.vn/blocked',language:'vi',indexable:false,status:0,inspectionStatus:'skipped',content:{score:null,findings:[]},technical:{score:null,findings:[]},crawlError:'Robots policy excluded inspection'},
 ];
 snapshot.selectedRun.state.queue=[{kind:'page',url:'https://garyhome.vn/pending',language:'vi'},{kind:'page',url:'https://garyhome.vn/pending',language:'vi'}];
 snapshot.selectedRun.content_score=78;snapshot.selectedRun.technical_score=90;
 const site={current:siteValue()},Component=loader(site,async()=>Response.json(snapshot));
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 assert.equal(view.root.findAllByProps({className:'seo-page'}).length,3);
 assert.equal(view.root.findAllByProps({'aria-label':'Critical technical issues'}).length,0);
 assert.equal(view.root.findAllByProps({className:'seo-signal seo-passed'}).length,0);
 assert.equal(view.root.findAllByType('progress').length,0,'unknown scores must not become zero progress bars');
 assert.doesNotMatch(text(view.toJSON()),/fabricated-critical|fabricated-content|78%|90%/);
 assert.equal(view.root.findAllByProps({'data-inspection':'pending'}).length,1);
 const filter=view.root.findAllByType('select').find(select=>select.findAllByType('option').some(option=>option.props.value==='failed'));
 await act(async()=>filter.props.onChange({target:{value:'failed'}}));
 assert.equal(view.root.findAllByProps({className:'seo-page'}).length,1);
 assert.match(text(view.root.findByProps({className:'seo-page'})),/Request timed out/);
});

test('legacy history scores are withheld until rescanned and print report failures are actionable',async t=>{
 const site={current:siteValue()},snapshot=fixture(),Component=loader(site,async()=>Response.json(snapshot));
 const originalWindow=globalThis.window;globalThis.window={open:()=>null};t.after(()=>{globalThis.window=originalWindow;});
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 const history=view.root.findByProps({className:'seo-history'});
 assert.match(text(history),/Legacy \/ needs rescan/);assert.doesNotMatch(text(history),/100%|50%/);
 const print=view.root.findAllByType('button').find(button=>text(button).includes('Full report'));
 assert.ok(print);await act(async()=>print.props.onClick());
 assert.match(text(view.root.findByProps({role:'alert'})),/Allow the report window/);
});

test('interrupted audits expose explicit resume without discarding the selected run or original start',async t=>{
 const site={current:siteValue()},snapshot=fixture('incomplete'),calls=[];
 snapshot.selectedRun.state.queue=[{kind:'page',url:'https://garyhome.vn/pending',language:'en'}];
 const Component=loader(site,async(url,init)=>{calls.push({url,init});return Response.json(snapshot);});
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 const resume=view.root.findAllByType('button').find(button=>text(button).includes('Resume interrupted audit'));
 assert.ok(resume);assert.match(text(view.toJSON()),/new 15-minute execution segment/);
 await act(async()=>resume.props.onClick());
 assert.deepEqual(JSON.parse(calls.at(-1).init.body),{action:'resume',runId:snapshot.selectedRun.id});
 assert.equal(calls.at(-1).url,'/api/admin/seo?runId='+snapshot.selectedRun.id);
 assert.match(text(view.toJSON()),/10\/11\/2026/);
});

test('only safe advance requests retry transient failures with backoff and stop after three retries',async t=>{
 const originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout,pending=[];
 globalThis.setTimeout=(fn,delay,...args)=>[2500,5000,10000,20000].includes(delay)?(pending.push({fn,delay}),987654):originalTimer(fn,delay,...args);
 globalThis.clearTimeout=id=>id===987654?undefined:originalClear(id);
 t.after(()=>{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;});
 const site={current:siteValue()},calls=[];
 const Component=loader(site,async(url,init)=>{calls.push({url,init});return init.method==='GET'?Response.json(fixture('running')):Response.json({error:'Temporary audit storage interruption'},{status:503});});
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 const delays=[];
 for(let i=0;i<4;i++) {assert.equal(pending.length,1);const job=pending.shift();delays.push(job.delay);await act(async()=>job.fn());}
 assert.deepEqual(delays,[2500,5000,10000,20000]);assert.equal(pending.length,0);
 assert.equal(calls.filter(call=>call.init.method==='POST').length,4);
 assert.ok(calls.filter(call=>call.init.method==='POST').every(call=>JSON.parse(call.init.body).action==='advance'));
 assert.match(text(view.toJSON()),/Automatic retries stopped after three attempts/);
 const continueButton=view.root.findAllByType('button').find(button=>text(button).includes('Continue saved scan'));assert.ok(continueButton);
});

test('authorization failures pause safe advancement without retrying a revoked account',async t=>{
 const originalTimer=globalThis.setTimeout,originalClear=globalThis.clearTimeout,pending=[];
 globalThis.setTimeout=(fn,delay,...args)=>delay===2500?(pending.push(fn),987654):originalTimer(fn,delay,...args);
 globalThis.clearTimeout=id=>id===987654?undefined:originalClear(id);
 t.after(()=>{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalClear;});
 const site={current:siteValue()};
 const Component=loader(site,async(url,init)=>init.method==='GET'?Response.json(fixture('running')):Response.json({error:'Staff access required'},{status:403}));
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{await act(async()=>view.unmount());});
 await act(async()=>pending.shift()());assert.equal(pending.length,0);assert.match(text(view.toJSON()),/Staff access required/);assert.doesNotMatch(text(view.toJSON()),/will retry safely/);
});

test('dashboard offers executive-only and complete PDF documents through distinct export actions',async t=>{
 const site={current:siteValue()},snapshot=fixture(),Component=loader(site,async()=>Response.json(snapshot));
 const originalWindow=globalThis.window,originalTimer=globalThis.setTimeout,written=[];
 const popup=()=>({closed:false,opener:{},document:{open(){},write(html){written.push(html);},close(){}},focus(){},print(){}});
 globalThis.window={open:popup};
 let view;await act(async()=>{view=TestRenderer.create(React.createElement(Component));});t.after(async()=>{globalThis.window=originalWindow;globalThis.setTimeout=originalTimer;await act(async()=>view.unmount());});
 const summary=view.root.findAllByType('button').find(button=>text(button).includes('Summary only')),full=view.root.findAllByType('button').find(button=>text(button).includes('Full report'));
 assert.ok(summary);assert.ok(full);
 globalThis.setTimeout=(callback,ms)=>ms===150?1:originalTimer(callback,ms);
 await act(async()=>summary.props.onClick());assert.equal((written[0].match(/data-summary-page=/g)||[]).length,2);assert.doesNotMatch(written[0],/Page-level evidence/);
 await act(async()=>full.props.onClick());assert.match(written[1],/Page-level evidence/);assert.doesNotMatch(written[1],/data-summary-page=/);
});
