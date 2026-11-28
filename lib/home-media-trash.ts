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
  returnTo?: TrashRun;
};
export type TrashRunClock = { startedAt: number; elapsedBefore: number; measuredBefore: number; processedBefore: number };
export const mediaRequestTimeoutMs = 59_000;
const lockRetryDelays=[1500,4500];
const lockRetryJitterMs=500;
const receiptRetryDelays=[500,1500,3500];
const retryableRefusals=new Set(["media_busy","cleanup_worker_busy","purge_timeout","cleanup_unconfirmed"]);

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

export function sameTrashTarget(saved:TrashTarget,current:TrashTarget) {
  return current.id===saved.id && current.expires_at===saved.expires_at && current.bucket===saved.bucket &&
    current.name===saved.name && current.source===saved.source &&
    (current.source==="unused_listing"||current.bytes===saved.bytes);
}

export function matchingTrashTargets(selected:TrashTarget[],live:TrashTarget[]) {
  const byId=new Map(live.map(item=>[item.id,item]));
  return selected.flatMap(item=>{
    const current=byId.get(item.id);
    return current&&sameTrashTarget(item,current)?[current]:[];
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
  validateTrashRun(run);
  return restorePreviousTrashRun(run);
}

function validateTrashRun(run:TrashRun) {
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
    if(item.outcome!=="pending"||!retryableRefusals.has(item.reason??"")||!Number.isSafeInteger(item.retryAfter)||
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
  if(run.returnTo){
    validateTrashRun(run.returnTo);
    if(pendingTrashRequest(run.returnTo))throw new Error("trash_checkpoint_invalid");
  }
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

export function restorePreviousTrashRun(run:TrashRun) {
  let active=run;
  while(active.returnTo&&!trashRunUnfinished(active)){
    let previous=active.returnTo;
    for(const file of active.entries){
      if(file.outcome==="removed")previous=settlePausedTrashItem(previous,file,"removed",file.bytes);
    }
    active=previous;
  }
  return active;
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
  "inventory_timeout","inventory_unavailable","trash_bulk_setup","retention_cleanup_setup","trash_checkpoint_storage","trash_run_interrupted","media_lock_deferred"]);
export function trashRunIssueCode(code:unknown) {
  return typeof code==="string"&&publicIssueCodes.has(code)?code:"cleanup_unconfirmed";
}

const skippedCodes=new Set(["selection_changed","already_removed","no_longer_eligible","protected","identity_changed",
  "expired","owner_hold","recovery_hold","file_trash_test","editing_session","active_upload","retry_wait","attempt_limit","missing_expiry"]);

type ReceiptReader = (item:TrashTarget)=>Promise<TrashReceipt>;
type Readback = "eligible" | "removal_in_progress" | "removal_unconfirmed" | TrashEntry;
type ReadbackWait = {wait:(delay:number)=>Promise<void>;stopped:()=>boolean};
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

function dispatchTimeRemaining(item:TrashEntry) {
  // A receipt can still be eligible before an interrupted HTTP request claims the
  // worker lease. Retain the journal entry through the original request deadline.
  return Number.isFinite(item.sentAt)?Math.max(0,Math.min(mediaRequestTimeoutMs,(item.sentAt??0)+mediaRequestTimeoutMs-Date.now())):0;
}

async function readDispatchOutcome(item:TrashEntry,receipt:ReceiptReader,wait:ReadbackWait) {
  let result=await readOutcome(item,receipt);
  for(const delay of receiptRetryDelays){
    if(typeof result!=="string"||result==="eligible"&&dispatchTimeRemaining(item)===0||wait.stopped())break;
    await wait.wait(delay);
    if(wait.stopped())break;
    result=await readOutcome(item,receipt);
  }
  const remaining=dispatchTimeRemaining(item);
  if(result==="eligible"&&remaining&&!wait.stopped()){
    await wait.wait(remaining);
    if(!wait.stopped())result=await readOutcome(item,receipt);
  }
  return result;
}

async function reconcileSent(run:TrashRun,receipt:ReceiptReader,save:(run:TrashRun)=>void,wait?:ReadbackWait) {
  let current=run;
  const sent=run.entries.filter(item=>item.outcome==="sent");
  if(run.individualRequest)sent.unshift(run.individualRequest);
  for(const item of sent){
    const result=wait?await readDispatchOutcome(item,receipt,wait):await readOutcome(item,receipt);
    if(result==="removal_in_progress"||result==="removal_unconfirmed")return {run:current,issue:result,itemId:item.id};
    if(result==="eligible"&&dispatchTimeRemaining(item)>0)return {run:current,issue:"removal_verification_wait",itemId:item.id};
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

function waitForRetry(delay:number,signal?:AbortSignal) {
  if(signal?.aborted)return Promise.resolve();
  return new Promise<void>(resolve=>{
    const timer=setTimeout(done,delay);
    signal?.addEventListener("abort",done,{once:true});
    function done(){clearTimeout(timer);signal?.removeEventListener("abort",done);resolve();}
  });
}

export async function processTrashRun(run:TrashRun, options:{
  purge:(payload:PurgePayload,beforeSend:()=>void)=>Promise<CleanupResult>; receipt:ReceiptReader;
  save:(run:TrashRun)=>void; stopped:()=>boolean; afterBatch?:(run:TrashRun)=>void|Promise<void>;
  eligible?:()=>Promise<TrashTarget[]>; signal?:AbortSignal; wait?:(delay:number)=>Promise<void>;
}) {
  let current:TrashRun={...run,state:"running",issue:undefined,issueItemId:undefined};
  const readback={wait:options.wait??((delay:number)=>waitForRetry(delay,options.signal)),stopped:options.stopped};
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
  function deferOrRetry(index:number,item:TrashEntry,reason:string) {
    const retries=item.retryCount??0;
    const delay=lockRetryDelays[retries];
    const issue=delay===undefined&&reason==="media_busy"?"media_lock_deferred":reason;
    record(index,{...item,outcome:"pending",reason:issue,sentAt:undefined,
      retryAfter:delay===undefined?undefined:Date.now()+delay+Math.floor(Math.random()*lockRetryJitterMs)},issue);
    return delay===undefined?issue:null;
  }
  async function removeOne(index:number) {
    for(;;){
      if(options.stopped())return "stopped";
      const item=current.entries[index];
      const retryAfter=item.retryAfter;
      const delay=retryAfter===undefined?0:Math.min(Math.max(...lockRetryDelays)+lockRetryJitterMs,retryAfter-Date.now());
      if(delay>0){
        if(current.issueItemId!==item.id)save({...current,issue:item.reason,issueItemId:item.id});
        await readback.wait(delay);
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
      if(issue==="cleanup_worker_busy"){
        const deferred=deferOrRetry(index,sent,issue);
        if(deferred)return deferred;
        continue;
      }
      if(preflightRefusals.has(issue)){
        record(index,{...sent,outcome:"pending",reason:issue,sentAt:undefined});return issue;
      }
      const knownRefusal=issue==="purge_unavailable";
      const ambiguous=!knownRefusal&&issue!=="purge_unconfirmed"&&issue!=="media_busy"&&issue!=="forbidden";
      const result=ambiguous?await readDispatchOutcome(sent,options.receipt,readback):
        await readOutcome(sent,options.receipt,knownRefusal);
      if(typeof result!=="string"){record(index,result);return;}
      if(result==="removal_in_progress")return result;
      if(result==="removal_unconfirmed")return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:result;
      if(issue==="media_busy"){
        const deferred=deferOrRetry(index,sent,issue);
        if(deferred)return deferred;
        continue;
      }
      if(knownRefusal||issue==="purge_unconfirmed"){
        record(index,{...sent,outcome:knownRefusal?"skipped":"failed",reason:issue,sentAt:undefined});return;
      }
      if(ambiguous&&dispatchTimeRemaining(sent)===0){
        const deferred=deferOrRetry(index,sent,issue==="inventory_timeout"?"purge_timeout":"cleanup_unconfirmed");
        if(deferred)return deferred;
        continue;
      }
      return issue==="inventory_timeout"?"purge_timeout":issue==="forbidden"?issue:"removal_unconfirmed";
    }
  }

  save(current);
  const reconciled=await reconcileSent(current,options.receipt,save,readback);
  if(reconciled.issue)return finish(reconciled.issue,reconciled.itemId);
  if(options.stopped()&&trashRunUnfinished(current))return finish("stopped");
  if(options.eligible&&trashRunUnfinished(current)){
    const pending=current.entries.filter(item=>item.outcome==="pending");
    const eligible=new Map(matchingTrashTargets(pending,await options.eligible()).map(item=>[item.id,item]));
    save({...current,entries:current.entries.map(item=>{
      if(item.outcome!=="pending")return item;
      const live=eligible.get(item.id);
      return live?{...item,bytes:live.bytes}:{...item,outcome:"skipped",reason:"selection_changed"};
    })});
  }
  const pending=current.entries.flatMap((item,index)=>item.outcome==="pending"?[index]:[]);
  const deferred:number[]=[];
  for(let start=0;start<pending.length;start+=mediaBatchSize){
    for(const index of pending.slice(start,start+mediaBatchSize)){
      const issue=await removeOne(index);
      if(issue==="media_lock_deferred")deferred.push(index);
      else if(issue)return finish(issue,current.entries[index].id);
    }
    await options.afterBatch?.(current);
  }
  for(const index of deferred){
    if(index===pending.at(-1))continue;
    // Other files may have taken long enough for this file's lock to clear.
    const issue=await removeOne(index);
    if(issue&&issue!=="media_lock_deferred")return finish(issue,current.entries[index].id);
  }
  const locked=deferred.find(index=>current.entries[index].outcome==="pending");
  return locked===undefined?finish():finish("media_lock_deferred",current.entries[locked].id);
}
