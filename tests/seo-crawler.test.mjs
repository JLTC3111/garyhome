import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {syncBuiltinESMExports} from 'node:module';
import {createCrawl,advanceCrawl,parseRobots,robotsAllows,isPublicAddress,normalizeCrawlUrl} from '../lib/seo-audit/crawler.ts';

const origin='https://gary-public.com';
const page=(title,body='',extra='')=>`<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="A useful description for this page.">${extra}</head><body><main><h1>${title}</h1><p>A useful original guide with practical details.</p>${body}</main></body></html>`;
function harness(routes){let time=1000;const calls=[];return {calls,now:()=>time,tick:ms=>{time+=ms;},options:{now:()=>time,sleep:async ms=>{time+=ms;},resolveHost:async()=>['93.184.216.34'],budgetMs:12000,fetch:async(url,init)=>{calls.push({url,at:time,headers:new Headers(init.headers)});const fn=routes[url]??(url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':url.endsWith('/sitemap.xml')?new Response('',{status:404}):new Response('',{status:404}));const value=typeof fn==='function'?await fn(init):fn;return typeof value==='string'?new Response(value,{headers:{'content-type':url.endsWith('.xml')?'application/xml':url.endsWith('.txt')?'text/plain':'text/html'}}):value;}}};}
async function finish(state,h,max=100){for(let i=0;i<max&&['queued','running'].includes(state.status);i++){await advanceCrawl(state,h.options);h.tick(1000);}assert.ok(!['queued','running'].includes(state.status),'crawl terminated');return state;}

test('resumable sitemap discovery analyzes language variants, retains noindex and bounds external inspection',async()=>{
 const external='https://links.gary-public.com/resource';
 const h=harness({[origin+'/sitemap.xml']:'<urlset><url><loc>'+origin+'/</loc></url><url><loc>'+origin+'/hidden</loc></url></urlset>',[origin+'/']:(init)=>{const vi=new Headers(init.headers).get('cookie')==='gary-language=vi';return page(vi?'Trang chủ':'Home',`<a href="/hidden">Hidden</a><a href="${external}">Reference</a><a href="/admin">Admin</a>`).replace('lang="en"',vi?'lang="vi"':'lang="en"');},[origin+'/hidden']:page('Hidden','','<meta name="robots" content="noindex">'),[external]:page('External','<a href="https://links.gary-public.com/never">Never crawl this</a>')});
 const state=await finish(createCrawl({allowedOrigins:[origin],languages:['en','vi']},[origin+'/'],h.now()),h);
 assert.equal(state.pages.length,4);assert.equal(state.pages.filter(p=>!p.indexable).length,2);
 assert.deepEqual(new Set(state.pages.map(p=>p.language)),new Set(['en','vi']));
 assert.ok(state.pages.every(p=>p.content.findings.every(f=>f.category==='content')&&p.technical.findings.every(f=>f.category==='technical')));
 assert.ok(!h.calls.some(call=>call.url.includes('/admin')||call.url.includes('/never')));
 const externalCalls=h.calls.filter(call=>call.url.startsWith('https://links.'));assert.equal(externalCalls.length,2);assert.ok(externalCalls.every(call=>!call.headers.has('cookie')));
 for(const host of new Set(h.calls.map(c=>new URL(c.url).host))){const calls=h.calls.filter(c=>new URL(c.url).host===host);for(let i=1;i<calls.length;i++)assert.ok(calls[i].at-calls[i-1].at>=1000);}
});

test('robots follows specific agent groups, longest match, wildcard anchors and Allow tie precedence',()=>{
 const {record}=parseRobots('User-agent: *\nDisallow: /\nUser-agent: GaryHomeSEO\nDisallow: /private*\nAllow: /private/open$\nDisallow: /same\nAllow: /same\nCrawl-delay: 2');
 assert.ok(robotsAllows(record,origin+'/public'));assert.ok(!robotsAllows(record,origin+'/private/no'));
 assert.ok(robotsAllows(record,origin+'/private/open'));assert.ok(!robotsAllows(record,origin+'/private/open/more'));assert.ok(robotsAllows(record,origin+'/same'));assert.equal(record.delayMs,2000);
});

test('maximum URL, depth, time and serialized continuation limits are explicit',async()=>{
 const h=harness({[origin+'/']:page('Home','<a href="/next">Next</a><a href="/other">Other</a>')});
 let state=createCrawl({allowedOrigins:[origin],maxUrls:1},[origin+'/'],h.now());
 await advanceCrawl(state,h.options);state=JSON.parse(JSON.stringify(state));await finish(state,h);
 assert.equal(new Set(state.pages.map(p=>p.url)).size,1);assert.equal(state.status,'incomplete');assert.ok(state.skippedUrls.some(item=>item.reason.includes('URL limit')));
 const depth=await finish(createCrawl({allowedOrigins:[origin],maxDepth:0},[origin+'/'],h.now()),h);assert.ok(depth.skippedUrls.some(item=>item.reason.includes('depth')));
 const timed=createCrawl({allowedOrigins:[origin],maxDurationMs:1000},[origin+'/'],h.now());h.tick(1001);await advanceCrawl(timed,h.options);assert.equal(timed.status,'incomplete');assert.ok(timed.skippedUrls.every(item=>item.reason.includes('duration')));
});

test('private destinations, unsafe redirects and excluded routes never receive requests',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(normalizeCrawlUrl('https://127.0.0.1/'),null);assert.equal(normalizeCrawlUrl('https://gary-public.com:444/'),null);
 const h=harness({[origin+'/']:new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}})});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(state.pages[0].status,0);assert.equal(state.pages[0].inspectionStatus,'failed');assert.equal(state.pages[0].technical.score,null);assert.equal(state.pages[0].technical.findings.length,0);assert.ok(!h.calls.some(call=>call.url.includes('127.0.0.1')));
 const unsafe=harness({});unsafe.options.resolveHost=async()=>['10.1.2.3'];const blocked=await finish(createCrawl({allowedOrigins:[origin]},[origin+'/'],unsafe.now()),unsafe);assert.equal(unsafe.calls.length,0);assert.equal(blocked.status,'incomplete');
});

test('canonical targets are fetched before being marked inspected and nonindexable targets are critical',async()=>{
 const h=harness({[origin+'/sitemap.xml']:'<urlset/>',[origin+'/']:page('Alias','','<link rel="canonical" href="'+origin+'/target">'),[origin+'/target']:page('Target','','<link rel="canonical" href="'+origin+'/target"><meta name="robots" content="noindex">')});
 const state=await finish(createCrawl({allowedOrigins:[origin]},[origin+'/'],h.now()),h);
 assert.ok(h.calls.some(call=>call.url===origin+'/target'));assert.ok(state.pages.find(p=>p.url===origin+'/').technical.findings.some(f=>f.id==='canonical-target-indexing'&&f.severity==='critical'));
});

test('single-page rescans do not recurse; broken links are reconciled in site scans',async()=>{
 const routes={[origin+'/']:page('Home','<a href="/broken">Broken</a>'),[origin+'/broken']:new Response(page('Not found'),{status:404,headers:{'content-type':'text/html'}})};
 const h=harness(routes);const one=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);assert.equal(one.pages.length,1);assert.ok(!h.calls.some(c=>c.url.endsWith('/sitemap.xml')));assert.ok(one.pages[0].technical.findings.some(f=>f.id==='broken-links'));
 const all=harness(routes),site=await finish(createCrawl({allowedOrigins:[origin]},[origin+'/'],all.now()),all);assert.ok(site.pages.find(p=>p.url===origin+'/').technical.findings.some(f=>f.id==='broken-links'));
});

