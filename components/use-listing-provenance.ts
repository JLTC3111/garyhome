"use client";
import { useEffect, useState } from "react";
import { useSite } from "./site-context";
import type { ListingCreationRecord } from "@/lib/listing-provenance";

export function useListingProvenance(ids: string[], enabled: boolean) {
  const { user, demo, editorTask, t } = useSite();
  const key = enabled ? [...ids].sort().join(",") : "";
  const account = user?.id;
  const [saved, setSaved] = useState<{ account?: string; key: string; records: Record<string, ListingCreationRecord>; error: string }>({ key: "", records: {}, error: "" });
  useEffect(() => {
    if (!key || !account || demo) return;
    let cancelled = false;
    void editorTask((db, signal) => db.from("property_creation_records").select("property_id,created_at,actor_name").in("property_id", key.split(",")).abortSignal(signal))
      .then(({ data, error }) => {
        if (cancelled) return;
        setSaved({ account, key, records: error ? {} : Object.fromEntries(((data || []) as ListingCreationRecord[]).map(record => [record.property_id, record])), error: error ? "Posting history unavailable. Apply the listing provenance migration and refresh." : "" });
      }).catch(() => { if (!cancelled) setSaved({ account, key, records: {}, error: "Posting history unavailable. Reconnect and refresh." }); });
    return () => { cancelled = true; };
  }, [key, account, demo, editorTask]);
  const current = saved.account === account && saved.key === key;
  return { records: current ? saved.records : {}, error: current && saved.error ? t(saved.error, saved.error === "Posting history unavailable. Apply the listing provenance migration and refresh." ? "Chưa có lịch sử người đăng. Áp dụng migration nguồn gốc tin đăng rồi tải lại." : "Chưa thể tải lịch sử người đăng. Kết nối lại rồi tải lại.") : "" };
}
