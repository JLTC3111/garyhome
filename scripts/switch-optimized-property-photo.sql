-- Manual maintenance helper. Load in the approving database operator's
-- session after verifying both objects through Storage. No persistent RPC,
-- grant change, Storage write, or data mutation runs when loading this file.
create or replace function pg_temp.optimized_photo_reference(uri text, origin text, old_key text, new_uri text)
returns text language sql stable security invoker set search_path='' as $$
  select case when starts_with(uri,origin||'/storage/v1/render/image/public/property-media/')
    and private.home_photo_key(uri,origin)=old_key then new_uri
    else private.home_photo_replacement(uri,origin,old_key,new_uri) end;
$$;

create or replace function pg_temp.optimized_photo_fields(fields jsonb, origin text, old_key text, new_uri text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; map_name text; mapped jsonb; collision boolean;
begin
  result:=jsonb_build_object(
    'images',(select coalesce(jsonb_agg(pg_temp.optimized_photo_reference(uri,origin,old_key,new_uri) order by ord),'[]'::jsonb)
      from jsonb_array_elements_text(fields->'images') with ordinality i(uri,ord)),
    'source_url',pg_temp.optimized_photo_reference(fields->>'source_url',origin,old_key,new_uri));
  foreach map_name in array array['image_metadata','image_filenames'] loop
    select coalesce(jsonb_object_agg(output_key,value),'{}'::jsonb),count(*)<>count(distinct output_key)
    into mapped,collision
    from (select pg_temp.optimized_photo_reference(key,origin,old_key,new_uri) output_key,value
      from jsonb_each(fields->map_name)) keys;
    if collision then raise exception 'photo_optimization.metadata_collision' using errcode='PT409'; end if;
    result:=result||jsonb_build_object(map_name,mapped);
  end loop;
  return result;
end;
$$;

create or replace function pg_temp.switch_optimized_property_photo(
  p_listing uuid, p_version timestamptz, p_original jsonb, p_optimized jsonb,
  p_apply boolean, p_undo jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
  root constant text:=origin||'/storage/v1/object/public/property-media/';
  original_key text:=p_original->>'key'; optimized_key text:=p_optimized->>'key';
  from_key text; to_key text; identity jsonb; listing public.properties;
  before_fields jsonb; after_fields jsonb; confirmed_fields jsonb; after_version timestamptz;
  known_refs bigint; listing_refs bigint;
begin
  if p_apply is null or p_listing is null or p_version is null or original_key is null or optimized_key is null
    or original_key=optimized_key
    or optimized_key !~ ('^properties/listings/'||p_listing::text||'/[0-9a-f-]{36}/[a-z0-9-]{1,104}\.(webp|jpg)$')
    or (case p_optimized->>'mime' when 'image/webp' then right(optimized_key,5)<>'.webp'
      when 'image/jpeg' then right(optimized_key,4)<>'.jpg' else true end)
    or coalesce(p_optimized->>'bytes','') !~ '^[0-9]{1,6}$'
    or coalesce(p_original->>'bytes','') !~ '^[0-9]{1,8}$'
    or coalesce(p_original->>'sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_optimized->>'sha256','') !~ '^[0-9a-f]{64}$'
  then raise exception 'photo_optimization.invalid_manifest' using errcode='22023'; end if;
  if (p_optimized->>'bytes')::integer not between 1 and 500000
    or (p_optimized->>'bytes')::integer >= (p_original->>'bytes')::integer
  then raise exception 'photo_optimization.invalid_size' using errcode='22023'; end if;

  -- Reuse the rename and deletion snapshot lock and preserve both ledgers.
  perform private.lock_home_listing_media_snapshot();
  if exists(select 1 from private.property_photo_renames r
      where r.old_key in (original_key,optimized_key) or r.new_key in (original_key,optimized_key))
    or exists(select 1 from private.home_listing_deletion_media d
      where d.bucket='property-media' and d.name in (original_key,optimized_key))
  then raise exception 'photo_optimization.protected_key' using errcode='PT409'; end if;

  for identity in select p_original union all select p_optimized loop
    if not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id='property-media' and o.name=identity->>'key' and o.id::text=identity->>'id'
        and o.version::text=identity->>'version' and b.versioning_status::text='DISABLED'
        and o.is_versioned is false and o.is_delete_marker is false and o.archived_at is null
        and o.metadata->>'size'=identity->>'bytes' and o.metadata->>'mimetype'=identity->>'mime'
        and coalesce(o.metadata->>'eTag',o.metadata->>'etag')=identity->>'etag')
    then raise exception 'photo_optimization.object_changed' using errcode='PT409'; end if;
  end loop;
  if (select coalesce(o.user_metadata,'{}'::jsonb) from storage.objects o
      where o.bucket_id='property-media' and o.name=original_key)
    is distinct from (select coalesce(o.user_metadata,'{}'::jsonb) from storage.objects o
      where o.bucket_id='property-media' and o.name=optimized_key)
  then raise exception 'photo_optimization.storage_metadata_changed' using errcode='PT409'; end if;

  from_key:=case when p_undo is null then original_key else optimized_key end;
  to_key:=case when p_undo is null then optimized_key else original_key end;
  select * into listing from public.properties where id=p_listing;
  if not found or listing.updated_at is distinct from p_version
    or not exists(select 1 from unnest(listing.images) uri where private.home_photo_key(uri,origin)=from_key)
  then raise exception 'photo_optimization.stale_listing' using errcode='PT409'; end if;

  before_fields:=jsonb_build_object('images',listing.images,'image_filenames',listing.image_filenames,
    'image_metadata',listing.image_metadata,'source_url',listing.source_url);
  if p_undo is null then
    after_fields:=pg_temp.optimized_photo_fields(before_fields,origin,original_key,root||optimized_key);
  else
    if p_undo->>'listing' is distinct from p_listing::text or p_undo->'original' is distinct from p_original
      or p_undo->'optimized' is distinct from p_optimized or p_undo->>'applied' is distinct from 'true'
      or (p_undo->>'versionAfter')::timestamptz is null or (p_undo->>'versionAfter')::timestamptz>p_version
      or p_undo->'after' is distinct from before_fields
      or pg_temp.optimized_photo_fields(p_undo->'before',origin,original_key,root||optimized_key) is distinct from before_fields
    then raise exception 'photo_optimization.rollback_conflict' using errcode='PT409'; end if;
    after_fields:=p_undo->'before';
  end if;

  select count(*) into known_refs from private.home_listing_media_refs where bucket='property-media' and name=from_key;
  select count(*) into listing_refs from (
    select private.home_photo_key(uri,null) name from (select unnest(listing.images) uri
      union all select jsonb_object_keys(listing.image_filenames)
      union all select jsonb_object_keys(listing.image_metadata)
      union all select listing.source_url) explicit
    union all select name from private.home_listing_storage_links(to_jsonb(listing)::text) where bucket='property-media'
  ) refs where name=from_key;
  if known_refs<>listing_refs
    or exists(select 1 from private.home_listing_media_refs where bucket='property-media' and name=to_key)
    or exists(select 1 from private.home_listing_storage_links((to_jsonb(listing)||after_fields)::text)
      where bucket='property-media' and name=from_key)
  then raise exception 'photo_optimization.shared_reference' using errcode='PT409'; end if;

  if p_apply then
    update public.properties set
      images=array(select uri from jsonb_array_elements_text(after_fields->'images') with ordinality i(uri,ord) order by ord),
      image_filenames=after_fields->'image_filenames', image_metadata=after_fields->'image_metadata',
      source_url=after_fields->>'source_url', updated_at=clock_timestamp()
    where id=p_listing and updated_at=p_version
    returning updated_at,jsonb_build_object('images',images,'image_filenames',image_filenames,
      'image_metadata',image_metadata,'source_url',source_url) into after_version,confirmed_fields;
    if not found or confirmed_fields is distinct from after_fields
      or exists(select 1 from private.home_listing_media_refs where bucket='property-media' and name=from_key)
      or not exists(select 1 from private.home_listing_media_refs where bucket='property-media' and name=to_key)
    then raise exception 'photo_optimization.reference_verification' using errcode='PT409'; end if;
  end if;

  return jsonb_build_object('listing',p_listing,'original',p_original,'optimized',p_optimized,'applied',p_apply,
    'versionBefore',p_version,'versionAfter',after_version,'before',before_fields,'after',after_fields);
end;
$$;

revoke all on function pg_temp.optimized_photo_reference(text,text,text,text),
  pg_temp.optimized_photo_fields(jsonb,text,text,text),
  pg_temp.switch_optimized_property_photo(uuid,timestamptz,jsonb,jsonb,boolean,jsonb) from public;
