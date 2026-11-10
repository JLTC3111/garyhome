import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeContent,contentStatistics} from '../lib/seo-analysis/content.ts';
import {parseHtml,decodeHtml} from '../lib/seo-analysis/html.ts';
import {analyzeTechnical} from '../lib/seo-analysis/technical.ts';
const url='https://garyhome.vn/tips-and-news/renting';
const input={url,language:'en',title:'Renting in Hanoi | Gary Home',description:'A practical guide to renting a home in Hanoi.',text:'Choose a home that suits your needs. Check the lease before signing.',headings:[{level:1,text:'Renting in Hanoi'},{level:2,text:'Check your lease'}],links:[{href:'/services',text:'Home finding services'}],images:[{src:'/lease.jpg',alt:'An example rental lease'}]};
const find=(report,id)=>report.findings.find(f=>f.id===id);
test('content and technical findings remain strictly separate; advisory keyword and length rules do not affect scores',()=>{
 const report=analyzeContent(input);assert.equal(report.score,100);assert.ok(report.findings.every(f=>f.category==='content'));
 const advisory=analyzeContent({...input,focusKeyword:'different wording',title:input.title.repeat(4),description:input.description.repeat(6)});
 assert.equal(advisory.score,report.score);assert.equal(find(advisory,'content-focus-topic').severity,'recommendation');assert.equal(find(advisory,'content-title-preview').severity,'recommendation');
 const missing=analyzeContent({...input,title:'',description:'',text:'',headings:[]});assert.ok(missing.score<report.score);assert.equal(find(missing,'content-title').severity,'warning');
});
test('alt text distinguishes missing attributes, intentional empty text and generic descriptions',()=>{
 assert.equal(find(analyzeContent({...input,images:[{src:'photo.jpg',alt:''}]}),'content-image-alt').severity,'passed');
 assert.equal(find(analyzeContent({...input,images:[{src:'photo.jpg',alt:null}]}),'content-image-alt').severity,'warning');
 assert.equal(find(analyzeContent({...input,images:[{src:'photo.jpg',alt:'photo'}]}),'content-image-alt-quality').severity,'recommendation');
});
test('language aware counts support Vietnamese, CJK and invalid locale without English reading grade assumptions',()=>{
 for(const [language,text]of [['vi','Tìm căn hộ phù hợp. Kiểm tra hợp đồng thuê nhà.'],['ja','東京の賃貸住宅を探します。契約を確認します。'],['not a locale','A useful sentence. Another useful sentence.']]){
  const report=analyzeContent({...input,language,text});assert.ok(contentStatistics({...input,language,text}).words>0);assert.equal(find(report,'content-readability').severity,'recommendation');
 }
});
test('server HTML parser handles streamed metadata, quoted delimiters, scripts, entities, JSON-LD and contextual headings',()=>{
 const html=`<!doctype html><html lang="vi"><head><title>Thuê &amp; sống</title><meta name="viewport" content="width=device-width"></head><body><nav><h1>Menu</h1></nav><main><header><h1>Thuê nhà</h1></header><p>Ngôi nhà &lt; lý tưởng &gt;.</p><h2>Vị trí</h2><a href="/services?x=1&amp;y=2" title="A > B"><img src="/room.jpg" alt="Phòng khách"></a></main><script>const data = '<h1>Fake title</h1><meta name="robots" content="noindex">';</script><script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","name":"<h1>not markup</h1>"}</script><meta name="description" content="Mô tả &quot;nhà&quot;"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="/en/renting"></body></html>`;
 const doc=parseHtml(html,url);assert.equal(doc.title,'Thuê & sống');assert.equal(doc.description,'Mô tả "nhà"');assert.equal(doc.htmlLanguage,'vi');assert.deepEqual(doc.headings,[{level:1,text:'Thuê nhà'},{level:2,text:'Vị trí'}]);assert.ok(!doc.text.includes('Fake'));assert.ok(!doc.text.includes('Menu'));assert.ok(doc.text.includes('Ngôi nhà < lý tưởng >.'));assert.equal(doc.robots.length,0);assert.equal(doc.jsonLd.length,1);assert.equal(doc.links[0].href,'https://garyhome.vn/services?x=1&y=2');assert.ok(doc.links[0].text.includes('Phòng khách'));assert.equal(doc.hreflang[0].href,'https://garyhome.vn/en/renting');
 assert.equal(decodeHtml('&#x1f600; &#272; &amp;'),'😀 Đ &');
});
test('technical restrictions stay critical despite complete content, and omitted checks never pass',()=>{
 const document=parseHtml(`<html lang="en"><head><title>Page</title><meta name="description" content="Summary"><meta name="viewport" content="width=device-width"><link rel="canonical" href="${url}"><meta name="robots" content="noindex, follow"></head><main><h1>Page</h1><p>Content</p></main></html>`,url);
 const report=analyzeTechnical({document,status:200,xRobotsTag:'index',sitemapIncluded:true});
 assert.ok(report.findings.every(f=>f.category==='technical'));assert.equal(find(report,'technical-indexability').severity,'critical');assert.equal(find(report,'technical-sitemap-noindex').severity,'warning');assert.equal(find(report,'technical-broken-links'),undefined);assert.equal(find(report,'technical-robots'),undefined);
 assert.equal(find(analyzeTechnical({document:{...document,robots:[]},status:503}),'technical-http').severity,'critical');
});
test('technical checks flag duplicate metadata, malformed canonical, invalid JSON, hreflang and observed broken links',()=>{
 const document=parseHtml('<html><title>A</title><title>B</title><meta name="description" content="One"><meta name="description" content="Two"><link rel="canonical"><script type="application/ld+json">{oops</script><link rel="alternate" hreflang="???" href="javascript:bad"></html>',url);
 const report=analyzeTechnical({document,status:200,brokenLinks:[{url:'https://garyhome.vn/gone',status:404}]});
 for(const id of ['technical-title','technical-description','technical-canonical','technical-structured-data','technical-language','technical-hreflang','technical-broken-links'])assert.equal(find(report,id).severity,'warning',id);
});
test('heading gaps, repeated paragraphs and unlabelled links produce actionable warnings',()=>{
 const paragraph='This is an original paragraph about choosing a suitable home and carefully checking the rental contract before signing.';
 const report=analyzeContent({...input,text:paragraph+'\n\n'+paragraph,headings:[{level:1,text:'Home'},{level:3,text:'Lease'}],links:[{href:'/services',text:''}]});
 for(const id of ['content-heading-order','content-repeated-paragraph','content-link-text'])assert.equal(find(report,id).severity,'warning');
});
test('canonical target mismatches are reviewable rather than an automatic claim of failure',()=>{
 const document=parseHtml(`<html lang="en"><title>A</title><link rel="canonical" href="https://garyhome.vn/other"></html>`,url);
 const report=analyzeTechnical({document,status:200});
 assert.equal(find(report,'technical-canonical').severity,'passed');assert.equal(find(report,'technical-canonical-target').severity,'warning');
 assert.ok(find(report,'technical-canonical-target').recommendation.includes('duplicate'));
});
test('JSON-LD needs a meaningful typed shape; a malformed graph does not pass as valid schema',()=>{
 for(const shape of [{'@graph':{}},{'@graph':[]},{'@graph':[null]},{'@type':null},{'@graph':[{'name':'Untyped'}]},[]]){
  const document=parseHtml(`<script type="application/ld+json">${JSON.stringify(shape)}</script>`,url);
  assert.equal(find(analyzeTechnical({document,status:200}),'technical-structured-data').severity,'warning',JSON.stringify(shape));
 }
 const document=parseHtml('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Gary Home"}]}</script>',url);
 assert.equal(find(analyzeTechnical({document,status:200}),'technical-structured-data').severity,'passed');
});
test('bot-scoped X-Robots-Tag restrictions apply to the intended web crawler only',()=>{
 const document=parseHtml('<html lang="en"><title>A</title></html>',url);
 for(const xRobotsTag of ['otherbot: noindex','googlebot-image: noindex','otherbot: none, nofollow','unavailable_after: 25 Jun 2010 15:00:00 PST'])assert.equal(find(analyzeTechnical({document,status:200,xRobotsTag}),'technical-indexability').severity,'passed',xRobotsTag);
 for(const xRobotsTag of ['noindex','none','googlebot: noindex','otherbot: index, googlebot: noindex','noindex, otherbot: index'])assert.equal(find(analyzeTechnical({document,status:200,xRobotsTag}),'technical-indexability').severity,'critical',xRobotsTag);
});
test('same-page anchor links do not count as links to related internal pages',()=>{
 const report=analyzeContent({...input,links:[{href:'#lease',text:'Lease section'},{href:url+'#costs',text:'Costs'}]});
 assert.equal(find(report,'content-internal-links').severity,'recommendation');
});
test('hreflang sets need a language-specific self reference only when alternates are declared',()=>{
 const html=links=>`<html lang="en"><title>Guide</title>${links}</html>`;
 const inspect=links=>analyzeTechnical({document:parseHtml(html(links),url),status:200});
 assert.equal(find(inspect(''),'technical-hreflang-self'),undefined);
 assert.equal(find(inspect('<link rel="alternate" hreflang="vi" href="https://garyhome.vn/vi/renting">'),'technical-hreflang-self').severity,'warning');
 assert.equal(find(inspect(`<link rel="alternate" hreflang="x-default" href="${url}">`),'technical-hreflang-self').severity,'warning');
 assert.equal(find(inspect(`<link rel="alternate" hreflang="vi" href="${url}">`),'technical-hreflang-self').severity,'warning');
 assert.equal(find(inspect(`<link rel="alternate" hreflang="en" href="${url}"><link rel="alternate" hreflang="vi" href="https://garyhome.vn/vi/renting">`),'technical-hreflang-self').severity,'passed');
});

