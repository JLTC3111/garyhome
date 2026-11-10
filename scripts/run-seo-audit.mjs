// Reproducible, credential-free audit of a public deployment. This does not
// deploy code, write database rows, or alter an earlier run's evidence.
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createCrawl,advanceCrawl} from '../lib/seo-audit/crawler.ts';
import {compareAuditMetadata} from '../lib/seo-audit/compare.ts';
import {normalizeAuditState} from '../lib/seo-audit/normalize.ts';
import {reportCoverage,evaluatedScore} from '../lib/seo-audit/presentation.ts';
import {PUBLIC_LANDING_PATHS} from '../lib/public-routes.ts';
const args=process.argv.slice(2),option=(name,fallback)=>{const index=args.indexOf(name);return index>=0?args[index+1]:fallback;};
const origin=new URL(option('--origin','https://www.garyhome.vn')).origin;
const output=path.resolve(option('--output','docs/seo-evidence/production-after.json'));
const languageMode=option('--mode','cookie');
if(!['cookie','url'].includes(languageMode))throw new Error('Use --mode cookie for legacy deployments or url for localized routes.');
const seeds=new Set(PUBLIC_LANDING_PATHS.map(value=>new URL(value,origin).href));
const seedFile=option('--seed-file');
if(seedFile){
 const saved=JSON.parse(await readFile(seedFile,'utf8'));
 for(const value of [...saved.state.pages,...saved.state.queue.filter(task=>task.kind==='page')]) {
  const url=new URL(value.url);if(url.origin!==origin||url.pathname==='/about')continue;url.search='';seeds.add(url.href);
 }
}
const started=new Date().toISOString();
const state=createCrawl({allowedOrigins:[origin],languages:['en','vi'],languageMode},[...seeds]);
let batch=0;
do {
 await advanceCrawl(state,{budgetMs:12000});normalizeAuditState(state);compareAuditMetadata(state);batch++;
 const coverage=reportCoverage(state);
 const result={generatedAt:new Date().toISOString(),started,origin,verification:'HTTP inspection attempt from the task host; no deployment was performed.',
  status:state.status,coverage,content_score:evaluatedScore(state.pages,'content'),technical_score:evaluatedScore(state.pages,'technical'),
  critical_count:state.pages.filter(page=>page.inspectionStatus==='inspected').reduce((n,page)=>n+[...page.content.findings,...page.technical.findings].filter(f=>f.severity==='critical').length,0),
  state};
 await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({batch,status:state.status,coverage,requests:state.requests,elapsedMs:Date.now()-state.startedAt}));
} while(['queued','running'].includes(state.status));
if(state.status!=='completed')process.exitCode=2;
