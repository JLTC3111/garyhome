import test from 'node:test';
import assert from 'node:assert/strict';
import {reportCoverage,reportScoreDetails,evaluatedPages,groupedFindings} from '../lib/seo-audit/presentation.ts';
import {normalizeAuditState} from '../lib/seo-audit/normalize.ts';
import {equivalentSeoUrls} from '../lib/seo-analysis/url-identity.ts';
import {analyzeTechnical} from '../lib/seo-analysis/technical.ts';
import {parseHtml} from '../lib/seo-analysis/html.ts';
const origin='https://gary-public.com';
const finding=(id,severity='warning',evidence)=>({id,category:'technical',severity,title:id,explanation:'Observed evidence',recommendation:'Review the response',...(evidence?{evidence}:{})});
const page=(url,requested,declared,extra=[])=>({url,finalUrl:url,language:requested,declaredLanguage:declared,status:200,indexable:true,inspectionStatus:'inspected',attempts:1,canonical:origin+'/'+declared+'/homes',
 content:{score:100,findings:[]},technical:{score:50,findings:[finding('technical-language','passed',declared),finding('sitemap-discovery','warning'),...extra]}});

test('raw observations, URLs, locale variants, attempts and outcome subsets reconcile independently',()=>{
 const pages=[];for(const suffix of ['/homes','/en/homes','/vi/homes'])for(const requested of ['en','vi'])pages.push(page(origin+suffix,requested,suffix.startsWith('/vi')?'vi':suffix.startsWith('/en')?'en':requested));
 const state={pages,queue:[],skippedUrls:[{url:origin+'/admin',reason:'Excluded'},{url:origin+'/admin',reason:'Private'}],requests:9};
 const coverage=reportCoverage(state);
 assert.equal(coverage.observations,6);assert.equal(coverage.inspectedObservations,6);assert.equal(coverage.uniqueUrls,3);
 assert.equal(coverage.localeVariants,4);assert.equal(coverage.inspected,4);assert.equal(coverage.duplicateObservations,2);assert.equal(coverage.uniqueResources,1);
 assert.equal(coverage.canonicalVariants,2);assert.equal(coverage.passed,0);assert.equal(coverage.issues,4);assert.equal(coverage.failed,0);assert.equal(coverage.skippedUrls,1);
 assert.equal(coverage.pageAttempts,6);assert.equal(coverage.requests,9);assert.deepEqual(coverage.byLanguage,{en:{inspected:2,failed:0,skipped:0,pending:0},vi:{inspected:2,failed:0,skipped:0,pending:0}});
 const groups=groupedFindings(state).filter(group=>group.causeId==='sitemap-coverage');assert.equal(groups.length,2);assert.equal(groups.reduce((n,g)=>n+g.occurrences,0),6,'grouping preserves every observed genuine sitemap failure');
});

test('repeated response checks are scored once and conflicting evidence takes the worst severity',()=>{
 const a=page(origin+'/en/homes','en','en'),b=page(origin+'/en/homes','vi','en');
 a.technical.findings=[finding('http','passed')];b.technical.findings=[finding('http','critical')];
 const details=reportScoreDetails([a,b],'technical');assert.equal(details.evaluated,1);assert.equal(details.passed,0);assert.equal(details.failed,1);assert.equal(details.score,0);
 assert.equal(evaluatedPages([a,b]).length,1);assert.match(details.formula,/passed applicable checks/);
 const unknown={...a,status:0,inspectionStatus:'failed'};assert.equal(reportScoreDetails([unknown],'technical').score,null);
});

test('retained server-language evidence corrects scanner cookie labels without assuming locale availability',()=>{
 const correct=page(origin+'/en/homes','vi','en',[finding('language-response')]);
 const broken=page(origin+'/en/contact','en','vi',[finding('language-response')]);
 const state={pages:[correct,broken],queue:[],skippedUrls:[],updatedAt:1000};normalizeAuditState(state);
 assert.equal(correct.language,'en');assert.equal(correct.requestedLanguage,'vi');assert.equal(correct.urlLanguage,'en');assert.equal(correct.declaredLanguage,'en');
 assert.ok(!correct.technical.findings.some(f=>f.id==='language-response'));
 assert.ok(broken.technical.findings.some(f=>f.id==='language-response'),'wrong actual server language remains a genuine finding');
 assert.equal(state.classificationCorrections.length,1);assert.equal(state.classificationCorrections[0].findingId,'language-response');
 normalizeAuditState(state);assert.equal(state.classificationCorrections.length,1,'read normalization is idempotent');
});

test('canonical and hreflang checks distinguish known filters and legacy aliases from real cross-locale defects',()=>{
 assert.ok(equivalentSeoUrls(origin+'/en/homes?district=tay-ho',origin+'/en/homes','en'));
 assert.ok(equivalentSeoUrls(origin+'/homes?currency=USD&max=600',origin+'/vi/homes','vi'));
 assert.ok(equivalentSeoUrls(origin+'/en/',origin+'/en','en'));
 assert.equal(equivalentSeoUrls(origin+'/en/homes',origin+'/vi/homes','en'),false);
 assert.equal(equivalentSeoUrls(origin+'/en/homes?campaign=unique',origin+'/en/homes','en'),false);
 const html='<html lang="en"><head><title>Homes</title><meta name="description" content="Rental homes"><link rel="canonical" href="'+origin+'/en/homes"><link rel="alternate" hreflang="en" href="'+origin+'/en/homes"><link rel="alternate" hreflang="vi" href="'+origin+'/vi/homes"></head><body><h1>Homes</h1></body></html>';
 const result=analyzeTechnical({status:200,document:parseHtml(html,origin+'/en/homes?district=tay-ho'),finalUrl:origin+'/en/homes?district=tay-ho'});
 assert.ok(!result.findings.some(f=>f.id==='technical-canonical-target'));assert.equal(result.findings.find(f=>f.id==='technical-hreflang-self').severity,'passed');
 const wrong=analyzeTechnical({status:200,document:parseHtml(html.replaceAll('/en/homes','/vi/homes'),origin+'/en/homes'),finalUrl:origin+'/en/homes'});
 assert.ok(wrong.findings.some(f=>f.id==='technical-canonical-target'&&f.severity==='warning'));
});

test('correcting query reciprocity retains genuine missing localized sitemap coverage',()=>{
 const en=page(origin+'/en/homes','en','en'),vi=page(origin+'/vi/homes','vi','vi');
 const alternates=[{language:'en',href:en.url},{language:'vi',href:vi.url}];en.hreflang=alternates;vi.hreflang=alternates;
 const query={...page(origin+'/en/homes?district=tay-ho','en','en',[finding('technical-canonical-target'),finding('technical-hreflang-self'),finding('hreflang-reciprocal-vi')]),hreflang:alternates};
 const state={pages:[en,vi,query],queue:[],skippedUrls:[],updatedAt:1000};normalizeAuditState(state);
 assert.ok(query.technical.findings.some(f=>f.id==='sitemap-discovery'&&f.severity==='warning'));
 assert.ok(!query.technical.findings.some(f=>f.id==='technical-canonical-target'||f.id==='hreflang-reciprocal-vi'));
 assert.equal(query.technical.findings.find(f=>f.id==='technical-hreflang-self').severity,'passed');
});
