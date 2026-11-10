"use client";
import { useDeferredValue, useState } from "react";
import { CheckCircle2, AlertTriangle, CircleAlert, Monitor, Smartphone, Search } from "lucide-react";
import { analyzeContent, contentStatistics } from "@/lib/seo-analysis/content";
import type { ContentInput, Severity } from "@/lib/seo-analysis/types";
import { useSite } from "./site-context";
const statusLabel: Record<Severity, [string, string]> = { critical: ["Critical", "Nghiêm trọng"], warning: ["Warning", "Cảnh báo"], recommendation: ["Recommendation", "Đề xuất"], passed: ["Passed", "Đạt"] };
export function SeoEditorPanel({ inputs, note }: { inputs: ContentInput[]; note?: string }) {
  const { language: studioLanguage, t } = useSite();
  const [language, setLanguage] = useState(studioLanguage), [device, setDevice] = useState<"desktop" | "mobile">("desktop"), [keywords, setKeywords] = useState<Record<string, string>>({});
  const current = inputs.find(input => input.language === language) || inputs[0];
  const deferred = useDeferredValue(current);
  if (!current || !deferred) return null;
  const input = { ...deferred, focusKeyword: keywords[deferred.language || "en"] || "" }, result = analyzeContent(input), stats = contentStatistics(input);
  const issues = result.findings.filter(f => f.severity === "critical" || f.severity === "warning");
  let displayUrl = current.url; try { const url = new URL(current.url); displayUrl = `${url.hostname}${url.pathname === "/" ? "" : url.pathname.replaceAll("/", " › ")}`; } catch { /* draft path */ }
  return <section className="seo-editor-panel" aria-label={t("Live content SEO analysis", "Phân tích SEO nội dung trực tiếp")}>
    <header className="seo-editor-heading"><div><span className="eyebrow">CONTENT SEO</span><h3>{t("Live SEO review", "Kiểm tra SEO trực tiếp")}</h3></div><span className={`seo-editor-score ${issues.length ? "seo-warning" : "seo-passed"}`}>{result.score ?? "—"}<small>/100</small></span></header>
    <p className="seo-editor-muted">{t("Check completion, not a ranking prediction. Recommendations do not affect the score. Published technical checks run separately in SEO Audit.", "Điểm hoàn thành kiểm tra, không dự đoán thứ hạng. Đề xuất không ảnh hưởng điểm. Kiểm tra kỹ thuật trang đã đăng trong SEO Audit.")}</p>
    <div className="seo-editor-controls"><label>{t("Content language", "Ngôn ngữ nội dung")}<select value={current.language || "en"} onChange={event => setLanguage(event.target.value as "en" | "vi")}>{inputs.map(value => <option value={value.language || "en"} key={value.language || "en"}>{value.language === "vi" ? "Tiếng Việt" : value.language === "en" ? "English" : value.language}</option>)}</select></label><label>{t("Focus topic · optional", "Chủ đề trọng tâm · tùy chọn")}<input maxLength={160} value={keywords[current.language || "en"] || ""} onChange={event => setKeywords(previous => ({ ...previous, [current.language || "en"]: event.target.value }))} placeholder={t("For review only; never saved to content", "Chỉ kiểm tra; không lưu vào nội dung")}/></label></div>
    <div className="seo-editor-preview-header"><strong><Search size={15}/>{t("Search preview", "Xem trước tìm kiếm")}</strong><div role="group" aria-label={t("Preview device", "Thiết bị xem trước")}><button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={15}/>{t("Desktop", "Máy tính")}</button><button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone size={15}/>{t("Mobile", "Điện thoại")}</button></div></div>
    <div className={`seo-search-preview seo-search-preview-${device}`} lang={current.language}><div className="seo-search-brand">Gary Home</div><div className="seo-search-url">{displayUrl}</div><div className="seo-search-title">{current.title || t("Your page title", "Tiêu đề trang")}</div><p>{current.description || t("Add a description to preview the page summary.", "Thêm mô tả để xem trước tóm tắt trang.")}</p></div>
    <p className="seo-editor-muted">{t("Illustrative preview. Google may rewrite titles and snippets. Appearance and truncation vary by query and device.", "Xem trước minh họa. Google có thể thay đổi tiêu đề và mô tả; cách hiển thị tùy truy vấn và thiết bị.")}</p>
    <div className="seo-editor-statistics"><span>{[...current.title].length} {t("title characters", "ký tự tiêu đề")}</span><span>{[...current.description].length} {t("description characters", "ký tự mô tả")}</span><span>{stats.words} {t("word segments", "đơn vị từ")}</span></div>
    {note && <p className="seo-editor-muted">{note}</p>}
    <div className="seo-editor-findings">{result.findings.map(finding => <details className={`seo-editor-finding seo-${finding.severity}`} key={finding.id}><summary>{finding.severity === "passed" ? <CheckCircle2 size={17}/> : finding.severity === "critical" ? <CircleAlert size={17}/> : <AlertTriangle size={17}/>}<strong>{finding.title}</strong><small>{t(...statusLabel[finding.severity])}</small></summary><div><p>{finding.explanation}</p><p><strong>{t("Suggested action", "Gợi ý")}: </strong>{finding.recommendation}</p>{finding.evidence && <pre>{finding.evidence}</pre>}</div></details>)}</div>
    <p className="seo-editor-muted">{t("This panel never changes content or metadata. Clarity, intent, image meaning and factual accuracy need editorial review.", "Bảng này không thay đổi nội dung hoặc metadata. Cần biên tập viên kiểm tra độ rõ ràng, mục đích, ý nghĩa ảnh và tính chính xác.")}</p>
  </section>;
}
