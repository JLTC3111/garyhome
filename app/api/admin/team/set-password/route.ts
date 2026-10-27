import { z } from "zod";
import { readJsonBody, BodyReadError } from "@/lib/request-body";
import { staffAdminClient } from "@/lib/server";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError,staffRequest } from "@/lib/staff-server";

import { setStaffTemporaryPassword } from "@/lib/staff-password-server";

const input=z.object({user_id:z.string().uuid(),password:z.string().min(12).max(128),confirm_password:z.string().min(12).max(128)})
 .strict().refine(value=>value.password===value.confirm_password);
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
 try{
  await boundedRequest(async signal=>{
   const {db}=await staffRequest(request,signal);
   let value:unknown;try{value=await readJsonBody(request,4096);}catch(error){throw new StaffRequestError("Check the staff account and password.",error instanceof BodyReadError?error.status:503);}
   const parsed=input.safeParse(value);
   if(!parsed.success)throw new StaffRequestError("Use matching passwords of at least 12 characters.");
   const admin=staffAdminClient();
   if(!admin)throw new StaffRequestError("Direct staff creation needs the server-only Supabase secret key. Ask the owner to configure it in Vercel.",503);
   await setStaffTemporaryPassword(db,admin,parsed.data.user_id,parsed.data.password,signal);
  });
  return Response.json({ok:true,password_set:true,confirmed:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the temporary password. Check the account before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
