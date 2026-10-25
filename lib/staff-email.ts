import type { SupabaseClient } from "@supabase/supabase-js";
import { StaffRequestError,staffDataError } from "./staff-server";

export function staffEmailError(error:{code?:string;status?:number}):StaffRequestError{
  if(["over_email_send_rate_limit","over_request_rate_limit"].includes(error.code||"")||error.status===429)return new StaffRequestError("Email sending limit reached. Wait before trying again or check Supabase SMTP settings.",429);
  if(error.code==="email_address_not_authorized")return new StaffRequestError("Supabase email delivery is restricted to approved recipients. Configure custom SMTP before sending staff emails.",503);
  if(error.status===401||error.status===403)return new StaffRequestError("Staff email is not authorized. Check this project’s server-only Supabase key and email settings.",503);
  return new StaffRequestError("Supabase could not confirm the email request. Check SMTP settings and sender verification, then try again.",503);
}

export async function requestStaffPasswordEmail(db:SupabaseClient,userId:string,requestUrl:string,signal:AbortSignal){
  // Re-check the actor and target after assignment and use the actual Auth email.
  const target=await db.rpc("staff_reset_email",{target_user_id:userId}).abortSignal(signal);
  if(target.error?.code==="23514")throw new StaffRequestError("Restore staff access and check the assigned email before requesting a password link.",409);
  staffDataError(target.error);
  if(typeof target.data!=="string"||!target.data)throw new StaffRequestError("Refresh the team before requesting a password link.",409);
  signal.throwIfAborted();
  const {error}=await db.auth.resetPasswordForEmail(target.data,{redirectTo:new URL("/auth/reset",requestUrl).href});
  if(error)throw staffEmailError(error);
}
