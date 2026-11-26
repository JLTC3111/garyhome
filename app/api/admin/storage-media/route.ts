import { backendConfig } from "@/lib/server";
import { PROPERTY_IMAGE_ORIGIN } from "@/lib/property-photo-files";
import { staffRequest, StaffRequestError } from "@/lib/staff-server";
import { request, RequestTimeoutError } from "@/lib/requests";
import { executeStorageMedia, storageMediaActions } from "@/lib/home-media-request";

export const maxDuration = 60;
const json = (value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(req:Request) {
  try {
    return await request(async signal=>{
      const {url,key}=backendConfig();
      if(!key||!URL.canParse(url)||new URL(url).origin!==PROPERTY_IMAGE_ORIGIN) return json({error:"backend_config"},503);
      const {db,role}=await staffRequest(req,signal);
      if(role!=="owner")return json({error:"forbidden"},403);
      const raw:unknown=await req.json().catch(()=>null);
      if(!raw||typeof raw!=="object"||Array.isArray(raw))return json({error:"invalid_request"},400);
      const input=raw as Record<string,unknown>;
      if(typeof input.action!=="string"||!storageMediaActions.has(input.action))
        return json({error:"invalid_request"},400);
      const response=await executeStorageMedia(db,{...input,action:input.action},signal,()=>fetch(PROPERTY_IMAGE_ORIGIN+"/functions/v1/media-orphan-cleanup",{
        method:"POST",signal,redirect:"error",cache:"no-store",headers:{
          Authorization:req.headers.get("authorization")!,apikey:key,"Content-Type":"application/json",
        },body:JSON.stringify({action:input.action==="worker_status"?"health":input.action,id:input.id,offset:input.offset,expiresAt:input.expiresAt,confirm:input.confirm}),
      }));
      return json(response.data,response.status);
    },55000);
  } catch(error) {
    if(error instanceof StaffRequestError)return json({error:error.status===401?"session_expired":error.status===403?"forbidden":"owner_check_unavailable"},error.status);
    if(error instanceof RequestTimeoutError)return json({error:"inventory_timeout"},504);
    return json({error:"inventory_unavailable"},503);
  }
}
