"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Heart, Menu, X, Phone, MapPin, Search, UserRound, ShieldCheck } from "lucide-react";
import { useSite } from "./site-context";
import { LanguageSwitcher } from "./language-switcher";
import { AnimatedBackground } from "./motion-primitives/animated-background";

export function Brand({ light = false }: { light?: boolean }) {
  const { t, language } = useSite();
  return <Link className={`brand ${light ? "brand-light" : ""}`} href="/" aria-label={t("Gary Home homepage", "Trang chủ Gary Home")}><svg viewBox="0 0 46 46" fill="none" aria-hidden="true"><path d="M7 36h32M11 36V19l6-4 6 4v17m-10-21 4-6 4 6M25 36V14l7-5 7 5v22M28 10l4-6 4 6M29 36v-8a3 3 0 0 1 6 0v8M15 26h4m10-7h6M6 21v15m35-15v15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="m8 12 1-3 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="currentColor"/></svg><span>garyhome<span className="brand-dot">.</span><small className="brand-tagline" lang={language}>{t("YOUR PLACE IN HANOI", "TỔ ẤM CỦA BẠN TẠI HÀ NỘI")}</small></span></Link>;
}
export function Header() {
  const { t, saved, editor, user } = useSite();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || path.startsWith("/admin")) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpen(false); menuRef.current?.focus(); }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open, path]);

  if (path.startsWith("/admin")) return null;
  const links = [["/homes", t("Find a home", "Tìm nhà")], ["/neighbourhoods", t("Neighbourhoods", "Khu vực")], ["/about", t("The Gary way", "Về Gary Home")]];
  return <>
    <header className="site-header" ref={headerRef}>
      <div className="top-strip"><div className="container">
        <span className="top-strip-message">{t("A home in Hanoi. A team by your side.", "Ngôi nhà tại Hà Nội. Đội ngũ luôn bên bạn.")}</span>
        <div className="top-strip-actions">
          <a className="top-strip-phone" href="tel:+84356175046"><Phone size={14}/><span>+84 356 175 046</span></a>
          <Link href="/account" className="customer-login-link" onClick={() => setOpen(false)}><UserRound size={11}/>{user ? t("Customer account", "Tài khoản khách hàng") : t("Customer login", "Khách hàng đăng nhập")}</Link>
          <Link href="/admin" className="staff-login-link" onClick={() => setOpen(false)}><ShieldCheck size={11}/>{editor ? t("Staff Studio", "Studio nhân viên") : t("Staff login", "Nhân viên đăng nhập")}</Link>
        </div>
      </div></div>
      <div className="header-nav"><div className="container header-inner">
        <Brand/>
        <nav id="site-navigation" className={open ? "main-nav nav-open" : "main-nav"} aria-label={t("Main navigation", "Điều hướng chính")}>
          {links.map(([href, label]) => <Link key={href} href={href} className={path.startsWith(href) ? "active" : ""} aria-current={path.startsWith(href) ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>)}
          <Link className="mobile-contact" href="/contact" onClick={() => setOpen(false)}>{t("Contact", "Liên hệ")}</Link>
        </nav>
        <div className="header-actions">
          <LanguageSwitcher/>
          {user && <Link href="/saved" className="saved-link" aria-label={t(`Saved homes (${saved.length})`, `Nhà đã lưu (${saved.length})`)}><Heart size={19}/><span className="saved-count">{saved.length}</span></Link>}
          <Link href="/contact" className="button button-small header-contact">{t("Contact", "Liên hệ")}<ArrowUpRight size={16}/></Link>
          <button ref={menuRef} type="button" className="mobile-menu icon-button" onClick={() => setOpen(!open)} aria-label={open ? t("Close menu", "Đóng menu") : t("Open menu", "Mở menu")} aria-expanded={open} aria-controls="site-navigation">{open ? <X/> : <Menu/>}</button>
        </div>
      </div></div>
    </header>
    <nav className="mobile-bottom-nav" aria-label={t("Quick navigation", "Điều hướng nhanh")}>
      <AnimatedBackground activeValue={path.startsWith("/homes") ? "/homes" : path.startsWith("/saved") ? "/saved" : path.startsWith("/account") ? "/account" : ""}>
        {[["/homes", t("Find a home", "Tìm nhà"), Search], ["/saved", t("Saved homes", "Nhà đã lưu"), Heart], ["/account", t("Customer", "Khách hàng"), UserRound]].map(([href, label, Icon]) => {
          const target = href as string, Symbol = Icon as typeof Search;
          const active = path.startsWith(target);
          return <Link key={target} href={target} data-id={target} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Symbol size={19}/><span>{label as string}</span>{target === "/saved" && saved.length > 0 && <span className="mobile-nav-count" aria-label={t(`${saved.length} saved homes`, `${saved.length} căn nhà đã lưu`)}>{saved.length}</span>}</Link>;
        })}
      </AnimatedBackground>
    </nav>
  </>;
}
export function Footer() {
  const { t, content }=useSite();const path=usePathname();if(path.startsWith('/admin'))return null; const s=content.settings;
  return <footer className="site-footer"><div className="container"><div className="footer-top"><div className="footer-intro"><Brand light/><p>{t("A new city. A familiar feeling.\nFind your place with Gary Home.","Thành phố mới. Cảm giác thân quen.\nTìm nơi thuộc về bạn cùng Gary Home.")}</p><a className="footer-location" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.contact_address)}`} target="_blank" rel="noreferrer"><MapPin size={17}/><span>{s.contact_address}</span></a></div><div><h3>{t("Find your place","Tìm tổ ấm")}</h3><Link href="/homes?type=Apartment">{t("Apartments","Căn hộ")}</Link><Link href="/homes?type=Studio">{t("Studios","Studio")}</Link><Link href="/homes?type=House+%26+Villa">{t("Houses & villas","Nhà & biệt thự")}</Link><Link href="/homes?type=Office+%26+Restaurant">{t("Commercial spaces","Mặt bằng kinh doanh")}</Link></div><div><h3>{t("Get to know us","Về chúng tôi")}</h3><Link href="/about">{t("The Gary way","Cách Gary đồng hành")}</Link><Link href="/neighbourhoods">{t("Explore Hanoi","Khám phá Hà Nội")}</Link><Link href="/contact?kind=landlord">{t("List your property","Đăng tin cho thuê")}</Link><Link href="/account">{t("Customer portal","Cổng khách hàng")}</Link><Link href="/admin">{t("Staff portal","Cổng nhân viên")}</Link></div><div><h3>{t("A real conversation","Cùng trò chuyện")}</h3><a href={`mailto:${s.contact_email}`}>{s.contact_email}<ArrowUpRight size={14}/></a><a href={`tel:${s.contact_phone.replace(/\s/g,"")}`}>{s.contact_phone}<ArrowUpRight size={14}/></a><p className="footer-note">{t("Tell us what home means to you.\nWe’ll take it from there.","Chia sẻ với chúng tôi về tổ ấm bạn mong muốn.")}</p></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} Gary Home. {t("Made for life in Hanoi.","Dành cho cuộc sống tại Hà Nội.")}</span><div><Link href="/privacy">{t("Privacy policy","Chính sách bảo mật")}</Link><Link href="/credits">{t("Photo credits","Nguồn ảnh")}</Link><span>HÀ NỘI, VIETNAM <span className="live-dot"/></span></div></div></div></footer>;
}