test('actual React streamed Suspense content is analyzed in its main boundary instead of its loading shell',async()=>{
 const React=await import('react'),{renderToPipeableStream}=await import('react-dom/server'),{PassThrough}=await import('node:stream');
 let ready=false;const pending=new Promise(resolve=>setTimeout(()=>{ready=true;resolve();},15));
 function DelayedPage(){if(!ready)throw pending;return React.createElement('section',null,React.createElement('h1',null,'A rental guide for Hanoi'),React.createElement('p',null,'Inspect the lease and confirm the included services before arranging your viewing.'));}
 const html=await new Promise((resolve,reject)=>{const output=new PassThrough();let text='';output.on('data',chunk=>{text+=chunk;});output.on('end',()=>resolve(text));output.on('error',reject);const stream=renderToPipeableStream(React.createElement('html',null,React.createElement('body',null,React.createElement('main',null,React.createElement(React.Suspense,{fallback:React.createElement('p',null,'Loading content...')},React.createElement(DelayedPage))),React.createElement('footer',null,React.createElement('h2',null,'Footer navigation')))),{onShellReady(){stream.pipe(output);},onError:reject});});
 assert.match(html,/<template id="B:/);assert.match(html,/\$RC\("B:/);
 assert.ok(html.indexOf('<h1>')>html.indexOf('</main>'),'fixture must reproduce server streaming page content after the shell');
 const document=parseHtml(html,url);
 assert.deepEqual(document.headings,[{level:1,text:'A rental guide for Hanoi'}]);assert.match(document.text,/Inspect the lease/);assert.doesNotMatch(document.text,/Loading content|Footer navigation/);
 assert.equal(find(analyzeContent(document),'content-heading').severity,'passed');
});

test('streamed heading recovery requires an observed replacement into main and never promotes unrelated hidden or footer content',()=>{
 const html='<html><body><main><p>A real page without a main heading.</p></main><footer><!--$?--><template id="B:2"></template><p>Footer fallback</p><!--/$--></footer><div hidden id="S:2"><section><h1>Footer heading</h1></section></div><div hidden id="S:unrelated"><h1>Unused hidden heading</h1></div><script>$RC("B:2","S:2")</script></body></html>';
 const document=parseHtml(html,url);assert.equal(document.headings.length,0);assert.doesNotMatch(document.text,/Footer|hidden/);assert.equal(find(analyzeContent(document),'content-heading').severity,'warning');
 const missing='<main><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--></main><script>$RC("B:0","S:0")</script>';
 assert.equal(find(analyzeContent(parseHtml(missing,url)),'content-heading').severity,'warning','an unfinished stream must not invent a main heading');
});
