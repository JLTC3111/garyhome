"use client";

import { useEffect, useRef, useState } from "react";
import { propertyPhotoExtension, propertyPhotoFilename, propertyPhotoPath } from "@/lib/property-photo-files";
import type { PhotoRenameHistory } from "@/lib/property-photo-rename-server";
import { useSite } from "./site-context";

export type PhotoRenameControls = {
  savedImages:string[];
  run:(source:string, filename:string)=>Promise<string>;
  history:()=>Promise<PhotoRenameHistory[]>;
  retire:(id:string)=>Promise<void>;
};

const messages:Record<string,[string,string]> = {
  invalid_name:["Use a basename with the image’s actual extension.", "Dùng tên tệp với phần mở rộng đúng định dạng ảnh."],
  file_format:["The stored image format could not be verified.", "Không thể xác minh định dạng của ảnh đã lưu."],
  file_size:["This photo exceeds the 8 MB verification limit.", "Ảnh vượt giới hạn xác minh 8 MB."],
  same_name:["The photo already uses this storage name.", "Ảnh đã dùng tên lưu trữ này."],
  collision:["That name is already in use. Choose a different one.", "Tên này đã được sử dụng. Hãy chọn tên khác."],
  pending_name:["This photo has an existing rename. Retry with that name or review its history.", "Ảnh đã có yêu cầu đổi tên. Hãy dùng lại tên đó hoặc xem lịch sử."],
  stale_listing:["The listing changed. Reopen the saved listing before retrying. Your edits are still open.", "Tin đăng đã thay đổi. Mở lại bản đã lưu trước khi thử lại. Các chỉnh sửa vẫn đang mở."],
  photo_not_saved:["Save this photo to the listing before renaming it.", "Lưu ảnh vào tin đăng trước khi đổi tên."],
  migration_required:["Apply the Home photo rename migration before using this tool.", "Áp dụng bản cập nhật đổi tên ảnh Gary Home trước khi sử dụng."],
  forbidden:["Current Home Admin or Owner access is required.", "Cần quyền Quản trị viên hoặc Chủ sở hữu Gary Home đang hoạt động."],
  integrity_failed:["The copy could not be verified. The existing photo is retained.", "Không thể xác minh bản sao. Ảnh hiện tại vẫn được giữ."],
  unsupported_source:["This photo is outside the configured Home Storage bucket.", "Ảnh không nằm trong kho lưu trữ đã cấu hình của Gary Home."],
  object_unavailable:["The photo could not be loaded from Storage.", "Không thể tải ảnh từ kho lưu trữ."],
  copy_failed:["Storage did not confirm the copy. Retry the same name.", "Kho lưu trữ chưa xác nhận bản sao. Hãy thử lại cùng tên."],
  other_origin:["Another Storage address uses this key. Review the references before changing it.", "Có địa chỉ lưu trữ khác dùng khóa này. Kiểm tra các tham chiếu trước khi đổi tên."],
  metadata_conflict:["This photo has conflicting metadata aliases. Review the listing before retrying.", "Ảnh có thông tin không nhất quán giữa các địa chỉ. Kiểm tra tin đăng trước khi thử lại."],
  confirm_listing:["The rename may have saved. Reopen the listing to check the result.", "Có thể đã lưu tên mới. Mở lại tin đăng để kiểm tra kết quả."],
  replacement_unavailable:["The replacement cannot be confirmed. The old copy is retained.", "Không thể xác nhận ảnh thay thế. Bản cũ vẫn được giữ."],
  in_use:["The old object still has a saved reference. Its file is retained.", "Vẫn có tham chiếu đến tệp cũ. Tệp vẫn được giữ."],
  remove_failed:["Storage did not confirm removal. Check the history and retry.", "Kho lưu trữ chưa xác nhận xóa. Kiểm tra lịch sử và thử lại."],
  session_expired:["Sign in again to continue.", "Đăng nhập lại để tiếp tục."],
};

function message(error:unknown,t:(en:string,vi:string)=>string) {
  const wording = error instanceof Error ? messages[error.message] : undefined;
  return wording ? t(...wording) : t("Could not finish. Refresh the rename history or retry the same name.", "Không thể hoàn tất. Làm mới lịch sử đổi tên hoặc thử lại cùng tên.");
}

