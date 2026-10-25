import { z } from "zod";
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
   if(Number(request.headers.get("content-length")||0)>4096)throw new StaffRequestError("Request too large.",413);
   let value:unknown;try{const body=await request.text();if(body.length>4096)throw new Error();value=JSON.parse(body);}catch{throw new StaffRequestError("Check the staff account and password.");}
   const parsed=input.safeParse(value);
   if(!parsed.success)throw new StaffRequestError("Use matching passwords of at least 12 characters.");
   const admin=staffAdminClient();
   if(!admin)throw new StaffRequestError("Direct staff creation needs the server-only Supabase secret key. Ask the owner to configure it in Vercel.",503);
   await setStaffTemporaryPassword(db,admin,parsed.data.user_id,parsed.data.password,signal);
  });
  return Response.json({ok:true,password_set:true,confirmed:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the temporary password. Check the account before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
