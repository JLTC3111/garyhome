"use client";
import { useId, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";
import { areaPage, areaPhotograph, browseAreas } from "@/lib/areas";
import BounceCards from "./react-bits/bounce-cards";
import { useSite } from "./site-context";

export function DistrictGallery() {
  const { content, t, language } = useSite(), [requestedPage, setPage] = useState(0), id = useId();
  const areas = browseAreas(content.neighbourhoods, content.properties), { cards, page, pages, start, end } = areaPage(areas, requestedPage);
  return <div className="district-gallery">
    <div id={id} className="district-gallery-stage">
      <BounceCards key={page} label={t("Explore Hanoi districts and communities", "Khám phá các khu vực và cộng đồng Hà Nội")} cards={cards.map(area => {
        const photo = areaPhotograph(area.image);
        return { id: area.slug, href: area.href, image: photo.src, srcSet: photo.srcSet,
          sizes: "(max-width: 899px) calc((100vw - 70px) / 2), 200px", title: area.name,
          content: <><p>{language === "vi" ? area.tagline_vi : area.tagline_en}</p><small>{area.collection ? `${area.count} ${t("communities", "khu đô thị")}` : area.count ? `${area.count} ${t("homes to explore", "căn nhà để khám phá")}` : t("Enquire about this area", "Hỏi nhà thuê tại đây")}<ArrowUpRight size={14}/></small></> };
      })}/>
    </div>
    {pages > 1 && <nav className="district-pagination" aria-label={t("Browse more Hanoi areas", "Xem thêm khu vực Hà Nội")}>
      <button type="button" aria-controls={id} aria-label={t("Previous areas", "Các khu vực trước")} disabled={page === 0} onClick={() => setPage(page - 1)}><ArrowLeft size={18}/></button>
      <div className="district-page-numbers">{Array.from({ length: pages }, (_, index) => <button key={index} type="button" aria-controls={id} aria-current={index === page ? "page" : undefined} aria-label={`${t("Area group", "Nhóm khu vực")} ${index + 1}`} onClick={() => setPage(index)}>{index + 1}</button>)}</div>
      <button type="button" aria-controls={id} aria-label={t("Next areas", "Các khu vực tiếp theo")} disabled={page === pages - 1} onClick={() => setPage(page + 1)}><ArrowRight size={18}/></button>
    </nav>}
    <p className="district-page-status" role="status" aria-live="polite" aria-atomic="true">{t("Areas", "Khu vực")} {areas.length ? start + 1 : 0}–{end} {t("of", "/")} {areas.length}</p>
  </div>;
}
