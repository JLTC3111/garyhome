"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Plus, Save, Trash2, Upload, X, RefreshCw } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { DeleteConfirmation } from "./delete-confirmation";
import { canDeleteContent } from "@/lib/staff";
import { articleText, editorialIssue, editorialSeed, validEditorialUrl, type EditorialArticle, type EditorialKind, type EditorialSection } from "@/lib/editorial";

const blankSection = (): EditorialSection => ({ heading_en: "", heading_vi: "", body_en: "", body_vi: "" });
const editorialMessages = {
  slug: ["Enter a unique URL slug using lowercase letters, numbers and hyphens.", "Nhập đường dẫn duy nhất gồm chữ thường, số và dấu gạch ngang."],
  image: ["Use a local image path or an http/https image URL.", "Dùng đường dẫn ảnh trên website hoặc địa chỉ ảnh http/https."],
  sources: ["Each source needs a title and an http/https link. Remove unused sources.", "Mỗi nguồn cần tên và liên kết http/https. Xóa nguồn chưa dùng."],
  publish: ["Before publishing, complete both languages, at least one section, and a cover photo and date for news.", "Trước khi đăng, hoàn thành hai ngôn ngữ, ít nhất một mục; tin tức cần ảnh bìa và ngày đăng."],
  duplicate: ["That URL slug is already used. Choose another.", "Đường dẫn đã được dùng. Vui lòng chọn đường dẫn khác."],
  stale: ["This article changed elsewhere. Your draft is kept. Refresh the list, then reopen the article to load its saved version.", "Bài viết đã thay đổi ở nơi khác. Bản nháp vẫn được giữ. Tải lại danh sách rồi mở lại bài viết để lấy bản đã lưu."],
  save: ["Couldn’t save the article. Your draft is kept; check your connection and try again.", "Chưa thể lưu bài viết. Bản nháp vẫn được giữ; kiểm tra kết nối rồi thử lại."],
  delete: ["Couldn’t confirm deletion. Refresh the article before trying again.", "Chưa thể xác nhận xóa. Tải lại bài viết trước khi thử lại."],
  upload: ["Image upload failed.", "Chưa thể tải ảnh."],
  load: ["Couldn’t refresh the list. Your draft is kept.", "Chưa thể tải lại danh sách. Bản nháp vẫn được giữ."],
} as const;
export function EditorialManager({ kind, upload }: { kind: EditorialKind; upload: (file: File) => Promise<string> }) {
  const { content, setContent, language, t, demo, editorTask, staffRole, notice, refresh } = useSite();
  const [drafts, setDrafts] = useState<Partial<Record<EditorialKind, EditorialArticle | null>>>({});
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [error, setError] = useState<{ id: string; code: keyof typeof editorialMessages } | null>(null);
  const [loading,setLoading]=useState(false);
  const [deleting, setDeleting] = useState<EditorialArticle | null>(null);
  const rows = (content.editorial ?? editorialSeed).filter(row => row.kind === kind).toSorted((a, b) => b.updated_at.localeCompare(a.updated_at));
  const article = drafts[kind];
  const issueText=(code:keyof typeof editorialMessages)=>t(editorialMessages[code][0],editorialMessages[code][1]);
  const issue = error?.id === article?.id && error ? issueText(error.code) : "";
  function change(patch: Partial<EditorialArticle>) { setDrafts(previous => ({ ...previous, [kind]: previous[kind] ? { ...previous[kind]!, ...patch } : null })); }
  function create() {
    const now = new Date().toISOString();
    setDrafts(previous => ({ ...previous, [kind]: { id: crypto.randomUUID(), slug: "", kind, title_en: "", title_vi: "", summary_en: "", summary_vi: "", category_en: "", category_vi: "", image_url: "", sections: [blankSection()], sources: [], status: "draft", published_on: kind === "news" ? now.slice(0, 10) : null, created_at: now, updated_at: now } }));
    setError(null);
  }
  function section(index: number, patch: Partial<EditorialSection>) { if (article) change({ sections: article.sections.map((s, i) => i === index ? { ...s, ...patch } : s) }); }
  async function save() {
    if (!article || busy) return;
    const submitted = article, key = kind;
    const problem = editorialIssue(submitted);
    if (problem) { setError({ id: submitted.id, code: problem }); return; }
    setBusy(true); setError(null);
    try {
      let saved = { ...submitted, updated_at: new Date().toISOString() };
      if (!demo) {
        const exists = (content.editorial ?? editorialSeed).some(row => row.id === submitted.id);
        const { data, error } = await editorTask((db, signal) => (exists
          ? db.from("editorial_articles").update(saved).eq("id", saved.id).eq("updated_at", submitted.updated_at)
          : db.from("editorial_articles").insert(saved)).select("*").abortSignal(signal).single());
        if (error || !data) throw new Error(error?.code === "23505" ? "duplicate" : error?.code === "PGRST116" || !error ? "stale" : "save");
        saved = data;
      }
      setContent(previous => ({ ...previous, editorial: (previous.editorial ?? editorialSeed).some(row => row.id === saved.id)
        ? (previous.editorial ?? editorialSeed).map(row => row.id === saved.id ? saved : row) : [...(previous.editorial ?? editorialSeed), saved] }));
      setDrafts(previous => ({ ...previous, [key]: previous[key] === submitted ? null : previous[key]?.id === submitted.id ? {...previous[key]!,updated_at:saved.updated_at} : previous[key] }));
      notice(t(saved.status === "published" ? "Article published on Tips & News." : "Article draft saved.", saved.status === "published" ? "Đã đăng bài trên Cẩm nang & tin tức." : "Đã lưu bản nháp bài viết."));
    } catch (error) {
      setError({ id: submitted.id, code: error instanceof Error && error.message === "duplicate" ? "duplicate" : error instanceof Error && error.message === "stale" ? "stale" : "save" });
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy || !canDeleteContent(staffRole)) return;
    const target = deleting; setBusy(true); setError(null);
    try {
      if (!demo) {
        const { data, error } = await editorTask((db, signal) => db.from("editorial_articles").delete().eq("id", target.id).eq("updated_at", target.updated_at).select("id").abortSignal(signal).maybeSingle());
        if (error || !data) throw new Error("delete");
      }
      setContent(previous => ({ ...previous, editorial: (previous.editorial ?? editorialSeed).filter(row => row.id !== target.id) }));
      setDrafts(previous => Object.fromEntries(Object.entries(previous).map(([k, row]) => [k, row?.id === target.id ? null : row])));
      setDeleting(null); notice(t("Article deleted.", "Đã xóa bài viết."));
    } catch { setError({ id: target.id, code: "delete" }); }
    finally { setBusy(false); }
  }
  return <section className="editorial-workspace">
    <div className="editorial-toolbar"><p>{t("Published articles appear in Tips & News. Drafts are private to the team.", "Bài đã đăng xuất hiện trong Cẩm nang & tin tức. Bản nháp chỉ dành cho đội ngũ.")}</p><div className="editorial-toolbar-actions">{!demo&&<button type="button" className="button button-outline button-small" disabled={busy||loading} onClick={()=>{setLoading(true);void refresh().catch(()=>setError({id:article?.id||"list",code:"load"})).finally(()=>setLoading(false));}}><RefreshCw size={15}/>{loading?t("Refreshing…","Đang tải lại…"):t("Refresh list","Tải lại danh sách")}</button>}<button type="button" className="button button-small" disabled={busy||loading} onClick={create}><Plus size={16}/>{t(kind === "news" ? "New article" : "New rental tip", kind === "news" ? "Thêm tin tức" : "Thêm cẩm nang thuê nhà")}</button></div></div>{error?.id==="list"&&<div className="form-error" role="alert">{issueText(error.code)}</div>}
    <div className="editorial-columns"><div className="admin-panel editorial-list" role="group" aria-label={t("Editorial items", "Danh sách bài viết")}>{rows.map(row => <button key={row.id} type="button" aria-pressed={article?.id === row.id} disabled={busy} onClick={() => { setDrafts(previous => ({ ...previous, [kind]: structuredClone(row) })); setError(null); }}><strong>{articleText(row, "title", language) || t("Untitled draft", "Bản nháp chưa đặt tên")}</strong><span>{t(row.status === "published" ? "Published" : "Draft", row.status === "published" ? "Đã đăng" : "Bản nháp")}</span><small>/tips-and-news/{row.slug}</small></button>)}{!rows.length && <p>{t("No articles yet. Create a draft to begin.", "Chưa có bài viết. Tạo bản nháp để bắt đầu.")}</p>}</div>
    <div className="admin-panel editorial-editor">{article ? <form className="editor-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <header><h2>{t(kind === "news" ? "News article" : "Rental tip", kind === "news" ? "Bài tin tức" : "Cẩm nang thuê nhà")}</h2>{article.status === "published" && rows.some(row => row.id === article.id) && <Link className="text-link" target="_blank" href={`/tips-and-news/${article.slug}`}>{t("View published article", "Xem bài đã đăng")}<ArrowUpRight size={15}/></Link>}</header>
      <label>{t("URL slug", "Đường dẫn bài viết")}<input name="article_slug" required maxLength={180} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={article.slug} onChange={event => change({ slug: event.target.value })}/><small>{t("Changing this changes the public link.", "Thay đổi mục này sẽ đổi liên kết công khai.")}</small></label>
      {(["en", "vi"] as const).map(lang => <fieldset key={lang}><legend>{lang === "en" ? t("English", "Tiếng Anh") : t("Vietnamese", "Tiếng Việt")}</legend><label>{t("Title", "Tiêu đề")}<input name={`article_title_${lang}`} maxLength={240} value={article[`title_${lang}`]} onChange={event => change({ [`title_${lang}`]: event.target.value })}/></label><label>{t("Summary", "Tóm tắt")}<textarea name={`article_summary_${lang}`} rows={3} maxLength={700} value={article[`summary_${lang}`]} onChange={event => change({ [`summary_${lang}`]: event.target.value })}/></label>{kind === "news" && <label>{t("Category", "Chuyên mục")}<input maxLength={100} value={article[`category_${lang}`]} onChange={event => change({ [`category_${lang}`]: event.target.value })}/></label>}</fieldset>)}
      <label>{t("Cover image URL", "Đường dẫn ảnh bìa")}<input value={article.image_url} maxLength={2000} onChange={event => change({ image_url: event.target.value })}/></label>
      {article.image_url && validEditorialUrl(article.image_url,true) && <img className="editorial-cover-preview" src={article.image_url} alt={t("Article cover preview", "Xem trước ảnh bìa")}/>}
      <label className="upload-label"><Upload size={16}/>{uploading ? t("Uploading…", "Đang tải…") : t("Upload cover photo", "Tải ảnh bìa")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={uploading || busy} onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        const id = article.id, key = kind; setUploading(true);
        try { const url = await upload(file); setDrafts(previous => ({ ...previous, [key]: previous[key]?.id === id ? { ...previous[key]!, image_url: url } : previous[key] })); }
        catch { setError({ id, code: "upload" }); } finally { setUploading(false); }
      }}/></label>
      {kind === "news" && <label>{t("Publication date", "Ngày đăng")}<input name="article_date" type="date" value={article.published_on || ""} onChange={event => change({ published_on: event.target.value || null })}/></label>}
      {article.sections.map((part, index) => <fieldset className="editorial-section-fields" key={index}><legend>{t(`Section ${index + 1}`, `Mục ${index + 1}`)}</legend>{(["en", "vi"] as const).map(lang => <div key={lang}><label>{t(lang === "en" ? "Heading · English" : "Heading · Vietnamese", lang === "en" ? "Tiêu đề mục · Tiếng Anh" : "Tiêu đề mục · Tiếng Việt")}<input name={`section_${index}_heading_${lang}`} maxLength={240} value={part[`heading_${lang}`]} onChange={event => section(index, { [`heading_${lang}`]: event.target.value })}/></label><label>{t(lang === "en" ? "Text · English" : "Text · Vietnamese", lang === "en" ? "Nội dung · Tiếng Anh" : "Nội dung · Tiếng Việt")}<textarea name={`section_${index}_body_${lang}`} rows={6} maxLength={12000} value={part[`body_${lang}`]} onChange={event => section(index, { [`body_${lang}`]: event.target.value })}/></label></div>)}<button type="button" className="text-link" onClick={() => change({ sections: article.sections.filter((_, i) => i !== index) })}><X size={15}/>{t("Remove section", "Xóa mục")}</button></fieldset>)}
      <button type="button" className="text-link" disabled={article.sections.length >= 12} onClick={() => change({ sections: [...article.sections, blankSection()] })}><Plus size={16}/>{t("Add section", "Thêm mục")}</button>
      <fieldset><legend>{t("Sources & further reading", "Nguồn & đọc thêm")}</legend>{article.sources.map((source, index) => <div className="editorial-source" key={index}><label>{t("Source title", "Tên nguồn")}<input maxLength={300} value={source.title} onChange={event => change({ sources: article.sources.map((s, i) => i === index ? { ...s, title: event.target.value } : s) })}/></label><label>{t("Source URL", "Liên kết nguồn")}<input type="url" maxLength={2000} value={source.url} onChange={event => change({ sources: article.sources.map((s, i) => i === index ? { ...s, url: event.target.value } : s) })}/></label><button type="button" className="text-link" onClick={() => change({ sources: article.sources.filter((_, i) => i !== index) })}><X size={15}/>{t("Remove source", "Xóa nguồn")}</button></div>)}<button type="button" className="text-link" disabled={article.sources.length >= 12} onClick={() => change({ sources: [...article.sources, { title: "", url: "" }] })}><Plus size={16}/>{t("Add source", "Thêm nguồn")}</button></fieldset>
      <label>{t("Publication", "Trạng thái đăng")}<SelectField value={article.status} onValueChange={value => change({ status: value as EditorialArticle["status"] })}><option value="draft">{t("Draft · private", "Bản nháp · riêng tư")}</option><option value="published">{t("Published · visible on site", "Đã đăng · hiển thị trên website")}</option></SelectField></label>
      {issue && <div className="form-error" role="alert">{issue}</div>}
      <div className="editorial-save-actions"><button type="submit" className="button" disabled={busy || uploading}><Save size={16}/>{busy ? t("Saving…", "Đang lưu…") : t("Save article", "Lưu bài viết")}</button>{rows.some(row => row.id === article.id) && canDeleteContent(staffRole) && <button type="button" className="button button-outline button-danger-outline" disabled={busy} onClick={() => { setError(null); setDeleting(article); }}><Trash2 size={16}/>{t("Delete article", "Xóa bài viết")}</button>}</div>
    </form> : <p>{t("Choose an article to edit or create a new draft.", "Chọn bài viết để chỉnh sửa hoặc tạo bản nháp mới.")}</p>}</div></div>
    {deleting && <DeleteConfirmation title={t("Delete article?", "Xóa bài viết?")} target={articleText(deleting, "title", language) || deleting.slug} description={t("This permanently removes the article and its public page.", "Thao tác này xóa vĩnh viễn bài viết và trang công khai.")} busy={busy} error={error?.id === deleting.id ? issueText(error.code) : ""} onCancel={() => { setDeleting(null); setError(null); }} onConfirm={() => void remove()}/>}
  </section>;
}
