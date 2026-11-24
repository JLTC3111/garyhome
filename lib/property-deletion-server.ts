import type { SupabaseClient } from "@supabase/supabase-js";
import { request } from "./requests.ts";
import { isConflictResponse } from "./conflict-response.ts";

export type ListingDeletion = {
  propertyId: string; listingCode: string; requestedAt: string;
  pending: number; removed: number; retained: number; review: number;
};
export type ReviewedListingObject = { bucket: "property-media" | "listing-videos"; name: string; id: string; version: string | null };

export class ListingDeletionError extends Error {
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.status = status; }
}

async function rpc<T>(db: SupabaseClient, action: string, args: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const {data,error,status} = await db.rpc(`home_listing_delete_${action}`,args).abortSignal(signal);
  if (error) {
    const code = /^listing_cleanup\.([a-z_]+)$/.exec(error.message)?.[1];
    if (error.code === "55P03") throw new ListingDeletionError("media_busy",409);
    if (error.code === "42501") throw new ListingDeletionError("forbidden",403);
    if (["PGRST202","42883","42P01"].includes(error.code)) throw new ListingDeletionError("migration_required",503);
    if (code) throw new ListingDeletionError(code,error.code === "P0002" ? 404 : 409);
    if (isConflictResponse({code:error.code,status})) throw new ListingDeletionError("conflict",409);
    throw new ListingDeletionError("unavailable",503);
  }
  return data as T;
}

export function listingDeletionQueue(db: SupabaseClient, signal: AbortSignal) {
  return rpc<ListingDeletion[]>(db,"status",{},signal);
}

async function cleanListingMedia(system: SupabaseClient, propertyId: string, actor: string | null, signal: AbortSignal) {
  const args = {p_property:propertyId};
  const lease = await rpc<string|null>(system,"claim",{...args,p_background:actor===null},signal);
  if (!lease) return false;
  try {
    const targets=await rpc<Pick<ReviewedListingObject,"bucket"|"name">[]>(system,"targets",{...args,p_actor:actor},signal);
    for (const bucket of ["property-media","listing-videos"] as const) {
      const paths=targets.filter(target=>target.bucket===bucket).map(target=>target.name);
      if (!paths.length) continue;
      signal.throwIfAborted();
      // Require the per-object Storage acknowledgement and catalogue
      // confirmation before marking an item removed.
      const result=await system.storage.from(bucket).remove(paths).catch(()=>null);
      const acknowledged=result?.error===null ? result.data.map(item=>item.name).filter(name=>paths.includes(name)) : [];
      if (acknowledged.length) await rpc<null>(system,"confirm",{...args,p_bucket:bucket,p_names:acknowledged},signal);
    }
    return true;
  } finally {
    await rpc<null>(system,"release",{...args,p_lease:lease},AbortSignal.timeout(2500)).catch(()=>null);
  }
}

export async function retryDueListingCleanup(system: SupabaseClient, signal: AbortSignal) {
  const due=await rpc<{jobs:string[];overdue:number}>(system,"due",{},signal);
  let attempted=0;
  for (const propertyId of due.jobs) {
    signal.throwIfAborted();
    if (await cleanListingMedia(system,propertyId,null,signal)) attempted++;
  }
  const {overdue}=attempted ? await rpc<{overdue:number}>(system,"due",{},signal) : due;
  return {attempted,overdue};
}

export async function deleteListingAndMedia(
  db: SupabaseClient, system: SupabaseClient, actor: string, propertyId: string,
  action: { version: string } | { manifest: ReviewedListingObject[] } | { retry: true }, signal: AbortSignal,
): Promise<ListingDeletion> {
  const args = {p_property:propertyId};
  let job: ListingDeletion | null;
  if ("version" in action) job=await rpc<ListingDeletion>(db,"prepare",{...args,p_version:action.version},signal);
  else if ("manifest" in action) job=await rpc<ListingDeletion>(db,"adopt",{...args,p_manifest:action.manifest},signal);
  else job=await rpc<ListingDeletion|null>(db,"status",args,signal);
  if (!job) throw new ListingDeletionError("missing",404);
  if (!job.pending) return job;

  // The deletion transaction already committed. A Storage or transport failure
  // leaves the durable manifest available for retry instead of hiding the result.
  return request(async deadline=>{
    const cleanupSignal=AbortSignal.any([signal,deadline]);
    await cleanListingMedia(system,propertyId,actor,cleanupSignal);
    return rpc<ListingDeletion>(db,"status",args,cleanupSignal);
  },24000).catch(()=>job);
}
