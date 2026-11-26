import { useLayoutEffect, useRef, useState } from "react";
import { getGalleryCheckpoints, listingGallery, pendingListingPhotos, removeGalleryCheckpoint, sameJson, storeGalleryCheckpoint,
  type GalleryCheckpoint, type ListingGallery, type PlannedListingPhoto } from "@/lib/listing-gallery-checkpoint";
import type { Property } from "@/lib/types";

export function useListingGalleryCheckpoint(actor: string | undefined, property: Property | null) {
  const active = useRef<{ actor: string; initial: ListingGallery; checkpoint: GalleryCheckpoint; stored: boolean } | null>(null);
  const [saved, setSaved] = useState<{ actor?: string; entries: GalleryCheckpoint[] }>({entries: []});
  const [unavailable, setUnavailable] = useState(false);

  function refresh() {
    try { setSaved({actor, entries: actor ? getGalleryCheckpoints(window.localStorage, actor) : []}); }
    catch { setUnavailable(true); }
  }

  useLayoutEffect(() => {
    refresh();
    if (!actor) return;
    const onStorage = (event: StorageEvent) => { if (event.key?.startsWith(`gary-home:gallery:${actor}:`)) refresh(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // Refresh the list only when the actor or this actor's stored drafts change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  function persist(entry: NonNullable<typeof active.current>) {
    try {
      if (entry.checkpoint.pending.length || !sameJson(entry.checkpoint.gallery, entry.initial)) {
        storeGalleryCheckpoint(window.localStorage, entry.actor, entry.checkpoint);
        entry.stored = true;
      } else if (entry.stored) {
        removeGalleryCheckpoint(window.localStorage, entry.actor, entry.checkpoint.key);
        entry.stored = false;
      }
      setUnavailable(false);
      refresh();
    } catch { setUnavailable(true); }
  }

  function begin(current: Property, isNew: boolean, recovered?: GalleryCheckpoint) {
    if (!actor) return;
    const initial = listingGallery(current);
    const checkpoint = {key:crypto.randomUUID(), listingId:current.id, baseVersion:isNew?null:current.updated_at,baseGallery:initial,
      gallery:recovered?.gallery??initial, pending:recovered?.pending??[], title:current.title_en||current.title_vi, savedAt:Date.now()};
    const entry = {actor,initial,checkpoint,stored:false};
    active.current=entry;
    if (recovered) {
      persist(entry);
      // Copy the checkpoint before releasing the old copy. Another tab may have updated it meanwhile.
      try {
        const prior=getGalleryCheckpoints(window.localStorage,actor).find(item=>item.key===recovered.key);
        if ((entry.stored || (!checkpoint.pending.length&&sameJson(checkpoint.gallery,initial))) && prior?.savedAt===recovered.savedAt) {
          removeGalleryCheckpoint(window.localStorage,actor,recovered.key);
          refresh();
        }
      } catch { setUnavailable(true); }
    }
  }

  useLayoutEffect(() => {
    const entry=active.current;
    if (!property || !entry || entry.actor!==actor || entry.checkpoint.listingId!==property.id) return;
    const gallery=listingGallery(property), pending=pendingListingPhotos(entry.checkpoint,gallery);
    if (sameJson(gallery,entry.checkpoint.gallery)&&pending.length===entry.checkpoint.pending.length) return;
    entry.checkpoint={...entry.checkpoint,gallery,pending,title:property.title_en||property.title_vi,savedAt:Date.now()};
    persist(entry);
    // Gallery values are written before the next interaction with the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor,property]);

  return {
    entries:saved.actor===actor?saved.entries:[], unavailable, begin,
    discard(checkpoint: GalleryCheckpoint) {
      if (!actor) return;
      try {
        const current=getGalleryCheckpoints(window.localStorage,actor).find(item=>item.key===checkpoint.key);
        if (current?.savedAt===checkpoint.savedAt) removeGalleryCheckpoint(window.localStorage,actor,checkpoint.key);
        refresh();
      } catch { setUnavailable(true); }
    },
    plan(listingId: string, photo: PlannedListingPhoto) {
      const entry=active.current;
      if (!entry||entry.actor!==actor||entry.checkpoint.listingId!==listingId||entry.checkpoint.pending.some(item=>item.path===photo.path)) return;
      entry.checkpoint={...entry.checkpoint,pending:[...entry.checkpoint.pending,photo],savedAt:Date.now()};
      persist(entry);
    },
    hasPending(current: Property) {
      const entry=active.current;
      return !!entry&&entry.actor===actor&&entry.checkpoint.listingId===current.id&&pendingListingPhotos(entry.checkpoint,listingGallery(current)).length>0;
    },
    hasChanges(current: Property) {
      const entry=active.current;
      return !!entry&&entry.actor===actor&&entry.checkpoint.listingId===current.id&&
        (entry.checkpoint.pending.length>0||!sameJson(listingGallery(current),entry.initial));
    },
    confirm(current: Property, confirmed: Property) {
      const entry=active.current;
      if (!entry||entry.actor!==actor||entry.checkpoint.listingId!==current.id) return;
      entry.initial=listingGallery(confirmed);
      entry.checkpoint={...entry.checkpoint,baseVersion:confirmed.updated_at,baseGallery:entry.initial,
        pending:pendingListingPhotos(entry.checkpoint,entry.initial),savedAt:Date.now()};
      persist(entry);
    },
  };
}
