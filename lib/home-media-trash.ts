export const mediaBatchSize = 8;
export type TrashTarget = { id: string; bucket: string; name: string; expires_at: string; bytes: number | null; source?: "unused_listing" };
export type CleanupResult = { status: string; removed?: number; attempted?: number; overdue?: number };
export type TrashReceipt = { status: string; bytes?: number | null };
export type TrashOperationState = "idle" | "running" | "stopping" | "paused" | "completed" | "cancelled" | "failed";
type Outcome = "pending" | "sent" | "removed" | "skipped" | "failed" | "cancelled";
type TrashEntry = TrashTarget & { outcome: Outcome; reason?: string; sentAt?: number; retryCount?: number; retryAfter?: number };
type TrashRunTiming = { elapsedMs: number; measuredFiles: number; pauseReason?: string };
export type TrashRun = {
  version: 1; confirmedAt: string; state: Exclude<TrashOperationState, "idle">; issue?: string; issueItemId?: string;
  entries: TrashEntry[]; timing?: TrashRunTiming;
  individualRequest?: TrashEntry;
};
export type TrashRunClock = { startedAt: number; elapsedBefore: number; measuredBefore: number; processedBefore: number };
export const mediaRequestTimeoutMs = 59_000;
const lockRetryDelays=[1500,4500];
const lockRetryJitterMs=500;

export function trashRunUnfinished(run:TrashRun|null) {
  return !!run&&(!!run.individualRequest||run.entries.some(item=>item.outcome==="pending"||item.outcome==="sent"));
}

export function pendingTrashRequest(run:TrashRun|null) {
  return run?.individualRequest??run?.entries.find(item=>item.outcome==="sent");
}

export function isTrashTarget(row:unknown): row is TrashTarget {
  if (!row || typeof row !== "object") return false;
  const item=row as TrashTarget;
  return typeof item.id==="string" && typeof item.name==="string" && typeof item.bucket==="string" &&
    typeof item.expires_at==="string" && Number.isFinite(Date.parse(item.expires_at)) &&
    (item.source===undefined || item.source==="unused_listing") &&
    (item.bytes===null || Number.isSafeInteger(item.bytes) && item.bytes>=0);
}

export function matchingTrashTargets(selected:TrashTarget[],live:TrashTarget[]) {
  const byId=new Map(live.map(item=>[item.id,item]));
  return selected.filter(item=>{
    const current=byId.get(item.id);
    return current?.expires_at===item.expires_at && current.bucket===item.bucket && current.name===item.name && current.bytes===item.bytes && current.source===item.source;
  });
}

export function makeTrashRun(items:TrashTarget[]):TrashRun {
  if(!items.length || new Set(items.map(item=>item.id)).size!==items.length ||
    !items.every(item=>isTrashTarget(item) && item.source===items[0].source)) throw new Error("invalid_request");
  return {version:1,confirmedAt:new Date().toISOString(),state:"running",entries:items.map(item=>({...item,outcome:"pending",retryCount:0})),
    timing:{elapsedMs:0,measuredFiles:0}};
}

