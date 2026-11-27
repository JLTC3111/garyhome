import type { Property } from "./types";

export type ListingGallery = Pick<Property, "images" | "image_filenames" | "image_metadata">;
export type PlannedListingPhoto = { path: string; url: string; filename: string; bytes: number; mime: string };
export type GalleryCheckpoint = {
  key: string;
  listingId: string;
  baseVersion: string | null;
  baseGallery: ListingGallery;
  gallery: ListingGallery;
  pending: PlannedListingPhoto[];
  title: string;
  savedAt: number;
};

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const prefix = (actor: string) => `gary-home:gallery:${actor}:`;

export function listingGallery(property: ListingGallery): ListingGallery {
  return { images: property.images, image_filenames: property.image_filenames ?? {}, image_metadata: property.image_metadata ?? {} };
}

export function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameJson(value, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key =>
    Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

// Keep PostgreSQL's sub-millisecond precision when timestamp formats differ.
const listingVersionMicros = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(0, 6);

export function normalizeListingVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().replace(/\.\d{3}Z$/, `.${listingVersionMicros(value)}Z`);
}

export function sameListingVersion(a: string, b: string): boolean {
  if (a === b) return true;
  return Date.parse(a) === Date.parse(b) && listingVersionMicros(a) === listingVersionMicros(b);
}

export function confirmedListingWrite(submitted: Property, saved: Property | null, baseVersion: string | null): boolean {
  if (!saved || saved.id !== submitted.id || (baseVersion && sameListingVersion(saved.updated_at, baseVersion))) return false;
  // PostgreSQL stamps updated_at and can assign the listing code on insert.
  return Object.entries(submitted).every(([key, value]) => {
    if (key === "updated_at" || value === undefined) return true;
    const actual = saved[key as keyof Property];
    return key === "created_at" && typeof value === "string" && typeof actual === "string"
      ? sameListingVersion(value, actual) : sameJson(value, actual);
  });
}

export function matchesPlannedPhoto(file: PlannedListingPhoto, object: { size?: number; contentType?: string; name: string; bucketId: string }): boolean {
  return object.bucketId === "property-media" && object.name === file.path && object.size === file.bytes && object.contentType === file.mime;
}

export function pendingListingPhotos(checkpoint: GalleryCheckpoint, gallery: ListingGallery) {
  return checkpoint.pending.filter(file => !gallery.images.includes(file.url));
}

export function canResumeGallery(checkpoint: GalleryCheckpoint, saved: Property | null): boolean {
  if (!saved) return checkpoint.baseVersion === null;
  return (checkpoint.baseVersion !== null && sameListingVersion(checkpoint.baseVersion, saved.updated_at)) ||
    sameJson(checkpoint.baseGallery, listingGallery(saved)) ||
    sameJson(checkpoint.gallery, listingGallery(saved));
}

export function getGalleryCheckpoints(storage: Storage, actor: string): GalleryCheckpoint[] {
  const start = prefix(actor);
  const entries: GalleryCheckpoint[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(start)) continue;
    try {
      const value = JSON.parse(storage.getItem(key) ?? "null") as GalleryCheckpoint | null;
      if (!value || key !== start + value.key || !uuid.test(value.key) || !uuid.test(value.listingId) ||
          (value.baseVersion !== null && typeof value.baseVersion !== "string") || typeof value.title !== "string" ||
          !Number.isFinite(value.savedAt) || !Array.isArray(value.baseGallery?.images) || !Array.isArray(value.gallery?.images) || value.gallery.images.length > 40 ||
          !value.gallery.images.every(image => typeof image === "string") || !Array.isArray(value.pending) ||
          !value.pending.every(photo => typeof photo?.path === "string" &&
            photo.path.startsWith(`properties/listings/${value.listingId}/`) && typeof photo.url === "string" &&
            typeof photo.filename === "string" && Number.isSafeInteger(photo.bytes) && typeof photo.mime === "string")) continue;
      entries.push(value);
    } catch { /* A damaged checkpoint is preserved for manual recovery. */ }
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

export function storeGalleryCheckpoint(storage: Storage, actor: string, value: GalleryCheckpoint) {
  storage.setItem(prefix(actor) + value.key, JSON.stringify(value));
}

export function removeGalleryCheckpoint(storage: Storage, actor: string, key: string) {
  storage.removeItem(prefix(actor) + key);
}
