export const mediaBatchSize = 8;
export type TrashTarget = { id: string; bucket: string; name: string; expires_at: string; bytes: number | null };
export type CleanupResult = { status: string; removed?: number; attempted?: number; overdue?: number };
export type TrashReceipt = { status: string; bytes?: number | null };
export type TrashOperationState = "idle" | "running" | "stopping" | "paused" | "completed" | "cancelled" | "failed";
type Outcome = "pending" | "sent" | "removed" | "skipped" | "failed" | "cancelled";
type TrashEntry = TrashTarget & { outcome: Outcome; reason?: string; sentAt?: number };
type TrashRunTiming = { elapsedMs: number; measuredFiles: number; pauseReason?: string };
export type TrashRun = { version: 1; confirmedAt: string; state: Exclude<TrashOperationState, "idle">; issue?: string; entries: TrashEntry[]; timing?: TrashRunTiming };
export type TrashRunClock = { startedAt: number; elapsedBefore: number; measuredBefore: number; processedBefore: number };
export const mediaRequestTimeoutMs = 59_000;

export function trashRunUnfinished(run:TrashRun|null) {
  return !!run?.entries.some(item=>item.outcome==="pending"||item.outcome==="sent");
}

export function isTrashTarget(row:unknown): row is TrashTarget {
  if (!row || typeof row !== "object") return false;
  const item=row as TrashTarget;
  return typeof item.id==="string" && typeof item.name==="string" && typeof item.bucket==="string" &&
    typeof item.expires_at==="string" && Number.isFinite(Date.parse(item.expires_at)) &&
    (item.bytes===null || Number.isSafeInteger(item.bytes) && item.bytes>=0);
}

export function matchingTrashTargets(selected:TrashTarget[],live:TrashTarget[]) {
  const byId=new Map(live.map(item=>[item.id,item]));
  return selected.filter(item=>{
    const current=byId.get(item.id);
    return current?.expires_at===item.expires_at && current.bucket===item.bucket && current.name===item.name && current.bytes===item.bytes;
  });
}

export function makeTrashRun(items:TrashTarget[]):TrashRun {
  if(!items.length || new Set(items.map(item=>item.id)).size!==items.length || !items.every(isTrashTarget)) throw new Error("invalid_request");
  return {version:1,confirmedAt:new Date().toISOString(),state:"running",entries:items.map(item=>({...item,outcome:"pending"})),
    timing:{elapsedMs:0,measuredFiles:0}};
}

export function readTrashRun(source:string|null):TrashRun|null {
  if(!source)return null;
  let run:TrashRun;
  try{run=JSON.parse(source) as TrashRun;}
  catch{throw new Error("trash_checkpoint_invalid");}
  if(run?.version!==1 || !Number.isFinite(Date.parse(run.confirmedAt)) || !Array.isArray(run.entries) || !run.entries.length ||
    !run.entries.every(item=>isTrashTarget(item) && ["pending","sent","removed","skipped","failed","cancelled"].includes(item.outcome)) ||
    new Set(run.entries.map(item=>item.id)).size!==run.entries.length)throw new Error("trash_checkpoint_invalid");
  const timing=run.timing;
  if(timing&&(!Number.isSafeInteger(timing.elapsedMs)||timing.elapsedMs<0||!Number.isSafeInteger(timing.measuredFiles)||
    timing.measuredFiles<0||timing.measuredFiles>run.entries.length||
    (timing.pauseReason!==undefined&&typeof timing.pauseReason!=="string")))delete run.timing;
  // A persisted running state cannot establish that a browser still owns the lock.
  // Open it as resumable until the operator takes the lock and checks any sent item.
  if(typeof run.issue!=="string")run.issue=run.timing?.pauseReason;
  if(trashRunUnfinished(run)){
    if(run.state!=="failed")run.state="paused";
    run.issue??="trash_run_interrupted";
  }else if(run.state!=="cancelled"&&run.state!=="failed"){
    run.state="completed";
    delete run.issue;
  }
  return run;
}