export function PropertyPhotoRenameForm({source,rename,disabled,onComplete,onCancel}:{
  source:string; rename:PhotoRenameControls; disabled:boolean; onComplete:(url:string)=>void; onCancel:()=>void;
}) {
  const {t}=useSite(), input=useRef<HTMLInputElement>(null);
  const current=propertyPhotoPath(source)?.split("/").at(-1)||"", extension=propertyPhotoExtension(current);
  const [filename,setFilename]=useState(()=>extension&&propertyPhotoFilename(current,extension)||current);
  const [error,setError]=useState(""), [pending,setPending]=useState(false);
  const preview=extension?propertyPhotoFilename(filename,extension,true):"";
  useEffect(()=>{input.current?.focus();},[]);
  async function save() {
    setPending(true);setError("");
    try{onComplete(await rename.run(source,filename));}catch(error){setError(message(error,t));}
    finally{setPending(false);}
  }
  return <fieldset className="editor-photo-rename" disabled={pending||disabled}>
    <legend>{t("Rename Storage file","Đổi tên tệp lưu trữ")}</legend>
    <p>{t("Current Storage filename","Tên tệp lưu trữ hiện tại")} · {current}</p>
    <label>{t("New filename","Tên tệp mới")}<input ref={input} value={filename} maxLength={220}
      onChange={event=>setFilename(event.target.value)} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}}/></label>
    {preview&&<p className="muted">{t("Preview","Xem trước")} · {preview}</p>}
    <p className="muted">{t("The server verifies the new file and removes the old copy once no saved references remain. Previously shared image links may stop working.",
      "Máy chủ xác minh tệp mới và xóa bản cũ khi không còn tham chiếu đã lưu. Các liên kết ảnh đã chia sẻ có thể ngừng hoạt động.")}</p>
    <div className="editor-photo-panel-actions">
      <button type="button" className="button" disabled={!filename.trim()||preview===current} onClick={()=>void save()}>{t("Rename and remove old copy","Đổi tên và xóa bản cũ")}</button>
      <button type="button" className="text-link" onClick={onCancel}>{t("Cancel","Hủy")}</button>
    </div>
    {pending&&<p role="status">{t("Verifying the new file, updating references, and checking cleanup…","Đang xác minh tệp mới, cập nhật tham chiếu và kiểm tra bản cũ…")}</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}

export function PropertyPhotoRenameTools({rename,disabled}: {rename:PhotoRenameControls; disabled:boolean}) {
  const {t}=useSite(), [history,setHistory]=useState<PhotoRenameHistory[]|null>(null);
  const [busy,setBusy]=useState(false), [status,setStatus]=useState(""), [error,setError]=useState("");
  const basename=(key:string)=>key.split("/").at(-1);
  const proposals=rename.savedImages.flatMap(source=>{
    const from=basename(propertyPhotoPath(source)||"")||"", extension=propertyPhotoExtension(from);
    const to=extension?propertyPhotoFilename(from,extension):"";
    return to&&to!==from ? [{source,from,to}] : [];
  });
  async function load() {
    setBusy(true);setError("");
    try{setHistory(await rename.history());}catch(error){setError(message(error,t));}finally{setBusy(false);}
  }
  async function retire(id:string) {
    if(!window.confirm(t("Delete the old Storage object? Old links and saved image URLs outside Gary Home may stop working.",
      "Xóa tệp lưu trữ cũ? Các liên kết và địa chỉ ảnh cũ lưu bên ngoài Gary Home có thể ngừng hoạt động.")))return;
    setBusy(true);setError("");setStatus("");
    try{
      await rename.retire(id);
      setHistory(previous=>previous?.map(row=>row.id===id?{...row,removed_at:new Date().toISOString()}:row)||null);
      setStatus(t("Old Storage object removed.","Đã xóa tệp lưu trữ cũ."));
    }catch(error){setError(message(error,t));}finally{setBusy(false);}
  }
  return <div className="editor-photo-rename-tools">
    <details>
      <summary>{t("Preview filename cleanup","Xem trước tên tệp cần sửa")}</summary>
      <p className="muted">{t("Preview for this listing. Review each photo’s rename individually.","Xem trước cho tin đăng này. Kiểm tra từng ảnh trước khi đổi tên.")}</p>
      {proposals.length?<ul>{proposals.map(({source,from,to},index)=><li key={`${index}-${source}`}>{from} → {to}</li>)}</ul>:
        <p>{t("No filename changes suggested.","Không có tên tệp cần sửa.")}</p>}
    </details>
    <details onToggle={event=>{if(event.currentTarget.open&&!busy)void load();}}>
      <summary>{t("Rename history and old copies","Lịch sử đổi tên và bản cũ")}</summary>
      <button type="button" className="text-link" disabled={disabled||busy} onClick={()=>void load()}>{t("Refresh history","Làm mới lịch sử")}</button>
      {history?.length ? <ul>{history.map(row=><li key={row.id}>
        <span>{basename(row.old_key)} → {basename(row.new_key)}</span>
        <small>{row.removed_at?t("Old copy removed","Đã xóa bản cũ"):!row.applied_at?t("Rename pending","Đang chờ hoàn tất đổi tên"):
          row.auto_cleanup_requested?t("Cleanup pending confirmation","Chưa xác nhận đã xóa bản cũ"):t("Old copy retained for review","Đang giữ bản cũ để kiểm tra")}</small>
        {row.applied_at&&!row.removed_at&&<button type="button" className="text-link" disabled={disabled||busy}
          onClick={()=>void retire(row.id)}>{t("Remove old copy","Xóa bản cũ")}</button>}
      </li>)}</ul> : history&&<p>{t("No renames for this listing.","Tin đăng này chưa đổi tên ảnh.")}</p>}
      {busy&&<p role="status">{t("Checking Storage references…","Đang kiểm tra tham chiếu lưu trữ…")}</p>}
      {status&&<p role="status">{status}</p>}
      {error&&<p role="alert">{error}</p>}
    </details>
  </div>;
}
