"use client";

import { useEffect, useId, useRef, useState } from "react";
import { trashRunEta, trashRunTiming, trashRunTotals, type TrashRun, type TrashRunClock } from "@/lib/home-media-trash";
import { useSite } from "./site-context";

function duration(seconds:number) {
  const hours=Math.floor(seconds/3600);
  const minutes=Math.floor(seconds%3600/60);
  const remainder=String(seconds%60).padStart(2,"0");
  return hours>0?`${hours}:${String(minutes).padStart(2,"0")}:${remainder}`:`${String(minutes).padStart(2,"0")}:${remainder}`;
}

export function MediaRemovalProgress({run,clock,preparing,visible,stopping,resumeReason,message,formatBytes,describeReason,onStop,onResume}: {
  run:TrashRun|null;clock:TrashRunClock|null;preparing:boolean;visible:boolean;stopping:boolean;
  resumeReason:string;message:string;formatBytes:(bytes:number)=>string;describeReason:(code?:string)=>string;
  onStop:()=>void;onResume:()=>void;
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
    if(preparing&&visible)panel.current?.focus();
  },[preparing,visible]);

  if(!preparing&&!run)return null;
  const currentRun=preparing?null:run;
  const totals=currentRun?trashRunTotals(currentRun):null;
  const total=currentRun?.entries.length??0;
  const remaining=totals?.pending??0;
  const processed=total-remaining;
  const timing=clock?trashRunTiming(clock,processed,now):currentRun?.timing;
  const eta=clock||!remaining?trashRunEta(remaining,timing):null;
  const current=clock?currentRun?.entries.find(item=>item.outcome==="sent"):null;
  const filename=current?.name.split("/").at(-1)||current?.name;
  const count=new Intl.NumberFormat(language==="vi"?"vi-VN":"en");
  const heading=preparing?t("Preparing removal","Đang chuẩn bị xóa"):clock?
    remaining?t("Removing files","Đang xóa tệp"):t("Finishing removal","Đang hoàn tất lượt xóa"):
    remaining?t("Removal paused","Đã tạm dừng xóa"):t("Removal complete","Đã hoàn tất lượt xóa");
  const pauseReason=!clock&&remaining&&timing?.pauseReason!=="stopped"&&timing?.pauseReason?describeReason(timing.pauseReason):"";
  const blocked=!clock&&remaining?resumeReason:"";

  return <section ref={panel} tabIndex={-1} className="storage-removal-progress" aria-labelledby={`${id}-title`}>
    <header className="storage-removal-progress__header">
      <h3 id={`${id}-title`}>{heading}</h3>
      {clock&&remaining>0&&<button type="button" className="button button-outline button-small" disabled={stopping} onClick={onStop}>
        {stopping?t("Stopping after the current file…","Sẽ dừng sau tệp hiện tại…"):t("Stop after the current file","Dừng sau tệp hiện tại")}
      </button>}
      {!preparing&&!clock&&remaining>0&&<button type="button" className="button button-outline button-small" disabled={!!blocked}
        aria-describedby={blocked?`${id}-blocked`:undefined} title={blocked||undefined} onClick={onResume}>
        {t("Resume permanent removal","Tiếp tục xóa vĩnh viễn")}
      </button>}
    </header>
    <div className="storage-removal-progress__track" role="progressbar" aria-label={t("Files processed","Tệp đã xử lý")}
      aria-valuemin={totals?0:undefined} aria-valuemax={totals?total:undefined} aria-valuenow={totals?processed:undefined}
      data-indeterminate={preparing} data-running={!!clock}>
      <div className="storage-removal-progress__fill" style={total?{width:`${processed/total*100}%`}:undefined}/>
    </div>
    {!!clock&&<p className="storage-removal-progress__current">{filename?<>
      <span>{t("Current file","Tệp hiện tại")}</span><strong title={filename}>{filename}</strong>
    </>:remaining?t("Preparing the next file…","Đang chuẩn bị tệp tiếp theo…"):t("Refreshing inventory…","Đang làm mới kho…")}</p>}
    {totals&&<dl className="storage-removal-progress__metrics">
      <div><dt>{t("Processed","Đã xử lý")}</dt><dd>{count.format(processed)} / {count.format(total)}</dd></div>
      <div><dt>{t("Remaining","Còn lại")}</dt><dd>{count.format(remaining)}</dd></div>
      <div><dt>{t("Removed","Đã xóa")}</dt><dd>{count.format(totals.removed)}</dd></div>
      <div><dt>{t("Skipped","Bỏ qua")}</dt><dd>{count.format(totals.skipped)}</dd></div>
      <div><dt>{t("Failed","Lỗi")}</dt><dd>{count.format(totals.failed)}</dd></div>
      <div><dt>{t("Reclaimed","Dung lượng thu hồi")}</dt><dd>{formatBytes(totals.reclaimedBytes)}
        {totals.unknownSizes>0&&<small>{t(`${totals.unknownSizes} sizes unknown`,`${totals.unknownSizes} tệp chưa rõ dung lượng`)}</small>}
      </dd></div>
      <div><dt>{t("Elapsed","Đã chạy")}</dt><dd>{timing?duration(Math.floor(timing.elapsedMs/1000)):"—"}</dd></div>
      <div><dt>{t("ETA","Còn khoảng")}</dt><dd>{eta===null?(clock?t("Estimating…","Đang ước tính…"):"—"):duration(Math.ceil(eta/1000))}</dd></div>
    </dl>}
    <span className="sr-only" role="status">{totals?t(`${processed} of ${total} files processed`, `Đã xử lý ${processed}/${total} tệp`):heading}</span>
    {blocked&&<p id={`${id}-blocked`}>{blocked}</p>}
    {pauseReason&&pauseReason!==blocked&&<p>{pauseReason}</p>}
    {message&&<p role="alert">{message}</p>}
    {!clock&&currentRun&&totals&&(totals.skipped>0||totals.failed>0)&&<details>
      <summary>{t("Skipped and failed files","Tệp bỏ qua và lỗi")}</summary>
      <ul className="storage-media-rows">{currentRun.entries.filter(item=>item.outcome==="skipped"||item.outcome==="failed").map(item=><li key={item.id}>
        <strong>{item.name.split("/").at(-1)}</strong><span>{describeReason(item.reason)}</span>
      </li>)}</ul>
    </details>}
  </section>;
}
