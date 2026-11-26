import { z } from "zod";
import { readJsonBody, BodyReadError } from "@/lib/request-body";
import { staffAdminClient } from "@/lib/server";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError, staffDataError, staffRequest } from "@/lib/staff-server";
import { canManageRole,canManageStaff,canViewRole,type StaffAccount } from "@/lib/staff";

const headers = { "Cache-Control": "private, no-store" };
const onboardAccount = z.object({
  email:z.string().trim().toLowerCase().email().max(254),
  full_name:z.string().trim().min(2).max(120),
  role:z.enum(["admin","manager","editor"]),
  mode:z.enum(["create","assign"]).default("create")
}).strict();
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
      const photos=selected.length?await db.from("staff_profiles").select("user_id,avatar_path,avatar_bucket").in("user_id",selected.map(m=>m.user_id)).abortSignal(signal):{data:[],error:null};
      staffDataError(photos.error);
      const byUser=new Map(photos.data?.map(photo=>[photo.user_id,photo]));
      return { members:selected.map(member=>({...member,avatar_path:byUser.get(member.user_id)?.avatar_path||"",avatar_bucket:byUser.get(member.user_id)?.avatar_bucket})),next:rows.length>50?rows[49].email:null,domains:settings.data?.email_domains??[],role,directCreationEnabled:managing&&!!staffAdminClient() };
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const parsed = onboardAccount.safeParse(await body(request));
      if (!parsed.success) throw new StaffRequestError("Check the staff details. Staff choose their own passwords.",400,"invalid_onboarding");
      const input = parsed.data;
      if(!canManageRole(role,input.role))throw new StaffRequestError("You can assign roles below your own level only.",403);
      const found = await db.rpc("find_staff_account", { target_email: input.email, assigned_role: input.role }).abortSignal(signal);
      staffDataError(found.error);
      if(input.mode==="create"){
        const existingLogin=()=>new StaffRequestError("A login already exists for this email. Assign the verified login.",409,"existing_login");
        if(found.data)throw existingLogin();
        const admin=staffAdminClient();
        if(!admin)throw new StaffRequestError("Staff invitations require the server-only Supabase key.",503);
        signal.throwIfAborted();
        const {data,error}=await admin.auth.admin.inviteUserByEmail(input.email,{
          data:{full_name:input.full_name},redirectTo:new URL("/auth/invite",request.url).href
        });
        if(["email_exists","user_already_exists","email_already_exists"].includes(error?.code||""))throw existingLogin();
        if(error||!data.user)throw new StaffRequestError("Couldn’t confirm delivery of the invitation. Check whether the login exists before retrying.",503);
        // Mailbox verification and the Home access grant are separate operations.
        return {invited:true};
      }
      if(!found.data)throw new StaffRequestError("No account exists for this email. Send a staff invitation first.",404,"login_missing");
      const assigned = await db.rpc("assign_staff_account", { target_email: input.email, full_name: input.full_name, assigned_role: input.role }).abortSignal(signal);
      if(assigned.error?.code==="23514"&&/must confirm its email/.test(assigned.error.message)){
        throw new StaffRequestError("Ask the staff member to verify their email before assigning Home access.",409,"unverified_login");
      }
      staffDataError(assigned.error);
      if(typeof assigned.data!=="string"||!assigned.data)throw new StaffRequestError("Staff access was not confirmed. Refresh the team before trying again.",409);
      return {user_id:assigned.data,confirmed:true};
    });
    return Response.json(result, { status:result.invited?202:200,headers });
  } catch (error) { return failure(error); }
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