export function trashRunTotals(run:TrashRun) {
  const totals={pending:0,removed:0,skipped:0,failed:0,cancelled:0,reclaimedBytes:0,unknownSizes:0};
  for(const item of run.entries){
    if(item.outcome==="sent" || item.outcome==="pending")totals.pending++;
    else totals[item.outcome]++;
    if(item.outcome==="removed"){totals.reclaimedBytes+=item.bytes??0;if(item.bytes===null)totals.unknownSizes++;}
  }
  return totals;
}

export function trashRunTiming(clock:TrashRunClock,processed:number,now:number):TrashRunTiming {
  return {elapsedMs:clock.elapsedBefore+Math.max(0,Math.floor(now-clock.startedAt)),
    measuredFiles:clock.measuredBefore+Math.max(0,processed-clock.processedBefore)};
}

export function trashRunEta(remaining:number,timing:TrashRunTiming|null|undefined) {
  if(!remaining)return 0;
  if(!timing?.measuredFiles||!timing.elapsedMs)return null;
  return timing.elapsedMs/timing.measuredFiles*remaining;
}

type PurgePayload = { action:"purge"; id:string; expiresAt:string; confirm:true };
const preflightRefusals=new Set(["cleanup_disabled","session_expired","cross_app_protection_required",
  "cross_app_protection_unconfirmed","cleanup_worker_missing","owner_check_unavailable","backend_config"]);
const skippedCodes=new Set(["selection_changed","already_removed","no_longer_eligible","protected","identity_changed",
  "expired","owner_hold","active_upload","retry_wait","attempt_limit","missing_expiry"]);

type ReceiptReader = (item:TrashTarget)=>Promise<TrashReceipt>;
type Readback = "eligible" | "removal_in_progress" | "removal_unconfirmed" | TrashEntry;
async function readOutcome(item:TrashEntry, receipt:ReceiptReader, knownRefusal=false):Promise<Readback> {
  let result:TrashReceipt;
  try{result=await receipt(item);}
  catch{return "removal_unconfirmed";}
  const {status}=result;
  if(status==="eligible"||status==="removal_in_progress")return status;
  if(status==="removed"&&!knownRefusal)return {...item,outcome:"removed",reason:undefined,bytes:result.bytes??item.bytes};
  if(status==="storage_failure")return {...item,outcome:"failed",reason:status};
  if(status==="removed"||skippedCodes.has(status))return {...item,outcome:"skipped",reason:status==="removed"?"already_removed":status};
  return "removal_unconfirmed";
}

function mayStillBeDispatched(item:TrashEntry) {
  // A receipt can still be eligible before an interrupted HTTP request claims the
  // worker lease. Retain the journal entry through the original request deadline.
  return Number.isFinite(item.sentAt)&&Date.now()-(item.sentAt??0)<mediaRequestTimeoutMs;
}

async function reconcileSent(run:TrashRun,receipt:ReceiptReader,save:(run:TrashRun)=>void) {
  let current=run;
  for(const [index,item] of run.entries.entries()){
    if(item.outcome!=="sent")continue;
    const result=await readOutcome(item,receipt);
    if(result==="removal_in_progress"||result==="removal_unconfirmed")return {run:current,issue:result};
    if(result==="eligible"&&mayStillBeDispatched(item))return {run:current,issue:"removal_verification_wait"};
    const entries=current.entries.slice();
    entries[index]=result==="eligible"?{...item,outcome:"pending",sentAt:undefined,reason:undefined}:result;
    current={...current,entries};
    save(current);
  }
  return {run:current,issue:undefined};
}

export async function cancelTrashRun(run:TrashRun,options:{receipt:ReceiptReader;save:(run:TrashRun)=>void}) {
  const reconciled=await reconcileSent(run,options.receipt,options.save);
  const next:TrashRun=reconciled.issue?{...reconciled.run,state:"paused",issue:reconciled.issue}:
    {...reconciled.run,state:"cancelled",issue:undefined,
      entries:reconciled.run.entries.map(item=>item.outcome==="pending"?{...item,outcome:"cancelled",reason:undefined}:item)};
  options.save(next);
  return next;
}

const lockRetryDelays=[750,2000];
const waitForRetry=(delay:number)=>new Promise<void>(resolve=>setTimeout(resolve,delay));

