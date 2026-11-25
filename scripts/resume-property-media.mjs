import {readdir} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {continuationCheckpoint,readStagedBatch,reviewedContinuation,runMediaStage,sealContinuation,withWorkspace} from './migrate-property-media.mjs';
import {checkMediaDatabase,verifyMediaDatabase} from './property-media-migration-transport.mjs';
import {withMediaSession} from './property-media-session.mjs';
import {writeAtomic} from './plan-property-image-optimization.mjs';

const stages=Object.entries({upload:'uploaded',migrate:'migrated',verify:'verified',cleanup:'cleaned'});
const log=value=>console.log(JSON.stringify(value));
const reviewRows=source=>source.photos.map(({entry,result})=>({
  token:entry.token,listing:entry.listing.id,old_key:entry.key,new_key:result.replacementKey,
}));

async function loadStaging(root,expected) {
  const dirs=(await readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&
    (entry.name==='pilot'||/^batch-\d+$/.test(entry.name))).map(entry=>entry.name).sort();
  if(!dirs.includes('pilot')) throw new Error('The verified pilot workspace is missing.');
  const batches=[];
  for(const name of ['pilot',...dirs.filter(name=>name!=='pilot')]) {
    batches.push(await readStagedBatch(join(root,name)));
  }
  const photos=batches.flatMap(batch=>batch.photos);
  if(photos.length!==expected||new Set(photos.map(({entry})=>entry.token)).size!==expected||
      new Set(photos.map(({result})=>result.replacementKey)).size!==expected||
      photos.some(({result})=>result.outputMime!=='image/webp')) {
    throw new Error('The staging workspace does not match the expected distinct WebP photographs.');
  }
  log({locallyVerified:photos.length,batches:batches.length,
    originalBytes:photos.reduce((sum,{entry})=>sum+entry.bytes,0),
    stagedBytes:photos.reduce((sum,{result})=>sum+result.outputBytes,0)});
  return batches;
}

async function verifySite(sample) {
  const routes=['/','/homes'];
  if(sample) routes.push('/homes/'+encodeURIComponent(sample.slug));
  for(const path of routes) {
    let response;
    try {response=await fetch('https://garyhome.vn'+path,{signal:AbortSignal.timeout(20_000),cache:'no-store'});}
    catch {throw new Error('The public website check could not connect.');}
    if(!response.ok) {
      await response.body?.cancel();
      throw new Error('The public website check returned HTTP '+response.status+'.');
    }
    if(path.startsWith('/homes/')) {
      if(!(await response.text()).includes(basename(sample.key))) throw new Error('The sampled public gallery has not confirmed the replacement.');
    } else await response.body?.cancel();
  }
  return {pages:routes.length,gallery:Boolean(sample)};
}

async function resume(root,batches,options,env,transport) {
  const writeRoot=join(root,'guarded-write');
  const workFor=source=>join(writeRoot,basename(source.work));
  const checkpoints=[];
  for(const source of batches) checkpoints.push(await continuationCheckpoint(workFor(source),source));
  if(checkpoints.some(checkpoint=>Object.values(checkpoint?.journal.items||{}).some(item=>item.rolledBack))) {
    throw new Error('A reference switch was rolled back. Reconcile that batch before continuing.');
  }
  const first=batches[0].photos[0].entry.listing.id;
  const db=await transport();
  await checkMediaDatabase(env,first,await db.owner(first));
  log({homeOwner:'verified',postgres:'verified with TLS and listing RLS'});
  const pending=batches.filter((_,index)=>!checkpoints[index]);
  if(pending.length) {
    const review=await db.review(pending.flatMap(reviewRows));
    for(const source of pending) reviewedContinuation(source,review);
    log({freshlyReviewed:pending.reduce((sum,source)=>sum+source.photos.length,0)});
  }
  if(!options.apply) return;

  const completed=[];
  for(const [index,source] of batches.entries()) {
    const work=workFor(source), name=basename(work);
    let checkpoint=checkpoints[index];
    if(!checkpoint) {
      const reviewed=reviewedContinuation(source,await db.review(reviewRows(source)));
      await sealContinuation(work,source.work,reviewed);
      checkpoint=await continuationCheckpoint(work,source);
    }
    const verifiedItems=[];
    for(const {entry} of source.photos) {
      const previous=checkpoint.journal.items[entry.token];
      if(!previous?.cleaned) {
        for(const [stage,field] of stages) {
          // Cleanup can have succeeded before its acknowledgement reached the journal.
          if(previous?.[field]) continue;
          const output=await runMediaStage(stage,{work,apply:true,approve:checkpoint.batch.id,
            tokens:[entry.token],retireOriginals:stage==='cleanup'},transport);
          if(output.blocked) throw new Error(name+' '+stage+' '+entry.token+' stopped. '+output.results[0].reason);
        }
      }
      const current=await continuationCheckpoint(work,source);
      const item=current.journal.items[entry.token];
      if(!item?.cleaned||!item.uploaded||!item.retirementId) throw new Error(name+' is missing a completed retirement checkpoint.');
      verifiedItems.push({listing:entry.listing.id,old_key:entry.key,new_key:item.uploaded.key,
        job:item.retirementId,identity:item.uploaded});
    }
    completed.push(...verifiedItems);
    log({batch:name,confirmed:verifiedItems.length,confirmedTotal:completed.length});
  }
  const database=await verifyMediaDatabase(env,completed);
  const result={confirmed:completed.length,database,site:null};
  const report=join(writeRoot,'completion.json');
  await writeAtomic(report,JSON.stringify(result,null,2)+'\n');
  result.site=await verifySite(database.sample);
  await writeAtomic(report,JSON.stringify(result,null,2)+'\n');
  log(result);
}

process.umask(0o077);
try {
  const {values}=parseArgs({options:{work:{type:'string'},'expected-count':{type:'string'},apply:{type:'boolean'},
    'check-auth':{type:'boolean'},'prompt-db-password':{type:'boolean'},help:{type:'boolean'}}});
  const usage='Usage: node scripts/resume-property-media.mjs --work <existing execution dir> --expected-count <number> [--check-auth | --apply] [--prompt-db-password]';
  if(values.help) console.log(usage);
  else {
    const count=Number(values['expected-count']);
    if(!values.work||!Number.isSafeInteger(count)||count<1||values.apply&&values['check-auth']) throw new Error(usage);
    const root=resolve(values.work), batches=await loadStaging(root,count);
    if(values.apply||values['check-auth']) {
      const run=()=>withMediaSession({promptDatabasePassword:values['prompt-db-password']},
        (env,transport)=>resume(root,batches,values,env,transport));
      if(values.apply) await withWorkspace(join(root,'guarded-write'),run);
      else await run();
    }
  }
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
