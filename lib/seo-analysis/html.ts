import type { ParsedDocument } from "./types.ts";
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", copy: "©" };
export function decodeHtml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? whole;
    const n = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
  });
}
function attributes(tag: string) {
  const result: Record<string, string> = {};
  const body = tag.replace(/^<\/?[^\s/>]+/, "").replace(/\/?\s*>$/, "");
  for (const match of body.matchAll(/([^\s=/'">]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s'"=<>`]+)))?/g)) result[match[1].toLowerCase()] ??= decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}
function absolute(value: string, base: string) { try { return new URL(value, base).href; } catch { return value; } }
// Small inert HTML tokenizer: raw script/style bodies are never treated as
// markup, quoted > characters are retained, and no code or network is executed.
// This inspects server HTML, not a browser's repaired/rendered DOM.
export function parseHtml(html: string, url: string): ParsedDocument {
  const doc: ParsedDocument = { url, title: "", description: "", text: "", headings: [], links: [], images: [], canonical: [], robots: [], hreflang: [], jsonLd: [], titleCount: 0, descriptionCount: 0, htmlLanguage: "", viewport: null };
  const tokens = html.match(/<!--[\s\S]*?(?:-->|$)|<![^>]*>|<(script|style|template|noscript)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?(?:<\/\1\s*>|$)|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gi) || [];
  let inTitle = false, heading: { level: number; text: string } | null = null, link: { href: string; text: string } | null = null;
  let mainDepth = 0, excludedDepth = 0, mainFound = false;
  const mainHeadings: ParsedDocument["headings"] = [];
  const excludedTags: string[] = [];
  const allText: string[] = [], mainText: string[] = [];
  for (const token of tokens) {
    if (/^<!--|^<!/i.test(token)) continue;
    if (/^<(script|style|template|noscript)\b/i.test(token)) {
      const open = token.match(/^<(?:[^>"']|"[^"]*"|'[^']*')*>/)?.[0] || "";
      if (/^<script\b/i.test(token) && attributes(open).type?.toLowerCase() === "application/ld+json") doc.jsonLd.push(token.slice(open.length).replace(/<\/script\s*>$/i, ""));
      continue;
    }
    if (token.startsWith("<")) {
      const name = token.match(/^<\/?\s*([a-z0-9:-]+)/i)?.[1]?.toLowerCase(); if (!name) continue;
      const closing = /^<\//.test(token), attrs = closing ? {} : attributes(token);
      if (name === "title") { inTitle = !closing; if (!closing) { doc.titleCount++; if (doc.titleCount > 1) inTitle = false; } }
      if (name === "html" && !closing) { doc.htmlLanguage = attrs.lang || ""; doc.language = attrs.lang || undefined; }
      if (name === "main" || name === "article") { mainDepth += closing ? -1 : 1; mainDepth = Math.max(0, mainDepth); if (!closing) mainFound = true; }
      if (["nav", "header", "footer", "head"].includes(name)) {
        if (!closing && (name === "nav" || name === "head" || !mainDepth)) excludedTags.push(name);
        if (closing) { const i = excludedTags.lastIndexOf(name); if (i >= 0) excludedTags.splice(i, 1); }
        excludedDepth = excludedTags.length;
      }
      if (name === "meta" && !closing) {
        const key = (attrs.name || "").toLowerCase();
        if (key === "description") { doc.descriptionCount++; if (doc.descriptionCount === 1) doc.description = attrs.content || ""; }
        if (["robots", "googlebot"].includes(key)) doc.robots.push(attrs.content || "");
        if (key === "viewport") doc.viewport = attrs.content || "";
      }
      if (name === "link" && !closing) {
        const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
        if (rel.includes("canonical")) doc.canonical.push(attrs.href ? absolute(attrs.href, url) : "");
        if (rel.includes("alternate") && attrs.hreflang) doc.hreflang.push({ language: attrs.hreflang, href: attrs.href ? absolute(attrs.href, url) : "" });
      }
      if (/^h[1-6]$/.test(name)) {
        if (closing && heading) { heading.text = heading.text.replace(/\s+/g, " ").trim(); doc.headings.push(heading); if (mainDepth && !excludedDepth) mainHeadings.push(heading); heading = null; }
        if (!closing) heading = { level: Number(name[1]), text: "" };
      }
      if (name === "a") {
        if (closing && link) { link.text = link.text.replace(/\s+/g, " ").trim(); doc.links.push(link); link = null; }
        if (!closing && attrs.href !== undefined) link = { href: absolute(attrs.href, url), text: attrs["aria-label"] || attrs.title || "" };
      }
      if (name === "img" && !closing) {
        doc.images.push({ src: attrs.src ? absolute(attrs.src, url) : "", alt: attrs.alt ?? null, decorative: attrs.role === "presentation" || attrs.role === "none" || attrs["aria-hidden"] === "true" });
        if (link && attrs.alt) link.text += ` ${attrs.alt}`;
      }
      if (["p", "div", "section", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) { allText.push("\n\n"); if (mainDepth && !excludedDepth) mainText.push("\n\n"); }
      continue;
    }
    const value = decodeHtml(token).replace(/[\t\r\n ]+/g, " ");
    if (inTitle) doc.title += value;
    if (heading) heading.text += value;
    if (link) link.text += ` ${value}`;
    if (!excludedDepth && !inTitle) { allText.push(value); if (mainDepth) mainText.push(value); }
  }
  if (link) doc.links.push(link);
  doc.title = doc.title.trim();
  if (mainFound) doc.headings = mainHeadings;
  doc.text = (mainFound ? mainText : allText).join("").replace(/ *\n(?: *\n)+ */g, "\n\n").trim();
  return doc;
}
