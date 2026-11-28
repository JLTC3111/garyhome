"use client";
import { AnimatePresence } from "motion/react";
import { EditorModal } from "./editor-modal";
import { HeaderAccountMenu } from "./header-account-menu";
import { PasswordInput } from "./password-input";
import { useEffect,useLayoutEffect,useRef,useState,type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Camera,KeyRound,LoaderCircle,Save } from "lucide-react";
import { useSite } from "./site-context";
import { setAccountPassword } from "@/lib/password-actions";
import { managedAvatarBucket, mountProfilePhoto, readAvatarReferences, saveProfilePhoto } from "@/lib/profile-photo-editor.mjs";
import { StaffAvatarImage } from "./staff-avatar-image";

const photoCopy: Record<string, [string,string]> = {
 avatarSquarePreview: ["Square crop preview", "Xem trước ảnh cắt vuông"],
 avatarZoomOut: ["Zoom out", "Thu nhỏ"],
 avatarZoomIn: ["Zoom in", "Phóng to"],
 avatarSaved: ["Profile photo updated.", "Đã cập nhật ảnh hồ sơ."],
 avatarRemoved: ["Profile photo removed.", "Đã gỡ ảnh hồ sơ."],
 avatarType: ["Choose a JPG, PNG, WebP or AVIF image.", "Chọn ảnh JPG, PNG, WebP hoặc AVIF."],
 avatarSize: ["Choose a picture up to 2 MB.", "Chọn ảnh tối đa 2 MB."],
 avatarPreviewError: ["This picture could not be opened.", "Không thể mở ảnh này."],
 avatarOutputError: ["Could not make an optimized WebP. Choose a different picture or browser.", "Không thể tạo ảnh WebP tối ưu. Hãy chọn ảnh khác hoặc đổi trình duyệt."],
 avatarLoadError: ["The current picture could not be checked. Try again.", "Chưa thể kiểm tra ảnh hiện tại. Vui lòng thử lại."],
 avatarConflict: ["The picture changed in another session. Review it and try again.", "Ảnh đã thay đổi trong phiên khác. Hãy xem ảnh rồi thử lại."],
 avatarSignIn: ["Sign in again to change your picture.", "Hãy đăng nhập lại để cập nhật ảnh."],
 avatarSetupNeeded: ["Picture uploads are unavailable.", "Chưa thể tải ảnh lên."],
 avatarSaveError: ["Couldn’t confirm the photo update. Reconnect and try again.", "Chưa xác nhận được ảnh mới. Hãy kết nối lại rồi thử lại."],
};

