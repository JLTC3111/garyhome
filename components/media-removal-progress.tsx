"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Clock3, FileCheck2, Files, Pause, Play, RotateCw, X } from "lucide-react";
import { pendingTrashRequest, trashRunEta, trashRunIssueCode, trashRunTiming, trashRunTotals, type TrashOperationState, type TrashRun, type TrashRunClock } from "@/lib/home-media-trash";
import { useSite } from "./site-context";
import { MediaActionButton } from "./media-selection";

function duration(seconds:number) {
  const hours=Math.floor(seconds/3600);
  const minutes=Math.floor(seconds%3600/60);
  const remainder=String(seconds%60).padStart(2,"0");
  return hours>0?`${hours}:${String(minutes).padStart(2,"0")}:${remainder}`:`${String(minutes).padStart(2,"0")}:${remainder}`;
}

type MeterState = "loading"|"running"|"paused"|"completed"|"failed"|"disabled";

function MediaProgressMeter({state,label,processed,total,remaining,elapsedMs}: {
  state:MeterState;label:string;processed?:number;total?:number;remaining?:number;elapsedMs?:number;
}) {
  const {t,language}=useSite();
  const count=new Intl.NumberFormat(language==="vi"?"vi-VN":"en");
  const percent=total===undefined?undefined:total>0?
    Math.floor(100*Math.max(0,Math.min(total,processed??0))/total):state==="completed"?100:0;
  return <div className="storage-media-meter" data-progress-state={state}>
    <div className="storage-media-meter__summary">
      <span className="storage-media-meter__percent">{percent===undefined?"—":`${count.format(percent)}%`}</span>
      <span><Clock3 size={15} aria-hidden="true"/>{t("Elapsed","Đã chạy")} <b>{elapsedMs===undefined?"—":duration(Math.floor(elapsedMs/1000))}</b></span>
      <span><Files size={15} aria-hidden="true"/>{t("Remaining files","Tệp còn lại")} <b>{remaining===undefined?"—":count.format(remaining)}</b></span>
    </div>
    <div className="storage-removal-progress__track" role="progressbar" aria-label={label} aria-valuenow={percent}
      data-indeterminate={state==="loading"&&total===undefined} data-running={state==="running"}>
      <div className="storage-removal-progress__fill" style={percent===undefined?undefined:{width:`${percent}%`}}/>
    </div>
  </div>;
}

type VerificationObservation = {
  status:"idle"|"running"|"complete"|"failed"|"busy";
  checked:number;total:number;recorded:number;reset:number;lastSuccessfulAt:string|null;
};

