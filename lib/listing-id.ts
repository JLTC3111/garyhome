import type { Property } from "./types";

export function normalizeListingId(value: string): string | null {
  const raw = value.trim().toUpperCase().replace(/[\u2010-\u2015\u2212]/g, "-");
  if (!raw) return "";
  const digits = raw.match(/^(?:GH[\s-]*)?(\d{1,12})$/)?.[1];
  return digits ? "GH-" + digits.replace(/^0+(?=\d)/, "").padStart(6, "0") : null;
}

export function listingIdError(value: string | undefined, isNew: boolean): string | null {
  const normalized = normalizeListingId(value ?? "");
  if (normalized === null) return "Use a listing ID such as GH-000123, with up to 12 digits.";
  if (!normalized && !isNew) return "Enter a listing ID for this property.";
  return null;
}

// Browser preview only. Live IDs are allocated atomically by the database.
export function previewListingId(properties: Pick<Property, "listing_code">[]): string {
  const used = new Set(properties.map(property => property.listing_code));
  let number = 1;
  while (used.has("GH-" + String(number).padStart(6, "0"))) number++;
  return "GH-" + String(number).padStart(6, "0");
}
