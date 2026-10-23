import { z } from "zod";
import { staffAdminClient } from "@/lib/server";
import { request as boundedRequest } from "@/lib/requests";
import { StaffRequestError, staffDataError, staffRequest } from "@/lib/staff-server";
import type { StaffAccount } from "@/lib/staff";

const headers = { "Cache-Control": "private, no-store" };
const createAccount = z.object({ email: z.string().trim().toLowerCase().email().max(254), full_name: z.string().trim().min(2).max(120), role: z.enum(["admin", "manager", "editor"]) });
const editAccount = z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "manager", "editor"]), active: z.boolean() });
async function body(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 4096) throw new StaffRequestError("Request too large.", 413);
  try { const value = await request.text(); if (value.length > 4096) throw new Error(); return JSON.parse(value); }
  catch { throw new StaffRequestError("Invalid staff details.", 400); }
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof StaffRequestError ? error.message : "The request could not be completed. Refresh the team before trying again." }, { status: error instanceof StaffRequestError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const after = new URL(request.url).searchParams.get("after");
      if (after && after.length > 254) throw new StaffRequestError("Invalid page.");
      const [members, settings] = await Promise.all([
        db.rpc("list_staff_accounts", { after_email: after }).abortSignal(signal),
        db.from("staff_settings").select("email_domains").eq("id", "main").abortSignal(signal).single(),
      ]);
      staffDataError(members.error); staffDataError(settings.error);
      if (!settings.data?.email_domains?.length) throw new StaffRequestError("Apply the staff access database migration before managing the team.", 503);
      const rows = (members.data ?? []) as StaffAccount[];
      return { members: rows.slice(0, 50), next: rows.length > 50 ? rows[49].email : null, domains: settings.data.email_domains as string[], role, invitationsEnabled: !!staffAdminClient() };
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  let invited = false;
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const parsed = createAccount.safeParse(await body(request));
      if (!parsed.success) throw new StaffRequestError("Check the company email, name, and assigned role.");
      const input = parsed.data;
      if (role !== "owner" && input.role === "admin") throw new StaffRequestError("Only the owner can assign administrator access.", 403);
      // The RPC validates the company domain, protected accounts, and the
      // actor's fresh membership before any Auth account or email is created.
      const found = await db.rpc("find_staff_account", { target_email: input.email, assigned_role: input.role }).abortSignal(signal);
      staffDataError(found.error);
      if (!found.data) {
        const admin = staffAdminClient();
        if (!admin) throw new StaffRequestError("New staff invitations need the server’s Supabase secret key. Existing company accounts can still be assigned.", 503);
        const invitation = await admin.auth.admin.inviteUserByEmail(input.email, {
          redirectTo: new URL("/auth/invite", request.url).href,
          data: { full_name: input.full_name },
        });
        if (invitation.error || !invitation.data.user) throw new StaffRequestError("Couldn’t send the staff invitation. Refresh the team before trying again.", 409);
        invited = true;
      }
      // This second RPC checks permissions again after the external invite.
      // A revoked admin cannot use a delayed Auth response to grant access.
      const assigned = await db.rpc("assign_staff_account", { target_email: input.email, full_name: input.full_name, assigned_role: input.role }).abortSignal(signal);
      staffDataError(assigned.error);
      return { user_id: assigned.data, invited };
    });
    return Response.json(result, { status: result.invited ? 201 : 200, headers });
  } catch (error) {
    return failure(invited ? new StaffRequestError("The invitation was sent, but staff access was not confirmed. Refresh the team before assigning access again.", 409) : error);
  }
}
export async function PATCH(request: Request) {
  try {
    const result = await boundedRequest(async signal => {
      const { db, role } = await staffRequest(request, signal);
      const parsed = editAccount.safeParse(await body(request));
      if (!parsed.success) throw new StaffRequestError("Check the assigned role and account.");
      const input = parsed.data;
      if (role !== "owner" && input.role === "admin") throw new StaffRequestError("Only the owner can assign administrator access.", 403);
      const changed = await db.rpc("set_staff_access", { target_user_id: input.user_id, assigned_role: input.role, enabled: input.active }).abortSignal(signal);
      staffDataError(changed.error);
      return { user_id: changed.data };
    });
    return Response.json(result, { headers });
  } catch (error) { return failure(error); }
}
