import { loadContent, staffAdminClient } from "../server";
import { requireAvailableContent } from "../content-unavailable";
import { auditEnvironment, auditSeeds } from "./config";
import { advanceCrawl, createCrawl, isExcludedUrl, normalizeCrawlUrl, type CrawlState } from "./crawler";
import { report, type Finding } from "../seo-analysis/types";
import { auditNetworkOptions } from "../seo-audit-runtime";
import { normalizeAuditState } from "./normalize";
import { compareAuditMetadata } from "./compare";
import { claimAudit, createAudit, getAuditSettings, saveAudit, resumeAuditRecord } from "./store";

export function auditDatabase() {
  const db = staffAdminClient();
  if (!db) throw new Error("SEO audits require the server-only Supabase secret key.");
  return db;
}

type SitemapHistory = {
  replacedAt: number; segmentStartedAt: number; urls: string[];
  inspections: NonNullable<CrawlState["sitemapInspections"]>;
  pageFindings: { url: string; language: string; findings: Finding[] }[];
};
function refreshSiteSitemaps(state: CrawlState, resumedAt: number) {
  if (state.config.scope !== "site") return;
  const sitemapRules = new Set(["sitemap-discovery", "technical-sitemap", "technical-sitemap-noindex"]);
  const pageFindings = state.pages.map(page => ({ url: page.url, language: page.language,
    findings: page.technical.findings.filter(finding => sitemapRules.has(finding.id)).map(finding => ({ ...finding }))
  })).filter(page => page.findings.length);
  // A resumed run may cross a deployment. Keep the old inventory and its
  // findings as historical evidence, but never use them as current coverage.
  if (state.sitemapUrls.length || state.sitemapInspections?.length || pageFindings.length) {
    const history = state as CrawlState & { sitemapHistory?: SitemapHistory[] };
    (history.sitemapHistory ??= []).push({ replacedAt: resumedAt, segmentStartedAt: state.startedAt,
      urls: [...state.sitemapUrls], inspections: (state.sitemapInspections || []).map(item => ({ ...item,
        ...(item.redirects ? { redirects: [...item.redirects] } : {}) })), pageFindings });
  }
  state.sitemapUrls = [];
  state.sitemapInspections = [];
  state.visited = state.visited.filter(key => !key.startsWith("sitemap:"));
  for (const page of state.pages) page.technical = report(page.technical.findings.filter(finding => !sitemapRules.has(finding.id)));
  // Discover nested sitemap inventories again from current roots/robots;
  // reusing old queued indexes could retain destinations removed by a release.
  const roots: CrawlState["queue"] = [...new Set(state.config.allowedOrigins)].map(origin => ({
    kind: "sitemap" as const, url: new URL("/sitemap.xml", origin).href, depth: 0
  }));
  state.queue = [...roots, ...state.queue.filter(task => task.kind !== "sitemap")];
}

export async function startAudit(trigger: "manual" | "weekly" | "page", actorId?: string, targetUrl?: string) {
  const db = auditDatabase(), { base, allowedOrigins } = auditEnvironment();
  const settings = await getAuditSettings(db);
  if (trigger === "weekly" && (!settings.weeklyEnabled || Date.parse(settings.nextRunAt) > Date.now())) return null;
  let seeds: string[];
  if (targetUrl) {
    const url = new URL(targetUrl, base);
    if (!allowedOrigins.includes(url.origin) || !normalizeCrawlUrl(url.href) || isExcludedUrl(url.href)) throw new Error("Choose a public HTML page on a configured domain; private routes and assets cannot be scanned.");
    seeds = [url.href];
  } else {
    const { content } = requireAvailableContent(await loadContent());
    seeds = auditSeeds(base, content);
  }
  const scope = targetUrl ? "page" : "site";
  const state = createCrawl({ ...settings.limits, allowedOrigins, scope, languages: ["en", "vi"], languageMode: "url" }, seeds);
  return createAudit(db, state, { trigger, scope, targetUrl, actorId });
}

