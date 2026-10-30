"use client";

import { useEffect, useId, useState } from "react";
import type { Property } from "@/lib/types";
import { listingIdError, normalizeListingId } from "@/lib/listing-id";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

export function PropertyListingIdField({ property, patch, isNew }: {
  property: Property; isNew: boolean; patch: (key: keyof Property, value: unknown) => void;
}) {
  const { content, editorTask, demo, editor } = useSite(), text = useStudioText(), hintId = useId();
  const code = normalizeListingId(property.listing_code ?? "");
  const invalid = listingIdError(property.listing_code, isNew);
  const conflict = !!code && content.properties.some(row => row.id !== property.id && row.listing_code === code);
  const assigned = !!code && content.properties.some(row => row.id === property.id && row.listing_code === code);
  const [check, setCheck] = useState<{ code: string; state: "checking" | "available" | "taken" | "unknown" }>({ code: "", state: "unknown" });
  useEffect(() => {
    if (!code || invalid || conflict || assigned || demo || !editor) return;
    let active = true;
    const timer = setTimeout(() => {
      setCheck({ code, state: "checking" });
      void editorTask((db, signal) => db.from("properties").select("id").eq("listing_code", code).limit(1).abortSignal(signal).maybeSingle())
        .then(({ data, error }) => { if (active) setCheck({ code, state: error ? "unknown" : data && data.id !== property.id ? "taken" : "available" }); })
        .catch(() => { if (active) setCheck({ code, state: "unknown" }); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [code, invalid, conflict, assigned, demo, editor, editorTask, property.id]);
  const taken = conflict || check.code === code && check.state === "taken";
  const message = invalid || (taken ? "That listing ID is already in use. Choose another ID." : !code ? "Leave blank to assign an available listing ID automatically." : assigned ? "Assigned to this listing." : demo || check.code === code && check.state === "available" ? "Available now. Checked again when you save." : check.code === code && check.state === "unknown" ? "Availability will be checked when you save." : "Checking listing ID…");
  return <label className="property-listing-id-field">{text("Listing ID")}
    <input name="listing_code" value={property.listing_code ?? ""} onChange={event => patch("listing_code", event.target.value)} onBlur={() => { if (code !== null && code !== property.listing_code) patch("listing_code", code); }} required={!isNew} maxLength={24} autoComplete="off" spellCheck={false} placeholder={isNew ? text("Automatic if blank · e.g. GH-000123") : "GH-000123"} aria-describedby={hintId} aria-invalid={!!invalid || taken}/>
    <small id={hintId} aria-live="polite" className={invalid || taken ? "listing-id-conflict" : undefined}>{text(message)}</small>
  </label>;
}
