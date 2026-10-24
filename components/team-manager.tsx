"use client";
import { SelectField } from "./select-field";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle, MailPlus, RefreshCw, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { DeleteConfirmation } from "./delete-confirmation";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { fetchWithDeadline, request } from "@/lib/requests";
import { canManageStaff, type StaffAccount } from "@/lib/staff";

export type TeamDraft = { full_name: string; email: string; role: "admin" | "manager" | "editor" };
export const emptyTeamDraft = (): TeamDraft => ({ full_name: "", email: "", role: "editor" });
type Directory = { members: StaffAccount[]; next: string | null; domains: string[]; invitationsEnabled: boolean };

export function TeamManager({ draft, setDraft }: { draft: TeamDraft; setDraft: (draft: TeamDraft) => void }) {
  const { client, user, staffRole, sessionPhase, editorTask, notice } = useSite(), text = useStudioText();
  const [members, setMembers] = useState<StaffAccount[]>([]), [next, setNext] = useState<string | null>(null);
  const [domains, setDomains] = useState<string[]>([]), [invitationsEnabled, setInvitationsEnabled] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [removing,setRemoving]=useState<StaffAccount|null>(null);
  const active = useRef(true), identity = useRef(user?.id), sequence = useRef(0), version = useRef(0);
  useEffect(() => { identity.current = user?.id; }, [user?.id]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const call = useCallback(async (method: string, signal: AbortSignal, input?: unknown, cursor?: string | null) => {
    if (!client || !user) throw new Error("Sign in again before managing staff.");
    const { data, error } = await client.auth.getSession();
    if (error || data.session?.user.id !== user.id || identity.current !== user.id) throw new Error("Your account changed. Sign in again before continuing.");
    signal.throwIfAborted();
    const response = await fetchWithDeadline((method==="RESET"?"/api/admin/team/reset-password":"/api/admin/team") + (cursor ? "?after=" + encodeURIComponent(cursor) : ""), {
      method:method==="RESET"?"POST":method, cache: "no-store", signal,
      headers: { Authorization: "Bearer " + data.session.access_token, ...(input ? { "Content-Type": "application/json" } : {}) },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Couldn’t load the team. Reconnect and try again.");
    return result;
  }, [client, user]);
  const load = useCallback(async (cursor?: string | null) => {
    const read = ++sequence.current, startedVersion = version.current, userId = user?.id;
    setLoading(true);
    try {
      const directory = await request(signal => call("GET", signal, undefined, cursor)) as Directory;
      if (!active.current || identity.current !== userId || read !== sequence.current || startedVersion !== version.current) return;
      setMembers(previous => cursor ? [...new Map([...previous, ...directory.members].map(member => [member.user_id, member])).values()] : directory.members);
      setNext(directory.next); setDomains(directory.domains); setInvitationsEnabled(directory.invitationsEnabled); setError("");
    } catch (error) { if (active.current && identity.current === userId && read === sequence.current) setError(error instanceof Error ? error.message : "Couldn’t load the team. Reconnect and try again."); }
    finally { if (active.current && read === sequence.current) setLoading(false); }
  }, [call, user?.id]);
  useEffect(() => {
    let cancelled = false;
    if (sessionPhase === "ready") queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [sessionPhase, load]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (!domains.includes(draft.email.trim().toLowerCase().split("@")[1])) { setError("Use an allowed company or Gmail address."); return; }
    setBusy("invite"); setError(""); version.current++;
    try {
      const result = await editorTask((_db, signal) => call("POST", signal, { ...draft, role: draft.role })) as { invited: boolean };
      if (!active.current) return;
      setDraft(emptyTeamDraft()); notice(text(result.invited ? "Staff invitation sent. The team member can confirm their email and choose a password." : "Staff access assigned to the existing staff account. They can sign in to Studio."));
      await load();
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "Couldn’t create the staff account. Refresh before trying again."); }
    finally { if (active.current) setBusy(""); }
  }
  async function update(member: StaffAccount, role: "admin" | "manager" | "editor", enabled: boolean) {
    if (busy) return;
    setBusy(member.user_id); setError(""); version.current++;
    try {
      await editorTask((_db, signal) => call("PATCH", signal, { user_id: member.user_id, role, active: enabled }));
      if (!active.current) return;
      notice(text(enabled ? "Staff access updated." : "Staff access disabled. Customer information has been preserved."));
      await load();
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : "Couldn’t update staff access. Refresh before trying again."); }
    finally { if (active.current) setBusy(""); }
  }
  async function remove(){
    if(!removing||busy)return;const member=removing,actor=user?.id;
    setBusy("delete:"+member.user_id);setError("");version.current++;
    try{
      await editorTask((_db,signal)=>call("DELETE",signal,{user_id:member.user_id}));
      if(!active.current||identity.current!==actor)return;
      setMembers(rows=>rows.filter(row=>row.user_id!==member.user_id));setRemoving(null);notice(text("Staff access deleted. The customer account and history are preserved."));await load();
    }catch(error){if(active.current&&identity.current===actor)setError(error instanceof Error?error.message:"Couldn’t confirm deletion. Refresh before trying again.");}
    finally{if(active.current&&identity.current===actor)setBusy("");}
  }
  async function resetPassword(member:StaffAccount){
    if(busy)return;const actor=user?.id;setBusy("reset:"+member.user_id);setError("");
    try{await editorTask((_db,signal)=>call("RESET",signal,{user_id:member.user_id}));if(active.current&&identity.current===actor)notice(text("Password reset email requested. The team member should open the latest email link."));}
    catch(error){if(active.current&&identity.current===actor)setError(error instanceof Error?error.message:"Couldn’t confirm the reset request. Refresh before trying again.");}
    finally{if(active.current&&identity.current===actor)setBusy("");}
  }
  if (!canManageStaff(staffRole)) return null;
  return <div className="team-manager">
    <div className="team-access-summary"><ShieldCheck size={22}/><div><h2>{text("A trusted team. Clearly assigned access.")}</h2><p>{domains.length ? text("Allowed staff email") + ": " + domains.map(domain => "@" + domain).join(" · ") : text("Loading staff account settings…")}</p><p>{text("A company or Gmail address needs an owner or admin assignment before it can access Studio.")}</p></div><button className="button button-outline button-small" type="button" disabled={loading || !!busy} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""}/>{text("Refresh")}</button></div>
    {error && <div className="form-error" role="alert">{text(error)}</div>}
    <div className="team-management-grid"><form className="admin-panel enquiry-form team-invite-form" onSubmit={create}>
      <div className="eyebrow">{text("INVITATION ONLY")}</div><h2>{text("Add a team member")}</h2><p>{text("Assign an approved company or Gmail address. New staff receive an invitation to confirm their email and choose a password.")}</p>
      <label>{text("Full name")}<input name="full_name" autoComplete="off" value={draft.full_name} onChange={event => setDraft({ ...draft, full_name: event.target.value })} required minLength={2} maxLength={120} disabled={!!busy}/></label>
      <label>{text("Staff email")}<input name="email" type="email" autoComplete="off" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} required maxLength={254} disabled={!!busy} placeholder={domains.length ? "name@" + domains[0] : ""}/></label>
      <label>{text("Assigned role")}<SelectField value={draft.role} disabled={!!busy} onValueChange={value => setDraft({ ...draft, role: value as TeamDraft["role"] })}><option value="editor">{text("Staff · properties and customers")}</option><option value="manager">{text("Manager · also arranges cards")}</option>{staffRole === "owner" && <option value="admin">{text("Administrator · also manages staff")}</option>}</SelectField></label>
      <p className="small muted">{staffRole === "owner" ? text("Administrators can manage staff. Only owners can appoint or change administrators.") : text("You can assign staff access. Administrator accounts are managed by the owner.")}</p>
      {!invitationsEnabled && domains.length > 0 && <p className="form-info">{text("New invitations need server configuration. Existing staff accounts can still be assigned.")}</p>}
      <button className="button" disabled={!!busy || !domains.length || sessionPhase !== "ready"}>{busy === "invite" ? <LoaderCircle size={17} className="spin"/> : <MailPlus size={17}/>} {text(busy === "invite" ? "Creating account…" : "Create / assign account")}</button>
    </form><section className="admin-panel team-directory" aria-label={text("Team directory")}><header><div><h2>{text("Your team")}</h2><p>{text("Manage staff access while preserving customer accounts and history.")}</p></div>{loading && <LoaderCircle size={18} className="spin"/>}</header>
      {!members.length && !loading && <p className="team-empty">{text("No team members loaded. Refresh the directory to try again.")}</p>}
      {members.map(member => {
        const canReset=member.user_id===user?.id||(member.role!=="owner"&&(staffRole==="owner"||member.role!=="admin"));
        const protectedAccount = member.role === "owner" || member.user_id === user?.id || staffRole !== "owner" && member.role === "admin";
        return <article className="team-member" key={member.user_id}><span className="team-avatar"><UserRound size={21}/></span><div className="team-member-details"><strong>{member.display_name || member.email}</strong><span>{member.email}</span><div><span className={member.active ? "team-state active" : "team-state"}>{text(!member.active ? "Access disabled" : member.confirmed ? "Active" : "Email confirmation pending")}</span><small>{text(member.role === "owner" ? "Owner" : member.role === "admin" ? "Administrator" : member.role === "manager" ? "Manager" : "Staff")}</small></div>{canReset&&<button type="button" className="text-link team-reset-action" disabled={!!busy||!member.confirmed||!member.active} onClick={()=>void resetPassword(member)}>{busy==="reset:"+member.user_id?text("Requesting reset…"):text("Reset password")}</button>}</div>
          {protectedAccount ? <span className="team-protected"><Check size={13}/>{text(member.user_id === user?.id ? "Your account" : "Protected account")}</span>
            : <div className="team-member-actions"><SelectField aria-label={text("Assigned role") + " · " + member.email} value={member.role} disabled={!!busy} onValueChange={value => void update(member, value as "admin" | "manager" | "editor", member.active)}><option value="editor">{text("Staff")}</option><option value="manager">{text("Manager")}</option>{staffRole === "owner" && <option value="admin">{text("Administrator")}</option>}</SelectField><button type="button" className="text-link" disabled={!!busy} onClick={() => void update(member, member.role as "admin" | "manager" | "editor", !member.active)}>{busy === member.user_id ? <LoaderCircle size={14} className="spin"/> : text(member.active ? "Disable access" : "Restore access")}</button><button type="button" className="text-link text-danger" disabled={!!busy} onClick={()=>{setError("");setRemoving(member);}}><Trash2 size={14}/>{text("Delete access")}</button></div>}
        </article>;
      })}
      {next && <button type="button" className="button button-outline button-small" disabled={loading || !!busy} onClick={() => void load(next)}>{text("Load more")}</button>}
    </section></div>
    {removing&&<DeleteConfirmation title={text("Delete staff access?")} target={removing.display_name+" · "+removing.email} description={text("This removes the staff assignment. The person’s customer account and customer history are preserved.")} busy={!!busy} error={error?text(error):""} onCancel={()=>{setRemoving(null);setError("");}} onConfirm={()=>void remove()} confirmLabel={text("Delete access")}/>}
  </div>;
}