export async function resumeAudit(runId:string) {
  const db=auditDatabase();
  const loaded=await db.from("seo_audit_runs").select("state,status").eq("id",runId).single();
  if(loaded.error||!loaded.data)throw new Error("The saved audit could not be loaded.");
  if(!["failed","incomplete"].includes(loaded.data.status))throw new Error("Only interrupted audits can be resumed.");
  const state=normalizeAuditState(loaded.data.state);
  const {allowedOrigins}=auditEnvironment();
  if(state.config.allowedOrigins.some(origin=>!allowedOrigins.includes(origin)))throw new Error("Audit domains changed. Start a fresh scan with the current configuration.");
  const legacy=state.analysisVersion!==3;
  state.originalStartedAt ||= state.startedAt;
  state.resumeHistory ||= [];
  state.resumeHistory.push({startedAt:state.startedAt,finishedAt:state.finishedAt,reason:(legacy?"Legacy parser: re-evaluate recorded pages. ":"")+(state.stopReason||state.error||state.status)});
  refreshSiteSitemaps(state, Date.now());
  // Retry failed public page inspections as part of this explicit execution
  // segment; successful observations are retained and never silently replayed.
  for(const page of state.pages.filter(page=>legacy||page.inspectionStatus!=="inspected")) {
    if(!state.queue.some(task=>task.kind==="page"&&task.url===page.url&&task.language===page.language))state.queue.push({kind:"page",url:page.url,language:page.language,depth:0});
    state.visited=state.visited.filter(key=>key!==`page:${page.language}:${page.url}`);
  }
  state.pages=legacy?[]:state.pages.filter(page=>page.inspectionStatus==="inspected");
  if(legacy){state.canonicalUrls=[];state.linkChecks={};state.visited=state.visited.filter(key=>!key.startsWith("page:"));}
  for(const task of state.queue) task.attempts=0;
  state.robots={};state.visited=state.visited.filter(key=>!key.startsWith("robots:"));
  state.startedAt=Date.now();state.updatedAt=state.startedAt;delete state.finishedAt;delete state.stopReason;delete state.error;
  state.status="queued";state.analysisVersion=3;
  return resumeAuditRecord(db,runId,state);
}

export async function advanceAudit(runId?: string) {
  const db = auditDatabase(), lease = await claimAudit(db, runId);
  if (!lease) return;
  const state = normalizeAuditState(lease.run.state);
  let next=state;
  try {
    const { allowedOrigins } = auditEnvironment();
    if (state.config.allowedOrigins.some(origin => !allowedOrigins.includes(origin))) {
      state.status="incomplete";state.stopReason="Configured domains changed. Start a fresh scan.";state.finishedAt=Date.now();
    } else next=compareAuditMetadata(await advanceCrawl(state,{budgetMs:12000,...auditNetworkOptions()}));
  } catch (error) {
    const type=error instanceof Error?error.name:"UnknownError";
    console.warn("[SEO audit] worker interrupted",{runId:lease.run.id,type});
    state.diagnostics ||= [];
    state.diagnostics.push({url:state.config.allowedOrigins[0],kind:"worker",reason:`Worker ${type}; queue preserved for resume.`,attempts:1,at:Date.now()});
    // Unexpected worker errors are operational interruptions, never SEO defects.
    // Keep the queue and durable observations available for an explicit resume.
    state.status="incomplete";state.finishedAt=Date.now();state.updatedAt=Date.now();
    state.stopReason="Worker interrupted before its configured crawl deadline. Resume the saved queue; inspect server logs if this repeats.";
  }
  // Do not catch a failed checkpoint and overwrite it with a terminal failure.
  // A lost response or expired lease may follow a successful database commit.
  try {
    if(!await saveAudit(db,lease.run.id,lease.leaseToken,next))throw new Error("Audit checkpoint was not confirmed. Refresh to recover the saved run; an active lease expires after 60 seconds.");
  } catch(error) {
    console.warn("[SEO audit] checkpoint unconfirmed",{runId:lease.run.id,type:error instanceof Error?error.name:"UnknownError"});
    throw error;
  }
}
