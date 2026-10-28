"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Eye, LoaderCircle, Save, Trash2, Upload, X } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { DeleteConfirmation } from "./delete-confirmation";
import { HELP_BUCKET, HELP_FIELDS, HELP_FILE_TYPES, HELP_MAX_FILES, helpFileSize, helpFileType, helpUploadPath, type HelpFile, type HelpGuide } from "@/lib/portal-help";
import { uploadHelpFile } from "@/lib/portal-help-upload";

const fields = ["title_en", "title_vi", "summary_en", "summary_vi", "body_en", "body_vi", "audience", "minimum_role", "sort_order", "published"] as const;
type Draft = Pick<HelpGuide, typeof fields[number]>;
function draftOf(guide: HelpGuide): Draft { return Object.fromEntries(fields.map(key => [key, guide[key]])) as Draft; }
export function PortalGuideEditor({ guide, close, saved, changed }: { guide: HelpGuide; close: () => void; saved: (guide: HelpGuide) => void; changed: (guide: HelpGuide) => void }) {
  const { client, user, staffRole, editorTask, t, notice } = useSite();
  const [draft, setDraft] = useState<Draft>(() => draftOf(guide)), [files, setFiles] = useState(guide.files);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [removing, setRemoving] = useState<HelpFile | null>(null);
  const [progress, setProgress] = useState<{ name: string; value: number } | null>(null);
  const baseline = useRef(guide), active = useRef(true), uploadAbort = useRef<AbortController | null>(null), dialog = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => { active.current = true; const node = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null; node?.showModal(); return () => { active.current = false; uploadAbort.current?.abort(); node?.close(); previous?.focus?.(); }; }, []);
  function patch<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(previous => ({ ...previous, [key]: value })); }
  async function refreshAttachments() {
    const { data, error } = await editorTask((db, signal) => db.from("portal_guides").select(HELP_FIELDS).eq("id", guide.id).abortSignal(signal).single());
    if (error || !data) throw error;
    const next = data as unknown as HelpGuide;
    if (!active.current) return;
    // Attachment triggers change the version. Do not silently accept a text
    // edit made in another tab while an upload was in flight.
    if (fields.some(key => key !== "published" && next[key] !== baseline.current[key])) setConflict(true);
    else { baseline.current = next; setDraft(previous => ({ ...previous, published: next.published })); }
    setFiles(next.files); changed(next);
  }
  async function save(published: boolean) {
    if (busy || conflict || staffRole !== "owner") return; setError("");
    if (!Number.isInteger(draft.sort_order) || draft.sort_order < 0 || draft.sort_order > 9999) { setError(t("Use a whole display-order number from 0 to 9999.", "Nhập số thứ tự nguyên từ 0 đến 9999.")); return; }
    if (published && (!draft.title_en.trim() || !draft.title_vi.trim() || ((!draft.body_en.trim() || !draft.body_vi.trim()) && !files.length))) { setError(t("Add both titles and written instructions in both languages, or upload a visual guide.", "Thêm tiêu đề hai ngôn ngữ và hướng dẫn chữ song ngữ, hoặc tải tài liệu trực quan.")); return; }
    setBusy("save");
    try {
      const { data, error } = await editorTask((db, signal) => db.from("portal_guides").update({ ...draft, published, minimum_role: draft.audience === "staff" ? draft.minimum_role : null }).eq("id", guide.id).eq("updated_at", baseline.current.updated_at).select(HELP_FIELDS).abortSignal(signal).single());
      if (error || !data) { if ((error as { code?: string })?.code === "PGRST116") setConflict(true); throw error; }
      if (!active.current) return;
      notice(published ? t("Guide saved and published.", "Đã lưu và xuất bản hướng dẫn.") : t("Guide saved privately as a draft.", "Đã lưu hướng dẫn ở bản nháp riêng tư.")); saved(data as unknown as HelpGuide);
    } catch { if (active.current) setError(t("The save could not be confirmed. Refresh the library before trying again.", "Chưa xác nhận được lần lưu. Làm mới thư viện trước khi thử lại.")); }
    finally { if (active.current) setBusy(""); }
  }
  async function upload(input: FileList | null) {
    if (!input || !client || !user || busy || staffRole !== "owner") return;
    if (draft.published) { setError(t("Unpublish this guide before adding files so you can review them privately.", "Gỡ xuất bản hướng dẫn trước khi thêm tệp để kiểm tra riêng tư.")); return; }
    const selected = Array.from(input); setError("");
    try { if (selected.length + files.length > HELP_MAX_FILES) throw new Error(); selected.forEach(helpFileType); }
    catch { setError(t("Choose supported files up to 50 MB each, with no more than 12 files per guide.", "Chọn định dạng hỗ trợ, tối đa 50 MB mỗi tệp và 12 tệp cho một hướng dẫn.")); return; }
    const controller = new AbortController(); uploadAbort.current = controller; setBusy("upload");
    let pendingPath: string | null = null;
    try {
      for (const file of selected) {
        controller.signal.throwIfAborted(); const fileId = crypto.randomUUID();
        const path = helpUploadPath(user.id, guide.id, fileId, file); pendingPath = path;
        setProgress({ name: file.name, value: 0 });
        await uploadHelpFile({ client, userId: user.id, file, path, signal: controller.signal, onProgress: value => { if (active.current) setProgress(previous => previous?.name === file.name && previous.value === value ? previous : { name: file.name, value }); } });
        if (!active.current) return;
        const original_name = Array.from(file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_")).slice(0, 180).join("") || "guide";
        const { error } = await editorTask((db, signal) => db.from("portal_guide_files").insert({ id: fileId, guide_id: guide.id, guide_version: baseline.current.updated_at, storage_path: path, original_name, mime_type: file.type, size_bytes: file.size }).select("id").abortSignal(signal).single());
        if (error) throw error; pendingPath = null; await refreshAttachments();
      }
      if (active.current) notice(t("Guide files uploaded.", "Đã tải tệp hướng dẫn."));
    } catch (error) {
      if (pendingPath && active.current) {
        // A timed-out attachment insert may already have committed. Never
        // delete its object unless a fresh read confirms it is still unlinked.
        try {
          const check = await editorTask((db, signal) => db.from("portal_guide_files").select("id").eq("storage_path", pendingPath!).abortSignal(signal).maybeSingle());
          if (!check.error && !check.data) await editorTask(db => db.storage.from(HELP_BUCKET).remove([pendingPath!]));
        } catch { /* Keep an uncertain object private for the owner to inspect. */ }
      }
      if (active.current) setError(error instanceof DOMException && error.name === "AbortError" ? t("Upload cancelled. Completed files are kept; select remaining files to continue.", "Đã hủy tải. Tệp hoàn tất được giữ lại; chọn các tệp còn lại để tiếp tục.") : t("An upload could not be confirmed. Refresh before reselecting any files; completed files are kept.", "Chưa xác nhận được lần tải. Làm mới trước khi chọn lại; tệp đã hoàn tất được giữ lại."));
    } finally { if (active.current) { setBusy(""); setProgress(null); } uploadAbort.current = null; }
  }
  async function removeFile() {
    if (!removing || busy || staffRole !== "owner") return; const file = removing; setBusy("delete"); setError("");
    try {
      const result = await editorTask((db, signal) => db.from("portal_guide_files").delete().eq("id", file.id).select("id").abortSignal(signal).single());
      if (result.error || !result.data) throw result.error;
      let cleanupFailed = false;
      try { const result = await editorTask(db => db.storage.from(HELP_BUCKET).remove([file.storage_path])); cleanupFailed = !!result.error; } catch { cleanupFailed = true; }
      await refreshAttachments(); if (!active.current) return; setRemoving(null);
      if (cleanupFailed) setError(t("The file was removed from this guide. Storage cleanup could not be confirmed.", "Đã gỡ tệp khỏi hướng dẫn. Chưa xác nhận được dọn kho lưu trữ."));
      else notice(t("Guide file removed.", "Đã gỡ tệp hướng dẫn."));
    } catch { if (active.current) setError(t("Removal could not be confirmed. Refresh before trying again.", "Chưa xác nhận được thao tác gỡ. Làm mới trước khi thử lại.")); }
    finally { if (active.current) setBusy(""); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(draft.published); }
  return <dialog ref={dialog} className="help-editor-dialog" aria-modal="true" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!busy) close(); }}><header><div><small>{t("OWNER · GUIDE EDITOR", "CHỦ SỞ HỮU · BIÊN TẬP HƯỚNG DẪN")}</small><h2 id={id}>{t("Create a confident first day.", "Tạo một ngày đầu tự tin.")}</h2></div><button autoFocus type="button" className="icon-button" disabled={!!busy} onClick={close} aria-label={t("Close editor", "Đóng trình biên tập")}><X size={20}/></button></header>
    <form className="enquiry-form help-editor-form" onSubmit={submit}>
      <div className="form-row"><label>{t("English title", "Tiêu đề tiếng Anh")}<input name="guide_title_en" maxLength={180} value={draft.title_en} onChange={event => patch("title_en", event.target.value)}/></label><label>{t("Vietnamese title", "Tiêu đề tiếng Việt")}<input name="guide_title_vi" maxLength={180} value={draft.title_vi} onChange={event => patch("title_vi", event.target.value)}/></label></div>
      <div className="form-row"><label>{t("Who can view this?", "Ai được xem?")}<SelectField value={draft.audience} onValueChange={value => setDraft(previous => ({ ...previous, audience: value as Draft["audience"], minimum_role: value === "staff" ? previous.minimum_role : null }))}><option value="customer">{t("Customers", "Khách hàng")}</option><option value="staff">{t("Staff", "Nhân viên")}</option><option value="both">{t("Everyone signed in", "Mọi người đã đăng nhập")}</option></SelectField></label>{draft.audience === "staff" ? <label>{t("Minimum staff role", "Cấp nhân viên tối thiểu")}<SelectField value={draft.minimum_role || "editor"} onValueChange={value => patch("minimum_role", value as Draft["minimum_role"])}><option value="editor">{t("Staff and above", "Nhân viên trở lên")}</option><option value="manager">{t("Manager and above", "Quản lý trở lên")}</option><option value="admin">{t("Administrator and owner", "Quản trị viên và chủ sở hữu")}</option><option value="owner">{t("Owner only", "Chỉ chủ sở hữu")}</option></SelectField></label> : null}</div>
      <div className="form-row"><label>{t("English summary", "Tóm tắt tiếng Anh")}<textarea name="guide_summary_en" rows={2} maxLength={700} value={draft.summary_en} onChange={event => patch("summary_en", event.target.value)}/></label><label>{t("Vietnamese summary", "Tóm tắt tiếng Việt")}<textarea name="guide_summary_vi" rows={2} maxLength={700} value={draft.summary_vi} onChange={event => patch("summary_vi", event.target.value)}/></label></div>
      <label>{t("English steps or video transcript", "Các bước hoặc bản chép lời tiếng Anh")}<textarea name="guide_body_en" rows={7} maxLength={16000} value={draft.body_en} onChange={event => patch("body_en", event.target.value)} placeholder="1. …"/></label><label>{t("Vietnamese steps or video transcript", "Các bước hoặc bản chép lời tiếng Việt")}<textarea name="guide_body_vi" rows={7} maxLength={16000} value={draft.body_vi} onChange={event => patch("body_vi", event.target.value)} placeholder="1. …"/></label>
      <section className="help-upload-section"><h3>{t("Visual walkthroughs", "Hướng dẫn trực quan")}</h3><p>{t("MP4, WebM, MOV, GIF, WebP, APNG, screenshots or PDF · 50 MB per file · up to 12 files. Add written steps above for accessibility.", "MP4, WebM, MOV, GIF, WebP, APNG, ảnh chụp hoặc PDF · 50 MB mỗi tệp · tối đa 12 tệp. Thêm hướng dẫn chữ bên trên để dễ tiếp cận.")}</p>{draft.published && <p className="form-info">{t("This guide is published. Unpublish it before adding files, then reopen the draft to upload and review them privately.", "Hướng dẫn đang được đăng. Hãy gỡ xuất bản, rồi mở lại bản nháp để tải và kiểm tra tệp riêng tư.")}</p>}<label className="button button-outline help-upload-label"><Upload size={17}/>{t("Upload files", "Tải tệp")}<input type="file" aria-label={t("Upload guide files", "Tải tệp hướng dẫn")} accept={Object.keys(HELP_FILE_TYPES).join(",")} multiple disabled={!!busy || conflict || draft.published || files.length >= HELP_MAX_FILES} onChange={event => { void upload(event.target.files); event.target.value = ""; }}/></label>
        {progress && <div className="help-upload-progress" role="status"><span>{progress.name}</span><progress max={100} value={progress.value} aria-label={t("Upload progress", "Tiến trình tải")}/><strong>{progress.value}%</strong><button type="button" className="text-link" onClick={() => uploadAbort.current?.abort()}>{t("Cancel upload", "Hủy tải")}</button></div>}
        {files.map(file => <div className="help-file-row" key={file.id}><span><strong>{file.original_name}</strong><small>{helpFileSize(file.size_bytes)}</small></span><button type="button" className="icon-button" disabled={!!busy} onClick={() => { setError(""); setRemoving(file); }} aria-label={t("Remove file", "Gỡ tệp") + ": " + file.original_name}><Trash2 size={16}/></button></div>)}
      </section><label className="help-order-field">{t("Display order (lower first)", "Thứ tự hiển thị (số nhỏ trước)")}<input type="number" min={0} max={9999} step={1} value={draft.sort_order} onChange={event => patch("sort_order", Number(event.target.value))}/></label>
      {conflict && <p className="form-error" role="alert">{t("This guide changed in another tab. Your text is kept here; close and reopen the guide to review the current version before saving.", "Hướng dẫn đã đổi ở tab khác. Nội dung của bạn vẫn ở đây; đóng và mở lại để kiểm tra phiên bản hiện tại trước khi lưu.")}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <footer className="help-editor-actions"><button className="button" type="submit" disabled={!!busy || conflict}>{busy === "save" ? <LoaderCircle size={16} className="spin"/> : <Save size={16}/>} {draft.published ? t("Save changes", "Lưu thay đổi") : t("Save draft", "Lưu nháp")}</button><button type="button" className="button button-outline" disabled={!!busy || conflict} onClick={() => void save(!draft.published)}><Eye size={16}/>{draft.published ? t("Unpublish", "Gỡ xuất bản") : t("Publish guide", "Xuất bản hướng dẫn")}</button></footer>
    </form>{removing && <DeleteConfirmation title={t("Remove this file?", "Gỡ tệp này?")} description={t("It will no longer be available from this guide. Removing the last visual file unpublishes a guide with no complete written instructions.", "Tệp sẽ không còn trong hướng dẫn. Gỡ tệp cuối sẽ chuyển hướng dẫn chưa có đủ nội dung chữ về bản nháp.")} target={removing.original_name} busy={!!busy} error={error} onCancel={() => { if (!busy) setRemoving(null); }} onConfirm={() => void removeFile()}/>}
  </dialog>;
}
