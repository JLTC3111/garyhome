"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronDown, Menu, X, Phone, MapPin, UserRound, ShieldCheck } from "lucide-react";
import { useSite } from "./site-context";
import { LanguageSwitcher } from "./language-switcher";
import { BackNavigation } from "./back-navigation";
import { FavouritesDropdown } from "./favourites-dropdown";
import { FloatingContact } from "./listing-author";

export function Brand({light=false}:{light?:boolean}){const {t,language}=useSite();return <Link className={`brand rental-brand ${light?"brand-light":""}`} href="/" aria-label={t("Gary Home homepage","Trang chủ Gary Home")}><img src="/images/brand/gary-home-logo.png" alt="Gary Home" width="220" height="64"/><small className="brand-tagline" lang={language}>{t("HANOI RENTALS","NHÀ CHO THUÊ HÀ NỘI")}</small></Link>;}
function HeaderPortals({mobile=false,onFollow}:{mobile?:boolean;onFollow:()=>void}){
 const {t,user,editor,staffProfile,client}=useSite();
 const photo=staffProfile?.avatar_path&&client?client.storage.from("staff-avatars").getPublicUrl(staffProfile.avatar_path).data.publicUrl:"";
 return <><Link className={`customer-login-link ${mobile?"":"desktop-band-control"}`} href="/account" onClick={onFollow} aria-label={user?t("Customer account","Tài khoản khách hàng"):t("Customer login","Khách hàng đăng nhập")}>{photo?<img className="header-staff-avatar" src={photo} alt=""/>:<UserRound size={mobile?18:11}/>}<span className="portal-full-label">{user?t("Customer account","Tài khoản khách hàng"):t("Customer login","Khách hàng đăng nhập")}</span><span className="portal-short-label">{t("Customer","Khách hàng")}</span></Link><Link className={`staff-login-link ${mobile?"":"desktop-band-control"}`} href="/admin" onClick={onFollow} aria-label={editor?t("Staff Studio","Studio nhân viên"):t("Staff login","Nhân viên đăng nhập")}><ShieldCheck size={mobile?18:11}/><span className="portal-full-label">{editor?t("Staff Studio","Studio nhân viên"):t("Staff login","Nhân viên đăng nhập")}</span><span className="portal-short-label">{t("Staff","Nhân viên")}</span></Link></>;
}
export function Header(){
 const {t,content}=useSite(),path=usePathname();
 const [open,setOpen]=useState(false),[districts,setDistricts]=useState(false);const header=useRef<HTMLElement>(null),menu=useRef<HTMLButtonElement>(null),districtTrigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open&&!districts)return;
  function key(event:KeyboardEvent){if(event.key==="Escape"){setOpen(false);setDistricts(false);(districts?districtTrigger:menu).current?.focus();}}
  function outside(event:PointerEvent){if(!header.current?.contains(event.target as Node)){setOpen(false);setDistricts(false);}}
  window.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);return()=>{window.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
 },[open,districts]);
 if(path.startsWith("/admin"))return null;
 const close=()=>{setOpen(false);setDistricts(false);};
 const links=[["/feedback",t("Feedback","Phản hồi")]];
 return <header className="site-header rental-site-header" ref={header}>
  <div className="top-strip"><div className="container rental-header-band"><div className="rental-band-contact"><BackNavigation/><a className="top-strip-phone" href={`tel:${content.settings.contact_phone.replace(/[^+\d]/g,"")}`}><Phone size={16}/><span>{content.settings.contact_phone}</span></a><LanguageSwitcher className="desktop-band-control"/></div><div className="top-strip-actions"><FavouritesDropdown onOpen={close}/><HeaderPortals onFollow={close}/></div></div></div>
  <div className="header-nav"><div className="container header-inner"><Brand/><nav className={open?"main-nav nav-open":"main-nav"} id="site-navigation" aria-label={t("Main navigation","Điều hướng chính")}><div className="district-navigation"><button ref={districtTrigger} type="button" aria-expanded={districts} aria-controls="apartment-districts" onClick={()=>setDistricts(!districts)}>{t("Apartments","Căn hộ")}<ChevronDown size={13}/></button>{districts&&<div className="district-dropdown" id="apartment-districts"><Link href="/homes?type=Apartment" onClick={close}>{t("All apartments","Tất cả căn hộ")}<ArrowUpRight size={14}/></Link>{content.neighbourhoods.map(n=><Link key={n.slug} href={`/homes?type=Apartment&district=${n.slug}`} onClick={close}>{n.name}<ArrowUpRight size={13}/></Link>)}</div>}</div>{links.map(([href,label])=><Link key={href} href={href} onClick={close}>{label}</Link>)}<div className="mobile-nav-tools"><div className="mobile-nav-portals"><HeaderPortals mobile onFollow={close}/></div><div className="mobile-nav-language"><span>{t("Language","Ngôn ngữ")}</span><LanguageSwitcher/></div></div></nav><div className="header-actions"><Link className="button button-small header-contact" href="/contact">{t("Contact","Liên hệ")}<ArrowUpRight size={15}/></Link><button ref={menu} className="mobile-menu icon-button" type="button" aria-label={open?t("Close menu","Đóng menu"):t("Open menu","Mở menu")} aria-controls="site-navigation" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?<X/>:<Menu/>}</button></div></div></div>
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
 ];
 const company:FooterItem[]=[
  {href:"/activities?category=team",label:t("Our team","Đội ngũ")},
  {href:"/feedback",label:t("Feedback","Phản hồi")},
  {href:"/about",label:t("About us","Về chúng tôi")},
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
   <div className="footer-intro"><Brand light/><p>{t("Serviced apartments and property rentals in Hanoi. Contact Gary Home for current availability and lease terms.","Căn hộ dịch vụ và bất động sản cho thuê tại Hà Nội. Liên hệ Gary Home để xác nhận tình trạng và điều kiện thuê.")}</p><div className="footer-desktop-address">{address}</div></div>
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
