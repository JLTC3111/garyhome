import { z } from "zod";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError,staffDataError,staffRequest } from "@/lib/staff-server";

const input=z.object({user_id:z.string().uuid()});
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){
 try{
  await boundedRequest(async signal=>{
   const {db}=await staffRequest(request,signal);
   if(Number(request.headers.get("content-length")||0)>2048)throw new StaffRequestError("Request too large.",413);
   let body:unknown;try{const text=await request.text();if(text.length>2048)throw new Error();body=JSON.parse(text);}catch{throw new StaffRequestError("Check the staff account.");}
   const parsed=input.safeParse(body);if(!parsed.success)throw new StaffRequestError("Check the staff account.");
   const target=await db.rpc("staff_reset_email",{target_user_id:parsed.data.user_id}).abortSignal(signal);
   if(target.error?.code==="23514")throw new StaffRequestError("Confirm the invitation and restore staff access before requesting a password reset.",409);
   staffDataError(target.error);if(!target.data)throw new StaffRequestError("Refresh the team before requesting a password reset.",409);
   signal.throwIfAborted();
   const {error}=await db.auth.resetPasswordForEmail(target.data,{redirectTo:new URL("/auth/reset",request.url).href});
   if(error)throw new StaffRequestError(["over_email_send_rate_limit","over_request_rate_limit"].includes(error.code||"")?"Please wait before requesting another password reset.":"Couldn’t send the password reset email. Check Auth email delivery settings and try again.",error.status===429?429:503);
  });
  return Response.json({ok:true},{headers});
 }catch(error){return Response.json({error:error instanceof StaffRequestError?error.message:"Couldn’t confirm the reset request. Refresh before trying again."},{status:error instanceof StaffRequestError?error.status:503,headers});}
}
