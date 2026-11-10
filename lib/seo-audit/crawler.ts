import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { parseHtml } from "../seo-analysis/html.ts";
import { analyzeContent } from "../seo-analysis/content.ts";
import { analyzeTechnical, hasNoindex } from "../seo-analysis/technical.ts";
import type { AnalysisReport, Finding } from "../seo-analysis/types.ts";

export type CrawlConfig = {
  allowedOrigins: string[]; maxUrls?: number; maxDepth?: number; concurrency?: number;
  requestIntervalMs?: number; timeoutMs?: number; maxDurationMs?: number;
  scope?: "site" | "page"; languages?: string[];
};
type Config = Required<CrawlConfig>;
export type CrawlTask = { kind: "robots" | "sitemap" | "page" | "link"; url: string; depth: number; language?: string; source?: string; attempts?: number };
type RobotsRule = { path: string; allow: boolean };
type RobotsRecord = { allowed: boolean; rules: RobotsRule[]; delayMs: number; fetched: boolean; error?: string };
export type AuditPage = {
  url: string; finalUrl: string; status: number; language: string; indexable: boolean; canonical?: string;
  content: AnalysisReport; technical: AnalysisReport; responseMs: number; bytes: number;
  title?: string; description?: string; hreflang?: { language: string; href: string }[]; links?: string[];
};
export type CrawlState = {
  version: 1; status: "queued" | "running" | "completed" | "incomplete" | "failed";
  startedAt: number; updatedAt: number; finishedAt?: number; config: Config; queue: CrawlTask[];
  pages: AuditPage[]; skippedUrls: { url: string; reason: string }[]; omittedSkipped?: number;
  visited: string[]; canonicalUrls: string[]; robots: Record<string, RobotsRecord>;
  hostNextAt: Record<string, number>; sitemapUrls: string[]; linkChecks: Record<string, { status: number; finalUrl: string }>;
  requests: number; error?: string;
};
type AdvanceOptions = {
  fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>; budgetMs?: number;
  resolveHost?: (hostname: string) => Promise<string[]>;
};
const USER_AGENT = "GaryHomeSEO/1.0";
const EXCLUDED = /(?:^|\/)(?:admin|account|auth|login|logout|sign-?in|sign-?up|api|preview|private|staging|saved|cart|_next|\.well-known)(?:\/|$)/i;
const ASSET = /\.(?:avif|bmp|css|csv|docx?|eot|gif|gz|ico|jpe?g|js|json|map|mp[34]|ogg|otf|pdf|png|rar|svg|tar|ttf|txt|web[mp]|woff2?|xlsx?|xml|zip)$/i;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_LINK_CHECKS = 100;
const MAX_REQUESTS = 2000;
const cap = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value!))) : fallback;

