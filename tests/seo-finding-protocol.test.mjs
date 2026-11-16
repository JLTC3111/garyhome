import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeContent} from '../lib/seo-analysis/content.ts';
import {analyzeTechnical} from '../lib/seo-analysis/technical.ts';
import {parseHtml} from '../lib/seo-analysis/html.ts';
import {normalizeFinding,localizeFinding,findingLabel,knownFindingCodes} from '../shared/cms-foundation/seo-findings.js';
import {buildAuditPrintHtml,buildAuditSummaryHtml} from '../lib/seo-audit/print-report.ts';
const document=parseHtml('<html lang="en"><head><title>A real service page</title><meta name="description" content="Useful service information."><link rel="canonical" href="https://example.org/en/service"><link rel="alternate" hreflang="en" href="https://example.org/en/service"><link rel="alternate" hreflang="vi" href="https://example.org/vi/service"></head><body><main><h1>Service details</h1><p>Useful information about this service.</p></main></body></html>','https://example.org/en/service');
const broken={...document,title:'',titleCount:0,description:'',descriptionCount:0,canonical:[],htmlLanguage:'',hreflang:[],viewport:null,jsonLd:['{bad json']};
const technicalInputs=[{document,status:200,robotsAllowed:true,sitemapIncluded:true,responseMs:125,bytes:1024},{document:broken,status:404,robotsAllowed:false,sitemapIncluded:false,redirects:['https://example.org/old','https://example.org/older'],brokenLinks:[{url:'https://example.org/missing',status:404}]},{document:{...document,robots:['noindex'],canonical:['https://example.org/different'],hreflang:[{language:'invalid!',href:'broken'}],jsonLd:[]},status:200,sitemapIncluded:true}];
test('engine returns stable codes, typed parameters and unchanged severity independent of presentation language',()=>{
 for(const input of technicalInputs){
  const report=analyzeTechnical(input),before=JSON.stringify(report);
  for(const finding of report.findings){
   assert.equal(finding.code,finding.id);assert.equal(finding.schemaVersion,1);assert.ok(finding.params);
   const vi=localizeFinding(finding,'vi');
   for(const field of ['title','explanation','recommendation'])assert.notEqual(vi[field],finding[field],`${finding.code} ${field}`);
   assert.equal(vi.id,finding.id);assert.equal(vi.severity,finding.severity);assert.deepEqual(vi.params,finding.params);
  }
  assert.equal(JSON.stringify(report),before,'localization never mutates engine evidence or score');
 }
 const http=analyzeTechnical(technicalInputs[1]).findings.find(f=>f.id==='technical-http');assert.equal(http.params.status,404);
 const title=analyzeTechnical(technicalInputs[1]).findings.find(f=>f.id==='technical-title');assert.equal(title.params.count,0);
 const timing=analyzeTechnical(technicalInputs[0]).findings.find(f=>f.id==='technical-response-time');assert.deepEqual(timing.params,{milliseconds:125,bytes:1024});
 const content=analyzeContent(document);assert.ok(content.findings.every(f=>f.code&&f.params&&f.schemaVersion===1));
});
test('legacy and dynamic finding IDs upgrade without merging locale-specific checks',()=>{
 const original={id:'hreflang-reciprocal-vi',category:'technical',severity:'warning',title:'Language alternate needs review',explanation:'Original scanner explanation',recommendation:'Original scanner action',evidence:'https://example.org/vi/service'};
 const normalized=normalizeFinding(original);assert.equal(normalized.id,'hreflang-reciprocal-vi');assert.equal(normalized.code,'hreflang-reciprocal');assert.equal(normalized.params.language,'vi');
 const vi=localizeFinding(original,'vi');assert.match(vi.title,/đối ứng/);assert.equal(vi.evidence,original.evidence);
 assert.equal(localizeFinding(original,'en'),original,'legacy English presentation is backwards compatible');
 const codeOnly=localizeFinding({code:'future-check',severity:'warning',params:{}},'en');assert.ok(codeOnly.title&&codeOnly.explanation&&codeOnly.recommendation,'code-only future records fail safely with visible guidance');
 const unknown=localizeFinding({...original,id:'future-check',title:'ENGLISH_ENGINE_TITLE',explanation:'ENGLISH_ENGINE_EXPLANATION',recommendation:'ENGLISH_ENGINE_ACTION'},'vi');
 assert.doesNotMatch(JSON.stringify(unknown),/"title":"ENGLISH|"explanation":"ENGLISH|"recommendation":"ENGLISH/);assert.match(unknown.title,/future-check/);assert.equal(unknown.evidence,original.evidence);
});
test('CMS checks use the same English/Vietnamese catalogue with invariant parameters and severity',()=>{
 for(const code of ['cms-title-missing','cms-summary-missing','cms-body-missing','cms-seo-title-length','cms-seo-description-length','cms-slug','cms-translation-complete']){
  const finding={code,severity:code.endsWith('complete')?'passed':'warning',params:{language:'vi',count:75}};
  const en=localizeFinding(finding,'en'),vi=localizeFinding(finding,'vi');assert.notEqual(en.title,vi.title);assert.notEqual(en.recommendation,vi.recommendation);assert.deepEqual(en.params,vi.params);assert.equal(en.severity,vi.severity);
 }
 assert.equal(findingLabel('technical','vi'),'SEO kỹ thuật');
});
test('every known issue code resolves meaningful English and Vietnamese guidance without engine prose',()=>{
 const contentWarnings=new Set(['content-title','content-description','content-body','content-heading','content-heading-order','content-image-alt','content-link-text','content-repeated-paragraph']);
 for(const code of knownFindingCodes){
  const severity=code==='cms-translation-complete'?'passed':code.startsWith('cms-')?'critical':code.startsWith('content-')&&!contentWarnings.has(code)?'recommendation':'warning';
  const original={id:`observed:${code}`,code,params:{language:'vi',count:75,status:404,words:25,sentences:3},severity};
  const before=JSON.stringify(original);
  for(const language of ['en','vi']){
   const translated=localizeFinding(original,language);
   for(const field of ['title','explanation','recommendation'])assert.ok(translated[field],`${code}/${language}/${field}`);
   assert.doesNotMatch(translated.title,/^(SEO check:|Kiểm tra SEO:)/,`${code}/${language} has specific catalogue guidance`);
   assert.equal(translated.id,original.id);assert.equal(translated.code,code);assert.equal(translated.severity,severity);assert.deepEqual(translated.params,original.params);
  }
  assert.equal(JSON.stringify(original),before,'Presentation cannot mutate engine protocol data');
 }
 const english=localizeFinding({code:'technical-http',severity:'critical',params:{status:404}},'en');
 assert.equal(english.title,'Page is not a successful response');assert.match(english.recommendation,/Restore/);
});
test('full and executive Vietnamese exports render the same finding translation and preserve raw URL evidence',()=>{
 const findings=analyzeTechnical(technicalInputs[1]).findings;
 const run={id:'localized-fixture',created_at:'2026-11-13T00:00:00Z',status:'completed',scope:'site',score_basis:'evaluated-checks-v3',state:{pages:[{url:document.url,finalUrl:document.url,language:'en',status:404,indexable:false,inspectionStatus:'inspected',content:{score:null,findings:[]},technical:{score:null,findings}}],queue:[],skippedUrls:[]}};
 const full=buildAuditPrintHtml(run,'2026-11-13T00:00:00Z',{language:'vi'}),summary=buildAuditSummaryHtml(run,'2026-11-13T00:00:00Z','vi');
 const localized=localizeFinding(findings.find(f=>f.id==='technical-http'),'vi');
 for(const html of [full,summary]){assert.match(html,/<html lang="vi">/);assert.ok(html.includes(localized.title));assert.ok(html.includes(localized.recommendation));assert.doesNotMatch(html,/Page is not a successful response|Restore the page|Content SEO|Technical SEO/);assert.ok(html.includes(document.url));}
 assert.match(full,/Báo cáo kiểm tra SEO/);assert.match(summary,/Tóm tắt điều hành SEO/);
});
