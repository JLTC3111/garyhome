"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { PortalSwitcher } from "./portal-access";
import { emailLinkIdentity, setAccountPassword } from "@/lib/password-actions";

export function PasswordReset({ invitation = false }: { invitation?: boolean }) {
  const { client, ready, user, editor, accountTask, t } = useSite(), text = useStudioText();
  const staffPortal = invitation || editor;
  const portalPath = staffPortal ? "/admin" : "/account";
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  // Capture evidence before the SDK consumes and removes the redirect hash.
  const [expectedUser] = useState(() => typeof window !== "undefined" ? emailLinkIdentity(window.location.hash, invitation ? "invite" : "recovery") : null);
  const accountChanged = !!expectedUser && expectedUser !== user?.id;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!client || !expectedUser || busy) return;
    const form = new FormData(event.currentTarget), password = String(form.get("password"));
    if (password !== form.get("confirm")) { setError(t("The passwords don’t match.", "Mật khẩu không khớp.")); return; }
    if (password.length < 12) { setError(t("Use at least 12 characters.", "Sử dụng ít nhất 12 ký tự.")); return; }
    const identity = expectedUser;
    setBusy(true); setError("");
    try {
      if (user?.id !== identity) throw new Error("Your account changed. Open the email link again before continuing.");
      await accountTask(async (db, signal, userId) => {
        if (userId !== identity) throw new Error("Your account changed. Open the email link again before continuing.");
        await setAccountPassword(db, identity, password, signal);
      });
      setSuccess(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t update your password."); }
    finally { setBusy(false); }
  }
  return <section className="container section legal-page password-reset-page">
    {(ready || invitation) && <PortalSwitcher active={staffPortal ? "staff" : "customer"}/>}
    <div className="eyebrow">{!ready && !invitation ? "GARY HOME" : staffPortal ? t("STAFF PORTAL", "CỔNG NHÂN VIÊN") : t("CUSTOMER PORTAL", "CỔNG KHÁCH HÀNG")}</div><h1>{invitation ? t("Set your staff password.", "Đặt mật khẩu nhân viên.") : !ready ? t("Checking your email link…", "Đang kiểm tra liên kết email…") : staffPortal ? t("Reset staff password.", "Đặt lại mật khẩu nhân viên.") : t("Reset customer password.", "Đặt lại mật khẩu khách hàng.")}</h1>
    {success ? <><p role="status">{t("Your password is ready. You can continue to your account.", "Mật khẩu đã sẵn sàng. Bạn có thể tiếp tục đến tài khoản.")}</p><Link className="button" href={portalPath}>{staffPortal ? t("Open staff Studio", "Mở Studio nhân viên") : t("Open customer account", "Mở tài khoản khách hàng")}</Link></>
      : !ready ? <p role="status">{t("Checking your email link…", "Đang kiểm tra liên kết email…")}</p>
      : !client || !expectedUser || !user || accountChanged ? <><p role="alert">{accountChanged ? t("Your account changed. Open the email link again before continuing.", "Tài khoản đã thay đổi. Hãy mở lại liên kết email trước khi tiếp tục.") : invitation ? t("Open the staff invitation link sent to your company email to set your password.", "Hãy mở liên kết mời gửi đến email công ty để đặt mật khẩu.") : t("Open the password reset link from your email first.", "Hãy mở liên kết đặt lại mật khẩu trong email trước.")}</p><Link className="button" href={portalPath}>{staffPortal ? t("Back to staff sign in", "Về đăng nhập nhân viên") : t("Back to customer sign in", "Về đăng nhập khách hàng")}</Link></>
      : <form className="enquiry-form" onSubmit={submit}>
        <p>{invitation ? t("Choose your own password for your company account. Your access is assigned by the owner or an administrator.", "Tạo mật khẩu riêng cho tài khoản công ty. Quyền truy cập do chủ sở hữu hoặc quản trị viên cấp.") : t("Choose a new password for your account.", "Chọn mật khẩu mới cho tài khoản.")}</p>
        <p className="small muted">{user.email}</p>
        <label>{t("New password", "Mật khẩu mới")}<input type="password" name="password" minLength={12} required autoComplete="new-password" disabled={busy}/></label>
        <label>{t("Confirm password", "Xác nhận mật khẩu")}<input type="password" name="confirm" minLength={12} required autoComplete="new-password" disabled={busy}/></label>
        {error && <div className="form-error" role="alert">{text(error)}</div>}<button className="button" disabled={busy}>{busy ? t("Updating…", "Đang cập nhật…") : t("Save password", "Lưu mật khẩu")}</button>
      </form>}
  </section>;
}