/** Literal addresses and DNS answers are checked before every request, including every redirect hop. */
export function isPublicAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    const [, , c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(ip) === 6) {
    // IPv4 mapped, transition, local, multicast and documentation ranges are not crawl targets.
    const [first, second] = ip.split(":").map(part => parseInt(part || "0", 16));
    return first >= 0x2000 && first < 0x4000 && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  return false;
}
function safeHostname(host: string) {
  const hostname = host.replace(/^\[|\]$/g, "").toLowerCase();
  return isIP(hostname) ? isPublicAddress(hostname) : hostname.includes(".") && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(hostname);
}
export function normalizeCrawlUrl(value: string, base?: string, allowHttp = false): string | null {
  try {
    const url = new URL(value, base);
    if (!(url.protocol === "https:" || allowHttp && url.protocol === "http:") || url.username || url.password || url.port && url.port !== (url.protocol === "http:" ? "80" : "443") || !safeHostname(url.hostname) || url.href.length > 2048) return null;
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid|gclid)/i.test(name)) url.searchParams.delete(name);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}
export function isExcludedUrl(value: string) {
  try {
    const url = new URL(value), path = decodeURIComponent(url.pathname);
    return EXCLUDED.test(path) || ASSET.test(path) || /\\|\/\//.test(path) || [...url.searchParams.keys()].some(key => /preview|token|secret|password|auth/i.test(key));
  } catch { return true; }
}
const keyFor = (task: CrawlTask) => `${task.kind}:${task.language || ""}:${task.url}`;
function skip(state: CrawlState, url: string, reason: string) {
  if (state.skippedUrls.some(item => item.url === url && item.reason === reason)) return;
  if (state.skippedUrls.length < 1000) state.skippedUrls.push({ url, reason });
  else state.omittedSkipped = (state.omittedSkipped || 0) + 1;
}
function push(state: CrawlState, task: CrawlTask) {
  const url = normalizeCrawlUrl(task.url, undefined, task.kind === "link" || task.kind === "robots");
  if (!url) { skip(state, task.url, "Unsafe or unsupported URL"); return; }
  task.url = url;
  if (task.kind === "page" || task.kind === "sitemap") {
    if (!state.config.allowedOrigins.includes(new URL(url).origin)) { skip(state, url, "Outside configured domains"); return; }
  }
  if ((task.kind === "page" || task.kind === "link") && isExcludedUrl(url)) { skip(state, url, "Excluded route or static asset"); return; }
  if (task.depth > state.config.maxDepth) { skip(state, url, "Maximum crawl depth reached"); return; }
  const key = keyFor(task);
  if (state.visited.includes(key) || state.queue.some(item => keyFor(item) === key)) return;
  if (task.kind === "page" && state.pages.length + state.queue.filter(item => item.kind === "page").length >= state.config.maxUrls * state.config.languages.length) { skip(state, url, "Maximum URL limit reached"); return; }
  if (task.kind === "link" && state.visited.filter(item => item.startsWith("link:")).length + state.queue.filter(item => item.kind === "link").length >= MAX_LINK_CHECKS) { skip(state, url, "Link inspection limit reached"); return; }
  if (state.queue.length >= 2000) { skip(state, url, "Discovery queue limit reached"); return; }
  state.queue.push(task);
}
function pushPages(state: CrawlState, url: string, depth: number, source?: string) {
  for (const language of state.config.languages) push(state, { kind: "page", url, depth, language, source });
}
export function createCrawl(input: CrawlConfig, seeds: string[], now = Date.now()): CrawlState {
  const allowedOrigins = [...new Set(input.allowedOrigins.map(value => normalizeCrawlUrl(value)).filter((value): value is string => !!value).map(value => new URL(value).origin))];
  if (!allowedOrigins.length || allowedOrigins.length > 10) throw new Error("Configure between one and ten public HTTPS origins before scanning.");
  const config: Config = {
    allowedOrigins, maxUrls: cap(input.maxUrls, 500, 1, 500), maxDepth: cap(input.maxDepth, 4, 0, 4),
    concurrency: cap(input.concurrency, 2, 1, 2), requestIntervalMs: cap(input.requestIntervalMs, 1000, 1000, 60_000),
    timeoutMs: cap(input.timeoutMs, 10_000, 100, 10_000), maxDurationMs: cap(input.maxDurationMs, 900_000, 1000, 900_000),
    scope: input.scope === "page" ? "page" : "site", languages: [...new Set(input.languages?.filter(language => /^[a-z]{2,3}(?:-[a-zA-Z]{2,8})?$/.test(language)) || ["en"])].slice(0,10),
  };
  if (!config.languages.length) config.languages = ["en"];
  const state: CrawlState = { version: 1, status: "queued", startedAt: now, updatedAt: now, config, queue: [], pages: [], skippedUrls: [], visited: [], canonicalUrls: [], robots: {}, hostNextAt: {}, sitemapUrls: [], linkChecks: {}, requests: 0 };
  for (const origin of allowedOrigins) push(state, { kind: "robots", url: origin + "/robots.txt", depth: 0 });
  if (config.scope === "site") for (const origin of allowedOrigins) push(state, { kind: "sitemap", url: origin + "/sitemap.xml", depth: 0 });
  for (const seed of seeds) pushPages(state, seed, 0);
  return state;
}

