"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Heart, MessageSquare, ShieldCheck, UserRound, Building2, Users, LockKeyhole } from "lucide-react";
import { useSite } from "./site-context";

export function PortalSwitcher({ active }: { active: "customer" | "staff" }) {
  const { t } = useSite();
  return <nav className="portal-switcher" aria-label={t("Login portals", "Cổng đăng nhập")}>
    <Link href="/account" className={active === "customer" ? "active" : ""} aria-current={active === "customer" ? "page" : undefined}><UserRound size={17}/>{t("Customer portal", "Cổng khách hàng")}</Link>
    <Link href="/admin" className={active === "staff" ? "active" : ""} aria-current={active === "staff" ? "page" : undefined}><ShieldCheck size={17}/>{t("Staff portal", "Cổng nhân viên")}</Link>
  </nav>;
}

export function PortalAccess() {
  const { t, user, editor } = useSite();
  return <section className="container section portal-access">
    <div className="portal-access-heading"><div className="eyebrow">GARY HOME</div><h1>{t("The right place to sign in.", "Chọn nơi đăng nhập của bạn.")}</h1><p>{t("Looking for a home or managing one? Choose your portal.", "Bạn đang tìm nhà hay quản lý công việc? Chọn cổng phù hợp.")}</p></div>
    <div className="portal-access-grid">
      <article className="portal-access-card portal-customer"><span className="portal-access-icon"><UserRound size={28}/></span><span className="portal-access-kind">{t("FOR HOME SEEKERS", "DÀNH CHO NGƯỜI TÌM NHÀ")}</span><h2>{t("Customer portal", "Cổng khách hàng")}</h2><p>{t("Your own space to plan your next move. Sign in or create an account with your personal email.", "Không gian riêng cho hành trình tìm nhà. Đăng nhập hoặc tạo tài khoản bằng email cá nhân.")}</p><ul><li><Heart size={17}/>{t("Save and compare homes", "Lưu và so sánh nhà")}</li><li><CalendarDays size={17}/>{t("Track enquiries and viewing requests", "Theo dõi yêu cầu và lịch xem nhà")}</li><li><MessageSquare size={17}/>{t("Read updates from the team", "Xem cập nhật từ đội ngũ")}</li></ul><Link className="button" href="/account">{user ? t("Open customer account", "Mở tài khoản khách hàng") : t("Customer sign in / register", "Khách hàng đăng nhập / đăng ký")}<ArrowRight size={17}/></Link></article>
      <article className="portal-access-card portal-staff"><span className="portal-access-icon"><ShieldCheck size={28}/></span><span className="portal-access-kind">{t("INVITED TEAM MEMBERS", "DÀNH CHO NHÂN VIÊN ĐƯỢC CẤP QUYỀN")}</span><h2>{t("Staff portal", "Cổng nhân viên")}</h2><p>{t("Gary Home Studio for the team. Use the company or Gmail account assigned by a higher-level team member.", "Gary Home Studio dành cho đội ngũ. Dùng tài khoản công ty hoặc Gmail do thành viên cấp cao hơn cấp quyền.")}</p><ul><li><Building2 size={17}/>{t("Manage listings and site content", "Quản lý tin đăng và nội dung")}</li><li><Users size={17}/>{t("Manage customers and viewings", "Quản lý khách hàng và lịch xem nhà")}</li><li><LockKeyhole size={17}/>{t("Assigned access; contact your administrator", "Cần được cấp quyền; liên hệ quản trị viên")}</li></ul><Link className="button" href="/admin">{editor ? t("Open staff Studio", "Mở Studio nhân viên") : t("Staff sign in", "Nhân viên đăng nhập")}<ArrowRight size={17}/></Link></article>
    </div>
  </section>;
}
