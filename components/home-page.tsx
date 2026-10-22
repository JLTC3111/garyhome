"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Camera, CheckCheck, HeartHandshake, Home, KeyRound, MapPin } from "lucide-react";
import { useSite } from "./site-context";
import { SearchForm } from "./search-form";
import { PropertyCard } from "./property-card";
import { HomeFaq } from "./home-faq";
import { BlurFade } from "./magicui/blur-fade";
import { NumberTicker } from "./magicui/number-ticker";
import { AnimatedBackground } from "./motion-primitives/animated-background";
import { SpotlightCard } from "./react-bits/spotlight-card";
import { filterProperties } from "@/lib/property-search";

export function HomePage() {
  const { content, t, language } = useSite();
  const [category, setCategory] = useState("");
  const published = filterProperties(content.properties, {});
  const chosen = filterProperties(content.properties, { type: category }).slice(0, 3);
  const heading = (language === "en" ? content.settings.hero_title_en : content.settings.hero_title_vi).split("\n");
  const categories = [
    ["", t("All homes", "Tất cả")],
    ["Apartment", t("Apartments", "Căn hộ")],
    ["Studio", t("Studios", "Studio")],
    ["House & Villa", t("Houses & villas", "Nhà & biệt thự")],
  ];
  const steps = [
    ["01", t("We listen first.", "Lắng nghe trước tiên."), t("Your routine, your budget, your must-haves. A home should fit your life.", "Nhịp sống, ngân sách, điều bạn cần. Nhà phải phù hợp với bạn.")],
    ["02", t("We know the neighbourhood.", "Am hiểu từng khu phố."), t("Local guidance from people who call Hanoi home, too.", "Lời khuyên thực tế từ những người cũng gọi Hà Nội là nhà.")],
    ["03", t("We stay by your side.", "Đồng hành cùng bạn."), t("From your first shortlist to the viewing and lease questions that follow.", "Từ danh sách yêu thích đến lịch xem nhà và những câu hỏi về hợp đồng.")],
  ];

  return <>
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <div className="eyebrow"><span/>{t("GOOD PLACES. BETTER BEGINNINGS.", "MỘT NƠI TỐT. KHỞI ĐẦU ĐẸP.")}</div>
          <h1>{heading[0]}<br/><em>{heading[1] || ""}</em></h1>
          <p>{language === "en" ? content.settings.hero_text_en : content.settings.hero_text_vi}</p>
          <div className="hero-location"><MapPin size={17}/>{t("Rooted in Hanoi. Here for you.", "Am hiểu Hà Nội. Đồng hành cùng bạn.")}</div>
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
    <div className="trust-strip container">
      <span><Camera size={18}/>{t("Real homes. Real photos.", "Nhà thật. Ảnh thực tế.")}</span>
      <span><HeartHandshake size={19}/>{t("Local people, personal support.", "Đội ngũ địa phương, hỗ trợ tận tâm.")}</span>
      <span><CheckCheck size={19}/>{t("Clear details, from the start.", "Thông tin rõ ràng, ngay từ đầu.")}</span>
    </div>

    <section className="section container featured-section">
      <BlurFade className="section-heading"><div><div className="eyebrow">{t("THE SHORTLIST", "BỘ SƯU TẬP CHỌN LỌC")}</div><h2>{t("Good spaces. Great possibilities.", "Không gian đẹp. Khởi đầu mới.")}</h2><p>{t("A few homes we think you’ll love. The next chapter is yours.", "Những căn nhà có thể bạn sẽ yêu. Chương tiếp theo là của bạn.")}</p></div><Link className="text-link" href="/homes">{t("Explore all homes", "Khám phá tất cả")}<ArrowUpRight size={19}/></Link></BlurFade>
      <div className="category-tabs" role="group" aria-label={t("Property categories", "Loại bất động sản")}>
        <AnimatedBackground activeValue={category}>{categories.map(([value, label]) => <button type="button" data-id={value} className={category === value ? "selected" : ""} key={value} onClick={() => setCategory(value)} aria-pressed={category === value}>{label}</button>)}</AnimatedBackground>
      </div>
      <p className="sr-only" role="status">{t(`Showing ${chosen.length} homes`, `Hiển thị ${chosen.length} căn nhà`)}</p>
      {chosen.length ? <div className="property-grid">{chosen.map(p => <PropertyCard key={p.id} property={p}/>)}</div> : <div className="empty-state"><Home size={30}/><h3>{t("Your next home could be on its way.", "Ngôi nhà tiếp theo có thể sắp xuất hiện.")}</h3><p>{t("Tell us what you’re looking for. Our team can help with a personal search.", "Chia sẻ nhu cầu để đội ngũ hỗ trợ tìm nhà riêng cho bạn.")}</p><Link className="button" href="/contact">{t("Talk to the team", "Liên hệ đội ngũ")}<ArrowRight size={17}/></Link></div>}
    </section>

    <section className="neighbourhood-section"><div className="container section">
      <BlurFade className="section-heading"><div><div className="eyebrow">{t("FIND YOUR KIND OF HANOI", "TÌM MỘT HÀ NỘI CỦA RIÊNG BẠN")}</div><h2>{t("A neighbourhood to call your own.", "Một khu phố để gọi là nhà.")}</h2><p>{t("Lakeside mornings or city-centre energy. Where do you feel at home?", "Bình yên bên hồ hay nhịp sống phố thị. Đâu là nơi dành cho bạn?")}</p></div><Link className="text-link" href="/neighbourhoods">{t("Meet the neighbourhoods", "Khám phá khu vực")}<ArrowUpRight size={19}/></Link></BlurFade>
      <div className="neighbourhood-grid neighbourhood-bento">{content.neighbourhoods.slice(0, 4).map((n, i) => <Link className={`neighbourhood-card neighbourhood-${i}`} key={n.slug} href={`/homes?district=${n.slug}`}>
        <img src={n.image} alt={n.name + ", Hà Nội"} loading="lazy" width="700" height="520"/>
        <div className="neighbourhood-overlay"><span className="area-count"><NumberTicker value={published.filter(p => p.district_slug === n.slug).length}/> {t("homes to explore", "căn nhà để khám phá")}</span><h3>{n.name}</h3><p>{language === "vi" ? n.tagline_vi : n.tagline_en}</p></div>
        <span className="round-arrow"><ArrowUpRight size={23}/></span>
      </Link>)}</div>
    </div></section>

    <section className="section container gary-way" id="why-gary">
      <BlurFade className="gary-way-image"><img src="/images/gary-way.jpg" alt={t("Gary Home’s real apartment interior with natural light", "Không gian căn hộ thực tế của Gary Home với ánh sáng tự nhiên")} loading="lazy" width="700" height="750"/><div className="handwritten">{t("A fresh start.\nA familiar feeling.", "Khởi đầu mới.\nCảm giác thân quen.")}</div></BlurFade>
      <div className="gary-way-copy"><div className="eyebrow">{t("THE GARY WAY", "CÁCH GARY ĐỒNG HÀNH")}</div><h2>{t("Finding a home should feel like a good beginning.", "Hành trình tìm nhà là một khởi đầu đẹp.")}</h2><p>{t("Moving is a big step. We’re here for the small details, the honest conversations, and everything that makes your next place feel like home.", "Chuyển nhà là một bước ngoặt lớn. Chúng tôi ở đây để chăm chút từng chi tiết, lắng nghe chân thành và giúp nơi ở mới trở thành tổ ấm.")}</p>
        {steps.map(([number, title, text]) => <SpotlightCard className="way-item" key={number}><span className="way-number">{number}</span><div><h3>{title}</h3><p>{text}</p></div></SpotlightCard>)}
        <Link className="text-link" href="/about">{t("Get to know Gary Home", "Tìm hiểu Gary Home")}<ArrowUpRight size={18}/></Link>
      </div>
    </section>

    <HomeFaq/>
    <section className="contact-cta container"><div className="cta-doodle" aria-hidden="true"><KeyRound size={66} strokeWidth={1}/></div><div><div className="eyebrow">{t("LET’S MAKE YOURSELF AT HOME", "CÙNG TÌM NƠI THUỘC VỀ BẠN")}</div><h2>{t("Your next chapter starts with a hello.", "Chương mới bắt đầu bằng một lời chào.")}</h2><p>{t("Tell us a little about your plans. We’ll help you find your place.", "Chia sẻ một chút về kế hoạch của bạn. Cùng chúng tôi tìm tổ ấm mới.")}</p></div><Link className="button interactive-cta" href="/contact">{t("Let’s find your home", "Cùng tìm nhà")}<ArrowUpRight size={18}/></Link></section>
  </>;
}
