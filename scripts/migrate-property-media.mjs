import {randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readlink,symlink,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual as equal,parseArgs} from 'node:util';
import {PROPERTY_IMAGE_MAX_BYTES,PROPERTY_IMAGE_ORIGIN,propertyPhotoPath} from '../lib/property-photo-files.ts';
import {imageDetails,propertyPhoto} from '../lib/image-optimization.mjs';
import {digest,planInventory,readJson,stagedDirectory,stageInventory,writeAtomic} from './plan-property-image-optimization.mjs';
import {liveMigrationTransport,retryMediaRequest,uuid} from './property-media-migration-transport.mjs';

const remote = new Set(['backup','upload','migrate','verify','cleanup','rollback']);
const stages = new Set(['audit','convert','report',...remote]);
const tokensPattern = /^[a-f0-9]{64}$/;
const maxAttempts = 3;
const maxBatch = 20;
const json = data=>JSON.stringify(data,null,2)+'\n';
const optional = (promise)=>promise.catch(error=>{if(error.code!=='ENOENT') throw error;return null;});
const assert = (ok,message)=>{if(!ok)throw new Error(message);};
const positive = value=>Number.isSafeInteger(value)&&value>0;
const currentIdentity = ({key,id,version,bytes,mime,etag,userMetadata})=>
  ({key,id,version,bytes,mime,etag,userMetadata:userMetadata??{}});
const knownSubject = entry=>uuid.test(entry.listing?.id||'')&&typeof entry.listing.version==='string';
const formatOrigin = PROPERTY_IMAGE_ORIGIN;

export function auditMedia(inventory,{limit=5,egressBytes,storageBytes,tokens=[]}={}) {
  assert(positive(limit)&&limit<=maxBatch,'Batch limit must be between 1 and '+maxBatch+'.');
  const plan=planInventory(inventory);
  const requested=new Set(tokens);
  const queued=plan.queue.filter(token=>!requested.size||requested.has(token));
  assert(!requested.size||queued.length===requested.size,'An approved item is missing or ineligible in this inventory.');
  assert(!requested.size||queued.length<=limit,'The selected items exceed the batch limit.');
  const entriesByToken=new Map(plan.entries.map(entry=>[entry.token,entry]));
  const entries=queued.slice(0,limit).map(token=>entriesByToken.get(token));
  const budget={egressBytes,storageBytes};
  const stable={origin:formatOrigin,inventoryOrigin:inventory.origin??null,inventoryDate:inventory.capturedAt??null,budget,entries};
  const batch={...stable,id:digest(json(stable))};
  const bytes=entries.reduce((sum,entry)=>sum+entry.bytes,0);
  const classifications={};
  for (const entry of plan.entries) classifications[entry.state]=(classifications[entry.state]||0)+1;
  const summary={inventoryBytes:plan.storageBytes,inventoryFiles:plan.entries.length,
    classifications,candidateCount:plan.queue.length,missingReferences:plan.missingReferences,duplicateHints:plan.etagDuplicateHints.length,
    batchId:batch.id,selected:entries.map(({key,token,bytes,listing})=>({key,token,bytes,listing})),
    backupBytes:bytes,modeledNetSavingsBytes:bytes-entries.length*225_000,
    maxStagedBytes:entries.length*propertyPhoto.maxBytes};
  return {batch,summary};
}

export async function withWorkspace(work,action) {
  await mkdir(work,{recursive:true,mode:0o700});
  const lockPath=join(work,'.migration.lock');
  const lock=await open(lockPath,'wx',0o600).catch(error=>{
    if(error.code==='EEXIST') throw new Error('This workspace is locked. Check the previous process before clearing its lock.');
    throw error;
  });
  try {await lock.writeFile(String(process.pid)+'\n');return await action();}
  finally {await lock.close();await unlink(lockPath);}
}

