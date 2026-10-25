"use client";
import { useCallback,useEffect,useRef,useState,type FormEvent } from "react";
import { Check,KeyRound,LoaderCircle,RefreshCw,ShieldCheck,Trash2,UserPlus,UserRound } from "lucide-react";
import { SelectField } from "./select-field";
import { DeleteConfirmation } from "./delete-confirmation";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { fetchWithDeadline,request } from "@/lib/requests";
import { assignableRoles,canDeleteContent,canManageRole,canManageStaff,type StaffAccount } from "@/lib/staff";

export type TeamDraft={full_name:string;email:string;role:"admin"|"manager"|"editor";mode?:"create"|"assign"};
export const emptyTeamDraft=():TeamDraft=>({full_name:"",email:"",role:"editor",mode:"create"});
type Directory={members:StaffAccount[];next:string|null;domains:string[];directCreationEnabled:boolean};
export function TeamManager({draft,setDraft}:{draft:TeamDraft;setDraft:(draft:TeamDraft)=>void}){
 const {client,user,staffRole,sessionPhase,editorTask,notice}=useSite(),text=useStudioText();
 const [members,setMembers]=useState<StaffAccount[]>([]),[next,setNext]=useState<string|null>(null),[domains,setDomains]=useState<string[]>([]),[enabled,setEnabled]=useState(false);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(""),[error,setError]=useState(""),[result,setResult]=useState("");
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState("");
 const [removing,setRemoving]=useState<StaffAccount|null>(null);
 const active=useRef(true),identity=useRef(user?.id),sequence=useRef(0),version=useRef(0);
 const roles=assignableRoles(staffRole),mode=draft.mode||"create";
 useEffect(()=>{identity.current=user?.id;},[user?.id]);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{if(!roles.includes(draft.role)&&roles.length)setDraft({...draft,role:roles[0]});},[staffRole,draft,setDraft]);
 const call=useCallback(async(method:string,signal:AbortSignal,input?:unknown,cursor?:string|null):Promise<unknown>=>{
  if(!client||!user)throw new Error("Sign in again before managing staff.");
  const {data,error}=await client.auth.getSession();
  if(error||data.session?.user.id!==user.id||identity.current!==user.id)throw new Error("Your account changed. Sign in again before continuing.");
  signal.throwIfAborted();
  const response=await fetchWithDeadline((method==="RESET"?"/api/admin/team/reset-password":"/api/admin/team")+(cursor?"?after="+encodeURIComponent(cursor):""),{method:method==="RESET"?"POST":method,cache:"no-store",signal,headers:{Authorization:"Bearer "+data.session.access_token,...(input?{"Content-Type":"application/json"}:{})},...(input?{body:JSON.stringify(input)}:{})});
  const body=await response.json() as {error?:string};if(!response.ok)throw new Error(body.error||"Couldn’t load the team. Reconnect and try again.");return body;
 },[client,user]);
 const load=useCallback(async(cursor?:string|null)=>{
  const read=++sequence.current,started=version.current,actor=user?.id;setLoading(true);
  try{const data=await request(signal=>call("GET",signal,undefined,cursor)) as Directory;
   if(!active.current||identity.current!==actor||read!==sequence.current||started!==version.current)return;
   setMembers(previous=>cursor?[...new Map([...previous,...data.members].map(m=>[m.user_id,m])).values()]:data.members);setNext(data.next);setDomains(data.domains);setEnabled(data.directCreationEnabled);setError("");
  }catch(error){if(active.current&&identity.current===actor&&read===sequence.current)setError(error instanceof Error?error.message:"Couldn’t load the team. Reconnect and try again.");}
  finally{if(active.current&&read===sequence.current)setLoading(false);}
 },[call,user?.id]);
 useEffect(()=>{let cancelled=false;if(sessionPhase==="ready")queueMicrotask(()=>{if(!cancelled)void load();});return()=>{cancelled=true;};},[sessionPhase,load]);
 useEffect(()=>{const refresh=()=>{if(sessionPhase==="ready"&&!busy)void load();};window.addEventListener("gary-staff-directory-changed",refresh);return()=>window.removeEventListener("gary-staff-directory-changed",refresh);},[load,sessionPhase,busy]);
 const changed=()=>window.dispatchEvent(new Event("gary-team-access-changed"));
 async function create(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  if(!domains.includes(draft.email.trim().toLowerCase().split("@")[1])){setError("Use an allowed company or Gmail address.");return;}
  if(mode==="create"&&(password.length<12||password!==confirm)){setError("Use matching passwords of at least 12 characters.");return;}
  setBusy("create");setError("");setResult("");version.current++;
  try{const data=await editorTask((_db,signal)=>call("POST",signal,{...draft,mode,...(mode==="create"?{password,confirm_password:confirm}:{})})) as {created:boolean};
   if(!active.current)return;setDraft(emptyTeamDraft());setPassword("");setConfirm("");
   const message=data.created?"Staff account created and confirmed. Share the temporary password securely; a change-password reminder appears after login.":"Staff access assigned and email confirmed. The existing login password is unchanged.";
   setResult(message);notice(text(message));changed();await load();
  }catch(error){if(active.current)setError(error instanceof Error?error.message:"Couldn’t create the staff account. Refresh before trying again.");}
  finally{if(active.current)setBusy("");}
 }
 async function update(member:StaffAccount,role:"admin"|"manager"|"editor",activeValue:boolean){
  if(busy)return;setBusy(member.user_id);setError("");version.current++;
  try{await editorTask((_db,signal)=>call("PATCH",signal,{user_id:member.user_id,role,active:activeValue}));if(!active.current)return;notice(text(activeValue?"Staff access updated.":"Staff access disabled. Customer information has been preserved."));changed();await load();}
  catch(error){if(active.current)setError(error instanceof Error?error.message:"Couldn’t update staff access. Refresh before trying again.");}finally{if(active.current)setBusy("");}
 }
 async function remove(){
  if(!removing||busy)return;const target=removing,actor=user?.id;setBusy("delete:"+target.user_id);setError("");version.current++;
  try{await editorTask((_db,signal)=>call("DELETE",signal,{user_id:target.user_id}));if(!active.current||identity.current!==actor)return;setMembers(rows=>rows.filter(m=>m.user_id!==target.user_id));setRemoving(null);notice(text("Staff access deleted. The customer account and history are preserved."));changed();await load();}
  catch(error){if(active.current&&identity.current===actor)setError(error instanceof Error?error.message:"Couldn’t confirm deletion. Refresh before trying again.");}finally{if(active.current&&identity.current===actor)setBusy("");}
 }
 async function resetPassword(member:StaffAccount){
  if(busy)return;const actor=user?.id;setBusy("reset:"+member.user_id);setError("");
  try{await editorTask((_db,signal)=>call("RESET",signal,{user_id:member.user_id}));if(active.current&&identity.current===actor)notice(text("Password link requested. Ask the team member to check the newest email and spam folder."));}
  catch(error){if(active.current&&identity.current===actor)setError(error instanceof Error?error.message:"Couldn’t confirm the reset request. Refresh before trying again.");}finally{if(active.current&&identity.current===actor)setBusy("");}
 }
 if(!canManageStaff(staffRole))return null;
 const roleLabel=(role:string)=>text(role==="owner"?"Owner":role==="admin"?"Administrator":role==="manager"?"Manager":"Staff");
 return <div className="team-manager">
  <div className="team-access-summary"><ShieldCheck size={22}/><div><h2>{text("Team access")}</h2><p>{text("Allowed staff email")}: {domains.map(domain=>"@"+domain).join(" · ")}</p></div><button type="button" className="button button-outline button-small" disabled={loading||!!busy} onClick={()=>void load()}><RefreshCw size={15}/>{text("Refresh")}</button></div>
  {error&&<div className="form-error" role="alert">{text(error)}</div>}{result&&<div className="form-info" role="status">{text(result)}</div>}
  <div className="team-creation-grid"><form className="admin-panel enquiry-form team-invite-form" onSubmit={create}>
   <div className="eyebrow">{text("DIRECT ACCOUNT SETUP")}</div><h2>{text("Add a team member")}</h2>
   <div className="team-account-modes" role="group" aria-label={text("Account setup mode")}><button type="button" aria-pressed={mode==="create"} onClick={()=>{setDraft({...draft,mode:"create"});setPassword("");setConfirm("");}}>{text("Create new account")}</button><button type="button" aria-pressed={mode==="assign"} onClick={()=>{setDraft({...draft,mode:"assign"});setPassword("");setConfirm("");}}>{text("Assign existing login")}</button></div>
   <label>{text("Full name")}<input name="full_name" value={draft.full_name} onChange={event=>setDraft({...draft,full_name:event.target.value})} autoComplete="off" required minLength={2} maxLength={120} disabled={!!busy}/></label>
   <label>{text("Staff email")}<input name="email" type="email" value={draft.email} onChange={event=>setDraft({...draft,email:event.target.value})} autoComplete="off" required maxLength={254} disabled={!!busy}/></label>
   <label>{text("Assigned role")}<SelectField value={roles.includes(draft.role)?draft.role:roles[0]} disabled={!!busy} onValueChange={role=>setDraft({...draft,role:role as TeamDraft["role"]})}>{roles.map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}</SelectField></label>
   {mode==="create"?<><label>{text("Temporary password")}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} required disabled={!!busy} onChange={event=>setPassword(event.target.value)}/></label><label>{text("Confirm password")}<input name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} required disabled={!!busy} onChange={event=>setConfirm(event.target.value)}/></label><small>{text("Use at least 12 characters. Share the temporary password securely with the staff member.")}</small></>:<p className="form-info">{text("The existing password and customer history are preserved. No invitation email is required.")}</p>}
   {!enabled&&domains.length>0&&<p className="form-error">{text("Direct staff creation needs the server-only Supabase secret key. Ask the owner to configure it in Vercel.")}</p>}
   <button className="button" disabled={!!busy||!enabled||!domains.length||sessionPhase!=="ready"}>{busy==="create"?<LoaderCircle className="spin" size={17}/>:<UserPlus size={17}/>} {text(busy==="create"?"Creating account…":mode==="create"?"Create confirmed staff account":"Assign staff access")}</button>
  </form><aside className="admin-panel team-permissions-guide"><ShieldCheck size={25}/><h2>{text("Who can create which roles?")}</h2><p>{text("Every role can create or assign roles at least one level below itself. Peer and higher roles are protected.")}</p><table><thead><tr><th>{text("Signed-in role")}</th><th>{text("Can create / assign")}</th></tr></thead><tbody><tr><th>{text("Owner")}</th><td>{text("Administrator, Manager, Staff")}</td></tr><tr><th>{text("Administrator")}</th><td>{text("Manager, Staff")}</td></tr><tr><th>{text("Manager")}</th><td>{text("Staff")}</td></tr><tr><th>{text("Staff")}</th><td>{text("No team access management")}</td></tr></tbody></table><h3>{text("Ready to sign in")}</h3><p>{text("New accounts are confirmed immediately and use the password you enter. Staff are reminded to change it after signing in.")}</p><h3>{text("Existing accounts")}</h3><p>{text("Choose Assign existing login to preserve the current password and customer history. The role rules still apply.")}</p><h3>{text("Protected access")}</h3><p>{text("You cannot edit your own role or a peer or higher role. Only owners and administrators can delete lower-level staff access.")}</p></aside></div>
  <section className="admin-panel team-directory" aria-label={text("Team directory")}><header><div><h2>{text("Your team")}</h2><p>{text("Manage lower-level accounts and preserve customer history.")}</p></div>{loading&&<LoaderCircle className="spin" size={18}/>}</header>
   {members.map(member=>{const manageable=member.user_id!==user?.id&&canManageRole(staffRole,member.role);const photo=member.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(member.avatar_path).data.publicUrl:"";
    return <article className="team-member" key={member.user_id}><span className="team-avatar">{photo?<img src={photo} alt=""/>:<UserRound size={21}/>}</span><div className="team-member-details"><strong>{member.display_name||member.email}</strong><span>{member.email}</span><div><span className={member.active?"team-state active":"team-state"}>{text(!member.active?"Access disabled":member.confirmed?"Active":"Email confirmation pending")}</span><small>{roleLabel(member.role)}</small></div>{(manageable||member.user_id===user?.id)&&<button className="text-link team-reset-action" type="button" disabled={!!busy||!member.active} onClick={()=>void resetPassword(member)}><KeyRound size={13}/>{text(busy==="reset:"+member.user_id?"Requesting reset…":"Send password link")}</button>}</div>
    {!manageable?<span className="team-protected"><Check size={13}/>{text(member.user_id===user?.id?"Your account":"Protected account")}</span>:<div className="team-member-actions"><SelectField aria-label={text("Assigned role")+" · "+member.email} value={member.role} disabled={!!busy} onValueChange={role=>void update(member,role as TeamDraft["role"],member.active)}>{roles.map(role=><option key={role} value={role}>{roleLabel(role)}</option>)}</SelectField><button type="button" className="text-link" disabled={!!busy} onClick={()=>void update(member,member.role as TeamDraft["role"],!member.active)}>{text(member.active?"Disable access":"Restore access")}</button>{canDeleteContent(staffRole)&&<button type="button" className="text-link text-danger" disabled={!!busy} onClick={()=>{setError("");setRemoving(member);}}><Trash2 size={14}/>{text("Delete access")}</button>}</div>}</article>;
   })}
   {!members.length&&!loading&&<p>{text("No team members loaded. Refresh the directory to try again.")}</p>}{next&&<button type="button" className="button button-outline" disabled={loading||!!busy} onClick={()=>void load(next)}>{text("Load more")}</button>}
  </section>
  {removing&&<DeleteConfirmation title={text("Delete staff access?")} target={removing.display_name+" · "+removing.email} description={text("This removes the staff assignment. The person’s customer account and customer history are preserved.")} busy={!!busy} error={error?text(error):""} onCancel={()=>{setRemoving(null);setError("");}} onConfirm={()=>void remove()} confirmLabel={text("Delete access")}/>}
 </div>;
}
