import type { ExchangeRate, PriceCurrency, Property } from "./types";
import { currencyValue } from "./currency.ts";
import { propertyPrice } from "./property-pricing.ts";
import { newestFirst } from "./property-order.ts";
import { canonicalAmenity, isPublicRental, listingCode } from "./rentals.ts";
export type Filters = { q?: string; district?: string; type?: string; min?: string; max?: string; currency?: string; beds?: string; baths?: string; amenity?: string; listing?: string; id?: string; sort?: string };
export function normalize(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d"); }
export function normalizePropertyId(value: string) {
  const id = value.trim().toUpperCase().replace(/[\u2010-\u2015\u2212]/g, "-");
  const number = id.match(/^(?:GH[\s-]*)?(\d{1,12})$/)?.[1];
  return number ? "GH-" + number.replace(/^0+(?=\d)/, "").padStart(6, "0") : id;
}
export function readFilters(params:Pick<URLSearchParams,"entries"|"getAll">):Filters {
  const result=Object.fromEntries(params.entries());delete result.term;delete result.period;const amenities=params.getAll("amenity");
  if(amenities.length)result.amenity=amenities.join(",");return result;
}
export function filterProperties(properties: Property[], filters: Filters, pricing: { currency?: PriceCurrency; exchangeRate?: ExchangeRate | null } = {}): Property[] {
  const terms=normalize(filters.q||"").trim().split(/\s+/).filter(Boolean);
  const requested=(filters.amenity||"").split(",").filter(Boolean).map(canonicalAmenity);
  const found=properties.filter(p=>{
    if(!isPublicRental(p))return false;
    const haystack=normalize([p.title_en,p.title_vi,p.address,p.district_slug,p.property_type,listingCode(p),...p.amenities].join(" "));
    const type=filters.type;
    const matchesType=!type || (type==="Apartment" ? ["Apartment","Studio"].includes(p.property_type) : type==="Villa/Duplex" ? ["Villa/Duplex","House & Villa"].includes(p.property_type) : type==="Vinhomes" ? p.property_type==="Vinhomes" || /vinhomes/i.test(p.title_en+" "+p.title_vi+" "+p.address) : p.property_type===type);
    const id=normalizePropertyId(filters.id||"");const code=normalizePropertyId(listingCode(p));
    const budget=propertyPrice(p,currencyValue(filters.currency),pricing.exchangeRate,false);
    return terms.every(term=>haystack.includes(term)) && matchesType &&
      (!filters.district||p.district_slug===filters.district) &&
      (!(filters.min||filters.max)||(p.price_period||"month")==="month") &&
      (!filters.min||(budget!==null&&(budget.max??budget.min)>=Number(filters.min))) &&
      (!filters.max||(budget!==null&&budget.min<=Number(filters.max))) &&
      (!filters.beds||(filters.beds==="0"?p.bedrooms===0:p.bedrooms>=Number(filters.beds))) &&
      (!filters.baths||(p.bathrooms!==null&&p.bathrooms>=Number(filters.baths))) &&
      requested.every(a=>p.amenities.some(value=>canonicalAmenity(value)===a)) &&
      (!id||code===id||p.id.toUpperCase()===id) &&
      (!filters.listing||filters.listing==="rent");
  });
  const price=(p:Property)=>propertyPrice(p,pricing.currency??currencyValue(filters.currency),pricing.exchangeRate,false)?.min;
  return found.sort((a,b)=>filters.sort==="price-low"?(price(a)??Infinity)-(price(b)??Infinity):filters.sort==="price-high"?(price(b)??-Infinity)-(price(a)??-Infinity):newestFirst(a,b));
}