export function readTrashRun(source:string|null):TrashRun|null {
  if(!source)return null;
  let run:TrashRun;
  try{run=JSON.parse(source) as TrashRun;}
  catch{throw new Error("trash_checkpoint_invalid");}
  if(run?.version!==1 || !Number.isFinite(Date.parse(run.confirmedAt)) || !Array.isArray(run.entries) || !run.entries.length ||
    !run.entries.every(item=>isTrashTarget(item) && item.source===run.entries[0].source &&
      ["pending","sent","removed","skipped","failed","cancelled"].includes(item.outcome)) ||
    new Set(run.entries.map(item=>item.id)).size!==run.entries.length||
    run.individualRequest!==undefined&&(!isTrashTarget(run.individualRequest)||run.individualRequest.outcome!=="sent"))
    throw new Error("trash_checkpoint_invalid");
  const timing=run.timing;
  if(timing&&(!Number.isSafeInteger(timing.elapsedMs)||timing.elapsedMs<0||!Number.isSafeInteger(timing.measuredFiles)||
    timing.measuredFiles<0||timing.measuredFiles>run.entries.length||
    (timing.pauseReason!==undefined&&typeof timing.pauseReason!=="string")))delete run.timing;
  // A persisted running state cannot establish that a browser still owns the lock.
  // Open it as resumable until the operator takes the lock and checks any sent item.
  const issue=run.issue??run.timing?.pauseReason;
  if(issue!==undefined)run.issue=trashRunIssueCode(issue);
  for(const item of run.entries){
    if(!Number.isSafeInteger(item.retryCount)||(item.retryCount??0)<0||(item.retryCount??0)>lockRetryDelays.length)delete item.retryCount;
    if(item.outcome!=="pending"||item.reason!=="media_busy"||!Number.isSafeInteger(item.retryAfter)||
      (item.retryCount??0)>=lockRetryDelays.length)delete item.retryAfter;
  }
  if(trashRunUnfinished(run)){
    if(run.state!=="failed")run.state="paused";
    run.issue??="trash_run_interrupted";
    if(!run.issueItemId||(run.individualRequest?.id!==run.issueItemId&&!run.entries.some(item=>item.id===run.issueItemId))){
      run.issueItemId=(pendingTrashRequest(run)??
        run.entries.find(item=>item.outcome==="pending"&&item.reason===run.issue))?.id;
    }
  }else if(run.state!=="failed"){
    if(run.state!=="cancelled")run.state="completed";
    delete run.issue;
    delete run.issueItemId;
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

type TrashIdentity = Pick<TrashTarget,"id"|"bucket"|"name"|"source"> & {expires_at:string|null};
export function settlePausedTrashItem(run:TrashRun,item:TrashIdentity,outcome:"removed"|"restored",bytes?:number|null):TrashRun {
  const index=run.entries.findIndex(row=>row.outcome==="pending"&&row.id===item.id&&row.bucket===item.bucket&&
    row.name===item.name&&row.expires_at===item.expires_at&&row.source===item.source);
  if(index<0)return run;
  const entries=run.entries.slice();
  const row=entries[index];
  entries[index]={...row,outcome:outcome==="restored"?"skipped":"removed",reason:outcome==="restored"?"restored":undefined,
    bytes:bytes??row.bytes,retryAfter:undefined};
  const next={...run,entries};
  if(!trashRunUnfinished(next)&&run.state!=="running")return {...next,state:"completed",issue:undefined,issueItemId:undefined};
  return run.issueItemId===item.id?{...next,issue:"stopped",issueItemId:undefined}:next;
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

type PurgePayload = { action:"purge"|"purge_unused"; id:string; expiresAt:string; confirm:true };
const preflightRefusals=new Set(["cleanup_disabled","cleanup_worker_busy","session_expired","cross_app_protection_required",
  "cross_app_protection_unconfirmed","cleanup_worker_missing","owner_check_unavailable","backend_config"]);
const publicIssueCodes=new Set([...preflightRefusals,"stopped","media_busy","forbidden","invalid_request","cleanup_unconfirmed",
  "purge_unavailable","purge_unconfirmed","purge_timeout","removal_in_progress","removal_unconfirmed","removal_verification_wait",
  "inventory_timeout","inventory_unavailable","trash_bulk_setup","retention_cleanup_setup","trash_checkpoint_storage","trash_run_interrupted"]);
export function trashRunIssueCode(code:unknown) {
  return typeof code==="string"&&publicIssueCodes.has(code)?code:"cleanup_unconfirmed";
}

const skippedCodes=new Set(["selection_changed","already_removed","no_longer_eligible","protected","identity_changed",
  "expired","owner_hold","recovery_hold","file_trash_test","editing_session","active_upload","retry_wait","attempt_limit","missing_expiry"]);

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
  const sent=run.entries.filter(item=>item.outcome==="sent");
  if(run.individualRequest)sent.unshift(run.individualRequest);
  for(const item of sent){
    const result=await readOutcome(item,receipt);
    if(result==="removal_in_progress"||result==="removal_unconfirmed")return {run:current,issue:result,itemId:item.id};
    if(result==="eligible"&&mayStillBeDispatched(item))return {run:current,issue:"removal_verification_wait",itemId:item.id};
    if(item===current.individualRequest){
      current={...current,individualRequest:undefined};
      if(result!=="eligible"&&result.outcome==="removed")current=settlePausedTrashItem(current,item,"removed",result.bytes);
    }else{
      const settled:TrashEntry=result==="eligible"?{...item,outcome:"pending",sentAt:undefined,reason:undefined}:result;
      current={...current,entries:current.entries.map(row=>row.id===item.id?settled:row)};
    }
    save(current);
  }
  return {run:current,issue:undefined};
}

export async function reconcilePausedTrashRun(run:TrashRun,options:{receipt:ReceiptReader;save:(run:TrashRun)=>void}) {
  const reconciled=await reconcileSent(run,options.receipt,options.save);
  const pending=trashRunUnfinished(reconciled.run);
  const next:TrashRun={...reconciled.run,state:pending?"paused":"completed",
    issue:reconciled.issue??(pending?"stopped":undefined),issueItemId:reconciled.itemId};
  options.save(next);
  return next;
}

export async function cancelTrashRun(run:TrashRun,options:{receipt:ReceiptReader;save:(run:TrashRun)=>void}) {
  const reconciled=await reconcileSent(run,options.receipt,options.save);
  const next:TrashRun=reconciled.issue?{...reconciled.run,state:"paused",issue:reconciled.issue,issueItemId:reconciled.itemId}:
    {...reconciled.run,state:"cancelled",issue:undefined,issueItemId:undefined,
      entries:reconciled.run.entries.map(item=>item.outcome==="pending"?{...item,outcome:"cancelled",reason:undefined,retryAfter:undefined}:item)};
  options.save(next);
  return next;
}

const waitForRetry=(delay:number)=>new Promise<void>(resolve=>setTimeout(resolve,delay));

export async function processTrashRun(run:TrashRun, options:{
  purge:(payload:PurgePayload,beforeSend:()=>void)=>Promise<CleanupResult>; receipt:ReceiptReader;
  save:(run:TrashRun)=>void; stopped:()=>boolean; afterBatch?:(run:TrashRun)=>void;
  eligible?:()=>Promise<TrashTarget[]>; wait?:(delay:number)=>Promise<void>;
}) {
  let current:TrashRun={...run,state:"running",issue:undefined,issueItemId:undefined};
  function save(next:TrashRun) {
    options.save(next);
    current=next;
  }
  function finish(issue?:string, itemId?:string) {
    save({...current,state:issue?"paused":"completed",issue,issueItemId:issue&&issue!=="stopped"?itemId:undefined});
    return current;
  }
  function record(index:number,item:TrashEntry,issue?:string) {
    const entries=current.entries.slice();
    entries[index]=item;
    save({...current,entries,issue,issueItemId:issue?item.id:undefined});
  }
  async function removeOne(index:number) {
    for(;;){
      if(options.stopped())return "stopped";
      const item=current.entries[index];
      const retryAfter=item.retryAfter;
      const delay=retryAfter===undefined?0:Math.min(Math.max(...lockRetryDelays)+lockRetryJitterMs,retryAfter-Date.now());
      if(delay>0){
        if(current.issueItemId!==item.id)save({...current,issue:"media_busy",issueItemId:item.id});
        await (options.wait??waitForRetry)(delay);
      }
      if(options.stopped())return "stopped";
      if(!item.source&&Date.parse(item.expires_at)<=Date.now()){
        record(index,{...item,outcome:"skipped",reason:"expired",retryAfter:undefined});return;
      }
      let issue="";
      try{
        const result=await options.purge({action:item.source==="unused_listing"?"purge_unused":"purge",id:item.id,expiresAt:item.expires_at,confirm:true},()=>{
          if(options.stopped())throw new Error("stopped");
          // Count only retries that reach dispatch, so a reload during a delay does not spend the budget.
          record(index,{...item,outcome:"sent",sentAt:Date.now(),reason:undefined,retryAfter:undefined,
            retryCount:(item.retryCount??0)+(retryAfter===undefined?0:1)});
        });
        if(result.status==="ok"&&result.removed===1){
          record(index,{...current.entries[index],outcome:"removed",sentAt:undefined});return;
        }
        issue=result.status==="busy"?"cleanup_worker_busy":result.status==="disabled"?"cleanup_disabled":"purge_unconfirmed";
      }catch(error){
        if(error instanceof Error&&error.message==="trash_checkpoint_storage")throw error;
        issue=error instanceof Error&&error.name==="RequestTimeoutError"?"inventory_timeout":trashRunIssueCode(error instanceof Error?error.message:undefined);
        if(current.entries[index].outcome!=="sent")return issue;
      }
      const sent=current.entries[index];
      if(preflightRefusals.has(issue)){
        record(index,{...sent,outcome:"pending",reason:issue,sentAt:undefined});return issue;
      }
      const knownRefusal=issue==="purge_unavailable";
      const result=await readOutcome(sent,options.receipt,knownRefusal);
      if(typeof result!=="string"){record(index,result);return;}
      if(result==="removal_in_progress")return result;
      if(result==="removal_unconfirmed")return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:result;
      if(issue==="media_busy"){
        // Only the definitive lock refusal and an eligible receipt allow deferral.
        // A missing receipt or one showing an in-flight deletion pauses above.
        const retries=sent.retryCount??0;
        if(retries>=lockRetryDelays.length){
          record(index,{...sent,outcome:"skipped",reason:"media_lock_deferred",sentAt:undefined});return;
        }
        const nextAttemptAt=Date.now()+lockRetryDelays[retries]+Math.floor(Math.random()*lockRetryJitterMs);
        record(index,{...sent,outcome:"pending",reason:issue,sentAt:undefined,retryAfter:nextAttemptAt},issue);
        continue;
      }
      if(knownRefusal||issue==="purge_unconfirmed"){
        record(index,{...sent,outcome:knownRefusal?"skipped":"failed",reason:issue,sentAt:undefined});return;
      }
      return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:"removal_unconfirmed";
    }
  }

  save(current);
  const reconciled=await reconcileSent(current,options.receipt,save);
  if(reconciled.issue)return finish(reconciled.issue,reconciled.itemId);
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
      if(issue)return finish(issue,current.entries[index].id);
    }
    options.afterBatch?.(current);
  }
  return finish();
}
