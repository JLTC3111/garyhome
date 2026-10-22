"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { emailLinkIdentity, setAccountPassword } from "@/lib/password-actions";

export function PasswordReset({ invitation = false }: { invitation?: boolean }) {
  const { client, ready, user, accountTask, t } = useSite(), text = useStudioText();
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
  return <section className="container section legal-page">
    <div className="eyebrow">GARY HOME {invitation ? "STUDIO" : ""}</div><h1>{invitation ? t("Welcome to the team.", "Chào mừng đến với đội ngũ.") : t("A fresh start.", "Một khởi đầu mới.")}</h1>
    {success ? <><p role="status">{t("Your password is ready. You can continue to your account.", "Mật khẩu đã sẵn sàng. Bạn có thể tiếp tục đến tài khoản.")}</p><Link className="button" href={invitation ? "/admin" : "/account"}>{invitation ? t("Open Studio", "Mở Studio") : t("My account", "Tài khoản của tôi")}</Link></>
      : !ready ? <p role="status">{t("Checking your email link…", "Đang kiểm tra liên kết email…")}</p>
      : !client || !expectedUser || !user || accountChanged ? <><p role="alert">{accountChanged ? t("Your account changed. Open the email link again before continuing.", "Tài khoản đã thay đổi. Hãy mở lại liên kết email trước khi tiếp tục.") : invitation ? t("Open the staff invitation link sent to your company email to set your password.", "Hãy mở liên kết mời gửi đến email công ty để đặt mật khẩu.") : t("Open the password reset link from your email first.", "Hãy mở liên kết đặt lại mật khẩu trong email trước.")}</p><Link className="button" href={invitation ? "/admin" : "/account"}>{t("Back to sign in", "Quay lại đăng nhập")}</Link></>
      : <form className="enquiry-form" onSubmit={submit}>
        <p>{invitation ? t("Choose your own password for your company account. Your access is assigned by the owner or an administrator.", "Tạo mật khẩu riêng cho tài khoản công ty. Quyền truy cập do chủ sở hữu hoặc quản trị viên cấp.") : t("Choose a new password for your account.", "Chọn mật khẩu mới cho tài khoản.")}</p>
        <p className="small muted">{user.email}</p>
        <label>{t("New password", "Mật khẩu mới")}<input type="password" name="password" minLength={12} required autoComplete="new-password" disabled={busy}/></label>
        <label>{t("Confirm password", "Xác nhận mật khẩu")}<input type="password" name="confirm" minLength={12} required autoComplete="new-password" disabled={busy}/></label>
        {error && <div className="form-error" role="alert">{text(error)}</div>}<button className="button" disabled={busy}>{busy ? t("Updating…", "Đang cập nhật…") : t("Save password", "Lưu mật khẩu")}</button>
      </form>}
  </section>;
}
