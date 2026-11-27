import assert from 'node:assert/strict';
import test from 'node:test';
import {cancelTrashRun,makeTrashRun,matchingTrashTargets,processTrashRun,readTrashRun,trashRunEta,trashRunTiming,trashRunTotals,trashRunUnfinished} from '../lib/home-media-trash.ts';
import {RequestTimeoutError} from '../lib/requests.ts';

const expires=new Date(Date.now()+60*60*1000).toISOString();
const file=id=>({id,name:`properties/${id}.webp`,bucket:'property-media',expires_at:expires,bytes:120});
const defaults={stopped:()=>false,save:()=>{},wait:async()=>{}};

test('selections over eight are confirmed once and processed sequentially in bounded batches',async()=>{
  const files=Array.from({length:13},(_,index)=>file(String(index)));
  const calls=[];const batches=[];
  let inFlight=false,checkpoint;
  const result=await processTrashRun(makeTrashRun(files),{...defaults,
    save:run=>{checkpoint=run;},afterBatch:()=>{batches.push(calls.length);},
    async purge(payload,beforeSend){
      beforeSend();
      assert.equal(inFlight,false);inFlight=true;
      assert.equal(checkpoint.entries.find(row=>row.id===payload.id).outcome,'sent');
      calls.push(payload);await Promise.resolve();inFlight=false;
      return {status:'ok',removed:['6','10'].includes(payload.id)?0:1};
    },
    receipt:async item=>({status:item.id==='6'?'owner_hold':'storage_failure'}),
  });
  assert.deepEqual(calls,files.map(item=>({action:'purge',id:item.id,expiresAt:expires,confirm:true})));
  assert.deepEqual(batches,[8,13]);
  assert.deepEqual(trashRunTotals(result),{pending:0,removed:11,skipped:1,failed:1,cancelled:0,reclaimedBytes:1320,unknownSizes:0});
  assert.equal(result.entries[6].reason,'owner_hold');
  assert.equal(result.entries[10].reason,'storage_failure');
});

test('500 files continue automatically across boundaries, including a target lock on file 49',async()=>{
  const files=Array.from({length:500},(_,index)=>file(String(index+1)));
  const sent=[],removed=new Set(),batches=[],waits=[];
  let inFlight=false,lockedOnce=false,checkpoint;
  const run=await processTrashRun(makeTrashRun(files),{...defaults,
    save:next=>{checkpoint=next;},
    afterBatch:()=>batches.push(removed.size),
    wait:async delay=>{waits.push(delay);},
    async purge({id},beforeSend){
      assert.equal(inFlight,false);
      assert.equal(removed.has(id),false,'a confirmed removal must never be sent again');
      beforeSend();
      assert.equal(checkpoint.entries.find(row=>row.id===id).outcome,'sent');
      inFlight=true;sent.push(id);
      await Promise.resolve();
      inFlight=false;
      if(id==='49'&&!lockedOnce){lockedOnce=true;throw new Error('media_busy');}
      removed.add(id);
      return {status:'ok',removed:1};
    },
    async receipt(item){assert.equal(item.id,'49');return {status:'eligible'};},
  });
  assert.equal(run.state,'completed');
  assert.equal(trashRunTotals(run).removed,500);
  assert.equal(sent.length,501);
  assert.equal(waits.length,1);
  assert.equal(batches.length,63);
  assert.deepEqual(batches.slice(4,8),[40,48,56,64]);
  assert.equal(batches.at(-1),500);
});

test('stop waits for the current file and resume skips recorded successes',async()=>{
  const files=['one','two','three'].map(file),calls=[];
  let stop=false,checkpoint='';
  const paused=await processTrashRun(makeTrashRun(files),{...defaults,stopped:()=>stop,save:run=>{checkpoint=JSON.stringify(run);},
    async purge(request,beforeSend){beforeSend();calls.push(request.id);stop=true;return {status:'ok',removed:1};},
    receipt:()=>assert.fail('a confirmed success needs no readback'),
  });
  assert.equal(paused.state,'paused');
  assert.equal(paused.issue,'stopped');
  assert.equal(trashRunTotals(paused).pending,2);
  const resumed=await processTrashRun(readTrashRun(checkpoint),{...defaults,
    async purge(request,beforeSend){beforeSend();calls.push(request.id);return {status:'ok',removed:1};},
    receipt:()=>assert.fail('a confirmed success needs no readback'),
  });
  assert.deepEqual(calls,['one','two','three']);
  assert.equal(trashRunTotals(resumed).removed,3);
});

