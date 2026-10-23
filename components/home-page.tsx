"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CheckCheck, MapPin, Phone } from "lucide-react";
import { useSite } from "./site-context";
import { SearchForm } from "./search-form";
import { PropertyCard } from "./property-card";
import { HomeFaq } from "./home-faq";
import { Activities } from "./activities";
import { BlurFade } from "./magicui/blur-fade";
import { NumberTicker } from "./magicui/number-ticker";
import TechText from "./react-bits/tech-text";
import { filterProperties } from "@/lib/property-search";
export function HomePage(){
 const {content,t,language}=useSite();const rentals=filterProperties(content.properties,{}),featured=rentals.slice(0,6);
 const headline=language==="vi"?content.settings.hero_title_vi:content.settings.hero_title_en;
 return <>
  <section className="hero rental-hero"><div className="container rental-hero-grid"><div className="rental-hero-copy"><div className="eyebrow"><span/>{t("RENT WITH GARY HOME","THUÊ NHÀ CÙNG GARY HOME")}</div><h1><TechText key={language+headline} text={headline} fontWeight={600} fontSize={150} fitToText align="left" reveal="letter" dashLength={4} dashGap={2} specks={15} intro="none" introDuration={2} clickKick guides={false} labels={false} draggable={false} sweep={false}/></h1><p>{language==="vi"?content.settings.hero_text_vi:content.settings.hero_text_en}</p><div className="rental-hero-location"><MapPin size={17}/>Hà Nội, Việt Nam <span>·</span><strong><NumberTicker value={rentals.length}/></strong> {t("rentals to explore","bất động sản cho thuê")}</div><a className="rental-hero-call" href={`tel:${content.settings.contact_phone.replace(/[^+\d]/g,"")}`}><Phone size={18}/>{t("Speak with Gary Home","Trao đổi cùng Gary Home")} <strong>{content.settings.contact_phone}</strong></a></div><div className="rental-hero-photo"><img src={content.settings.hero_image} alt={t("A Gary Home apartment in Hanoi","Căn hộ Gary Home tại Hà Nội")} width="900" height="680" fetchPriority="high"/><span><CheckCheck size={16}/>{t("Original property photographs","Hình ảnh bất động sản thực tế")}</span></div></div><div className="container hero-search"><SearchForm/><div className="popular-search"><span>{t("Popular areas:","Khu vực phổ biến:")}</span>{content.neighbourhoods.map(n=><Link key={n.slug} href={`/homes?district=${n.slug}`}>{n.name}</Link>)}</div></div></section>
  <section className="section container rental-featured"><BlurFade className="section-heading"><div><div className="eyebrow">{t("AVAILABLE TO DISCOVER","KHÁM PHÁ NHÀ CHO THUÊ")}</div><h2>{t("Find your next rental in Hanoi.","Tìm nhà thuê tiếp theo tại Hà Nội.")}</h2><p>{t("Compare property details, keep your favourites and build a viewing cart.","So sánh thông tin, lưu yêu thích và tạo giỏ xem nhà.")}</p></div><Link className="text-link" href="/homes">{t("View all rentals","Tất cả nhà cho thuê")}<ArrowUpRight size={18}/></Link></BlurFade><div className="property-grid">{featured.map(p=><PropertyCard key={p.id} property={p}/>)}</div>{!featured.length&&<div className="empty-state"><h3>{t("Tell us what you’re looking for.","Chia sẻ nhu cầu tìm nhà của bạn.")}</h3><Link className="button" href="/contact">{t("Contact Gary Home","Liên hệ Gary Home")}<ArrowRight size={16}/></Link></div>}</section>
  <section className="rental-area-section"><div className="section container"><div className="section-heading"><div><div className="eyebrow">{t("DISTRICTS & NEIGHBOURHOODS","QUẬN & KHU VỰC")}</div><h2>{t("Choose your part of Hanoi.","Chọn khu vực bạn muốn sống.")}</h2></div><Link className="text-link" href="/neighbourhoods">{t("Explore areas","Khám phá khu vực")}<ArrowUpRight size={18}/></Link></div><div className="rental-area-grid">{content.neighbourhoods.map(n=><Link className="rental-area-card" key={n.slug} href={`/homes?district=${n.slug}`}><img src={n.image} alt={n.name+", Hà Nội"} width="500" height="340" loading="lazy"/><div><h3>{n.name}</h3><span>{rentals.filter(p=>p.district_slug===n.slug).length} {t("rentals","nhà cho thuê")}</span><ArrowUpRight size={20}/></div></Link>)}</div></div></section>
  <Activities/>
  <HomeFaq/>
  <section className="container rental-home-contact"><div><div className="eyebrow">GARY HOME</div><h2>{t("Let’s arrange your next viewing.","Cùng sắp xếp buổi xem nhà tiếp theo.")}</h2><p>{t("Send your preferred properties and let the team confirm availability and lease terms.","Gửi những căn nhà bạn quan tâm để đội ngũ xác nhận tình trạng và điều kiện thuê.")}</p></div><Link className="button" href="/contact">{t("Contact us","Liên hệ")}<ArrowUpRight size={18}/></Link></section>
 </>;
}
