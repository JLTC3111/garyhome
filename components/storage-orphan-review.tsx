"use client";

import {useEffect,useRef,useState} from "react";
import {mediaBatchSize} from "@/lib/home-media-trash";
import {useSite} from "./site-context";
import {MediaSelectionControls,useMediaSelection} from "./media-selection";

type ReviewRequest = <T>(payload:Record<string,unknown>)=>Promise<T>;
type Row = {
  bucket:string;key:string;objectId:string|null;version:string|null;etag:string|null;bytes:number|null;
  listingCode:string|null;listingStatus:string|null;held:boolean;reason:string;
};
type Page = {items:Row[];available:boolean;hasMore:boolean;holds:number};
const pageSize=30;
const rowKey=(row:Row)=>row.bucket+"/"+row.key;
const hasIdentity=(row:Row)=>Boolean(row.objectId&&row.version&&row.etag&&row.bytes!==null);
const identity=(row:Row)=>({bucket:row.bucket,key:row.key,objectId:row.objectId,version:row.version,etag:row.etag,bytes:row.bytes});
const verificationKey=(row:Row)=>JSON.stringify(identity(row));
const canBulkVerify=(row:Row)=>hasIdentity(row)&&(row.reason==="potential"||row.reason==="verified");
function validSelection(value:unknown):value is Row {
  if(!value||typeof value!=="object")return false;
  const row=value as Row;
  return typeof row.bucket==="string"&&typeof row.key==="string"&&typeof row.objectId==="string"&&typeof row.version==="string"&&
    typeof row.etag==="string"&&Number.isSafeInteger(row.bytes)&&(row.bytes??-1)>=0;
}

