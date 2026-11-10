export type Severity = "critical" | "warning" | "recommendation" | "passed";
export type Category = "content" | "technical";
export type Finding = {
  id: string; category: Category; severity: Severity; title: string;
  explanation: string; recommendation: string; evidence?: string;
};
export type AnalysisReport = { score: number | null; findings: Finding[] };
export type ContentInput = {
  url: string; language?: string; title: string; description: string; text: string;
  headings: { level: number; text: string }[];
  links: { href: string; text: string }[];
  images: { src: string; alt: string | null; decorative?: boolean }[];
  focusKeyword?: string;
};
export type ParsedDocument = ContentInput & {
  canonical: string[]; robots: string[]; hreflang: { language: string; href: string }[];
  jsonLd: string[]; titleCount: number; descriptionCount: number; htmlLanguage: string;
  viewport: string | null;
};
export type TechnicalInput = {
  document: ParsedDocument; status: number; finalUrl?: string; redirects?: string[];
  responseMs?: number; bytes?: number; xRobotsTag?: string; robotsAllowed?: boolean;
  sitemapIncluded?: boolean; brokenLinks?: { url: string; status: number }[];
};
// An inspection summary, never a prediction of search rank. Advisory checks do
// not change the score; unavailable checks must not be reported as passed.
export function report(findings: Finding[]): AnalysisReport {
  const scored = findings.filter(f => f.severity !== "recommendation");
  return { score: scored.length ? Math.round(100 * scored.filter(f => f.severity === "passed").length / scored.length) : null, findings };
}
