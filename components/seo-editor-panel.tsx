"use client";
import { useDeferredValue, useState } from "react";
import { CheckCircle2, AlertTriangle, CircleAlert, Monitor, Smartphone, Search } from "lucide-react";
import { analyzeContent, contentStatistics } from "@/lib/seo-analysis/content";
import { localizeContentFinding, seoSeverity, seoText } from "@/lib/seo-analysis/localization";
import type { ContentInput } from "@/lib/seo-analysis/types";
import { useSite } from "./site-context";

export function SeoEditorPanel({ inputs, note }: { inputs: ContentInput[]; note?: string }) {
  const { language: studioLanguage } = useSite();
  const text = (key: Parameters<typeof seoText>[0]) => seoText(key, studioLanguage);
  const [language, setLanguage] = useState(studioLanguage), [device, setDevice] = useState<"desktop" | "mobile">("desktop"), [keywords, setKeywords] = useState<Record<string, string>>({});
  const current = inputs.find(input => input.language === language) || inputs[0];
  const deferred = useDeferredValue(current);
  if (!current || !deferred) return null;
  const input = { ...deferred, focusKeyword: keywords[deferred.language || "en"] || "" }, result = analyzeContent(input), stats = contentStatistics(input);
  const issues = result.findings.filter(f => f.severity === "critical" || f.severity === "warning");
  let displayUrl = current.url; try { const url = new URL(current.url); displayUrl = `${url.hostname}${url.pathname === "/" ? "" : url.pathname.replaceAll("/", " › ")}`; } catch { /* draft path */ }
  return <section className="seo-editor-panel" aria-label={text("liveLabel")}>
    <header className="seo-editor-heading"><div><span className="eyebrow">{text("category")}</span><h3>{text("liveTitle")}</h3></div><span className={`seo-editor-score ${issues.length ? "seo-warning" : "seo-passed"}`} aria-label={text("scoreLabel")}>{result.score ?? "—"}<small>/100</small></span></header>
    <p className="seo-editor-muted">{text("methodology")}</p>
    <div className="seo-editor-controls"><label>{text("contentLanguage")}<select value={current.language || "en"} onChange={event => setLanguage(event.target.value as "en" | "vi")}>{inputs.map(value => <option value={value.language || "en"} key={value.language || "en"}>{value.language === "vi" ? text("vietnamese") : value.language === "en" ? text("english") : value.language}</option>)}</select></label><label>{text("focusTopic")}<input maxLength={160} value={keywords[current.language || "en"] || ""} onChange={event => setKeywords(previous => ({ ...previous, [current.language || "en"]: event.target.value }))} placeholder={text("focusPlaceholder")}/></label></div>
    <div className="seo-editor-preview-header"><strong><Search size={15} aria-hidden="true"/>{text("searchPreview")}</strong><div role="group" aria-label={text("previewDevice")}><button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor size={15} aria-hidden="true"/>{text("desktop")}</button><button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone size={15} aria-hidden="true"/>{text("mobile")}</button></div></div>
    <div className={`seo-search-preview seo-search-preview-${device}`} lang={current.language}><div className="seo-search-brand">Gary Home</div><div className="seo-search-url">{displayUrl}</div><div className="seo-search-title">{current.title || text("titlePlaceholder")}</div><p>{current.description || text("descriptionPlaceholder")}</p></div>
    <p className="seo-editor-muted">{text("previewNote")}</p>
    <div className="seo-editor-statistics"><span>{[...current.title].length} {text("titleCharacters")}</span><span>{[...current.description].length} {text("descriptionCharacters")}</span><span>{stats.words} {text("wordSegments")}</span></div>
    {note && <p className="seo-editor-muted">{note}</p>}
    <div className="seo-editor-findings">{result.findings.map(rawFinding => {
      const finding = localizeContentFinding(rawFinding, studioLanguage);
      return <details className={`seo-editor-finding seo-${finding.severity}`} key={finding.id}><summary>{finding.severity === "passed" ? <CheckCircle2 size={17} aria-hidden="true"/> : finding.severity === "critical" ? <CircleAlert size={17} aria-hidden="true"/> : <AlertTriangle size={17} aria-hidden="true"/>}<strong>{finding.title}</strong><small>{seoSeverity(finding.severity, studioLanguage)}</small></summary><div><p>{finding.explanation}</p><p><strong>{text("suggestedAction")}: </strong>{finding.recommendation}</p>{finding.evidence && <pre>{finding.evidence}</pre>}</div></details>;
    })}</div>
    <p className="seo-editor-muted">{text("reviewNote")}</p>
  </section>;
}