export function StaffAccountMenu({ onDashboard, onSignedOut, profileHost, mobile }: {
 onDashboard: () => void; onSignedOut: () => void; profileHost: HTMLDivElement | null; mobile: boolean;
}){
 const {editor,sessionResolved,sessionPhase,user}=useSite(),[open,setOpen]=useState(false);
 const button=useRef<HTMLButtonElement>(null);
 const canOpenProfile = editor && sessionResolved && sessionPhase === "ready";
 useEffect(()=>{
  const show=()=>{if(canOpenProfile)setOpen(true);};
  window.addEventListener("gary-open-staff-profile",show);
  return()=>window.removeEventListener("gary-open-staff-profile",show);
 },[canOpenProfile]);
 // A closed drawer is inert, including when the top bar opens a profile.
 const profile=<AnimatePresence initial={false} onExitComplete={()=>button.current?.focus({preventScroll:true})}>{open&&editor&&<StaffProfileDialog key={user?.id} close={()=>setOpen(false)}/>}</AnimatePresence>;
 return <>
  <HeaderAccountMenu staffActions={{ dashboard: onDashboard, profile: () => { if(canOpenProfile)setOpen(true); }, signedOut: onSignedOut, trigger: button, mobile }}/>
  {profileHost ? createPortal(profile,profileHost) : profile}
 </>;
}
export function StaffPasswordReminder(){
 const {staffProfile,t}=useSite();
 if(!staffProfile?.password_change_reminder)return null;
 return <div className="staff-password-reminder" role="status"><KeyRound size={18}/><span>{t("Please change your staff password after your first login.","Hãy đổi mật khẩu nhân viên sau lần đăng nhập đầu tiên.")}</span><button type="button" className="text-link" onClick={()=>window.dispatchEvent(new Event("gary-open-staff-profile"))}>{t("Change password","Đổi mật khẩu")}</button></div>;
}
function StaffProfileDialog({close}:{close:()=>void}){
 const { user,staffProfile,t,language,editorTask,accountTask,refreshStaffProfile,confirmStaffPhoto,notice }=useSite();
 const active=useRef(true),controls=useRef<HTMLDivElement>(null);
 const photoEditor=useRef<ReturnType<typeof mountProfilePhoto>|null>(null);
 const text=useRef(t);
 useLayoutEffect(()=>{text.current=t;},[t]);
 const [busy,setBusy]=useState(""),[error,setError]=useState("");
 const [password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[photoChanged,setPhotoChanged]=useState(false);
 const [preview,setPreview]=useState<{url:string;ref:{path:string|null}|null}>({url:"",ref:null});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{
  const id=user?.id;
  if(!id||!controls.current)return;
  let open=true;
  const translate=(key:string)=>text.current(...(photoCopy[key]||["",""]));
  const crop=mountProfilePhoto({
   root:controls.current,t:translate,maxInputBytes:2*1024*1024,allowAvif:true,
   read:(owner:string)=>editorTask(async(db,signal)=>{
    const [references,profile]=await Promise.all([
     readAvatarReferences(db,"home",[owner]),db.rpc("get_staff_profile").abortSignal(signal),
    ]);
    if(profile.error||profile.data?.user_id!==owner)throw new Error("Staff profile unavailable");
    const reference=references.get(owner);
    if(reference){
     if(!reference.path)return reference;
     const {data}=await db.storage.from(managedAvatarBucket("home")).download(reference.path);
     return {...reference,blob:data};
    }
    const path=profile.data.avatar_path||null;
    return {version:null,path,url:path?db.storage.from("staff-avatars").getPublicUrl(path).data.publicUrl:""};
   }),
   savePhoto:(owner:string,version:string|null,body:Blob|null)=>
    editorTask((db,signal)=>saveProfilePhoto(db,"home",owner,version,body,{signal})),
   onPhotoChange:(url:string,ref:{path:string|null}|null)=>{if(open)setPreview({url,ref});},
   onBusy:(pending:boolean)=>{if(open)setBusy(pending?"photo":"");},
   onCommit:(saved:{path:string|null})=>{
    if(!open)return;
    setPhotoChanged(true);
    confirmStaffPhoto(id,saved.path);
    window.dispatchEvent(new Event("gary-staff-profile-changed"));
   },
   notify:(key:string)=>{if(open)notice(translate(key));},
  });
  photoEditor.current=crop;
  void crop.load(id);
  return()=>{open=false;photoEditor.current=null;crop.destroy();};
 },[user?.id,editorTask,confirmStaffPhoto,notice]);
 useEffect(()=>{photoEditor.current?.setPaused(busy==="password");},[language,busy]);
 async function saveChanges(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!user||busy)return;
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
 return <EditorModal workspaceKey="staff-profile" contentClassName="staff-profile-workspace" closeDisabled={!!busy} title={t("Your staff profile","Hồ sơ nhân viên của bạn")} subtitle="GARY HOME" close={close}>
  <section className="staff-photo-editor">
   <span className="staff-profile-photo">
    {preview.url ? <img src={preview.url} alt="" onError={()=>setPreview(previous=>previous.url===preview.url?{...previous,url:""}:previous)}/> : preview.ref ? <Camera size={29}/>
     : <StaffAvatarImage path={staffProfile?.avatar_path} bucket={staffProfile?.avatar_bucket} fallback={<Camera size={29}/>}/>}
   </span>
   <div className="staff-photo-controls" ref={controls}>
    <strong>{staffProfile?.display_name||user?.email}</strong>
    <p>{t("This photo syncs with your team account and linked listing profiles.","Ảnh này đồng bộ với tài khoản nhân viên và hồ sơ tin đăng được liên kết.")}</p>
    <label className="upload-label" htmlFor="profile-avatar-file">{busy==="photo"?<LoaderCircle className="spin" size={16}/>:<Camera size={16}/>} {t("Choose profile photo","Chọn ảnh hồ sơ")}</label>
    <input id="profile-avatar-file" type="file" accept="image/jpeg,image/png,image/webp,image/avif" aria-describedby="profile-avatar-formats profile-avatar-feedback"/>
    <small id="profile-avatar-formats">JPG · PNG · WebP · AVIF · 2 MB</small>
    <div id="profile-avatar-preview" hidden>
     <canvas id="profile-avatar-canvas" role="img" width={512} height={512}/>
     <label className="profile-zoom-label" htmlFor="profile-avatar-zoom">{t("Crop zoom","Thu phóng vùng cắt")}</label>
     <div className="profile-zoom">
      <button id="profile-zoom-out" type="button" aria-label={t("Zoom out","Thu nhỏ")}>−</button>
      <div className="profile-zoom-slider">
       <span className="profile-zoom-track" aria-hidden="true"/>
       <input id="profile-avatar-zoom" type="range" min="1" max="3" step="0.05" defaultValue="1"/>
      </div>
      <button id="profile-zoom-in" type="button" aria-label={t("Zoom in","Phóng to")}>+</button>
      <span id="profile-zoom-value" aria-hidden="true">100%</span>
     </div>
     <div className="profile-avatar-actions">
      <button id="profile-avatar-save" type="button" className="button button-small" data-button-variant="save">{t("Save picture","Lưu ảnh")}</button>
      <button id="profile-avatar-cancel" type="button" className="button button-outline button-small" data-button-variant="cancel">{t("Cancel crop","Hủy cắt ảnh")}</button>
     </div>
    </div>
    <p id="profile-avatar-feedback" className="form-error" role="alert"/>
    <button id="profile-avatar-retry" type="button" className="button button-outline button-small" hidden>{t("Retry picture","Tải lại ảnh")}</button>
    <button id="profile-avatar-remove" type="button" className="button button-outline button-small" data-button-variant="danger" hidden>{t("Remove picture","Gỡ ảnh")}</button>
   </div>
  </section>
  <form className="enquiry-form staff-password-form" onSubmit={saveChanges}><h3>{t("Change password","Đổi mật khẩu")}</h3><p className="small muted" id="staff-password-help">{t("Leave both fields blank to keep your current password.","Để trống cả hai ô nếu bạn muốn giữ mật khẩu hiện tại.")}</p><label>{t("New password","Mật khẩu mới")}<PasswordInput inputProps={{"name":"password","aria-describedby":"staff-password-help","autoComplete":"new-password","minLength":12,"maxLength":128,"value":password,"disabled":!!busy,"onChange":event=>setPassword(event.target.value)}}/></label><label>{t("Confirm password","Xác nhận mật khẩu")}<input name="confirm_password" type="password" aria-describedby="staff-password-help" autoComplete="new-password" minLength={12} maxLength={128} value={confirm} disabled={!!busy} onChange={event=>setConfirm(event.target.value)}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<footer className="gw-editor-actions"><button data-button-variant="cancel" type="button" className="button button-outline" disabled={!!busy} onClick={close}>{t("Cancel","Hủy")}</button><button data-button-variant="save" className="button" disabled={!!busy}>{busy==="password"?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} {t("Save changes","Lưu thay đổi")}</button></footer></form>
 </EditorModal>;
}
