"use client";

import { useEffect, useState } from "react";
import { LISTING_UPLOAD_IDLE_MS, type ListingUploadProgress } from "@/lib/listing-file-upload";
import type { PropertyImageUploadProgress } from "@/lib/property-image-upload";
import Counter from "./react-bits/counter";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

function useUploadTiming(progress: ListingUploadProgress | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const active = !!progress;
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [active]);
  const elapsed = Math.max(0, Math.floor((now - (progress?.startedAt ?? now)) / 1000));
  const idle = Math.max(0, now - (progress?.lastActivityAt ?? now));
  const remaining = Math.max(0, Math.ceil((LISTING_UPLOAD_IDLE_MS - idle) / 1000));
  return { elapsed, idle, remaining };
}

export function ListingUploadStatus({ progress, filename, cancel }: { progress: ListingUploadProgress; filename: string; cancel: () => void }) {
  const text = useStudioText();
  const { elapsed, idle, remaining } = useUploadTiming(progress);
  return <div className="listing-upload-status">
    <div className="listing-upload-metrics" aria-live="off">
      <div><span>{text("Upload progress")}</span><Counter value={progress.percent} fontSize={32} fontWeight={600} suffix="%" intro={false}/></div>
      <div><span>{text("Elapsed time")}</span><Counter value={elapsed} fontSize={24} fontWeight={600} suffix={` ${text("seconds")}`} intro={false}/></div>
      <button className="button button-outline button-small" type="button" onClick={cancel}>{text("Cancel upload")}</button>
    </div>
    <progress max={100} value={progress.percent} aria-label={text("Upload progress for {filename}", { filename })}/>
    <p className="small muted">{text(progress.retrying ? "Connection interrupted. Resuming upload…" : "Uploads can continue beyond 120 seconds while making progress.")}</p>
    {idle >= 15000 && <p className="upload-idle-note" aria-live="off">{text("Waiting for progress. Retry becomes available in")} <Counter value={remaining} fontSize={18} fontWeight={600} intro={false}/> {text("seconds")}</p>}
  </div>;
}

export type ListingPhotoUploadProgress = PropertyImageUploadProgress | { phase: "done" } | { phase: "error"; percent?: number };

export function ListingPhotoUploadStatus({ progress, filename, cancel }: {
  progress: ListingPhotoUploadProgress; filename: string; cancel: () => void;
}) {
  const text = useStudioText();
  const { t } = useSite();
  const { phase } = progress;
  const transfer = phase === "uploading" ? progress : undefined;
  const { elapsed, idle, remaining } = useUploadTiming(transfer);
  const percent = phase === "done" ? 100 : phase === "uploading" || phase === "error" ? progress.percent : undefined;
  const hasProgress = phase !== "error" || percent !== undefined;
  const label = {
    preparing: t(`Preparing upload for ${filename}…`, `Đang chuẩn bị tải ảnh ${filename}…`),
    optimizing: t(`Optimizing ${filename}…`, `Đang tối ưu ảnh ${filename}…`),
    uploading: text("Uploading {filename}", { filename }),
    done: t(`Uploaded ${filename}`, `Đã tải ảnh ${filename} lên`),
    error: t(`Couldn’t upload ${filename}`, `Không thể tải ảnh ${filename} lên`),
  }[phase];

  return <div className="listing-upload-status listing-photo-upload" data-phase={phase}>
    <div className="listing-photo-upload-row">
      <p role="status">{label}</p>
      {percent !== undefined && <span className="listing-photo-upload-percent" aria-hidden="true">{percent}%</span>}
      {transfer && <span className="small muted">{text("Elapsed time")} · {elapsed} {text("seconds")}</span>}
      {phase !== "done" && phase !== "error" && <button className="button button-outline button-small" type="button" onClick={cancel}>{text("Cancel upload")}</button>}
    </div>
    <div className="listing-photo-upload-bar" role={hasProgress ? "progressbar" : undefined} aria-hidden={hasProgress ? undefined : true}
      aria-label={hasProgress ? text("Upload progress for {filename}", { filename }) : undefined} aria-valuenow={percent}>
      <span style={{ transform: `scaleX(${(percent ?? 0) / 100})` }}/>
    </div>
    {transfer && <p className="small muted" role="status">{text(transfer.retrying ? "Connection interrupted. Resuming upload…" : "Uploads can continue beyond 120 seconds while making progress.")}</p>}
    {idle >= 15000 && <p className="upload-idle-note" aria-live="off">{text("Waiting for progress. Retry becomes available in")} {remaining} {text("seconds")}</p>}
  </div>;
}
