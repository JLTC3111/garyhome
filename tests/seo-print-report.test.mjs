import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuditPrintHtml,buildAuditSummaryHtml,executiveAuditFindings,printAuditReport} from '../lib/seo-audit/print-report.ts';
import {evaluatedScore,reportCoverage} from '../lib/seo-audit/presentation.ts';
const finding=(id,severity,category='technical')=>({id,category,severity,title:id,explanation:'Observed response evidence.',recommendation:'Review the published response.'});
const report=findings=>({score:99,findings});
const page=(url,inspectionStatus,status=200)=>({url,finalUrl:url,language:'en',status,indexable:status===200,inspectionStatus,content:report([finding('title','passed','content')]),technical:report([finding('http','passed')])});
function fixture(){return {id:'test-run',created_at:'2026-11-10T09:00:00Z',finished_at:null,status:'incomplete',scope:'site',trigger:'manual',target_url:null,content_score:99,technical_score:99,page_count:2,critical_count:0,state:{pages:[page('https://garyhome.vn/inspected','inspected'),{...page('https://garyhome.vn/timeout','failed',0),crawlError:'Request timed out after 10 seconds.'}],queue:[{kind:'page',url:'https://garyhome.vn/pending',language:'vi'},{kind:'page',url:'https://garyhome.vn/pending',language:'vi'}],skippedUrls:[{url:'https://garyhome.vn/admin',reason:'Private route'}],config:{maxUrls:500,maxDepth:4,maxDurationMs:900000}}};}
test('printable PDF report computes coverage and scores only from inspected evaluated evidence',()=>{
 const run=fixture();run.state.pages[1].technical.findings=[finding('invented-critical','critical')];
 run.state.pages[0].technical.findings.push(finding('canonical','warning'));
 const coverage=reportCoverage(run.state);assert.deepEqual([coverage.inspected,coverage.passed,coverage.issues,coverage.failed,coverage.skipped,coverage.pending,coverage.skippedUrls],[1,0,1,1,0,1,1]);assert.equal(coverage.observations,2);assert.equal(coverage.uniqueUrls,3);
 assert.equal(evaluatedScore(run.state.pages,'technical'),50);
 const html=buildAuditPrintHtml(run,'2026-11-10T10:00:00Z');
 assert.match(html,/@page\{size:A4/);assert.match(html,/Technical SEO<strong>50%/);assert.match(html,/Inspection failed/);assert.match(html,/Inspection pending/);assert.match(html,/No passing checks or SEO defects are inferred/);
 assert.doesNotMatch(html,/invented-critical/);assert.doesNotMatch(html,/99%/);
 assert.equal((html.match(/<h3>https:\/\/garyhome.vn\/pending<\/h3>/g)||[]).length,1);
});
test('uninspected-only report has no fabricated numeric scores or passed checks and escapes audit content',()=>{
 const run=fixture();run.state.pages=[{...run.state.pages[1],crawlError:'<script>alert("x")</script>'}];run.state.queue=[];
 const html=buildAuditPrintHtml(run);
 assert.equal(evaluatedScore(run.state.pages,'content'),null);
 assert.match(html,/Content SEO<strong>Not evaluated/);assert.match(html,/Technical SEO<strong>Not evaluated/);
 assert.doesNotMatch(html,/<script|99%|passed checks:/);assert.match(html,/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
});
test('print export handles blocked windows and opens the professional report before invoking native PDF printing',()=>{
 const originalWindow=globalThis.window,originalTimer=globalThis.setTimeout;
 try{
  globalThis.window={open:()=>null};assert.throws(()=>printAuditReport(fixture()),/Allow the report window/);
  const trace=[],popup={closed:false,opener:{},document:{open:()=>trace.push('open'),write:html=>{assert.match(html,/SEO audit report/);trace.push('write');},close:()=>trace.push('close')},focus:()=>trace.push('focus'),print:()=>trace.push('print')};
  globalThis.window={open:()=>popup};globalThis.setTimeout=callback=>{callback();return 1;};
  printAuditReport(fixture());assert.equal(popup.opener,null);assert.deepEqual(trace,['open','write','close','focus','print']);
 }finally{globalThis.window=originalWindow;globalThis.setTimeout=originalTimer;}
});


test('executive PDF is two bounded sections with eight prioritized distinct causes and an explicit formula',()=>{
 const run=fixture();run.state.pages=[];run.state.queue=[];
 for(let i=0;i<40;i++){
  const current=page(`https://garyhome.vn/en/homes/listing-${i}`,'inspected');
  current.technical.findings=Array.from({length:12},(_,rule)=>({...finding('rule-'+rule,rule<2?'critical':rule<9?'warning':'recommendation'),title:'Distinct cause '+rule,recommendation:'Fix confirmed cause '+rule,explanation:'Observed confirmed evidence',evidence:current.url}));run.state.pages.push(current);
 }
 const html=buildAuditSummaryHtml(run,'2026-11-10T10:00:00Z');
 assert.equal(executiveAuditFindings(run).length,12,'same causes across forty URLs are grouped, never scored away');
 assert.equal((html.match(/data-summary-page=/g)||[]).length,2);assert.equal((html.match(/<div class="priority">/g)||[]).length,8);
 assert.match(html,/Score = round\(100 × passed applicable checks \/ evaluated applicable checks\)/);
 assert.match(html,/4 additional distinct causes/);assert.match(html,/Incomplete verification/);
 assert.doesNotMatch(html,/Page-level evidence|<script|<img|<iframe|@import|https?:\/\/[^<]*\.css/);
 assert.ok(html.length<25000,'repeated observations cannot make executive output unbounded');
 const full=buildAuditPrintHtml(run);assert.match(full,/Page-level evidence/);assert.match(full,/listing-39/);assert.match(full,/Underlying cause groups/);
});
test('summary localizes controlled copy, preserves evidence values and never fabricates five findings',()=>{
 const run=fixture();run.state.pages[0].technical.findings.push({...finding('canonical','warning'),title:'USER_FINDING_TITLE',recommendation:'USER_ACTION_VALUE'});
 const html=buildAuditPrintHtml(run,'2026-11-10T10:00:00Z',{mode:'summary',language:'vi'});
 assert.match(html,/<html lang="vi">/);assert.match(html,/Tóm tắt điều hành SEO/);assert.match(html,/Mức độ hoàn tất/);assert.match(html,/USER_FINDING_TITLE/);assert.match(html,/USER_ACTION_VALUE/);
 assert.equal((html.match(/<div class="priority">/g)||[]).length,1);assert.match(html,/Danh sách ít hơn năm/);
 run.state.pages[0].technical.findings[1].title='<script>alert("unsafe")</script>';
 const safe=buildAuditSummaryHtml(run);assert.doesNotMatch(safe,/<script>/);assert.match(safe,/&lt;script&gt;/);
});

test('full and executive exports disclose evidence-backed scanner corrections without treating them as new attempts',()=>{
 const run=fixture();run.state.classificationCorrections=[{url:'https://garyhome.vn/en/?user=USER_VALUE',findingId:'language-response',reason:'Observed en response, cookie request vi; <unsafe> is escaped.'}];
 const full=buildAuditPrintHtml(run);assert.match(full,/Documented scanner classification corrections/);assert.match(full,/language-response/);assert.match(full,/USER_VALUE/);assert.match(full,/&lt;unsafe&gt;/);
 const summary=buildAuditSummaryHtml(run);assert.match(summary,/1 documented scanner-classification corrections/);assert.doesNotMatch(summary,/Observed en response/,'summary stays bounded while full report retains every correction');
 assert.equal(run.state.classificationCorrections[0].findingId,'language-response');
});
