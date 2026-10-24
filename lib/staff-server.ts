import { publicSupabase } from "./server";
import { canManageStaff, type StaffRole } from "./staff";

export class StaffRequestError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export async function staffRequest(request: Request, signal: AbortSignal) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new StaffRequestError("Invalid origin.", 403);
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) throw new StaffRequestError("Sign in again before managing staff.", 401);
  const db = publicSupabase(token);
  if (!db) throw new StaffRequestError("Online accounts are not connected yet.", 503);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new StaffRequestError("Sign in again before managing staff.", 401);
  const membership = await db.from("team_members").select("role").eq("user_id", data.user.id).abortSignal(signal).maybeSingle();
  if (membership.error) throw new StaffRequestError("Couldn’t verify staff permissions. Reconnect and try again.", 503);
  const role = membership.data?.role;
  if (!canManageStaff(role)) throw new StaffRequestError("Owner or admin access required.", 403);
  return { db, user: data.user, role: role as StaffRole };
}
export function staffDataError(error: { code?: string } | null) {
  if (!error) return;
  if (["PGRST202", "42P01", "42883"].includes(error.code ?? "")) throw new StaffRequestError("Apply the staff access database migration before managing the team.", 503);
  if (error.code === "42501") throw new StaffRequestError("Your role cannot change this account. Refresh the team and check your permissions.", 403);
  if (error.code === "23514") throw new StaffRequestError("Use an allowed company or Gmail address and check the staff details.", 400);
  throw new StaffRequestError("Couldn’t update staff access. Refresh the team before trying again.", 409);
}
