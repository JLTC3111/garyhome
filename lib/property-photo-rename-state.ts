import type { RenamePhotoResult } from "./property-photo-rename-server";
import type { Property } from "./types";

export function remapListingPhotos(listing: Property, replace: (url: string) => string): Property {
  const remapKeys = <T,>(fields?: Record<string, T>) => fields && Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [replace(key), value]),
  );
  return {
    ...listing,
    images: listing.images.map(replace),
    image_filenames: remapKeys(listing.image_filenames),
    image_metadata: remapKeys(listing.image_metadata),
    source_url: listing.source_url ? replace(listing.source_url) : listing.source_url,
  };
}

export function syncRenamedListingDraft(
  draft: Property, savedBefore: Property | undefined, result: RenamePhotoResult, replace: (url: string) => string,
): Property {
  if (draft === savedBefore) return result.savedListing;
  const remapped = remapListingPhotos(draft, replace);
  if (!savedBefore) return remapped;

  const changed = (Object.keys(draft) as (keyof Property)[]).filter(key => key !== "updated_at"
    && draft[key] !== savedBefore[key] && JSON.stringify(draft[key]) !== JSON.stringify(savedBefore[key]));
  if (!changed.length) return result.savedListing;

  const version = result.properties.find(row => row.id === draft.id);
  // Keep the optimistic save guard when another editor committed changes.
  // The local draft remains open, with the renamed photo paths corrected.
  if (!version || draft.updated_at !== version.previous_updated_at || savedBefore.updated_at !== version.previous_updated_at
    || result.savedListing.updated_at !== version.updated_at) return remapped;

  return { ...result.savedListing, ...Object.fromEntries(changed.map(key => [key, remapped[key]])) };
}
