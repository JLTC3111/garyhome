"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, FileText, Film, LoaderCircle, Pencil, Plus, RefreshCw, Search, Settings2, Trash2 } from "lucide-react";
import { useSite } from "./site-context";
import { DeleteConfirmation } from "./delete-confirmation";
import { PortalGuideEditor } from "./portal-guide-editor";
import { PortalGuideMedia } from "./portal-guide-media";
import { PortalManual } from "./portal-manual";
import { HELP_BUCKET, HELP_FIELDS, HELP_FILE_TYPES, helpFileSize, portalManual, type HelpFile, type HelpGuide } from "@/lib/portal-help";
import starterGuides from "@/data/portal-guides.json";
import { normalize } from "@/lib/property-search";
import { request } from "@/lib/requests";

export function PortalHelpStart({ open }: { open: () => void }) {
  const { t } = useSite();
  return <button type="button" className="help-quick-start" onClick={open}><BookOpen size={24}/><span><strong>{t("New here? Start with a guide.", "Mới ở đây? Hãy xem hướng dẫn.")}</strong><small>{t("Short walkthroughs to help you use your portal with confidence.", "Hướng dẫn ngắn giúp bạn sử dụng cổng thông tin tự tin hơn.")}</small></span></button>;
}

export function PortalHelp({ portal }: { portal: "customer" | "staff" }) {
  const { user, staffRole, demo } = useSite();
  if (!user && !demo) return null;
  return <HelpLibrary key={`${user?.id || "demo"}-${staffRole || "customer"}-${portal}`} portal={portal}/>;
}

