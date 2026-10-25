export type StaffRole = "owner" | "admin" | "manager" | "editor";
export type StaffAccount = {
  user_id: string; email: string; display_name: string; role: StaffRole;
  active: boolean; confirmed: boolean; created_at: string; updated_at: string; avatar_path?:string; password_change_reminder?:boolean;
};
export function isStaffRole(role: unknown): role is StaffRole {
  return role === "owner" || role === "admin" || role === "manager" || role === "editor";
}
export const staffRank=(role:unknown)=>role==="owner"?4:role==="admin"?3:role==="manager"?2:role==="editor"?1:0;
export function assignableRoles(role:unknown):Exclude<StaffRole,"owner">[]{return (["admin","manager","editor"] as const).filter(target=>staffRank(target)<staffRank(role));}
export function canManageStaff(role: unknown) { return staffRank(role)>=2; }
export function canManageRole(actor:unknown,target:unknown){return staffRank(target)>0&&staffRank(target)<staffRank(actor);}
export function canDeleteContent(role: unknown) { return role === "owner" || role === "admin"; }

export function canReorderProperties(role:unknown){return role==="owner"||role==="admin"||role==="manager";}

export type StaffProfile={user_id:string;display_name:string;avatar_path:string;updated_at:string|null;password_change_reminder:boolean};