test('rate limits preserve retry-after across chunks and do not create request bursts',async()=>{
 let attempts=0;const h=harness({[origin+'/'] :()=>++attempts===1?new Response('',{status:429,headers:{'retry-after':'20'}}):page('Home')});
 const state=createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now());await advanceCrawl(state,h.options);assert.equal(state.status,'running');assert.equal(state.pages.length,0);assert.ok(state.queue.length);h.tick(21000);await finish(state,h);assert.equal(state.pages[0].status,200);assert.ok(h.calls.filter(c=>c.url===origin+'/')[1].at-h.calls.filter(c=>c.url===origin+'/')[0].at>=20000);
});

test('resumed batches refresh broken-link evidence instead of retaining the first partial result',async()=>{
 const h=harness({[origin+'/']:page('Home','<a href="/first">First</a><a href="/second">Second</a>')});
 h.options.budgetMs=1100;
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 const findings=state.pages[0].technical.findings.filter(f=>f.id==='broken-links');
 assert.equal(findings.length,1);
 assert.match(findings[0].explanation,/\/first/);
 assert.match(findings[0].explanation,/\/second/);
});

test('default HTTPS transport pins the validated DNS address while retaining the original TLS hostname',async()=>{
 const original=https.request,seen=[];
 https.request=(url,options,callback)=>{
  seen.push({url,options});
  options.lookup(new URL(url).hostname,{all:false},(error,address,family)=>{assert.ifError(error);assert.equal(address,'93.184.216.34');assert.equal(family,4);});
  const outgoing=new EventEmitter();outgoing.end=()=>queueMicrotask(()=>{const incoming=Readable.from([url.endsWith('/robots.txt')?'User-agent: *\nAllow: /':page('Pinned request')]);incoming.statusCode=200;incoming.headers={'content-type':url.endsWith('.txt')?'text/plain':'text/html'};callback(incoming);});return outgoing;
 };
 syncBuiltinESMExports();
 try {
  let now=1000;const state=createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],now);
  await advanceCrawl(state,{now:()=>now,sleep:async ms=>{now+=ms;},resolveHost:async()=>['93.184.216.34']});
  assert.equal(state.status,'completed');assert.equal(state.pages[0].status,200);assert.ok(seen.every(call=>call.url.startsWith(origin)&&call.options.agent===false));
 }finally{https.request=original;syncBuiltinESMExports();}
});