test('a timed-out write survives a lost receipt and reloading resolves it before another write',async()=>{
  let checkpoint='';const sent=[];
  const paused=await processTrashRun(makeTrashRun(['one','two'].map(file)),{...defaults,save:run=>{checkpoint=JSON.stringify(run);},
    async purge(request,beforeSend){beforeSend();sent.push(request.id);throw new RequestTimeoutError();},
    receipt:async()=>{throw new Error('network unavailable');},
  });
  assert.equal(paused.state,'paused');
  assert.equal(paused.issue,'purge_timeout');
  assert.equal(JSON.parse(checkpoint).entries[0].outcome,'sent');
  const resumed=await processTrashRun(readTrashRun(checkpoint),{...defaults,
    async purge(request,beforeSend){beforeSend();sent.push(request.id);return {status:'ok',removed:1};},
    async receipt(item){assert.equal(item.id,'one');return {status:'removed',bytes:120};},
  });
  assert.deepEqual(sent,['one','two']);
  assert.equal(trashRunTotals(resumed).reclaimedBytes,240);
});

test('a timed-out write with a confirmed removal receipt advances without resending',async()=>{
  const requested=[];
  const run=await processTrashRun(makeTrashRun(['one','two'].map(file)),{...defaults,
    async purge({id},beforeSend){
      beforeSend();requested.push(id);
      if(id==='one')throw new RequestTimeoutError();
      return {status:'ok',removed:1};
    },
    receipt:async({id})=>{assert.equal(id,'one');return {status:'removed'};},
  });
  assert.deepEqual(requested,['one','two']);
  assert.equal(run.state,'completed');
  assert.equal(trashRunTotals(run).removed,2);
});

test('cancellation waits for an in-flight receipt, keeps successes and releases only unfinished files',async()=>{
  const files=Array.from({length:448},(_,index)=>file(String(index+1)));
  const run=makeTrashRun(files);
  for(const item of run.entries.slice(0,48))item.outcome='removed';
  run.entries[48].outcome='sent';
  run.entries[48].sentAt=Date.now();
  const saved=readTrashRun(JSON.stringify(run));
  let checkpoint;
  const save=next=>{checkpoint=JSON.stringify(next);};
  const stillWorking=await cancelTrashRun(saved,{receipt:async()=>({status:'removal_in_progress'}),save});
  assert.equal(stillWorking.state,'paused');
  assert.equal(trashRunUnfinished(stillWorking),true);
  const notYetClaimed=await cancelTrashRun(readTrashRun(checkpoint),{receipt:async()=>({status:'eligible'}),save});
  assert.equal(notYetClaimed.issue,'removal_verification_wait');
  const cancelled=await cancelTrashRun(readTrashRun(checkpoint),{receipt:async({id})=>{
    assert.equal(id,'49');return {status:'removed',bytes:120};
  },save});
  assert.equal(cancelled.state,'cancelled');
  assert.equal(trashRunUnfinished(readTrashRun(checkpoint)),false);
  assert.deepEqual(trashRunTotals(cancelled),{pending:0,removed:49,skipped:0,failed:0,cancelled:399,reclaimedBytes:5880,unknownSizes:0});
});

