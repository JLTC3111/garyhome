// Recalculate retained evidence without fetching pages or changing stored runs.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {normalizeAuditState} from '../lib/seo-audit/normalize.ts';
import {reportCoverage,reportScoreDetails,groupedFindings} from '../lib/seo-audit/presentation.ts';
const [inputPath,outputPath]=process.argv.slice(2);
if(!inputPath||!outputPath)throw new Error('Usage: node scripts/reconcile-seo-audit.mjs input.json output.json');
if(path.resolve(inputPath)===path.resolve(outputPath))throw new Error('Use a separate output path; original evidence must be preserved.');
const input=JSON.parse(await readFile(inputPath,'utf8')),raw=input.state||input.run?.state||input;
if(!Array.isArray(raw.pages)||!Array.isArray(raw.queue))throw new Error('The input does not contain a saved audit state.');
const state=normalizeAuditState(structuredClone(raw));
const result={source:inputPath,auditId:input.id||input.run?.id||null,method:'evaluated-checks-v3',
 verification:'Reinterpretation of retained observations, not a fresh production crawl or proof of deployed fixes.',
 original:{status:input.status||raw.status,content:input.content_score??null,technical:input.technical_score??null,page_count:input.page_count??raw.pages.length},
 coverage:reportCoverage(state),score_details:{content:reportScoreDetails(state.pages,'content'),technical:reportScoreDetails(state.pages,'technical')},
 classificationCorrections:state.classificationCorrections||[],groups:groupedFindings(state)};
await writeFile(outputPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output:outputPath,coverage:result.coverage,content:result.score_details.content.score,technical:result.score_details.technical.score}));
