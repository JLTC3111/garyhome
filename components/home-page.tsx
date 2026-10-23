"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Home, MapPin } from "lucide-react";
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
 const published=rentals;
 const heading=(language==="vi"?content.settings.hero_title_vi:content.settings.hero_title_en).split("\n");
 return <>
  <section className="hero restored-hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span/>{t("GOOD PLACES. BETTER BEGINNINGS.", "MỘT NƠI TỐT. KHỞI ĐẦU ĐẸP.")}</div>
          <h1 className="hero-headline">{heading.flatMap((line, index) => [index > 0 ? "\n" : null, <TechText
            key={language+index+line}
            text={line}
            className={index > 0 ? "hero-headline-accent" : ""}
            style={{ fontStyle: index > 0 ? "italic" : "normal" }}
            fontWeight={600}
            fontSize={150}
            align="left"
            reveal="letter"
            dashLength={4}
            dashGap={2}
            specks={15}
            intro="none"
            introDuration={2}
            clickKick
            guides={false}
            sweep={false}
            labels={false}
            draggable={false}
            fitToText
          />])}</h1>
          <p>{language === "en" ? content.settings.hero_text_en : content.settings.hero_text_vi}</p>
          <div className="hero-location"><MapPin size={17}/>{t("Rooted in Hanoi. Here for you.", "Am Hiểu Hà Nội. Đồng Hành Cùng Bạn.")}</div>
          <div className="hero-collection">
            <span className="collection-avatars" aria-hidden="true">{published.slice(0, 3).map(p => <img key={p.id} src={p.images[0] || "/images/hero.jpg"} alt="" width="36" height="36"/>)}</span>
            <span><strong><NumberTicker value={published.length}/></strong> {t("homes to discover", "căn nhà để khám phá")}<small>{t("Your next chapter, thoughtfully chosen.", "Chọn tổ ấm cho chương mới của bạn.")}</small></span>
          </div>
        </div>
        <div className="hero-visual">
          <img className="hero-photo" src={content.settings.hero_image} alt={t("Light-filled Gary Home apartment with a dining area and leafy views in Tây Hồ", "Căn hộ Gary Home đầy ánh sáng, có bàn ăn và tầm nhìn xanh tại Tây Hồ")} width="900" height="680" fetchPriority="high"/>
          <div className="hero-photo-label"><span className="live-dot"/>{t("A LITTLE PIECE OF HANOI", "MỘT GÓC NHỎ HÀ NỘI")}</div>
          <div className="hero-note"><span className="hero-note-icon"><Home size={21}/></span><span>{t("More than an address.", "Hơn một địa chỉ.")}<strong>{t("A place to belong.", "Là nơi thuộc về.")}</strong></span><svg viewBox="0 0 54 44" aria-hidden="true"><path d="M2 39C18 44 40 29 39 12c-1-13-15-14-17-4-3 14 18 22 28 11m-9-2 10 1-2 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg></div>
        </div>
      </div>
      <div className="container hero-search">
        <SearchForm/>
        <div className="popular-search"><span>{t("A little inspiration:", "Gợi ý cho bạn:")}</span><Link href="/homes?district=tay-ho">Tây Hồ</Link><span>·</span><Link href="/homes?district=ba-dinh">Ba Đình</Link><span>·</span><Link href="/homes?max=600">{t("Under $600", "Dưới $600")}</Link><span>·</span><Link href="/homes?amenity=Balcony">{t("A balcony, please", "Có ban công")}</Link></div>
      </div>
    </section>
  <section className="section container rental-featured"><BlurFade className="section-heading"><div><div className="eyebrow">{t("AVAILABLE TO DISCOVER","KHÁM PHÁ NHÀ CHO THUÊ")}</div><h2>{t("Find your next rental in Hanoi.","Tìm nhà thuê tiếp theo tại Hà Nội.")}</h2><p>{t("Compare property details, keep your favourites and request a viewing.","So sánh thông tin, lưu yêu thích và đặt lịch xem nhà.")}</p></div><Link className="text-link" href="/homes">{t("View all rentals","Tất cả nhà cho thuê")}<ArrowUpRight size={18}/></Link></BlurFade><div className="property-grid">{featured.map(p=><PropertyCard key={p.id} property={p}/>)}</div>{!featured.length&&<div className="empty-state"><h3>{t("Tell us what you’re looking for.","Chia sẻ nhu cầu tìm nhà của bạn.")}</h3><Link className="button" href="/contact">{t("Contact Gary Home","Liên hệ Gary Home")}<ArrowRight size={16}/></Link></div>}</section>
  <section className="rental-area-section"><div className="section container"><div className="section-heading"><div><div className="eyebrow">{t("DISTRICTS & NEIGHBOURHOODS","QUẬN & KHU VỰC")}</div><h2>{t("Choose your part of Hanoi.","Chọn khu vực bạn muốn sống.")}</h2></div><Link className="text-link" href="/neighbourhoods">{t("Explore areas","Khám phá khu vực")}<ArrowUpRight size={18}/></Link></div><div className="rental-area-grid">{content.neighbourhoods.map(n=><Link className="rental-area-card" key={n.slug} href={`/homes?district=${n.slug}`}><img src={n.image} alt={n.name+", Hà Nội"} width="500" height="340" loading="lazy"/><div><h3>{n.name}</h3><span>{rentals.filter(p=>p.district_slug===n.slug).length} {t("rentals","nhà cho thuê")}</span><ArrowUpRight size={20}/></div></Link>)}</div></div></section>
  <Activities/>
  <HomeFaq/>
  <section className="container rental-home-contact"><div><div className="eyebrow">GARY HOME</div><h2>{t("Let’s arrange your next viewing.","Cùng sắp xếp buổi xem nhà tiếp theo.")}</h2><p>{t("Send your preferred properties and let the team confirm availability and lease terms.","Gửi những căn nhà bạn quan tâm để đội ngũ xác nhận tình trạng và điều kiện thuê.")}</p></div><Link className="button" href="/contact">{t("Contact us","Liên hệ")}<ArrowUpRight size={18}/></Link></section>
 </>;
}
