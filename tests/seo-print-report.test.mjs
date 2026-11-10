import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAuditPrintHtml,printAuditReport} from '../lib/seo-audit/print-report.ts';
import {evaluatedScore,reportCoverage} from '../lib/seo-audit/presentation.ts';
const finding=(id,severity,category='technical')=>({id,category,severity,title:id,explanation:'Observed response evidence.',recommendation:'Review the published response.'});
const report=findings=>({score:99,findings});
const page=(url,inspectionStatus,status=200)=>({url,finalUrl:url,language:'en',status,indexable:status===200,inspectionStatus,content:report([finding('title','passed','content')]),technical:report([finding('http','passed')])});
function fixture(){return {id:'test-run',created_at:'2026-11-10T09:00:00Z',finished_at:null,status:'incomplete',scope:'site',trigger:'manual',target_url:null,content_score:99,technical_score:99,page_count:2,critical_count:0,state:{pages:[page('https://garyhome.vn/inspected','inspected'),{...page('https://garyhome.vn/timeout','failed',0),crawlError:'Request timed out after 10 seconds.'}],queue:[{kind:'page',url:'https://garyhome.vn/pending',language:'vi'},{kind:'page',url:'https://garyhome.vn/pending',language:'vi'}],skippedUrls:[{url:'https://garyhome.vn/admin',reason:'Private route'}],config:{maxUrls:500,maxDepth:4,maxDurationMs:900000}}};}
test('printable PDF report computes coverage and scores only from inspected evaluated evidence',()=>{
 const run=fixture();run.state.pages[1].technical.findings=[finding('invented-critical','critical')];
 run.state.pages[0].technical.findings.push(finding('canonical','warning'));
 assert.deepEqual(reportCoverage(run.state),{inspected:1,passed:0,failed:1,skipped:0,pending:1,skippedUrls:1});
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
