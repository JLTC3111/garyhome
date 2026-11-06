"use client";

import { useEffect, useState } from "react";
import { LISTING_UPLOAD_IDLE_MS, type ListingUploadProgress } from "@/lib/listing-file-upload";
import Counter from "./react-bits/counter";
import { useStudioText } from "./use-studio-text";

export function ListingUploadStatus({ progress, filename, cancel }: { progress: ListingUploadProgress; filename: string; cancel: () => void }) {
  const text = useStudioText(), [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const elapsed = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const idle = Math.max(0, now - progress.lastActivityAt);
  const remaining = Math.max(0, Math.ceil((LISTING_UPLOAD_IDLE_MS - idle) / 1000));
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