function checkBatch(batch) {
  const {id,...stable}=batch;
  assert(tokensPattern.test(id||'')&&digest(json(stable))===id&&batch.origin===formatOrigin,'The batch manifest changed.');
  assert(batch.inventoryOrigin===formatOrigin&&batch.entries.length>0&&batch.entries.length<=maxBatch&&
    batch.entries.every(entry=>tokensPattern.test(entry.token)&&knownSubject(entry)&&uuid.test(entry.id)&&
      positive(entry.bytes)&&entry.bytes<=PROPERTY_IMAGE_MAX_BYTES&&entry.state==='candidate'),
  'Seal the batch with a current Home inventory and a saved listing for every item.');
  assert(positive(batch.budget?.egressBytes)&&positive(batch.budget?.storageBytes),'Both batch byte limits are required.');
}

async function loadWorkspace(work) {
  const batch=await readJson(join(work,'batch.json'));
  checkBatch(batch);
  const journal=await optional(readJson(join(work,'journal.json')))??{
    batchId:batch.id,items:{},latest:{},spent:{egressBytes:0,storageBytes:0},sequence:0,
  };
  assert(journal.batchId===batch.id,'The checkpoint belongs to another batch.');
  return {batch,journal,work,save:()=>writeAtomic(join(work,'journal.json'),json(journal))};
}

function backupPaths(work,entry) {
  const base=join(work,'backups',entry.token);
  return {data:base+'.original',meta:base+'.json'};
}

async function localBackup(work,entry) {
  const paths=backupPaths(work,entry);
  const meta=await optional(readJson(paths.meta));
  const body=await optional(readFile(paths.data));
  if (!meta && !body) return null;
  assert(meta&&meta.id===entry.id&&meta.version===entry.version&&meta.etag===entry.etag&&tokensPattern.test(meta.sha256),
    'The backup manifest does not match the audited object.');
  if (!body) return null; // A previous run may have stopped before writing the bytes.
  assert(body.length===entry.bytes&&digest(body)===meta.sha256,'The original backup checksum does not match.');
  return {...currentIdentity(entry),sha256:meta.sha256};
}

async function staged(work,entry) {
  const base=join(work,stagedDirectory,entry.token);
  const result=await readJson(base+'.json');
  assert(result.state==='staged'&&result.token===entry.token&&result.id===entry.id&&result.version===entry.version,
    'The conversion needs review or belongs to another object.');
  const bytes=await readFile(base+'.optimized');
  const prefix='properties/listings/'+entry.listing.id+'/';
  const suffix=result.replacementKey?.slice(prefix.length)??'';
  const [revision,name]=suffix.split('/');
  const ext=result.outputMime==='image/webp'?'webp':'jpg';
  assert(result.replacementKey?.startsWith(prefix)&&uuid.test(revision)&&suffix.split('/').length===2&&
    /^[a-z0-9-]+\.(webp|jpg)$/.test(name??'')&&name.endsWith('.'+ext)&&
    bytes.length===result.outputBytes&&positive(bytes.length)&&bytes.length<=propertyPhoto.maxBytes&&
    bytes.length<entry.bytes&&digest(bytes)===result.outputSha256&&
    imageDetails(bytes)?.type===result.outputMime&&['image/webp','image/jpeg'].includes(result.outputMime),
  'The staged key, format, size or checksum does not match the conversion report.');
  const backup=await localBackup(work,entry);
  assert(backup?.sha256===result.originalSha256,'The conversion needs its verified original backup.');
  return {result,bytes,backup};
}

export async function readStagedBatch(work) {
  const {batch}=await loadWorkspace(work);
  const photos=[];
  for (const entry of batch.entries) {
    const {result,backup}=await staged(work,entry);
    photos.push({entry,result,backup});
  }
  return {batch,work,photos};
}