/** Match the most specific applicable user-agent group, and longest rule; Allow wins ties. */
export function parseRobots(text: string): { record: RobotsRecord; sitemaps: string[] } {
  const groups: { agents: string[]; rules: RobotsRule[]; delayMs: number }[] = [];
  let group: typeof groups[number] | undefined, hasRules = false;
  const sitemaps: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim(), separator = line.indexOf(":");
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase(), value = line.slice(separator + 1).trim();
    if (name === "sitemap") { if (value) sitemaps.push(value); continue; }
    if (name === "user-agent") {
      if (!group || hasRules) { group = { agents: [], rules: [], delayMs: 0 }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (name === "allow" || name === "disallow")) {
      hasRules = true; if (value) group.rules.push({ path: value, allow: name === "allow" });
    } else if (group && name === "crawl-delay") { hasRules = true; if (Number.isFinite(Number(value))) group.delayMs = Math.min(900_000, Math.max(0, Number(value) * 1000)); }
  }
  const matches = groups.map(item => ({ item, specificity: Math.max(-1, ...item.agents.map(agent => agent === "*" ? 0 : USER_AGENT.toLowerCase().startsWith(agent) ? agent.length : -1)) })).filter(item => item.specificity >= 0);
  const mostSpecific = Math.max(-1, ...matches.map(item => item.specificity)), selected = matches.filter(item => item.specificity === mostSpecific).map(item => item.item);
  return { record: { allowed: true, rules: selected.flatMap(item => item.rules), delayMs: Math.max(0, ...selected.map(item => item.delayMs)), fetched: true }, sitemaps };
}
export function robotsAllows(record: RobotsRecord | undefined, value: string) {
  if (!record?.fetched || !record.allowed) return false;
  const url = new URL(value), target = url.pathname + url.search;
  const matching = record.rules.filter(rule => {
    const pattern = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
    try { return new RegExp("^" + pattern).test(target); } catch { return false; }
  }).sort((a, b) => b.path.replace(/[\*$]/g, "").length - a.path.replace(/[\*$]/g, "").length || Number(b.allow) - Number(a.allow));
  return !matching.length || matching[0].allow;
}
function xmlLocations(xml: string) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/gi)].slice(0, 2000).map(match => match[1].replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, "$1").trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}
function reportFinding(id: string, title: string, explanation: string, recommendation: string, severity: Finding["severity"] = "warning"): Finding {
  return { id, category: "technical", severity, title, explanation, recommendation };
}
function appendFinding(report: AnalysisReport, finding: Finding) {
  const index = report.findings.findIndex(item => item.id === finding.id);
  if (index >= 0) report.findings[index] = finding;
  else report.findings.push(finding);
  const applicable = report.findings.filter(item => item.severity !== "recommendation");
  report.score = applicable.length ? Math.round(100 * applicable.filter(item => item.severity === "passed").length / applicable.length) : null;
}
class DeferredRequest extends Error {
  readonly nextAt: number;
  constructor(nextAt: number) { super("Server requested a later retry"); this.nextAt = nextAt; }
}
class CrawlLimit extends Error {}
class NeedsRobots extends Error {
  readonly origin: string;
  constructor(origin: string) { super("Redirect target needs robots.txt verification"); this.origin = origin; }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Request timed out", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
/** Pin DNS to the checked address while retaining hostname verification/SNI for TLS. */
function pinnedFetch(url: string, init: RequestInit, addresses: string[]): Promise<Response> {
  return new Promise((resolve, reject) => {
    let request: ReturnType<typeof httpsRequest>;
    try {
      const transport = new URL(url).protocol === "http:" ? httpRequest : httpsRequest;
      request = transport(url, {
        method: "GET", agent: false, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal || undefined,
        lookup: (_hostname, options, callback) => {
          const selected = addresses.map(address => ({ address, family: isIP(address) }));
          if (options.all) callback(null, selected);
          else callback(null, selected[0].address, selected[0].family);
        },
      }, incoming => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            incoming.on("data", chunk => { incoming.pause(); if (!cancelled) controller.enqueue(new Uint8Array(chunk)); });
            incoming.on("end", () => { if (!cancelled) controller.close(); });
            incoming.on("error", error => { if (!cancelled) controller.error(error); });
          },
          pull() { incoming.resume(); }, cancel() { cancelled = true; incoming.destroy(); },
        });
        const emptyBody = [204,205,304].includes(incoming.statusCode || 0);
        if (emptyBody) { cancelled = true; incoming.resume(); }
        resolve(new Response(emptyBody ? null : body, { status: incoming.statusCode || 502, headers }));
      });
      request.on("error", reject); request.end();
    } catch (error) { reject(error); }
  });
}
async function boundedBody(response: Response, maximum: number, signal: AbortSignal) {
  if (Number(response.headers.get("content-length")) > maximum) { await response.body?.cancel(); throw new Error("Response exceeds the 2 MB inspection limit"); }
  if (!response.body) return { text: "", bytes: 0 };
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maximum) throw new Error("Response exceeds the inspection size limit"); chunks.push(value); }
    if (signal.aborted) throw new DOMException("Request timed out", "AbortError");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); }
  const joined = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(joined), bytes };
}

