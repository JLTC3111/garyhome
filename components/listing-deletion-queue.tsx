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
type MediaFile = InventoryItem & {listing_code?:string|null; object_id?:string; object_version?:string|null;
  listing_title_en?:string|null; listing_title_vi?:string|null; saved_reference?:boolean;
  eligible_at?:string|null; legacy_expiry?:string|null; scheduled_eligible?:boolean; manual_target?:TrashTarget|null};
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
type PageKind = "inventory_page"|"trash_page"|"removed_page"|"run_page"|"retention_page";
type MediaPage = {items:(MediaFile|MediaItem|RemovedItem|MediaRun)[]; hasMore:boolean; available:boolean; automatic?:boolean; manualCount?:number};
type Observation = {status:"idle"|"running"|"complete"|"failed"|"busy";checked:number;total:number;recorded:number;reset:number;
  lastSuccessfulAt:string|null;error:string|null};
type MediaAction = "overview"|"inventory_scan"|"trash"|"restore"|"run";
type PanelAction = MediaAction|PageKind|"purge"|"cancel_purge"|"check_receipt"|"verify_unused";
const pageSize=30;
const trashId=(item:TrashTarget)=>item.id;
const unusedTarget=(item:unknown):item is TrashTarget=>isTrashTarget(item)&&item.source==="unused_listing";
const trashTarget=(item:unknown):item is TrashTarget=>isTrashTarget(item)&&item.source===undefined;
const isMediaFilePage=(page:PageKind|null)=>page==="inventory_page"||page==="retention_page";

