"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useSite } from "./site-context";
import { fetchWithDeadline, request } from "@/lib/requests";

type Providers = { available: boolean; google: boolean; apple: boolean };
export function SocialSignIn({ busy, setBusy, onError }: { busy: boolean; setBusy: (busy: boolean) => void; onError: (message: string) => void }) {
  const { client, ready, t } = useSite();
  const [providers, setProviders] = useState<Providers | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchWithDeadline("/api/auth/options", { cache: "no-store", signal: controller.signal }, 10000)
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<Providers>; })
      .then(value => { if (!controller.signal.aborted) setProviders(value); })
      .catch(() => { if (!controller.signal.aborted) setProviders({ available: false, google: false, apple: false }); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setBusy(false); };
    window.addEventListener("pageshow", restored); return () => window.removeEventListener("pageshow", restored);
  }, [setBusy]);
  async function signIn(provider: "google" | "apple") {
    if (!client || busy || !providers?.[provider]) return;
    setBusy(true); onError("");
    try {
      const { data, error } = await request(() => client.auth.signInWithOAuth({ provider, options: {
        redirectTo: window.location.origin + "/auth/callback", skipBrowserRedirect: true,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      } }));
      if (error || !data.url) throw error || new Error();
      window.location.assign(data.url);
    } catch {
      onError(t("We couldn’t open that sign-in option. Please try again or use your email.", "Không thể mở phương thức đăng nhập này. Vui lòng thử lại hoặc dùng email."));
      setBusy(false);
    }
  }
  return <div className="social-auth">
    <div className="social-auth-buttons">
      <button type="button" className="social-auth-button google-sign-in" disabled={busy || !ready || !client || !providers?.google} onClick={() => void signIn("google")}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.99-4.3 2.99-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.23-2.5c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93V7.49H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.51l3.33-2.58Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.33 2.58A5.99 5.99 0 0 1 12 5.95Z"/></svg>
        {t("Continue with Google", "Tiếp tục với Google")}
      </button>
      <button type="button" className="social-auth-button apple-sign-in" disabled={busy || !ready || !client || !providers?.apple} onClick={() => void signIn("apple")}>
        <svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c.03 3.12 2.74 4.16 2.77 4.17-.02.08-.43 1.49-1.42 2.95-.86 1.26-1.75 2.52-3.15 2.54-1.38.03-1.82-.82-3.4-.82-1.57 0-2.06.8-3.36.85-1.35.05-2.37-1.37-3.24-2.63-1.77-2.56-3.12-7.23-1.3-10.39.9-1.57 2.5-2.56 4.25-2.59 1.33-.03 2.58.9 3.4.9.81 0 2.34-1.12 3.95-.95.68.03 2.57.27 3.78 2.04-.1.06-2.26 1.32-2.28 3.93ZM14.47 4.83c.72-.87 1.21-2.07 1.08-3.28-1.04.04-2.3.69-3.04 1.56-.67.77-1.26 2.01-1.1 3.19 1.16.09 2.34-.59 3.06-1.47Z"/></svg>
        {t("Continue with Apple", "Tiếp tục với Apple")}
      </button>
    </div>
    {!providers ? <p className="social-auth-note" role="status"><LoaderCircle size={13} className="spin"/>{t("Checking sign-in options…", "Đang kiểm tra phương thức đăng nhập…")}</p>
      : !providers.google || !providers.apple ? <p className="social-auth-note">{t("Unavailable options are shown in grey. You can continue with your email below.", "Các phương thức chưa khả dụng được hiển thị màu xám. Bạn có thể tiếp tục bằng email bên dưới.")}</p> : null}
    <p className="social-auth-privacy">{t("By continuing, you agree to our", "Khi tiếp tục, bạn đồng ý với")} <Link href="/privacy" target="_blank">{t("privacy policy", "chính sách bảo mật")}</Link>.</p>
    <div className="auth-divider"><span>{t("or continue with email", "hoặc tiếp tục bằng email")}</span></div>
  </div>;
}