export async function processTrashRun(run:TrashRun, options:{
  purge:(payload:PurgePayload,beforeSend:()=>void)=>Promise<CleanupResult>; receipt:ReceiptReader;
  save:(run:TrashRun)=>void; stopped:()=>boolean; afterBatch?:(run:TrashRun)=>void;
  eligible?:()=>Promise<TrashTarget[]>; wait?:(delay:number)=>Promise<void>;
}) {
  let current:TrashRun={...run,state:"running",issue:undefined};
  function save(next:TrashRun) {
    options.save(next);
    current=next;
  }
  function finish(issue?:string) {
    save({...current,state:issue?"paused":"completed",issue});
    return current;
  }
  function record(index:number,item:TrashEntry) {
    const entries=current.entries.slice();
    entries[index]=item;
    save({...current,entries});
  }
  async function removeOne(index:number) {
    for(let attempt=0;;attempt++){
      if(options.stopped())return "stopped";
      const item=current.entries[index];
      if(Date.parse(item.expires_at)<=Date.now()){
        record(index,{...item,outcome:"skipped",reason:"expired"});return;
      }
      let issue="";
      try{
        const result=await options.purge({action:"purge",id:item.id,expiresAt:item.expires_at,confirm:true},()=>{
          if(options.stopped())throw new Error("stopped");
          record(index,{...item,outcome:"sent",sentAt:Date.now(),reason:undefined});
        });
        if(result.status==="ok"&&result.removed===1){
          record(index,{...item,outcome:"removed",reason:undefined});return;
        }
        issue=result.status==="busy"?"media_busy":result.status==="disabled"?"cleanup_disabled":"purge_unconfirmed";
      }catch(error){
        if(error instanceof Error&&error.message==="trash_checkpoint_storage")throw error;
        issue=error instanceof Error?(error.name==="RequestTimeoutError"?"inventory_timeout":error.message):"cleanup_unconfirmed";
        if(current.entries[index].outcome!=="sent")return issue;
      }
      if(preflightRefusals.has(issue)){
        record(index,{...item,outcome:"pending",reason:issue});return issue;
      }
      const knownRefusal=issue==="purge_unavailable";
      const result=await readOutcome(current.entries[index],options.receipt,knownRefusal);
      if(typeof result!=="string"){record(index,result);return;}
      if(result==="removal_in_progress")return result;
      if(result==="removal_unconfirmed")return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:result;
      if(issue==="media_busy"){
        // A definite contention response and a fresh eligible receipt establish
        // that the file can be attempted again under the unchanged server guard.
        record(index,{...item,outcome:"pending",reason:issue});
        if(attempt>=lockRetryDelays.length)return issue;
        if(options.stopped())return "stopped";
        await (options.wait??waitForRetry)(lockRetryDelays[attempt]);
        continue;
      }
      if(knownRefusal||issue==="purge_unconfirmed"){
        record(index,{...item,outcome:knownRefusal?"skipped":"failed",reason:issue});return;
      }
      return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:"removal_unconfirmed";
    }
  }

  save(current);
  const reconciled=await reconcileSent(current,options.receipt,save);
  if(reconciled.issue)return finish(reconciled.issue);
  if(options.stopped()&&trashRunUnfinished(current))return finish("stopped");
  if(options.eligible&&trashRunUnfinished(current)){
    const pending=current.entries.filter(item=>item.outcome==="pending");
    const eligibleIds=new Set(matchingTrashTargets(pending,await options.eligible()).map(item=>item.id));
    save({...current,entries:current.entries.map(item=>item.outcome==="pending"&&!eligibleIds.has(item.id)?
      {...item,outcome:"skipped",reason:"selection_changed"}:item)});
  }
  const pending=current.entries.flatMap((item,index)=>item.outcome==="pending"?[index]:[]);
  for(let start=0;start<pending.length;start+=mediaBatchSize){
    for(const index of pending.slice(start,start+mediaBatchSize)){
      const issue=await removeOne(index);
      if(issue)return finish(issue);
    }
    options.afterBatch?.(current);
  }
  return finish();
}
