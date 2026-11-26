import { backendConfig } from "@/lib/server";
import { PROPERTY_IMAGE_ORIGIN } from "@/lib/property-photo-files";
import { staffRequest, StaffRequestError } from "@/lib/staff-server";
import { request } from "@/lib/requests";

export const maxDuration = 60;
const json = (value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}});

export async function POST(req:Request) {
  try {
    return await request(async signal=>{
      const {role}=await staffRequest(req,signal);
      if(role!=="owner")return json({error:"forbidden"},403);
      const input=await req.json().catch(()=>null);
      if(!input||!["status","scan","trash","restore","run"].includes(input.action))return json({error:"invalid_request"},400);
      const {url,key}=backendConfig();
      if(new URL(url).origin!==PROPERTY_IMAGE_ORIGIN||!key)return json({error:"unavailable"},503);
      const response=await fetch(PROPERTY_IMAGE_ORIGIN+"/functions/v1/media-orphan-cleanup",{
        method:"POST",signal,redirect:"error",cache:"no-store",headers:{
          Authorization:req.headers.get("authorization")!,apikey:key,"Content-Type":"application/json",
        },body:JSON.stringify({action:input.action,id:input.id,offset:input.offset}),
      });
      return json(await response.json(),response.status);
    },55000);
  } catch(error) {
    if(error instanceof StaffRequestError)return json({error:error.status===401?"session_expired":"forbidden"},error.status);
    return json({error:"unavailable"},503);
  }
}
