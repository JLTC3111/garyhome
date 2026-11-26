import { canRenamePropertyPhotos } from "@/lib/staff";
import { staffRequest, StaffRequestError } from "@/lib/staff-server";
import { backendConfig, staffAdminClient } from "@/lib/server";
import { request } from "@/lib/requests";
import { PhotoRenameError, propertyPhotoRenameHistory, renamePropertyPhoto, trashOldPropertyPhoto } from "@/lib/property-photo-rename-server";

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const json = (value:unknown,status=200) => Response.json(value,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(req:Request) {
  try {
    return await request(async signal=>{
      const {db,role} = await staffRequest(req,signal);
      if (!canRenamePropertyPhotos(role)) return json({error:"forbidden"},403);
      const raw:unknown = await req.json().catch(()=>null);
      if (!raw || typeof raw!=="object" || Array.isArray(raw)) return json({error:"invalid_request"},400);
      const input = raw as Record<string,unknown>;
      if (input.action==="history" && typeof input.propertyId==="string" && uuid.test(input.propertyId))
        return json({history:await propertyPhotoRenameHistory(db,input.propertyId,signal)});
      const origin = new URL(backendConfig().url).origin;
      if (input.action==="retire" && input.confirm===true && typeof input.id==="string" && uuid.test(input.id)) {
        return json(await trashOldPropertyPhoto(db,origin,input.id,signal));
      }
      const system = staffAdminClient();
      if (!system) return json({error:"unavailable"},503);
      if (input.action==="rename" && typeof input.propertyId==="string" && uuid.test(input.propertyId) &&
          typeof input.source==="string" && input.source.length<=4096 && typeof input.filename==="string" &&
          input.filename.length<=512 && typeof input.version==="string" && input.version.length<=48 &&
          Number.isFinite(Date.parse(input.version))) {
        return json(await renamePropertyPhoto(db,system,origin,{
          propertyId:input.propertyId,source:input.source,filename:input.filename,version:input.version,
          cleanupConfirmed:input.cleanupConfirmed===true,retainOldCopy:true,
        },signal));
      }
      return json({error:"invalid_request"},400);
    },45000);
  } catch(error) {
    if (error instanceof PhotoRenameError) return json({error:error.code},error.status);
    if (error instanceof StaffRequestError) return json({error:error.status===401?"session_expired":"forbidden"},error.status);
    return json({error:"unavailable"},503);
  }
}
