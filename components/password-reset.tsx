"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck } from "lucide-react";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { PortalSwitcher } from "./portal-access";
import { emailLinkIdentity, setAccountPassword } from "@/lib/password-actions";
import { request } from "@/lib/requests";

export function PasswordReset({ invitation = false }: { invitation?: boolean }) {
  const {passwordLink,emailVerification}=useSite();
  const staffInvitation=invitation||emailVerification?.type==="invite"||passwordLink?.type==="invite";
  const [linkUser]=useState(()=>typeof window!=="undefined"?emailLinkIdentity(window.location.hash,staffInvitation?"invite":"recovery"):null);
  const expectedUser=linkUser||(passwordLink?.type===(staffInvitation?"invite":"recovery")?passwordLink.userId:null);
  return <PasswordResetBody key={expectedUser||"pending-link"} invitation={staffInvitation} expectedUser={expectedUser}/>;
}
function PasswordResetBody({invitation,expectedUser}:{invitation:boolean;expectedUser:string|null}){
  const { client,ready,user,editor,accountTask,t,passwordLinkIssue,emailVerification,verifyEmailLink,reconnect }=useSite(),text=useStudioText();
  const staffPortal=invitation||editor,portalPath=staffPortal?"/admin":"/account";
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [success,setSuccess]=useState(false),[showPassword,setShowPassword]=useState(false);
  const [resendEmail,setResendEmail]=useState(""),[sent,setSent]=useState(false);
  const accountChanged=!!expectedUser&&expectedUser!==user?.id;
  const verified=ready&&!!client&&!!expectedUser&&!!user&&!accountChanged&&!passwordLinkIssue&&!emailVerification;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!client||!expectedUser||busy||!verified)return;
    const form=new FormData(event.currentTarget),password=String(form.get("password"));
    if(password!==form.get("confirm")){setError(t("The passwords don’t match.","Mật khẩu không khớp."));return;}
    if(password.length<12){setError(t("Use at least 12 characters.","Sử dụng ít nhất 12 ký tự."));return;}
    const identity=expectedUser;setBusy(true);setError("");
    try{
      await accountTask(async(db,signal,userId)=>{
        if(userId!==identity)throw new Error("Your account changed. Open the email link again before continuing.");
        await setAccountPassword(db,identity,password,signal);
      });
      setSuccess(true);
    }catch(error){setError(error instanceof Error?error.message:"Couldn’t update your password.");}
    finally{setBusy(false);}
  }
  async function resend(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!client||busy)return;
    setBusy(true);setError("");setSent(false);
    try{
      const {error}=await request(()=>client.auth.resetPasswordForEmail(resendEmail.trim().toLowerCase(),{redirectTo:window.location.origin+"/auth/reset"}));
      if(error)throw error;
      setSent(true);
    }catch{setError(t("Couldn’t request a new link. Wait a moment and try again, or contact your administrator.","Chưa thể yêu cầu liên kết mới. Hãy đợi một lát rồi thử lại hoặc liên hệ quản trị viên."));}
    finally{setBusy(false);}
  }
  const title=success?t("Your password is ready.","Mật khẩu đã sẵn sàng."):passwordLinkIssue==="expired"?t("Your email link has expired.","Liên kết email đã hết hạn."):passwordLinkIssue?t("This email link is invalid.","Liên kết email không hợp lệ."):invitation?t("Set your staff password.","Đặt mật khẩu nhân viên."):!ready?t("Checking your email link…","Đang kiểm tra liên kết email…"):staffPortal?t("Reset staff password.","Đặt lại mật khẩu nhân viên."):t("Reset customer password.","Đặt lại mật khẩu khách hàng.");
  return <section className="container section password-reset-page">
    <PortalSwitcher active={staffPortal?"staff":"customer"}/>
    <div className="password-access-card">
      <span className="password-access-icon" aria-hidden="true">{success?<CheckCircle2 size={28}/>:passwordLinkIssue?<Mail size={28}/>:<KeyRound size={28}/>}</span>
      <div className="eyebrow">{staffPortal?t("GARY HOME · STAFF SETUP","GARY HOME · THIẾT LẬP NHÂN VIÊN"):t("GARY HOME · ACCOUNT SECURITY","GARY HOME · BẢO MẬT TÀI KHOẢN")}</div>
      <h1>{title}</h1>
      {success?<div className="password-access-success"><p role="status">{t("Your password is ready. You can continue to your account.","Mật khẩu đã sẵn sàng. Bạn có thể tiếp tục đến tài khoản.")}</p><Link className="button" href={portalPath}>{staffPortal?t("Open staff Studio","Mở Studio nhân viên"):t("Open customer account","Mở tài khoản khách hàng")}<ArrowRight size={17}/></Link></div>
      :!ready?<p className="password-access-status" role="status"><LoaderCircle size={18} className="spin"/>{t("Checking your email link…","Đang kiểm tra liên kết email…")}</p>
      :passwordLinkIssue||!emailVerification&&!verified?<>
        <p role="alert">{passwordLinkIssue==="expired"?t("This one-time link has expired or has already been used. Request a fresh link below, then open the newest email.","Liên kết dùng một lần đã hết hạn hoặc đã được sử dụng. Hãy yêu cầu liên kết mới bên dưới và mở email mới nhất."):passwordLinkIssue?t("Request a fresh password link below. Your password has not been changed.","Hãy yêu cầu liên kết mật khẩu mới bên dưới. Mật khẩu của bạn chưa bị thay đổi."):accountChanged?t("Your account changed. Open the email link again before continuing.","Tài khoản đã thay đổi. Hãy mở lại liên kết email trước khi tiếp tục."):invitation?t("Open the staff invitation link sent to your assigned email to set your password. If it no longer works, request a new password link below.","Hãy mở liên kết mời gửi đến email đã được cấp quyền để đặt mật khẩu. Nếu không còn dùng được, hãy yêu cầu liên kết mật khẩu mới bên dưới."):t("Open the password reset link from your email first, or request a new one below.","Hãy mở liên kết đặt lại mật khẩu trong email hoặc yêu cầu liên kết mới bên dưới.")}</p>
        <form className="enquiry-form password-resend-form" onSubmit={resend}>
          <label>{staffPortal?t("Assigned staff email","Email nhân viên đã được cấp quyền"):t("Email address","Địa chỉ email")}<input type="email" name="email" autoComplete="email" required maxLength={254} value={resendEmail} onChange={event=>{setResendEmail(event.target.value);setSent(false);}} disabled={busy} placeholder="you@example.com"/></label>
          {error&&<p className="form-error" role="alert">{text(error)}</p>}
          {sent&&<p className="form-info" role="status">{t("If this email has an account, a new password link has been requested. Check your inbox and spam folder. Use only the newest link.","Nếu email này có tài khoản, yêu cầu liên kết mật khẩu mới đã được gửi. Hãy kiểm tra hộp thư và thư rác, chỉ dùng liên kết mới nhất.")}</p>}
          <button className="button" disabled={busy||!client}>{busy?<LoaderCircle size={17} className="spin"/>:<Mail size={17}/>} {busy?t("Requesting link…","Đang yêu cầu liên kết…"):t("Send a fresh password link","Gửi liên kết mật khẩu mới")}</button>
        </form>
        {!client&&<button className="text-link" type="button" onClick={()=>void reconnect()}>{t("Reconnect","Kết nối lại")}</button>}
        <Link className="text-link password-back-link" href={portalPath}>{staffPortal?t("Back to staff sign in","Về đăng nhập nhân viên"):t("Back to customer sign in","Về đăng nhập khách hàng")}</Link>
      </>:emailVerification?<>
        <p>{t("Your email link is ready. Continue to verify it, then create and confirm your password.","Liên kết email đã sẵn sàng. Tiếp tục xác minh, sau đó tạo và xác nhận mật khẩu của bạn.")}</p>
        <p className="password-safety-note"><ShieldCheck size={17}/>{t("Verification starts only when you press Continue.","Chỉ bắt đầu xác minh khi bạn nhấn Tiếp tục.")}</p>
        {emailVerification.failed&&<p className="form-error" role="alert">{t("Couldn’t verify the link. Check your connection and try again.","Chưa thể xác minh liên kết. Kiểm tra kết nối rồi thử lại.")}</p>}
        <button type="button" className="button password-verify-button" disabled={!client||emailVerification.busy} onClick={()=>void verifyEmailLink()}>{emailVerification.busy?<LoaderCircle size={17} className="spin"/>:<ArrowRight size={17}/>} {emailVerification.busy?t("Verifying email…","Đang xác minh email…"):t("Continue to set password","Tiếp tục đặt mật khẩu")}</button>
      </>:<>
        <p>{invitation?t("Your email is verified. Create a password to finish setting up Gary Home Studio.","Email đã được xác minh. Hãy tạo mật khẩu để hoàn tất thiết lập Gary Home Studio."):t("Choose a new password for your account.","Chọn mật khẩu mới cho tài khoản.")}</p>
        <p className="password-verified-email"><CheckCircle2 size={16}/>{user?.email}</p>
        <form className="enquiry-form password-create-form" onSubmit={submit}>
          <label>{t("New password","Mật khẩu mới")}<input type={showPassword?"text":"password"} name="password" minLength={12} required autoComplete="new-password" aria-describedby="password-requirements" disabled={busy}/></label>
          <label>{t("Confirm password","Xác nhận mật khẩu")}<input type={showPassword?"text":"password"} name="confirm" minLength={12} required autoComplete="new-password" disabled={busy}/></label>
          <div className="password-input-tools"><small id="password-requirements">{t("Use at least 12 characters and a password you don’t use elsewhere.","Dùng ít nhất 12 ký tự và mật khẩu chưa sử dụng ở nơi khác.")}</small><button type="button" className="text-link" aria-pressed={showPassword} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={15}/>:<Eye size={15}/>} {showPassword?t("Hide password","Ẩn mật khẩu"):t("Show password","Hiện mật khẩu")}</button></div>
          {error&&<div className="form-error" role="alert">{text(error)}</div>}
          <button className="button" disabled={busy}>{busy?<LoaderCircle size={17} className="spin"/>:<ShieldCheck size={17}/>} {busy?t("Updating…","Đang cập nhật…"):t("Save password","Lưu mật khẩu")}</button>
        </form>
        <p className="password-access-footnote">{staffPortal?t("Your administrator assigns your access. Only you choose your password.","Quản trị viên cấp quyền truy cập. Chỉ bạn tự chọn mật khẩu."):t("Your password is private. Never share it with anyone.","Mật khẩu là thông tin riêng tư. Không chia sẻ mật khẩu với bất kỳ ai.")}</p>
      </>}
    </div>
  </section>;
}
