"use client";
import { AnimatePresence } from "motion/react";
import { EditorModal } from "./editor-modal";
import { HeaderAccountMenu } from "./header-account-menu";
import { PasswordInput } from "./password-input";
import { useEffect,useRef,useState,type FormEvent } from "react";
import { Camera,KeyRound,LoaderCircle,Save } from "lucide-react";
import { useSite } from "./site-context";
import { setAccountPassword } from "@/lib/password-actions";
import { avatarPhoto, imageOptimizationErrorText, optimizeImage } from "@/lib/image-optimization.mjs";

export function StaffAccountMenu({ onDashboard, onSignedOut }: { onDashboard: () => void; onSignedOut: () => void }){
 const {editor,sessionResolved,sessionPhase}=useSite(),[open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 const canOpenProfile = editor && sessionResolved && sessionPhase === "ready";
 useEffect(()=>{
  const show=()=>{if(canOpenProfile)setOpen(true);};
  window.addEventListener("gary-open-staff-profile",show);
  return()=>window.removeEventListener("gary-open-staff-profile",show);
 },[canOpenProfile]);
 return <>
  <HeaderAccountMenu staffActions={{ dashboard: onDashboard, profile: () => { if(canOpenProfile)setOpen(true); }, signedOut: onSignedOut, trigger: button }}/>
  <AnimatePresence initial={false} onExitComplete={()=>button.current?.focus({preventScroll:true})}>{open&&editor&&<StaffProfileDialog close={()=>setOpen(false)}/>}</AnimatePresence>
 </>;
}
export function StaffPasswordReminder(){
 const {staffProfile,t}=useSite();
 if(!staffProfile?.password_change_reminder)return null;
 return <div className="staff-password-reminder" role="status"><KeyRound size={18}/><span>{t("Please change your staff password after your first login.","Hãy đổi mật khẩu nhân viên sau lần đăng nhập đầu tiên.")}</span><button type="button" className="text-link" onClick={()=>window.dispatchEvent(new Event("gary-open-staff-profile"))}>{t("Change password","Đổi mật khẩu")}</button></div>;
}
function StaffProfileDialog({close}:{close:()=>void}){
 const site=useSite(),{user,client,staffProfile,t,language,editorTask,accountTask,refreshStaffProfile,notice}=site;
 const active=useRef(true);
 const [busy,setBusy]=useState(""),[error,setError]=useState("");
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[photoChanged,setPhotoChanged]=useState(false),[photoFailed,setPhotoFailed]=useState(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function upload(file:File){
  if(!user||busy)return;
  if(!["image/jpeg","image/png","image/webp","image/avif"].includes(file.type)||file.size>2097152){setPhotoFailed(true);setError(t("Choose a JPG, PNG, WebP or AVIF image up to 2 MB.","Chọn ảnh JPG, PNG, WebP hoặc AVIF tối đa 2 MB."));return;}
  setBusy("photo");setPhotoFailed(false);setError("");
  try{
   await editorTask(async(db,signal)=>{
    const photo=await optimizeImage(file,avatarPhoto,{signal,inputMax:2*1024*1024,stillOnly:true});
    signal.throwIfAborted();
    const path=user.id+"/"+crypto.randomUUID()+"."+photo.extension;
    const uploaded=await db.storage.from("staff-avatars").upload(path,photo.body,{upsert:false,contentType:photo.contentType,cacheControl:"31536000"});if(uploaded.error)throw uploaded.error;
    signal.throwIfAborted();
    const saved=await db.from("staff_profiles").upsert({user_id:user.id,avatar_path:path}).select("user_id").abortSignal(signal).single();if(saved.error)throw saved.error;
   });
   if(!active.current)return;
   setPhotoChanged(true);notice("Profile photo updated.");window.dispatchEvent(new Event("gary-staff-profile-changed"));await refreshStaffProfile().catch(()=>{});
  }catch(error){if(active.current){setPhotoFailed(true);setError(imageOptimizationErrorText(error,language)||t("Couldn’t confirm the photo update. Reconnect and try again.","Chưa xác nhận được ảnh mới. Hãy kết nối lại rồi thử lại."));}}
  finally{if(active.current)setBusy("");}
 }
 async function saveChanges(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!user||busy||photoFailed)return;
  if(!password&&!confirm){if(!photoChanged)notice(t("Your profile is up to date.","Hồ sơ của bạn đã được cập nhật."),"info");close();return;}
  if(password.length<12||password!==confirm){setError(t("Use matching passwords of at least 12 characters.","Nhập mật khẩu trùng khớp, ít nhất 12 ký tự."));return;}
  setBusy("password");setError("");
  try{
   await accountTask((db,signal,id)=>setAccountPassword(db,id,password,signal));
   if(!active.current)return;setPassword("");setConfirm("");
   notice(t("Your password has been updated.","Đã cập nhật mật khẩu."));
   let acknowledged=false;
   try{const result=await editorTask((db,signal)=>db.rpc("acknowledge_staff_password_reminder").abortSignal(signal));acknowledged=!result.error;}catch{}
   if(!active.current)return;
   if(!acknowledged)notice(t("Refresh to update the password reminder.","Hãy tải lại để cập nhật lời nhắc đổi mật khẩu."),"warning");
   await refreshStaffProfile().catch(()=>{});if(!active.current)return;
   window.dispatchEvent(new Event("gary-team-access-changed"));
   close();
  }catch{if(active.current)setError(t("Couldn’t confirm the password change. Reconnect and check your account before retrying.","Chưa xác nhận được mật khẩu mới. Hãy kết nối lại và kiểm tra tài khoản trước khi thử lại."));}
  finally{if(active.current)setBusy("");}
 }
 const photo=staffProfile?.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl:"";
 return <EditorModal workspaceKey="staff-profile" contentClassName="staff-profile-workspace" closeDisabled={!!busy} title={t("Your staff profile","Hồ sơ nhân viên của bạn")} subtitle="GARY HOME" close={close}>
  <section className="staff-photo-editor"><span className="staff-profile-photo">{photo?<img src={photo} alt=""/>:<Camera size={29}/>}</span><div><strong>{staffProfile?.display_name||user?.email}</strong><p>{t("This photo syncs with your team account and linked listing profiles.","Ảnh này đồng bộ với tài khoản nhân viên và hồ sơ tin đăng được liên kết.")}</p><label className="upload-label">{busy==="photo"?<LoaderCircle className="spin" size={16}/>:<Camera size={16}/>} {t("Change profile photo","Đổi ảnh hồ sơ")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={!!busy} onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value="";}}/></label><small>JPG · PNG · WebP · AVIF · 2 MB</small></div></section>
  <form className="enquiry-form staff-password-form" onSubmit={saveChanges}><h3>{t("Change password","Đổi mật khẩu")}</h3><p className="small muted" id="staff-password-help">{t("Leave both fields blank to keep your current password.","Để trống cả hai ô nếu bạn muốn giữ mật khẩu hiện tại.")}</p><label>{t("New password","Mật khẩu mới")}<PasswordInput inputProps={{"name":"password","aria-describedby":"staff-password-help","autoComplete":"new-password","minLength":12,"maxLength":128,"value":password,"disabled":!!busy,"onChange":event=>setPassword(event.target.value)}}/></label><label>{t("Confirm password","Xác nhận mật khẩu")}<input name="confirm_password" type="password" aria-describedby="staff-password-help" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} disabled={!!busy} onChange={event=>setConfirm(event.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<footer className="gw-editor-actions"><button data-button-variant="cancel" type="button" className="button button-outline" disabled={!!busy} onClick={close}>{t("Cancel","Hủy")}</button><button data-button-variant="save" className="button" disabled={!!busy||photoFailed}>{busy==="password"?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} {t("Save changes","Lưu thay đổi")}</button></footer></form>
 </EditorModal>;
}
