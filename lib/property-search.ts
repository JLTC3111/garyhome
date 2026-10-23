import type { Property } from "./types";
import { isPublicRental, listingCode } from "./rentals.ts";
export type Filters = { q?: string; district?: string; type?: string; min?: string; max?: string; beds?: string; baths?: string; amenity?: string; listing?: string; term?: string; period?: string; id?: string; sort?: string };
export function normalize(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d"); }
export function readFilters(params:Pick<URLSearchParams,"entries"|"getAll">):Filters {
  const result=Object.fromEntries(params.entries());const amenities=params.getAll("amenity");
  if(amenities.length)result.amenity=amenities.join(",");return result;
}
export function filterProperties(properties: Property[], filters: Filters): Property[] {
  const terms=normalize(filters.q||"").trim().split(/\s+/).filter(Boolean);
  const requested=(filters.amenity||"").split(",").filter(Boolean);
  const found=properties.filter(p=>{
    if(!isPublicRental(p))return false;
    const haystack=normalize([p.title_en,p.title_vi,p.address,p.district_slug,p.property_type,listingCode(p),...p.amenities].join(" "));
    const type=filters.type;
    const matchesType=!type || (type==="Apartment" ? ["Apartment","Studio"].includes(p.property_type) : type==="Villa/Duplex" ? ["Villa/Duplex","House & Villa"].includes(p.property_type) : type==="Vinhomes" ? p.property_type==="Vinhomes" || /vinhomes/i.test(p.title_en+" "+p.title_vi+" "+p.address) : p.property_type===type);
    const id=(filters.id||"").trim().toUpperCase();const code=listingCode(p).toUpperCase();
    return terms.every(term=>haystack.includes(term)) && matchesType &&
      (!filters.district||p.district_slug===filters.district) &&
      (!filters.min||(p.price!==null&&p.price>=Number(filters.min))) &&
      (!filters.max||(p.price!==null&&p.price<=Number(filters.max))) &&
      (!filters.beds||(filters.beds==="0"?p.bedrooms===0:p.bedrooms>=Number(filters.beds))) &&
      (!filters.baths||(p.bathrooms!==null&&p.bathrooms>=Number(filters.baths))) &&
      requested.every(a=>p.amenities.includes(a)) &&
      (!filters.period||(p.price_period||"month")===filters.period) &&
      (!filters.term||p.rental_term===filters.term||(["short","long"].includes(filters.term)&&p.rental_term==="both")) &&
      (!id||code===id||code===`GH-${id}`||p.id.toUpperCase()===id) &&
      (!filters.listing||filters.listing==="rent");
  });
  return found.sort((a,b)=>filters.sort==="price-low"?(a.price??Infinity)-(b.price??Infinity):filters.sort==="price-high"?(b.price??-Infinity)-(a.price??-Infinity):filters.sort==="newest"?b.created_at.localeCompare(a.created_at):Number(b.featured)-Number(a.featured)||a.sort_order-b.sort_order);
}
