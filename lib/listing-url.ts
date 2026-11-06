import type { Property } from "./types";

const MAX_SLUG_LENGTH = 180;
type ListingTitle = Pick<Property, "id" | "title_en" | "title_vi">;
type ExistingListing = Pick<Property, "id" | "slug">;

export function isListingUrlAutomatic(isNew: boolean, original?: Pick<Property, "status" | "published_at">): boolean {
  return isNew || !!original && original.status === "draft" && !original.published_at;
}

function addressWords(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/đ/g, "d")
    .replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function shorten(value: string, length: number): string {
  return value.slice(0, length).replace(/-+$/g, "");
}

function fallbackAddress(id: string): string {
  const safeId = shorten(addressWords(id), 48);
  if (safeId) return `listing-${safeId}`;
  // Stable address for a title and record ID that contain no Latin letters.
  // This is an identifier fallback, not an authentication or security hash.
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193);
  return `listing-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// One canonical address is shared by both display languages. Call this with the
// latest submitted titles so a new listing never needs a manually entered URL.
export function generateListingSlug(
  property: ListingTitle,
  properties: readonly ExistingListing[] = [],
  reservedSlugs: readonly string[] = [],
): string {
  const title = property.title_en.trim() || property.title_vi.trim();
  if (!title) return "";
  const base = shorten(addressWords(title) || fallbackAddress(property.id), MAX_SLUG_LENGTH);
  const occupied = new Set([...properties.filter(row => row.id !== property.id).map(row => row.slug), ...reservedSlugs]);
  if (!occupied.has(base)) return base;
  for (let number = 2; ; number++) {
    const suffix = `-${number}`, candidate = shorten(base, MAX_SLUG_LENGTH - suffix.length) + suffix;
    if (!occupied.has(candidate)) return candidate;
  }
}
