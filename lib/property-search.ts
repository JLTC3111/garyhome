import type { Property } from "./types";
export type Filters = { q?: string; district?: string; type?: string; max?: string; beds?: string; amenity?: string; listing?: string; sort?: string };
export function normalize(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"); }
export function filterProperties(properties: Property[], filters: Filters): Property[] {
  const terms = normalize(filters.q || "").trim().split(/\s+/).filter(Boolean);
  const found = properties.filter(p => {
    if (p.status !== "published" || p.availability === "rented" || p.availability === "sold") return false;
    const haystack = normalize([p.title_en,p.title_vi,p.address,p.district_slug,p.property_type,...p.amenities].join(" "));
    return terms.every(term => haystack.includes(term)) &&
      (!filters.district || p.district_slug === filters.district) &&
      (!filters.type || p.property_type === filters.type) &&
      (!filters.max || (p.price !== null && p.price <= Number(filters.max))) &&
      (!filters.beds || p.bedrooms >= Number(filters.beds)) &&
      (!filters.amenity || p.amenities.includes(filters.amenity)) &&
      (!filters.listing || p.listing_type === filters.listing);
  });
  return found.sort((a,b) => {
    if (filters.sort === "price-low") return (a.price ?? Infinity)-(b.price ?? Infinity);
    if (filters.sort === "price-high") return (b.price ?? -Infinity)-(a.price ?? -Infinity);
    if (filters.sort === "newest") return b.created_at.localeCompare(a.created_at);
    return Number(b.featured)-Number(a.featured) || a.sort_order-b.sort_order;
  });
}
