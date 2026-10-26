import photographs from "../data/neighbourhood-photos.json" with { type: "json" };
import projects from "../data/vinhomes.json" with { type: "json" };
import { isPublicRental } from "./rentals.ts";
import type { Language, Neighbourhood, Property } from "./types";

export type BrowseArea = Neighbourhood & { href: string; count: number; collection: boolean };

// Keep CMS ordering, but make the Vinhomes collection discoverable on the first page.
// A collection is deliberately not a selectable/fictitious district in the database.
export function browseAreas(neighbourhoods: Neighbourhood[], properties: Property[]): BrowseArea[] {
  const publicRentals = properties.filter(isPublicRental);
  const areas: BrowseArea[] = [...neighbourhoods].sort((a, b) => a.sort_order - b.sort_order).map(area => {
    const count = publicRentals.filter(property => property.district_slug === area.slug).length;
    return { ...area, count, collection: false, href: count ? `/homes?district=${encodeURIComponent(area.slug)}` : `/contact?area=${encodeURIComponent(area.slug)}` };
  });
  areas.splice(Math.min(3, areas.length), 0, {
    slug: "vinhomes", name: "Vinhomes", image: "/images/neighbourhoods/vinhomes.jpg", sort_order: 3,
    tagline_en: "Explore the Vinhomes collection.", tagline_vi: "Khám phá bộ sưu tập Vinhomes.",
    description_en: "Explore Gardenia, Skylake and Smart City through the team’s supplied photographs and rental notes. Contact Gary Home to confirm availability and current terms.",
    description_vi: "Khám phá Gardenia, Skylake và Smart City qua ảnh cùng thông tin thuê do đội ngũ cung cấp. Liên hệ Gary Home để xác nhận tình trạng và điều kiện hiện tại.",
    count: new Set(projects.map(project => project.slug)).size, collection: true, href: "/vinhomes",
  });
  return areas;
}

// Use the small source for cards, while retaining high-resolution sources for guides.
// CMS-uploaded replacements retain their own URL instead of using a stale local preview.
export function areaPhotograph(image: string) {
  const photo = photographs.find(item => item.image === image);
  return photo ? { src: photo.preview, srcSet: `${photo.preview} ${photo.preview_width}w, ${photo.image} ${photo.width}w`, width: photo.width, height: photo.height } : { src: image, srcSet: undefined, width: 900, height: 650 };
}

export function areaEnquiry(slug: string | null, neighbourhoods: Neighbourhood[], language: Language) {
  const area = neighbourhoods.find(item => item.slug === slug);
  return area ? `${language === "vi" ? "Tìm nhà thuê tại" : "Rental search in"} ${area.name}` : "";
}

export const AREAS_PER_PAGE = 4;
export function areaPage(areas: BrowseArea[], requested: number) {
  const pages = Math.max(1, Math.ceil(areas.length / AREAS_PER_PAGE));
  const page = Math.min(pages - 1, Math.max(0, Math.floor(requested) || 0));
  const start = page * AREAS_PER_PAGE;
  return { cards: areas.slice(start, start + AREAS_PER_PAGE), page, pages, start, end: Math.min(start + AREAS_PER_PAGE, areas.length) };
}
