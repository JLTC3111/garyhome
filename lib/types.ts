export type Language = "en" | "vi";
export type Property = {
  id: string; slug: string; title_en: string; title_vi: string;
  listing_code?: string; author_id?: string | null;
  price_period?: "month" | "week" | "night";
  rental_term?: "short" | "long" | "both" | "on_request";
  overview_en?: string; overview_vi?: string;
  location_en?: string; location_vi?: string;
  furnishings_en?: string; furnishings_vi?: string; seo_features?: string[];
  description_en: string; description_vi: string; district_slug: string;
  address: string; price: number | null; currency: string;
  listing_type: "rent" | "sale"; property_type: string;
  bedrooms: number; bathrooms: number | null; area_sqm: number | null;
  amenities: string[]; images: string[]; featured: boolean;
  status: "published" | "draft" | "archived";
  availability: "on_request" | "available" | "rented" | "sold";
  published_at?: string|null; source_url: string | null; sort_order: number; created_at: string; updated_at: string;
};
export type Neighbourhood = {
  slug: string; name: string; tagline_en: string; tagline_vi: string;
  description_en: string; description_vi: string; image: string; sort_order: number;
};
export type Settings = {
  id: string; hero_title_en: string; hero_title_vi: string;
  hero_text_en: string; hero_text_vi: string; hero_image: string;
  contact_email: string; contact_phone: string; contact_address: string;
  whatsapp_phone?: string; zalo_phone?: string;
};
export type Enquiry = {
  id: string; property_id: string | null; name: string; email: string;
  phone: string; message: string; preferred_date: string | null;
  kind: "viewing" | "general" | "landlord"; consent: boolean;
  status: "new" | "contacted" | "scheduled" | "closed";
  notes: string; created_at: string;
  user_id?: string | null; appointment_at?: string | null;
  customer_update?: string; cancelled_at?: string | null;
  read_at?: string|null; read_by?: string|null; property_code?:string; property_address?:string;
};
export type CustomerEnquiry = Omit<Enquiry, "notes"|"read_at"|"read_by"|"property_code"|"property_address">;
export type CustomerProfile = {
  user_id: string; full_name: string; email: string; phone: string;
  preferred_district: string | null; budget_min: number | null; budget_max: number | null;
  move_in_date: string | null; preferences: string; updated_at: string;
};
export type CustomerRecord = {
  customer_key: string; user_id: string | null; name: string; email: string; phone: string;
  stage: "new" | "contacted" | "viewing" | "tenant" | "closed";
  follow_up_on: string | null; notes: string; updated_at: string;
};
export type ListingAuthor = {
  id: string; slug: string; display_name: string; bio_en: string; bio_vi: string;
  portrait_url: string; phone: string; whatsapp_phone: string; zalo_phone: string; email: string;
  is_placeholder: boolean; published: boolean; sort_order: number; updated_at: string;
};
export type SiteActivity = {
  id: string; category: "customers" | "feedback" | "team"; media_kind: "photo" | "screenshot";
  caption_en: string; caption_vi: string; image_url: string; source_url: string;
  published: boolean; sort_order: number; updated_at: string;
};
export type PropertyOrderScope="home"|"listings";
export type PropertyOrders=Partial<Record<PropertyOrderScope,string[]>>;
export type Content = { propertyOrders?:PropertyOrders; properties: Property[]; neighbourhoods: Neighbourhood[]; settings: Settings; authors?: ListingAuthor[]; activities?: SiteActivity[] };
