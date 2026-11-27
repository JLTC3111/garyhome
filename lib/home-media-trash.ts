export const mediaBatchSize = 8;
export type TrashTarget = { id: string; bucket: string; name: string; expires_at: string; bytes: number | null };
export type CleanupResult = { status: string; removed?: number; attempted?: number; overdue?: number };
export type TrashReceipt = { status: string; bytes?: number | null };
type Outcome = "pending" | "sent" | "removed" | "skipped" | "failed";
type TrashEntry = TrashTarget & { outcome: Outcome; reason?: string };
type TrashRunTiming = { elapsedMs: number; measuredFiles: number; pauseReason?: string };
export type TrashRun = { version: 1; confirmedAt: string; entries: TrashEntry[]; timing?: TrashRunTiming };
export type TrashRunClock = { startedAt: number; elapsedBefore: number; measuredBefore: number; processedBefore: number };

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
  return {version:1,confirmedAt:new Date().toISOString(),entries:items.map(item=>({...item,outcome:"pending"})),
    timing:{elapsedMs:0,measuredFiles:0}};
}

export function readTrashRun(source:string|null):TrashRun|null {
  if(!source)return null;
  let run:TrashRun;
  try{run=JSON.parse(source) as TrashRun;}
  catch{throw new Error("trash_checkpoint_invalid");}
  if(run?.version!==1 || !Number.isFinite(Date.parse(run.confirmedAt)) || !Array.isArray(run.entries) || !run.entries.length ||
    !run.entries.every(item=>isTrashTarget(item) && ["pending","sent","removed","skipped","failed"].includes(item.outcome)) ||
    new Set(run.entries.map(item=>item.id)).size!==run.entries.length)throw new Error("trash_checkpoint_invalid");
  const timing=run.timing;
  if(timing&&(!Number.isSafeInteger(timing.elapsedMs)||timing.elapsedMs<0||!Number.isSafeInteger(timing.measuredFiles)||
    timing.measuredFiles<0||timing.measuredFiles>run.entries.length||
    (timing.pauseReason!==undefined&&typeof timing.pauseReason!=="string")))delete run.timing;
  return run;
}

export function trashRunTotals(run:TrashRun) {
  const totals={pending:0,removed:0,skipped:0,failed:0,reclaimedBytes:0,unknownSizes:0};
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
const pauseCodes=new Set(["cleanup_disabled","media_busy","forbidden","session_expired","cross_app_protection_required",
  "cross_app_protection_unconfirmed","cleanup_worker_missing","owner_check_unavailable","backend_config"]);
const skippedCodes=new Set(["selection_changed","already_removed","no_longer_eligible","protected","identity_changed",
  "expired","owner_hold","active_upload","retry_wait","attempt_limit","missing_expiry"]);

export async function processTrashRun(run:TrashRun, options:{
  purge:(payload:PurgePayload)=>Promise<CleanupResult>; receipt:(item:TrashTarget)=>Promise<TrashReceipt>;
  save:(run:TrashRun)=>void; stopped:()=>boolean; afterBatch:()=>Promise<void>;
}) {
  let current=run;
  let paused="";
  const pending=current.entries.map((item,index)=>item.outcome==="pending"||item.outcome==="sent"?index:-1).filter(index=>index>=0);
  function record(index:number,outcome:Outcome,reason?:string,bytes?:number|null) {
    const entries=current.entries.slice();
    const item=entries[index];
    entries[index]={...item,bytes:bytes??item.bytes,outcome,reason};
    const next={...current,entries};
    options.save(next);
    current=next;
  }
  async function readOutcome(index:number, knownRefusal=false) {
    let receipt:TrashReceipt;
    try{receipt=await options.receipt(current.entries[index]);}
    catch{return "removal_unconfirmed";}
    if(receipt.status==="eligible")return "eligible";
    if(receipt.status==="removal_in_progress")return receipt.status;
    if(receipt.status==="removed" && !knownRefusal)record(index,"removed",undefined,receipt.bytes);
    else if(receipt.status==="storage_failure")record(index,"failed",receipt.status);
    else if(receipt.status==="removed"||skippedCodes.has(receipt.status))record(index,"skipped",receipt.status==="removed"?"already_removed":receipt.status);
    else return "removal_unconfirmed";
    return "settled";
  }
  for(let start=0;start<pending.length;start+=mediaBatchSize){
    for(const index of pending.slice(start,start+mediaBatchSize)){
      if(options.stopped()){paused="stopped";break;}
      const item=current.entries[index];
      if(item.outcome==="sent"){
        const result=await readOutcome(index);
        if(result==="settled")continue;
        if(result!=="eligible"){paused=result;break;}
      }
      if(options.stopped()){paused="stopped";break;}
      if(Date.parse(item.expires_at)<=Date.now()){record(index,"skipped","expired");continue;}
      record(index,"sent");
      let issue="";
      let result:CleanupResult|undefined;
      try{
        result=await options.purge({action:"purge",id:item.id,expiresAt:item.expires_at,confirm:true});
      }catch(error){issue=error instanceof Error?error.message:"cleanup_unconfirmed";}
      if(result?.status==="ok" && result.removed===1){record(index,"removed");continue;}
      if(result)issue=result.status==="busy"?"media_busy":result.status==="disabled"?"cleanup_disabled":"purge_unconfirmed";
      if(pauseCodes.has(issue)){record(index,"pending",issue);paused=issue;break;}
      const knownRefusal=issue==="purge_unavailable";
      const readback=await readOutcome(index,knownRefusal);
      if(readback==="settled")continue;
      if(readback==="eligible" && (knownRefusal||issue==="purge_unconfirmed")){
        record(index,knownRefusal?"skipped":"failed",issue);
        continue;
      }
      paused=readback==="removal_in_progress"?readback:"removal_unconfirmed";
      break;
    }
    await options.afterBatch();
    if(paused)break;
  }
  return {run:current,paused};
}
