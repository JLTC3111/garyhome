import { z } from "zod";
import { readJsonBody, BodyReadError } from "@/lib/request-body";
import { staffAdminClient } from "@/lib/server";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError, staffDataError, staffRequest } from "@/lib/staff-server";
import { canManageRole,canManageStaff,canViewRole,type StaffAccount } from "@/lib/staff";

import { setStaffTemporaryPassword } from "@/lib/staff-password-server";

const headers = { "Cache-Control": "private, no-store" };
const createAccount = z.object({ email:z.string().trim().toLowerCase().email().max(254),full_name:z.string().trim().min(2).max(120),role:z.enum(["admin","manager","editor"]),mode:z.enum(["create","assign"]).default("create"),replace_password:z.boolean().default(false),password:z.string().max(128).optional(),confirm_password:z.string().max(128).optional() }).superRefine((value,ctx)=>{if((value.mode==="create"||value.replace_password)&&(!value.password||value.password.length<12||value.password!==value.confirm_password))ctx.addIssue({code:"custom",message:"Use matching passwords of at least 12 characters."});});
const editAccount = z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "manager", "editor"]), active: z.boolean() });
const removeAccount = z.object({ user_id:z.string().uuid() });
async function body(request: Request) {
  try { return await readJsonBody(request, 4096); }
  catch (error) { if (error instanceof BodyReadError) throw new StaffRequestError(error.status === 413 ? "Request too large." : "Invalid staff details.", error.status); throw error; }
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof StaffRequestError ? error.message : "The request could not be completed. Refresh the team before trying again.",...(error instanceof StaffRequestError&&error.code?{code:error.code}:{}) }, { status: error instanceof StaffRequestError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal,"view");
      const managing=canManageStaff(role);
      const after = new URL(request.url).searchParams.get("after");
      if (after && after.length > 254) throw new StaffRequestError("Invalid page.");
      const [members, settings] = await Promise.all([
        db.rpc("list_staff_accounts", { after_email: after }).abortSignal(signal),
        managing?db.from("staff_settings").select("email_domains").eq("id", "main").abortSignal(signal).single():Promise.resolve({data:{email_domains:[] as string[]},error:null}),
      ]);
      staffDataError(members.error); staffDataError(settings.error);
      if (managing&&!settings.data?.email_domains?.length) throw new StaffRequestError("Apply the staff access database migration before managing the team.", 503);
      const rows = ((members.data ?? []) as StaffAccount[]).filter(member=>canViewRole(role,member.role));
      const selected=rows.slice(0,50);
      const photos=selected.length?await db.from("staff_profiles").select("user_id,avatar_path").in("user_id",selected.map(m=>m.user_id)).abortSignal(signal):{data:[],error:null};
      staffDataError(photos.error);
      return { members:selected.map(member=>({...member,avatar_path:photos.data?.find(p=>p.user_id===member.user_id)?.avatar_path||""})),next:rows.length>50?rows[49].email:null,domains:settings.data?.email_domains??[],role,directCreationEnabled:managing&&!!staffAdminClient() };
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  let created=false,accessAssigned=false,replacingPassword=false;
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const parsed = createAccount.safeParse(await body(request));
      if (!parsed.success) throw new StaffRequestError("Check the staff details and matching passwords of at least 12 characters.");
      const input = parsed.data;
      replacingPassword=input.mode==="assign"&&input.replace_password;
      if(input.mode==="assign"&&!input.replace_password&&(input.password||input.confirm_password))throw new StaffRequestError("Choose Set a temporary password to replace the existing password, or leave both password fields blank.",400,"password_choice_required");
      if(!canManageRole(role,input.role))throw new StaffRequestError("You can assign roles below your own level only.",403);
      // The RPC validates the allowed email domain, protected accounts, and the
      // actor's fresh membership before any Auth account or email is created.
      const found = await db.rpc("find_staff_account", { target_email: input.email, assigned_role: input.role }).abortSignal(signal);
      staffDataError(found.error);
      const admin=staffAdminClient();
      if(!admin)throw new StaffRequestError("Direct staff creation needs the server-only Supabase secret key. Ask the owner to configure it in Vercel.",503);
      if(input.mode==="create"){
        if(found.data)throw new StaffRequestError("A login already exists for this email. Assign or restore staff access instead of creating another login.",409,"existing_login");
        const account=await admin.auth.admin.createUser({email:input.email,password:input.password!,email_confirm:true,user_metadata:{full_name:input.full_name}});
        if(account.error||!account.data.user){
          if(["email_exists","user_already_exists","email_already_exists"].includes(account.error?.code||""))throw new StaffRequestError("A login already exists for this email. Assign or restore staff access instead of creating another login.",409,"existing_login");
          if(account.error?.code==="weak_password")throw new StaffRequestError("Supabase rejected this password. Choose a stronger password and try again.",400,"weak_password");
          throw new StaffRequestError("Couldn’t create the account. Check the email, password requirements and server configuration, then refresh before retrying.",503);
        }
        created=true;
      }else{
        if(!found.data)throw new StaffRequestError("No account exists for this email. Choose Create new account.",404);
        const confirmed=await admin.auth.admin.updateUserById(found.data,{email_confirm:true});
        if(confirmed.error)throw new StaffRequestError("Couldn’t confirm this account. Refresh the team before trying again.",503);
      }
      // This second RPC checks permissions again after the Auth account write.
      // A revoked admin cannot use a delayed Auth response to grant access.
      const assigned = await db.rpc("assign_staff_account", { target_email: input.email, full_name: input.full_name, assigned_role: input.role }).abortSignal(signal);
      staffDataError(assigned.error);
      if(typeof assigned.data!=="string"||!assigned.data)throw new StaffRequestError("Staff access was not confirmed. Refresh the team before trying again.",409);
      accessAssigned=true;
      if(replacingPassword)await setStaffTemporaryPassword(db,admin,assigned.data,input.password!,signal);
      return {user_id:assigned.data,created,confirmed:true,...(replacingPassword?{password_set:true}:{})};
    });
    return Response.json(result, { status:result.created?201:200,headers });
  } catch (error) {
    if(accessAssigned&&replacingPassword)return failure(new StaffRequestError("Staff access was assigned, but the temporary password was not confirmed. Use Set temporary password in the directory before sharing credentials.",409,"staff_access_assigned_password_unconfirmed"));
    return failure(created?new StaffRequestError("The account was created, but staff access was not confirmed. Refresh and use Assign existing login to finish assigning its role.",409):error);
  }
}
export async function PATCH(request: Request) {
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const parsed = editAccount.safeParse(await body(request));
      if (!parsed.success) throw new StaffRequestError("Check the assigned role and account.");
      const input = parsed.data;
      if(!canManageRole(role,input.role))throw new StaffRequestError("You can assign roles below your own level only.",403);
      const changed = await db.rpc("set_staff_access", { target_user_id: input.user_id, assigned_role: input.role, enabled: input.active }).abortSignal(signal);
      staffDataError(changed.error);
      return { user_id: changed.data };
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function DELETE(request:Request){
  try{
    const result=await boundedRequest(async signal=>{
      const {db}=await staffRequest(request,signal);
      const parsed=removeAccount.safeParse(await body(request));
      if(!parsed.success)throw new StaffRequestError("Check the staff account.");
      const removed=await db.rpc("remove_staff_access",{target_user_id:parsed.data.user_id}).abortSignal(signal);
      staffDataError(removed.error);if(removed.data!==true)throw new StaffRequestError("Couldn’t confirm deletion. Refresh before trying again.",409);return {ok:true};
    });
    return Response.json(result,{headers});
  }catch(error){return failure(error);}
}
