"use client";
import { localizedPath } from "@/lib/localized-routes";
import { SeoEditorPanel } from "./seo-editor-panel";
import { useSite } from "./site-context";
import { propertySeoText, siteDescription } from "@/lib/seo-text";
import { documentTitle } from "@/lib/document-titles";
import { propertyTitle } from "@/lib/rentals";
import type { Property, Settings } from "@/lib/types";

export function PropertySeoPanel({ property }: { property: Property }) {
  const { publicOrigin, content, t } = useSite();
  const area = content.neighbourhoods.find(row => row.slug === property.district_slug);
  return <SeoEditorPanel key={property.id} inputs={(["en", "vi"] as const).map(language => {
    const heading = propertyTitle(property, language, area?.name);
    return {
      url: new URL(localizedPath(`/homes/${property.slug}`, language), publicOrigin).href, language,
      ...propertySeoText(property, language, area?.name),
      text: [language === "vi" ? property.overview_vi || property.description_vi : property.overview_en || property.description_en,
        language === "vi" ? property.location_vi || area?.description_vi : property.location_en || area?.description_en,
        language === "vi" ? property.furnishings_vi : property.furnishings_en].filter(Boolean).join("\n\n"),
      headings: [{ level: 1, text: heading }],
      // These are the actual gallery's generated alternatives; per-image alt
      // editing does not exist in the current CMS.
      images: property.images.map((src, index) => ({ src, alt: index ? `${heading} · ${index + 1}` : heading })),
      links: [],
    };
  })} note={t("Preview uses the same title and description helpers as the published Metadata API. Gallery alt text is generated from the title; review individual images in the published audit. Related listings and shared navigation are checked after publication.", "Xem trước dùng cùng hàm tiêu đề và mô tả với Metadata API. Alt ảnh được tạo từ tiêu đề; hãy kiểm tra từng ảnh trong báo cáo trang đã đăng. Tin liên quan và điều hướng chung được kiểm tra sau khi đăng.")}/>;
}

export function HomepageSeoPanel({ settings }: { settings: Settings }) {
  const { publicOrigin, t } = useSite();
  return <SeoEditorPanel inputs={(["en", "vi"] as const).map(language => ({
    url: new URL(localizedPath("/", language), publicOrigin).href, language, title: documentTitle("/", language, []) || "Gary Home",
    description: siteDescription(language),
    text: language === "vi" ? settings.hero_text_vi : settings.hero_text_en,
    headings: [{ level: 1, text: language === "vi" ? settings.hero_title_vi : settings.hero_title_en }],
    images: [], links: [],
  }))} note={t("This review covers the editable homepage introduction. The search title and description come from the existing Metadata API. Scan the published homepage for the complete page, images and links.", "Kiểm tra phần giới thiệu trang chủ có thể chỉnh sửa. Tiêu đề và mô tả tìm kiếm lấy từ Metadata API hiện có. Quét trang chủ đã đăng để kiểm tra toàn bộ nội dung, ảnh và liên kết.")}/>;
}