test('DNS and full response-body reads are included in the request timeout',async()=>{
 const state=createCrawl({allowedOrigins:[origin],scope:'page',timeoutMs:100},[origin+'/']);
 const started=Date.now();await advanceCrawl(state,{resolveHost:()=>new Promise(()=>{})});
 assert.ok(Date.now()-started<6000);assert.equal(state.status,'incomplete');assert.ok(state.skippedUrls.some(item=>item.reason.includes('timed out')));
 let cancelled=false;const bodyState=createCrawl({allowedOrigins:[origin],scope:'page',timeoutMs:100},[origin+'/']);
 await advanceCrawl(bodyState,{resolveHost:async()=>['93.184.216.34'],fetch:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 assert.ok(cancelled);assert.equal(bodyState.status,'incomplete');
});

test('safe external HTTP links are status-checked with no recursion while audit origins remain HTTPS-only',async()=>{
 const external='http://links.gary-public.com/broken';
 assert.equal(normalizeCrawlUrl(external),null);assert.equal(normalizeCrawlUrl(external,undefined,true),external);
 assert.equal(normalizeCrawlUrl('http://127.0.0.1/',undefined,true),null);assert.equal(normalizeCrawlUrl('http://169.254.169.254/',undefined,true),null);
 assert.throws(()=>createCrawl({allowedOrigins:['http://gary-public.com']},[]),/HTTPS/);
 const h=harness({[origin+'/']:page('Home',`<a href="${external}">External reference</a>`),[external]:new Response(page('Broken','<a href="http://links.gary-public.com/never">Never</a>'),{status:404})});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.ok(state.pages[0].links.includes(external));assert.equal(state.linkChecks[external].status,404);assert.ok(state.pages[0].technical.findings.some(f=>f.id==='broken-links'));
 assert.ok(h.calls.some(call=>call.url==='http://links.gary-public.com/robots.txt'));assert.ok(!h.calls.some(call=>call.url.includes('/never')));
 assert.ok(h.calls.filter(call=>call.url.startsWith('http:')).every(call=>!call.headers.has('cookie')));
});

test('robots-blocked public pages are skipped without pretending unknown content was evaluated',async()=>{
 const h=harness({[origin+'/robots.txt']:'User-agent: *\nDisallow: /'});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(h.calls.length,1);assert.equal(state.pages.length,1);const report=state.pages[0];assert.equal(report.status,0);assert.equal(report.content.score,null);assert.equal(report.content.findings.length,0);assert.equal(report.inspectionStatus,'skipped');assert.equal(report.technical.score,null);assert.equal(report.technical.findings.length,0);assert.match(report.crawlError,/Blocked by robots/);
});

test('fetch duration excludes intentional host throttling',async()=>{
 const h=harness({[origin+'/']:()=>{h.tick(10);return page('Quick response');}});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.ok(h.calls[1].at-h.calls[0].at>=1000);assert.equal(state.pages[0].responseMs,10);
});

test('sitemap membership checks the preferred URL after redirects',async()=>{
 const h=harness({[origin+'/sitemap.xml']:`<urlset><url><loc>${origin}/preferred</loc></url></urlset>`,[origin+'/']:new Response('',{status:301,headers:{location:origin+'/preferred'}}),[origin+'/preferred']:page('Preferred','','<link rel="canonical" href="'+origin+'/preferred">')});
 const state=await finish(createCrawl({allowedOrigins:[origin]},[origin+'/'],h.now()),h);
 assert.equal(state.pages.find(p=>p.url===origin+'/').technical.findings.find(f=>f.id==='sitemap-discovery').severity,'passed');
});

test('soft batch deadlines never shorten the configured request timeout or fabricate terminal failures',async()=>{
 const h=harness({[origin+'/']:()=>{h.tick(1500);return page('Slow but valid');}});
 h.options.budgetMs=1100;
 const state=createCrawl({allowedOrigins:[origin],scope:'page',timeoutMs:10000},[origin+'/'],h.now());
 await finish(state,h);
 assert.equal(state.status,'completed');assert.equal(state.pages[0].inspectionStatus,'inspected');assert.equal(state.pages[0].responseMs,1500);assert.equal(state.pages[0].attempts,1);
});

test('transient network and server errors retry safely and resumed serialized tasks keep attempt limits',async()=>{
 let attempts=0;
 const h=harness({[origin+'/']:()=>{attempts++;if(attempts===1){const e=new Error('socket disconnected');e.code='ECONNRESET';throw e;}if(attempts===2)return new Response('',{status:502});return page('Recovered');}});
 h.options.budgetMs=1100;
 let state=createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now());
 await advanceCrawl(state,h.options);state=JSON.parse(JSON.stringify(state));await finish(state,h);
 assert.equal(attempts,3);assert.equal(state.pages.length,1);assert.equal(state.pages[0].inspectionStatus,'inspected');assert.equal(state.pages[0].attempts,3);assert.equal(state.pages[0].technical.findings.some(f=>f.title.includes('could not')),false);assert.equal(state.diagnostics.filter(d=>d.kind==='page').length,2);
});

test('exhausted retries record an inspection failure with unknown scores instead of SEO defects',async()=>{
 let attempts=0;const h=harness({[origin+'/']:()=>{attempts++;return new Response('',{status:503});}});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(attempts,3);assert.equal(state.status,'incomplete');assert.equal(state.pages[0].inspectionStatus,'failed');assert.equal(state.pages[0].status,503);
 for(const category of ['content','technical']){assert.equal(state.pages[0][category].score,null);assert.deepEqual(state.pages[0][category].findings,[]);}
 assert.match(state.pages[0].crawlError,/HTTP 503/);
});

test('global duration exhaustion preserves pending work and does not create a false success state',async()=>{
 const h=harness({});const state=createCrawl({allowedOrigins:[origin],maxDurationMs:1000},[origin+'/homes'],h.now());
 const count=state.queue.length;h.tick(1001);await advanceCrawl(state,h.options);
 assert.equal(state.status,'incomplete');assert.equal(state.queue.length,count);assert.equal(state.pages.length,0);assert.match(state.stopReason,/duration/);
});

test('a successful HTTP error inspection scores only the observed HTTP defect, not invented HTML checks',async()=>{
 const h=harness({[origin+'/']:new Response('Not found',{status:404,headers:{'content-type':'text/plain'}})});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h),result=state.pages[0];
 assert.equal(result.inspectionStatus,'inspected');assert.equal(result.content.score,null);assert.equal(result.content.findings.length,0);assert.ok(result.technical.findings.every(f=>f.severity!=='passed'));assert.ok(!result.technical.findings.some(f=>/title|canonical|description|language/.test(f.id)));
});

