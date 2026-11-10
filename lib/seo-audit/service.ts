import { loadContent, staffAdminClient } from "../server";
import { requireAvailableContent } from "../content-unavailable";
import { auditEnvironment, auditSeeds } from "./config";
import { advanceCrawl, createCrawl, isExcludedUrl, normalizeCrawlUrl } from "./crawler";
import { compareAuditMetadata } from "./compare";
import { claimAudit, createAudit, getAuditSettings, saveAudit } from "./store";

export function auditDatabase() {
  const db = staffAdminClient();
  if (!db) throw new Error("SEO audits require the server-only Supabase secret key.");
  return db;
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
  const state = createCrawl({ ...settings.limits, allowedOrigins, scope, languages: ["en", "vi"] }, seeds);
  return createAudit(db, state, { trigger, scope, targetUrl, actorId });
}

export async function advanceAudit(runId?: string) {
  const db = auditDatabase(), lease = await claimAudit(db, runId);
  if (!lease) return;
  const state = lease.run.state;
  try {
    // Re-check configuration after resuming a persisted job. A removed domain
    // must not remain authorized by an older crawl state.
    const { allowedOrigins } = auditEnvironment();
    if (state.config.allowedOrigins.some(origin => !allowedOrigins.includes(origin))) throw new Error("Audit domains changed; start a new scan.");
    const next = compareAuditMetadata(await advanceCrawl(state, { budgetMs: 12000 }));
    if (!await saveAudit(db, lease.run.id, lease.leaseToken, next)) throw new Error("Audit progress changed elsewhere. Refresh to load the latest result.");
  } catch (error) {
    // Persist interruption, including the remaining queue, rather than silently
    // presenting a partial report as a successful scan.
    state.status = "failed";
    state.finishedAt = Date.now();
    state.updatedAt = Date.now();
    state.skippedUrls.push({ url: lease.run.target_url || state.config.allowedOrigins[0], reason: "Audit interrupted. Start a new scan after checking configuration and connectivity." });
    await saveAudit(db, lease.run.id, lease.leaseToken, state);
    throw error;
  }
}
