"use client";

import { useEffect, useState } from "react";
import { PROPERTY_IMAGE_ORIGIN } from "@/lib/property-photo-files";
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
    case "stale": case "conflict": case "manifest_changed":
      return t("This listing or its media changed. Refresh and review the current information before deleting.","Tin đăng hoặc tệp đã thay đổi. Làm mới và kiểm tra thông tin hiện tại trước khi xóa.");
    case "migration_required": return t("The listing cleanup database update is required.","Cần cập nhật cơ sở dữ liệu để dọn tệp của tin đăng.");
    case "forbidden": return t("An active Home Admin or Owner can permanently delete listings.","Cần quyền Quản trị viên hoặc Chủ sở hữu Gary Home đang hoạt động để xóa vĩnh viễn.");
    case "session_expired": return t("Sign in again to continue.","Đăng nhập lại để tiếp tục.");
    default: return t("The operation could not be confirmed. Refresh the listings and check media cleanup before trying again.","Chưa xác nhận được thao tác. Làm mới tin đăng và kiểm tra mục dọn tệp trước khi thử lại.");
  }
}

type MediaItem = {
  id:string; name:string; bucket:"property-media"|"listing-videos";
  state:"candidate"|"trashed"|"deleting"|"removed"|"restored"|"retained"|"review";
  expires_at:string|null; removed_at:string|null; hold_reason?:string|null;
  restore_mode:"listing"|"draft"|"rename"|"file"|"unavailable";
};
type MediaRun = {started_at:string; finished_at:string|null; attempted:number; removed:number; failed:number};
type MediaReport = {
  objects:number; bytes:number; candidates:number; candidateBytes:number; broken:number;
  activeUploads:number; abandoned:number; trashed:number; overdue:number;
  enabled:boolean; lastScanAt:string|null; checkedAt:string; newlyTrashed:number;
  totalItems:number; items:MediaItem[]; runs:MediaRun[];
};
const pageSize=30;