test('trusted runtime fetch explicitly supports configured origins without unsupported Node lookup or arbitrary external requests',async()=>{
 const external='https://reference.other-public.com/article';
 const h=harness({[origin+'/']:page('Trusted runtime',`<a href="${external}">External source</a><a href="https://facebook.com/share">Share</a>`)});
 h.options.transportMode='trusted-fetch';h.options.resolveHost=async()=>{throw new Error('The options.lookup option is not implemented');};
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(state.pages[0].inspectionStatus,'inspected');assert.equal(state.transportMode,'trusted-fetch');assert.ok(h.calls.every(c=>new URL(c.url).origin===origin));
 assert.ok(state.skippedUrls.some(s=>s.url===external&&/DNS-pinned/.test(s.reason)));assert.ok(state.skippedUrls.some(s=>s.url.includes('facebook')&&/Irrelevant/.test(s.reason)));
 assert.ok(state.pages[0].technical.findings.some(f=>f.id==='link-coverage'));
});

test('localized URL mode sends one request per language URL and preserves explicit language routing',async()=>{
 const h=harness({[origin+'/en']:page('English','<a href="/homes">Homes</a><a href="/vi">Tiếng Việt</a>'),[origin+'/en/homes']:page('Homes'),[origin+'/vi']:page('Tiếng Việt').replace('lang="en"','lang="vi"')});
 const state=await finish(createCrawl({allowedOrigins:[origin],languages:['en','vi'],languageMode:'url'},[origin+'/en',origin+'/vi'],h.now()),h);
 assert.equal(h.calls.filter(c=>c.url===origin+'/en').length,1);assert.equal(h.calls.filter(c=>c.url===origin+'/vi').length,1);assert.equal(h.calls.filter(c=>c.url===origin+'/en/homes').length,1);
 assert.ok(!h.calls.some(c=>c.url===origin+'/homes'));assert.ok(h.calls.every(c=>!c.headers.has('cookie')));
 assert.equal(state.pages.filter(p=>p.url===origin+'/vi')[0].language,'vi');
});