function MediaFilePreview({bucket,path,filename}:{bucket:string;path:string;filename:string}) {
  const {t}=useSite();
  const [open,setOpen]=useState(false),[failed,setFailed]=useState(false);
  const parts=path.split("/");
  if(!["property-media","listing-videos"].includes(bucket)||parts.some(part=>!part||part==="."||part===".."))return null;
  const url=`${PROPERTY_IMAGE_ORIGIN}/storage/v1/object/public/${bucket}/${parts.map(encodeURIComponent).join("/")}`;
  const label=t(`Preview ${filename}`,`Xem trước ${filename}`);
  return <details onToggle={event=>{setOpen(event.currentTarget.open);setFailed(false);}}>
    <summary aria-label={label}>{t("Preview file","Xem trước tệp")}</summary>
    {open&&(failed?<small role="status">{t("The preview couldn’t load.","Không tải được bản xem trước.")}</small>:
      bucket==="listing-videos"?<video src={url} controls playsInline preload="metadata" className="storage-file-preview"
        aria-label={label} onError={()=>setFailed(true)}/>:
        <img src={url} alt={filename} decoding="async" className="storage-file-preview" onError={()=>setFailed(true)}/>)}
  </details>;
}

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
    case "observation_timeout": return t("Unused-file verification timed out. Retry to continue from the saved progress.","Xác minh tệp chưa sử dụng đã quá hạn. Thử lại để tiếp tục từ tiến độ đã lưu.");
    case "observation_setup": return t("Apply the unused-file verification migration to enable this action.","Áp dụng bản cập nhật xác minh tệp chưa sử dụng để bật thao tác này.");
    case "observation_unavailable": return t("Couldn’t retrieve the verification result. Refresh inventory to check saved progress.","Không lấy được kết quả xác minh. Làm mới kho để kiểm tra tiến độ đã lưu.");
    case "observation_busy": return t("Another media operation is in progress. Try verification again shortly.","Đang có thao tác khác trên tệp. Hãy thử xác minh lại sau giây lát.");
    case "observation_failed": return t("Unused-file verification failed. Retry to continue from the saved progress.","Không thể xác minh tệp chưa sử dụng. Thử lại để tiếp tục từ tiến độ đã lưu.");
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
    case "trash_run_interrupted": return t("This run was interrupted. The last request will be checked before continuing or cancelling.","Lượt xóa bị gián đoạn. Yêu cầu cuối sẽ được kiểm tra trước khi tiếp tục hoặc hủy.");
    case "removal_unconfirmed": return t("The last request’s outcome is unknown. Resume or cancel to check its receipt again.","Chưa xác nhận kết quả yêu cầu cuối. Tiếp tục hoặc hủy để kiểm tra lại biên nhận.");
    case "purge_timeout": return t("The deletion request timed out. Resume or cancel to check its receipt before continuing.","Yêu cầu xóa đã quá hạn. Tiếp tục hoặc hủy để kiểm tra biên nhận trước khi làm tiếp.");
    case "removal_in_progress": return t("The worker is still resolving the last file. Try again after it finishes.","Tác vụ vẫn đang xử lý tệp cuối. Hãy thử lại sau khi hoàn tất.");
    case "removal_verification_wait": return t("The last request may still reach the worker. Try again in up to a minute.","Yêu cầu cuối vẫn có thể tới tác vụ. Hãy thử lại trong vòng một phút.");
    case "selection_changed": return t("The file or its retention record changed after selection.","Tệp hoặc hồ sơ lưu giữ đã thay đổi sau khi chọn.");
    case "restored": return t("The file was restored while the batch was paused.","Tệp đã được khôi phục khi lượt xóa tạm dừng.");
    case "already_removed": return t("The file was removed by another cleanup.","Tệp đã được xóa bởi một lượt dọn khác.");
    case "no_longer_eligible": return t("The file is out of File Trash or otherwise ineligible.","Tệp đã rời Thùng rác hoặc không còn đủ điều kiện.");
    case "protected": return t("The live dependency or identity check kept this file.","Kiểm tra tham chiếu hoặc định danh hiện tại đã giữ lại tệp này.");
    case "storage_failure": return t("Storage didn’t confirm removal. Check Cleanup History.","Kho chưa xác nhận đã xóa. Hãy kiểm tra Lịch sử dọn tệp.");
    case "identity_changed": return t("The Storage object changed or is missing.","Đối tượng trong kho đã thay đổi hoặc không còn.");
    case "expired": return t("The restore window ended. This file goes through expired cleanup.","Đã hết hạn khôi phục. Tệp này được xử lý qua dọn tệp hết hạn.");
    case "owner_hold": return t("An Owner hold protects this file.","Chủ sở hữu đang bảo vệ tệp này.");
    case "recovery_hold": return t("Protected for GH-645 recovery.","Được giữ để khôi phục GH-645.");
    case "file_trash_test": return t("Protected File Trash test file.","Tệp thử trong Thùng rác được bảo vệ.");
    case "editing_session": return t("A recoverable edit protects this file.","Tệp này còn trong phiên chỉnh sửa có thể khôi phục.");
    case "retention_setup": return t("Apply the Home media retention migration to open the preview.","Áp dụng bản cập nhật lưu giữ tệp Home để mở bản xem trước.");
    case "retention_cleanup_setup": return t("Apply the unused-media removal migration to enable these controls.","Áp dụng bản cập nhật xóa tệp không sử dụng để bật các thao tác này.");
    case "inventory_controls_setup": return t("Apply the Inventory Files migration to verify and remove files here.","Áp dụng bản cập nhật danh sách tệp để xác minh và xóa tệp tại đây.");
    case "retention_worker_setup": return t("Update the cleanup worker to enable unused-media removal.","Cập nhật tác vụ dọn tệp để bật chức năng xóa tệp không sử dụng.");
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
  const [worker,setWorker]=useState<{status:"checking"|"ready"|"unavailable";cronConfigured?:boolean;manualUnused?:boolean;issue?:unknown}|null>(null);
  const [workerAttempt,setWorkerAttempt]=useState(0);
  const ownerKey=`gary-home:media:${user?.id??""}`;
  const trashSelection=useMediaSelection(`${ownerKey}:trash-selection`,trashId,trashTarget);
  const unusedSelection=useMediaSelection(`${ownerKey}:unused-selection`,trashId,unusedTarget);
  const selectionFor=(source:TrashTarget["source"])=>source?unusedSelection:trashSelection;
  const checkpointKey=`${ownerKey}:trash-run`;
  const [trashRun,setTrashRun]=useState<TrashRun|null>(null),[checkpointReady,setCheckpointReady]=useState(false);
  const [selectionRun,setSelectionRun]=useState<TrashRun|null>(null);
  const [checkpointIssue,setCheckpointIssue]=useState("");
  const [runClock,setRunClock]=useState<TrashRunClock|null>(null),[stopping,setStopping]=useState(false);
  const [trashFilter,setTrashFilter]=useState("");
  const [retentionInput,setRetentionInput]=useState(""),[retentionQuery,setRetentionQuery]=useState("");
  const [pageError,setPageError]=useState("");
  const [observation,setObservation]=useState<Observation|null>(null),[observationError,setObservationError]=useState<unknown>(null);
  const observationRead=useRef(0);
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
  const observingFiles=visible&&open&&isMediaFilePage(selected);
  const observationRequest=useCallback(async(verify=false)=>{
    const result=await requestMedia<Observation>({action:verify?"verify_unused":"observation_status"});
    if(!["idle","running","complete","failed","busy"].includes(result.status)||![result.checked,result.total,result.recorded,result.reset].every(Number.isSafeInteger))
      throw new Error("observation_unavailable");
    return result;
  },[requestMedia]);
  const readObservation=useCallback(async()=>{
    const read=++observationRead.current;
    try {
      const result=await observationRequest();
      if(active.current&&read===observationRead.current){setObservation(result);setObservationError(null);}
    }catch(issue){if(active.current&&read===observationRead.current)setObservationError(issue);}
  },[observationRequest]);

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
    void requestMedia<{status:string;cronConfigured:boolean;manualUnused?:boolean}>({action:"worker_status"}).then(health=>{
      if(health.status!=="ok")throw new Error("cleanup_worker_unavailable");
      if(current)setWorker({status:"ready",cronConfigured:health.cronConfigured,manualUnused:health.manualUnused});
    }).catch(issue=>{if(current)setWorker({status:"unavailable",issue});});
    return ()=>{current=false;};
  },[open,requestMedia,workerAttempt]);

  useEffect(()=>{
    if(!observingFiles)return;
    void readObservation();
    return ()=>{observationRead.current++;};
  },[observingFiles,readObservation]);

  useEffect(()=>{
    if(!visible||!open||!page?.items.length||(selected!=="trash_page"&&!isMediaFilePage(selected)))return;
    const expire=page.items.map(row=>Date.parse(("eligible_at" in row?row.eligible_at??row.legacy_expiry:
      "expires_at" in row?row.expires_at:null)||"")).filter(time=>time>Date.now());
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
    if(removal)setRemovalError("");
    try{await operation();}
    catch(issue){(removal?setRemovalError:setError)(mediaMessage(issue,t));}
    finally{
      if(action==="purge"){setRunClock(null);setStopping(false);setSelectionRun(null);}
      flight.current=false;setBusy(null);
    }
  }
  async function pageRequest(kind:PageKind,next:number,query=retentionQuery) {
    const result=await requestMedia<MediaPage>({action:kind,offset:next,...(isMediaFilePage(kind)?{query}:{})});
    if(!Array.isArray(result.items)||typeof result.available!=="boolean"||typeof result.hasMore!=="boolean")
      throw new Error("inventory_unavailable");
    return result;
  }
  async function loadPage(kind:PageKind,next=0,query=retentionQuery) {
    if(flight.current||!upgraded)return;
    if(kind!==selected||offset!==next||(isMediaFilePage(kind)&&query!==retentionQuery))
      setPage(kind==="removed_page"&&next===0?historyPreview:null);
    if(isMediaFilePage(kind))setRetentionQuery(query);
    setReviewOpen(false);setSelected(kind);setOffset(next);setPageError("");
    await work(kind,async()=>{
      try {applyPage(kind,await pageRequest(kind,next,query));}
      catch(issue) {if(active.current)setPageError(mediaMessage(issue,t));}
    });
  }
  function applyPage(kind:PageKind,fresh:MediaPage) {
    setPage(fresh);setPageError("");setNow(Date.now());
    if(isMediaFilePage(kind)&&fresh.manualCount!==undefined&&unusedSelection.rows.length){
      const rows=fresh.items as MediaFile[];
      const visibleNames=new Set(rows.map(row=>row.bucket+"/"+row.name));
      const live=rows.map(row=>row.manual_target).filter(unusedTarget);
      const matches=new Set(matchingTrashTargets(unusedSelection.rows,live).map(row=>row.id));
      const stale=unusedSelection.rows.filter(row=>visibleNames.has(row.bucket+"/"+row.name)&&!matches.has(row.id));
      if(stale.length)unusedSelection.remove(stale.map(row=>row.id));
    }
    if(kind!=="trash_page"||!trashSelection.rows.length)return;
    const rows=fresh.items as MediaItem[];
    const visibleIds=new Set(rows.map(row=>row.id));
    const live=rows.flatMap(row=>row.state==="trashed"&&!row.purge_block&&isTrashTarget(row)?[row]:[]);
    const matches=new Set(matchingTrashTargets(trashSelection.rows,live).map(row=>row.id));
    const stale=trashSelection.rows.filter(row=>Date.parse(row.expires_at)<=Date.now()||visibleIds.has(row.id)&&!matches.has(row.id));
    if(stale.length)trashSelection.remove(stale.map(row=>row.id));
  }
  async function refreshHistory() {
    const recent=await pageRequest("removed_page",0);
    if(active.current)setHistoryPreview(recent);
  }
  async function refreshAfterChange(includeHistory=false) {
    if(!active.current)return;
    const stats=overview().then(reportResult);
    const list=selected?pageRequest(selected,offset).then(async fresh=>{
      if(offset>0&&!fresh.items.length){fresh=await pageRequest(selected,0);setOffset(0);}
      if(active.current)applyPage(selected,fresh);
    }).catch(issue=>{if(active.current)setPageError(mediaMessage(issue,t));}):null;
    const reads=list?[stats,list]:[stats];
    if(includeHistory&&(selected!=="removed_page"||offset!==0))reads.push(refreshHistory());
    const results=await Promise.allSettled(reads);
    const failure=results.find(result=>result.status==="rejected");
    if(failure&&active.current)setError(mediaMessage(failure.reason,t));
  }
  async function verifyUnused() {
    if(flight.current)return;
    observationRead.current++;
    setObservationError(null);
    await work("verify_unused",async()=>{
      try {
        for(let batch=0;batch<8&&active.current;batch++){
          const result=await observationRequest(true);
          if(!active.current)return;
          setObservation(result);
          if(result.status!=="running")break;
        }
      }catch(issue){if(active.current)setObservationError(issue);}
      if(active.current)await refreshAfterChange();
    });
  }
  async function manage(action:MediaAction,item?:MediaItem) {
    if(flight.current)return;
    if(action==="trash"&&!window.confirm(t("Move the verified file to Trash with its existing restore deadline?","Chuyển tệp đã xác minh vào Thùng rác theo thời hạn khôi phục hiện tại?")))return;
    if(action==="run"&&!window.confirm(t("Permanently remove eligible files whose restore window has ended?","Xóa vĩnh viễn các tệp đủ điều kiện đã hết thời gian khôi phục?")))return;
    if(action==="restore"&&item?.restore_mode==="draft"&&!window.confirm(t("Restore this file to a new draft of the deleted listing?","Khôi phục tệp vào bản nháp mới của tin đăng đã xóa?")))return;
    async function perform() {
      if(action==="overview"){
        if(isMediaFilePage(selected))await Promise.all([refreshAfterChange(),readObservation()]);
        else reportResult(await overview());
        return;
      }
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
      if(action==="run"&&trashSelection.rows.length)await eligibleTargets();
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
  async function refreshInventoryCounts() {
    try { const fresh=await overview(); if(active.current)reportResult(fresh); }
    catch { /* The run's final refresh reports any outstanding read error. */ }
  }
  async function getReceipt(item:TrashTarget) {
    const receipt=await requestMedia<TrashReceipt>({action:item.source?"retention_receipt":"trash_receipt",id:item.id,expiresAt:item.expires_at});
    if(active.current && (receipt.status==="removed"||receipt.status==="already_removed")){
      selectionFor(item.source).remove([item.id]);
      if(item.source)await refreshInventoryCounts();
    }
    return receipt;
  }
  async function eligibleTargets(source?:TrashTarget["source"],query="") {
    const {items}=await requestMedia<{items:TrashTarget[]}>(source?{action:"retention_manifest",query}:{action:"trash_manifest"});
    if(!Array.isArray(items)||!items.every(source?unusedTarget:trashTarget))throw new Error("inventory_unavailable");
    const selection=selectionFor(source);
    const matches=new Set(matchingTrashTargets(selection.rows,items).map(item=>item.id));
    const stale=selection.rows.filter(item=>!matches.has(item.id));
    if(active.current&&!query&&stale.length)selection.remove(stale.map(item=>item.id));
    return items;
  }
  async function withCheckpointLock(operation:()=>Promise<void>) {
    if(!navigator.locks){await operation();return;}
    await navigator.locks.request(checkpointKey,{ifAvailable:true},async lock=>{
      if(!lock)throw new Error("trash_run_active");
      await operation();
    });
  }
  async function continueRun(run:TrashRun,{revalidate=false,pausedRun}:{revalidate?:boolean;pausedRun?:TrashRun}={}) {
    const source=run.entries[0]?.source,selection=selectionFor(source);
    const initialTotals=trashRunTotals(run);
    const clock:TrashRunClock={startedAt:performance.now(),elapsedBefore:run.timing?.elapsedMs??0,
      measuredBefore:run.timing?.measuredFiles??0,processedBefore:initialTotals.removed+initialTotals.skipped+initialTotals.failed};
    stopRequested.current=false;setRunClock(clock);setStopping(false);setResultText("");setRestoredHref("");
    let latestRun=run;
    let saved=pausedRun;
    function saveProgress(next:TrashRun) {
      const totals=trashRunTotals(next);
      const timing=trashRunTiming(clock,totals.removed+totals.skipped+totals.failed,performance.now());
      const checkpoint={...next,timing};
      if(saved){
        // The runner sends one request at a time. Keep it in the existing
        // receipt journal while preserving the paused run's manifest and timing.
        const individualRequest=next.entries.find(file=>file.outcome==="sent");
        let updated=individualRequest===saved.individualRequest?saved:{...saved,individualRequest};
        if(individualRequest&&next.issue)updated={...updated,state:"paused",issue:next.issue,issueItemId:individualRequest.id};
        const confirmed:string[]=[];
        for(const [index,file] of next.entries.entries()){
          if(file.outcome==="removed"&&latestRun.entries[index].outcome!=="removed"){
            updated=settlePausedTrashItem(updated,file,"removed",file.bytes);
            confirmed.push(file.id);
          }
        }
        if(!trashRunUnfinished(updated)&&updated.state==="paused")updated={...updated,state:"completed",issue:undefined,issueItemId:undefined};
        if(updated!==saved){saveRun(updated);saved=updated;}
        if(active.current){
          if(confirmed.length)selection.remove(confirmed);
          setSelectionRun(checkpoint);
        }
      }else{
        saveRun(checkpoint);
      }
      latestRun=checkpoint;
    }
    try{
      await processTrashRun(run,{
        async purge(payload,beforeSend){
          const result=await requestMedia<CleanupResult>(payload,beforeSend);
          if(source&&result.status==="ok"&&result.removed===1)await refreshInventoryCounts();
          return result;
        },receipt:getReceipt,
        save:saveProgress,stopped:()=>stopRequested.current||!active.current,
        eligible:revalidate?()=>eligibleTargets(source):undefined,
      });
    }catch(issue){
      const code=issue instanceof Error&&issue.name==="RequestTimeoutError"?"inventory_timeout":trashRunIssueCode(issue instanceof Error?issue.message:undefined);
      const failed:TrashRun={...latestRun,state:"failed",issue:code};
      try{saveProgress(failed);}
      catch{if(active.current)(pausedRun?setSelectionRun:setTrashRun)(failed);}
    }
    if(active.current){
      selection.remove(latestRun.entries.filter(item=>item.outcome!=="pending"&&item.outcome!=="sent").map(item=>item.id));
      if(pausedRun){
        const removed=latestRun.entries.filter(item=>item.outcome==="removed");
        if(removed.length){
          const size=formatSelection(removed);
          const confirmed=t(`Permanently deleted ${removed.length} of ${run.entries.length} selected files (${size}).`,
            `Đã xóa vĩnh viễn ${removed.length}/${run.entries.length} tệp đã chọn (${size}).`);
          setResultText(confirmed);notice(confirmed);
        }
        const issue=latestRun.issue||latestRun.entries.find(item=>item.outcome==="failed"||item.outcome==="skipped")?.reason;
        if(issue&&issue!=="stopped"&&!pendingTrashRequest(saved??null))setError(mediaMessage(new Error(issue),t));
      }
      await refreshAfterChange(true);
    }
  }
  async function purgeFiles(items:TrashTarget[]) {
    const source=items[0]?.source,selection=selectionFor(source);
    if(flight.current||!items.length||(source?unusedRemovalReason:manualRemovalReason))return;
    await work("purge",async()=>{
      await withCheckpointLock(async()=>{
        const existing=readSavedRun();
        if(pendingTrashRequest(existing)){setTrashRun(existing);throw new Error("removal_unconfirmed");}
        const pausedRun=existing&&trashRunUnfinished(existing)?existing:undefined;
        const single=items.length===1?await getReceipt(items[0]):null;
        const live=single?(single.status==="eligible"?[{...items[0],bytes:single.bytes??items[0].bytes}]:[]):
          await eligibleTargets(source);
        const eligible=matchingTrashTargets(items,live),eligibleIds=new Set(eligible.map(item=>item.id));
        const excluded=items.length-eligible.length;
        if(!active.current)return;
        selection.remove(items.filter(item=>!eligibleIds.has(item.id)).map(item=>item.id));
        if(!eligible.length){
          setRemovalError(single?mediaMessage(new Error(single.status==="eligible"?"selection_changed":single.status),t):
            t("The selected files are no longer eligible. Refresh the list.","Các tệp đã chọn không còn đủ điều kiện. Hãy làm mới danh sách."));
          await refreshAfterChange();return;
        }
        const size=formatSelection(eligible);
        const confirmation=source?t(`Permanently delete ${eligible.length} verified unused files (${size})?`,
          `Xóa vĩnh viễn ${eligible.length} tệp không sử dụng đã xác minh (${size})?`):
          t(`Permanently delete ${eligible.length} selected files (${size}) before their restore windows end?`,
            `Xóa vĩnh viễn ${eligible.length} tệp đã chọn (${size}) trước khi hết hạn khôi phục?`);
        const skipped=excluded?t(` ${excluded} changed or ineligible files will be skipped.`,` Sẽ bỏ qua ${excluded} tệp thay đổi hoặc không đủ điều kiện.`):"";
        if(!window.confirm(confirmation+skipped))return;
        const run=makeTrashRun(items);
        for(const item of run.entries)if(!eligibleIds.has(item.id)){item.outcome="skipped";item.reason="selection_changed";}
        await continueRun(run,{pausedRun});
      });
    });
  }
  async function resumePurge() {
    if(flight.current||resumeReason)return;
    await work("purge",()=>withCheckpointLock(async()=>{
      const saved=readSavedRun();
      if(saved&&trashRunUnfinished(saved))await continueRun(saved,{revalidate:true});
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
      selectionFor(cancelled.entries[0]?.source).remove(cancelled.entries.map(item=>item.id));
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
        selectionFor(reconciled.entries[0]?.source).remove(reconciled.entries.filter(item=>item.outcome==="removed").map(item=>item.id));
        await refreshAfterChange(true);
      }
    }));
  }
  async function selectAllTargets(source?:TrashTarget["source"]) {
    if(flight.current||(source?allUnusedReason:allSelectionReason))return;
    await work(source?"retention_page":"trash_page",async()=>{
      const all=await eligibleTargets(source,source?retentionQuery:"");
      if(active.current)selectionFor(source).add(all);
    });
  }

  const paused=t("Permanent cleanup is disabled by the Home retention policy.","Chính sách lưu giữ Home đang tắt chức năng xóa vĩnh viễn.");
  const upgrade=t("Apply the Home media panel pagination migration first.","Áp dụng bản cập nhật phân trang kho Home trước.");
  const bulkActive=busy==="purge"||busy==="cancel_purge";
  const unfinished=trashRunUnfinished(trashRun);
  const displayedRun=selectionRun??trashRun;
  const preparing=busy==="purge"&&!runClock;
  const processing=busy==="purge"&&(preparing||displayedRun?.state==="running");
  const pendingFile=pendingTrashRequest(trashRun);
  const removalState:TrashOperationState=processing?(stopping?"stopping":"running"):
    removalError&&!unfinished?"failed":displayedRun?.state??"idle";
  const removalDetailsId=`${id}-removal-details`;
  const checkingUnused=busy==="verify_unused";
  const observationIssue=observationError||((observation?.status==="busy"||observation?.status==="failed")?
    new Error(observation.status==="busy"?"observation_busy":observation.error||"observation_failed"):null);
  const progress=busy==="inventory_scan"?t("Scanning storage and checking queued files…","Đang quét kho và kiểm tra tệp trong hàng đợi…"):
    checkingUnused?t("Checking listing media for unused files…","Đang kiểm tra tệp chưa sử dụng trong tin đăng…"):
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
  const unusedSetup=worker?.status==="ready"&&!worker.manualUnused?mediaMessage(new Error("retention_worker_setup"),t):
    selected==="retention_page"&&page&&page.manualCount===undefined?mediaMessage(new Error("retention_cleanup_setup"),t):"";
  const inventoryControls=selected==="inventory_page"&&page&&page.manualCount===undefined?mediaMessage(new Error("inventory_controls_setup"),t):"";
  const resumeReason=removalReason||checkpointReason||(trashRun?.entries[0]?.source?unusedSetup:bulkSetup);
  const manualRemovalReason=removalReason||checkpointReason||bulkSetup||pendingRequestReason||(!report?.earlyEligible?noEarly:"");
  const unusedRemovalReason=removalReason||checkpointReason||unusedSetup||inventoryControls||pendingRequestReason||
    (isMediaFilePage(selected)?pageError:"");
  const bulkEntryReason=removalReason||bulkSetup||(!report?.earlyEligible?noEarly:"");
  const controlReasons=[...new Set([trashReason,runReason,bulkEntryReason].filter(reason=>reason&&reason!==pendingRequestReason))];
  const controlHint=(reason:string)=>!reason?undefined:reason===pendingRequestReason?removalDetailsId:`${id}-operation-${controlReasons.indexOf(reason)}`;
  const eligibleCount=(count:number|undefined)=>count===undefined?"—":number.format(count);
  const tabs:[PageKind,string][]=[["inventory_page",t("Inventory files","Tệp trong kho")],["retention_page",t("Retention preview","Dự kiến lưu giữ")],["trash_page",t("File Trash","Thùng rác tệp")],
    ["removed_page",t("Cleanup History","Lịch sử dọn tệp")],["run_page",t("Cleanup runs","Các lượt dọn tệp")]];
  function reasonLabel(reason:string){
    switch(reason){
      case "reference":return t("Protected · saved reference","Được bảo vệ · có tham chiếu đã lưu");
      case "upload":return t("Protected · active upload","Được bảo vệ · đang tải lên");
      case "listing": case "scope_retention":return t("Listing folder · verification required","Thư mục tin đăng · cần xác minh");
      case "outside_listing_scope":return t("Outside the listing-scoped cleanup policy","Ngoài phạm vi dọn tệp theo tin đăng");
      case "owner_hold": case "recovery_hold": case "file_trash_test": case "editing_session":return mediaMessage(new Error(reason),t);
      case "active_upload":return t("Protected · active upload","Được bảo vệ · đang tải lên");
      case "filename_match":return t("Protected · saved filename matches, exact object unverified","Được bảo vệ · tên tệp khớp nội dung đã lưu, chưa xác minh đúng đối tượng");
      case "identity":return t("Protected · Storage identity needs verification","Được bảo vệ · cần xác minh định danh kho");
      case "legacy_lifecycle":return t("Existing cleanup or recovery record","Đã có hồ sơ dọn tệp hoặc khôi phục");
      case "awaiting_observation":return t("Awaiting first unused observation","Chờ lần đầu xác nhận chưa sử dụng");
      case "waiting":return t("Verified unused · 96-hour inactivity window","Đã xác minh chưa sử dụng · thời hạn 96 giờ");
      case "eligible":return t("96 hours of inactivity verified","Đã xác minh 96 giờ không sử dụng");
      case "removing":return t("Cleanup in progress","Đang dọn tệp");
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
    if(item.purge_block&&["owner_hold","recovery_hold","file_trash_test","editing_session"].includes(item.purge_block))return mediaMessage(new Error(item.purge_block),t);
    if(!item.expires_at||!Number.isFinite(Date.parse(item.expires_at)))return t("The restore deadline is unavailable. Reload File Trash.","Không có hạn khôi phục. Hãy tải lại Thùng rác.");
    if(!isTrashTarget(item))return t("Reload File Trash to get the file identity and size.","Tải lại Thùng rác để lấy định danh và dung lượng tệp.");
    if(Date.parse(item.expires_at)<=now)return t("The restore window ended. Use Run expired-file cleanup.","Đã hết hạn khôi phục. Hãy chạy Dọn tệp hết hạn.");
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
  const bulkReason=manualRemovalReason||selectionReason||(!trashSelection.rows.length?noSelection:"");
  const fileRows=isMediaFilePage(selected)?(page?.items as MediaFile[]|undefined)??[]:[];
  const unusedPageEligible=fileRows.map(row=>row.manual_target).filter(unusedTarget);
  const unusedSelectionReason=!unusedSelection.ready?t("Loading saved selection…","Đang tải lựa chọn đã lưu…"):busy?progress:"";
  const allUnusedReason=unusedSelectionReason||unusedRemovalReason||(!page?.manualCount?
    t("No verified unused files match this search.","Không có tệp chưa sử dụng đã xác minh khớp tìm kiếm."):"");
  const unusedPageReason=unusedSelectionReason||unusedRemovalReason||(!unusedPageEligible.length?
    t("No eligible files on this page.","Trang này chưa có tệp đủ điều kiện."):"");
  const unusedBulkReason=unusedRemovalReason||unusedSelectionReason||(!unusedSelection.rows.length?
    t("Select verified unused files.","Chọn tệp chưa sử dụng đã xác minh."):"");
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
  function retentionTime(expiry:string){
    const minutes=Math.max(0,Math.ceil((Date.parse(expiry)-now)/60_000));
    const hours=Math.floor(minutes/60),rest=minutes%60;
    return t(`${hours}h ${rest}m remaining`, `Còn ${hours} giờ ${rest} phút`);
  }

  return <details className="admin-panel listing-deletion-queue storage-media" hidden={!visible} onToggle={event=>{
    if(event.target!==event.currentTarget)return;
    const isOpen=event.currentTarget.open;setOpen(isOpen);
    if(visible&&isOpen&&!flight.current)void manage("overview");
  }}>
    <summary>{t("Storage & Media Management","Quản lý kho lưu trữ và tệp")}</summary>
    <div className="storage-media-body">
      <MediaRemovalProgress run={removalError&&!unfinished?null:displayedRun} state={removalState} clock={processing?runClock:null}
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
        {pageError&&<p role="alert">{pageError} {page?.items.length?t("Showing the last loaded files.","Đang hiển thị các tệp đã tải trước đó."):null}</p>}
        {isMediaFilePage(selected)&&<>
          {!inventoryControls&&<form className="storage-media-actions" onSubmit={event=>{event.preventDefault();void loadPage(selected,0,retentionInput.trim());}}>
            <MediaSearchField label={t("Listing code, title or filename","Mã, tiêu đề tin đăng hoặc tên tệp")} placeholder={t("Listing code, title or filename","Mã, tiêu đề tin đăng hoặc tên tệp")}
              value={retentionInput} maxLength={120} disabled={!!busy}
              onChange={setRetentionInput} onClear={()=>{setRetentionInput("");void loadPage(selected,0,"");}}/>
            <button type="submit" className="button button-outline button-small" disabled={!!busy}>{t("Search","Tìm")}</button>
          </form>}
          {page?.automatic!==undefined&&<p>{page.automatic?t("Eligible unused files can be picked up by the next hourly cleanup.","Tệp chưa sử dụng đã đủ điều kiện có thể được dọn trong lượt hằng giờ kế tiếp."):
            t("The 96-hour policy is in preview. Scheduled removal under this policy is paused.","Chính sách 96 giờ đang ở chế độ xem trước. Lịch xóa theo chính sách này đang tạm dừng.")}</p>}
          <div className="storage-media-observation">
            <button type="button" className="button button-outline button-small" disabled={!!busy} onClick={()=>void verifyUnused()}>
              {t("Verify unused files","Xác minh tệp chưa sử dụng")}</button>
            {observation&&<p>{t("Last successful observation","Lần xác minh thành công gần nhất")} <strong>{observation.lastSuccessfulAt?
              formatTime(observation.lastSuccessfulAt):t("None yet","Chưa có")}</strong></p>}
            {(checkingUnused||observation?.status==="running")&&<progress
              aria-label={t("Unused-file verification progress","Tiến độ xác minh tệp chưa sử dụng")}
              max={observation?.status==="running"?Math.max(observation.total,1):undefined}
              value={observation?.status==="running"?observation.checked:undefined}/>}
            {observation&&observation.status!=="idle"&&<p role="status">{t(
              `${number.format(observation.checked)} of ${number.format(observation.total)} checked · ${number.format(observation.recorded)} newly verified · ${number.format(observation.reset)} timers cleared`,
              `Đã kiểm tra ${number.format(observation.checked)}/${number.format(observation.total)} · ${number.format(observation.recorded)} tệp mới xác minh · Đã xóa ${number.format(observation.reset)} bộ đếm thời gian`)}</p>}
            {observation?.status==="running"&&!checkingUnused&&<p>{t("Select Verify unused files to continue the remaining checks.","Chọn Xác minh tệp chưa sử dụng để tiếp tục kiểm tra.")}</p>}
            {!!observationIssue&&<p role="alert">{mediaMessage(observationIssue,t)}</p>}
          </div>
          {page?.available&&<MediaSelectionControls count={unusedSelection.rows.length} bytes={unusedSelection.rows.reduce((sum,item)=>sum+(item.bytes??0),0)}
            unknownSizes={unusedSelection.rows.filter(item=>item.bytes===null).length} formatBytes={formatBytes}
            pageCount={unusedPageEligible.length} pageSelected={unusedPageEligible.filter(item=>unusedSelection.has(item.id)).length}
            allReason={allUnusedReason} pageReason={unusedPageReason} clearReason={unusedSelectionReason||(!unusedSelection.rows.length?t("Selection is empty.","Chưa chọn tệp nào."):"")}
            selectAll={()=>void selectAllTargets("unused_listing")} selectPage={()=>unusedSelection.add(unusedPageEligible)}
            clearPage={()=>unusedSelection.remove(unusedPageEligible.map(trashId))} clear={unusedSelection.clear}>
            <button type="button" className="button button-outline button-small" data-button-variant="danger" disabled={!!unusedBulkReason}
              aria-describedby={unusedBulkReason?`${id}-unused-bulk`:undefined} onClick={()=>void purgeFiles(unusedSelection.rows)}>{t("Permanently delete selected","Xóa vĩnh viễn mục đã chọn")}</button>
            {unusedBulkReason&&<small id={`${id}-unused-bulk`}>{unusedBulkReason}</small>}
          </MediaSelectionControls>}
        </>}
        {selected==="trash_page"&&<>
          <MediaSearchField label={t("Filter this page by filename","Lọc trang này theo tên tệp")}
            placeholder={t("Filter this page by filename","Lọc trang này theo tên tệp")} value={trashFilter}
            onChange={setTrashFilter} onClear={()=>setTrashFilter("")}/>
          <MediaSelectionControls count={trashSelection.rows.length} bytes={trashSelection.rows.reduce((sum,item)=>sum+(item.bytes??0),0)}
            unknownSizes={trashSelection.rows.filter(item=>item.bytes===null).length} formatBytes={formatBytes}
            pageCount={pageEligible.length} pageSelected={pageEligible.filter(item=>trashSelection.has(item.id)).length}
            allReason={allSelectionReason} pageReason={pageSelectionReason} clearReason={selectionReason||(!trashSelection.rows.length?t("Selection is empty.","Chưa chọn tệp nào."):"")}
            selectAll={()=>void selectAllTargets()} selectPage={()=>trashSelection.add(pageEligible)}
            clearPage={()=>trashSelection.remove(pageEligible.map(trashId))} clear={trashSelection.clear}>
            <button type="button" className="button button-outline button-small" data-button-variant="danger"
              title={bulkReason||undefined} aria-describedby={bulkReason?`${id}-bulk`:undefined} disabled={!!bulkReason}
              onClick={()=>void purgeFiles(trashSelection.rows)}>{t("Permanently delete selected","Xóa vĩnh viễn mục đã chọn")}</button>
            {bulkReason&&<small id={`${id}-bulk`}>{bulkReason}</small>}
          </MediaSelectionControls>
          {!!page?.items.length&&!visibleTrash.length&&<p>{t("No filenames on this page match the filter.","Không có tên tệp trên trang này khớp bộ lọc.")}</p>}
        </>}
        {(!page||pageError)&&!busy&&<button type="button" className="text-link" onClick={()=>void loadPage(selected,offset)}>{t("Refresh this list","Làm mới danh sách này")}</button>}
        {!pageError&&page&&!page.available&&<p>{t("Run a storage scan to view the inventory files.","Hãy quét kho để xem danh sách tệp.")}</p>}
        {!pageError&&page?.available&&!page.items.length&&<p>{selected==="trash_page"?t("No files in Trash.","Thùng rác chưa có tệp."):
          selected==="run_page"?t("No cleanup runs recorded.","Chưa ghi nhận lượt dọn tệp."):t("No records on this page.","Trang này không có mục nào.")}</p>}
        {page?.available&&<ul className="storage-media-rows">
          {fileRows.map((row,index)=>{
            const target=unusedTarget(row.manual_target)?row.manual_target:null;
            const checked=!!target&&unusedSelection.has(target.id);
            const name=row.name.split("/").at(-1)||row.name;
            const title=language==="vi"?row.listing_title_vi||row.listing_title_en:row.listing_title_en||row.listing_title_vi;
            const listing=[row.listing_code,title].filter(Boolean).join(" · ");
            const protection=row.reason==="legacy_lifecycle"&&row.legacy_expiry?
              t("Managed by the File Trash lifecycle","Đang theo quy trình Thùng rác tệp"):reasonLabel(row.reason);
            const removalBlock=target?unusedRemovalReason:inventoryControls||protection;
            const pickReason=unusedSelectionReason||(checked?"":removalBlock);
            const hint=`${id}-${row.object_id??index}-file`;
            return <li key={row.bucket+"/"+row.name} className="storage-file-row">
              <div><strong>{name}</strong>
                <small>{row.bucket} · {row.bytes===null?"—":formatBytes(row.bytes)}</small>
                {listing?<small>{listing}</small>:row.saved_reference!==undefined&&<small>{t("No associated saved listing","Chưa có tin đăng đã lưu liên quan")}</small>}
                <small>{row.saved_reference===true?t("Exact saved reference found","Có tham chiếu chính xác đã lưu"):
                  row.saved_reference===false?t("Exact saved references · none","Tham chiếu chính xác đã lưu · không có"):
                    t("Saved reference status unverified","Chưa xác minh tham chiếu đã lưu")}</small>
                <small id={hint}>{protection}</small>
                {removalBlock&&removalBlock!==protection&&<small id={`${hint}-block`}>{removalBlock}</small>}
                {row.eligible_at&&row.reason!=="removing"&&<small>{retentionTime(row.eligible_at)} · {t("Eligible from","Đủ điều kiện từ")} {formatTime(row.eligible_at)}</small>}
                {row.legacy_expiry&&<small>{countdown(row.legacy_expiry)} · {formatTime(row.legacy_expiry)}</small>}
                {row.scheduled_eligible&&<small>{t("Eligible for scheduled cleanup","Đủ điều kiện dọn theo lịch")}</small>}
                <MediaFilePreview key={row.object_id+":"+row.object_version} bucket={row.bucket} path={row.name} filename={name}/>
                <details><summary>{t("Storage identity","Định danh kho")}</summary><small>{[row.name,row.object_id,row.object_version].filter(Boolean).join(" · ")}</small></details>
              </div>
              <div className="storage-media-actions">
                <label title={pickReason||undefined}><input type="checkbox" checked={checked} disabled={!!pickReason} aria-describedby={hint}
                  aria-label={t(`Select ${name}`,`Chọn ${name}`)} onChange={event=>{if(target){
                    if(event.target.checked)unusedSelection.add([target]);else unusedSelection.remove([target.id]);
                  }}}/>{t("Select","Chọn")}</label>
                <button type="button" className="button button-outline button-small" data-button-variant="danger"
                  aria-label={t(`Permanently delete ${name}`,`Xóa vĩnh viễn ${name}`)} disabled={!!removalBlock} title={removalBlock||undefined}
                  aria-describedby={removalBlock&&removalBlock!==protection?`${hint}-block`:hint}
                  onClick={()=>{if(target)void purgeFiles([target]);}}>{t("Permanently delete now","Xóa vĩnh viễn ngay")}</button>
              </div>
            </li>;
          })}
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
            const deleteReason=manualRemovalReason||earlyReason;
            const restoreHint=busy?(controlReasons.includes(progress)?controlHint(progress):`${id}-working`):
              item.id===pendingFile?.id?removalDetailsId:hint;
            const deleteHint=manualRemovalReason?(manualRemovalReason===pendingRequestReason?removalDetailsId:`${id}-bulk`):
              deleteReason===reason?restoreHint:earlyHint;
            return <li key={item.id}>
              <div><strong>{name}</strong><small>{item.bucket} · {item.bytes==null?"—":formatBytes(item.bytes)} · {countdown(item.expires_at)} · {formatTime(item.expires_at)}</small>
                {item.purge_block&&["owner_hold","recovery_hold","file_trash_test","editing_session"].includes(item.purge_block)&&<small>{earlyReason}</small>}
                {reason&&restoreHint===hint&&<span className="sr-only" id={hint}>{reason}</span>}
                {earlyReason&&!manualRemovalReason&&earlyReason!==reason&&<span className="sr-only" id={earlyHint}>{earlyReason}</span>}
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
                    onClick={()=>{if(isTrashTarget(item))void purgeFiles([item]);}}>{t("Permanently delete now","Xóa vĩnh viễn ngay")}</button>
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
