"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  id:string; name:string; bucket:string; state:"trashed"|"deleting";
  expires_at:string|null; restore_mode:"listing"|"draft"|"rename"|"file"|"unavailable";
};
type InventoryItem = {bucket:string; name:string; bytes:number|null; reason:string};
type RemovedItem = {id:string; bucket:string; name:string; removed_at:string|null; source:string};
type MediaRun = {id:string; started_at:string; finished_at:string|null; attempted:number; removed:number; failed:number};
type MediaReport = {
  panelVersion?:number; objects:number; bytes:number; candidates:number; candidateBytes:number;
  protected?:number; protectedCandidates?:number; unreviewed?:number; checkedQueue?:number;
  readyToTrash?:number; readyBytes?:number; scheduledBytes?:number;
  broken:number; activeUploads:number; abandoned:number; trashed:number; overdue:number;
  enabled:boolean; lastScanAt:string|null; checkedAt:string; newlyTrashed:number; automaticScheduled?:boolean;
};
type PageKind = "inventory_page"|"trash_page"|"removed_page"|"run_page";
type MediaPage = {items:(InventoryItem|MediaItem|RemovedItem|MediaRun)[]; hasMore:boolean; available:boolean};
type MediaAction = "overview"|"inventory_scan"|"trash"|"restore"|"worker_status"|"run"|"purge";
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

function mediaMessage(issue:unknown,t:ReturnType<typeof useSite>["t"]) {
  const code=issue instanceof Error?(issue.name==="RequestTimeoutError"?"inventory_timeout":issue.message):"";
  switch(code){
    case "inventory_timeout": return t("The storage request timed out. Refresh inventory and the relevant list before retrying.","Yêu cầu kho lưu trữ đã quá hạn. Làm mới kho và danh sách liên quan trước khi thử lại.");
    case "inventory_panel_upgrade": return t("Apply the Home media panel pagination migration to enable scans and separate file lists.","Áp dụng bản cập nhật phân trang kho Home để quét và mở các danh sách tệp riêng.");
    case "inventory_rpc_missing": return t("The Home inventory RPC is missing. Ask the operator to check the Home retention migrations.","Thiếu RPC kiểm kê Home. Nhờ người vận hành kiểm tra các bản cập nhật lưu giữ tệp Home.");
    case "scan_required": return t("Complete a storage scan before moving verified files to Trash.","Hoàn tất quét kho trước khi chuyển tệp đã xác minh vào Thùng rác.");
    case "scan_busy": return t("Another storage scan is in progress. Refresh the scan status shortly.","Một lượt quét kho đang chạy. Hãy làm mới trạng thái sau giây lát.");
    case "restore_unavailable": return t("Restore is unavailable. Refresh File Trash to check the current file status.","Không thể khôi phục. Làm mới Thùng rác để kiểm tra trạng thái hiện tại.");
    case "restore_snapshot_missing": return t("The original listing details needed for restore are unavailable.","Thiếu dữ liệu của tin đăng gốc cần thiết để khôi phục.");
    case "restore_conflict": return t("The listing media changed. Review the current listing before restoring this file.","Tệp tin đăng đã thay đổi. Kiểm tra tin hiện tại trước khi khôi phục.");
    case "cleanup_disabled": return t("Permanent cleanup is paused.","Đang tạm dừng xóa vĩnh viễn.");
    case "cleanup_worker_missing": return t("The cleanup worker is missing. Ask the operator to deploy media-orphan-cleanup.","Thiếu tác vụ dọn tệp. Nhờ người vận hành triển khai media-orphan-cleanup.");
    case "cleanup_worker_unavailable": return t("The cleanup worker did not confirm its configuration. Ask the operator to check its deployment and credentials.","Tác vụ dọn tệp chưa xác nhận cấu hình. Nhờ người vận hành kiểm tra bản triển khai và thông tin xác thực.");
    case "cleanup_unconfirmed": case "purge_unavailable": case "purge_unconfirmed": return t("Permanent removal could not be confirmed. Check File Trash and Cleanup History before retrying.","Chưa xác nhận xóa vĩnh viễn. Kiểm tra Thùng rác và Lịch sử dọn tệp trước khi thử lại.");
    case "backend_config": return t("Check the staff deployment’s Home Supabase URL and publishable key.","Kiểm tra URL Supabase và khóa công khai của Home trong bản triển khai nhân viên.");
    case "owner_check_unavailable": return t("Couldn’t verify Owner access. Sign in again or ask the operator to check the staff membership service.","Chưa xác minh được quyền Chủ sở hữu. Đăng nhập lại hoặc nhờ người vận hành kiểm tra dịch vụ phân quyền.");
    case "forbidden": return t("This panel requires the active Gary Home Owner.","Mục này yêu cầu tài khoản Chủ sở hữu Gary Home đang hoạt động.");
    case "inventory_unavailable": case "unavailable": return t("The Home inventory did not respond. Refresh the panel or ask the operator to check the Owner RPC.","Kho Home không phản hồi. Làm mới hoặc nhờ người vận hành kiểm tra RPC của Chủ sở hữu.");
    default:return listingDeletionMessage(issue,t);
  }
}

