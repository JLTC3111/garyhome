import type { Finding } from "../seo-analysis/types.ts";
import { normalizedSeoUrl, preferredUiUrl } from "../seo-analysis/url-identity.ts";
import { localizedRoute, unlocalizedPath } from "../localized-routes.ts";

type Category = "content" | "technical";
export type ReportPage = {
  url: string; finalUrl: string; language: string; status: number; indexable: boolean;
  canonical?: string; requestedLanguage?: string; declaredLanguage?: string; urlLanguage?: string;
  content: { score: number | null; findings: Finding[] };
  technical: { score: number | null; findings: Finding[] };
  inspectionStatus?: "inspected" | "failed" | "skipped" | "pending";
  crawlError?: string; attempts?: number;
};
export type ReportState = {
  pages: ReportPage[];
  queue: { kind: string; url: string; language?: string; attempts?: number }[];
  skippedUrls: { url: string; reason: string }[];
  diagnostics?: { url: string; kind: string; reason: string; attempts: number; at: number }[];
  stopReason?: string; requests?: number; config?: { allowedOrigins?: string[] };
};
export function declaredPageLanguage(page: ReportPage) {
  const evidence = page.declaredLanguage || page.technical.findings.find(f => f.id === "technical-language")?.evidence;
  return evidence && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(evidence.trim()) ? evidence.trim().toLowerCase() : undefined;
}
export function observedPageLanguage(page: ReportPage) { return declaredPageLanguage(page)?.split("-")[0] || page.language || "und"; }
export function inspectionOutcome(page: ReportPage) { return page.inspectionStatus || (page.status > 0 ? "inspected" : "failed"); }
export function responseIdentity(page: ReportPage) {
  let url = page.url; try { url = normalizedSeoUrl(url).href; } catch { /* retain raw evidence */ }
  return `${url}\n${observedPageLanguage(page)}`;
}
export function evaluatedFindings(page: ReportPage, category: Category) {
  if (inspectionOutcome(page) !== "inspected") return [];
  return page[category].findings.filter((finding, index, rows) => rows.findIndex(other => other.id === finding.id) === index);
}
const severityRank = { passed: 0, recommendation: 1, warning: 2, critical: 3 };
export function evaluatedPages(pages: ReportPage[]) {
  const groups = new Map<string, ReportPage>();
  for (const original of pages) {
    const key = responseIdentity(original), existing = groups.get(key), page = { ...original, language: observedPageLanguage(original) };
    if (!existing || inspectionOutcome(existing) !== "inspected") { groups.set(key, page); continue; }
    if (inspectionOutcome(page) !== "inspected") continue;
    const merged = { ...existing };
    for (const category of ["content", "technical"] as const) {
      const checks = new Map<string, Finding>();
      for (const finding of [...evaluatedFindings(existing, category), ...evaluatedFindings(page, category)]) {
        const prior = checks.get(finding.id);
        if (!prior || severityRank[finding.severity] > severityRank[prior.severity]) checks.set(finding.id, finding);
      }
      merged[category] = { score: null, findings: [...checks.values()] };
    }
    groups.set(key, merged);
  }
  return [...groups.values()];
}
export function reportScoreDetails(pages: ReportPage[], category: Category) {
  const findings = evaluatedPages(pages).flatMap(page => evaluatedFindings(page, category));
  const checks = findings.filter(finding => finding.severity !== "recommendation"), passed = checks.filter(finding => finding.severity === "passed").length;
  return { passed, failed: checks.length - passed, evaluated: checks.length, recommendations: findings.length - checks.length,
    score: checks.length ? Math.round(100 * passed / checks.length) : null,
    formula: "round(100 × passed applicable checks / evaluated applicable checks)",
    unit: "One check per normalized requested URL and observed server language; conflicting repeated observations use the worst observed severity." };
}
export function evaluatedScore(pages: ReportPage[], category: Category) { return reportScoreDetails(pages, category).score; }
export function evaluatedPageScore(page: ReportPage, category: Category) { return evaluatedScore([page], category); }
export function reportPages(state: ReportState): ReportPage[] {
  const pages = evaluatedPages(state.pages), known = new Set(pages.map(responseIdentity));
  for (const task of state.queue) {
    if (task.kind !== "page") continue;
    const urlLanguage = (() => { try { return localizedRoute(new URL(task.url).pathname)?.language; } catch { return undefined; } })();
    const language = urlLanguage || task.language || "und";
    const pending: ReportPage = { url: task.url, finalUrl: task.url, language, status: 0, indexable: false,
      inspectionStatus: "pending", content: { score: null, findings: [] }, technical: { score: null, findings: [] } };
    const key = responseIdentity(pending); if (known.has(key)) continue;
    known.add(key); pages.push(pending);
  }
  return pages;
}
export function reportCoverage(state: ReportState) {
  const pages = reportPages(state), inspected = pages.filter(page => inspectionOutcome(page) === "inspected");
  const passed = inspected.filter(page => {
    const checks = [...evaluatedFindings(page, "content"), ...evaluatedFindings(page, "technical")].filter(f => f.severity !== "recommendation");
    return checks.length > 0 && checks.every(f => f.severity === "passed");
  }).length;
  const uniqueUrls = new Set(pages.map(page => { try { return normalizedSeoUrl(page.url).href; } catch { return page.url; } }));
  const resources = new Set(pages.map(page => { try { const url = normalizedSeoUrl(page.url); url.pathname = unlocalizedPath(url.pathname); return url.href; } catch { return page.url; } }));
  const canonicalVariants = new Set(inspected.map(page => { let url = page.canonical || page.finalUrl; try { url = normalizedSeoUrl(url).href; } catch { /* retain */ } return `${url}\n${observedPageLanguage(page)}`; }));
  const byLanguage: Record<string, { inspected: number; failed: number; skipped: number; pending: number }> = {};
  for (const page of pages) { const language = observedPageLanguage(page), outcome = inspectionOutcome(page); byLanguage[language] ||= { inspected: 0, failed: 0, skipped: 0, pending: 0 }; byLanguage[language][outcome]++; }
  return { inspected: inspected.length, passed, issues: inspected.length - passed,
    failed: pages.filter(page => inspectionOutcome(page) === "failed").length,
    skipped: pages.filter(page => inspectionOutcome(page) === "skipped").length,
    pending: pages.filter(page => inspectionOutcome(page) === "pending").length,
    skippedUrls: new Set(state.skippedUrls.map(item => item.url)).size,
    observations: state.pages.length, inspectedObservations: state.pages.filter(page => inspectionOutcome(page) === "inspected").length,
    duplicateObservations: state.pages.length - evaluatedPages(state.pages).length,
    uniqueUrls: uniqueUrls.size, uniqueResources: resources.size, localeVariants: pages.length, canonicalVariants: canonicalVariants.size,
    pageAttempts: state.pages.reduce((n, page) => n + Math.max(0, page.attempts ?? (page.status > 0 ? 1 : 0)), 0),
    requests: state.requests ?? null, byLanguage };
}
export type GroupedFinding = {
  key: string; causeId: string; category: Category; severity: Finding["severity"]; title: string;
  explanation: string; recommendation: string; canonicalUrl: string; language: string;
  occurrences: number; urls: string[]; evidence: string[];
};
export function groupedFindings(state: Pick<ReportState, "pages">) {
  const groups = new Map<string, GroupedFinding>();
  for (const page of state.pages) for (const category of ["content", "technical"] as const) for (const finding of evaluatedFindings(page, category)) {
    if (finding.severity === "passed") continue;
    let canonicalUrl = page.canonical || page.finalUrl || page.url;
    try { canonicalUrl = preferredUiUrl(canonicalUrl).href; } catch { /* preserve evidence */ }
    const global = finding.id === "sitemap-discovery" || finding.id === "technical-sitemap", causeId = global ? "sitemap-coverage" : finding.id;
    if (global) { try { canonicalUrl = new URL(page.url).origin + "/sitemap.xml"; } catch { /* preserve */ } }
    const language = observedPageLanguage(page), key = `${category}:${causeId}:${canonicalUrl}:${language}:${finding.severity}`;
    let group = groups.get(key);
    if (!group) { group = { key, causeId, category, severity: finding.severity, title: finding.title, explanation: finding.explanation,
      recommendation: finding.recommendation, canonicalUrl, language, occurrences: 0, urls: [], evidence: [] }; groups.set(key, group); }
    group.occurrences++;
    if (!group.urls.includes(page.url)) group.urls.push(page.url);
    if (finding.evidence && !group.evidence.includes(finding.evidence)) group.evidence.push(finding.evidence);
  }
  return [...groups.values()].sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || b.occurrences - a.occurrences || a.key.localeCompare(b.key));
}
