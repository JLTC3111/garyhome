import { staffRequest, StaffRequestError } from "@/lib/staff-server";
import { canDeleteContent } from "@/lib/staff";
import { request } from "@/lib/requests";
import { stageListingDeletion, listingDeletionQueue, ListingDeletionError, type ReviewedListingObject } from "@/lib/property-deletion-server";

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});

function reviewedManifest(value: unknown): value is ReviewedListingObject[] {
  return Array.isArray(value) && value.length>0 && value.length<=80 && value.every(item=>item &&
    (item.bucket==="property-media" || item.bucket==="listing-videos") &&
    typeof item.name==="string" && item.name.length>0 && item.name.length<=1024 &&
    typeof item.id==="string" && uuid.test(item.id) &&
    (item.version===null || typeof item.version==="string" && item.version.length<=128));
}

export async function POST(req:Request) {
  try {
    return await request(async signal=>{
      const {db,role}=await staffRequest(req,signal);
      if (!canDeleteContent(role)) return json({error:"forbidden"},403);
      const raw=await req.json().catch(()=>null);
      if (!raw || typeof raw!=="object" || Array.isArray(raw)) return json({error:"invalid_request"},400);
      const input=raw as Record<string,unknown>;
      if(input.action!=="delete" && role!=="owner")return json({error:"forbidden"},403);
      if (input.action==="queue") return json({jobs:await listingDeletionQueue(db,signal)});
      const propertyId=input.propertyId;
      if (typeof propertyId!=="string" || !uuid.test(propertyId)) return json({error:"invalid_request"},400);
      if (input.confirm===true && input.action==="delete" && typeof input.version==="string"
        && input.version.length<=48 && Number.isFinite(Date.parse(input.version)))
        return json(await stageListingDeletion(db,propertyId,{version:input.version},signal));
      if (input.confirm===true && input.action==="adopt" && reviewedManifest(input.manifest))
        return json(await stageListingDeletion(db,propertyId,{manifest:input.manifest},signal));
      return json({error:"invalid_request"},400);
    },45000);
  } catch (error) {
    if (error instanceof ListingDeletionError) return json({error:error.message},error.status);
    if (error instanceof StaffRequestError) return json({error:error.status===401?"session_expired":error.status===403?"forbidden":"unavailable"},error.status);
    return json({error:"unavailable"},503);
  }
}
