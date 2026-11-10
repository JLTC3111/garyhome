import { requireAvailableContent } from "./content-unavailable";
import type { Metadata } from "next";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { loadContent } from "./server";
import { languageValue } from "./language";
import { documentTitle } from "./document-titles";
import { isPublicRental, listingCode, propertyTitle } from "./rentals";
import { runtimeEnv } from "./runtime-env";
import type { Language, Property } from "./types";
import { propertyPriceOffers } from "./property-pricing";
import { localizedAlternates, localizedPath } from "./localized-routes";
import { siteDescription, propertySeoText } from "./seo-text";
export { siteDescription } from "./seo-text";
export const loadPageContent = cache(loadContent);

export async function requestLanguage(): Promise<Language> {
  const explicit = (await headers()).get("x-gary-language");
  return languageValue(explicit === "en" || explicit === "vi" ? explicit : (await cookies()).get("gary-language")?.value);
}
export function siteUrl() {
  const env = runtimeEnv as Record<string, string | undefined>;
  const configured = env.SITE_URL || process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  try { const url = new URL(configured ? (configured.startsWith("https://") ? configured : `https://${configured}`) : "https://gary-home-hanoi.lsd99999999.chatgpt.site"); if (url.protocol !== "https:") throw new Error(); return url.origin; }
  catch { return "https://gary-home-hanoi.lsd99999999.chatgpt.site"; }
}
export const publicPageDescriptions: Record<string, readonly [string, string]> = {
  "/": [siteDescription("en"), siteDescription("vi")],
  "/homes": ["Browse Gary Home rental listings in Hanoi. Filter apartments, houses and offices by neighbourhood, price and amenities, then request a viewing.", "Xem tin cho thuê Gary Home tại Hà Nội. Lọc căn hộ, nhà và văn phòng theo khu vực, giá, tiện nghi và gửi yêu cầu xem nhà."],
  "/neighbourhoods": ["Explore Hanoi neighbourhood guides from Gary Home and compare local areas before choosing a rental home.", "Khám phá cẩm nang khu phố Hà Nội của Gary Home và tìm hiểu từng khu vực trước khi chọn nhà thuê."],
  "/services": ["Explore Gary Home rental services in Hanoi: home search, viewings, landlord enquiries and consultancy for opening restaurants and offices.", "Tìm hiểu dịch vụ Gary Home tại Hà Nội: tìm nhà, xem nhà, hỗ trợ chủ nhà và tư vấn mở nhà hàng, văn phòng."],
  "/vinhomes": ["Explore Gary Home’s Vinhomes Gardenia, Skylake and Smart City rental collection with supplied apartment photos and lease details.", "Khám phá bộ sưu tập căn hộ Vinhomes Gardenia, Skylake và Smart City của Gary Home với ảnh và thông tin thuê được cung cấp."],
  "/tips-and-news": ["Hanoi rental news, neighbourhood notes and practical guides from Gary Home.", "Tin thuê nhà Hà Nội, ghi chép khu vực và cẩm nang thực tế từ Gary Home."],
  "/landlords": ["Introduce your Hanoi rental property to Gary Home and send a landlord enquiry to discuss listing and viewing arrangements.", "Giới thiệu bất động sản cho thuê tại Hà Nội với Gary Home và gửi yêu cầu để trao đổi việc đăng tin, xem nhà."],
  "/contact": ["Contact Gary Home about finding a rental in Hanoi, requesting a property viewing or discussing your housing needs with the team.", "Liên hệ Gary Home để tìm nhà thuê tại Hà Nội, yêu cầu xem bất động sản hoặc trao đổi nhu cầu nhà ở với đội ngũ."],
  "/activities": ["See Gary Home team activities and moments with customers from our work finding rental homes in Hanoi.", "Xem hoạt động của đội ngũ Gary Home và khoảnh khắc cùng khách hàng trong công việc tìm nhà thuê tại Hà Nội."],
  "/feedback": ["Read customer feedback published with permission and Gary Home team replies about rental enquiries and service in Hanoi.", "Đọc phản hồi khách hàng được cho phép công khai cùng trả lời của Gary Home về yêu cầu thuê nhà và dịch vụ tại Hà Nội."],
  "/privacy": ["Learn how Gary Home handles enquiries, customer accounts, saved homes and personal information, and how to request correction or deletion.", "Tìm hiểu cách Gary Home xử lý yêu cầu, tài khoản, nhà yêu thích và thông tin cá nhân; cách yêu cầu chỉnh sửa hoặc xóa dữ liệu."],
  "/credits": ["View photograph and image source credits used on the Gary Home website.", "Xem thông tin tác giả và nguồn ảnh được sử dụng trên website Gary Home."],
};
export async function pageMetadata(path: string, privatePage = false): Promise<Metadata> {
  const language = await requestLanguage(), origin = siteUrl();
  return {
    title: { absolute: documentTitle(path, language, []) || "Gary Home" },
    description: publicPageDescriptions[path]?.[language === "vi" ? 1 : 0] || siteDescription(language),
    alternates: privatePage ? { canonical: origin + path, languages: {} } : localizedAlternates(path, origin, language),
    openGraph: { locale: language === "vi" ? "vi_VN" : "en_US", url: origin + (privatePage ? path : localizedPath(path, language)) },
    robots: privatePage ? { index: false, follow: false } : undefined,
  };
}
export async function propertyMetadata(slug: string): Promise<Metadata> {
  const language = await requestLanguage(), { content } = requireAvailableContent(await loadPageContent());
  const p = content.properties.find(p => p.slug === slug && isPublicRental(p));
  if (!p) return { title: { absolute: language === "vi" ? "Không tìm thấy căn nhà | Gary Home" : "Home not found | Gary Home" }, robots: { index: false, follow: false }, alternates: { canonical: null, languages: {} } };
  const area = content.neighbourhoods.find(n => n.slug === p.district_slug)?.name, { title, description } = propertySeoText(p, language, area);
  const alternates = localizedAlternates("/homes/" + p.slug, siteUrl(), language), url = alternates.canonical;
  return { title: { absolute: title }, description, alternates, openGraph: { title, description, url, locale: language === "vi" ? "vi_VN" : "en_US", images: p.images.map(url => ({ url })) }, twitter: { card: "summary_large_image", title, description, images: p.images.slice(0, 1) } };
}
export function propertyStructuredData(p: Property, language: Language, area?: string) {
  const url = siteUrl() + localizedPath("/homes/" + p.slug, language);
  return { "@context": "https://schema.org", "@type": "RealEstateListing", name: propertyTitle(p, language, area), identifier: listingCode(p), url, inLanguage: language, image: p.images, datePosted: p.published_at || p.created_at, description: language === "vi" ? p.overview_vi || p.description_vi : p.overview_en || p.description_en, mainEntity: { "@type": p.property_type === "Office & Restaurant" ? "Place" : p.property_type === "Villa/Duplex" || p.property_type === "House & Villa" ? "House" : p.property_type === "Vinhomes" ? "Residence" : "Apartment", name: propertyTitle(p, language, area, false), address: { "@type": "PostalAddress", addressLocality: "Hanoi", addressRegion: area || p.address, addressCountry: "VN" }, ...(p.area_sqm ? { floorSize: { "@type": "QuantitativeValue", value: p.area_sqm, unitCode: "MTK" } } : {}), ...(p.property_type !== "Office & Restaurant" ? { numberOfBedrooms: p.bedrooms, ...(p.bathrooms !== null ? { numberOfBathroomsTotal: p.bathrooms } : {}) } : {}) }, ...propertyPriceOffers(p, url) };
}
export async function guideMetadata(slug: string): Promise<Metadata> {
  const { publicArticles, editorialView } = await import("./editorial"), { content } = requireAvailableContent(await loadPageContent());
  const record = publicArticles(content.editorial).find(item => item.slug === slug), language = await requestLanguage();
  if (!record) return { robots: { index: false, follow: false }, alternates: { canonical: null, languages: {} } };
  const guide = editorialView(record), base = await pageMetadata("/tips-and-news/" + slug), index = language === "vi" ? 1 : 0;
  return { ...base, title: { absolute: guide.title[index] + " | Gary Home" }, description: guide.summary[index], openGraph: { ...base.openGraph, type: "article", title: guide.title[index], description: guide.summary[index], ...(record.published_on ? { publishedTime: record.published_on } : {}), ...(record.image_url ? { images: [{ url: record.image_url }] } : {}) } };
}
