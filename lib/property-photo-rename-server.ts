import type { SupabaseClient } from "@supabase/supabase-js";
import type { Property } from "./types";
import { request } from "./requests.ts";
import {
  PROPERTY_IMAGE_BUCKET, PROPERTY_IMAGE_MAX_BYTES, propertyImageFormat,
  propertyPhotoExtension, propertyPhotoFilename, propertyPhotoPath, propertyPhotoUrl, replacePropertyPhotoUrl,
} from "./property-photo-files.ts";

type PhotoVersion = {id:string; updated_at:string; previous_updated_at:string};
type RenameJob = {
  id:string; origin:string; property_id:string; old_key:string; new_key:string;
  sha256:string|null; applied_at:string|null; removed_at:string|null;
  properties:PhotoVersion[]; current_key?:string; auto_cleanup_requested?:boolean;
};
type ListingPhotoState = {id:string; images:string[]; updated_at:string};

export class PhotoRenameError extends Error {
  readonly code:string;
  readonly status:number;
  constructor(code:string,status=409) { super(code);this.code=code;this.status=status; }
}

async function rpc<T>(db:SupabaseClient,name:string,args:Record<string,unknown>,signal:AbortSignal):Promise<T> {
  const {data,error} = await db.rpc("home_photo_rename_"+name,args).abortSignal(signal);
  if (error) {
    if (error.code==="55P03") throw new PhotoRenameError("media_busy");
    if (["PGRST202","42883","42P01"].includes(error.code)) throw new PhotoRenameError("migration_required",503);
    const code = /^photo_rename\.([a-z_]+)$/.exec(error.message)?.[1];
    if (code) throw new PhotoRenameError(code,error.code==="42501"?403:409);
    if (error.code==="42501") throw new PhotoRenameError("forbidden",403);
    throw new PhotoRenameError("unavailable",503);
  }
  return data as T;
}

async function listingPhotos(db:SupabaseClient,id:string,signal:AbortSignal):Promise<ListingPhotoState|null> {
  const {data,error} = await db.from("properties").select("id,images,updated_at").eq("id",id).abortSignal(signal).maybeSingle();
  if (error) throw new PhotoRenameError("unavailable",503);
  return data;
}

