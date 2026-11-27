import type { SupabaseClient } from "@supabase/supabase-js";

const panelActions = new Set(["overview", "inventory_scan", "inventory_page", "trash_page", "removed_page", "run_page"]);
const inventoryActions = new Set(["status", "scan", "trash", "restore", ...panelActions]);
const reviewActions = new Map<string, string>(["page", "verify", "hold", "release", "enroll"].map(action => [`orphan_${action}`, action]));
export const storageMediaActions = new Set([...inventoryActions, ...reviewActions.keys(), "worker_status", "run", "purge", "purge_unused",
  "trash_manifest", "trash_receipt", "retention_page", "retention_manifest", "retention_receipt", "observation_status", "verify_unused"]);
const rpcMissing = (code?: string) => code === "PGRST202" || code === "42883";

export async function executeStorageMedia(
  db: SupabaseClient,
  input: Record<string, unknown> & { action: string },
  signal: AbortSignal,
  worker: () => Promise<Response>,
) {
  const review = reviewActions.get(input.action);
  const offset = Number.isInteger(input.offset) ? input.offset : 0;
  if (input.action === "observation_status" || input.action === "verify_unused") {
    const {data,error}=await db.rpc("home_media_observation",{p_verify:input.action==="verify_unused"}).abortSignal(signal);
    if (!error && data) return {status:200,data};
    if (error?.code==="42501") return {status:403,data:{error:"forbidden"}};
    if (rpcMissing(error?.code)) return {status:503,data:{error:"observation_setup"}};
    if (error?.code==="57014") return {status:504,data:{error:"observation_timeout"}};
    return {status:503,data:{error:"observation_unavailable"}};
  }
  if (input.action === "inventory_page" || input.action === "retention_page" || input.action === "retention_manifest" || input.action === "retention_receipt") {
    const p_query=typeof input.query==="string"?input.query.slice(0,120):"";
    const call=input.action==="inventory_page"?db.rpc("home_media_inventory_files",{p_offset:offset,p_query}):
      input.action==="retention_page"?db.rpc("home_media_retention_preview",{p_offset:offset,p_query}):
      input.action==="retention_manifest"?db.rpc("home_media_retention_manifest",{p_query}):
        db.rpc("home_media_unused_receipt",{p_id:input.id,p_expiry:input.expiresAt});
    const {data,error}=await call.abortSignal(signal);
    if (!error && data) return {status:200,data};
    if (input.action!=="inventory_page" || !rpcMissing(error?.code)) {
      if (error?.code==="42501") return {status:403,data:{error:"forbidden"}};
      if (rpcMissing(error?.code)) return {status:503,data:{error:input.action==="retention_page"?"retention_setup":"retention_cleanup_setup"}};
      if (error?.code==="57014") return {status:504,data:{error:"inventory_timeout"}};
      if (error?.code==="22P02" || error?.code==="22007") return {status:400,data:{error:"invalid_request"}};
      return {status:503,data:{error:"inventory_unavailable"}};
    }
  }
  if (input.action === "trash_manifest" || input.action === "trash_receipt") {
    const {data,error}=input.action==="trash_manifest"
      ? await db.rpc("home_media_dashboard",{p_action:"trash_manifest",p_offset:0}).abortSignal(signal)
      : await db.rpc("home_media_trash_receipt",{p_id:input.id,p_expiry:input.expiresAt}).abortSignal(signal);
    if (!error && data) return {status:200,data};
    if (error?.code==="42501") return {status:403,data:{error:"forbidden"}};
    if (rpcMissing(error?.code) || (input.action==="trash_manifest" && error?.code==="22023")) return {status:503,data:{error:"trash_bulk_setup"}};
    if (error?.code==="57014") return {status:504,data:{error:"inventory_timeout"}};
    if (error?.code==="22P02" || error?.code==="22007") return {status:400,data:{error:"invalid_request"}};
    return {status:503,data:{error:"inventory_unavailable"}};
  }
  if (review || inventoryActions.has(input.action)) {
    const args = review ? { p_action: review, p_payload: input } : {
      p_action: input.action,
      p_id: input.action === "restore" ? input.id : null,
      p_offset: offset,
    };
    const dashboard = input.action === "overview" || input.action === "trash_page"
      ? await db.rpc("home_media_dashboard", { p_action: input.action, p_offset: offset }).abortSignal(signal) : null;
    const { data, error } = dashboard && !rpcMissing(dashboard.error?.code) ? dashboard :
      await db.rpc(review ? "home_media_review" : "home_media_management", args).abortSignal(signal);
    if (!error && data) return { status: 200, data };
    const code = error?.code;
    if (code === "42501") return { status: 403, data: { error: "forbidden" } };
    if (rpcMissing(code)) return { status: 503, data: { error: review ? "orphan_review_setup" : "inventory_rpc_missing" } };
    if (code === "57014") return { status: 504, data: { error: "inventory_timeout" } };
    if (code === "22023" && panelActions.has(input.action) && error?.message === "listing_cleanup.invalid_manifest") {
      return { status: 503, data: { error: "inventory_panel_upgrade" } };
    }
    if (code === "55P03") return { status: 409, data: { error: error?.message === "listing_cleanup.scan_busy" ? "scan_busy" : "media_busy" } };
    if (code === "22023" && review) return { status: 400, data: { error: "invalid_manifest" } };
    if (code === "PT409") {
      const issue = error?.message.match(/^listing_cleanup\.(restore_unavailable|restore_conflict|restore_snapshot_missing|manifest_changed|scan_required|video_review)$/)?.[1];
      return { status: 409, data: { error: issue || "conflict" } };
    }
    return { status: 503, data: { error: "inventory_unavailable" } };
  }

  if (input.action === "run" || input.action === "purge" || input.action === "purge_unused") {
    const guard = await db.rpc("home_media_dashboard", { p_action: "readiness", p_offset: 0 }).abortSignal(signal);
    if (guard.error?.code === "42501") return { status: 403, data: { error: "forbidden" } };
    if (rpcMissing(guard.error?.code)) return { status: 503, data: { error: "cross_app_protection_required" } };
    if (guard.error || guard.data?.crossAppProtection !== true) return { status: 503, data: { error: "cross_app_protection_unconfirmed" } };
  }

  try {
    const result = await worker();
    if (result.status === 404) {
      await result.body?.cancel();
      return { status: 503, data: { error: "cleanup_worker_missing" } };
    }
    const data = await result.json();
    const workerError = input.action === "worker_status" ? "cleanup_worker_unavailable" : "cleanup_unconfirmed";
    const allowedErrors = ["forbidden", "session_expired", "invalid_request", "media_busy", "purge_unavailable", "purge_unconfirmed", "retention_cleanup_setup"];
    if (!result.ok) return {
      status: result.status,
      data: { error: typeof data === "object" && data && "error" in data && typeof data.error === "string" &&
        allowedErrors.includes(data.error) ? data.error : workerError },
    };
    return { status: result.status, data };
  } catch {
    return { status: 503, data: { error: input.action === "worker_status" ? "cleanup_worker_unavailable" : "cleanup_unconfirmed" } };
  }
}