export function reviewedContinuation(source, review) {
  const {batch,photos}=source;
  const entries=photos.map(({entry,backup})=>{
    const current=review[entry.token];
    assert(current?.version&&current.hasOriginal&&current.exclusive&&current.destinationClear&&!current.protected&&
      equal(current.original,currentIdentity(backup)),
    'The live reference or object audit failed for '+entry.token+'.');
    return {...entry,listing:{...entry.listing,version:current.version}};
  });
  const bytes=photos.reduce((sum,{result})=>sum+result.outputBytes,0);
  const {id:sourceBatchId,...stable}=batch;
  const manifest={...stable,sourceBatchId,entries,budget:{
    egressBytes:entries.length*PROPERTY_IMAGE_MAX_BYTES+4*bytes,storageBytes:2*bytes,
  }};
  return {...manifest,id:digest(json(manifest))};
}

export async function sealContinuation(work, sourceWork, manifest) {
  checkBatch(manifest);
  await withWorkspace(work,async()=>{
    for (const name of ['backups',stagedDirectory]) {
      const path=join(work,name), target=resolve(sourceWork,name);
      const existing=await optional(readlink(path));
      assert(!existing||existing===target,'The continuation artifacts point to another workspace.');
      if (!existing) await symlink(target,path,'dir');
    }
    await writeAtomic(join(work,'batch.json'),json(manifest),true);
  });
}

export async function continuationCheckpoint(work,source) {
  const exists=await optional(readJson(join(work,'batch.json')));
  if (!exists) return null;
  const resumed=await loadWorkspace(work);
  assert(resumed.batch.sourceBatchId===source.batch.id&&
    equal(resumed.batch.entries.map(({token})=>token),source.batch.entries.map(({token})=>token)),
  'The write checkpoint does not belong to the staged batch.');
  for (const name of ['backups',stagedDirectory]) {
    assert(await readlink(join(work,name))===resolve(source.work,name),'The continuation artifacts point to another workspace.');
  }
  return resumed;
}

function assertUploaded(item,result) {
  assert(item.uploaded?.key===result.replacementKey&&item.uploaded.sha256===result.outputSha256,
    'The uploaded object does not match the reviewed rendition.');
}

function remaining(ctx,kind,bytes) {
  const limit=kind==='egressBytes'?ctx.egressLimit:ctx.batch.budget[kind];
  assert(ctx.journal.spent[kind]+bytes<=limit,kind+' budget would be exceeded.');
}

async function charge(ctx,item,operation,{egressBytes=0,storageBytes=0}={}) {
  const previous=item.attempts?.[operation]||0;
  assert(previous<maxAttempts,'The attempt limit for '+operation+' was reached.');
  remaining(ctx,'egressBytes',egressBytes);
  remaining(ctx,'storageBytes',storageBytes);
  (item.attempts??={})[operation]=previous+1;
  ctx.journal.spent.egressBytes+=egressBytes;
  ctx.journal.spent.storageBytes+=storageBytes;
  await ctx.save();
}

function hasPhoto(listing,key) {
  return listing?.images?.some(uri=>propertyPhotoPath(uri,formatOrigin)===key);
}

function liveState(transport,entry,result,item) {
  return transport.state({listing:entry.listing.id,key:entry.key,outputKey:result?.replacementKey,retirementId:item.retirementId});
}

function assertObjects(state,original,optimized) {
  assert(equal(state.original,currentIdentity(original))&&
    (!optimized||equal(state.optimized,currentIdentity(optimized))),'The Storage identity changed since approval.');
}

const expectVersion=(ctx,entry)=>ctx.journal.latest[entry.listing.id]??entry.listing.version;

