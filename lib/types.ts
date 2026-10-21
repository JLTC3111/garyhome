export type Language = "en" | "vi";
export type Property = {
  id: string; slug: string; title_en: string; title_vi: string;
  description_en: string; description_vi: string; district_slug: string;
  address: string; price: number | null; currency: string;
  listing_type: "rent" | "sale"; property_type: string;
  bedrooms: number; bathrooms: number | null; area_sqm: number | null;
  amenities: string[]; images: string[]; featured: boolean;
  status: "published" | "draft" | "archived";
  availability: "on_request" | "available" | "rented" | "sold";
  source_url: string | null; sort_order: number; created_at: string; updated_at: string;
};
export type Neighbourhood = {
  slug: string; name: string; tagline_en: string; tagline_vi: string;
  description_en: string; description_vi: string; image: string; sort_order: number;
};
export type Settings = {
  id: string; hero_title_en: string; hero_title_vi: string;
  hero_text_en: string; hero_text_vi: string; hero_image: string;
  contact_email: string; contact_phone: string; contact_address: string;
};
export type Enquiry = {
  id: string; property_id: string | null; name: string; email: string;
  phone: string; message: string; preferred_date: string | null;
  kind: "viewing" | "general" | "landlord"; consent: boolean;
  status: "new" | "contacted" | "scheduled" | "closed";
  notes: string; created_at: string;
};
export type Content = { properties: Property[]; neighbourhoods: Neighbourhood[]; settings: Settings };
