import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrawlState } from "./crawler";
import { normalizeAuditState } from "./normalize.ts";
import { evaluatedScore, evaluatedFindings, evaluatedPages, reportCoverage } from "./presentation.ts";

export type CrawlLimits = {
  maxUrls: number; maxDepth: number; concurrency: number; requestIntervalMs: number; timeoutMs: number; maxDurationMs: number;
};
export const defaultAuditLimits: CrawlLimits = { maxUrls: 500, maxDepth: 4, concurrency: 2, requestIntervalMs: 1000, timeoutMs: 10000, maxDurationMs: 900000 };
export type AuditSettings = { weeklyEnabled: boolean; nextRunAt: string; limits: CrawlLimits };
export type AuditRunSummary = {
  id: string; created_at: string; finished_at: string | null; status: CrawlState["status"];
  scope: "site" | "page"; trigger: "manual" | "weekly" | "page"; target_url: string | null;
  content_score: number | null; technical_score: number | null; page_count: number; critical_count: number;
  score_basis?: string | null; coverage?: ReturnType<typeof reportCoverage>;
};
export type AuditRun = AuditRunSummary & { state: CrawlState };
export type AuditSnapshot = { runs: AuditRunSummary[]; settings: AuditSettings; activeRun: AuditRun | null; selectedRun: AuditRun | null };
const summaryFields = "id,created_at,finished_at,status,scope,trigger,target_url,content_score,technical_score,page_count,critical_count,score_basis,coverage";
function databaseError(error: {code?:string} | null) {
  if (!error) return;
  throw new Error(["42P01", "PGRST202", "PGRST205", "42883"].includes(error.code || "")
    ? "Apply the SEO audit database migration before running audits."
    : "SEO audit storage is unavailable. Refresh before trying again.");
}
function publicRun(row: AuditRun): AuditRun {
  const state = normalizeAuditState(row.state);
  return { id:row.id,created_at:row.created_at,finished_at:row.finished_at,status:row.status,scope:row.scope,trigger:row.trigger,target_url:row.target_url,
    ...auditSummary(state),score_basis:state.analysisVersion===3?"evaluated-checks-v3":"legacy-recomputed-v3",state };
}
export async function getAuditSettings(db: SupabaseClient): Promise<AuditSettings> {
  const {data,error}=await db.from("seo_audit_settings").select("weekly_enabled,next_run_at,limits").eq("id",true).single();
  databaseError(error); if(!data)throw new Error("SEO audit settings are unavailable.");
  return {weeklyEnabled:data.weekly_enabled,nextRunAt:data.next_run_at,limits:{...defaultAuditLimits,...data.limits}};
}
export async function auditSnapshot(db: SupabaseClient, runId?: string): Promise<AuditSnapshot> {
  const [settings,runsResult,activeResult]=await Promise.all([
    getAuditSettings(db),
    db.from("seo_audit_runs").select(summaryFields).order("created_at",{ascending:false}).limit(20),
    db.from("seo_audit_runs").select(summaryFields+",state").in("status",["queued","running"]).maybeSingle(),
  ]);
  databaseError(runsResult.error); databaseError(activeResult.error);
  const runs=((runsResult.data||[]) as unknown as AuditRunSummary[]).map(row=>row.score_basis==="evaluated-checks-v3"?row:{...row,content_score:null,technical_score:null,critical_count:0,score_basis:null});
  const activeRun=activeResult.data?publicRun(activeResult.data as unknown as AuditRun):null;
  const selectedId=runId||activeRun?.id||runs[0]?.id;
  let selectedRun=selectedId===activeRun?.id?activeRun:null;
  if(selectedId&&!selectedRun){
    const result=await db.from("seo_audit_runs").select(summaryFields+",state").eq("id",selectedId).maybeSingle();
    databaseError(result.error); selectedRun=result.data?publicRun(result.data as unknown as AuditRun):null;
  }
  return {runs,settings,activeRun,selectedRun};
}
export async function createAudit(db: SupabaseClient,state:CrawlState,options:{trigger:AuditRunSummary["trigger"];scope:AuditRunSummary["scope"];targetUrl?:string;actorId?:string}):Promise<AuditRun|null>{
  const {data,error}=await db.rpc("seo_create_audit",{p_state:state,p_trigger:options.trigger,p_scope:options.scope,p_target_url:options.targetUrl||null,p_actor_id:options.actorId||null});
  databaseError(error);return data?publicRun(data as AuditRun):null;
}
export async function claimAudit(db:SupabaseClient,runId?:string):Promise<{run:AuditRun;leaseToken:string}|null>{
  const {data,error}=await db.rpc("seo_claim_audit",{p_run_id:runId||null});databaseError(error);
  return data?{run:publicRun(data as AuditRun),leaseToken:data.lease_token}:null;
}
export function auditSummary(state:CrawlState){
  return {content_score:evaluatedScore(state.pages,"content"),technical_score:evaluatedScore(state.pages,"technical"),page_count:state.pages.length,
    critical_count:evaluatedPages(state.pages).reduce((count,page)=>count+[...evaluatedFindings(page,"technical"),...evaluatedFindings(page,"content")].filter(f=>f.severity==="critical").length,0),
    score_basis:state.analysisVersion===3?"evaluated-checks-v3":"legacy-recomputed-v3",coverage:reportCoverage(state)};
}
export async function resumeAuditRecord(db:SupabaseClient,runId:string,state:CrawlState):Promise<AuditRun>{
  const {data,error}=await db.rpc("seo_resume_audit",{p_run_id:runId,p_state:state});databaseError(error);
  if(!data)throw new Error("Another audit is already active. Refresh before resuming.");
  return publicRun(data as AuditRun);
}
export async function saveAudit(db:SupabaseClient,runId:string,leaseToken:string,state:CrawlState):Promise<boolean>{
  const {data,error}=await db.rpc("seo_save_audit",{p_run_id:runId,p_lease_token:leaseToken,p_state:state,p_summary:auditSummary(state)});databaseError(error);return data===true;
}
export async function updateAuditSettings(db:SupabaseClient,input:{weeklyEnabled:boolean;limits:CrawlLimits}):Promise<AuditSettings>{
  const {error}=await db.from("seo_audit_settings").update({weekly_enabled:input.weeklyEnabled,limits:input.limits,updated_at:new Date().toISOString()}).eq("id",true);databaseError(error);return getAuditSettings(db);
}
