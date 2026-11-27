import assert from 'node:assert/strict';
import test from 'node:test';
import {makeTrashRun,matchingTrashTargets,processTrashRun,readTrashRun,trashRunEta,trashRunTiming,trashRunTotals} from '../lib/home-media-trash.ts';

const expires=new Date(Date.now()+60*60*1000).toISOString();
const file=id=>({id,name:`properties/${id}.webp`,bucket:'property-media',expires_at:expires,bytes:120});
const defaults={stopped:()=>false,afterBatch:async()=>{},save:()=>{}};

test('selections over eight are confirmed once and processed sequentially in bounded batches',async()=>{
  const files=Array.from({length:13},(_,index)=>file(String(index)));
  const calls=[];const batches=[];
  let inFlight=false,checkpoint;
  const result=await processTrashRun(makeTrashRun(files),{...defaults,
    save:run=>{checkpoint=run;},afterBatch:async()=>{batches.push(calls.length);},
    async purge(payload){
      assert.equal(inFlight,false);inFlight=true;
      assert.equal(checkpoint.entries.find(row=>row.id===payload.id).outcome,'sent');
      calls.push(payload);await Promise.resolve();inFlight=false;
      return {status:'ok',removed:['6','10'].includes(payload.id)?0:1};
    },
    receipt:async item=>({status:item.id==='6'?'owner_hold':'storage_failure'}),
  });
  assert.deepEqual(calls,files.map(item=>({action:'purge',id:item.id,expiresAt:expires,confirm:true})));
  assert.deepEqual(batches,[8,13]);
  assert.deepEqual(trashRunTotals(result.run),{pending:0,removed:11,skipped:1,failed:1,reclaimedBytes:1320,unknownSizes:0});
  assert.equal(result.run.entries[6].reason,'owner_hold');
  assert.equal(result.run.entries[10].reason,'storage_failure');
});

test('stop waits for the current file and resume skips recorded successes',async()=>{
  const files=['one','two','three'].map(file),calls=[];
  let stop=false,checkpoint='';
  const paused=await processTrashRun(makeTrashRun(files),{...defaults,stopped:()=>stop,save:run=>{checkpoint=JSON.stringify(run);},
    async purge(request){calls.push(request.id);stop=true;return {status:'ok',removed:1};},
    receipt:()=>assert.fail('a confirmed success needs no readback'),
  });
  assert.equal(paused.paused,'stopped');
  assert.equal(trashRunTotals(paused.run).pending,2);
  const resumed=await processTrashRun(readTrashRun(checkpoint),{...defaults,
    async purge(request){calls.push(request.id);return {status:'ok',removed:1};},
    receipt:()=>assert.fail('a confirmed success needs no readback'),
  });
  assert.deepEqual(calls,['one','two','three']);
  assert.equal(trashRunTotals(resumed.run).removed,3);
});

test('resume reads an unacknowledged deletion receipt before sending any further deletion',async()=>{
  let checkpoint='';const sent=[];
  const paused=await processTrashRun(makeTrashRun(['one','two'].map(file)),{...defaults,save:run=>{checkpoint=JSON.stringify(run);},
    async purge(request){sent.push(request.id);throw new Error('connection lost');},
    receipt:async()=>{throw new Error('network unavailable');},
  });
  assert.equal(paused.paused,'removal_unconfirmed');
  assert.equal(JSON.parse(checkpoint).entries[0].outcome,'sent');
  const resumed=await processTrashRun(readTrashRun(checkpoint),{...defaults,
    async purge(request){sent.push(request.id);return {status:'ok',removed:1};},
    async receipt(item){assert.equal(item.id,'one');return {status:'removed',bytes:120};},
  });
  assert.deepEqual(sent,['one','two']);
  assert.equal(trashRunTotals(resumed.run).reclaimedBytes,240);
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
  delete run.timing;
  assert.deepEqual(readTrashRun(JSON.stringify(run)),run);
  assert.deepEqual(readTrashRun(JSON.stringify({...run,timing:{elapsedMs:-1,measuredFiles:0}})),run);
});