async function readPhoto(origin:string,key:string,signal:AbortSignal) {
  const url = new URL(propertyPhotoUrl(origin,key));
  // A fresh request avoids certifying a previously cached version of an object.
  url.searchParams.set("gary-verify",crypto.randomUUID());
  const response = await fetch(url,{signal,cache:"no-store",redirect:"error"});
  if (!response.ok || !response.body) throw new PhotoRenameError("object_unavailable");
  if (Number(response.headers.get("content-length")) > PROPERTY_IMAGE_MAX_BYTES) {
    await response.body.cancel();
    throw new PhotoRenameError("file_size");
  }
  const reader = response.body.getReader(), chunks:Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length>PROPERTY_IMAGE_MAX_BYTES) { await reader.cancel(); throw new PhotoRenameError("file_size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  const format = propertyImageFormat(bytes.subarray(0,4096),length);
  if (!format) throw new PhotoRenameError("file_format");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  const sha256 = Array.from(hash,byte=>byte.toString(16).padStart(2,"0")).join("");
  return {sha256,format,contentType:response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()};
}

export type RenamePhotoInput = {propertyId:string; source:string; filename:string; version:string; cleanupConfirmed?:boolean};
export type RenamePhotoResult = {
  id:string; oldKey:string; url:string; selectedUrl:string; properties:PhotoVersion[];
  savedListing:Property;
  cleanup:{status:"removed"}|{status:"pending"; reason:string};
};

export async function renamePropertyPhoto(
  db:SupabaseClient, system:SupabaseClient, origin:string, input:RenamePhotoInput, signal:AbortSignal,
):Promise<RenamePhotoResult> {
  const oldKey = propertyPhotoPath(input.source,origin);
  if (!oldKey) throw new PhotoRenameError("unsupported_source",400);
  const lookupArgs = {p_property:input.propertyId,p_origin:origin,p_old_key:oldKey};
  // Resume against the recorded format, even when the initial request used
  // a bare basename and the original has already been removed.
  let job = await rpc<RenameJob|null>(db,"resume",lookupArgs,signal);
  if (job) {
    const name=job.new_key.split("/").at(-1)||"", extension=propertyPhotoExtension(name);
    if(!extension||propertyPhotoFilename(input.filename,extension,true)!==name)throw new PhotoRenameError("pending_name");
  }
  if (!job?.applied_at) {
    const listing = await listingPhotos(db,input.propertyId,signal);
    if (!listing || !listing.images.some(url=>propertyPhotoPath(url,origin)===oldKey))
      throw new PhotoRenameError("photo_not_saved");
    const source = await readPhoto(origin,oldKey,signal);
    const filename = propertyPhotoFilename(input.filename,source.format.extension,true);
    if (!filename) throw new PhotoRenameError("invalid_name",400);
    if (filename===oldKey.split("/").at(-1)) throw new PhotoRenameError("same_name",400);
    job = await rpc<RenameJob>(db,"reserve_v2",{
      ...lookupArgs,p_name:filename,p_version:input.version,p_cleanup_confirmed:input.cleanupConfirmed===true,
    },signal);
    if (!job.applied_at) {
      signal.throwIfAborted();
      const claimed = await rpc<boolean>(system,"claim_copy",{p_id:job.id},signal);
      const result = claimed ? await system.storage.from(PROPERTY_IMAGE_BUCKET).copy(job.old_key,job.new_key) : null;
      // A matching copy in this reserved path can be the result of an earlier
      // interrupted request. Verify it without sending a competing copy.
      const copied = await readPhoto(origin,job.new_key,signal).catch(error=>{
        if (!claimed) throw new PhotoRenameError("copy_pending");
        if (result?.error) throw new PhotoRenameError("copy_failed");
        throw error;
      });
      if (copied.sha256!==source.sha256 || copied.format.extension!==source.format.extension ||
          copied.contentType!==source.contentType || copied.contentType!==source.format.contentType)
        throw new PhotoRenameError("integrity_failed");
      if (!await rpc<boolean>(system,"verified",{p_id:job.id,p_sha256:copied.sha256},signal))
        throw new PhotoRenameError("unverified");
      job = await rpc<RenameJob>(db,"apply",{p_id:job.id,p_version:input.version},signal);
    }
  }
  const {data,error} = await db.from("properties").select("*").eq("id",input.propertyId).abortSignal(signal).maybeSingle();
  if(error||!data)throw new PhotoRenameError("confirm_listing");
  const savedListing=data as Property;
  const url = propertyPhotoUrl(origin,job.new_key), expected = replacePropertyPhotoUrl(input.source,origin,oldKey,url);
  const selectedUrl = savedListing.images.includes(expected) ? expected : savedListing.images.find(src=>propertyPhotoPath(src,origin)===job.new_key);
  if (!selectedUrl) throw new PhotoRenameError("confirm_listing");
  let cleanup:RenamePhotoResult["cleanup"]=job.removed_at ? {status:"removed"} : {status:"pending",reason:"review_required"};
  if(!job.removed_at&&job.auto_cleanup_requested){
    try {
      await request(cleanupSignal=>retirePropertyPhoto(db,system,origin,job.id,AbortSignal.any([signal,cleanupSignal])),10000);
      cleanup={status:"removed"};
    } catch(error) {
      cleanup={status:"pending",reason:error instanceof PhotoRenameError?error.code:"unavailable"};
    }
  }
  return {id:job.id,oldKey,url,selectedUrl,properties:job.properties,savedListing,cleanup};
}

export type PhotoRenameHistory = {id:string;old_key:string;new_key:string;applied_at:string|null;removed_at:string|null;auto_cleanup_requested?:boolean};
export function propertyPhotoRenameHistory(db:SupabaseClient,propertyId:string,signal:AbortSignal) {
  return rpc<PhotoRenameHistory[]>(db,"history",{p_property:propertyId},signal);
}

export async function retirePropertyPhoto(db:SupabaseClient, system:SupabaseClient, origin:string,id:string,signal:AbortSignal) {
  const job = await rpc<RenameJob>(db,"request_removal",{p_id:id,p_confirm:true},signal);
  if (job.origin!==origin || !job.current_key || !job.sha256) throw new PhotoRenameError("replacement_unavailable");
  if (job.removed_at) return;
  const replacement = await readPhoto(origin,job.current_key,signal);
  if (replacement.sha256!==job.sha256 || replacement.contentType!==replacement.format.contentType)
    throw new PhotoRenameError("integrity_failed");
  const confirmed = await rpc<RenameJob>(db,"request_removal",{p_id:id,p_confirm:true},signal);
  if (confirmed.current_key!==job.current_key || confirmed.old_key!==job.old_key)
    throw new PhotoRenameError("replacement_unavailable");
  if (confirmed.removed_at) return;
  signal.throwIfAborted();
  // An interrupted removal can already have succeeded. The catalogue check
  // determines the outcome even if the Storage response was lost.
  await system.storage.from(PROPERTY_IMAGE_BUCKET).remove([job.old_key]).catch(()=>null);
  if (!await rpc<boolean>(system,"removed",{p_id:id},signal)) throw new PhotoRenameError("remove_failed");
}
