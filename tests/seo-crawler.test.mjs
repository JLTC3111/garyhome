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
 assert.equal(state.pages[0].status,0);assert.ok(state.pages[0].technical.findings.some(f=>f.severity==='critical'));assert.ok(!h.calls.some(call=>call.url.includes('127.0.0.1')));
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
 assert.ok(Date.now()-started<1000);assert.equal(state.status,'incomplete');assert.ok(state.skippedUrls.some(item=>item.reason.includes('timed out')));
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

test('robots-blocked public pages retain a critical technical report without fetching unknown content',async()=>{
 const h=harness({[origin+'/robots.txt']:'User-agent: *\nDisallow: /'});
 const state=await finish(createCrawl({allowedOrigins:[origin],scope:'page'},[origin+'/'],h.now()),h);
 assert.equal(h.calls.length,1);assert.equal(state.pages.length,1);const report=state.pages[0];assert.equal(report.status,0);assert.equal(report.content.score,null);assert.equal(report.content.findings.length,0);assert.equal(report.technical.findings.length,1);assert.equal(report.technical.findings[0].id,'robots-blocked');assert.equal(report.technical.findings[0].severity,'critical');
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