export function MediaVerificationProgress({observation,checking,visible,disabled,issue,resumable,pausing,pauseDisabled,formatTime,onVerify,onPause}: {
  observation:VerificationObservation|null;checking:boolean;visible:boolean;disabled:boolean;issue:string;
  resumable:boolean;pausing:boolean;pauseDisabled:boolean;formatTime:(time:string|null)=>string;
  onVerify:()=>Promise<void>;onPause:()=>void;
}) {
  const {t,language}=useSite();
  const [attempt,setAttempt]=useState<{startedAt:number;elapsedBefore:number;previous:VerificationObservation|null}|null>(null);
  const [elapsed,setElapsed]=useState<number>();
  const id=useId();
  const count=new Intl.NumberFormat(language==="vi"?"vi-VN":"en");
  useEffect(()=>{
    if(!checking||!attempt||!visible)return;
    const timer=setInterval(()=>setElapsed(attempt.elapsedBefore+performance.now()-attempt.startedAt),1000);
    return ()=>clearInterval(timer);
  },[attempt,checking,visible]);
  async function verify() {
    const startedAt=performance.now();
    const elapsedBefore=resumable?(elapsed??0):0;
    setAttempt({startedAt,elapsedBefore,previous:observation});
    setElapsed(elapsedBefore);
    try {await onVerify();}
    finally {setElapsed(elapsedBefore+performance.now()-startedAt);}
  }

  const result=observation&&observation.status!=="idle"&&
    (!checking&&!resumable||observation.status!=="complete"||checking&&observation!==attempt?.previous)?observation:null;
  const state:MeterState|"idle"=checking?(pausing?"paused":!result?"loading":result.status==="complete"?"completed":"running"):
    result?.status==="busy"?"paused":issue?"failed":result?.status==="complete"?"completed":
      resumable?"paused":disabled?"disabled":"idle";
  const stateText={
    idle:"",disabled:t("Verification unavailable during this operation","Không thể xác minh khi đang chạy thao tác này"),
    loading:t("Preparing verification","Đang chuẩn bị xác minh"),running:t("Verifying files","Đang xác minh tệp"),
    paused:pausing?t("Pausing verification","Đang tạm dừng xác minh"):t("Verification paused","Đã tạm dừng xác minh"),
    completed:t("Verification complete","Đã xác minh xong"),
    failed:t("Verification needs attention","Cần kiểm tra lượt xác minh"),
  }[state];
  return <section className="storage-media-observation" data-progress-state={state} aria-labelledby={`${id}-title`}>
    <div className="storage-removal-progress__header">
      <div>
        <h3 id={`${id}-title`}>{t("Unused-file verification","Xác minh tệp chưa sử dụng")}</h3>
        {observation&&<p className="storage-media-note">{t("Last successful observation","Lần xác minh thành công gần nhất")} <strong>{observation.lastSuccessfulAt?
          formatTime(observation.lastSuccessfulAt):t("None yet","Chưa có")}</strong></p>}
      </div>
      <div className="storage-media-actions">
        <MediaActionButton icon={FileCheck2} tone="primary" pending={checking} disabled={disabled} onClick={()=>void verify()}>
          {checking?t("Verifying…","Đang xác minh…"):issue?t("Retry verification","Thử xác minh lại"):
            resumable?t("Resume verification","Tiếp tục xác minh"):t("Verify unused files","Xác minh tệp chưa sử dụng")}
        </MediaActionButton>
        {checking&&<MediaActionButton icon={Pause} tone="warning" disabled={pauseDisabled} onClick={onPause}>
          {pausing?t("Pausing…","Đang tạm dừng…"):t("Pause verification","Tạm dừng xác minh")}
        </MediaActionButton>}
      </div>
    </div>
    {state!=="idle"&&<p className="storage-media-operation-label" role="status">{stateText}{result&&t(
      ` · ${count.format(result.checked)} of ${count.format(result.total)} checked · ${count.format(result.recorded)} newly verified · ${count.format(result.reset)} timers cleared`,
      ` · Đã kiểm tra ${count.format(result.checked)}/${count.format(result.total)} · ${count.format(result.recorded)} tệp mới xác minh · Đã xóa ${count.format(result.reset)} bộ đếm thời gian`)}</p>}
    {state!=="idle"&&(checking||result||issue)&&<MediaProgressMeter state={state}
      label={t("Unused-file verification progress","Tiến độ xác minh tệp chưa sử dụng")}
      processed={result?.checked} total={result?.total} remaining={result?Math.max(0,result.total-result.checked):undefined} elapsedMs={elapsed}/>}
    {resumable&&!checking&&!issue&&<p className="storage-media-note">{t("Resume from the last saved check.","Tiếp tục từ lần kiểm tra đã lưu.")}</p>}
    {issue&&<p className="storage-media-feedback" data-tone="error" role="alert">{issue}</p>}
  </section>;
}

