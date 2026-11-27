"use client";

import { useEffect, useId, useRef, useState } from "react";
import { trashRunEta, trashRunIssueCode, trashRunTiming, trashRunTotals, type TrashOperationState, type TrashRun, type TrashRunClock } from "@/lib/home-media-trash";
import { useSite } from "./site-context";

function duration(seconds:number) {
  const hours=Math.floor(seconds/3600);
  const minutes=Math.floor(seconds%3600/60);
  const remainder=String(seconds%60).padStart(2,"0");
  return hours>0?`${hours}:${String(minutes).padStart(2,"0")}:${remainder}`:`${String(minutes).padStart(2,"0")}:${remainder}`;
}

export function MediaRemovalProgress({
  run,state,clock,preparing,visible,reconciling,refreshing,actionsBusy,detailsId,resumeReason,message,formatBytes,describeReason,onStop,onResume,onCancel,
}: {
  run:TrashRun|null;state:TrashOperationState;clock:TrashRunClock|null;preparing:boolean;visible:boolean;
  reconciling:boolean;refreshing:boolean;actionsBusy:boolean;detailsId:string;resumeReason:string;message:string;
  formatBytes:(bytes:number)=>string;describeReason:(code?:string)=>string;onStop:()=>void;onResume:()=>void;onCancel:()=>void;
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
  const resumable=remaining>0&&(state==="paused"||state==="failed");
  const timing=clock?trashRunTiming(clock,processed,now):currentRun?.timing;
  const eta=state==="cancelled"?null:trashRunEta(remaining,timing);
  const current=currentRun?.entries.find(item=>item.outcome==="sent");
  const issueCode=currentRun?.issue&&currentRun.issue!=="stopped"?trashRunIssueCode(currentRun.issue):null;
  const waitingForLock=state==="running"&&issueCode==="media_busy";
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
  const details=reconciling?t("Checking the last deletion receipt before releasing the remaining files…","Đang kiểm tra biên nhận xóa cuối trước khi giải phóng các tệp còn lại…"):
    message||issue||(refreshing?t("Refreshing inventory and Cleanup History…","Đang làm mới kho và Lịch sử dọn tệp…"):
      blocked||(resumable?t("Resume this run or cancel the remaining files to start another removal.",
        "Tiếp tục lượt này hoặc hủy các tệp còn lại để bắt đầu lượt xóa khác."):""));
  const cancelled=totals?.cancelled??0;
  const deferred=currentRun?.entries.filter(item=>item.reason==="media_lock_deferred").length??0;

  return <section ref={panel} tabIndex={-1} className="storage-removal-progress" data-state={state} aria-labelledby={`${id}-title`}>
    <header className="storage-removal-progress__header">
      <h3 id={`${id}-title`}>{headings[state]}</h3>
      {state==="running"&&clock&&remaining>0&&<button type="button" className="button button-outline button-small" onClick={onStop}>
        {t("Stop after the current file","Dừng sau tệp hiện tại")}
      </button>}
      {resumable&&!reconciling&&!refreshing&&<div className="storage-media-actions">
        <button type="button" className="button button-small" disabled={actionsBusy||!!blocked}
          aria-describedby={blocked?(blocked===details?detailsId:`${id}-blocked`):undefined} onClick={onResume}>{t("Resume","Tiếp tục")}</button>
        <button type="button" className="button button-outline button-small" disabled={actionsBusy} onClick={onCancel}>
          {t("Cancel remaining","Hủy các tệp còn lại")}
        </button>
      </div>}
    </header>
    {(totals||preparing)&&<div className="storage-removal-progress__track" role="progressbar" aria-label={t("Files processed","Tệp đã xử lý")}
      aria-valuemin={totals?0:undefined} aria-valuemax={totals?total:undefined} aria-valuenow={totals?processed:undefined}
      data-indeterminate={preparing} data-running={!!clock}>
      <div className="storage-removal-progress__fill" style={total?{width:`${processed/total*100}%`}:undefined}/>
    </div>}
    {filename&&!showIssue&&<p className="storage-removal-progress__current">
      <span>{clock?t("Current file","Tệp hiện tại"):t("Last request","Yêu cầu cuối")}</span><strong title={filename}>{filename}</strong>
    </p>}
    {totals&&<dl className="storage-removal-progress__metrics">
      <div><dt>{t("Processed","Đã xử lý")}</dt><dd>{count.format(processed)} / {count.format(total)}</dd></div>
      <div><dt>{t("Remaining","Còn lại")}</dt><dd>{count.format(remaining)}</dd></div>
      <div><dt>{t("Removed","Đã xóa")}</dt><dd>{count.format(totals.removed)}</dd></div>
      <div><dt>{t("Skipped","Bỏ qua")}</dt><dd>{count.format(totals.skipped)}
        {deferred>0&&<small>{t(`${count.format(deferred)} deferred by media locks`,`${count.format(deferred)} tệp hoãn do khóa`)}</small>}
      </dd></div>
      <div><dt>{t("Failed","Lỗi")}</dt><dd>{count.format(totals.failed)}</dd></div>
      <div><dt>{t("Reclaimed","Dung lượng thu hồi")}</dt><dd>{formatBytes(totals.reclaimedBytes)}
        {totals.unknownSizes>0&&<small>{t(`${totals.unknownSizes} sizes unknown`,`${totals.unknownSizes} tệp chưa rõ dung lượng`)}</small>}
      </dd></div>
      <div><dt>{t("Elapsed","Đã chạy")}</dt><dd>{timing?duration(Math.floor(timing.elapsedMs/1000)):"—"}</dd></div>
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
