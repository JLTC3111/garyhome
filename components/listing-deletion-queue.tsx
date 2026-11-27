"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PROPERTY_IMAGE_ORIGIN } from "@/lib/property-photo-files";
import { cancelTrashRun, isTrashTarget, makeTrashRun, matchingTrashTargets, mediaRequestTimeoutMs, pendingTrashRequest, processTrashRun,
  readTrashRun, reconcilePausedTrashRun, settlePausedTrashItem,
  trashRunIssueCode, trashRunTiming, trashRunTotals, trashRunUnfinished, type CleanupResult, type TrashOperationState, type TrashReceipt,
  type TrashRun, type TrashRunClock, type TrashTarget } from "@/lib/home-media-trash";
import type { ListingDeletion } from "@/lib/property-deletion-server";
import { useSite } from "./site-context";
import { StorageOrphanReview } from "./storage-orphan-review";
import { MediaSearchField, MediaSelectionControls, useMediaSelection } from "./media-selection";
import { MediaRemovalProgress } from "./media-removal-progress";

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
  bytes?:number|null; purge_block?:string|null; retry_after?:string|null;
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
  crossAppProtection?:boolean; inventoryCheckedAt?:string; nextExpiry?:string|null;
  earlyEligible?:number;
};
type PageKind = "inventory_page"|"trash_page"|"removed_page"|"run_page";
type MediaPage = {items:(InventoryItem|MediaItem|RemovedItem|MediaRun)[]; hasMore:boolean; available:boolean};
type MediaAction = "overview"|"inventory_scan"|"trash"|"restore"|"run";
type PanelAction = MediaAction|PageKind|"purge"|"purge_individual"|"cancel_purge"|"check_receipt";
const pageSize=30;
const trashId=(item:TrashTarget)=>item.id;

function mediaRequest<T>(editorTask: ReturnType<typeof useSite>["editorTask"], payload:Record<string,unknown>, beforeSend?:()=>void) {
  return editorTask(async(db,signal)=>{
    const {data}=await db.auth.getSession();
    if(!data.session?.access_token)throw new Error("session_expired");
    signal.throwIfAborted();
    beforeSend?.();
    const response=await fetch("/api/admin/storage-media",{
      method:"POST",signal,headers:{"Content-Type":"application/json",Authorization:"Bearer "+data.session.access_token},
      body:JSON.stringify(payload),
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok||!result)throw new Error(typeof result==="object"&&result&&"error" in result&&typeof result.error==="string"?result.error:"unavailable");
    return result as T;
  },mediaRequestTimeoutMs);
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
    case "cleanup_worker_busy": return t("Another cleanup run has the worker. Resume when it finishes.","Tác vụ đang chạy một lượt dọn khác. Hãy tiếp tục sau khi lượt đó hoàn tất.");
    case "cleanup_worker_missing": return t("The cleanup worker is missing. Ask the operator to deploy media-orphan-cleanup.","Thiếu tác vụ dọn tệp. Nhờ người vận hành triển khai media-orphan-cleanup.");
    case "cleanup_worker_unavailable": return t("The cleanup worker did not confirm its configuration. Ask the operator to check its deployment and credentials.","Tác vụ dọn tệp chưa xác nhận cấu hình. Nhờ người vận hành kiểm tra bản triển khai và thông tin xác thực.");
    case "cross_app_protection_required": return t("Apply the Home cross-application media protection migration before permanent removal.","Áp dụng bản cập nhật bảo vệ tệp giữa các ứng dụng trước khi xóa vĩnh viễn.");
    case "cross_app_protection_unconfirmed": return t("Couldn’t verify Jobs and Visa media protection. Refresh inventory before retrying.","Chưa xác minh được bảo vệ tệp Jobs và Visa. Làm mới kho trước khi thử lại.");
    case "trash_bulk_setup": return t("Apply the File Trash read migration to load eligible selections.","Áp dụng bản cập nhật đọc Thùng rác để tải tệp đủ điều kiện.");
    case "trash_checkpoint_invalid": return t("The saved cleanup checkpoint is unreadable. Check Cleanup History before starting another run.","Không đọc được tiến độ đã lưu. Kiểm tra Lịch sử dọn tệp trước khi chạy lại.");
    case "trash_checkpoint_storage": return t("The browser couldn’t save the cleanup checkpoint. Allow local storage to continue.","Trình duyệt chưa lưu được tiến độ. Hãy bật kho cục bộ để tiếp tục.");
    case "trash_run_active": return t("Another tab is changing File Trash. Try again when it finishes.","Thẻ khác đang thay đổi Thùng rác. Hãy thử lại sau khi hoàn tất.");
    case "trash_run_pending": return t("Resume this run or cancel its remaining files to start another removal.","Tiếp tục lượt này hoặc hủy các tệp còn lại để bắt đầu lượt xóa khác.");
    case "trash_run_interrupted": return t("This run was interrupted. The last request will be checked before continuing or cancelling.","Lượt xóa bị gián đoạn. Yêu cầu cuối sẽ được kiểm tra trước khi tiếp tục hoặc hủy.");
    case "removal_unconfirmed": return t("The last request’s outcome is unknown. Resume or cancel to check its receipt again.","Chưa xác nhận kết quả yêu cầu cuối. Tiếp tục hoặc hủy để kiểm tra lại biên nhận.");
    case "purge_timeout": return t("The deletion request timed out. Resume or cancel to check its receipt before continuing.","Yêu cầu xóa đã quá hạn. Tiếp tục hoặc hủy để kiểm tra biên nhận trước khi làm tiếp.");
    case "removal_in_progress": return t("The worker is still resolving the last file. Try again after it finishes.","Tác vụ vẫn đang xử lý tệp cuối. Hãy thử lại sau khi hoàn tất.");
    case "removal_verification_wait": return t("The last request may still reach the worker. Try again in up to a minute.","Yêu cầu cuối vẫn có thể tới tác vụ. Hãy thử lại trong vòng một phút.");
    case "selection_changed": return t("The file or its restore deadline changed after selection.","Tệp hoặc hạn khôi phục đã thay đổi sau khi chọn.");
    case "restored": return t("The file was restored while the batch was paused.","Tệp đã được khôi phục khi lượt xóa tạm dừng.");
    case "already_removed": return t("The file was removed by another cleanup.","Tệp đã được xóa bởi một lượt dọn khác.");
    case "no_longer_eligible": return t("The file is out of File Trash or otherwise ineligible.","Tệp đã rời Thùng rác hoặc không còn đủ điều kiện.");
    case "protected": return t("The live dependency or identity check kept this file.","Kiểm tra tham chiếu hoặc định danh hiện tại đã giữ lại tệp này.");
    case "storage_failure": return t("Storage didn’t confirm removal. Check Cleanup History.","Kho chưa xác nhận đã xóa. Hãy kiểm tra Lịch sử dọn tệp.");
    case "identity_changed": return t("The Storage object changed or is missing.","Đối tượng trong kho đã thay đổi hoặc không còn.");
    case "expired": return t("The restore window ended. This file goes through expired cleanup.","Đã hết hạn khôi phục. Tệp này được xử lý qua dọn tệp hết hạn.");
    case "owner_hold": return t("An Owner hold protects this file.","Chủ sở hữu đang bảo vệ tệp này.");
    case "active_upload": return t("An upload lease still protects this file.","Quyền tải lên vẫn đang bảo vệ tệp này.");
    case "retry_wait": return t("The worker is waiting for its next retry window.","Tác vụ đang chờ đến thời điểm thử lại.");
    case "attempt_limit": return t("The cleanup retry limit was reached.","Đã đạt giới hạn thử lại khi dọn tệp.");
    case "missing_expiry": return t("The restore deadline is unavailable.","Không có hạn khôi phục.");
    case "media_busy": return t("A listing edit or cleanup holds a media lock. Try again after it finishes.","Một thao tác chỉnh tin hoặc dọn tệp đang giữ khóa. Hãy thử lại sau khi hoàn tất.");
    case "media_lock_deferred": return t("The lock persisted after retries. The file remains in File Trash.","Tệp vẫn bị khóa sau khi thử lại. Tệp vẫn nằm trong Thùng rác.");
    case "session_expired": return t("Sign in again to verify the Owner session.","Đăng nhập lại để xác minh phiên Chủ sở hữu.");
    case "cleanup_unconfirmed": case "purge_unavailable": case "purge_unconfirmed": return t("Permanent removal could not be confirmed. Check File Trash and Cleanup History before retrying.","Chưa xác nhận xóa vĩnh viễn. Kiểm tra Thùng rác và Lịch sử dọn tệp trước khi thử lại.");
    case "backend_config": return t("Check the staff deployment’s Home Supabase URL and publishable key.","Kiểm tra URL Supabase và khóa công khai của Home trong bản triển khai nhân viên.");
    case "owner_check_unavailable": return t("Couldn’t verify Owner access. Sign in again or ask the operator to check the staff membership service.","Chưa xác minh được quyền Chủ sở hữu. Đăng nhập lại hoặc nhờ người vận hành kiểm tra dịch vụ phân quyền.");
    case "forbidden": return t("This panel requires the active Gary Home Owner.","Mục này yêu cầu tài khoản Chủ sở hữu Gary Home đang hoạt động.");
    case "inventory_unavailable": case "unavailable": return t("The Home inventory did not respond. Refresh the panel or ask the operator to check the Owner RPC.","Kho Home không phản hồi. Làm mới hoặc nhờ người vận hành kiểm tra RPC của Chủ sở hữu.");
    default:return listingDeletionMessage(issue,t);
  }
}