export function StorageMediaManagement({latest,onListingRestored}: {latest:ListingDeletion|null;onListingRestored:()=>void}) {
  const {editorTask,language,t,notice}=useSite();
  const [report,setReport]=useState<MediaReport|null>(null),[open,setOpen]=useState(false);
  const [selected,setSelected]=useState<PageKind|null>(null),[page,setPage]=useState<MediaPage|null>(null),[offset,setOffset]=useState(0);
  const [busy,setBusy]=useState<MediaAction|PageKind|null>(null),[error,setError]=useState(""),[resultText,setResultText]=useState("");
  const [restoredHref,setRestoredHref]=useState("");
  const [worker,setWorker]=useState<{status:"ready"|"missing"|"unavailable";cronConfigured?:boolean}|null>(null);
  const [now,setNow]=useState(Date.now),[seen,setSeen]=useState(latest);
  const flight=useRef(false),id=useId();
  const locale=language==="vi"?"vi-VN":"en";
  const number=new Intl.NumberFormat(locale);
  const date=new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"});
  const bytes=new Intl.NumberFormat(locale,{style:"unit",unit:"megabyte",maximumFractionDigits:2});
  const formatTime=(value:string|null)=>value?date.format(new Date(value)):"—";
  const formatBytes=(value:number)=>bytes.format(value/1_000_000);
  const upgraded=report?.panelVersion===2;

  useEffect(()=>{
    if(!open||selected!=="trash_page"||!page?.items.length)return;
    const expire=(page.items as MediaItem[]).map(row=>Date.parse(row.expires_at||"")).filter(time=>time>Date.now());
    if(!expire.length)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.min(60_000,Math.max(1,Math.min(...expire)-Date.now()+1)));
    return ()=>clearTimeout(timer);
  },[open,selected,page,now]);

  async function overview() {
    try {return await mediaRequest<MediaReport>(editorTask,{action:"overview"});}
    catch(issue){
      if(!(issue instanceof Error)||issue.message!=="inventory_panel_upgrade")throw issue;
      return mediaRequest<MediaReport>(editorTask,{action:"status"});
    }
  }
  function reportResult(fresh:MediaReport) {setReport(fresh);setSeen(latest);setNow(Date.now());}
  async function work(action:MediaAction|PageKind,operation:()=>Promise<void>) {
    if(flight.current)return;
    flight.current=true;setBusy(action);setError("");
    try{await operation();}
    catch(issue){
      if(action==="worker_status")setWorker({status:issue instanceof Error&&issue.message==="cleanup_worker_missing"?"missing":"unavailable"});
      setError(mediaMessage(issue,t));
    }finally{flight.current=false;setBusy(null);}
  }
  async function loadPage(kind:PageKind,next=0) {
    if(flight.current||!upgraded)return;
    setSelected(kind);setPage(null);setOffset(next);
    await work(kind,async()=>{setPage(await mediaRequest<MediaPage>(editorTask,{action:kind,offset:next}));setNow(Date.now());});
  }
  async function manage(action:MediaAction,item?:MediaItem) {
    if(flight.current)return;
    if(action==="trash"&&!window.confirm(t("Move the verified file to Trash with its existing restore deadline?","Chuyển tệp đã xác minh vào Thùng rác theo thời hạn khôi phục hiện tại?")))return;
    if(action==="run"&&!window.confirm(t("Permanently remove eligible files whose restore window has ended?","Xóa vĩnh viễn các tệp đủ điều kiện đã hết thời gian khôi phục?")))return;
    if(action==="restore"&&item?.restore_mode==="draft"&&!window.confirm(t("Restore this file to a new draft of the deleted listing?","Khôi phục tệp vào bản nháp mới của tin đăng đã xóa?")))return;
    if(action==="purge"&&(!item?.expires_at||!report?.enabled||!window.confirm(t(
      `Permanently delete ${item.name.split("/").at(-1)} and end its restore window?`,
      `Xóa vĩnh viễn ${item.name.split("/").at(-1)} và kết thúc thời gian khôi phục?`))))return;
    await work(action,async()=>{
      if(action==="overview"){reportResult(await overview());return;}
      if(action==="worker_status"){
        const health=await mediaRequest<{status:string;cronConfigured:boolean}>(editorTask,{action});
        if(health.status!=="ok")throw new Error("cleanup_worker_unavailable");
        setWorker({status:"ready",cronConfigured:health.cronConfigured});return;
      }
      let confirmed:string;
      if(action==="inventory_scan"||action==="trash"){
        const fresh=await mediaRequest<MediaReport>(editorTask,{action});
        reportResult(fresh);
        confirmed=action==="inventory_scan"?t("Storage scan complete.","Đã quét xong kho lưu trữ."):
          fresh.newlyTrashed?t("Moved the verified file to Trash.","Đã chuyển tệp đã xác minh vào Thùng rác."):
          t("The file changed or is protected. Scan again to check what can be moved.","Tệp đã thay đổi hoặc được bảo vệ. Quét lại để kiểm tra tệp có thể chuyển.");
      }else if(action==="restore"){
        const result=await mediaRequest<{id:string;restored:boolean;listingId:string|null}>(editorTask,{action,id:item?.id});
        if(result.id!==item?.id||!result.restored)throw new Error("restore_unavailable");
        if(result.listingId)onListingRestored();
        setRestoredHref(PROPERTY_IMAGE_ORIGIN+"/storage/v1/object/public/"+item.bucket+"/"+item.name.split("/").map(encodeURIComponent).join("/"));
        confirmed=result.listingId?t("Listing media and metadata restored.","Đã khôi phục tệp và siêu dữ liệu của tin đăng."):
          t("File kept in Storage.","Đã giữ tệp trong kho lưu trữ.");
      }else{
        const result=await mediaRequest<{status:string;removed?:number;attempted?:number;overdue?:number}>(editorTask,action==="purge"?
          {action,id:item?.id,expiresAt:item?.expires_at,confirm:true}:{action});
        if(result.status==="disabled")throw new Error("cleanup_disabled");
        if(result.status==="busy")throw new Error("media_busy");
        if(result.status!=="ok")throw new Error("cleanup_unconfirmed");
        confirmed=t(`Removed ${result.removed??0} of ${result.attempted??0} attempted files. ${result.overdue??0} overdue.`,
          `Đã xóa ${result.removed??0} trong ${result.attempted??0} tệp đã xử lý. ${result.overdue??0} tệp quá hạn.`);
      }
      if(action!=="restore")setRestoredHref("");
      setResultText(confirmed);notice(confirmed);setPage(null);setOffset(0);
      if(action==="restore"||action==="run"||action==="purge"){
        try{reportResult(await overview());}
        catch{setError(t("The operation was confirmed. Refresh inventory to see the latest totals.","Đã xác nhận thao tác. Làm mới kho để xem số liệu mới nhất."));}
      }
    });
  }

  const paused=t("Permanent cleanup is paused until the affected draft galleries are recovered and verified.","Tạm dừng xóa vĩnh viễn cho đến khi các bộ ảnh nháp bị ảnh hưởng được khôi phục và xác minh.");
  const upgrade=t("Apply the Home media panel pagination migration first.","Áp dụng bản cập nhật phân trang kho Home trước.");
  const progress=busy==="inventory_scan"?t("Scanning storage and checking queued files…","Đang quét kho và kiểm tra tệp trong hàng đợi…"):
    busy?t("Checking storage…","Đang kiểm tra kho lưu trữ…"):"";
  const trashReason=busy?progress:!upgraded?upgrade:!report?.lastScanAt?t("Run a storage scan first.","Hãy quét kho trước."):
    !report.readyToTrash?t("This scan found no verified file to move. Potential files still need review.","Lần quét này chưa tìm thấy tệp đã xác minh để chuyển. Các tệp tiềm năng vẫn cần kiểm tra."):"";
  const workerReason=worker?.status==="missing"?mediaMessage(new Error("cleanup_worker_missing"),t):worker?.status==="unavailable"?
    mediaMessage(new Error("cleanup_worker_unavailable"),t):worker?.status==="ready"?"":t("Check the cleanup worker deployment first.","Kiểm tra bản triển khai tác vụ dọn tệp trước.");
  const removalReason=busy?progress:!report?.enabled?paused:workerReason;
  const runReason=removalReason||(!report?.overdue?t("No queued files are past their restore deadline.","Chưa có tệp nào trong hàng đợi hết hạn khôi phục."):"");
  const tabs:[PageKind,string][]=[["inventory_page",t("Inventory files","Tệp trong kho")],["trash_page",t("File Trash","Thùng rác tệp")],
    ["removed_page",t("Cleanup History","Lịch sử dọn tệp")],["run_page",t("Cleanup runs","Các lượt dọn tệp")]];
  function reasonLabel(reason:string){
    switch(reason){
      case "reference":return t("Protected · saved reference","Được bảo vệ · có tham chiếu đã lưu");
      case "upload":return t("Protected · active upload","Được bảo vệ · đang tải lên");
      case "listing":return t("Protected · saved listing path","Được bảo vệ · thuộc đường dẫn tin đã lưu");
      case "rename":return t("Protected · rename reservation","Được bảo vệ · giữ chỗ đổi tên");
      case "review":return t("Protected · requires review","Được bảo vệ · cần kiểm tra");
      case "verified":return t("Verified for Trash","Đã xác minh để vào Thùng rác");
      case "scheduled":return t("In Trash · awaiting removal","Trong Thùng rác · chờ xóa");
      default:return t("Potential orphan · unreviewed","Tệp có thể bị bỏ lại · chưa kiểm tra");
    }
  }
  function restoreReason(item:MediaItem){
    if(item.state==="deleting")return t("Permanent removal is in progress.","Tệp đang được xóa vĩnh viễn.");
    if(!item.expires_at||Date.parse(item.expires_at)<=now)return t("The 48-hour restore window ended.","Đã hết 48 giờ khôi phục.");
    if(item.restore_mode==="unavailable")return t("The original listing details needed for restore are unavailable.","Thiếu dữ liệu của tin đăng gốc cần thiết để khôi phục.");
    return "";
  }
  function countdown(expiry:string|null){
    const minutes=Math.ceil((Date.parse(expiry||"")-now)/60_000);
    if(!Number.isFinite(minutes)||minutes<=0)return t("Restore window ended","Đã hết thời hạn khôi phục");
    const hours=Math.floor(minutes/60),rest=minutes%60;
    return t(`${hours}h ${rest}m to restore`, `Còn ${hours} giờ ${rest} phút để khôi phục`);
  }

  return <details className="admin-panel listing-deletion-queue storage-media" onToggle={event=>{
    const visible=event.currentTarget.open;setOpen(visible);
    if(visible&&!report&&!flight.current)void manage("overview");
  }}>
    <summary>{t("Storage & Media Management","Quản lý kho lưu trữ và tệp")}</summary>
    <div className="storage-media-body">
      {report&&<>
        <dl className="storage-media-stats">
          <div><dt>{t("Storage objects","Số tệp lưu trữ")}</dt><dd>{number.format(report.objects)}</dd></div>
          <div><dt>{t("Listing media storage","Dung lượng tệp tin đăng")}</dt><dd>{formatBytes(report.bytes)}</dd></div>
          <div><dt>{t("Potential orphans","Tệp có thể bị bỏ lại")}</dt><dd>{number.format(report.candidates)} · {formatBytes(report.candidateBytes)}</dd></div>
          {upgraded&&<>
            <div><dt>{t("Protected files","Tệp được bảo vệ")}</dt><dd>{number.format(report.protected??0)}</dd></div>
            <div><dt>{t("Verified for Trash","Đã xác minh để vào Thùng rác")}</dt><dd>{number.format(report.readyToTrash??0)} · {formatBytes(report.readyBytes??0)}</dd></div>
            <div><dt>{t("In Trash awaiting removal","Trong Thùng rác chờ xóa")}</dt><dd>{number.format(report.trashed)} · {formatBytes(report.scheduledBytes??0)}</dd></div>
          </>}
        </dl>
        {upgraded&&<p>{t("Potential orphan counts include files held for review.","Số tệp có thể bị bỏ lại bao gồm tệp đang giữ để kiểm tra.")} {number.format(report.protectedCandidates??0)} {t("are protected by the scan.","tệp được bảo vệ qua lượt quét.")}</p>}
        <p>{t("Last completed scan","Lần quét hoàn tất gần nhất")} <strong>{report.lastScanAt?formatTime(report.lastScanAt):t("No scan recorded","Chưa ghi nhận lượt quét")}</strong> · {t("Inventory as of","Dữ liệu kho lúc")} <strong>{formatTime(report.checkedAt)}</strong></p>
        {upgraded&&report.lastScanAt&&<p>{t("Queued files checked in this scan","Tệp hàng đợi đã kiểm tra trong lượt này")} <strong>{report.checkedQueue??0}</strong></p>}
        <p>{t("Coverage includes listing photos and videos, saved listing states, editorial links and the media ledgers.",
          "Phạm vi gồm ảnh và video tin đăng, các trạng thái tin đã lưu, liên kết biên tập và sổ theo dõi tệp.")}</p>
        <p>{t("Active upload leases","Lượt tải lên đang được bảo vệ")} <strong>{report.activeUploads}</strong> · {t("Broken indexed links","Liên kết tệp bị hỏng")} <strong>{report.broken}</strong></p>
        <p>{report.enabled?t("Manual permanent cleanup policy enabled.","Chính sách xóa vĩnh viễn thủ công đã bật."):paused}</p>
        <p>{report.automaticScheduled===undefined?upgrade:report.automaticScheduled?
          (report.enabled?t("Automatic cleanup is scheduled.","Đã lập lịch dọn tệp tự động."):t("Automatic cleanup is scheduled and paused by policy.","Đã lập lịch dọn tệp tự động và đang tạm dừng theo chính sách.")):
          t("Automatic cleanup is unscheduled.","Chưa lập lịch dọn tệp tự động.")} {worker?.status==="ready"&&!worker.cronConfigured&&t("The worker’s Cron credential is missing.","Tác vụ dọn tệp thiếu thông tin xác thực Cron.")}</p>
        <p>{workerReason||t("Cleanup worker verified.","Đã xác minh tác vụ dọn tệp.")}</p>
      </>}
      {report&&!upgraded&&<p role="status">{upgrade}</p>}
      {latest&&latest!==seen&&<p>{t("Refresh to see files from the most recent listing deletion.","Làm mới để xem tệp của tin vừa xóa.")}</p>}
      <div className="storage-media-actions">
        <button type="button" className="button button-outline" disabled={!!busy} onClick={()=>void manage("overview")}>{t("Refresh inventory","Làm mới kho")}</button>
        <button type="button" title={!upgraded?upgrade:undefined} className="button button-outline" disabled={!!busy||!upgraded} onClick={()=>void manage("inventory_scan")}>{t("Run storage scan","Quét kho lưu trữ")}</button>
        <button type="button" title={trashReason||undefined} aria-describedby={`${id}-trash`} className="button button-outline" disabled={!!trashReason} onClick={()=>void manage("trash")}>{t("Move verified orphans to Trash","Chuyển tệp thừa đã xác minh vào Thùng rác")}</button>
        <button type="button" className="button button-outline" disabled={!!busy} onClick={()=>void manage("worker_status")}>{t("Check cleanup worker","Kiểm tra tác vụ dọn tệp")}</button>
        <button type="button" title={runReason||undefined} aria-describedby={`${id}-run`} data-button-variant="danger" className="button button-outline" disabled={!!runReason} onClick={()=>void manage("run")}>{t("Run permanent cleanup","Xóa vĩnh viễn tệp hết hạn")}</button>
      </div>
      {trashReason&&!busy&&<p id={`${id}-trash`}>{trashReason}</p>}
      {runReason&&!busy&&report?.enabled&&<p id={`${id}-run`}>{runReason}</p>}
      {!report?.enabled&&<p id={`${id}-run`} hidden>{paused}</p>}
      {progress&&<p role="status">{progress}</p>}
      {resultText&&<p role="status">{resultText} {restoredHref&&<a className="text-link" href={restoredHref} target="_blank" rel="noopener noreferrer">{t("Open restored file","Mở tệp đã khôi phục")}</a>}</p>}
      {error&&<p role="alert">{error}</p>}
      {upgraded&&<nav className="storage-media-actions" aria-label={t("Media lists","Danh sách tệp")}>{tabs.map(([kind,label])=>
        <button type="button" key={kind} className="button button-outline button-small" aria-pressed={selected===kind} disabled={!!busy} onClick={()=>void loadPage(kind)}>{label}</button>)}</nav>}
      {selected&&<section>
        <h3>{tabs.find(([kind])=>kind===selected)?.[1]}</h3>
        {!page&&!busy&&<button type="button" className="text-link" onClick={()=>void loadPage(selected,offset)}>{t("Refresh this list","Làm mới danh sách này")}</button>}
        {page&&!page.available&&<p>{t("Run a storage scan to view the inventory files.","Hãy quét kho để xem danh sách tệp.")}</p>}
        {page?.available&&!page.items.length&&<p>{selected==="trash_page"?t("No files in Trash.","Thùng rác chưa có tệp."):
          selected==="run_page"?t("No cleanup runs recorded.","Chưa ghi nhận lượt dọn tệp."):t("No records on this page.","Trang này không có mục nào.")}</p>}
        {page?.available&&<ul className="storage-media-rows">
          {selected==="inventory_page"&&(page.items as InventoryItem[]).map(row=><li key={row.bucket+"/"+row.name}>
            <div><strong>{row.name.split("/").at(-1)}</strong><small>{row.bucket} · {reasonLabel(row.reason)}</small></div><span>{row.bytes===null?"—":formatBytes(row.bytes)}</span>
          </li>)}
          {selected==="removed_page"&&(page.items as RemovedItem[]).map(row=><li key={row.id}>
            <div><strong>{row.name.split("/").at(-1)}</strong><small>{row.bucket} · {row.source==="rename"?t("Photo retirement","Ảnh đã ngừng sử dụng"):t("Permanent removal","Đã xóa vĩnh viễn")}</small></div>
            <span>{formatTime(row.removed_at)}</span>
          </li>)}
          {selected==="run_page"&&(page.items as MediaRun[]).map(row=><li key={row.id}>
            <time dateTime={row.started_at}>{formatTime(row.started_at)}</time><span>{row.finished_at?
              t(`${row.removed} removed · ${row.failed} failed · ${row.attempted} attempted`,`${row.removed} đã xóa · ${row.failed} lỗi · ${row.attempted} đã xử lý`):
              t("Awaiting confirmation","Đang chờ xác nhận")}</span>
          </li>)}
          {selected==="trash_page"&&(page.items as MediaItem[]).map(item=>{
            const reason=restoreReason(item),hint=`${id}-${item.id}`;
            const canPurge=!removalReason&&item.state==="trashed"&&item.expires_at&&Date.parse(item.expires_at)>now;
            return <li key={item.id}>
              <div><strong>{item.name.split("/").at(-1)}</strong><small>{item.bucket} · {countdown(item.expires_at)} · {formatTime(item.expires_at)}</small>
                {reason&&<small id={hint}>{reason}</small>}
              </div>
              <div className="storage-media-actions">
                <span title={reason||undefined} tabIndex={reason?0:undefined} aria-describedby={reason?hint:undefined}>
                  <button type="button" className="button button-outline button-small" data-button-variant="restore" disabled={!!busy||!!reason}
                    aria-describedby={reason?hint:undefined} onClick={()=>void manage("restore",item)}>{item.restore_mode==="file"?t("Keep file","Giữ tệp"):t("Restore","Khôi phục")}</button>
                </span>
                {canPurge&&<button type="button" className="button button-outline button-small" data-button-variant="danger" onClick={()=>void manage("purge",item)}>{t("Permanently delete now","Xóa vĩnh viễn ngay")}</button>}
              </div>
            </li>;
          })}
        </ul>}
        {page&&(offset>0||page.hasMore)&&<nav className="storage-media-actions" aria-label={t("Pages for this list","Các trang của danh sách này")}>
          <button className="text-link" type="button" disabled={!!busy||offset===0} onClick={()=>void loadPage(selected,offset-pageSize)}>{t("Previous","Trước")}</button>
          <span>{t("Page","Trang")} {Math.floor(offset/pageSize)+1}</span>
          <button className="text-link" type="button" disabled={!!busy||!page.hasMore} onClick={()=>void loadPage(selected,offset+pageSize)}>{t("Next","Tiếp")}</button>
        </nav>}
      </section>}
    </div>
  </details>;
}
