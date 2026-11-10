import { report, type Finding } from "../seo-analysis/types.ts";
import { inspectionOutcome } from "./presentation.ts";
import type { CrawlState } from "./crawler.ts";

// Compare observed public pages within a language. Deliberate canonical aliases
// and the two cookie variants of one URL must not look like duplicate pages.
export function compareAuditMetadata(state: CrawlState) {
  for (const page of state.pages) if (inspectionOutcome(page) === "inspected") page.content = report(page.content.findings.filter(f => !f.id.startsWith("content-duplicate-")));
  for (const field of ["title", "description"] as const) {
    const groups = new Map<string, typeof state.pages>();
    for (const page of state.pages) {
      const value = page[field]?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (!value || !page.indexable || inspectionOutcome(page) !== "inspected") continue;
      const key = page.language + ":" + value;
      groups.set(key, [...(groups.get(key) || []), page]);
    }
    for (const pages of groups.values()) {
      const identities = new Set(pages.map(page => page.canonical || page.finalUrl));
      if (identities.size < 2) continue;
      for (const page of pages) {
        const finding: Finding = {
          id: `content-duplicate-${field}`, category: "content", severity: "warning",
          title: field === "title" ? "Different pages share a title" : "Different pages share a description",
          explanation: `The same ${field} was observed on ${identities.size} distinct preferred URLs in this language. This may make these pages difficult to distinguish.`,
          recommendation: "Review the page purpose and use a specific, accurate summary where appropriate. Shared text is not automatically a search penalty.",
          evidence: [...identities].slice(0, 10).join("\n"),
        };
        page.content = report([...page.content.findings.filter(item => item.id !== finding.id), finding]);
      }
    }
  }
  return state;
}
