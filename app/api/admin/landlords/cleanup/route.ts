import { request } from "@/lib/requests";
import { staffRequest,StaffRequestError } from "@/lib/staff-server";
import { staffAdminClient } from "@/lib/server";
import { cleanUnusedLandlordUploads } from "@/lib/landlord-server";
import { canDeleteContent } from "@/lib/staff";
export async function POST(req:Request){try{return await request(async signal=>{
 const {db,role}=await staffRequest(req,signal);const profile=await db.rpc("get_staff_profile").abortSignal(signal);if(profile.error||!canDeleteContent(role))return Response.json({error:"permission"},{status:403});
 const admin=staffAdminClient();if(!admin)return Response.json({error:"unavailable"},{status:503});
 return Response.json({removed:await cleanUnusedLandlordUploads(admin)},{headers:{"Cache-Control":"no-store"}});
 });}catch(error){return Response.json({error:"cleanup"},{status:error instanceof StaffRequestError?error.status:503});}}
