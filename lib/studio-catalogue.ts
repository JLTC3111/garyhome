// Keep sortable fields, ordering keys, and the photo list used by Studio KPI
// and media tools. Editors fetch the full row before opening a saved listing.
export const STUDIO_PROPERTY_FIELDS = "id,slug,listing_code,title_en,title_vi,author_id,description_en,description_vi,district_slug,address,map_address,price,price_max,currency,price_vnd,price_vnd_max,price_period,rental_term,listing_type,property_type,bedrooms,bathrooms,area_sqm,amenities,images,video_url,featured,status,availability,published_at,source_url,sort_order,created_at,updated_at";

export const STUDIO_REFRESH_AGE_MS = 5 * 60 * 1000;