function HelpLibrary({ portal }: { portal: "customer" | "staff" }) {
  const { user, client, staffRole, sessionPhase, editorTask, t, language, demo, notice } = useSite();
  const owner = portal === "staff" && staffRole === "owner" && !demo, userId = user?.id;
  const [guides, setGuides] = useState<HelpGuide[]>(demo ? starterGuides.map(row => ({ ...row, created_at: "", updated_at: "" })) as HelpGuide[] : []);
  const [loading, setLoading] = useState(!demo), [failed, setFailed] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [manage, setManage] = useState(false), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<HelpGuide | null>(null);
  const [deleting, setDeleting] = useState<HelpGuide | null>(null), [media, setMedia] = useState<HelpFile | null>(null);
  const active = useRef(true), sequence = useRef(0), version = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const locale = language === "vi" ? "vi" : "en";
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const read = useCallback(async () => {
    if (demo || !client || !userId) return;
    const generation = ++sequence.current, startedVersion = version.current;
    try {
      // Not accountTask: its session check flips sessionPhase, which re-runs this read in a loop.
      const { data, error } = await request(signal => {
        let select = client.from("portal_guides").select(HELP_FIELDS).order("sort_order").order("created_at").limit(200);
        if (!owner) select = select.eq("published", true).in("audience", [portal, "both"]);
        return select.abortSignal(signal);
      });
      if (error) throw error;
      if (!active.current || generation !== sequence.current || startedVersion !== version.current) return;
      setGuides((data || []) as unknown as HelpGuide[]); setFailed(false);
    } catch { if (active.current && generation === sequence.current) setFailed(true); }
    finally { if (active.current && generation === sequence.current) setLoading(false); }
  }, [client, demo, owner, portal, userId]);
  useEffect(() => {
    if (sessionPhase !== "ready" || demo) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void read(); });
    return () => { cancelled = true; };
  }, [sessionPhase, demo, read]);
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  const title = (guide: HelpGuide) => guide[`title_${locale}`] || t("Untitled guide", "Hướng dẫn chưa đặt tên");
  const selectedGuide = guides.find(guide => guide.id === selected);
  const manual = portalManual(guides);
  const search = normalize(query).trim();
  const visible = guides.filter(guide => (owner && manage || guide.published && [portal, "both"].includes(guide.audience)) &&
    (!search || normalize(`${guide.title_en} ${guide.title_vi} ${guide.summary_en} ${guide.summary_vi} ${guide.body_en} ${guide.body_vi}`).includes(search)));
  function update(guide: HelpGuide) { version.current++; setGuides(rows => [...rows.filter(row => row.id !== guide.id), guide].sort((a, b) => a.sort_order - b.sort_order)); }
  async function create() {
    if (!owner || busy) return; setBusy(true); setError("");
    try {
      const { data, error } = await editorTask((db, signal) => db.from("portal_guides").insert({ audience: "staff", sort_order: 1000 }).select(HELP_FIELDS).abortSignal(signal).single());
      if (error || !data) throw error;
      if (!active.current) return; update(data as unknown as HelpGuide); setEditing(data as unknown as HelpGuide); setManage(true); setSelected(null);
    } catch { if (active.current) setError(t("Couldn’t create the draft. Refresh the library before trying again.", "Chưa tạo được bản nháp. Làm mới thư viện trước khi thử lại.")); }
    finally { if (active.current) setBusy(false); }
  }
  async function remove() {
    if (!owner || !deleting || busy) return; setBusy(true); setError("");
    const target = deleting;
    try {
      const { data, error } = await editorTask((db, signal) => db.from("portal_guides").delete().eq("id", target.id).select("id").abortSignal(signal).single());
      if (error || !data) throw error;
      // Remove the access records first. Failed physical cleanup cannot leave a
      // deleted staff guide readable to another audience.
      let cleanupFailed = false;
      if (target.files.length) {
        try { const result = await editorTask(db => db.storage.from(HELP_BUCKET).remove(target.files.map(file => file.storage_path))); cleanupFailed = !!result.error; }
        catch { cleanupFailed = true; }
      }
      if (!active.current) return;
      version.current++; setGuides(rows => rows.filter(row => row.id !== target.id)); setDeleting(null); if (selected === target.id) setSelected(null);
      if (cleanupFailed) setError(t("Guide deleted. Storage cleanup could not be confirmed; check the portal-guides bucket.", "Đã xóa hướng dẫn. Chưa xác nhận được dọn tệp; hãy kiểm tra kho portal-guides."));
      else notice(t("Guide deleted.", "Đã xóa hướng dẫn."));
    } catch { if (active.current) setError(t("Deletion could not be confirmed. Refresh before trying again.", "Chưa xác nhận được thao tác xóa. Làm mới trước khi thử lại.")); }
    finally { if (active.current) setBusy(false); }
  }
  if (!user && !demo) return null;
  return <section className="portal-help" aria-label={t("How to use Gary Home", "Hướng dẫn sử dụng Gary Home")}>
    {manual && !selectedGuide ? <PortalManual key={userId + manual.file.id} file={manual.file}/> : <header className="help-intro"><span className="help-intro-icon"><BookOpen size={25}/></span><div><h2>{t("A little guidance. A confident start.", "Hướng dẫn rõ ràng. Khởi đầu tự tin.")}</h2><p>{portal === "staff" ? t("Learn the Studio workflow, then revisit a guide whenever you need it.", "Làm quen với quy trình Studio và xem lại hướng dẫn bất cứ khi nào cần.") : t("Find homes, keep your shortlist and follow your requests with ease.", "Tìm nhà, lưu danh sách yêu thích và theo dõi yêu cầu dễ dàng.")}</p></div></header>}
    {manual && !selectedGuide && <div className="help-library-heading"><div><h3>{t("Explore the guides", "Khám phá hướng dẫn")}</h3><p>{t("Quick answers and step-by-step instructions, all in one place.", "Câu trả lời nhanh và hướng dẫn từng bước, cùng ở một nơi.")}</p></div><BookOpen size={23}/></div>}
    <div className="help-toolbar"><label className="help-search"><Search size={17}/><span className="sr-only">{t("Search guides", "Tìm hướng dẫn")}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("Search guides…", "Tìm hướng dẫn…")}/></label><button type="button" className="text-link" disabled={loading || demo} onClick={() => { setLoading(true); void read(); }}><RefreshCw size={15} className={loading ? "spin" : ""}/>{t("Refresh", "Làm mới")}</button>{owner && <><button type="button" className="button button-outline" aria-pressed={manage} onClick={() => { setManage(!manage); setSelected(null); }}><Settings2 size={16}/>{manage ? t("View library", "Xem thư viện") : t("Manage guides", "Quản lý hướng dẫn")}</button><button type="button" className="button" disabled={busy} onClick={() => void create()}><Plus size={16}/>{t("Add guide", "Thêm hướng dẫn")}</button></>}</div>
    {owner && manage && <p className="help-owner-note">{t("Only the owner can change this library. Drafts stay private; publish to make a guide visible to its selected audience.", "Chỉ chủ sở hữu được thay đổi thư viện. Bản nháp được giữ riêng; xuất bản để nhóm đã chọn xem hướng dẫn.")}</p>}
    {failed && <div className="form-error" role="alert">{t("The guide library could not be refreshed. Reconnect and try Refresh; any previously loaded guides are still shown.", "Chưa thể tải lại thư viện. Kết nối lại rồi chọn Làm mới; hướng dẫn đã tải vẫn được giữ.")}</div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading && !guides.length && <p className="help-loading" role="status"><LoaderCircle size={19} className="spin"/>{t("Loading your guides…", "Đang tải hướng dẫn…")}</p>}
    {selectedGuide ? <article className="help-article"><button type="button" className="text-link" onClick={() => setSelected(null)}><ChevronLeft size={16}/>{t("All guides", "Tất cả hướng dẫn")}</button><h3 ref={heading} tabIndex={-1}>{title(selectedGuide)}</h3><p className="help-summary">{selectedGuide[`summary_${locale}`]}</p><div className="help-written">{selectedGuide[`body_${locale}`].split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>{selectedGuide.files.length > 0 && <section className="help-attachments"><h4>{t("Watch & read", "Xem & đọc")}</h4><p>{t("Choose a file to open its secure viewer. Videos do not play automatically.", "Chọn tệp để mở trình xem bảo mật. Video không tự phát.")}</p>{selectedGuide.files.map(file => <button type="button" className="help-file" key={file.id} onClick={() => setMedia(file)}>{HELP_FILE_TYPES[file.mime_type]?.kind === "video" ? <Film size={23}/> : <FileText size={23}/>}<span><strong>{file.original_name}</strong><small>{helpFileSize(file.size_bytes)} · {file.mime_type === "application/pdf" ? "PDF" : t("Open viewer", "Mở trình xem")}</small></span></button>)}</section>}</article> : <div className="help-guide-grid">{visible.map(guide => <article className="help-guide-card" key={guide.id}><div className="help-card-top"><BookOpen size={24}/><span>{guide.published ? t("Guide", "Hướng dẫn") : t("Private draft", "Bản nháp riêng")}{manage ? " · " + (guide.audience === "staff" ? t("Staff", "Nhân viên") : guide.audience === "customer" ? t("Customers", "Khách hàng") : t("Everyone signed in", "Mọi người đã đăng nhập")) : ""}</span></div><h3><button type="button" onClick={() => setSelected(guide.id)}>{title(guide)}</button></h3><p>{guide[`summary_${locale}`]}</p><div className="help-card-bottom"><span>{guide.files.length ? t(`${guide.files.length} visual resources`, `${guide.files.length} tài liệu trực quan`) : t("Step-by-step guide", "Hướng dẫn từng bước")}</span>{owner && manage && <div><button type="button" className="icon-button" aria-label={t("Edit guide", "Sửa hướng dẫn") + ": " + title(guide)} onClick={() => setEditing(guide)}><Pencil size={16}/></button><button type="button" className="icon-button" aria-label={t("Delete guide", "Xóa hướng dẫn") + ": " + title(guide)} onClick={() => { setError(""); setDeleting(guide); }}><Trash2 size={16}/></button></div>}</div></article>)}</div>}
    {!loading && !selectedGuide && !visible.length && !failed && <p className="help-empty">{query ? t("No guides match this search.", "Không có hướng dẫn phù hợp.") : t("Guides for this audience will appear here once published.", "Hướng dẫn dành cho nhóm này sẽ xuất hiện sau khi được đăng.")}</p>}
    {owner && editing && <PortalGuideEditor key={editing.id} guide={editing} close={() => setEditing(null)} saved={guide => { update(guide); setEditing(null); }} changed={update}/>}
    {media && <PortalGuideMedia key={media.id} file={media} close={() => setMedia(null)}/>}
    {deleting && <DeleteConfirmation title={t("Delete this guide?", "Xóa hướng dẫn này?")} description={t("Its text and attachments will be removed from the portal library.", "Nội dung và tệp đính kèm sẽ bị gỡ khỏi thư viện trong cổng.")} target={title(deleting)} busy={busy} error={error} onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => void remove()}/>}
  </section>;
}
