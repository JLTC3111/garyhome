"use client";
import { useEffect,useRef,useState,type FormEvent } from "react";
import { Camera,KeyRound,LoaderCircle,Save,X } from "lucide-react";
import { useSite } from "./site-context";
import { setAccountPassword } from "@/lib/password-actions";

export function StaffProfileButton(){
 const {user,client,staffProfile,t}=useSite(),[open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const show=()=>setOpen(true);window.addEventListener("gary-open-staff-profile",show);return()=>window.removeEventListener("gary-open-staff-profile",show);},[]);
 const photo=staffProfile?.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl:"";
 return <><button ref={button} className="avatar staff-profile-trigger" type="button" aria-label={t("Edit staff profile","Chỉnh sửa hồ sơ nhân viên")} title={t("Change profile photo or password","Đổi ảnh hồ sơ hoặc mật khẩu")} onClick={()=>setOpen(true)}>{photo?<img src={photo} alt=""/>:user?.email?.[0]?.toUpperCase()}<Camera size={11}/></button>{open&&<StaffProfileDialog close={()=>{setOpen(false);button.current?.focus();}}/>}</>;
}
export function StaffPasswordReminder(){
 const {staffProfile,t}=useSite();
 if(!staffProfile?.password_change_reminder)return null;
 return <div className="staff-password-reminder" role="status"><KeyRound size={18}/><span>{t("Please change your staff password after your first login.","Hãy đổi mật khẩu nhân viên sau lần đăng nhập đầu tiên.")}</span><button type="button" className="text-link" onClick={()=>window.dispatchEvent(new Event("gary-open-staff-profile"))}>{t("Change password","Đổi mật khẩu")}</button></div>;
}
function StaffProfileDialog({close}:{close:()=>void}){
 const site=useSite(),{user,client,staffProfile,t,editorTask,accountTask,refreshStaffProfile}=site;
 const dialog=useRef<HTMLDialogElement>(null),active=useRef(true);
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState("");
 useEffect(()=>{active.current=true;dialog.current?.showModal();return()=>{active.current=false;dialog.current?.close();};},[]);
 async function upload(file:File){
  if(!user||busy)return;
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)||file.size>2097152){setError(t("Choose a JPG, PNG, WebP or AVIF image up to 2 MB.","Chọn ảnh JPG, PNG, WebP hoặc AVIF tối đa 2 MB."));return;}
  const path=user.id+"/"+crypto.randomUUID()+"."+({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"}[file.type]);
  setBusy("photo");setError("");setMessage("");
  try{
   await editorTask(async(db,signal)=>{
    const uploaded=await db.storage.from("staff-avatars").upload(path,file,{upsert:false,contentType:file.type,cacheControl:"31536000"});if(uploaded.error)throw uploaded.error;
    signal.throwIfAborted();
    const saved=await db.from("staff_profiles").upsert({user_id:user.id,avatar_path:path}).select("user_id").abortSignal(signal).single();if(saved.error)throw saved.error;
   });
   if(!active.current)return;
   await refreshStaffProfile();window.dispatchEvent(new Event("gary-staff-profile-changed"));setMessage(t("Photo saved. Linked listing profiles use this photo too.","Đã lưu ảnh. Hồ sơ tin đăng được liên kết cũng sử dụng ảnh này."));
  }catch{if(active.current)setError(t("Couldn’t confirm the photo update. Reconnect and try again.","Chưa xác nhận được ảnh mới. Hãy kết nối lại rồi thử lại."));}
  finally{if(active.current)setBusy("");}
 }
 async function changePassword(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!user||busy)return;
  if(password.length<12||password!==confirm){setError(t("Use matching passwords of at least 12 characters.","Nhập mật khẩu trùng khớp, ít nhất 12 ký tự."));return;}
  setBusy("password");setError("");setMessage("");
  try{
   await accountTask((db,signal,id)=>setAccountPassword(db,id,password,signal));
   if(!active.current)return;setPassword("");setConfirm("");
   const acknowledged=await editorTask((db,signal)=>db.rpc("acknowledge_staff_password_reminder").abortSignal(signal));
   if(acknowledged.error){setMessage(t("Password saved. Refresh to update the reminder.","Đã lưu mật khẩu. Hãy tải lại để cập nhật lời nhắc."));return;}
   await refreshStaffProfile();window.dispatchEvent(new Event("gary-team-access-changed"));setMessage(t("Your password has been changed.","Mật khẩu đã được thay đổi."));
  }catch{if(active.current)setError(t("Couldn’t confirm the password change. Reconnect and check your account before retrying.","Chưa xác nhận được mật khẩu mới. Hãy kết nối lại và kiểm tra tài khoản trước khi thử lại."));}
  finally{if(active.current)setBusy("");}
 }
 const photo=staffProfile?.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl:"";
 return <dialog ref={dialog} className="staff-profile-dialog" aria-modal="true" aria-labelledby="staff-profile-title" onCancel={event=>{event.preventDefault();if(!busy)close();}} onKeyDown={event=>{if(event.key==="Escape")event.stopPropagation();}}><header><div><div className="eyebrow">GARY HOME</div><h2 id="staff-profile-title">{t("Your staff profile","Hồ sơ nhân viên của bạn")}</h2></div><button className="icon-button" type="button" aria-label={t("Close profile","Đóng hồ sơ")} disabled={!!busy} onClick={close}><X/></button></header>
  <section className="staff-photo-editor"><span className="staff-profile-photo">{photo?<img src={photo} alt=""/>:<Camera size={29}/>}</span><div><strong>{staffProfile?.display_name||user?.email}</strong><p>{t("This photo syncs with your team account and linked listing profiles.","Ảnh này đồng bộ với tài khoản nhân viên và hồ sơ tin đăng được liên kết.")}</p><label className="upload-label">{busy==="photo"?<LoaderCircle className="spin" size={16}/>:<Camera size={16}/>} {t("Change profile photo","Đổi ảnh hồ sơ")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={!!busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value="";}}/></label><small>JPG · PNG · WebP · AVIF · 2 MB</small></div></section>
  <form className="enquiry-form staff-password-form" onSubmit={changePassword}><h3>{t("Change password","Đổi mật khẩu")}</h3><label>{t("New password","Mật khẩu mới")}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} disabled={!!busy} onChange={event=>setPassword(event.target.value)}/></label><label>{t("Confirm password","Xác nhận mật khẩu")}<input name="confirm_password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} disabled={!!busy} onChange={event=>setConfirm(event.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="form-info" role="status">{message}</p>}<button className="button" disabled={!!busy}>{busy==="password"?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} {t("Save password","Lưu mật khẩu")}</button></form>
 </dialog>;
}