async function backUp(ctx,transport,entry,item) {
  if (await localBackup(ctx.work,entry)) return 'backed-up';
  await transport.owner(entry.listing.id);
  const identity=currentIdentity(entry);
  assertObjects(await liveState(transport,entry,null,item),identity);
  await charge(ctx,item,'backup',{egressBytes:entry.bytes});
  const body=await transport.read(identity);
  assert(body.length===entry.bytes,'The download does not match the audited size.');
  assertObjects(await liveState(transport,entry,null,item),identity);
  const sha256=digest(body);
  const paths=backupPaths(ctx.work,entry);
  const previous=await optional(readJson(paths.meta));
  assert(!previous||previous.sha256===sha256,'The interrupted backup does not match the downloaded bytes.');
  await mkdir(join(ctx.work,'backups'),{recursive:true,mode:0o700});
  await writeAtomic(paths.meta,json({...identity,objectMetadata:entry.objectMetadata??null,sha256}));
  await writeAtomic(paths.data,body,true);
  return 'backed-up';
}

async function upload(ctx,transport,entry,item,{result,bytes,backup}) {
  if (item.uploaded) {
    assertUploaded(item,result);
    return 'uploaded';
  }
  const state=await liveState(transport,entry,result,item);
  assertObjects(state,backup);
  assert(state.listing?.version===expectVersion(ctx,entry)&&hasPhoto(state.listing,entry.key),'The listing changed since audit.');
  const intent={key:result.replacementKey,sha256:result.outputSha256,bytes:bytes.length};
  assert(!item.uploadIntent||equal(item.uploadIntent,intent),'The staged upload changed.');
  assert(!state.optimizedPresent||item.uploadIntent&&item.attempts?.upload>0,'The destination already existed before upload.');
  await transport.owner(entry.listing.id);
  if (!state.optimizedPresent) {
    remaining(ctx,'egressBytes',bytes.length);
    item.uploadIntent=intent;
    await charge(ctx,item,'upload',{storageBytes:bytes.length});
    await transport.upload(intent.key,bytes,result.outputMime,backup.userMetadata);
  }
  const after=await liveState(transport,entry,result,item);
  assertObjects(after,backup);
  assert(after.optimized?.key===intent.key&&after.optimized.bytes===bytes.length&&after.optimized.mime===result.outputMime&&
    equal(after.optimized.userMetadata,backup.userMetadata),'The uploaded object metadata does not match.');
  const uploaded={...after.optimized,sha256:intent.sha256};
  await charge(ctx,item,'upload-check',{egressBytes:bytes.length});
  await transport.read(uploaded,true);
  assertObjects(await liveState(transport,entry,result,item),backup,uploaded);
  item.uploaded=uploaded;
  item.publicUploadVerified=true;
  await ctx.save();
  return 'uploaded';
}

async function changeReferences(ctx,transport,entry,item,{result,backup},undo=false) {
  const direction=undo?'rollback':'migrate';
  if (undo?item.rolledBack:item.migrated) return undo?'rolled-back':'migrated';
  assertUploaded(item,result);
  assert(!item.cleaned,'Retirement was completed. Rollback requires separate recovery from the backup.');
  if (undo) assert(item.migrated,'The listing has no applied switch to roll back.');
  const initial=await liveState(transport,entry,result,item);
  assert(!initial.retirement,'Retirement was reserved. Rollback requires separate recovery from the backup.');
  assertObjects(initial,backup,item.uploaded);
  const blocked=ctx.batch.entries.some(other=>{
    if (other.token===entry.token||other.listing.id!==entry.listing.id) return false;
    const previous=ctx.journal.items[other.token];
    return previous&&(previous.migrationIntent&&!previous.migrated||previous.rollbackIntent&&!previous.rolledBack);
  });
  assert(!blocked,'Reconcile the other pending switch on this listing first.');
  const actor=await transport.owner(entry.listing.id);
  const pending=undo?'rollbackIntent':'migrationIntent';
  let preview=item[pending];
  let confirmed;
  const fields=initial.listing?.fields;
  const fromRefs=undo?initial.targetRefs:initial.sourceRefs;
  const toKey=undo?entry.key:result.replacementKey;
  if (preview&&item.attempts?.[direction]>0&&equal(fields,preview.after)&&fromRefs===0&&hasPhoto(initial.listing,toKey)) {
    // Recover a committed transaction whose acknowledgement did not reach disk.
    confirmed={...preview,applied:true,versionAfter:initial.listing.version};
  } else {
    const args={listing:entry.listing.id,version:expectVersion(ctx,entry),original:backup,optimized:item.uploaded,actor,
      undo:undo?item.migrated:null};
    assert(initial.listing?.version===args.version,'The listing changed since the last reviewed version.');
    const current=await transport.switchPhotos({...args,apply:false});
    assert(!preview||equal(current,preview),'The reference preview changed. Review before retrying.');
    preview=item[pending]=current;
    await charge(ctx,item,direction);
    confirmed=await transport.switchPhotos({...args,apply:true});
  }
  assert(confirmed.applied&&confirmed.versionAfter&&equal(confirmed.after,preview.after),'The reference switch could not be confirmed.');
  ctx.journal.latest[entry.listing.id]=confirmed.versionAfter;
  if (undo) item.rolledBack=confirmed;
  else {item.migrated=confirmed;item.order=++ctx.journal.sequence;}
  await ctx.save();
  return undo?'rolled-back':'migrated';
}

