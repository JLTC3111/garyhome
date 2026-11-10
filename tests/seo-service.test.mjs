import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {normalizeAuditState} from '../lib/seo-audit/normalize.ts';
import {evaluatedScore,reportCoverage} from '../lib/seo-audit/presentation.ts';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const origin='https://garyhome.vn',runId='20000000-0000-4000-8000-000000000002';
const finding=(id,severity,category='technical')=>({id,severity,category,title:id,explanation:'Observed evidence',recommendation:'Review the route.'});
function page(url,inspectionStatus='inspected') {return {url,finalUrl:url,language:'en',status:inspectionStatus==='inspected'?200:0,indexable:inspectionStatus==='inspected',inspectionStatus,content:{score:100,findings:[finding('content-title','passed','content')]},technical:{score:100,findings:[finding('technical-http','passed')]},responseMs:12,bytes:1024};}
function crawlState() {return {version:1,analysisVersion:2,status:'running',startedAt:1000,updatedAt:1000,config:{allowedOrigins:[origin],maxUrls:500,maxDepth:4,concurrency:2,requestIntervalMs:1000,timeoutMs:10000,maxDurationMs:900000,scope:'site',languages:['en','vi']},queue:[{kind:'page',url:origin+'/next',language:'vi',depth:0,attempts:2}],pages:[page(origin+'/observed')],skippedUrls:[],visited:[],canonicalUrls:[],robots:{},hostNextAt:{},sitemapUrls:[],linkChecks:{},requests:1};}
function serviceHarness(options={}) {
 const record={id:runId,created_at:'2026-11-10T09:00:00Z',status:options.status||'running',state:structuredClone(options.state||crawlState())};
 const calls={claims:[],saved:[],resumed:[],advanced:[],created:[],compared:0,network:0};
 const db={from(table){assert.equal(table,'seo_audit_runs');return {select(){return this;},eq(name,value){assert.equal(name,'id');assert.equal(value,runId);return this;},async single(){return {data:options.missing?null:structuredClone(record),error:options.loadError?{code:'fixture'}:null};}};}};
 const config={auditEnvironment(){if(options.environmentError)throw new Error('fixture domain configuration error');return {base:origin,allowedOrigins:options.allowedOrigins||[origin]};},auditSeeds(){return [origin+'/'];}};
 const crawler={normalizeCrawlUrl:value=>value,isExcludedUrl:()=>false,createCrawl(config,seeds){return {...crawlState(),status:'queued',config,seeds};},async advanceCrawl(state,advanceOptions){calls.advanced.push({state:structuredClone(state),options:advanceOptions});if(options.workerError)throw new Error('unexpected worker fault');return options.advance?options.advance(state):state;}};
 const store={async claimAudit(database,id){assert.equal(database,db);calls.claims.push(id);return options.noLease?null:{run:structuredClone(record),leaseToken:'lease-fixture'};},async saveAudit(database,id,token,state){assert.equal(database,db);assert.equal(id,runId);assert.equal(token,'lease-fixture');calls.saved.push(structuredClone(state));if(options.checkpointError)throw new Error('fixture checkpoint timeout after commit');return options.checkpointResult!==false;},async resumeAuditRecord(database,id,state){assert.equal(database,db);calls.resumed.push({id,state:structuredClone(state)});return {...record,state};},async getAuditSettings(){return {weeklyEnabled:false,nextRunAt:'2099-01-01T00:00:00Z',limits:crawlState().config};},async createAudit(...args){calls.created.push(args);return record;}};
 const mocks=new Map([[path.join(root,'lib/server.ts'),{staffAdminClient:()=>db,loadContent:async()=>({content:{}})}],[path.join(root,'lib/seo-audit/config.ts'),config],[path.join(root,'lib/seo-audit/crawler.ts'),crawler],[path.join(root,'lib/seo-audit/store.ts'),store],[path.join(root,'lib/seo-audit-runtime.ts'),{auditNetworkOptions(){calls.network++;return {transportMode:'trusted-fetch'};}}],[path.join(root,'lib/seo-audit/compare.ts'),{compareAuditMetadata(state){calls.compared++;return state;}}]]);
 const cache=new Map();
 function load(file){
  if(mocks.has(file))return mocks.get(file);if(cache.has(file))return cache.get(file).exports;
  const loaded={exports:{}};cache.set(file,loaded);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const dependency=id=>{if(id.startsWith('.')){const target=path.resolve(path.dirname(file),id),resolved=[target,target+'.ts'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());if(!resolved)throw new Error('Unresolved fixture module '+id);return load(resolved);}return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(loaded.exports,dependency,loaded);return loaded.exports;
 }
 return {...load(path.join(root,'lib/seo-audit/service.ts')),record,calls};
}

test('a checkpoint response failure at 191 seconds never overwrites the resumable run as failed',async()=>{
 const originalNow=Date.now;Date.now=()=>192000;
 try{
  const state=crawlState();state.startedAt=1000;
  const h=serviceHarness({state,checkpointError:true});
  await assert.rejects(h.advanceAudit(runId),/checkpoint timeout after commit/);
  assert.equal(h.calls.saved.length,1,'a failed save must not be replayed with a fabricated terminal state');
  assert.equal(h.calls.saved[0].status,'running');assert.equal(h.calls.saved[0].queue.length,1);
  assert.equal(h.calls.saved[0].startedAt,1000);assert.ok(Date.now()-h.calls.saved[0].startedAt<900000);
  assert.equal(h.calls.advanced[0].options.budgetMs,12000);assert.equal(h.calls.advanced[0].options.transportMode,'trusted-fetch');
 }finally{Date.now=originalNow;}
});

test('an expired lease or unconfirmed compare-and-swap checkpoint does not manufacture a failed run',async()=>{
 const h=serviceHarness({checkpointResult:false});
 await assert.rejects(h.advanceAudit(runId),/checkpoint was not confirmed/);
 assert.equal(h.calls.saved.length,1);assert.equal(h.calls.saved[0].status,'running');assert.equal(h.calls.saved[0].pages[0].technical.findings.length,1);
 const idle=serviceHarness({noLease:true});await idle.advanceAudit(runId);assert.equal(idle.calls.saved.length,0);assert.equal(idle.calls.advanced.length,0);
});

test('an unexpected worker interruption preserves observations and pending queue with an actionable incomplete state',async()=>{
 const h=serviceHarness({workerError:true});await h.advanceAudit(runId);
 assert.equal(h.calls.saved.length,1);const saved=h.calls.saved[0];
 assert.equal(saved.status,'incomplete');assert.match(saved.stopReason,/Worker interrupted.*Resume the saved queue/);
 assert.equal(saved.queue.length,1);assert.equal(saved.pages[0].url,origin+'/observed');assert.equal(saved.pages[0].technical.findings[0].severity,'passed');
 assert.equal(saved.pages.flatMap(page=>page.technical.findings).some(finding=>finding.severity==='critical'),false);
});

test('changed trusted domains stop advancement without issuing network work or discarding the queue',async()=>{
 const h=serviceHarness({allowedOrigins:['https://new.garyhome.vn']});await h.advanceAudit(runId);
 assert.equal(h.calls.advanced.length,0);assert.equal(h.calls.network,0);assert.equal(h.calls.saved[0].status,'incomplete');
 assert.match(h.calls.saved[0].stopReason,/domains changed/);assert.equal(h.calls.saved[0].queue.length,1);
});

test('explicit resume starts a new bounded segment while preserving original time and successful evidence',async()=>{
 const state=crawlState();state.status='incomplete';state.finishedAt=192000;state.stopReason='Checkpoint failed';
 state.pages.push({...page(origin+'/failed','failed'),crawlError:'Request timeout'}, {...page(origin+'/blocked','skipped'),crawlError:'robots.txt unavailable'});
 state.queue.push({kind:'page',url:origin+'/failed',language:'en',depth:0,attempts:3});
 state.visited=['page:en:'+origin+'/failed','page:en:'+origin+'/blocked','page:en:'+origin+'/observed','robots::'+origin+'/robots.txt'];
 state.robots={[origin]:{fetched:true,allowed:false,rules:[],delayMs:0,error:'robots.txt unavailable'}};
 const originalNow=Date.now;Date.now=()=>500000;
 try{
  const h=serviceHarness({state,status:'incomplete'});const resumed=await h.resumeAudit(runId),saved=h.calls.resumed[0].state;
  assert.equal(h.calls.resumed.length,1);assert.equal(saved.status,'queued');assert.equal(saved.startedAt,500000);assert.equal(saved.originalStartedAt,1000);
  assert.deepEqual(saved.resumeHistory,[{startedAt:1000,finishedAt:192000,reason:'Checkpoint failed'}]);
  assert.equal(saved.finishedAt,undefined);assert.equal(saved.stopReason,undefined);assert.equal(saved.error,undefined);assert.equal(saved.analysisVersion,2);
  assert.deepEqual(saved.pages.map(page=>page.url),[origin+'/observed']);assert.equal(saved.pages[0].content.score,100);
  assert.equal(saved.queue.filter(task=>task.url===origin+'/failed').length,1,'failed row is requeued once even if already pending');
  assert.ok(saved.queue.some(task=>task.url===origin+'/blocked'));assert.ok(saved.queue.every(task=>task.attempts===0));
  assert.deepEqual(saved.robots,{});assert.deepEqual(saved.visited,['page:en:'+origin+'/observed']);
  assert.equal(resumed.created_at,'2026-11-10T09:00:00Z','historical creation time remains server-owned');
 }finally{Date.now=originalNow;}
});

test('resume rejects changed domains, active/completed runs and missing records before persisting work',async()=>{
 for(const options of [{allowedOrigins:['https://other.garyhome.vn'],status:'failed'},{status:'running'},{status:'completed'},{status:'failed',missing:true}]){
  const h=serviceHarness(options);await assert.rejects(h.resumeAudit(runId));assert.equal(h.calls.resumed.length,0);
 }
});

test('legacy normalization removes fabricated uninspected scores and preserves genuine observed defects',()=>{
 const state=crawlState();state.pages=[{...page(origin+'/failed','failed'),inspectionStatus:undefined,content:{score:100,findings:[finding('invented-pass','passed','content')]},technical:{score:0,findings:[finding('fetch-failed','critical')]}},{...page(origin+'/blocked','skipped'),inspectionStatus:undefined,technical:{score:0,findings:[finding('robots-unverified','warning')]}},{...page(origin+'/observed'),technical:{score:99,findings:[finding('http','passed'),finding('canonical','warning'),finding('http','passed')]}}];
 const normalized=normalizeAuditState(state);
 for(const page of normalized.pages.slice(0,2)){assert.equal(page.content.score,null);assert.equal(page.technical.score,null);assert.deepEqual(page.technical.findings,[]);assert.ok(page.crawlError);}
 assert.equal(normalized.pages[0].inspectionStatus,'failed');assert.equal(normalized.pages[1].inspectionStatus,'skipped');
 assert.equal(normalized.pages[2].technical.findings.length,2);assert.equal(normalized.pages[2].technical.score,50);
 assert.equal(normalized.pages[2].technical.findings.find(f=>f.id==='canonical').severity,'warning');assert.equal(evaluatedScore(normalized.pages,'technical'),50);
 const coverage=reportCoverage(normalized);assert.equal(coverage.inspected,1);assert.equal(coverage.failed,1);assert.equal(coverage.skipped,1);assert.equal(coverage.pending,1);
});

function loadStore(){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file).exports;const loaded={exports:{}};cache.set(file,loaded);
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const dep=id=>{if(id.startsWith('.')){const target=path.resolve(path.dirname(file),id);return load([target,target+'.ts'].find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile()));}return require(id);};
  vm.runInThisContext('(function(exports,require,module){'+source+'\n})',{filename:file})(loaded.exports,dep,loaded);return loaded.exports;
 }
 return load(path.join(root,'lib/seo-audit/store.ts'));
}
test('stored summaries weight evaluated checks and omit failed inspections rather than averaging fabricated page scores',()=>{
 const {auditSummary}=loadStore(),state=crawlState();
 const first=page(origin+'/first');first.content={score:0,findings:[finding('content-one','passed','content')]};first.technical={score:0,findings:[finding('technical-one','passed')]};
 const second=page(origin+'/second');second.content={score:100,findings:[finding('content-two','warning','content'),finding('content-three','warning','content'),finding('content-four','warning','content')]};second.technical={score:100,findings:[finding('technical-two','warning'),finding('technical-three','warning'),finding('technical-four','warning'),finding('technical-five','critical'),finding('advisory','recommendation')]};
 const unknown={...page(origin+'/unknown','failed'),content:{score:100,findings:[finding('fabricated','passed','content')]},technical:{score:0,findings:[finding('invented-critical','critical')]}};
 state.pages=[first,second,unknown];
 const summary=auditSummary(state);
 assert.equal(summary.content_score,25);assert.equal(summary.technical_score,20);assert.equal(summary.critical_count,1);assert.equal(summary.score_basis,'evaluated-checks-v2');
 assert.deepEqual(summary.coverage,{inspected:2,passed:1,failed:1,skipped:0,pending:1,skippedUrls:0});
 state.pages=[unknown];state.queue=[];const empty=auditSummary(state);assert.equal(empty.content_score,null);assert.equal(empty.technical_score,null);assert.equal(empty.critical_count,0);
});


test('resuming legacy parser evidence re-evaluates successful pages before assigning the new score basis',async()=>{
 const state=crawlState();delete state.analysisVersion;state.status='failed';
 state.canonicalUrls=[`en:${origin}/observed`];state.linkChecks={[origin+'/observed']:{status:200}};
 const h=serviceHarness({state,status:'failed'});await h.resumeAudit(runId);
 const saved=h.calls.resumed[0].state;
 assert.equal(saved.analysisVersion,2);assert.deepEqual(saved.pages,[]);
 assert.ok(saved.queue.some(task=>task.url===origin+'/observed'));
 assert.deepEqual(saved.canonicalUrls,[]);assert.deepEqual(saved.linkChecks,{});
 assert.match(saved.resumeHistory[0].reason,/Legacy parser/);
});