export function StorageMediaManagement({latest,onListingRestored,visible}: {latest:ListingDeletion|null;onListingRestored:()=>void;visible:boolean}) {
  const {editorTask,language,t,notice,user}=useSite();
  const [report,setReport]=useState<MediaReport|null>(null),[open,setOpen]=useState(false);
  const [reviewOpen,setReviewOpen]=useState(false);
  const [selected,setSelected]=useState<PageKind|null>(null),[page,setPage]=useState<MediaPage|null>(null),[offset,setOffset]=useState(0);
  const [busy,setBusy]=useState<PanelAction|null>(null),[error,setError]=useState(""),[resultText,setResultText]=useState("");
  const [removalError,setRemovalError]=useState("");
  const [restoredHref,setRestoredHref]=useState("");
  const [worker,setWorker]=useState<{status:"checking"|"ready"|"unavailable";cronConfigured?:boolean;issue?:unknown}|null>(null);
  const [workerAttempt,setWorkerAttempt]=useState(0);
  const ownerKey=`gary-home:media:${user?.id??""}`;
  const trashSelection=useMediaSelection(`${ownerKey}:trash-selection`,trashId,isTrashTarget);
  const checkpointKey=`${ownerKey}:trash-run`;
  const [trashRun,setTrashRun]=useState<TrashRun|null>(null),[checkpointReady,setCheckpointReady]=useState(false);
  const [checkpointIssue,setCheckpointIssue]=useState("");
  const [runClock,setRunClock]=useState<TrashRunClock|null>(null),[stopping,setStopping]=useState(false);
  const [trashFilter,setTrashFilter]=useState("");
  const [historyPreview,setHistoryPreview]=useState<MediaPage|null>(null);
  const active=useRef(false),stopRequested=useRef(false);
  const [now,setNow]=useState(Date.now),[seen,setSeen]=useState(latest);
  const flight=useRef(false),id=useId();
  const locale=language==="vi"?"vi-VN":"en";
  const number=new Intl.NumberFormat(locale);
  const date=new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short"});
  const bytes=new Intl.NumberFormat(locale,{style:"unit",unit:"megabyte",maximumFractionDigits:2});
  const formatTime=(value:string|null)=>value&&Number.isFinite(Date.parse(value))?date.format(new Date(value)):"—";
  const formatBytes=(value:number)=>bytes.format(value/1_000_000);
  const upgraded=report?.panelVersion===2;
  const requestMedia=useCallback(<T,>(payload:Record<string,unknown>,beforeSend?:()=>void)=>mediaRequest<T>(editorTask,payload,beforeSend),[editorTask]);

  useEffect(()=>{
    active.current=true;
    const hydrate=()=>{
      try{setTrashRun(readTrashRun(localStorage.getItem(checkpointKey)));setCheckpointIssue("");}
      catch(issue){setCheckpointIssue(issue instanceof Error&&issue.message==="trash_checkpoint_invalid"?issue.message:"trash_checkpoint_storage");}
      setRemovalError("");
      setCheckpointReady(true);
    };
    const changed=(event:StorageEvent)=>{if((event.key===checkpointKey||event.key===null)&&!flight.current)hydrate();};
    hydrate();window.addEventListener("storage",changed);
    return ()=>{active.current=false;stopRequested.current=true;window.removeEventListener("storage",changed);};
  },[checkpointKey]);

  useEffect(()=>{
    if(!open)return;
    let current=true;
    setWorker({status:"checking"});
    void requestMedia<{status:string;cronConfigured:boolean}>({action:"worker_status"}).then(health=>{
      if(health.status!=="ok")throw new Error("cleanup_worker_unavailable");
      if(current)setWorker({status:"ready",cronConfigured:health.cronConfigured});
    }).catch(issue=>{if(current)setWorker({status:"unavailable",issue});});
    return ()=>{current=false;};
  },[open,requestMedia,workerAttempt]);

  useEffect(()=>{
    if(!visible||!open||selected!=="trash_page"||!page?.items.length)return;
    const expire=(page.items as MediaItem[]).map(row=>Date.parse(row.expires_at||"")).filter(time=>time>Date.now());
    if(!expire.length)return;
    const timer=setTimeout(()=>setNow(Date.now()),Math.min(60_000,Math.max(1,Math.min(...expire)-Date.now()+1)));
    return ()=>clearTimeout(timer);
  },[visible,open,selected,page,now]);

  async function overview() {
    try {return await mediaRequest<MediaReport>(editorTask,{action:"overview"});}
    catch(issue){
      if(!(issue instanceof Error)||issue.message!=="inventory_panel_upgrade")throw issue;
      return mediaRequest<MediaReport>(editorTask,{action:"status"});
    }
  }
  function reportResult(fresh:MediaReport) {setReport(fresh);setSeen(latest);setNow(Date.now());}
  async function work(action:PanelAction,operation:()=>Promise<void>) {
    if(flight.current)return;
    flight.current=true;setBusy(action);setError("");
    const removal=action==="purge"||action==="cancel_purge"||action==="check_receipt";
    if(removal||action==="purge_individual")setRemovalError("");
    try{await operation();}
    catch(issue){(removal?setRemovalError:setError)(mediaMessage(issue,t));}
    finally{
      if(action==="purge"||action==="purge_individual"){setRunClock(null);setStopping(false);}
      flight.current=false;setBusy(null);
    }
  }
  async function loadPage(kind:PageKind,next=0) {
    if(flight.current||!upgraded)return;
    setReviewOpen(false);setSelected(kind);setPage(kind==="removed_page"&&next===0?historyPreview:null);setOffset(next);
    await work(kind,async()=>{applyPage(kind,await requestMedia<MediaPage>({action:kind,offset:next}));});
  }
  function applyPage(kind:PageKind,fresh:MediaPage) {
    setPage(fresh);setNow(Date.now());
    if(kind!=="trash_page"||!trashSelection.rows.length)return;
    const rows=fresh.items as MediaItem[];
    const visibleIds=new Set(rows.map(row=>row.id));
    const live=rows.flatMap(row=>row.state==="trashed"&&!row.purge_block&&isTrashTarget(row)?[row]:[]);
    const matches=new Set(matchingTrashTargets(trashSelection.rows,live).map(row=>row.id));
    const stale=trashSelection.rows.filter(row=>Date.parse(row.expires_at)<=Date.now()||visibleIds.has(row.id)&&!matches.has(row.id));
    if(stale.length)trashSelection.remove(stale.map(row=>row.id));
  }
  async function refreshHistory() {
    const recent=await requestMedia<MediaPage>({action:"removed_page",offset:0});
    if(active.current)setHistoryPreview(recent);
  }
  async function refreshAfterChange(includeHistory=false) {
    if(!active.current)return;
    const stats=overview().then(reportResult);
    const list=selected?requestMedia<MediaPage>({action:selected,offset}).then(async fresh=>{
      if(offset>0&&!fresh.items.length){fresh=await requestMedia<MediaPage>({action:selected,offset:0});setOffset(0);}
      if(active.current)applyPage(selected,fresh);
    }):null;
    const reads=list?[stats,list]:[stats];
    if(includeHistory&&(selected!=="removed_page"||offset!==0))reads.push(refreshHistory());
    const results=await Promise.allSettled(reads);
    if(results.some(result=>result.status==="rejected"))setError(t(
      "The operation finished. Part of the panel couldn’t refresh. Use Refresh inventory or reopen the list.",
      "Đã kết thúc thao tác. Một phần bảng chưa thể làm mới. Hãy làm mới kho hoặc mở lại danh sách."));
  }
  async function manage(action:MediaAction,item?:MediaItem) {
    if(flight.current)return;
    if(action==="trash"&&!window.confirm(t("Move the verified file to Trash with its existing restore deadline?","Chuyển tệp đã xác minh vào Thùng rác theo thời hạn khôi phục hiện tại?")))return;
    if(action==="run"&&!window.confirm(t("Permanently remove eligible files whose restore window has ended?","Xóa vĩnh viễn các tệp đủ điều kiện đã hết thời gian khôi phục?")))return;
    if(action==="restore"&&item?.restore_mode==="draft"&&!window.confirm(t("Restore this file to a new draft of the deleted listing?","Khôi phục tệp vào bản nháp mới của tin đăng đã xóa?")))return;
    async function perform() {
      if(action==="overview"){reportResult(await overview());return;}
      let confirmed:string;
      if(action==="inventory_scan"||action==="trash"){
        const fresh=await mediaRequest<MediaReport>(editorTask,{action});
        reportResult(fresh);
        confirmed=action==="inventory_scan"?t("Storage scan complete.","Đã quét xong kho lưu trữ."):
          fresh.newlyTrashed?t("Moved the verified file to Trash.","Đã chuyển tệp đã xác minh vào Thùng rác."):
          t("The file changed or is protected. Scan again to check what can be moved.","Tệp đã thay đổi hoặc được bảo vệ. Quét lại để kiểm tra tệp có thể chuyển.");
      }else if(action==="restore"){
        if(!item)throw new Error("restore_unavailable");
        if(savedPendingFile()?.id===item.id)throw new Error("removal_unconfirmed");
        const result=await mediaRequest<{id:string;restored:boolean;listingId:string|null}>(editorTask,{action,id:item.id});
        if(result.id!==item.id||!result.restored)throw new Error("restore_unavailable");
        try{
          const saved=readSavedRun();
          if(saved){
            const settled=settlePausedTrashItem(saved,item,"restored");
            if(settled!==saved)saveRun(settled);
          }
        }catch{/* Resume revalidates the live manifest if this browser cannot update its checkpoint. */}
        if(result.listingId)onListingRestored();
        trashSelection.remove([item.id]);
        setRestoredHref(PROPERTY_IMAGE_ORIGIN+"/storage/v1/object/public/"+item.bucket+"/"+item.name.split("/").map(encodeURIComponent).join("/"));
        confirmed=result.listingId?t("Listing media and metadata restored.","Đã khôi phục tệp và siêu dữ liệu của tin đăng."):
          t("File kept in Storage.","Đã giữ tệp trong kho lưu trữ.");
      }else{
        if(savedPendingFile())throw new Error("removal_unconfirmed");
        const result=await mediaRequest<CleanupResult>(editorTask,{action});
        if(result.status==="disabled")throw new Error("cleanup_disabled");
        if(result.status==="busy")throw new Error("media_busy");
        if(result.status!=="ok")throw new Error("cleanup_unconfirmed");
        confirmed=t(`Removed ${result.removed??0} of ${result.attempted??0} attempted files. ${result.overdue??0} overdue.`,
          `Đã xóa ${result.removed??0} trong ${result.attempted??0} tệp đã xử lý. ${result.overdue??0} tệp quá hạn.`);
      }
      if(action!=="restore")setRestoredHref("");
      setResultText(confirmed);notice(confirmed);
      await refreshAfterChange(action==="run");
      if(action==="run"&&trashSelection.rows.length)await eligibleTrash();
    }
    await work(action,()=>action==="trash"||action==="restore"||action==="run"?withCheckpointLock(perform):perform());
  }

  function readSavedRun() {return readTrashRun(localStorage.getItem(checkpointKey));}
  function savedPendingFile() {
    let run=trashRun;
    try{run=readSavedRun();}
    catch{/* Use the last known checkpoint when browser storage is unavailable. */}
    return pendingTrashRequest(run);
  }
  function saveRun(run:TrashRun) {
    try{localStorage.setItem(checkpointKey,JSON.stringify(run));}
    catch{throw new Error("trash_checkpoint_storage");}
    if(active.current)setTrashRun(run);
  }
  function getReceipt(item:TrashTarget) {
    return requestMedia<TrashReceipt>({action:"trash_receipt",id:item.id,expiresAt:item.expires_at});
  }
  async function eligibleTrash() {
    const {items}=await requestMedia<{items:TrashTarget[]}>({action:"trash_manifest"});
    if(!Array.isArray(items)||!items.every(isTrashTarget))throw new Error("inventory_unavailable");
    const matches=new Set(matchingTrashTargets(trashSelection.rows,items).map(item=>item.id));
    const stale=trashSelection.rows.filter(item=>!matches.has(item.id));
    if(active.current&&stale.length)trashSelection.remove(stale.map(item=>item.id));
    return items;
  }
  async function withCheckpointLock(operation:()=>Promise<void>) {
    if(!navigator.locks){await operation();return;}
    await navigator.locks.request(checkpointKey,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error("trash_run_active");
      await operation();
    });
  }
  async function continueRun(run:TrashRun, revalidate=false) {
    const initialTotals=trashRunTotals(run);
    const clock:TrashRunClock={startedAt:performance.now(),elapsedBefore:run.timing?.elapsedMs??0,
      measuredBefore:run.timing?.measuredFiles??0,processedBefore:initialTotals.removed+initialTotals.skipped+initialTotals.failed};
    stopRequested.current=false;setRunClock(clock);setStopping(false);setResultText("");setRestoredHref("");
    let latestRun=run;
    function saveProgress(next:TrashRun) {
      const totals=trashRunTotals(next);
      const timing=trashRunTiming(clock,totals.removed+totals.skipped+totals.failed,performance.now());
      const checkpoint={...next,timing};
      saveRun(checkpoint);latestRun=checkpoint;
    }
    try{
      await processTrashRun(run,{
        purge:(payload,beforeSend)=>requestMedia<CleanupResult>(payload,beforeSend),receipt:getReceipt,
        save:saveProgress,stopped:()=>stopRequested.current||!active.current,
        eligible:revalidate?eligibleTrash:undefined,
      });
    }catch(issue){
      const code=issue instanceof Error&&issue.name==="RequestTimeoutError"?"inventory_timeout":trashRunIssueCode(issue instanceof Error?issue.message:undefined);
      const failed:TrashRun={...latestRun,state:"failed",issue:code};
      try{saveProgress(failed);}
      catch{if(active.current)setTrashRun(failed);}
    }
    if(active.current){
      trashSelection.remove(latestRun.entries.filter(item=>item.outcome!=="pending"&&item.outcome!=="sent").map(item=>item.id));
      await refreshAfterChange(true);
    }
  }
  async function purgeWhilePaused(bulk:TrashRun,run:TrashRun) {
    let saved=bulk;
    const result=await processTrashRun(run,{
      purge:(payload,beforeSend)=>requestMedia<CleanupResult>(payload,beforeSend),receipt:getReceipt,
      stopped:()=>!active.current,
      save(next){
        const file=next.entries[0];
        const individualRequest=file.outcome==="sent"?file:undefined;
        let updated=saved;
        if(individualRequest!==saved.individualRequest)updated={...saved,individualRequest};
        if(individualRequest&&next.issue)updated={...updated,issue:next.issue,issueItemId:file.id};
        if(file.outcome==="removed")updated=settlePausedTrashItem(updated,file,"removed",file.bytes);
        if(updated!==saved){saveRun(updated);saved=updated;}
      },
    });
    if(!active.current)return;
    const file=result.entries[0];
    if(file.outcome==="removed"){
      trashSelection.remove([file.id]);
      const confirmed=t("File permanently deleted.","Đã xóa tệp vĩnh viễn.");
      setResultText(confirmed);setRestoredHref("");notice(confirmed);
    }else{
      setError(mediaMessage(new Error(result.issue??file.reason??"purge_unconfirmed"),t));
    }
    await refreshAfterChange(true);
  }
  async function purgeFiles(items:TrashTarget[],individual=false) {
    if(flight.current||!items.length||(individual?individualRunReason:newRunReason))return;
    await work(individual&&unfinished?"purge_individual":"purge",async()=>{
      await withCheckpointLock(async()=>{
        const existing=readSavedRun();
        if(pendingTrashRequest(existing)){setTrashRun(existing);throw new Error("removal_unconfirmed");}
        const separate=individual&&existing&&trashRunUnfinished(existing)?existing:null;
        if(trashRunUnfinished(existing)&&!separate){setTrashRun(existing);throw new Error("trash_run_pending");}
        setBusy(separate?"purge_individual":"purge");
        const single=items.length===1?await getReceipt(items[0]):null;
        const live=single?(single.status==="eligible"?[{...items[0],bytes:single.bytes??items[0].bytes}]:[]):
          await eligibleTrash();
        const eligible=matchingTrashTargets(items,live),eligibleIds=new Set(eligible.map(item=>item.id));
        const excluded=items.length-eligible.length;
        if(!active.current)return;
        trashSelection.remove(items.filter(item=>!eligibleIds.has(item.id)).map(item=>item.id));
        if(!eligible.length){
          setRemovalError(single?mediaMessage(new Error(single.status==="eligible"?"selection_changed":single.status),t):
            t("The selected files are no longer eligible. Review File Trash.","Các tệp đã chọn không còn đủ điều kiện. Hãy kiểm tra Thùng rác."));
          await refreshAfterChange();return;
        }
        const size=formatSelection(eligible);
        if(!window.confirm(t(`Permanently delete ${eligible.length} selected files (${size}) before their restore windows end?${excluded?` ${excluded} changed or ineligible files will be skipped.`:""}`,
          `Xóa vĩnh viễn ${eligible.length} tệp đã chọn (${size}) trước khi hết hạn khôi phục?${excluded?` Sẽ bỏ qua ${excluded} tệp thay đổi hoặc không đủ điều kiện.`:""}`)))return;
        const run=makeTrashRun(items);
        for(const item of run.entries)if(!eligibleIds.has(item.id)){item.outcome="skipped";item.reason="selection_changed";}
        if(separate)await purgeWhilePaused(separate,run);
        else{
          saveRun(run);
          await continueRun(run);
        }
      });
    });
  }
  async function resumePurge() {
    if(flight.current||resumeReason)return;
    await work("purge",()=>withCheckpointLock(async()=>{
      const saved=readSavedRun();
      if(saved&&trashRunUnfinished(saved))await continueRun(saved,true);
      else setTrashRun(saved);
    }));
  }
  async function cancelPurge() {
    if(flight.current)return;
    await work("cancel_purge",()=>withCheckpointLock(async()=>{
      const saved=readSavedRun();
      if(!saved||!trashRunUnfinished(saved)){setTrashRun(saved);return;}
      const checkingReceipt=!!pendingTrashRequest(saved);
      const cancelled=await cancelTrashRun(saved,{receipt:getReceipt,save:saveRun});
      if(!active.current||cancelled.state!=="cancelled")return;
      trashSelection.remove(cancelled.entries.map(item=>item.id));
      if(checkingReceipt)await refreshAfterChange(true);
    }));
  }
  async function checkPendingReceipt() {
    if(flight.current)return;
    await work("check_receipt",()=>withCheckpointLock(async()=>{
      const saved=readSavedRun();
      if(!saved||!pendingTrashRequest(saved)){setTrashRun(saved);return;}
      const reconciled=await reconcilePausedTrashRun(saved,{receipt:getReceipt,save:saveRun});
      if(active.current&&!pendingTrashRequest(reconciled)){
        trashSelection.remove(reconciled.entries.filter(item=>item.outcome==="removed").map(item=>item.id));
        await refreshAfterChange(true);
      }
    }));
  }
  async function selectAllTrash() {
    if(flight.current||allSelectionReason)return;
    await work("trash_page",async()=>{
      const all=await eligibleTrash();
      if(active.current)trashSelection.add(all);
    });
  }

  const paused=t("Permanent cleanup is disabled by the Home retention policy.","Chính sách lưu giữ Home đang tắt chức năng xóa vĩnh viễn.");
  const upgrade=t("Apply the Home media panel pagination migration first.","Áp dụng bản cập nhật phân trang kho Home trước.");
  const bulkActive=busy==="purge"||busy==="cancel_purge";
  const unfinished=trashRunUnfinished(trashRun);
  const preparing=busy==="purge"&&!runClock;
  const processing=busy==="purge"&&(preparing||trashRun?.state==="running");
  const pendingFile=pendingTrashRequest(trashRun);
  const removalState:TrashOperationState=processing?(stopping?"stopping":"running"):
    removalError&&!unfinished?"failed":trashRun?.state??"idle";
  const removalDetailsId=`${id}-removal-details`;
  const progress=busy==="inventory_scan"?t("Scanning storage and checking queued files…","Đang quét kho và kiểm tra tệp trong hàng đợi…"):
    busy==="purge_individual"?t("Processing the individual deletion…","Đang xử lý yêu cầu xóa tệp…"):
    busy==="run"?t("Checking expired files for cleanup…","Đang kiểm tra tệp hết hạn để dọn…"):
    busy?t("Checking storage…","Đang kiểm tra kho lưu trữ…"):"";
  const inventoryReason=busy?progress:!report?t("Load the storage inventory first.","Hãy tải dữ liệu kho trước."):!upgraded?upgrade:"";
  const trashReason=inventoryReason||(!report?.lastScanAt?t("Run a storage scan first.","Hãy quét kho trước."):
    !report.readyToTrash?t("The tracked queue has no verified file to move. Use Orphan review for historical candidates.","Hàng đợi chưa có tệp đã xác minh để chuyển. Dùng Rà soát tệp thừa để kiểm tra tệp tồn từ trước."):"");
  const workerReason=worker?.status==="unavailable"?mediaMessage(worker.issue,t):worker?.status==="ready"?"":
    t("Checking cleanup worker availability…","Đang kiểm tra tác vụ dọn tệp…");
  const removalReason=inventoryReason||(!report?.enabled?paused:!report.crossAppProtection?
    mediaMessage(new Error("cross_app_protection_required"),t):workerReason);
  const nextExpiry=report?.nextExpiry;
  const noExpired=t("No eligible files are due for expiry cleanup.","Chưa có tệp đủ điều kiện dọn khi hết hạn.");
  const pendingRequestReason=pendingFile?mediaMessage(new Error("removal_unconfirmed"),t):"";
  const runReason=removalReason||pendingRequestReason||(!report?.overdue?(nextExpiry?`${noExpired} ${t("Next restore deadline", "Hạn khôi phục tiếp theo")} ${formatTime(nextExpiry)}.`:noExpired):"");
  const bulkSetup=report?.earlyEligible===undefined?mediaMessage(new Error("trash_bulk_setup"),t):"";
  const noEarly=t("No files are eligible for removal before expiry.","Chưa có tệp đủ điều kiện xóa trước hạn.");
  const checkpointReason=checkpointIssue?mediaMessage(new Error(checkpointIssue),t):!checkpointReady?
    t("Loading the saved cleanup checkpoint…","Đang tải tiến độ dọn đã lưu…"):"";
  const resumeReason=removalReason||bulkSetup||checkpointReason;
  const unfinishedReason=unfinished?mediaMessage(new Error("trash_run_pending"),t):"";
  const newRunReason=unfinishedReason||resumeReason||(!report?.earlyEligible?noEarly:"");
  const individualRunReason=resumeReason||pendingRequestReason||(!report?.earlyEligible?noEarly:"");
  const bulkEntryReason=removalReason||bulkSetup||(!report?.earlyEligible?noEarly:"");
  const controlReasons=[...new Set([trashReason,runReason,bulkEntryReason].filter(reason=>reason&&reason!==pendingRequestReason))];
  const controlHint=(reason:string)=>!reason?undefined:reason===pendingRequestReason?removalDetailsId:`${id}-operation-${controlReasons.indexOf(reason)}`;
  const eligibleCount=(count:number|undefined)=>count===undefined?"—":number.format(count);
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
    if(item.id===pendingFile?.id)return pendingRequestReason;
    if(item.state==="deleting")return t("Permanent removal is in progress.","Tệp đang được xóa vĩnh viễn.");
    if(!item.expires_at||!Number.isFinite(Date.parse(item.expires_at)))return t("The restore deadline is unavailable. Reload File Trash.","Không có hạn khôi phục. Hãy tải lại Thùng rác.");
    if(Date.parse(item.expires_at)<=now)return t("The 48-hour restore window ended.","Đã hết 48 giờ khôi phục.");
    if(item.restore_mode==="unavailable")return t("The original listing details needed for restore are unavailable.","Thiếu dữ liệu của tin đăng gốc cần thiết để khôi phục.");
    return "";
  }
  function purgeReason(item:MediaItem){
    if(item.state==="deleting")return t("Permanent removal is already in progress.","Tệp đang được xóa vĩnh viễn.");
    if(!item.expires_at||!Number.isFinite(Date.parse(item.expires_at)))return t("The restore deadline is unavailable. Reload File Trash.","Không có hạn khôi phục. Hãy tải lại Thùng rác.");
    if(!isTrashTarget(item))return t("Reload File Trash to get the file identity and size.","Tải lại Thùng rác để lấy định danh và dung lượng tệp.");
    if(Date.parse(item.expires_at)<=now)return t("The restore window ended. Use Run expired-file cleanup.","Đã hết hạn khôi phục. Hãy chạy Dọn tệp hết hạn.");
    if(item.purge_block==="owner_hold")return t("An Owner protection hold is active for this file.","Tệp này đang được Chủ sở hữu bảo vệ.");
    if(item.purge_block==="active_upload")return t("An upload lease still protects this file.","Quyền tải lên vẫn đang bảo vệ tệp này.");
    if(item.purge_block==="attempt_limit")return t("The cleanup retry limit was reached. Review the file before retrying.","Đã đạt giới hạn thử lại. Kiểm tra tệp trước khi thử lại.");
    if(item.purge_block==="retry_wait"&&item.retry_after&&Date.parse(item.retry_after)>now)return t(
      `The next cleanup attempt is available after ${formatTime(item.retry_after)}.`,`Có thể thử dọn lại sau ${formatTime(item.retry_after)}.`);
    if(item.purge_block && item.purge_block!=="retry_wait")return mediaMessage(new Error(item.purge_block),t);
    return "";
  }
  const visibleTrash=selected==="trash_page"?(page?.items as MediaItem[]|undefined)?.filter(item=>
    (item.name.split("/").at(-1)??"").toLowerCase().includes(trashFilter.trim().toLowerCase()))??[]:[];
  const pageEligible:TrashTarget[]=visibleTrash.flatMap(item=>!purgeReason(item)&&isTrashTarget(item)?[item]:[]);
  const selectionReason=!trashSelection.ready?t("Loading saved selection…","Đang tải lựa chọn đã lưu…"):busy?progress:"";
  const allSelectionReason=selectionReason||bulkEntryReason;
  const pageSelectionReason=selectionReason||removalReason||bulkSetup||(!pageEligible.length?
    t("No eligible files on this page.","Trang này chưa có tệp đủ điều kiện."):"");
  const noSelection=t("Select files with open restore windows.","Chọn các tệp còn thời gian khôi phục.");
  const bulkReason=newRunReason||selectionReason||(!trashSelection.rows.length?noSelection:"");
  function formatSelection(items:TrashTarget[]) {
    const unknown=items.filter(item=>item.bytes===null).length;
    return formatBytes(items.reduce((sum,item)=>sum+(item.bytes??0),0))+(unknown?
      t(` plus ${unknown} unknown sizes`,` và ${unknown} tệp chưa rõ dung lượng`):"");
  }
  function countdown(expiry:string|null){
    const minutes=Math.ceil((Date.parse(expiry||"")-now)/60_000);
    if(!Number.isFinite(minutes)||minutes<=0)return t("Restore window ended","Đã hết thời hạn khôi phục");
    const hours=Math.floor(minutes/60),rest=minutes%60;
    return t(`${hours}h ${rest}m to restore`, `Còn ${hours} giờ ${rest} phút để khôi phục`);
  }

  return <details className="admin-panel listing-deletion-queue storage-media" hidden={!visible} onToggle={event=>{
    const isOpen=event.currentTarget.open;setOpen(isOpen);
    if(visible&&isOpen&&!flight.current)void manage("overview");
  }}>
    <summary>{t("Storage & Media Management","Quản lý kho lưu trữ và tệp")}</summary>
    <div className="storage-media-body">
      <MediaRemovalProgress run={removalError&&!unfinished?null:trashRun} state={removalState} clock={processing?runClock:null}
        preparing={preparing&&!unfinished} visible={visible&&open}
        reconciling={busy==="check_receipt"||busy==="cancel_purge"&&removalState!=="cancelled"}
        refreshing={busy==="purge"&&!processing||busy==="cancel_purge"&&removalState==="cancelled"} actionsBusy={!!busy}
        detailsId={removalDetailsId} resumeReason={bulkActive?"":resumeReason} message={removalError} formatBytes={formatBytes}
        describeReason={code=>mediaMessage(new Error(code),t)} onStop={()=>{stopRequested.current=true;setStopping(true);}}
        onResume={()=>void resumePurge()} onCancel={()=>void cancelPurge()} onCheckReceipt={()=>void checkPendingReceipt()}/>
      <div className="storage-media-controls" hidden={bulkActive}>
      {report&&<>
        <dl className="storage-media-stats">
          <div><dt>{t("Storage objects","Số tệp lưu trữ")}</dt><dd>{number.format(report.objects)}</dd></div>
          <div><dt>{t("Listing media storage","Dung lượng tệp tin đăng")}</dt><dd>{formatBytes(report.bytes)}</dd></div>
          <div><dt>{report.lastScanAt?t("Potential orphans at last scan","Tệp thừa tiềm năng ở lần quét gần nhất"):t("Potential orphans","Tệp có thể bị bỏ lại")}</dt><dd>{number.format(report.candidates)} · {formatBytes(report.candidateBytes)}</dd></div>
          {upgraded&&<>
            <div><dt>{t("Protected files","Tệp được bảo vệ")}</dt><dd>{number.format(report.protected??0)}</dd></div>
            <div><dt>{t("Verified for Trash","Đã xác minh để vào Thùng rác")}</dt><dd>{number.format(report.readyToTrash??0)} · {formatBytes(report.readyBytes??0)}</dd></div>
            <div><dt>{t("In Trash awaiting removal","Trong Thùng rác chờ xóa")}</dt><dd>{number.format(report.trashed)} · {formatBytes(report.scheduledBytes??0)}</dd></div>
          </>}
        </dl>
        {upgraded&&<p>{t("Potential orphan counts include files held for review.","Số tệp có thể bị bỏ lại bao gồm tệp đang giữ để kiểm tra.")} {number.format(report.protectedCandidates??0)} {t("are protected by the scan.","tệp được bảo vệ qua lượt quét.")}</p>}
        <p>{t("Last completed scan","Lần quét hoàn tất gần nhất")} <strong>{report.lastScanAt?formatTime(report.lastScanAt):t("No scan recorded","Chưa ghi nhận lượt quét")}</strong> · {t("Inventory as of","Dữ liệu kho lúc")} <strong>{formatTime(report.inventoryCheckedAt??report.checkedAt)}</strong></p>
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
        <button type="button" className="button button-outline" title={progress||undefined} disabled={!!busy} onClick={()=>void manage("overview")}>{t("Refresh inventory","Làm mới kho")}</button>
        <button type="button" title={inventoryReason||undefined} className="button button-outline" disabled={!!inventoryReason} onClick={()=>void manage("inventory_scan")}>{t("Run storage scan","Quét kho lưu trữ")}</button>
        <button type="button" title={trashReason||undefined} aria-describedby={controlHint(trashReason)} className="button button-outline" disabled={!!trashReason} onClick={()=>void manage("trash")}>{t(`Move verified orphans to Trash (${eligibleCount(report?.readyToTrash)})`,`Chuyển tệp thừa đã xác minh vào Thùng rác (${eligibleCount(report?.readyToTrash)})`)}</button>
        {worker?.status==="unavailable"&&<button type="button" className="button button-outline" title={progress||undefined} disabled={!!busy} onClick={()=>setWorkerAttempt(attempt=>attempt+1)}>{t("Retry worker check","Kiểm tra lại tác vụ dọn tệp")}</button>}
        <button type="button" title={runReason||undefined} aria-describedby={controlHint(runReason)} data-button-variant="danger" className="button button-outline" disabled={!!runReason} onClick={()=>void manage("run")}>{t(`Run expired-file cleanup (${eligibleCount(report?.overdue)})`,`Dọn tệp hết hạn (${eligibleCount(report?.overdue)})`)}</button>
        <button type="button" title={bulkEntryReason||undefined} aria-describedby={controlHint(bulkEntryReason)} aria-controls={selected?`${id}-media-list`:undefined} className="button button-outline" disabled={!!bulkEntryReason}
          onClick={()=>void loadPage("trash_page")}>{t(`Bulk deletion from File Trash (${eligibleCount(report?.earlyEligible)})`,`Xóa hàng loạt từ Thùng rác (${eligibleCount(report?.earlyEligible)})`)}</button>
      </div>
      {controlReasons.map(reason=><p key={reason} id={controlHint(reason)} role={reason===progress?"status":undefined}>{reason}</p>)}
      {progress&&!controlReasons.includes(progress)&&<p role="status" id={`${id}-working`}>{progress}</p>}
      {resultText&&<p role="status">{resultText} {restoredHref&&<a className="text-link" href={restoredHref} target="_blank" rel="noopener noreferrer">{t("Open restored file","Mở tệp đã khôi phục")}</a>}</p>}
      {error&&<p role="alert">{error}</p>}
      {upgraded&&<nav className="storage-media-actions" aria-label={t("Media lists","Danh sách tệp")}>
        <button type="button" className="button button-outline button-small" aria-pressed={reviewOpen} title={progress||undefined} disabled={!!busy}
          onClick={()=>{setSelected(null);setReviewOpen(true);}}>{t("Orphan review","Rà soát tệp thừa")}</button>
        {tabs.map(([kind,label])=><button type="button" key={kind} className="button button-outline button-small" aria-pressed={selected===kind} title={progress||undefined} disabled={!!busy} onClick={()=>void loadPage(kind)}>{label}</button>)}
      </nav>}
      {upgraded&&reviewOpen&&<StorageOrphanReview request={requestMedia} disabled={!!busy} onStaged={()=>void refreshAfterChange()}/>}
      {selected&&<section id={`${id}-media-list`}>
        <h3>{tabs.find(([kind])=>kind===selected)?.[1]}</h3>
        {selected==="trash_page"&&<>
          <MediaSearchField label={t("Filter this page by filename","Lọc trang này theo tên tệp")}
            placeholder={t("Filter this page by filename","Lọc trang này theo tên tệp")} value={trashFilter}
            onChange={setTrashFilter} onClear={()=>setTrashFilter("")}/>
          <MediaSelectionControls count={trashSelection.rows.length} bytes={trashSelection.rows.reduce((sum,item)=>sum+(item.bytes??0),0)}
            unknownSizes={trashSelection.rows.filter(item=>item.bytes===null).length} formatBytes={formatBytes}
            pageCount={pageEligible.length} pageSelected={pageEligible.filter(item=>trashSelection.has(item.id)).length}
            allReason={allSelectionReason} pageReason={pageSelectionReason} clearReason={selectionReason||(!trashSelection.rows.length?t("Selection is empty.","Chưa chọn tệp nào."):"")}
            selectAll={()=>void selectAllTrash()} selectPage={()=>trashSelection.add(pageEligible)}
            clearPage={()=>trashSelection.remove(pageEligible.map(trashId))} clear={trashSelection.clear}>
            <button type="button" className="button button-outline button-small" data-button-variant="danger"
              title={bulkReason||undefined} aria-describedby={bulkReason?`${id}-bulk`:undefined} disabled={!!bulkReason}
              onClick={()=>void purgeFiles(trashSelection.rows)}>{t("Permanently delete selected","Xóa vĩnh viễn mục đã chọn")}</button>
            {bulkReason&&<small id={`${id}-bulk`}>{bulkReason}</small>}
            {individualRunReason&&individualRunReason!==pendingRequestReason&&
              <span className="sr-only" id={`${id}-individual`}>{individualRunReason}</span>}
          </MediaSelectionControls>
          {!!page?.items.length&&!visibleTrash.length&&<p>{t("No filenames on this page match the filter.","Không có tên tệp trên trang này khớp bộ lọc.")}</p>}
        </>}
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
          {selected==="trash_page"&&visibleTrash.map(item=>{
            const reason=busy?progress:restoreReason(item),hint=`${id}-${item.id}`,earlyReason=purgeReason(item),earlyHint=`${hint}-early`;
            const name=item.name.split("/").at(-1),checked=trashSelection.has(item.id);
            const pickReason=selectionReason||(checked?"":removalReason||bulkSetup||earlyReason);
            const deleteReason=individualRunReason||earlyReason;
            const restoreHint=busy?(controlReasons.includes(progress)?controlHint(progress):`${id}-working`):
              item.id===pendingFile?.id?removalDetailsId:hint;
            const deleteHint=individualRunReason?(individualRunReason===pendingRequestReason?removalDetailsId:`${id}-individual`):
              deleteReason===reason?restoreHint:earlyHint;
            return <li key={item.id}>
              <div><strong>{name}</strong><small>{item.bucket} · {item.bytes==null?"—":formatBytes(item.bytes)} · {countdown(item.expires_at)} · {formatTime(item.expires_at)}</small>
                {reason&&restoreHint===hint&&<span className="sr-only" id={hint}>{reason}</span>}
                {earlyReason&&!individualRunReason&&earlyReason!==reason&&<span className="sr-only" id={earlyHint}>{earlyReason}</span>}
              </div>
              <div className="storage-media-actions">
                <label title={pickReason||undefined}>
                  <input type="checkbox" checked={checked} disabled={!!pickReason} aria-label={t(`Select ${name}`,`Chọn ${name}`)}
                    onChange={event=>{if(!event.target.checked)trashSelection.remove([item.id]);else if(isTrashTarget(item))trashSelection.add([item]);}}/>
                  {t("Select","Chọn")}
                </label>
                <span title={reason||undefined} tabIndex={reason?0:undefined} aria-describedby={reason?restoreHint:undefined}>
                  <button type="button" className="button button-outline button-small" data-button-variant="restore" disabled={!!reason}
                    aria-describedby={reason?restoreHint:undefined} onClick={()=>void manage("restore",item)}>{item.restore_mode==="file"?t("Keep file","Giữ tệp"):t("Restore","Khôi phục")}</button>
                </span>
                <span title={deleteReason||undefined} tabIndex={deleteReason?0:undefined} aria-describedby={deleteReason?deleteHint:undefined}>
                  <button type="button" className="button button-outline button-small" data-button-variant="danger" disabled={!!deleteReason}
                    onClick={()=>{if(isTrashTarget(item))void purgeFiles([item],true);}}>{t("Permanently delete now","Xóa vĩnh viễn ngay")}</button>
                </span>
              </div>
            </li>;
          })}
        </ul>}
        {page&&(offset>0||page.hasMore)&&<nav className="storage-media-actions" aria-label={t("Pages for this list","Các trang của danh sách này")}>
          <button className="text-link" type="button" title={progress||(!offset?t("This is the first page.","Đây là trang đầu tiên."):undefined)} disabled={!!busy||offset===0} onClick={()=>void loadPage(selected,offset-pageSize)}>{t("Previous","Trước")}</button>
          <span>{t("Page","Trang")} {Math.floor(offset/pageSize)+1}</span>
          <button className="text-link" type="button" title={progress||(!page.hasMore?t("This is the last page.","Đây là trang cuối cùng."):undefined)} disabled={!!busy||!page.hasMore} onClick={()=>void loadPage(selected,offset+pageSize)}>{t("Next","Tiếp")}</button>
        </nav>}
      </section>}
      </div>
    </div>
  </details>;
}
