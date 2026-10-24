export type StaffRole = "owner" | "admin" | "manager" | "editor";
export type StaffAccount = {
  user_id: string; email: string; display_name: string; role: StaffRole;
  active: boolean; confirmed: boolean; created_at: string; updated_at: string;
};
export function isStaffRole(role: unknown): role is StaffRole {
  return role === "owner" || role === "admin" || role === "manager" || role === "editor";
}
export function canManageStaff(role: unknown) { return role === "owner" || role === "admin"; }
export function canDeleteContent(role: unknown) { return role === "owner" || role === "admin"; }

export function canReorderProperties(role:unknown){return role==="owner"||role==="admin"||role==="manager";}