export function StorageOrphanReview({request,disabled,onStaged}: {request:ReviewRequest;disabled:boolean;onStaged:()=>void}) {
  const {t,language,notice,user}=useSite();
  const [query,setQuery]=useState(""),[search,setSearch]=useState(""),[offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
  const [page,setPage]=useState<Page|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const selection=useMediaSelection(`gary-home:media:${user?.id??""}:orphan-selection`,rowKey,validSelection);
  const [verified,setVerified]=useState<Record<string,string>>({}),[selecting,setSelecting]=useState(false);
  const [working,setWorking]=useState(false),[progress,setProgress]=useState({done:0,total:0});
  const active=useRef(true),flight=useRef(false);
  const busy=disabled||loading||working;
  const locale=language==="vi"?"vi-VN":"en";
  const size=new Intl.NumberFormat(locale,{style:"unit",unit:"megabyte",maximumFractionDigits:3});
  const listingStatus=(state:string|null)=>state==="draft"?t("Draft","Bản nháp"):state==="published"?t("Published","Đã xuất bản"):
    state==="archived"?t("Archived","Đã lưu trữ"):state;

  function reason(code:string) {
    switch(code){
      case "listing":return t("Protected · saved listing path","Được bảo vệ · thuộc đường dẫn tin đã lưu");
      case "owner_hold":return t("Protected · Owner hold","Được bảo vệ · Chủ sở hữu đang giữ");
      case "upload":return t("Protected · upload in progress","Được bảo vệ · đang tải lên");
      case "rename":return t("Protected · rename record","Được bảo vệ · có hồ sơ đổi tên");
      case "reference":return t("Protected · saved link or filename match","Được bảo vệ · khớp liên kết hoặc tên tệp đã lưu");
      case "tracked":return t("Protected · existing media ledger entry","Được bảo vệ · đã có mục trong sổ theo dõi tệp");
      case "video_review":return t("Protected · untracked video needs separate custody review","Được bảo vệ · video ngoài sổ cần kiểm tra nguồn riêng");
      case "identity": case "manifest_changed":return t("Protected · Storage identity changed or incomplete. Scan again.","Được bảo vệ · định danh kho đã thay đổi hoặc chưa đủ. Hãy quét lại.");
      case "review":return t("Protected · unresolved review","Được bảo vệ · chưa hoàn tất kiểm tra");
      case "evidence_required":return t("Dependency check clear. Verified backup and custody evidence required.","Đã kiểm tra tham chiếu. Cần bản sao đã xác minh và bằng chứng nguồn tệp.");
      case "inventory_timeout":return t("The check timed out. Verify this file again when storage is responsive.","Kiểm tra đã quá hạn. Hãy thử lại khi kho lưu trữ phản hồi.");
      case "media_busy":return t("Media is being updated. Refresh before trying again.","Tệp đang được cập nhật. Làm mới trước khi thử lại.");
      case "invalid_manifest":return t("Check the exact file identity and backup receipt details.","Kiểm tra định danh tệp và thông tin bản sao lưu.");
      case "scan_required":return t("Run a storage scan to load review candidates.","Hãy quét kho để tải tệp cần kiểm tra.");
      case "orphan_review_setup":return t("Apply the Home orphan review migration to open this list.","Áp dụng bản cập nhật rà soát tệp thừa Home để mở danh sách.");
      case "forbidden":return t("This review requires the protected Gary Home Owner.","Cần quyền Chủ sở hữu Gary Home được bảo vệ để kiểm tra.");
      case "session_expired":return t("Sign in again before continuing the review.","Đăng nhập lại trước khi tiếp tục kiểm tra.");
      case "potential":return t("Potential orphan · custody unconfirmed","Tệp có thể bị bỏ lại · chưa xác nhận nguồn");
      default:return t("The review could not be confirmed. Refresh the file and try again.","Chưa xác nhận được lượt kiểm tra. Làm mới tệp rồi thử lại.");
    }
  }
  const issueCode=(issue:unknown)=>issue instanceof Error?issue.message:"unavailable";
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>{
    let current=true;
    setLoading(true);setError("");
    void request<Page>({action:"orphan_page",offset,query:search}).then(result=>{
      if(current)setPage(result);
    }).catch(issue=>{if(current){setPage(null);setError(issueCode(issue));}}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[request,offset,search,revision]);

  async function selectAll() {
    if(busy||flight.current||!selection.ready)return;
    flight.current=true;setWorking(true);setSelecting(true);setError("");setProgress({done:0,total:0});
    const checked:Row[]=[];
    try{
      for(let at=0;active.current;at+=pageSize){
        const result=await request<Page>({action:"orphan_page",offset:at,query:search});
        if(!result.available)throw new Error("scan_required");
        checked.push(...result.items.filter(canBulkVerify));
        if(!result.hasMore||!result.items.length)break;
      }
      if(active.current)selection.add(checked);
    }catch(issue){if(active.current)setError(issueCode(issue));}
    finally{flight.current=false;if(active.current){setWorking(false);setSelecting(false);}}
  }

  async function verify(rows:Row[]) {
    if(busy||flight.current||!rows.length)return;
    flight.current=true;setWorking(true);setError("");setProgress({done:0,total:rows.length});
    try{
      let done=0,continueChecking=true;
      for(let start=0;start<rows.length&&active.current&&continueChecking;start+=mediaBatchSize){
        for(const row of rows.slice(start,start+mediaBatchSize)){
          if(!active.current)break;
          let result:string;
          try{result=(await request<{result:string}>({action:"orphan_verify",...identity(row)})).result;}
          catch(issue){result=issueCode(issue);}
          done++;
          if(active.current){setVerified(previous=>({...previous,[verificationKey(row)]:result}));setProgress({done,total:rows.length});}
          if(result==="forbidden"||result==="session_expired"){continueChecking=false;setError(result);break;}
        }
      }
    }finally{flight.current=false;if(active.current)setWorking(false);}
  }
  async function update(row:Row,action:"hold"|"release"|"enroll",evidence?:{backupSha256:string;evidenceRef:string}) {
    if(busy||flight.current)return;
    const message=action==="enroll"?t("Confirm this exact object has a verified local backup and independent custody evidence. Move it to File Trash for 48 hours?",
      "Xác nhận tệp này có bản sao đã xác minh và bằng chứng nguồn độc lập. Chuyển vào Thùng rác trong 48 giờ?"):
      action==="hold"?t("Keep this exact file on a cleanup hold?","Giữ tệp này ngoài diện dọn dẹp?"):
        t("Release this review hold? The file still needs verification and evidence before cleanup.","Bỏ giữ tệp này? Vẫn cần xác minh và bằng chứng trước khi dọn.");
    if(!window.confirm(message))return;
    flight.current=true;setWorking(true);setError("");setProgress({done:0,total:0});
    try{
      await request({action:`orphan_${action}`,...identity(row),...evidence,confirm:true});
      if(!active.current)return;
      setVerified(previous=>{const next={...previous};delete next[verificationKey(row)];return next;});
      notice(action==="enroll"?t("File moved to Trash. Its 48-hour restore window has started.","Đã chuyển tệp vào Thùng rác. Thời hạn khôi phục 48 giờ đã bắt đầu."):
        action==="hold"?t("File protected from cleanup.","Đã bảo vệ tệp khỏi dọn dẹp."):t("Review hold released.","Đã bỏ giữ tệp để kiểm tra."));
      setRevision(value=>value+1);
      if(action==="enroll")selection.remove([rowKey(row)]);
      onStaged();
    }catch(issue){if(active.current)setError(issueCode(issue));}
    finally{flight.current=false;if(active.current)setWorking(false);}
  }

  const formatBytes=(bytes:number)=>size.format(bytes/1_000_000);
  const pageEligible=page?.items.filter(canBulkVerify)??[];
  const selectionReason=!selection.ready?t("Loading saved selection…","Đang tải lựa chọn đã lưu…"):
    busy?t("Wait for the current review request.","Hãy chờ yêu cầu rà soát hiện tại."):"";
  const noneSelected=t("Select files to verify.","Chọn tệp để xác minh.");
  const verifyReason=selectionReason||(!selection.rows.length?noneSelected:"");
  const allReason=selectionReason||(!page?.available?reason("scan_required"):offset===0&&!page.hasMore&&!pageEligible.length?
    t("No eligible files match this search.","Không có tệp đủ điều kiện khớp tìm kiếm."):"");

  return <section aria-label={t("Orphan review","Rà soát tệp thừa")}>
    <h3>{t("Orphan review","Rà soát tệp thừa")}</h3>
    <p>{t("Check selected files before recording custody and backup evidence. A dependency check does not move a file to Trash.",
      "Kiểm tra các tệp đã chọn trước khi ghi nhận bằng chứng nguồn và bản sao lưu. Kiểm tra tham chiếu không chuyển tệp vào Thùng rác.")}</p>
    <form className="storage-media-actions" onSubmit={event=>{
      event.preventDefault();if(busy)return;
      setOffset(0);setSearch(query.trim());setRevision(value=>value+1);
    }}>
      <label>{t("Filename or listing code","Tên tệp hoặc mã tin đăng")} <input type="search" value={query} maxLength={120} onChange={event=>setQuery(event.target.value)}/></label>
      <button type="submit" className="button button-outline button-small" disabled={busy} title={busy?selectionReason:undefined}>{t("Search","Tìm")}</button>
    </form>
    <MediaSelectionControls count={selection.rows.length} bytes={selection.rows.reduce((sum,row)=>sum+(row.bytes??0),0)} unknownSizes={0}
      formatBytes={formatBytes} allReason={allReason} pageReason={selectionReason||(!pageEligible.length?t("No eligible files on this page.","Trang này chưa có tệp đủ điều kiện."):"")}
      clearReason={selectionReason||(!selection.rows.length?noneSelected:"")} selectAll={()=>void selectAll()}
      selectPage={()=>selection.add(pageEligible)} clear={selection.clear}/>
    <button type="button" className="button button-outline button-small" disabled={!!verifyReason} title={verifyReason||undefined}
      onClick={()=>void verify(selection.rows)}>{t(`Verify selected (${selection.rows.length})`,`Xác minh đã chọn (${selection.rows.length})`)}</button>
    {verifyReason&&<small>{verifyReason}</small>}
    {loading&&<p role="status">{t("Loading review candidates…","Đang tải tệp cần kiểm tra…")}</p>}
    {selecting&&<p role="status">{t("Selecting eligible review files across pages…","Đang chọn tệp đủ điều kiện qua các trang…")}</p>}
    {working&&progress.total>0&&<p role="status">{t(`Checked ${progress.done} of ${progress.total} selected files…`,`Đã kiểm tra ${progress.done}/${progress.total} tệp đã chọn…`)}</p>}
    {!!error&&<p role="alert">{reason(error)}</p>}
    {!loading&&page&&!page.available&&<p>{t("Run a storage scan to load review candidates.","Hãy quét kho để tải tệp cần kiểm tra.")}</p>}
    {!loading&&page?.available&&<>
      <p>{t(`${page.holds} individual Owner holds.`,`Chủ sở hữu đang giữ riêng ${page.holds} tệp.`)}</p>
      {!page.items.length&&<p>{t("No review candidates match this search.","Không có tệp cần kiểm tra khớp tìm kiếm.")}</p>}
      <ul className="storage-media-rows">{page.items.map(row=>{
        const key=rowKey(row),checked=selection.has(key),canCheck=hasIdentity(row),outcome=verified[verificationKey(row)];
        const pickReason=selectionReason||(!checked&&!canCheck?reason("identity"):"");
        return <li key={key}>
          <div>
            <label title={pickReason||undefined}><input type="checkbox" checked={checked} disabled={!!pickReason}
              onChange={event=>{if(event.target.checked)selection.add([row]);else selection.remove([key]);}}/> <strong>{row.key.split("/").at(-1)}</strong></label>
            <small>{row.bucket} · {row.bytes===null?"—":size.format(row.bytes/1_000_000)}{row.listingCode&&` · ${row.listingCode} · ${listingStatus(row.listingStatus)}`}</small>
            <small>{reason(outcome??(canCheck?row.reason:"identity"))}</small>
            <details><summary>{t("Storage identity","Định danh kho")}</summary><small>{row.key} · {row.objectId} · {row.version} · {row.etag}</small></details>
            {outcome==="evidence_required"&&<details>
              <summary>{t("Record evidence and move to Trash","Ghi bằng chứng và chuyển vào Thùng rác")}</summary>
              <form onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);
                void update(row,"enroll",{backupSha256:String(fields.get("backupSha256")).trim().toLowerCase(),evidenceRef:String(fields.get("evidenceRef")).trim()});}}>
                <p>{t("Use the SHA-256 from a verified local backup of this exact object and an independent custody record.","Dùng SHA-256 của bản sao cục bộ đã xác minh đúng tệp và hồ sơ nguồn độc lập.")}</p>
                <label>{t("Backup SHA-256","SHA-256 bản sao")} <input name="backupSha256" required pattern="[0-9a-fA-F]{64}" maxLength={64}/></label>{" "}
                <label>{t("Custody evidence reference","Tham chiếu bằng chứng nguồn")} <input name="evidenceRef" required minLength={3} maxLength={240}/></label>{" "}
                <button type="submit" className="button button-outline button-small" disabled={busy}>{t("Enroll in File Trash","Ghi vào Thùng rác")}</button>
              </form>
            </details>}
          </div>
          <div className="storage-media-actions">
            <button type="button" className="text-link" disabled={busy||!canCheck} onClick={()=>void verify([row])}>{t("Verify","Xác minh")}</button>
            <button type="button" className="text-link" disabled={busy||!canCheck} onClick={()=>void update(row,row.held?"release":"hold")}>
              {row.held?t("Release review hold","Bỏ giữ tệp"):t("Protect file","Bảo vệ tệp")}</button>
          </div>
        </li>;
      })}</ul>
      {(offset>0||page.hasMore)&&<nav className="storage-media-actions" aria-label={t("Orphan review pages","Trang rà soát tệp thừa")}>
        <button type="button" className="text-link" disabled={busy||offset===0} onClick={()=>setOffset(offset-pageSize)}>{t("Previous","Trước")}</button>
        <span>{t("Page","Trang")} {Math.floor(offset/pageSize)+1}</span>
        <button type="button" className="text-link" disabled={busy||!page.hasMore} onClick={()=>setOffset(offset+pageSize)}>{t("Next","Tiếp")}</button>
      </nav>}
    </>}
  </section>;
}