async function verifyDelivery(ctx,transport,entry,item,{result,backup,bytes}) {
  assert(item.migrated&&!item.rolledBack&&!item.cleaned,'Verification requires an active reference switch.');
  assertUploaded(item,result);
  const state=await liveState(transport,entry,result,item);
  assertObjects(state,backup,item.uploaded);
  assert(state.sourceRefs===0&&state.targetRefs>0&&hasPhoto(state.listing,result.replacementKey),
    'The current reference audit does not match the switch.');
  if (!item.verified) {
    // Keep a full-response allowance and use a range only after a full public SHA-256 check.
    await charge(ctx,item,'verify',{egressBytes:item.uploaded.bytes});
    if (item.publicUploadVerified) await transport.verifyPublic(item.uploaded,bytes);
    else await transport.read(item.uploaded,true);
    const current=await liveState(transport,entry,result,item);
    assertObjects(current,backup,item.uploaded);
    assert(current.sourceRefs===0&&current.targetRefs>0&&hasPhoto(current.listing,result.replacementKey),
      'The listing references changed during verification.');
    item.verified={version:current.listing.version,sha256:item.uploaded.sha256,at:new Date().toISOString()};
    await ctx.save();
  }
  return 'verified';
}

function retirementConfirmed(state,entry,item,backup) {
  assert(state.optimizedPresent&&equal(state.optimized,currentIdentity(item.uploaded))&&
    state.sourceRefs===0&&state.targetRefs>0&&hasPhoto(state.listing,item.uploaded.key),
  'The active replacement or its references changed before retirement.');
  const job=state.retirement;
  if (job) {
    assert(job.id===item.retirementId&&job.listing===entry.listing.id&&job.oldKey===entry.key&&
      job.newKey===item.uploaded.key&&job.sha256===item.uploaded.sha256&&job.requested,
    'The live retirement record does not match the checkpoint.');
  }
  if (!state.originalPresent) {
    assert(job?.removed,'The original is absent and retirement is unconfirmed. Reconcile the retirement record before continuing.');
    return true;
  }
  assert(!job?.removed&&equal(state.original,currentIdentity(backup)),
    'The original Storage identity or retirement record changed.');
  return false;
}

async function cleanup(ctx,transport,entry,item,{result,backup}) {
  if (item.cleaned) return 'cleaned';
  assertUploaded(item,result);
  assert(item.verified&&item.migrated&&!item.rolledBack&&item.verified.sha256===item.uploaded?.sha256,
    'Verify the active replacement before cleanup.');
  const state=await liveState(transport,entry,result,item);
  if (!retirementConfirmed(state,entry,item,backup)) {
    const actor=await transport.owner(entry.listing.id);
    // The existing retire endpoint reads the replacement to verify its digest.
    item.retirementId??=randomUUID();
    await charge(ctx,item,'retire',{egressBytes:PROPERTY_IMAGE_MAX_BYTES});
    await transport.reserveRetirement(item.migrated,item.retirementId,actor);
    await transport.retire(item.retirementId);
    const confirmed=await liveState(transport,entry,result,item);
    assert(retirementConfirmed(confirmed,entry,item,backup),'Storage removal was not confirmed.');
  }
  item.cleaned=true;
  await ctx.save();
  return 'cleaned';
}

