begin;

-- Public catalogues use this read-only projection. The staff table retains
-- original upload names and full listing history for authorized editors.
create view public.home_public_properties with (security_barrier=true) as
select id,slug,title_en,title_vi,listing_code,author_id,price_period,rental_term,
       overview_en,overview_vi,location_en,location_vi,furnishings_en,furnishings_vi,seo_features,
       description_en,description_vi,district_slug,address,map_address,price,price_max,currency,
       price_vnd,price_vnd_max,listing_type,property_type,bedrooms,bathrooms,area_sqm,
       amenities,images,image_metadata,video_url,featured,status,availability,published_at,source_url,
       sort_order,created_at,updated_at
from public.properties
where status='published' and listing_type='rent' and availability in ('available','on_request');

revoke all on public.home_public_properties from public,anon,authenticated;
grant select on public.home_public_properties to anon,authenticated;

notify pgrst,'reload schema';
commit;
