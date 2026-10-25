"use client";
import { useEffect,useId,useRef,useState,type FormEvent } from "react";
import { KeyRound,LoaderCircle,X } from "lucide-react";
import type { StaffAccount } from "@/lib/staff";
import { useStudioText } from "./use-studio-text";

export function StaffTemporaryPassword({member,busy,error,close,save}:{member:StaffAccount;busy:boolean;error:string;close:()=>void;save:(password:string,confirmation:string)=>Promise<void>}){
 const text=useStudioText(),dialog=useRef<HTMLDialogElement>(null),id=useId();
 const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[validation,setValidation]=useState("");
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>{dialog.current?.close();previous?.focus?.();};},[]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;
  if(password.length<12||password!==confirmation){setValidation("Use matching passwords of at least 12 characters.");return;}
  setValidation("");await save(password,confirmation);
 }
 return <dialog ref={dialog} className="staff-profile-dialog staff-temporary-password-dialog" aria-labelledby={id} aria-modal="true" onCancel={event=>{event.preventDefault();if(!busy)close();}} onKeyDown={event=>{if(event.key==="Escape")event.stopPropagation();}}>
  <header><div><div className="eyebrow">{text("EXISTING STAFF ACCOUNT")}</div><h2 id={id}>{text("Set temporary password")}</h2></div><button type="button" className="icon-button" aria-label={text("Close")} disabled={busy} onClick={close}><X size={20}/></button></header>
  <div className="temporary-password-target"><strong>{member.display_name||member.email}</strong><span>{member.email}</span></div>
  <p className="form-info">{text("This replaces this staff account’s current password. Its role and customer history stay unchanged. No email link is required.")}</p>
  <form className="enquiry-form staff-password-form" onSubmit={submit}>
   <label>{text("Temporary password")}<input name="temporary_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} required disabled={busy} onChange={event=>setPassword(event.target.value)}/></label>
   <label>{text("Confirm password")}<input name="confirm_temporary_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmation} required disabled={busy} onChange={event=>setConfirmation(event.target.value)}/></label>
   <p className="small muted">{text("They sign in at the regular Staff portal using this password, then change it in their profile. Share the password privately.")}</p>
   {(error||validation)&&<p className="form-error" role="alert">{text(error||validation)}</p>}
   <div className="temporary-password-actions"><button type="button" className="button button-outline" disabled={busy} onClick={close}>{text("Cancel")}</button><button className="button" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<KeyRound size={16}/>} {text(busy?"Saving…":"Replace password")}</button></div>
  </form>
 </dialog>;
}