/** One serializable chunk. No detached work: the caller persists the returned state before another chunk. */
export async function advanceCrawl(state: CrawlState, options: AdvanceOptions = {}): Promise<CrawlState> {
  if (!["queued", "running"].includes(state.status)) return state;
  const now = options.now || Date.now, sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))), fetcher = options.fetch;
  const resolveHost = options.resolveHost || (async hostname => (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address));
  const chunkEnd = now() + cap(options.budgetMs, 12_000, 100, 60_000), auditEnd = state.startedAt + state.config.maxDurationMs;
  state.status = "running";
  const allowed = (url: string) => state.config.allowedOrigins.includes(new URL(url).origin);
  async function request(task: CrawlTask) {
    let current = task.url;
    const redirects: string[] = [], started = now(); let throttledMs = 0;
    for (let hop = 0; hop <= 5; hop++) {
      const normalized = normalizeCrawlUrl(current, undefined, task.kind === "link" || task.kind === "robots");
      if (!normalized) throw new Error("Unsafe redirect target");
      const url = new URL(normalized);
      if (EXCLUDED.test(decodeURIComponent(url.pathname))) throw new Error("Request reaches an excluded route");
      if (task.kind !== "link" && task.kind !== "robots" && !allowed(normalized)) throw new Error("Redirect leaves configured domains");
      if (task.kind === "robots" && url.origin !== new URL(task.url).origin && !(new URL(task.url).protocol === "http:" && url.protocol === "https:" && url.hostname === new URL(task.url).hostname)) throw new Error("robots.txt redirects outside its origin");
      if ((task.kind === "page" || task.kind === "link") && isExcludedUrl(normalized)) throw new Error("Redirect reaches an excluded route or asset");
      if (task.kind !== "robots" && !state.robots[url.origin]) throw new NeedsRobots(url.origin);
      if (task.kind !== "robots" && !robotsAllows(state.robots[url.origin], normalized)) throw new Error("Blocked by robots.txt or robots.txt unavailable");
      const waitMs = Math.max(0, (state.hostNextAt[url.host] || 0) - now());
      if (now() + waitMs + 100 >= Math.min(chunkEnd, auditEnd)) throw new CrawlLimit("Chunk budget exhausted");
      if (waitMs) { const waitStarted = now(); await sleep(waitMs); throttledMs += now() - waitStarted; }
      if (state.requests >= MAX_REQUESTS) throw new CrawlLimit("Maximum request limit reached");
      const remaining = Math.min(chunkEnd, auditEnd) - now();
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Math.min(state.config.timeoutMs, remaining));
      try {
        // Validation fails closed if this deployment cannot resolve DNS. No request is made with an unchecked address.
        const addresses = isIP(url.hostname.replace(/^\[|\]$/g, "")) ? [url.hostname.replace(/^\[|\]$/g, "")] : await abortable(resolveHost(url.hostname), controller.signal);
        if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new Error("Target resolves to a private or reserved address");
        state.hostNextAt[url.host] = now() + Math.max(state.config.requestIntervalMs, state.robots[url.origin]?.delayMs || 0);
        state.requests++;
        const init: RequestInit = { redirect: "manual", cache: "no-store", credentials: "omit", signal: controller.signal, headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "identity", Accept: task.kind === "sitemap" ? "application/xml,text/xml" : "text/html,text/plain;q=0.9,*/*;q=0.1", ...(task.language && allowed(normalized) ? { "Accept-Language": task.language, Cookie: "gary-language=" + task.language } : {}) } };
        const response = await abortable(fetcher ? fetcher(normalized, init) : pinnedFetch(normalized, init, addresses), controller.signal);
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get("retry-after"), seconds = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : 30_000;
          const nextAt = now() + Math.max(state.config.requestIntervalMs, Number.isFinite(seconds) ? seconds : 30_000);
          state.hostNextAt[url.host] = nextAt; await response.body?.cancel(); throw new DeferredRequest(nextAt);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location"); await response.body?.cancel();
          if (!location) throw new Error("Redirect has no Location header");
          const target = normalizeCrawlUrl(location, normalized, task.kind === "link" || task.kind === "robots"); if (!target) throw new Error("Unsafe redirect target");
          if (redirects.includes(target) || target === task.url) throw new Error("Redirect loop detected");
          redirects.push(normalized); current = target; continue;
        }
        const body = task.kind === "link" ? (await response.body?.cancel(), { text: "", bytes: 0 }) : await abortable(boundedBody(response, task.kind === "robots" ? 512_000 : MAX_BODY, controller.signal), controller.signal);
        return { response, finalUrl: normalized, redirects, responseMs: Math.max(0, now() - started - throttledMs), ...body };
      } finally { clearTimeout(timeout); }
    }
    throw new Error("Redirect chain exceeds five hops");
  }
  while (state.queue.length && now() < Math.min(chunkEnd, auditEnd)) {
    if (state.requests >= MAX_REQUESTS) break;
    const index = state.queue.findIndex(task => (state.hostNextAt[new URL(task.url).host] || 0) < chunkEnd - 100);
    if (index < 0) break;
    const [task] = state.queue.splice(index, 1), key = keyFor(task), origin = new URL(task.url).origin;
    if (state.visited.includes(key)) continue;
    if (task.kind !== "robots" && !state.robots[origin]) {
      state.queue.unshift(task); state.queue.unshift({ kind: "robots", url: origin + "/robots.txt", depth: 0 }); continue;
    }
    if (task.kind === "page") {
      const uniqueUrls = new Set(state.pages.map(page => page.url));
      if (uniqueUrls.size >= state.config.maxUrls && !uniqueUrls.has(task.url)) { skip(state, task.url, "Maximum URL limit reached"); state.visited.push(key); continue; }
      if (state.canonicalUrls.includes(`${task.language}:${task.url}`)) { skip(state, task.url, "Canonical URL already inspected for this language"); state.visited.push(key); continue; }
    }
    if (task.kind !== "robots" && !robotsAllows(state.robots[origin], task.url)) {
      const record = state.robots[origin], reason = record?.error || "Blocked by robots.txt";
      skip(state, task.url, reason); state.visited.push(key);
      if (task.kind === "page") {
        const unavailable = !record?.fetched || /unavailable|HTTP (?:5\d\d|429)/i.test(reason);
        const finding = unavailable
          ? reportFinding("robots-unverified", "Page was not fetched because robots.txt was unavailable", reason, "Restore robots.txt availability, then rescan. Indexability and page metadata remain unverified.")
          : reportFinding("robots-blocked", "Public page is blocked by robots.txt", "The applicable robots.txt rules prevent this audit crawler from fetching the published URL. Page metadata and actual search indexability were not inspected.", "Review whether this public URL should be crawlable. Adjust robots.txt only if the restriction is unintended, then rescan.", "critical");
        state.pages.push({ url: task.url, finalUrl: task.url, status: 0, language: task.language || "und", indexable: false, content: { score: null, findings: [] }, technical: { score: 0, findings: [finding] }, responseMs: 0, bytes: 0 });
      }
      continue;
    }
    try {
      const result = await request(task);
      state.visited.push(key);
      if (task.kind === "robots") {
        if (result.response.status >= 200 && result.response.status < 300) {
          const parsed = parseRobots(result.text); state.robots[origin] = parsed.record;
          if (allowed(task.url) && state.config.scope === "site") for (const url of parsed.sitemaps) push(state, { kind: "sitemap", url, depth: 0 });
        } else state.robots[origin] = { fetched: true, allowed: result.response.status >= 400 && result.response.status < 500 && ![401,403,429].includes(result.response.status), rules: [], delayMs: 0, ...(result.response.status === 404 ? {} : { error: `robots.txt returned HTTP ${result.response.status}` }) };
      } else if (task.kind === "sitemap") {
        if (!result.response.ok) { skip(state, task.url, `Sitemap returned HTTP ${result.response.status}`); continue; }
        const index = /<sitemapindex\b/i.test(result.text);
        if (!index && !/<urlset\b/i.test(result.text)) { skip(state, task.url, "Sitemap is not a valid XML sitemap or index"); continue; }
        for (const value of xmlLocations(result.text)) {
          const url = normalizeCrawlUrl(value, task.url); if (!url) { skip(state, value, "Invalid sitemap URL"); continue; }
          if (index) push(state, { kind: "sitemap", url, depth: task.depth + 1 });
          else { if (!state.sitemapUrls.includes(url)) state.sitemapUrls.push(url); pushPages(state, url, 0, task.url); }
        }
      } else if (task.kind === "link") {
        state.linkChecks[task.url] = { status: result.response.status, finalUrl: result.finalUrl };
      } else {
        const type = result.response.headers.get("content-type") || "";
        const isHtml = !type || /text\/html|application\/xhtml\+xml/i.test(type);
        // Keep the HTTP result even if an error page is plain text; referring pages still need its status.
        state.linkChecks[task.url] = { status: result.response.status, finalUrl: result.finalUrl };
        const document = parseHtml(isHtml ? result.text : "", result.finalUrl), canonical = document.canonical[0] ? normalizeCrawlUrl(document.canonical[0], result.finalUrl) : undefined;
        const technical = analyzeTechnical({ document, status: result.response.status, finalUrl: result.finalUrl, redirects: result.redirects, responseMs: result.responseMs, bytes: result.bytes, xRobotsTag: result.response.headers.get("x-robots-tag") || undefined, robotsAllowed: true });
        const page: AuditPage = { url: task.url, finalUrl: result.finalUrl, status: result.response.status, language: task.language || document.language || document.htmlLanguage || "und", indexable: isHtml && result.response.ok && !hasNoindex(document.robots, result.response.headers.get("x-robots-tag") || undefined), ...(canonical ? { canonical } : {}), title: document.title, description: document.description, hreflang: document.hreflang, content: isHtml ? analyzeContent(document) : { score: null, findings: [] }, technical, responseMs: result.responseMs, bytes: result.bytes };
        if (!isHtml) appendFinding(technical, reportFinding("response-content-type", "Public page did not return HTML", `HTTP ${result.response.status}; Content-Type: ${type}`, "Check the destination and content negotiation for this published page."));
        if (task.language && document.htmlLanguage && document.htmlLanguage.split("-")[0] !== task.language.split("-")[0]) appendFinding(technical, reportFinding("language-response", "Published language differs from the requested variant", `Requested ${task.language}; server-rendered HTML declares ${document.htmlLanguage}.`, "Check the language cookie, localized routing, and server-rendered lang attribute."));
        state.pages.push(page);
        // A canonical declaration is a hint, not proof that its target was fetched.
        // Mark only the actual response URL inspected, preserving queued canonical-target verification.
        if (allowed(result.finalUrl)) state.canonicalUrls.push(`${task.language}:${result.finalUrl}`);
        state.linkChecks[task.url] = { status: result.response.status, finalUrl: result.finalUrl };
        if (state.config.scope === "site") {
          if (canonical && allowed(canonical) && canonical !== task.url) pushPages(state, canonical, task.depth + 1, task.url);
          for (const alternate of document.hreflang) { const url = normalizeCrawlUrl(alternate.href, result.finalUrl); if (url && allowed(url)) pushPages(state, url, task.depth + 1, task.url); }
        }
        for (const link of document.links) {
          const url = normalizeCrawlUrl(link.href, result.finalUrl, true); if (!url || url === result.finalUrl) continue;
          if (allowed(url) && state.config.scope === "site") pushPages(state, url, task.depth + 1, task.url);
          else push(state, { kind: "link", url, depth: 0, source: task.url });
        }
        // Save only relevant link URLs for post-crawl status reconciliation, never full HTML.
        page.links = document.links.map(link => normalizeCrawlUrl(link.href, result.finalUrl, true)).filter((url): url is string => !!url).slice(0, 250);
      }
    } catch (error) {
      if (error instanceof CrawlLimit) { state.queue.unshift(task); break; }
      if (error instanceof NeedsRobots) { state.queue.unshift(task); state.queue.unshift({ kind: "robots", url: error.origin + "/robots.txt", depth: 0 }); continue; }
      if (error instanceof DeferredRequest && (task.attempts || 0) < 2 && error.nextAt < auditEnd) { state.queue.push({ ...task, attempts: (task.attempts || 0) + 1 }); continue; }
      const reason = error instanceof DeferredRequest ? "Server rate limit persists; retry later" : error instanceof Error && error.name === "AbortError" ? "Request timed out" : error instanceof Error ? error.message : "Request failed";
      state.visited.push(key); skip(state, task.url, reason);
      if (task.kind === "robots") state.robots[origin] = { fetched: true, allowed: false, rules: [], delayMs: 0, error: "robots.txt unavailable; crawling paused for this origin" };
      if (task.kind === "page") {
        const empty = parseHtml("", task.url), technical = analyzeTechnical({ document: empty, status: 0, finalUrl: task.url });
        appendFinding(technical, reportFinding("fetch-failed", "Page could not be inspected", reason, "Check availability and crawl permissions, then rescan this page.", "critical"));
        state.pages.push({ url: task.url, finalUrl: task.url, status: 0, language: task.language || "und", indexable: false, content: { score: null, findings: [] }, technical, responseMs: 0, bytes: 0 });
      }
    }
  }
  state.updatedAt = now();
  if (now() >= auditEnd || state.requests >= MAX_REQUESTS) {
    for (const task of state.queue) skip(state, task.url, now() >= auditEnd ? "Maximum audit duration reached" : "Maximum request limit reached");
    state.queue = []; state.status = "incomplete"; state.finishedAt = now();
  } else if (!state.queue.length) {
    const limitation = state.skippedUrls.some(item => /limit|timed out|unavailable|Maximum|Response exceeds|Request failed|DNS|private or reserved|Redirect|Sitemap (?:is not|returned)|robots\.txt returned HTTP (?:5\d\d|429)|rate limit/i.test(item.reason));
    state.status = limitation ? "incomplete" : "completed"; state.finishedAt = now();
  }
  // Reconcile after each chunk so partial reports improve as link targets are fetched.
  for (const page of state.pages) {
    const links = page.links || [];
    const broken = links.filter(url => (state.linkChecks[url]?.status || 0) >= 400);
    if (broken.length) appendFinding(page.technical, reportFinding("broken-links", "Broken links found", broken.slice(0, 10).map(url => `${url} (HTTP ${state.linkChecks[url].status})`).join("; "), "Update or remove these destinations and rescan the referring page."));
    if (["completed", "incomplete"].includes(state.status) && page.indexable && state.config.scope === "site") {
      const preferredUrl = page.canonical || page.finalUrl, included = state.sitemapUrls.includes(preferredUrl);
      appendFinding(page.technical, reportFinding("sitemap-discovery", included ? "Page appears in a sitemap" : "Page is missing from discovered sitemaps", included ? preferredUrl : `No successfully fetched sitemap listed the preferred indexable URL: ${preferredUrl}`, "Keep canonical, indexable public URLs in the Metadata API sitemap.", included ? "passed" : "warning"));
    }
    if (["completed", "incomplete"].includes(state.status)) {
      const unchecked = links.filter(url => !state.linkChecks[url]);
      if (unchecked.length) appendFinding(page.technical, reportFinding("link-coverage", "Some link destinations were not verified", `${links.length - unchecked.length} of ${links.length} extracted links have an HTTP result. Remaining links may be excluded, blocked, external, or outside crawl limits.`, "Review skipped URLs and rescan relevant destinations. This audit does not certify unchecked links.", "recommendation"));
      if (page.canonical && page.canonical !== page.finalUrl) {
        const target = state.pages.find(item => item.language === page.language && (item.url === page.canonical || item.finalUrl === page.canonical));
        if (!target) appendFinding(page.technical, reportFinding("canonical-target-unverified", "Canonical destination was not verified", page.canonical, "Verify this URL returns indexable HTML and has a consistent canonical. Add its origin to the trusted configuration if appropriate.", "recommendation"));
        else if (!target.indexable) appendFinding(page.technical, reportFinding("canonical-target-indexing", "Canonical points to a non-indexable destination", `${page.canonical} returned ${target.status} and was not indexable in this scan.`, "Choose an indexable canonical destination or fix its status and indexing restrictions.", "critical"));
      }
      for (const alternate of page.hreflang || []) {
        const url = normalizeCrawlUrl(alternate.href, page.finalUrl); if (!url) continue;
        const target = state.pages.find(item => (item.url === url || item.finalUrl === url) && (alternate.language === "x-default" || item.language.split("-")[0] === alternate.language.split("-")[0]));
        if (!target) appendFinding(page.technical, reportFinding(`hreflang-unverified-${alternate.language}`, "Language alternate targets were not fully verified", url, "Verify the target is indexable and links back to this page using hreflang.", "recommendation"));
        else if (!target.indexable || !(target.hreflang || []).some(item => normalizeCrawlUrl(item.href, target.finalUrl) === page.finalUrl)) appendFinding(page.technical, reportFinding(`hreflang-reciprocal-${alternate.language}`, "Language alternate needs review", `${url} is non-indexable or has no return hreflang reference to ${page.finalUrl}.`, "Use reciprocal hreflang links between indexable localized pages."));
      }
    }
  }
  return state;
}
