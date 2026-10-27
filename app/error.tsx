"use client";
import Link from "next/link";
import { useSite } from "@/components/site-context";

export default function ErrorPage({ retry }: { retry?: () => void; reset?: () => void }) {
  const { t } = useSite();
  return <section className="container section empty-state" role="alert">
    <h1>{t("We couldn’t load this page.", "Chưa thể tải trang này.")}</h1>
    <p>{t("The connection may be interrupted. Please try again in a moment.", "Kết nối có thể bị gián đoạn. Vui lòng thử lại sau giây lát.")}</p>
    <button className="button" type="button" onClick={() => { if (retry) retry(); else window.location.reload(); }}>{t("Try again", "Thử lại")}</button>{" "}
    <Link className="text-link" href="/homes">{t("Explore rentals", "Khám phá nhà cho thuê")}</Link>
  </section>;
}
