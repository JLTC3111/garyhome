"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { useSite } from "./site-context";
import { request } from "@/lib/requests";

export function AuthCallback() {
  const { client, ready, reconnect, t } = useSite(), router = useRouter();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!ready || !client) return;
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    void request(async () => {
      if (params.has("error") || hash.has("error")) throw new Error();
      const initialized = await client.auth.initialize();
      if (initialized.error) throw initialized.error;
      const session = await client.auth.getSession();
      if (session.error || !session.data.session) throw new Error();
      await reconnect();
      // A fixed local destination prevents redirect parameters from sending
      // signed-in customers to another site or into a staff-only flow.
      if (active) router.replace("/account");
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [client, ready, reconnect, router]);
  return <section className="container section legal-page auth-callback">
    <div className="eyebrow">GARY HOME</div><h1>{t("A place for you.", "Góc riêng dành cho bạn.")}</h1>
    {error || ready && !client ? <><p role="alert">{t("We couldn’t complete sign-in. The link may have expired or the request was cancelled. Please try again.", "Không thể hoàn tất đăng nhập. Liên kết có thể đã hết hạn hoặc yêu cầu đã bị hủy. Vui lòng thử lại.")}</p><Link className="button" href="/account">{t("Back to sign in", "Quay lại đăng nhập")}</Link></>
      : <p role="status"><LoaderCircle className="spin" size={18}/>{t("Finishing your secure sign-in…", "Đang hoàn tất đăng nhập an toàn…")}</p>}
  </section>;
}
