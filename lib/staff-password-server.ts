import type { SupabaseClient } from "@supabase/supabase-js";
import { StaffRequestError,staffDataError } from "./staff-server";

export async function setStaffTemporaryPassword(db:SupabaseClient,admin:SupabaseClient,userId:string,password:string,signal:AbortSignal){
 const target=await db.rpc("staff_temporary_password_request",{target_user_id:userId,failed:false}).abortSignal(signal);
 staffDataError(target.error);
 if(typeof target.data!=="string"||!target.data)throw new StaffRequestError("Refresh the team before setting a temporary password.",409);
 signal.throwIfAborted();
 const {data,error}=await admin.auth.admin.updateUserById(userId,{password,email_confirm:true});
 if(error||data.user?.id!==userId||data.user?.email?.toLowerCase()!==target.data.toLowerCase()||!data.user.email_confirmed_at){
  try{await db.rpc("staff_temporary_password_request",{target_user_id:userId,failed:true}).abortSignal(signal);}catch{}
  throw new StaffRequestError("Couldn’t confirm the temporary password. Check the account before trying again.",503);
 }
}