async function report(ctx,entries) {
  const items=[];
  for (const entry of entries) {
    const item=ctx.journal.items[entry.token]??{};
    const backedUp=Boolean(await localBackup(ctx.work,entry));
    const result=await optional(readJson(join(ctx.work,stagedDirectory,entry.token+'.json')));
    const state=item.cleaned?'cleaned':item.retirementId?'retirement-pending':item.rolledBack?'rolled-back':
      item.rollbackIntent?'rollback-pending':item.verified?'verified':item.migrated?'migrated':
      item.migrationIntent?'migration-pending':item.uploaded?'uploaded':item.uploadIntent?'upload-pending':
      result?.state??(backedUp?'backed-up':'awaiting-backup');
    items.push({
      token:entry.token,key:entry.key,listing:entry.listing.id,state,originalBytes:entry.bytes,
      replacementKey:result?.replacementKey,outputBytes:result?.outputBytes,outputMime:result?.outputMime,
      dimensions:result?.width&&[result.width,result.height],quality:result?.quality,rmse:result?.rmse,detailRmse:result?.detailRmse,
      reason:result?.reason,attempts:item.attempts,
    });
  }
  const staged=items.filter(item=>item.outputBytes);
  const stagedBytes=staged.reduce((sum,item)=>sum+item.outputBytes,0);
  const modeledNetSavingsBytes=staged.reduce((sum,item)=>sum+item.originalBytes-item.outputBytes,0);
  const confirmedNetSavingsBytes=staged.filter(item=>item.state==='cleaned')
    .reduce((sum,item)=>sum+item.originalBytes-item.outputBytes,0);
  return {batchId:ctx.batch.id,budget:ctx.batch.budget,reserved:ctx.journal.spent,items,
    stagedBytes,modeledNetSavingsBytes,confirmedNetSavingsBytes,modeledEgressSavedPerReadOfEachStagedKey:modeledNetSavingsBytes};
}

