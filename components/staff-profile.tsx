"use client";
import { PasswordInput } from "./password-input";
import { useEffect,useRef,useState,type FormEvent } from "react";
import { Camera,CheckCircle2,KeyRound,LoaderCircle,Save,X } from "lucide-react";
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
 const site=useSite(),{user,client,staffProfile,t,editorTask,accountTask,refreshStaffProfile,notice}=site;
 const dialog=useRef<HTMLDialogElement>(null),active=useRef(true);
 const [busy,setBusy]=useState(""),[error,setError]=useState(""),[photoToast,setPhotoToast]=useState(false);
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[photoChanged,setPhotoChanged]=useState(false),[photoFailed,setPhotoFailed]=useState(false);
 useEffect(()=>{active.current=true;dialog.current?.showModal();return()=>{active.current=false;dialog.current?.close();};},[]);
 async function upload(file:File){
  if(!user||busy)return;
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)||file.size>2097152){setPhotoFailed(true);setError(t("Choose a JPG, PNG, WebP or AVIF image up to 2 MB.","Chọn ảnh JPG, PNG, WebP hoặc AVIF tối đa 2 MB."));return;}
  const path=user.id+"/"+crypto.randomUUID()+"."+({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"}[file.type]);
  setBusy("photo");setPhotoFailed(false);setError("");setPhotoToast(false);
  try{
   await editorTask(async(db,signal)=>{
    const uploaded=await db.storage.from("staff-avatars").upload(path,file,{upsert:false,contentType:file.type,cacheControl:"31536000"});if(uploaded.error)throw uploaded.error;
    signal.throwIfAborted();
    const saved=await db.from("staff_profiles").upsert({user_id:user.id,avatar_path:path}).select("user_id").abortSignal(signal).single();if(saved.error)throw saved.error;
   });
   if(!active.current)return;
   setPhotoChanged(true);setPhotoToast(true);window.dispatchEvent(new Event("gary-staff-profile-changed"));await refreshStaffProfile().catch(()=>{});
  }catch{if(active.current){setPhotoFailed(true);setError(t("Couldn’t confirm the photo update. Reconnect and try again.","Chưa xác nhận được ảnh mới. Hãy kết nối lại rồi thử lại."));}}
  finally{if(active.current)setBusy("");}
 }
 async function saveChanges(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!user||busy||photoFailed)return;
  if(!password&&!confirm){notice(t(photoChanged?"Profile changes saved.":"Your profile is up to date.",photoChanged?"Đã lưu thay đổi hồ sơ.":"Hồ sơ của bạn đã được cập nhật."));close();return;}
  if(password.length<12||password!==confirm){setError(t("Use matching passwords of at least 12 characters.","Nhập mật khẩu trùng khớp, ít nhất 12 ký tự."));return;}
  setBusy("password");setError("");
  try{
   await accountTask((db,signal,id)=>setAccountPassword(db,id,password,signal));
   if(!active.current)return;setPassword("");setConfirm("");
   let acknowledged=false;
   try{const result=await editorTask((db,signal)=>db.rpc("acknowledge_staff_password_reminder").abortSignal(signal));acknowledged=!result.error;}catch{}
   if(!active.current)return;await refreshStaffProfile().catch(()=>{});if(!active.current)return;
   window.dispatchEvent(new Event("gary-team-access-changed"));
   notice(acknowledged?t("Profile changes saved. Your password has been updated.","Đã lưu thay đổi hồ sơ và cập nhật mật khẩu."):t("Your password was updated. Refresh to update the reminder.","Đã cập nhật mật khẩu. Hãy tải lại để cập nhật lời nhắc."));close();
  }catch{if(active.current)setError(t("Couldn’t confirm the password change. Reconnect and check your account before retrying.","Chưa xác nhận được mật khẩu mới. Hãy kết nối lại và kiểm tra tài khoản trước khi thử lại."));}
  finally{if(active.current)setBusy("");}
 }
 const photo=staffProfile?.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl:"";
 return <dialog ref={dialog} className="staff-profile-dialog" aria-modal="true" aria-labelledby="staff-profile-title" onCancel={event=>{event.preventDefault();if(!busy)close();}} onKeyDown={event=>{if(event.key==="Escape")event.stopPropagation();}}><header><div><div className="eyebrow">GARY HOME</div><h2 id="staff-profile-title">{t("Your staff profile","Hồ sơ nhân viên của bạn")}</h2></div><button className="icon-button" type="button" aria-label={t("Close profile","Đóng hồ sơ")} disabled={!!busy} onClick={close}><X/></button></header>
  <section className="staff-photo-editor"><span className="staff-profile-photo">{photo?<img src={photo} alt=""/>:<Camera size={29}/>}</span><div><strong>{staffProfile?.display_name||user?.email}</strong><p>{t("This photo syncs with your team account and linked listing profiles.","Ảnh này đồng bộ với tài khoản nhân viên và hồ sơ tin đăng được liên kết.")}</p><label className="upload-label">{busy==="photo"?<LoaderCircle className="spin" size={16}/>:<Camera size={16}/>} {t("Change profile photo","Đổi ảnh hồ sơ")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={!!busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value="";}}/></label><small>JPG · PNG · WebP · AVIF · 2 MB</small></div></section>
  {photoToast&&<div className="staff-profile-toast" role="status"><CheckCircle2 size={18}/><span>{t("Profile photo updated. Linked listing profiles use this photo too.","Đã cập nhật ảnh hồ sơ. Hồ sơ tin đăng được liên kết cũng sử dụng ảnh này.")}</span><button type="button" aria-label={t("Dismiss notification","Đóng thông báo")} onClick={()=>setPhotoToast(false)}><X size={15}/></button></div>}
  <form className="enquiry-form staff-password-form" onSubmit={saveChanges}><h3>{t("Change password","Đổi mật khẩu")}</h3><p className="small muted" id="staff-password-help">{t("Leave both fields blank to keep your current password.","Để trống cả hai ô nếu bạn muốn giữ mật khẩu hiện tại.")}</p><label>{t("New password","Mật khẩu mới")}<PasswordInput inputProps={{"name":"password","aria-describedby":"staff-password-help","autoComplete":"new-password","minLength":12,"maxLength":128,"value":password,"disabled":!!busy,"onChange":event=>setPassword(event.target.value)}}/></label><label>{t("Confirm password","Xác nhận mật khẩu")}<input name="confirm_password" type="password" aria-describedby="staff-password-help" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} disabled={!!busy} onChange={event=>setConfirm(event.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button" disabled={!!busy||photoFailed}>{busy==="password"?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} {t("Save changes","Lưu thay đổi")}</button></form>
 </dialog>;
}