test('localized app query variants consolidate to one preferred page without pretending each query was fetched',async()=>{
 const h=harness({[origin+'/en']:page('English',`<a href="/homes?type=Apartment">Apartments</a><a href="/en/homes?district=tay-ho">Tay Ho</a><a href="/en/homes?budget=500">Budget homes</a><a href="/contact?area=tay-ho">Ask about Tay Ho</a><a href="/contact?area=ba-dinh">Ask about Ba Dinh</a><a href="/campaign?variant=one">Campaign one</a><a href="/campaign?variant=two">Campaign two</a>`),[origin+'/en/homes']:page('Homes'),[origin+'/en/contact']:page('Contact'),[origin+'/campaign?variant=one']:page('One'),[origin+'/campaign?variant=two']:page('Two')});
 const state=await finish(createCrawl({allowedOrigins:[origin],languageMode:'url'},[origin+'/en'],h.now()),h);
 assert.equal(h.calls.filter(c=>c.url===origin+'/en/homes').length,1);assert.equal(h.calls.filter(c=>c.url===origin+'/en/contact').length,1);
 assert.ok(!h.calls.some(c=>/type=|district=|budget=|area=/.test(c.url)));
 assert.ok(h.calls.some(c=>c.url===origin+'/campaign?variant=one'));assert.ok(h.calls.some(c=>c.url===origin+'/campaign?variant=two'));
 assert.equal(state.skippedUrls.filter(s=>/query variant consolidated/.test(s.reason)).length,5);
 const home=state.pages.find(p=>p.url===origin+'/en');assert.ok(home.links.includes(origin+'/homes?type=Apartment'));assert.ok(home.technical.findings.some(f=>f.id==='link-coverage'));
 assert.ok(!state.linkChecks[origin+'/homes?type=Apartment'],'the unfetched original query must have no fabricated HTTP result');
});

test('trusted runtime transport still rejects literal private destinations and private redirect targets',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','[::1]']) assert.throws(()=>createCrawl({allowedOrigins:[`https://${ip}`]},[]),/HTTPS/);
 const h=harness({[origin+'/']:new Response('',{status:302,headers:{location:'https://169.254.169.254/latest/meta-data/'}})});
 h.options.transportMode='trusted-fetch';h.options.resolveHost=async()=>{throw new Error('Unsupported lookup must not be called');};
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(state.pages[0].inspectionStatus,'failed');assert.equal(state.pages[0].technical.score,null);assert.deepEqual(state.pages[0].technical.findings,[]);assert.ok(!h.calls.some(c=>c.url.includes('169.254')));
});