function mediaRequest<T>(editorTask: ReturnType<typeof useSite>["editorTask"], payload:Record<string,unknown>) {
  return editorTask(async(db,signal)=>{
    const {data}=await db.auth.getSession();
    if(!data.session?.access_token)throw new Error("session_expired");
    const response=await fetch("/api/admin/storage-media",{
      method:"POST",signal,headers:{"Content-Type":"application/json",Authorization:"Bearer "+data.session.access_token},
      body:JSON.stringify(payload),
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw new Error(typeof result==="object"&&result&&"error" in result&&typeof result.error==="string"?result.error:"unavailable");
    return result as T;
  },59000);
}

function restoreReason(item:MediaItem,now:number,t:ReturnType<typeof useSite>["t"]) {
  if(item.state==="removed")return t("This file was permanently deleted and can no longer be restored.","Tệp đã bị xóa vĩnh viễn và không thể khôi phục.");
  if(item.state==="restored")return t("This file has already been restored.","Tệp này đã được khôi phục.");
  if(item.state==="retained")return item.hold_reason==="reference"
    ?t("A saved reference still uses this file.","Tệp này vẫn đang được sử dụng bởi một tham chiếu đã lưu.")
    :t("The file was retained because upload ownership or dependencies need review.","Tệp được giữ lại để kiểm tra quyền sở hữu hoặc các tham chiếu.");
  if(item.state==="review")return t("The file needs review before its state can be confirmed.","Cần kiểm tra để xác nhận trạng thái của tệp.");
  if(item.state==="deleting")return t("Permanent removal is in progress.","Tệp đang được xóa vĩnh viễn.");
  if(!item.expires_at||Date.parse(item.expires_at)<=now)
    return t("The 48-hour restore window ended. Permanent removal is pending.","Đã hết 48 giờ khôi phục. Tệp đang chờ xóa vĩnh viễn.");
  if(item.restore_mode==="unavailable")return t("The saved listing details needed to restore this file are unavailable.",
    "Thiếu dữ liệu tin đăng đã lưu cần thiết để khôi phục tệp này.");
  return "";
}

export function StorageMediaManagement({latest,onListingRestored}: {latest:ListingDeletion|null;onListingRestored:()=>void}) {
  const {editorTask,language,t,notice}=useSite();
  const [report,setReport]=useState<MediaReport|null>(null),[offset,setOffset]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now);
  const [seen,setSeen]=useState(latest);
  const locale=language==="vi"?"vi-VN":"en";
  const formatCount=(value:number)=>new Intl.NumberFormat(locale).format(value);
  const formatTime=(value:string|null)=>value?new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"—";
  const formatBytes=(value:number)=>new Intl.NumberFormat(locale,{style:"unit",unit:"megabyte",maximumFractionDigits:2}).format(value/1_000_000);
  const nextExpiry=Math.min(...(report?.items||[]).filter(item=>(item.state==="trashed"||item.state==="candidate")&&item.expires_at)
    .map(item=>Date.parse(item.expires_at!)).filter(expiry=>expiry>now));

  useEffect(()=>{
    if(!Number.isFinite(nextExpiry))return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.max(1,nextExpiry-Date.now()+2));
    return ()=>clearTimeout(timer);
  },[nextExpiry]);

  async function manage(action:"status"|"scan"|"trash"|"run"|"restore"|"purge",item?:MediaItem,nextOffset=offset) {
    if(busy)return;
    if(action==="trash"&&!window.confirm(t("Move verified orphans to Trash? Each file can be restored for 48 hours.",
      "Chuyển các tệp thừa đã xác minh vào Thùng rác? Có thể khôi phục từng tệp trong 48 giờ.")))return;
    if(action==="run"&&!window.confirm(t("Permanently remove eligible files whose restore window has ended?",
      "Xóa vĩnh viễn các tệp đủ điều kiện đã hết thời gian khôi phục?")))return;
    if(action==="restore"&&item?.restore_mode==="draft"&&!window.confirm(t("Restore this file to a new draft of the deleted listing?",
      "Khôi phục tệp này vào bản nháp mới của tin đăng đã xóa?")))return;
    if(action==="purge"&&(!item?.expires_at||!report?.enabled||!window.confirm(t(
      `Permanently delete ${item.name.split("/").at(-1)} now and end its restore window?`,
      `Xóa vĩnh viễn ${item.name.split("/").at(-1)} ngay và kết thúc thời gian khôi phục?`))))return;
    setBusy(true);setError("");
    try {
      if(action==="restore") {
        const result=await mediaRequest<{id:string;restored:boolean;listingId:string|null}>(editorTask,{action,id:item?.id});
        if(result.id!==item?.id||!result.restored)throw new Error("unavailable");
        setReport(current=>current&&({...current,items:current.items.map(row=>row.id===result.id?{...row,state:"restored"}:row)}));
        if(result.listingId) {
          onListingRestored();
          notice(t("Listing media and metadata restored.","Đã khôi phục tệp và siêu dữ liệu của tin đăng."));
        } else notice(t("File kept in Storage.","Đã giữ tệp trong kho lưu trữ."));
      }
      if(action==="run"||action==="purge") {
        const result=await mediaRequest<{status:string;removed?:number;overdue?:number}>(editorTask,action==="purge"?
          {action,id:item?.id,expiresAt:item?.expires_at,confirm:true}:{action});
        if(result.status==="disabled")throw new Error("cleanup_disabled");
        if(result.status==="busy")throw new Error("media_busy");
        if(result.status!=="ok")throw new Error("unavailable");
        notice(t(`Confirmed permanent removals: ${result.removed||0}.`,`Đã xác nhận xóa vĩnh viễn ${result.removed||0} tệp.`),
          result.overdue?"warning":undefined);
      }
      const fresh=await mediaRequest<MediaReport>(editorTask,{
        action:action==="run"||action==="purge"||action==="restore"?"status":action,offset:nextOffset,
      });
      setReport(fresh);setOffset(nextOffset);setNow(Date.now());setSeen(latest);
      if(action==="scan")notice(t("Storage scan complete.","Đã quét xong kho lưu trữ."));
      if(action==="trash")notice(t(`Moved ${fresh.newlyTrashed} verified files to Trash.`,`Đã chuyển ${fresh.newlyTrashed} tệp đã xác minh vào Thùng rác.`));
    } catch(issue) {
      const code=issue instanceof Error?issue.message:"";
      const message=code==="restore_unavailable"?t("Restore is unavailable. Refresh to check the current file status.","Không thể khôi phục. Làm mới để kiểm tra trạng thái hiện tại của tệp."):
        code==="restore_snapshot_missing"?t("The original listing details needed for restore are unavailable.","Thiếu dữ liệu của tin đăng gốc cần thiết để khôi phục."):
        code==="restore_conflict"?t("The listing media changed. Review the current listing before restoring this file.","Tệp tin đăng đã thay đổi. Kiểm tra tin đăng hiện tại trước khi khôi phục."):
        code==="purge_unavailable"||code==="purge_unconfirmed"?t("Permanent deletion could not be confirmed. Refresh to review the current file status.","Chưa xác nhận được việc xóa vĩnh viễn. Làm mới để xem trạng thái hiện tại của tệp."):
        code==="cleanup_disabled"?t("Permanent cleanup is paused.","Đang tạm dừng xóa vĩnh viễn."):
        code==="forbidden"?t("This panel requires the active Gary Home Owner.","Mục này yêu cầu tài khoản Chủ sở hữu Gary Home đang hoạt động."):
        listingDeletionMessage(issue,t);
      setError(message);
      if(action==="restore"||action==="run"||action==="trash"||action==="purge")notice(message,"warning");
    } finally {setBusy(false);}
  }

  return <details className="admin-panel listing-deletion-queue storage-media" onToggle={event=>{
    if(event.currentTarget.open&&!report&&!busy)void manage("status");
  }}>
    <summary>{t("Storage & Media Management","Quản lý kho lưu trữ và tệp")}</summary>
    <div className="storage-media-body">
      {report&&<>
        <dl className="storage-media-stats">
          <div><dt>{t("Storage objects","Số tệp lưu trữ")}</dt><dd>{formatCount(report.objects)}</dd></div>
          <div><dt>{t("Listing media storage","Dung lượng tệp tin đăng")}</dt><dd>{formatBytes(report.bytes)}</dd></div>
          <div><dt>{t("Potential orphans","Tệp có thể bị bỏ lại")}</dt><dd>{formatCount(report.candidates)}</dd></div>
          <div><dt>{t("Potentially recoverable","Dung lượng có thể thu hồi")}</dt><dd>{formatBytes(report.candidateBytes)}</dd></div>
        </dl>
        <p>{t("Last scan","Lần quét gần nhất")} <strong>{formatTime(report.lastScanAt)}</strong> · {t("Inventory checked","Đã kiểm tra kho")} <strong>{formatTime(report.checkedAt)}</strong></p>
        <p>{t("Coverage includes listing photo and video buckets, saved listing states, editorial links and the existing media ledgers.",
          "Phạm vi gồm kho ảnh và video tin đăng, các trạng thái tin đăng đã lưu, liên kết biên tập và sổ theo dõi tệp hiện có.")}</p>
        <p>{t("Active upload leases","Lượt tải lên đang được bảo vệ")} <strong>{report.activeUploads}</strong> · {t("Verified abandoned uploads","Lượt tải bị bỏ dở đã xác minh")} <strong>{report.abandoned}</strong> · {t("Broken indexed links","Liên kết tệp bị hỏng")} <strong>{report.broken}</strong></p>
        <p>{report.enabled?t("Hourly cleanup follows the 48-hour restore window.","Hệ thống dọn tệp mỗi giờ sau thời gian khôi phục 48 giờ."):
          t("Permanent cleanup is paused. Files in Trash have a 48-hour restore window.","Đang tạm dừng xóa vĩnh viễn. Tệp trong Thùng rác có thể khôi phục trong 48 giờ.")}{" "}
          {!!report.overdue&&<strong role="status">{t(`${report.overdue} files need attention.`,`${report.overdue} tệp cần xử lý.`)}</strong>}</p>
      </>}
      {latest&&latest!==seen&&<p>{t("Refresh to see files from the most recent listing deletion.","Làm mới để xem tệp của tin đăng vừa xóa.")}</p>}
      <div className="storage-media-actions">
        <button type="button" className="button button-outline" disabled={busy} onClick={()=>void manage("scan",undefined,0)}>{t("Run storage scan","Quét kho lưu trữ")}</button>
        <button type="button" className="button button-outline" disabled={busy||!report?.lastScanAt} onClick={()=>void manage("trash",undefined,0)}>{t("Move verified orphans to Trash","Chuyển tệp thừa đã xác minh vào Thùng rác")}</button>
        <span title={!report?.enabled?t("Permanent cleanup is paused.","Đang tạm dừng xóa vĩnh viễn."):undefined}>
          <button data-button-variant="danger" type="button" className="button button-outline" disabled={busy||!report?.enabled||!report.overdue}
            onClick={()=>void manage("run")}>{t("Run permanent cleanup","Xóa vĩnh viễn tệp hết hạn")}</button>
        </span>
      </div>
      {busy&&<p role="status">{t("Checking storage…","Đang kiểm tra kho lưu trữ…")}</p>}
      {error&&<p role="alert">{error}</p>}
      {report&&<>
        <h3>{t("File Trash","Thùng rác tệp")}</h3>
        {report.items.length===0&&<p>{t("No files in the cleanup history.","Chưa có tệp trong lịch sử dọn dẹp.")}</p>}
        <ul className="storage-media-rows">{report.items.map(item=>{
          const reason=restoreReason(item,now,t), hint="media-restore-"+item.id;
          const canPurge=report.enabled&&(item.state==="candidate"||item.state==="trashed")&&item.expires_at&&Date.parse(item.expires_at)>now;
          return <li key={item.id}>
            <div><strong>{item.name.split("/").at(-1)}</strong>
              <small>{item.bucket} · {item.removed_at?t("Removed","Đã xóa"):t("Restore until","Khôi phục đến")} {formatTime(item.removed_at||item.expires_at)}</small>
              {reason&&<small id={hint}>{reason}</small>}
              {item.state==="restored"&&<a className="text-link" target="_blank" rel="noopener noreferrer"
                href={PROPERTY_IMAGE_ORIGIN+"/storage/v1/object/public/"+item.bucket+"/"+item.name.split("/").map(encodeURIComponent).join("/")}>
                {t("Open restored file","Mở tệp đã khôi phục")}</a>}
            </div>
            <div className="storage-media-actions">
              <span title={reason||undefined} tabIndex={reason?0:undefined} aria-describedby={reason?hint:undefined}>
                <button type="button" className="button button-outline button-small" data-button-variant="restore"
                  disabled={busy||Boolean(reason)} aria-describedby={reason?hint:undefined}
                  onClick={()=>void manage("restore",item)}>{item.restore_mode==="file"?t("Keep file","Giữ tệp"):t("Restore","Khôi phục")}</button>
              </span>
              {canPurge&&<button type="button" className="button button-outline button-small" data-button-variant="danger"
                disabled={busy} onClick={()=>void manage("purge",item)}>{t("Permanently delete now","Xóa vĩnh viễn ngay")}</button>}
            </div>
          </li>;
        })}</ul>
        {report.totalItems>pageSize&&<nav className="storage-media-actions" aria-label={t("File Trash pages","Trang Thùng rác tệp")}>
          <button className="text-link" type="button" disabled={busy||offset===0} onClick={()=>void manage("status",undefined,offset-pageSize)}>{t("Previous","Trước")}</button>
          <span>{Math.floor(offset/pageSize)+1} / {Math.ceil(report.totalItems/pageSize)}</span>
          <button className="text-link" type="button" disabled={busy||offset+pageSize>=report.totalItems} onClick={()=>void manage("status",undefined,offset+pageSize)}>{t("Next","Tiếp")}</button>
        </nav>}
        <h3>{t("Recent cleanup runs","Các lần dọn tệp gần đây")}</h3>
        {report.runs.length===0&&<p>{t("No cleanup runs recorded.","Chưa có lần dọn tệp nào được ghi nhận.")}</p>}
        <ul className="storage-media-rows">{report.runs.map(run=><li key={run.started_at}>
          <time dateTime={run.started_at}>{formatTime(run.started_at)}</time>
          <span>{run.finished_at?t(`${run.removed} removed · ${run.failed} failed`,`${run.removed} đã xóa · ${run.failed} lỗi`):
            t("Awaiting confirmation","Đang chờ xác nhận")}</span>
        </li>)}</ul>
      </>}
    </div>
  </details>;
}
