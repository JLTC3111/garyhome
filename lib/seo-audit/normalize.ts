import { report } from "../seo-analysis/types.ts";
import type { CrawlState } from "./crawler.ts";

// Old runs remain stored verbatim. Repair their presentation at the read
// boundary: a failed fetch never supplies evidence about page SEO.
export function normalizeAuditState(state: CrawlState): CrawlState {
  for (const page of state.pages) {
    if (!page.inspectionStatus) page.inspectionStatus = page.status > 0 ? "inspected" : page.technical.findings.some(f => /robots/.test(f.id)) ? "skipped" : "failed";
    if (page.inspectionStatus !== "inspected") {
      page.crawlError ||= state.skippedUrls.find(item => item.url === page.url)?.reason
        || page.technical.findings.find(f => f.id === "fetch-failed" || /robots/.test(f.id))?.explanation
        || "Page was not inspected. Resume or rescan to evaluate its SEO.";
      page.content = { score: null, findings: [] };
      page.technical = { score: null, findings: [] };
    } else {
      page.content = report(page.content.findings);
      page.technical = report(page.technical.findings);
    }
  }
  return state;
}
