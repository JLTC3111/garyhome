-- Existing installations finish this step after deploying the clients that
-- read home_public_properties. Fresh setups already use the current clients.
begin;
-- Customer favourites still validate against the published catalogue.
alter policy saved_insert_self on public.saved_homes with check (
  user_id=(select auth.uid()) and exists(
    select 1 from public.home_public_properties p where p.id=property_id
  )
);
alter policy saved_rental_only on public.saved_homes with check (
  exists(select 1 from public.home_public_properties p where p.id=property_id)
);

drop policy properties_public_read on public.properties;
revoke select on public.properties from public,anon;

-- Keep the catalogue of object keys staff-only. The existing public bucket
-- URLs still serve published files without a Storage table SELECT.
create policy home_listing_media_no_anon_catalogue on storage.objects as restrictive for select to anon
  using (bucket_id not in ('property-media','listing-videos'));
create policy home_listing_media_staff_catalogue on storage.objects as restrictive for select to authenticated
  using (bucket_id not in ('property-media','listing-videos') or (select private.is_editor()));

notify pgrst,'reload schema';
commit;
