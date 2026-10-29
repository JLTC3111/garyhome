"use client";
import { ContentImage } from "./content-image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronDown, Menu, X, Phone, MapPin, UserRound, ShieldCheck } from "lucide-react";
import { useSite } from "./site-context";
import { LanguageSwitcher } from "./language-switcher";
import { BackNavigation } from "./back-navigation";
import { FavouritesDropdown } from "./favourites-dropdown";
import { FloatingContact } from "./listing-author";
import { ServiceAppsMenu } from "./service-apps";

export function Brand({light=false}:{light?:boolean}){const {t,language}=useSite();return <Link className={`brand rental-brand ${light?"brand-light":""}`} href="/" aria-label={t("Gary Home homepage","Trang chủ Gary Home")}><ContentImage src="/images/brand/gary-home-logo.png" alt="Gary Home" width={220} height={64} sizes="(max-width: 640px) 193px, 220px" loading="eager"/><small className="brand-tagline" lang={language}>{t("HANOI RENTALS","NHÀ CHO THUÊ HÀ NỘI")}</small></Link>;}
function HeaderPortals({mobile=false,onFollow}:{mobile?:boolean;onFollow:()=>void}){
 const {t}=useSite();
 return <><Link className={`customer-login-link ${mobile?"":"desktop-band-control"}`} href="/account" onClick={onFollow} aria-label={t("Customer account","Tài khoản khách hàng")}><UserRound size={mobile?18:12}/><span className="portal-full-label">{t("Customer account","Tài khoản khách hàng")}</span><span className="portal-short-label">{t("Customer","Khách hàng")}</span></Link><Link className={`staff-login-link ${mobile?"":"desktop-band-control"}`} href="/admin" onClick={onFollow} aria-label={t("Staff login","Đăng nhập nhân viên")}><ShieldCheck size={mobile?18:12}/><span className="portal-full-label">{t("Staff login","Đăng nhập nhân viên")}</span><span className="portal-short-label">{t("Staff","Nhân viên")}</span></Link></>;
}
export function Header(){
 const {t,content}=useSite(),path=usePathname();
 const [open,setOpen]=useState(false),[dropdown,setDropdown]=useState<"districts"|"about"|null>(null);
 const header=useRef<HTMLElement>(null),menu=useRef<HTMLButtonElement>(null),districtTrigger=useRef<HTMLButtonElement>(null),aboutTrigger=useRef<HTMLButtonElement>(null),aboutMenu=useRef<HTMLDivElement>(null);
 const close=()=>{setOpen(false);setDropdown(null);};
 useEffect(()=>{let current=true;queueMicrotask(()=>{if(current){setOpen(false);setDropdown(null);}});return()=>{current=false;};},[path]);
 useEffect(()=>{if(!open&&!dropdown)return;
  const key=(event:KeyboardEvent)=>{if(event.key==="Escape"){setOpen(false);setDropdown(null);(dropdown==="about"?aboutTrigger:dropdown==="districts"?districtTrigger:menu).current?.focus();}};
  const outside=(event:PointerEvent)=>{if(!header.current?.contains(event.target as Node)){setOpen(false);setDropdown(null);}};
  window.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);return()=>{window.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
 },[open,dropdown]);
 if(path.startsWith("/admin"))return null;
 const aboutLinks=[["/services",t("Other Services","Other Services")],["/vinhomes",t("Vinhomes collection","Bộ sưu tập Vinhomes")],["/tips-and-news",t("Tips & News","Cẩm nang & tin tức")],["/contact",t("Contact","Liên hệ")],["/landlords",t("Landlords","Dành cho chủ nhà")]];
 return <header className="site-header rental-site-header" ref={header}>
  <div className="top-strip"><div className="container rental-header-band"><div className="rental-band-contact"><BackNavigation/><a className="top-strip-phone" href={`tel:${content.settings.contact_phone.replace(/[^+\d]/g,"")}`}><Phone size={16}/><span>{content.settings.contact_phone}</span></a><LanguageSwitcher className="desktop-band-control"/></div><div className="top-strip-actions"><ServiceAppsMenu className="gary-apps-menu--header" onFollow={close} onOpen={()=>setDropdown(null)}/><FavouritesDropdown onOpen={close}/><HeaderPortals onFollow={close}/></div></div></div>
  <div className="header-nav"><div className="container header-inner"><Brand/><nav className={open?"main-nav nav-open":"main-nav"} id="site-navigation" aria-label={t("Main navigation","Điều hướng chính")}>
   <div className="district-navigation"><button ref={districtTrigger} type="button" aria-expanded={dropdown==="districts"} aria-controls="apartment-districts" onClick={()=>setDropdown(dropdown==="districts"?null:"districts")}>{t("Apartments","Căn hộ")}<ChevronDown size={13}/></button>{dropdown==="districts"&&<div className="district-dropdown" id="apartment-districts"><Link href="/homes?type=Apartment" onClick={close}>{t("All apartments","Tất cả căn hộ")}<ArrowUpRight size={14}/></Link>{content.neighbourhoods.map(n=><Link key={n.slug} href={`/homes?type=Apartment&district=${n.slug}`} onClick={close}>{n.name}<ArrowUpRight size={13}/></Link>)}</div>}</div>
   <div className="about-navigation" onPointerEnter={event=>{if(event.pointerType==="mouse"&&!window.matchMedia?.("(max-width: 1200px)").matches)setDropdown("about");}} onPointerLeave={event=>{if(event.pointerType==="mouse")setDropdown(previous=>previous==="about"?null:previous);}} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setDropdown(previous=>previous==="about"?null:previous);}}><button ref={aboutTrigger} type="button" aria-expanded={dropdown==="about"} aria-controls="about-navigation-links" onClick={()=>setDropdown(dropdown==="about"?null:"about")} onKeyDown={event=>{if(event.key==="ArrowDown"){event.preventDefault();setDropdown("about");queueMicrotask(()=>aboutMenu.current?.querySelector<HTMLAnchorElement>("a")?.focus());}}}>{t("About Us","Về chúng tôi")}<ChevronDown size={13}/></button>
    {dropdown==="about"&&<div ref={aboutMenu} id="about-navigation-links" className="about-dropdown" onKeyDown={event=>{const links=Array.from(aboutMenu.current?.querySelectorAll<HTMLAnchorElement>("a")||[]),index=links.indexOf(event.target as HTMLAnchorElement);if(index<0||!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;event.preventDefault();links[event.key==="Home"?0:event.key==="End"?links.length-1:(index+(event.key==="ArrowDown"?1:-1)+links.length)%links.length]?.focus();}}>{aboutLinks.map(([href,label])=><Link key={href} href={href} onClick={close}>{label}<ArrowUpRight size={15} aria-hidden="true"/></Link>)}</div>}
   </div>
   <Link className="button button-small header-feedback" href="/feedback" onClick={close}>{t("Feedback","Phản hồi")}<ArrowUpRight size={15}/></Link>
   <div className="mobile-app-services"><ServiceAppsMenu onFollow={close} onOpen={()=>setDropdown(null)}/></div>
   <div className="mobile-nav-tools"><div className="mobile-nav-portals"><HeaderPortals mobile onFollow={close}/></div><div className="mobile-nav-language"><span>{t("Language","Ngôn ngữ")}</span><LanguageSwitcher/></div></div>
  </nav><div className="header-actions"><button ref={menu} className="mobile-menu icon-button" type="button" aria-label={open?t("Close menu","Đóng menu"):t("Open menu","Mở menu")} aria-controls="site-navigation" aria-expanded={open} onClick={()=>{setOpen(!open);setDropdown(null);}}>{open?<X/>:<Menu/>}</button></div></div></div>
 </header>;
}
type FooterItem={href:string;label:string;icon?:typeof Phone};
function FooterItems({items}:{items:FooterItem[]}){
 return <>{items.map(({href,label,icon:Icon})=>href.startsWith("/")?<Link key={href} href={href}>{label}{Icon&&<Icon size={15} aria-hidden="true"/>}</Link>:<a key={href} href={href}>{label}{Icon&&<Icon size={15} aria-hidden="true"/>}</a>)}</>;
}
function FooterAccordion({title,children}:{title:string;children:ReactNode}){
 return <details className="footer-accordion" name="gary-footer-menus"><summary><h3>{title}</h3><ChevronDown size={18} aria-hidden="true"/></summary><div className="footer-accordion-links">{children}</div></details>;
}
export function Footer(){
 const {t,content}=useSite(),path=usePathname();
 if(path.startsWith("/admin"))return null;
 const s=content.settings;
 const rentals:FooterItem[]=[
  {href:"/homes?type=Apartment",label:t("Apartments","Căn hộ")},
  {href:"/homes",label:t("All rentals","Tất cả nhà cho thuê")},
  {href:"/neighbourhoods",label:t("Neighbourhoods","Khu vực")},
  {href:"/vinhomes",label:t("Vinhomes collection","Bộ sưu tập Vinhomes")},
 ];
 const company:FooterItem[]=[
  {href:"/activities?category=team",label:t("Our team","Đội ngũ")},
  {href:"/feedback",label:t("Feedback","Phản hồi")},
  {href:"/services",label:t("Other Services","Other Services")},
  {href:"/tips-and-news",label:t("Tips & News","Cẩm nang & tin tức")},
  {href:"/landlords",label:t("Landlords","Dành cho chủ nhà")},
 ];
 const account:FooterItem[]=[
  {href:"/saved",label:t("My Favourites","Nhà yêu thích")},
  {href:"/account",label:t("Customer portal","Cổng khách hàng")},
  {href:"/admin",label:t("Staff portal","Cổng nhân viên")},
 ];
 const contact:FooterItem[]=[
  {href:`tel:${s.contact_phone.replace(/[^+\d]/g,"")}`,label:s.contact_phone,icon:Phone},
  {href:`mailto:${s.contact_email}`,label:s.contact_email,icon:ArrowUpRight},
  {href:"/contact",label:t("Send a rental enquiry","Gửi yêu cầu thuê nhà"),icon:ArrowUpRight},
 ];
 const legal:FooterItem[]=[{href:"/privacy",label:t("Privacy policy","Chính sách bảo mật")},{href:"/credits",label:t("Photo credits","Nguồn ảnh")}];
 const address=<a className="footer-location" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.contact_address)}`} target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true"/>{s.contact_address}</a>;
 return <><footer className="site-footer rental-footer"><div className="container">
  <div className="footer-top">
   <div className="footer-intro"><p>{t("Serviced apartments and property rentals in Hanoi. Contact Gary Home for current availability and lease terms.","Căn hộ dịch vụ và bất động sản cho thuê tại Hà Nội. Liên hệ Gary Home để xác nhận tình trạng và điều kiện thuê.")}</p><div className="footer-desktop-address">{address}</div></div>
   <div className="footer-desktop-menus">
    <div className="footer-column"><h3>{t("Rental properties","Bất động sản cho thuê")}</h3><FooterItems items={rentals}/></div>
    <div className="footer-column"><h3>Gary Home</h3><FooterItems items={company}/><FooterItems items={account}/></div>
    <div className="footer-column"><h3>{t("Contact Gary Home","Liên hệ Gary Home")}</h3><FooterItems items={contact}/></div>
   </div>
   <nav className="footer-mobile-menus" aria-label={t("Footer navigation","Điều hướng cuối trang")}>
    <FooterAccordion title={t("Rental properties","Bất động sản cho thuê")}><FooterItems items={rentals}/></FooterAccordion>
    <FooterAccordion title="Gary Home"><FooterItems items={company}/></FooterAccordion>
    <FooterAccordion title={t("My account","Tài khoản của tôi")}><FooterItems items={account}/></FooterAccordion>
    <FooterAccordion title={t("Contact & help","Liên hệ & hỗ trợ")}><FooterItems items={contact}/>{address}<div className="footer-legal-links"><FooterItems items={legal}/></div></FooterAccordion>
   </nav>
  </div>
  <div className="footer-bottom"><span>© {new Date().getFullYear()} Gary Home.</span><div className="footer-desktop-legal"><FooterItems items={legal}/></div></div>
 </div></footer><FloatingContact/></>;
}
