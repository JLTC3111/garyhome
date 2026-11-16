import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseHtml} from '../lib/seo-analysis/html.ts';
import {analyzeContent} from '../lib/seo-analysis/content.ts';
import {analyzeTechnical} from '../lib/seo-analysis/technical.ts';
import {buildAuditPrintHtml} from '../lib/seo-audit/print-report.ts';
const destination=resolve(process.argv[2]||'output/reports/seo-localization');
await mkdir(destination,{recursive:true});
const url='https://www.garyhome.vn/en/homes/example-apartment';
const html='<html lang="en"><head><title>Apartment for rent in Hanoi | Gary Home</title><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main><h1>Apartment for rent in Hanoi</h1><p>Explore the apartment, check current availability and arrange a viewing with the local team.</p><img src="https://www.garyhome.vn/images/example.jpg"><a href="/en/contact">Contact the local team</a></main></body></html>';
const document=parseHtml(html,url),technical=analyzeTechnical({document,status:200,sitemapIncluded:true,robotsAllowed:true,responseMs:225,bytes:2340}),content=analyzeContent(document);
const run={id:'seo-localization-fixture-v1',created_at:'2026-11-13T00:00:00Z',finished_at:'2026-11-13T00:01:00Z',status:'completed',scope:'site',trigger:'manual',target_url:null,score_basis:'evaluated-checks-v3',content_score:content.score,technical_score:technical.score,page_count:1,critical_count:1,state:{pages:[{url,finalUrl:url,language:'en',declaredLanguage:'en',status:200,indexable:false,inspectionStatus:'inspected',attempts:1,content,technical}],queue:[],skippedUrls:[],requests:1,analysisVersion:3}};
for(const language of ['en','vi'])for(const mode of ['summary','full']){
 const name=`gary-home-seo-${mode}-${language}.html`;
 await writeFile(resolve(destination,name),buildAuditPrintHtml(run,'2026-11-13T00:02:00Z',{language,mode}));
 console.log(resolve(destination,name));
}
await writeFile(resolve(destination,'fixture.json'),JSON.stringify(run,null,2)+'\n');