export function MediaRemovalProgress({
  run,state,clock,preparing,visible,reconciling,refreshing,actionsBusy,detailsId,resumeReason,message,formatBytes,describeReason,onStop,onResume,onCancel,onCheckReceipt,
}: {
  run:TrashRun|null;state:TrashOperationState;clock:TrashRunClock|null;preparing:boolean;visible:boolean;
  reconciling:boolean;refreshing:boolean;actionsBusy:boolean;detailsId:string;resumeReason:string;message:string;
  formatBytes:(bytes:number)=>string;describeReason:(code?:string)=>string;onStop:()=>void;onResume:()=>void;onCancel:()=>void;onCheckReceipt:()=>void;
}) {
  const {t,language}=useSite();
  const id=useId();
  const panel=useRef<HTMLElement|null>(null);
  const [now,setNow]=useState(0);
  useEffect(()=>{
    if(!clock||!visible)return;
    const update=()=>setNow(performance.now());
    update();const timer=setInterval(update,1000);
    return ()=>clearInterval(timer);
  },[clock,visible]);
  useEffect(()=>{
    if(visible&&(preparing||reconciling||state==="stopping"))panel.current?.focus();
  },[preparing,reconciling,state,visible]);

  if(state==="idle")return null;
  const currentRun=preparing?null:run;
  const totals=currentRun?trashRunTotals(currentRun):null;
  const total=currentRun?.entries.length??0;
  const remaining=totals?.pending??0;
  const processed=total-remaining-(totals?.cancelled??0);
  const current=pendingTrashRequest(currentRun);
  const resumable=(remaining>0||!!current)&&(state==="paused"||state==="failed");
  const timing=clock?trashRunTiming(clock,processed,now):currentRun?.timing;
  const eta=state==="cancelled"?null:trashRunEta(remaining,timing);
  const issueCode=currentRun?.issue&&currentRun.issue!=="stopped"?trashRunIssueCode(currentRun.issue):null;
  const waitingForLock=state==="running"&&(issueCode==="media_busy"||issueCode==="cleanup_worker_busy");
  const systemPause=!!issueCode&&(state==="paused"||state==="failed");
  const showIssue=systemPause||waitingForLock;
  const issueItemId=currentRun?.issueItemId;
  const affected=(showIssue&&issueItemId?currentRun?.entries.find(item=>item.id===issueItemId):undefined)??current;
  const filename=affected?.name.split("/").at(-1)||affected?.name;
  const count=new Intl.NumberFormat(language==="vi"?"vi-VN":"en");
  const headings={
    running:preparing?t("Preparing removal","Đang chuẩn bị xóa"):waitingForLock?
      t("Waiting to retry a locked file","Đang chờ thử lại tệp bị khóa"):t("Removing files","Đang xóa tệp"),
    stopping:t("Stopping after the current file","Sẽ dừng sau tệp hiện tại"),
    paused:systemPause?t("Removal paused by the system","Hệ thống đã tạm dừng lượt xóa"):t("Removal paused","Đã tạm dừng xóa"),
    completed:t("Removal complete","Đã hoàn tất lượt xóa"),
    cancelled:t("Remaining removal cancelled","Đã hủy xóa các tệp còn lại"),
    failed:t("Removal needs attention","Cần kiểm tra lượt xóa"),
  };
  const issue=waitingForLock?t("The system will retry after a short delay.","Hệ thống sẽ thử lại sau giây lát."):
    systemPause?describeReason(issueCode??undefined):"";
  const blocked=resumable?resumeReason:"";
  const details=reconciling?t("Checking the last deletion receipt…","Đang kiểm tra biên nhận xóa cuối…"):
    message||issue||(refreshing?t("Refreshing inventory and Cleanup History…","Đang làm mới kho và Lịch sử dọn tệp…"):
      blocked||(resumable?t("Resume this run or cancel the remaining files to start another removal.",
        "Tiếp tục lượt này hoặc hủy các tệp còn lại để bắt đầu lượt xóa khác."):""));
  const cancelled=totals?.cancelled??0;
  const deferred=currentRun?.entries.filter(item=>item.reason==="media_lock_deferred").length??0;
  const meterState:MeterState=preparing||reconciling?"loading":state==="stopping"||waitingForLock?"paused":state==="cancelled"?"disabled":state;

  return <section ref={panel} tabIndex={-1} className="storage-removal-progress" data-state={state} aria-labelledby={`${id}-title`}>
    <header className="storage-removal-progress__header">
      <h3 id={`${id}-title`}>{headings[state]}</h3>
      {state==="running"&&clock&&remaining>0&&<MediaActionButton icon={Pause} tone="warning" onClick={onStop}>
        {t("Stop after the current file","Dừng sau tệp hiện tại")}
      </MediaActionButton>}
      {resumable&&!reconciling&&!refreshing&&<div className="storage-media-actions">
        {current&&<MediaActionButton icon={RotateCw} disabled={actionsBusy} onClick={onCheckReceipt}>
          {t("Check last request","Kiểm tra yêu cầu cuối")}
        </MediaActionButton>}
        <MediaActionButton icon={Play} tone="primary" disabled={actionsBusy||!!blocked}
          aria-describedby={blocked?(blocked===details?detailsId:`${id}-blocked`):undefined} onClick={onResume}>{t("Resume","Tiếp tục")}</MediaActionButton>
        <MediaActionButton icon={X} disabled={actionsBusy} onClick={onCancel}>
          {t("Cancel remaining","Hủy các tệp còn lại")}
        </MediaActionButton>
      </div>}
    </header>
    {(totals||preparing)&&<MediaProgressMeter state={meterState} label={t("Deletion progress","Tiến độ xóa tệp")}
      processed={totals?processed:undefined} total={totals?total:undefined} remaining={totals?remaining:undefined} elapsedMs={timing?.elapsedMs}/>}
    {filename&&!showIssue&&<p className="storage-removal-progress__current">
      <span>{clock?t("Current file","Tệp hiện tại"):t("Last request","Yêu cầu cuối")}</span><strong title={filename}>{filename}</strong>
    </p>}
    {totals&&<dl className="storage-removal-progress__metrics">
      <div><dt>{t("Processed","Đã xử lý")}</dt><dd>{count.format(processed)} / {count.format(total)}</dd></div>
      <div><dt>{t("Removed","Đã xóa")}</dt><dd>{count.format(totals.removed)}</dd></div>
      <div><dt>{t("Skipped","Bỏ qua")}</dt><dd>{count.format(totals.skipped)}
        {deferred>0&&<small>{t(`${count.format(deferred)} deferred by media locks`,`${count.format(deferred)} tệp hoãn do khóa`)}</small>}
      </dd></div>
      <div><dt>{t("Failed","Lỗi")}</dt><dd>{count.format(totals.failed)}</dd></div>
      <div><dt>{t("Reclaimed","Dung lượng thu hồi")}</dt><dd>{formatBytes(totals.reclaimedBytes)}
        {totals.unknownSizes>0&&<small>{t(`${totals.unknownSizes} sizes unknown`,`${totals.unknownSizes} tệp chưa rõ dung lượng`)}</small>}
      </dd></div>
      <div><dt>{resumable?t("ETA after resuming","Thời gian sau khi tiếp tục"):t("ETA","Còn khoảng")}</dt>
        <dd>{eta===null?(clock?t("Estimating…","Đang ước tính…"):"—"):duration(Math.ceil(eta/1000))}</dd></div>
    </dl>}
    {details&&<div className="storage-removal-progress__detail" id={detailsId} role="status">
      <p>{details}</p>
      {showIssue&&<dl className="storage-removal-progress__diagnostic">
        {filename&&<div><dt>{t("File","Tệp")}</dt><dd>{filename}</dd></div>}
        <div><dt>{t("Error code","Mã lỗi")}</dt><dd><code>{issueCode}</code></dd></div>
        <div><dt>{t("Retries","Số lần thử lại")}</dt><dd>{affected?.retryCount===undefined?
          t("Unrecorded","Chưa ghi nhận"):count.format(affected.retryCount)}</dd></div>
      </dl>}
    </div>}
    {blocked&&blocked!==details&&<p className="storage-removal-progress__detail" id={`${id}-blocked`}>{blocked}</p>}
    {state==="cancelled"&&!refreshing&&<p className="storage-removal-progress__detail" role="status">
      {t(`${count.format(cancelled)} files released for normal management.`,`Đã trả ${count.format(cancelled)} tệp về quản lý thông thường.`)}
    </p>}
    {!details&&state!=="cancelled"&&<span className="sr-only" role="status">{headings[state]}{totals&&
      t(`. ${processed} of ${total} files processed`,`. Đã xử lý ${processed}/${total} tệp`)}</span>}
    {!clock&&!reconciling&&!refreshing&&currentRun&&totals&&(totals.skipped>0||totals.failed>0)&&<details>
      <summary>{t("Skipped and failed files","Tệp bỏ qua và lỗi")}</summary>
      <ul className="storage-media-rows">{currentRun.entries.filter(item=>item.outcome==="skipped"||item.outcome==="failed").map(item=><li key={item.id}>
        <strong>{item.name.split("/").at(-1)}</strong><span>{describeReason(item.reason)}
          {item.reason==="media_lock_deferred"&&<small>
            <code>media_busy</code> · {t(`${count.format(item.retryCount??0)} retries`,`${count.format(item.retryCount??0)} lần thử lại`)}
          </small>}
        </span>
      </li>)}</ul>
    </details>}
  </section>;
}
