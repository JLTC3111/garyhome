import { report, type Finding, type TechnicalInput } from "./types.ts";
// X-Robots-Tag can scope the following comma-separated directives to one bot.
// Report web-search restrictions, not a restriction intended only for another bot.
export function hasNoindex(metaRobots: string[], xRobotsTag = "") {
  if (metaRobots.some(value => /(?:^|[\s,;])(?:noindex|none)(?:$|[\s,;])/i.test(value))) return true;
  let scope = "";
  for (const part of xRobotsTag.split(",")) {
    let directive = part.trim();
    const scoped = directive.match(/^([a-z][a-z0-9_-]*):\s*(.*)$/i);
    if (scoped && scoped[1].toLowerCase() !== "unavailable_after") { scope = scoped[1].toLowerCase(); directive = scoped[2]; }
    if ((!scope || scope === "googlebot") && /(?:^|[\s;])(?:noindex|none)(?:$|[\s;])/i.test(directive)) return true;
  }
  return false;
}
function typedJsonLdNode(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node) || depth > 20) return false;
  const value = node as Record<string, unknown>;
  if ("@graph" in value && (!Array.isArray(value["@graph"]) || !value["@graph"].every(n => n && typeof n === "object" && !Array.isArray(n)))) return false;
  const type = value["@type"];
  const typed = typeof type === "string" && !!type.trim() || Array.isArray(type) && type.length > 0 && type.every(t => typeof t === "string" && !!t.trim());
  return !!typed || Array.isArray(value["@graph"]) && value["@graph"].some(n => typedJsonLdNode(n, depth + 1));
}
export function analyzeTechnical(input: TechnicalInput) {
  // Status zero is a transport failure, not an inspected HTTP/HTML response.
  if (input.status <= 0) return { score: null, findings: [] };
  const d = input.document, findings: Finding[] = [];
  const add = (id: string, severity: Finding["severity"], title: string, explanation: string, recommendation: string, evidence?: string) => findings.push({ id, category: "technical", severity, title, explanation, recommendation, ...(evidence ? { evidence } : {}) });
  const ok = input.status >= 200 && input.status < 300;
  add("technical-http", ok ? "passed" : "critical", ok ? "Successful HTTP response" : "Page is not a successful response", "Search crawlers depend on a successful public response.", ok ? "Keep the published URL available." : "Restore the page, correct its links, or deliberately redirect it to a relevant replacement.", String(input.status));
  const directives = [...d.robots, input.xRobotsTag || ""].join(",").toLowerCase();
  const noindex = hasNoindex(d.robots, input.xRobotsTag);
  add("technical-indexability", noindex ? "critical" : "passed", noindex ? "Public page has a noindex directive" : "No noindex directive found", "Both HTML robots tags and X-Robots-Tag response headers can prevent indexing. Eligibility does not guarantee indexing.", noindex ? "Confirm this restriction is intended. Remove it only if this public page should appear in search." : "Check Search Console separately for actual indexing status.", directives || "No restriction in inspected HTML or response headers.");
  if (input.robotsAllowed !== undefined) add("technical-robots", input.robotsAllowed ? "passed" : "critical", input.robotsAllowed ? "Crawling permitted by robots.txt" : "Blocked by robots.txt", "Robots rules control fetching, independently of noindex directives.", input.robotsAllowed ? "Keep public content crawlable." : "Review the matching rule before allowing this page to be crawled.");
  add("technical-title", d.titleCount === 1 && !!d.title.trim() ? "passed" : "warning", d.titleCount === 1 && d.title.trim() ? "Server HTML contains one title" : "Review server-rendered title", "This check inspects the delivered HTML rather than a browser's document title.", "Use the existing Next.js Metadata API to deliver exactly one nonempty title.", `${d.titleCount} title elements`);
  add("technical-description", d.descriptionCount === 1 && !!d.description.trim() ? "passed" : "warning", d.descriptionCount === 1 && d.description.trim() ? "Server HTML contains a description" : "Review server-rendered description", "The delivered HTML should expose the page's intended description once.", "Provide one nonempty description through the Metadata API.", `${d.descriptionCount} description elements`);
  let canonical: URL | undefined; try { canonical = new URL(d.canonical[0]); } catch { /* reported below */ }
  const canonicalValid = d.canonical.length === 1 && canonical && ["https:", "http:"].includes(canonical.protocol) && !canonical.hash && !canonical.username && !canonical.password;
  add("technical-canonical", canonicalValid ? "passed" : "warning", canonicalValid ? "Canonical URL is parseable" : "Review canonical declaration", "A canonical identifies the preferred URL; missing, multiple or malformed declarations are ambiguous.", canonicalValid ? "Confirm the destination is the intended public indexable page." : "Emit one absolute canonical URL using the Metadata API.", d.canonical.join("\n") || "No canonical found");
  if (canonicalValid) {
    const target = new URL(input.finalUrl || d.url); target.hash = "";
    if (canonical!.href !== target.href) add("technical-canonical-target", "warning", "Canonical points to another URL", "This can be intentional for duplicates, but a mistaken target can consolidate the wrong page.", "Check whether this page is a duplicate. If it is unique, point its canonical at the public preferred URL.", `${target.href} → ${canonical!.href}`);
  }
  if (input.redirects?.length) add("technical-redirects", input.redirects.length > 1 ? "warning" : "recommendation", input.redirects.length > 1 ? "Redirect chain detected" : "URL redirects", "Redirect hops add requests and can conceal stale internal links.", "Update internal links and sitemap entries to the final destination; consolidate chains where possible.", input.redirects.join(" → "));
  if (input.sitemapIncluded !== undefined && !noindex) add("technical-sitemap", input.sitemapIncluded ? "passed" : "warning", input.sitemapIncluded ? "Page appears in the sitemap" : "Page is absent from the inspected sitemap", "A sitemap helps discover preferred public URLs; absence alone does not prevent indexing.", input.sitemapIncluded ? "Keep sitemap URLs aligned with preferred public URLs." : "Add the canonical public URL if this page should be indexed.");
  if (input.sitemapIncluded && noindex) add("technical-sitemap-noindex", "warning", "Sitemap includes a noindex page", "The sitemap and indexing directive send conflicting intentions.", "Remove intentionally excluded pages from the sitemap, or correct an unintended noindex directive.");
  if (input.brokenLinks !== undefined) add("technical-broken-links", input.brokenLinks.length ? "warning" : "passed", input.brokenLinks.length ? "Broken link responses detected" : "Inspected links returned no known errors", "Only links with an observed failing HTTP response are classified as broken. Unchecked links are not validated.", input.brokenLinks.length ? "Correct each destination or replace the link with a relevant working page." : "Review skipped and unchecked links separately.", input.brokenLinks.slice(0, 10).map(l => `${l.status} ${l.url}`).join("\n"));
  if (!d.jsonLd.length) add("technical-structured-data", "recommendation", "No JSON-LD found", "Structured data is optional and should describe eligible, visible content accurately.", "Add a relevant schema type only when appropriate. Validate eligibility with Google's Rich Results Test.");
  else {
    let invalid = 0, missingType = 0;
    for (const raw of d.jsonLd) { try { const parsed: unknown = JSON.parse(raw); const nodes = Array.isArray(parsed) ? parsed : [parsed]; const typed = nodes.length > 0 && nodes.every(node => typedJsonLdNode(node)); if (!typed) missingType++; } catch { invalid++; } }
    add("technical-structured-data", invalid || missingType ? "warning" : "passed", invalid || missingType ? "Review JSON-LD syntax and structure" : "JSON-LD parses successfully", "This validates JSON syntax and a typed object or nonempty typed graph, not schema eligibility or rich result requirements.", invalid || missingType ? "Correct invalid JSON and provide appropriate schema types. Then run a schema validator." : "Verify schema properties and visible content using a dedicated schema validator.", `${d.jsonLd.length} blocks; ${invalid} invalid JSON; ${missingType} without a valid typed object/graph`);
  }
  const languageValid = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(d.htmlLanguage);
  add("technical-language", languageValid ? "passed" : "warning", languageValid ? "HTML language is declared" : "Declare the document language", "The HTML lang attribute helps language-sensitive tools and accessibility.", "Set the HTML language to the actual language of the response.", d.htmlLanguage || "Missing lang attribute");
  if (d.hreflang.length) {
    const invalid = d.hreflang.filter(h => { try { const u = new URL(h.href); return !["https:", "http:"].includes(u.protocol) || !/^(?:x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/i.test(h.language); } catch { return true; } });
    const duplicates = new Set(d.hreflang.map(h => h.language.toLowerCase())).size !== d.hreflang.length;
    add("technical-hreflang", invalid.length || duplicates ? "warning" : "passed", invalid.length || duplicates ? "Review hreflang declarations" : "Hreflang declarations are parseable", "Syntax alone cannot establish valid language targeting or reciprocal return links.", "Use distinct public localized URLs, self references and reciprocal alternate links. Verify destinations return the intended language.", invalid.map(h => `${h.language}: ${h.href}`).join("\n"));
    const ownUrl = new URL(input.finalUrl || d.url); ownUrl.hash = "";
    const selfReference = d.hreflang.some(alternate => {
      try {
        const target = new URL(alternate.href); target.hash = "";
        return target.href === ownUrl.href && alternate.language.toLowerCase() !== "x-default"
          && (!d.htmlLanguage || alternate.language.split("-")[0].toLowerCase() === d.htmlLanguage.split("-")[0].toLowerCase());
      } catch { return false; }
    });
    add("technical-hreflang-self", selfReference ? "passed" : "warning", selfReference ? "Language alternates include this page" : "Language alternates lack a self reference", "Each localized page in an hreflang set should include itself as well as its other language versions. An x-default entry alone is not a language-specific self reference.", selfReference ? "Keep this reference consistent with the page's public URL and language." : "Add this page's own public URL with the appropriate language code to its hreflang set.", ownUrl.href);
  } else add("technical-hreflang", "recommendation", "No URL language alternates declared", "Cookie-based language switching alone does not provide distinct discoverable language URLs.", "If separate localized URLs exist, declare reciprocal hreflang alternates. Do not invent alternate URLs that are unavailable.");
  const mobile = !!d.viewport && /width\s*=\s*device-width/i.test(d.viewport);
  add("technical-viewport", mobile ? "passed" : "warning", mobile ? "Responsive viewport is declared" : "Review mobile viewport", "A viewport declaration is one mobile prerequisite; this crawl does not measure rendered mobile usability.", "Use a device-width viewport and manually check the responsive page.");
  if (input.responseMs !== undefined) add("technical-response-time", "recommendation", "Server response timing recorded", "A single server fetch is not a Core Web Vitals or browser performance measurement.", "Compare timings over time. Use browser performance tooling to investigate slow pages.", `${Math.round(input.responseMs)} ms${input.bytes !== undefined ? `; ${input.bytes} HTML bytes` : ""}`);
  return report(findings);
}
