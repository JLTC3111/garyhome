import type { SupabaseClient } from "@supabase/supabase-js";

const panelActions = new Set(["overview", "inventory_scan", "inventory_page", "trash_page", "removed_page", "run_page"]);
const inventoryActions = new Set(["status", "scan", "trash", "restore", ...panelActions]);
export const storageMediaActions = new Set([...inventoryActions, "worker_status", "run", "purge"]);

export async function executeStorageMedia(
  db: SupabaseClient,
  input: Record<string, unknown> & { action: string },
  signal: AbortSignal,
  worker: () => Promise<Response>,
) {
  if (inventoryActions.has(input.action)) {
    const { data, error } = await db.rpc("home_media_management", {
      p_action: input.action,
      p_id: input.action === "restore" ? input.id : null,
      p_offset: Number.isInteger(input.offset) ? input.offset : 0,
    }).abortSignal(signal);
    if (!error && data) return { status: 200, data };
    const code = error?.code;
    if (code === "42501") return { status: 403, data: { error: "forbidden" } };
    if (code === "PGRST202" || code === "42883") return { status: 503, data: { error: "inventory_rpc_missing" } };
    if (code === "57014") return { status: 504, data: { error: "inventory_timeout" } };
    if (code === "22023" && panelActions.has(input.action) && error?.message === "listing_cleanup.invalid_manifest") {
      return { status: 503, data: { error: "inventory_panel_upgrade" } };
    }
    if (code === "55P03") return { status: 409, data: { error: error?.message === "listing_cleanup.scan_busy" ? "scan_busy" : "media_busy" } };
    if (code === "PT409") {
      const issue = error?.message.match(/^listing_cleanup\.(restore_unavailable|restore_conflict|restore_snapshot_missing|manifest_changed|scan_required)$/)?.[1];
      return { status: 409, data: { error: issue || "conflict" } };
    }
    return { status: 503, data: { error: "inventory_unavailable" } };
  }

  try {
    const result = await worker();
    if (result.status === 404) {
      await result.body?.cancel();
      return { status: 503, data: { error: "cleanup_worker_missing" } };
    }
    const data = await result.json();
    const workerError = input.action === "worker_status" ? "cleanup_worker_unavailable" : "cleanup_unconfirmed";
    const allowedErrors = ["forbidden", "session_expired", "invalid_request", "media_busy", "purge_unavailable", "purge_unconfirmed"];
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
