import { z } from "zod";
import { staffAdminClient } from "@/lib/server";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError,staffDataError,staffRequest } from "@/lib/staff-server";

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
   const target=await db.rpc("staff_temporary_password_request",{target_user_id:parsed.data.user_id,failed:false}).abortSignal(signal);
   staffDataError(target.error);
   if(typeof target.data!=="string"||!target.data)throw new StaffRequestError("Refresh the team before setting a temporary password.",409);
   signal.throwIfAborted();
   const {data,error}=await admin.auth.admin.updateUserById(parsed.data.user_id,{password:parsed.data.password,email_confirm:true});
   if(error||data.user?.id!==parsed.data.user_id||data.user?.email?.toLowerCase()!==target.data.toLowerCase()||!data.user.email_confirmed_at){
    // Keep the Auth error private; the durable request already identifies the
    // target. A failed audit write must not hide an ambiguous Auth result.
    try{await db.rpc("staff_temporary_password_request",{target_user_id:parsed.data.user_id,failed:true}).abortSignal(signal);}catch{}
    throw new StaffRequestError("Couldn’t confirm the temporary password. Check the account before trying again.",503);
   }
  });
  return Response.json({ok:true,password_set:true,confirmed:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the temporary password. Check the account before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
