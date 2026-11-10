import type { Finding } from "../seo-analysis/types.ts";

type Category = "content" | "technical";
export type ReportPage = {
  url: string; finalUrl: string; language: string; status: number; indexable: boolean;
  content: { score: number | null; findings: Finding[] };
  technical: { score: number | null; findings: Finding[] };
  inspectionStatus?: "inspected" | "failed" | "skipped" | "pending";
  crawlError?: string; attempts?: number;
};
export type ReportState = {
  pages: ReportPage[];
  queue: { kind: string; url: string; language?: string }[];
  skippedUrls: { url: string; reason: string }[];
  diagnostics?: { url: string; kind: string; reason: string; attempts: number; at: number }[];
  stopReason?: string;
};

export function inspectionOutcome(page: ReportPage) {
  return page.inspectionStatus || (page.status > 0 ? "inspected" : "failed");
}
export function evaluatedFindings(page: ReportPage, category: Category) {
  if (inspectionOutcome(page) !== "inspected") return [];
  return page[category].findings.filter((finding, index, rows) => rows.findIndex(other => other.id === finding.id) === index);
}
export function evaluatedScore(pages: ReportPage[], category: Category) {
  const checks = pages.flatMap(page => evaluatedFindings(page, category)).filter(finding => finding.severity !== "recommendation");
  return checks.length ? Math.round(100 * checks.filter(finding => finding.severity === "passed").length / checks.length) : null;
}
export function evaluatedPageScore(page: ReportPage, category: Category) {
  return evaluatedScore([page], category);
}
export function reportPages(state: ReportState): ReportPage[] {
  const pages = [...state.pages], known = new Set(pages.map(page => `${page.url}\n${page.language}`));
  for (const task of state.queue) {
    const key = `${task.url}\n${task.language || "und"}`;
    if (task.kind !== "page" || known.has(key)) continue;
    known.add(key);
    pages.push({ url: task.url, finalUrl: task.url, language: task.language || "und", status: 0, indexable: false,
      inspectionStatus: "pending", content: { score: null, findings: [] }, technical: { score: null, findings: [] } });
  }
  return pages;
}
export function reportCoverage(state: ReportState) {
  const pages = reportPages(state);
  const inspected = pages.filter(page => inspectionOutcome(page) === "inspected");
  return {
    inspected: inspected.length,
    passed: inspected.filter(page => {
      const checks = [...evaluatedFindings(page, "content"), ...evaluatedFindings(page, "technical")].filter(finding => finding.severity !== "recommendation");
      return checks.length > 0 && checks.every(finding => finding.severity === "passed");
    }).length,
    failed: pages.filter(page => inspectionOutcome(page) === "failed").length,
    skipped: pages.filter(page => inspectionOutcome(page) === "skipped").length,
    pending: pages.filter(page => inspectionOutcome(page) === "pending").length,
    skippedUrls: new Set(state.skippedUrls.map(item => item.url)).size,
  };
}
