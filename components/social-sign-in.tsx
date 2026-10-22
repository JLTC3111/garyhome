"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useSite } from "./site-context";
import { fetchWithDeadline, request } from "@/lib/requests";

type Providers = { available: boolean; google: boolean };
export function SocialSignIn({ busy, setBusy, onError }: { busy: boolean; setBusy: (busy: boolean) => void; onError: (message: string) => void }) {
  const { client, ready, t } = useSite();
  const [providers, setProviders] = useState<Providers | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchWithDeadline("/api/auth/options", { cache: "no-store", signal: controller.signal }, 10000)
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<Providers>; })
      .then(value => { if (!controller.signal.aborted) setProviders(value); })
      .catch(() => { if (!controller.signal.aborted) setProviders({ available: false, google: false }); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setBusy(false); };
    window.addEventListener("pageshow", restored); return () => window.removeEventListener("pageshow", restored);
  }, [setBusy]);
  async function signIn() {
    if (!client || busy || !providers?.google) return;
    setBusy(true); onError("");
    try {
      const { data, error } = await request(() => client.auth.signInWithOAuth({ provider: "google", options: {
        redirectTo: window.location.origin + "/auth/callback", skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
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
      <button type="button" className="social-auth-button google-sign-in" disabled={busy || !ready || !client || !providers?.google} onClick={() => void signIn()}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.99-4.3 2.99-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.61-2.42l-3.23-2.5c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.07v2.58A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.93A6 6 0 0 1 6.08 12c0-.67.12-1.32.32-1.93V7.49H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.51l3.33-2.58Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.33 2.58A5.99 5.99 0 0 1 12 5.95Z"/></svg>
        {t("Continue with Google", "Tiếp tục với Google")}
      </button>
    </div>
    {!providers ? <p className="social-auth-note" role="status"><LoaderCircle size={13} className="spin"/>{t("Checking sign-in options…", "Đang kiểm tra phương thức đăng nhập…")}</p>
      : !providers.google ? <p className="social-auth-note">{t("Google sign-in is currently unavailable. You can continue with email below.", "Đăng nhập bằng Google hiện chưa khả dụng. Bạn có thể tiếp tục bằng email bên dưới.")}</p> : null}
    <p className="social-auth-privacy">{t("By continuing, you agree to our", "Khi tiếp tục, bạn đồng ý với")} <Link href="/privacy" target="_blank">{t("privacy policy", "chính sách bảo mật")}</Link>.</p>
    <div className="auth-divider"><span>{t("or continue with email", "hoặc tiếp tục bằng email")}</span></div>
  </div>;
}