test('resuming checks previously sent items and excludes restored, removed and changed targets',async()=>{
  const [sent,restored,expired,changed,eligible]=['sent','restored','expired','changed','eligible'].map(file);
  const original=makeTrashRun([sent,restored,expired,changed,eligible]);
  original.entries[0].outcome='sent';
  const requested=[];
  const run=await processTrashRun(readTrashRun(JSON.stringify(original)),{...defaults,
    receipt:async item=>{assert.equal(item.id,'sent');return {status:'already_removed'};},
    eligible:async()=>[{...changed,name:'different.webp'},eligible],
    async purge({id},beforeSend){beforeSend();requested.push(id);return {status:'ok',removed:1};},
  });
  assert.deepEqual(requested,['eligible']);
  assert.deepEqual(run.entries.map(item=>item.outcome),['skipped','skipped','skipped','skipped','removed']);
  assert.equal(run.state,'completed');
});

test('persistent locks pause after bounded attempts and can be cancelled without resending',async()=>{
  let writes=0,reads=0;
  const paused=await processTrashRun(makeTrashRun([file('one'),file('two')]),{...defaults,
    async purge(_,beforeSend){beforeSend();writes++;throw new Error('media_busy');},
    async receipt(){reads++;return {status:'eligible'};},
  });
  assert.equal(paused.state,'paused');
  assert.equal(paused.issue,'media_busy');
  assert.equal(writes,3);
  assert.equal(reads,3);
  const cancelled=await cancelTrashRun(paused,{...defaults,receipt:()=>assert.fail('no request is in flight')});
  assert.equal(trashRunTotals(cancelled).cancelled,2);
});

test('an unreadable checkpoint write prevents dispatching the deletion',async()=>{
  let sent=false;
  await assert.rejects(()=>processTrashRun(makeTrashRun([file('one')]),{...defaults,
    save(run){if(run.entries[0].outcome==='sent')throw new Error('trash_checkpoint_storage');},
    async purge(_,beforeSend){beforeSend();sent=true;return {status:'ok',removed:1};},
    receipt:()=>assert.fail('a file was never sent'),
  }),/trash_checkpoint_storage/);
  assert.equal(sent,false);
});

test('selection matching keeps exact entries across pages and rejects changed deadlines and corrupt checkpoints',()=>{
  const one=file('one'),other=file('other'),changed={...other,expires_at:new Date(Date.now()+2*60*60*1000).toISOString()};
  assert.deepEqual(matchingTrashTargets([one,other],[changed,one]),[one]);
  assert.throws(()=>makeTrashRun([one,one]),/invalid_request/);
  assert.throws(()=>readTrashRun('invalid json'),/trash_checkpoint_invalid/);
});

test('ETA updates with active time and measures from the latest run start',()=>{
  const clock={startedAt:1000,elapsedBefore:0,measuredBefore:0,processedBefore:2};
  assert.equal(trashRunEta(8,trashRunTiming(clock,2,2000)),null);
  const sample=trashRunTiming(clock,3,5000);
  assert.deepEqual(sample,{elapsedMs:4000,measuredFiles:1});
  assert.equal(trashRunEta(7,sample),28000);
  assert.equal(trashRunEta(7,trashRunTiming(clock,3,7000)),42000);
  const resumed={startedAt:120000,elapsedBefore:sample.elapsedMs,measuredBefore:sample.measuredFiles,processedBefore:3};
  assert.equal(trashRunEta(6,trashRunTiming(resumed,4,122000)),18000);
  assert.equal(trashRunEta(0,trashRunTiming(resumed,10,122000)),0);
});

test('progress timing survives checkpoint reload and earlier checkpoints remain resumable',()=>{
  const run=makeTrashRun([file('one')]);
  const timing={elapsedMs:4120,measuredFiles:0,pauseReason:'removal_unconfirmed'};
  assert.deepEqual(readTrashRun(JSON.stringify({...run,timing})).timing,timing);
  const {state,timing:unused,...legacy}=run;
  const interrupted=readTrashRun(JSON.stringify(legacy));
  assert.equal(interrupted.state,'paused');
  assert.equal(interrupted.issue,'trash_run_interrupted');
  assert.deepEqual(readTrashRun(JSON.stringify({...legacy,timing:{elapsedMs:-1,measuredFiles:0}})),interrupted);
});
