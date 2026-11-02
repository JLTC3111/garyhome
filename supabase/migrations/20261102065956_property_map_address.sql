begin;

-- Authors opt in to publishing a precise map destination. Existing listings
-- keep this null and use their public street / area as an approximate view.
alter table public.properties add column map_address text
  constraint properties_map_address_check
  check (map_address is null or (btrim(map_address)<>'' and char_length(map_address)<=300));
comment on column public.properties.map_address is
  'Optional public exact map address or latitude,longitude. Null uses an approximate map of the public location.';

-- This public field inherits the properties table public-read / staff-write
-- permissions and the existing updated_at version trigger.
notify pgrst,'reload schema';
commit;