export async function runMediaStage(stage,options={},openTransport=liveMigrationTransport) {
  assert(stages.has(stage),'Choose a media migration stage.');
  const {inventory,work,apply=false,approve,tokens=[],limit,egressBytes,storageBytes,retireOriginals=false,
    egressIncreaseBytes=0}=options;
  assert(Number.isSafeInteger(egressIncreaseBytes)&&egressIncreaseBytes>=0&&
    (!egressIncreaseBytes||apply&&remote.has(stage)),'An egress increase requires an approved remote stage and a valid byte count.');
  if (stage==='audit') {
    assert(inventory,'Supply a local inventory JSON export.');
    const {batch,summary}=auditMedia(await readJson(inventory),{limit,egressBytes,storageBytes,tokens});
    if (apply) {
      assert(work,'Specify a new private workspace.');
      checkBatch(batch);
      await withWorkspace(work,async()=>{
        const path=join(work,'batch.json');
        const prior=await optional(readJson(path));
        assert(!prior||equal(prior,batch),'This workspace is sealed to another reviewed batch.');
        if (!prior) await writeAtomic(path,json(batch),true);
      });
    }
    return {...summary,stage,dryRun:!apply};
  }
  assert(work,'Specify the sealed batch workspace.');
  const choose=batch=>{
    const wanted=new Set(tokens);
    const entries=batch.entries.filter(entry=>!wanted.size||wanted.has(entry.token));
    assert(!wanted.size||entries.length===wanted.size,'An item is outside this sealed batch.');
    return entries;
  };
  if (!apply||stage==='report') {
    const ctx=await loadWorkspace(work);
    return {...await report(ctx,choose(ctx.batch)),stage,dryRun:true};
  }
  // Reject unapproved commands before opening credentials or changing the journal.
  const check=await loadWorkspace(work);
  if (remote.has(stage)) {
    assert(approve===check.batch.id,'Supply explicit approval for this sealed batch ID.');
    if(stage==='cleanup')assert(retireOriginals&&tokens.length>0,'Cleanup requires --retire-originals and each reviewed --token.');
  }
  const egressLimit=check.batch.budget.egressBytes+egressIncreaseBytes;
  assert(Number.isSafeInteger(egressLimit),'The increased egress limit is too large.');
  return withWorkspace(work,async()=>{
    const ctx=await loadWorkspace(work);
    assert(ctx.batch.id===check.batch.id,'The sealed batch changed.');
    ctx.egressLimit=egressLimit;
    const entries=choose(ctx.batch);
    if (stage==='convert') {
      const plan={entries,queue:entries.map(entry=>entry.token)};
      const output=await stageInventory(plan,work,entries.length);
      return {stage,batchId:ctx.batch.id,...output};
    }
    const transport=await openTransport();
    if (stage==='rollback') entries.sort((a,b)=>(ctx.journal.items[b.token]?.order||0)-(ctx.journal.items[a.token]?.order||0));
    const results=[];
    for (const entry of entries) {
      const item=ctx.journal.items[entry.token]??={};
      try {
        if (stage==='backup') results.push({token:entry.token,state:await backUp(ctx,transport,entry,item)});
        else {
          const local=await staged(work,entry);
          if (stage==='upload'||stage==='cleanup') {
            const action=stage==='upload'?upload:cleanup;
            // Each attempt starts with a fresh catalogue and reference check.
            const state=await retryMediaRequest(()=>action(ctx,transport,entry,item,local),{
              operation:stage==='upload'?'upload':'retire',
            });
            results.push({token:entry.token,state});
          }
          if (stage==='migrate'||stage==='rollback') {
            results.push({token:entry.token,state:await changeReferences(ctx,transport,entry,item,local,stage==='rollback')});
          }
          if (stage==='verify') results.push({token:entry.token,state:await verifyDelivery(ctx,transport,entry,item,local)});
        }
      } catch(error) {
        results.push({token:entry.token,state:'blocked',reason:error.code==='ENOENT'?'A required local artifact is missing.':error.message});
      }
    }
    return {stage,batchId:ctx.batch.id,results,reserved:ctx.journal.spent,blocked:results.some(item=>item.state==='blocked')};
  });
}

if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    const {positionals,values}=parseArgs({allowPositionals:true,options:{
      inventory:{type:'string'},work:{type:'string'},limit:{type:'string'},token:{type:'string',multiple:true},
      'egress-bytes':{type:'string'},'storage-bytes':{type:'string'},apply:{type:'boolean'},approve:{type:'string'},
      'retire-originals':{type:'boolean'},help:{type:'boolean'},
    }});
    const usage='Usage: node scripts/migrate-property-media.mjs <'+[...stages].join('|')+'> [options]';
    if(values.help) console.log(usage+'\nSee docs/image-storage-optimization.md for the independent commands and approval flags.');
    else {
      assert(positionals.length===1,usage);
      const output=await runMediaStage(positionals[0],{
        inventory:values.inventory,work:values.work,limit:values.limit==null?undefined:Number(values.limit),
        tokens:values.token,egressBytes:values['egress-bytes']==null?undefined:Number(values['egress-bytes']),
        storageBytes:values['storage-bytes']==null?undefined:Number(values['storage-bytes']),
        apply:values.apply,approve:values.approve,retireOriginals:values['retire-originals'],
      });
      console.log(json(output).trimEnd());
      if (output.blocked) process.exitCode=2;
    }
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
