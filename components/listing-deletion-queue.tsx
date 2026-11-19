"use client";

import { useState } from "react";
import type { ListingDeletion } from "@/lib/property-deletion-server";
import { useSite } from "./site-context";

export function listingDeletionRequest<T>(editorTask: ReturnType<typeof useSite>["editorTask"], payload: Record<string, unknown>) {
  return editorTask(async (db,signal)=>{
    const {data}=await db.auth.getSession();
    if (!data.session?.access_token) throw new Error("session_expired");
    const response=await fetch("/api/admin/property-deletions",{
      method:"POST",signal,headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},
      body:JSON.stringify(payload),
    });
    const result=await response.json().catch(()=>null);
    if (!response.ok || !result) throw new Error(typeof result==="object" && result && "error" in result && typeof result.error==="string" ? result.error : "unavailable");
    return result as T;
  },50000);
}

export function listingDeletionMessage(error: unknown,t: ReturnType<typeof useSite>["t"]) {
  switch (error instanceof Error ? error.message : "") {
    case "media_busy": return t("A listing or upload is being updated. Try again shortly.","Tin đăng hoặc tệp đang được cập nhật. Vui lòng thử lại sau.");
    case "rename_pending": return t("Finish the pending photo rename before deleting this listing.","Hãy hoàn tất việc đổi tên ảnh đang chờ trước khi xóa tin đăng.");
    case "stale": return t("This listing changed. Refresh it and review the changes before deleting.","Tin đăng đã thay đổi. Làm mới và kiểm tra các thay đổi trước khi xóa.");
    case "migration_required": return t("The listing cleanup database update is required.","Cần cập nhật cơ sở dữ liệu để dọn tệp của tin đăng.");
    case "forbidden": return t("An active Home Admin or Owner can permanently delete listings.","Cần quyền Quản trị viên hoặc Chủ sở hữu Gary Home đang hoạt động để xóa vĩnh viễn.");
    case "session_expired": return t("Sign in again to continue.","Đăng nhập lại để tiếp tục.");
    default: return t("The operation could not be confirmed. Refresh the listings and check media cleanup before trying again.","Chưa xác nhận được thao tác. Làm mới tin đăng và kiểm tra mục dọn tệp trước khi thử lại.");
  }
}

function needsWork(job: ListingDeletion) { return job.pending>0||job.review>0; }

export function ListingDeletionQueue({latest}: {latest: ListingDeletion | null}) {
  const {editorTask,t,notice}=useSite();
  const [jobs,setJobs]=useState<ListingDeletion[]|null>(null),[seen,setSeen]=useState(latest);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const rows=latest && latest!==seen ? [latest,...(jobs||[]).filter(job=>job.propertyId!==latest.propertyId)] : jobs;

  async function load() {
    setBusy(true);setError("");
    try { setJobs((await listingDeletionRequest<{jobs:ListingDeletion[]}>(editorTask,{action:"queue"})).jobs);setSeen(latest); }
    catch(error){setError(listingDeletionMessage(error,t));}
    finally{setBusy(false);}
  }
  async function retry(propertyId:string) {
    setBusy(true);setError("");
    try {
      const job=await listingDeletionRequest<ListingDeletion>(editorTask,{action:"retry",propertyId});
      setJobs([job,...(rows||[]).filter(item=>item.propertyId!==propertyId)]);setSeen(latest);
      if(needsWork(job))notice(t("Media cleanup still needs attention.","Việc dọn tệp vẫn cần xử lý."),"warning");
      else notice(t("Listing media cleanup confirmed.","Đã xác nhận dọn tệp của tin đăng."));
    } catch(error){setError(listingDeletionMessage(error,t));}
    finally{setBusy(false);}
  }
  const pending=rows?.filter(needsWork);
  return <details className="admin-panel listing-deletion-queue" onToggle={event=>{if(event.currentTarget.open&&!busy)void load();}}>
    <summary>{t("Listing media cleanup","Dọn tệp của tin đăng")}{pending?.length ? ` (${pending.length})` : ""}</summary>
    <button type="button" className="text-link" disabled={busy} onClick={()=>void load()}>{t("Refresh status","Làm mới trạng thái")}</button>
    {!!pending?.length&&<ul>{pending.map(job=><li key={job.propertyId}>
      <strong>{job.listingCode||job.propertyId}</strong> {t(`${job.pending} pending · ${job.review} for review`,`${job.pending} đang chờ · ${job.review} cần kiểm tra`)}{" "}
      {job.pending>0&&<button className="text-link" type="button" disabled={busy} onClick={()=>void retry(job.propertyId)}>{t("Retry cleanup","Thử dọn tệp lại")}</button>}
    </li>)}</ul>}
    {pending?.length===0&&<p>{t("No listing media needs cleanup.","Không có tệp tin đăng nào cần xử lý.")}</p>}
    {busy&&<p role="status">{t("Checking media cleanup…","Đang kiểm tra việc dọn tệp…")}</p>}
    {error&&<p role="alert">{error}</p>}
  </details>;
}
