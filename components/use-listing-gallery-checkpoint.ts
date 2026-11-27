import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getGalleryCheckpoints, isGalleryCheckpoint, listingGallery, pendingListingPhotos, removeGalleryCheckpoint, sameJson, storeGalleryCheckpoint,
  type GalleryCheckpoint, type ListingGallery, type PlannedListingPhoto } from "@/lib/listing-gallery-checkpoint";
import type { Property } from "@/lib/types";
import type { useSite } from "./site-context";

type EditTask = ReturnType<typeof useSite>["editorTask"];
type Edit = { actor: string; initial: ListingGallery; checkpoint: GalleryCheckpoint; stored: boolean };
type Checkpoints = { actor?: string; entries: GalleryCheckpoint[] };
const nextRevision = (checkpoint: GalleryCheckpoint) => Math.max(Date.now(), checkpoint.savedAt + 1);

export function useListingGalleryCheckpoint(actor: string | undefined, property: Property | null, editorTask: EditTask) {
  const active = useRef<Edit | null>(null);
  const remote = useRef<Checkpoints>({entries: []});
  const requests = useRef(new Map<string, Promise<boolean>>());
  const actorRef = useRef(actor);
  const [saved, setSaved] = useState<Checkpoints>({entries: []});
  const [localIssue, setLocalIssue] = useState(false);
  const [syncIssue, setSyncIssue] = useState(false);

  function localEntries(account: string) {
    try { return getGalleryCheckpoints(window.localStorage, account); }
    catch { setLocalIssue(true); return []; }
  }

  function refresh(account: string) {
    if (actorRef.current !== account) return;
    const entries=new Map((remote.current.actor===account?remote.current.entries:[]).map(value=>[value.key,value]));
    for (const value of localEntries(account)) {
      if ((entries.get(value.key)?.savedAt??-1)<value.savedAt) entries.set(value.key,value);
    }
    setSaved({actor:account,entries:[...entries.values()].sort((a,b)=>b.savedAt-a.savedAt)});
  }

  function request(account: string, checkpoint?: GalleryCheckpoint, discard = false) {
    return editorTask(async (db, signal) => {
      const {data,error}=await db.rpc("home_media_gallery_checkpoints",{
        p_actor: account,p_checkpoint: checkpoint??null,p_discard: discard,
      }).abortSignal(signal);
      if(error?.code==="PGRST202"||error?.code==="42883")return "legacy";
      if(error)throw error;
      return data;
    });
  }

  function sync(account: string, checkpoint: GalleryCheckpoint, discard = false) {
    const key=account+":"+checkpoint.key;
    const previous=requests.current.get(key)??Promise.resolve(true);
    const operation=previous.then(async ()=>{
      if(actorRef.current!==account)return false;
      try {
        const result=await request(account,checkpoint,discard);
        if(actorRef.current!==account)return false;
        if(result==="newer"){setSyncIssue(true);return false;}
        if(result==="saved"||result==="discarded"){
          const entries=(remote.current.actor===account?remote.current.entries:[]).filter(value=>value.key!==checkpoint.key);
          if(result==="saved")entries.push(checkpoint);
          remote.current={actor:account,entries};
        }
        if(result==="discarded"||discard&&result==="legacy"){
          try {
            const current=localEntries(account).find(value=>value.key===checkpoint.key);
            if(current&&current.savedAt<=checkpoint.savedAt)removeGalleryCheckpoint(window.localStorage,account,checkpoint.key);
          } catch { setLocalIssue(true); }
        }
        refresh(account);
        setSyncIssue(false);
        return result==="saved"||result==="legacy"||discard&&result==="discarded";
      } catch {
        if(actorRef.current===account)setSyncIssue(true);
        return false;
      }
    });
    requests.current.set(key,operation);
    void operation.then(()=>{if(requests.current.get(key)===operation)requests.current.delete(key);});
    return operation;
  }

  useLayoutEffect(() => {
    actorRef.current=actor;
    setLocalIssue(false);setSyncIssue(false);
    if(actor)refresh(actor);
    const onStorage = (event: StorageEvent) => { if(actor&&event.key?.startsWith(`gary-home:gallery:${actor}:`))refresh(actor); };
    window.addEventListener("storage",onStorage);
    return ()=>window.removeEventListener("storage",onStorage);
    // Local changes are also read synchronously as checkpoints are written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  useEffect(()=>{
    if(!actor)return;
    let current=true;
    async function hydrate(account: string){
      const before=remote.current;
      try {
        const data=await request(account);
        if(!current||actorRef.current!==account||remote.current!==before||data==="legacy")return;
        if(!Array.isArray(data))throw new Error("Couldn’t load recoverable media.");
        const entries=data.filter(isGalleryCheckpoint);
        const byKey=new Map(entries.map(checkpoint=>[checkpoint.key,checkpoint]));
        remote.current={actor:account,entries};
        setSyncIssue(false);
        refresh(account);
        for(const checkpoint of localEntries(account)){
          if((byKey.get(checkpoint.key)?.savedAt??-1)<checkpoint.savedAt&&!requests.current.has(account+":"+checkpoint.key))
            void sync(account,checkpoint);
        }
      } catch {
        if(current&&actorRef.current===account)setSyncIssue(true);
      }
    }
    const online=()=>void hydrate(actor);
    online();
    window.addEventListener("online",online);
    return ()=>{current=false;window.removeEventListener("online",online);};
    // The editor task is scoped to the active account and aborts on session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[actor,editorTask]);

  function persist(entry: Edit) {
    if(entry.checkpoint.pending.length||!sameJson(entry.checkpoint.gallery,entry.initial)){
      try {
        storeGalleryCheckpoint(window.localStorage,entry.actor,entry.checkpoint);
        setLocalIssue(false);
      } catch { setLocalIssue(true); }
      entry.stored=true;
      refresh(entry.actor);
      return sync(entry.actor,entry.checkpoint);
    }
    if(!entry.stored)return Promise.resolve(true);
    const discarded=entry.checkpoint;
    entry.checkpoint={...discarded,key:crypto.randomUUID()};
    entry.stored=false;
    return sync(entry.actor,discarded,true);
  }

  function begin(current: Property, isNew: boolean, recovered?: GalleryCheckpoint) {
    if (!actor) return;
    const initial = listingGallery(current);
    const checkpoint = {key:crypto.randomUUID(), listingId:current.id, baseVersion:isNew?null:current.updated_at,baseGallery:initial,
      gallery:recovered?{...initial,...recovered.gallery}:initial, pending:recovered?.pending??[], title:current.title_en||current.title_vi, savedAt:Date.now()};
    const entry = {actor,initial,checkpoint,stored:false};
    active.current=entry;
    if (recovered) {
      // Keep the original recovery copy until the replacement has been recorded.
      void persist(entry).then(confirmed=>{if(confirmed)void sync(actor,recovered,true);});
    }
  }

  useLayoutEffect(() => {
    const entry=active.current;
    if (!property || !entry || entry.actor!==actor || entry.checkpoint.listingId!==property.id) return;
    const gallery=listingGallery(property), pending=pendingListingPhotos(entry.checkpoint,gallery);
    if (sameJson(gallery,entry.checkpoint.gallery)&&pending.length===entry.checkpoint.pending.length) return;
    entry.checkpoint={...entry.checkpoint,gallery,pending,title:property.title_en||property.title_vi,savedAt:nextRevision(entry.checkpoint)};
    void persist(entry);
    // Preserve the media values before the next interaction with the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor,property]);

  return {
    entries:saved.actor===actor?saved.entries:[], unavailable:localIssue||syncIssue, begin,
    discard(checkpoint: GalleryCheckpoint) {
      if (actor) return sync(actor,checkpoint,true);
    },
    async plan(listingId: string, photo: PlannedListingPhoto) {
      const entry=active.current;
      if (!entry||entry.actor!==actor||entry.checkpoint.listingId!==listingId) return;
      if(!entry.checkpoint.pending.some(item=>item.path===photo.path))
        entry.checkpoint={...entry.checkpoint,pending:[...entry.checkpoint.pending,photo],savedAt:nextRevision(entry.checkpoint)};
      if(!await persist(entry))throw Object.assign(new Error("Couldn’t protect this upload for recovery."),{name:"ListingRecoveryError"});
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
        pending:pendingListingPhotos(entry.checkpoint,entry.initial),savedAt:nextRevision(entry.checkpoint)};
      void persist(entry);
    },
  };
}
