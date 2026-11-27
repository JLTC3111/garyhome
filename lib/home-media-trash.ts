export const maxTrashSelection = 8;

type TrashTarget = { id: string; expires_at: string | null };
export type CleanupResult = { status: string; removed?: number; attempted?: number; overdue?: number };

export async function removeSelectedTrash(
  items: TrashTarget[],
  request: (payload: { action: "purge"; id: string; expiresAt: string; confirm: true }) => Promise<CleanupResult>,
) {
  if (!items.length || items.length > maxTrashSelection || new Set(items.map(item => item.id)).size !== items.length ||
      items.some(item => !item.expires_at || !Number.isFinite(Date.parse(item.expires_at)))) throw new Error("invalid_request");
  const failures: { id: string; error: unknown }[] = [];
  let removed = 0;
  for (const item of items) {
    try {
      const result = await request({ action: "purge", id: item.id, expiresAt: item.expires_at!, confirm: true });
      if (result.status === "disabled") throw new Error("cleanup_disabled");
      if (result.status === "busy") throw new Error("media_busy");
      if (result.status !== "ok" || result.removed !== 1) throw new Error("purge_unconfirmed");
      removed++;
    } catch (error) {
      failures.push({ id: item.id, error });
    }
  }
  return { removed, failures };
}
