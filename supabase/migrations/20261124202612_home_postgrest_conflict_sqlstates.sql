-- Deterministic application conflicts must reach the caller as HTTP 409.
-- PostgreSQL's own serialization failures and deadlocks retain their SQLSTATEs.
begin;
set local search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION private.guard_home_listing_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='INSERT' then
    if exists(select 1 from private.home_listing_deletions d where d.property_id=new.id) then
      raise exception 'listing_cleanup.deleted' using errcode='PT409';
    end if;
    return new;
  end if;
  if not exists(select 1 from private.home_listing_deletions d where d.property_id=old.id) then
    raise exception 'listing_cleanup.manifest_required' using errcode='42501';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_home_listing_media_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior text;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old)::text; end if;
  if exists(select 1 from private.home_listing_storage_links(to_jsonb(new)::text) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed')) or (l.bucket='property-media' and exists(
        select 1 from private.property_photo_renames r where r.old_key=l.name and r.removal_requested_by is not null)))
    and not exists(select 1 from private.home_listing_storage_links(prior) p where p.bucket=l.bucket and p.name=l.name)) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_home_photo_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_table_name='properties' then
    if exists(select 1 from
      (select unnest(new.images) uri union all select jsonb_object_keys(new.image_filenames)
       union all select jsonb_object_keys(new.image_metadata) union all select new.source_url) refs
       where private.home_photo_blocked(refs.uri))
    then raise exception 'photo_rename.stale_reference' using errcode='PT409';end if;
  elsif tg_table_name='editorial_articles' then
    if private.home_photo_blocked(new.image_url) or exists(
      select 1 from jsonb_array_elements(new.sources) entry where private.home_photo_blocked(entry->>'url')
    ) then raise exception 'photo_rename.stale_reference' using errcode='PT409';end if;
  elsif private.home_photo_blocked(to_jsonb(new)->>tg_argv[0])
    or (tg_nargs>1 and private.home_photo_blocked(to_jsonb(new)->>tg_argv[1])) then
    raise exception 'photo_rename.stale_reference' using errcode='PT409';
  end if;
  return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_apply(p_id uuid, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; listing public.properties; new_uri text; changed jsonb;
begin
  perform private.require_home_photo_admin();
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id for update;
  if not found or job.sha256 is null then raise exception 'photo_rename.unverified' using errcode='PT409';end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  -- Exclude concurrent reference changes for the duration of this transaction.
  lock table public.properties, public.neighbourhoods, public.site_settings, public.listing_authors,
    public.site_activities, public.editorial_articles in share row exclusive mode;
  select * into listing from public.properties where id=job.property_id;
  if not found or listing.updated_at is distinct from p_version or not exists(
    select 1 from unnest(listing.images) uri where private.home_photo_key(uri,job.origin)=job.old_key
  ) then raise exception 'photo_rename.stale_listing' using errcode='PT409';end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key
    and private.home_photo_key(uri,job.origin) is null)
  then raise exception 'photo_rename.other_origin' using errcode='PT409';end if;
  new_uri:=job.origin||'/storage/v1/object/public/property-media/'||job.new_key;
  update private.property_photo_renames set applied_at=clock_timestamp(),applied_by=auth.uid() where id=job.id;
  with before_rename as materialized (
    select p.id,p.updated_at from public.properties p where exists(
      select 1 from (select unnest(p.images) uri union all select jsonb_object_keys(p.image_filenames)
        union all select jsonb_object_keys(p.image_metadata) union all select p.source_url) refs
      where private.home_photo_key(refs.uri,job.origin)=job.old_key
    )
  ), rewritten as (
    update public.properties p set
      images=array(select private.home_photo_replacement(uri,job.origin,job.old_key,new_uri)
        from unnest(p.images) with ordinality as i(uri,position) order by position),
      image_filenames=private.home_photo_map(p.image_filenames,job.origin,job.old_key,new_uri),
      image_metadata=private.home_photo_map(p.image_metadata,job.origin,job.old_key,new_uri),
      source_url=private.home_photo_replacement(p.source_url,job.origin,job.old_key,new_uri),
      updated_at=clock_timestamp()
    from before_rename b where p.id=b.id
    returning p.id,p.updated_at,b.updated_at as previous_updated_at
  ) select coalesce(jsonb_agg(to_jsonb(rewritten)),'[]'::jsonb) into changed from rewritten;
  update public.neighbourhoods set image=private.home_photo_replacement(image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image,job.origin)=job.old_key;
  update public.site_settings set hero_image=private.home_photo_replacement(hero_image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(hero_image,job.origin)=job.old_key;
  update public.listing_authors set portrait_url=private.home_photo_replacement(portrait_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(portrait_url,job.origin)=job.old_key;
  update public.site_activities set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    source_url=private.home_photo_replacement(source_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image_url,job.origin)=job.old_key or private.home_photo_key(source_url,job.origin)=job.old_key;
  update public.editorial_articles set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    sources=(select coalesce(jsonb_agg(
      case when private.home_photo_key(entry->>'url',job.origin)=job.old_key
      then jsonb_set(entry,'{url}',to_jsonb(private.home_photo_replacement(entry->>'url',job.origin,job.old_key,new_uri)))
      else entry end order by position),'[]'::jsonb) from jsonb_array_elements(sources) with ordinality as s(entry,position))
    where private.home_photo_key(image_url,job.origin)=job.old_key or exists(
      select 1 from jsonb_array_elements(sources) entry where private.home_photo_key(entry->>'url',job.origin)=job.old_key
    );
  update private.property_photo_renames set properties=changed where id=job.id returning * into job;
  return to_jsonb(job);
end;$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_request_removal(p_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot(false);
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='PT409'; end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key); end if;
  if exists(select 1 from private.home_listing_media_refs r where r.bucket='property-media' and r.name=job.old_key) then
    raise exception 'photo_rename.in_use' using errcode='PT409'; end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='PT409'; end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;
$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_reserve(p_property uuid, p_origin text, p_old_key text, p_name text, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; listing public.properties; target text;
begin
  perform private.require_home_photo_admin();
  if p_name is null or p_name !~ '^[a-z0-9]+(-[a-z0-9]+)*\.(jpg|png|webp|avif)$' or char_length(p_name)>120
    or p_origin is null or p_origin !~ '^https?://[a-zA-Z0-9.:-]+$' then raise exception 'photo_rename.invalid_name' using errcode='22023';end if;
  target:='properties/renamed/'||p_property::text||'/'||p_name;
  if p_old_key=target then raise exception 'photo_rename.same_name' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where origin=p_origin and old_key=p_old_key;
  if found and (job.property_id<>p_property or job.new_key<>target) then
    raise exception 'photo_rename.pending_name' using errcode='PT409';
  end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  select * into listing from public.properties where id=p_property;
  if not found or listing.updated_at is distinct from p_version then raise exception 'photo_rename.stale_listing' using errcode='PT409';end if;
  if not exists(select 1 from unnest(listing.images) uri where private.home_photo_key(uri,p_origin)=p_old_key) then
    raise exception 'photo_rename.photo_not_saved' using errcode='P0002';
  end if;
  if job.id is not null then return to_jsonb(job);end if;
  if exists(select 1 from private.property_photo_renames r where r.new_key=target or r.old_key=target)
    or exists(select 1 from storage.objects where bucket_id='property-media' and name=target)
    or exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=target)
  then raise exception 'photo_rename.collision' using errcode='23505';end if;
  insert into private.property_photo_renames(property_id,origin,old_key,new_key,started_by)
    values(p_property,p_origin,p_old_key,target,auth.uid()) returning * into job;
  return to_jsonb(job);
end;$function$;

CREATE OR REPLACE FUNCTION private.limit_portal_guide_files()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_version timestamptz;
begin
 if auth.uid() is null or private.staff_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 -- Serialize concurrent uploads to enforce the limit across multiple tabs.
 select updated_at into current_version from public.portal_guides where id=new.guide_id for update;
 if current_version is distinct from new.guide_version then raise exception 'The guide changed during upload; review its audience before attaching this file' using errcode='PT409';end if;
 if (select count(*) from public.portal_guide_files where guide_id=new.guide_id)>=12 then raise exception 'A guide supports up to 12 files' using errcode='23514';end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.home_listing_delete_adopt(p_property uuid, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item jsonb; target storage.objects; previous private.home_listing_deletion_media;
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 80 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if exists(select 1 from public.properties p where p.id=p_property) or not exists(
    select 1 from private.property_photo_renames r where r.property_id=p_property and r.applied_at is not null
      and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co') then
    raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
  insert into private.home_listing_deletions(property_id,listing_code,requested_by)
    values(p_property,'',auth.uid()) on conflict do nothing;
  for item in select value from jsonb_array_elements(p_manifest) loop
    select * into previous from private.home_listing_deletion_media m where m.property_id=p_property
      and m.bucket=item->>'bucket' and m.name=item->>'name';
    if found and previous.object_id::text=item->>'id' and previous.object_version is not distinct from item->>'version'
      and previous.state in ('pending','removed') then continue; end if;
    select o.* into target from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id=item->>'bucket' and o.name=item->>'name' and o.id::text=item->>'id'
        and o.version is not distinct from item->>'version'
        and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
        and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false);
    if not found or not exists(select 1 from private.home_listing_storage_links('/'||target.bucket_id||'/'||target.name) l
        where l.bucket=target.bucket_id and l.name=target.name)
      or exists(select 1 from private.home_listing_media_refs r where r.bucket=target.bucket_id and r.name=target.name) then
      raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
    if not ((target.bucket_id='listing-videos' and coalesce(private.home_listing_upload_id(target.bucket_id,target.name)=p_property::text,false))
       or (target.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r
        where r.property_id=p_property and r.applied_at is not null and target.name in (r.old_key,r.new_key)
          and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co'))) then
      raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
    insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence,state)
      values(p_property,target.bucket_id,target.name,target.id,target.version,
        case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,'approved_history','pending');
  end loop;
  return private.home_listing_delete_result(p_property);
end;
$function$;

CREATE OR REPLACE FUNCTION public.home_listing_delete_prepare(p_property uuid, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare listing public.properties; storage_origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if exists(select 1 from private.home_listing_deletions d where d.property_id=p_property) then
    return private.home_listing_delete_result(p_property);
  end if;
  select * into listing from public.properties where id=p_property;
  if not found then raise exception 'listing_cleanup.missing' using errcode='P0002'; end if;
  if listing.updated_at is distinct from p_version then raise exception 'listing_cleanup.stale' using errcode='PT409'; end if;
  if exists(select 1 from private.property_photo_renames r where r.applied_at is null and
    (r.property_id=p_property or r.old_key in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri))) then
    raise exception 'listing_cleanup.rename_pending' using errcode='PT409';
  end if;

  insert into private.home_listing_deletions(property_id,listing_code,previous_status,requested_by)
    values(p_property,listing.listing_code,listing.status,auth.uid());
  insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence)
    select p_property,o.bucket_id,o.name,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
      case when renamed.name is not null then 'rename_ledger' when owned.path then 'listing_path'
        when owned.gallery then 'saved_gallery' when owned.prior then 'previously_shared' else 'unverified_ownership' end
    from storage.objects o
    left join lateral (
      select o.name from private.property_photo_renames r where r.property_id=p_property and r.origin=storage_origin
        and r.applied_at is not null and o.bucket_id='property-media' and o.name in (r.old_key,r.new_key) limit 1
    ) renamed on true
    cross join lateral (select (o.bucket_id='property-media' and o.name in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri)) or
      (o.bucket_id='listing-videos' and starts_with(listing.video_url,storage_origin||'/') and exists(
        select 1 from private.home_listing_storage_links(listing.video_url) l where l.bucket=o.bucket_id and l.name=o.name)) as linked) saved
    cross join lateral (select private.home_listing_upload_id(o.bucket_id,o.name)=p_property::text as path,
      o.bucket_id='property-media' and saved.linked and o.name ~ '^properties/[0-9a-f-]{36}(/[a-z0-9-]+)?\.(jpe?g|png|webp|avif)$'
        and not exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key) and r.property_id<>p_property) as gallery,
      saved.linked and exists(select 1 from private.home_listing_deletion_media m
        where m.bucket=o.bucket_id and m.name=o.name and m.object_id=o.id and m.object_version is not distinct from o.version
          and m.state='retained' and m.evidence<>'unverified_ownership') as prior) owned
    where o.bucket_id in ('property-media','listing-videos')
      and coalesce(to_jsonb(o)->>'archived_at','')='' and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)=false
      and (renamed.name is not null or owned.path or saved.linked)
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=o.bucket_id and m.name=o.name and m.state in ('pending','review','removed'));

  -- Keep the existing FK cascades and CRM attribution trigger in this transaction.
  delete from public.properties where id=p_property;
  update private.home_listing_deletion_media m set state=case
    when m.evidence='unverified_ownership' or exists(
      select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name) then 'retained'
    when not exists(select 1 from private.home_listing_storage_links('/'||m.bucket||'/'||m.name) l
      where l.bucket=m.bucket and l.name=m.name) then 'review'
    else 'pending' end
    where m.property_id=p_property;
  return private.home_listing_delete_result(p_property);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_property_order(order_scope text, ordered_property_ids uuid[], expected_property_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_ids uuid[];
begin
 if not private.can_order_properties() then raise exception 'Owner, admin or manager access required.' using errcode='42501'; end if;
 if order_scope is null or order_scope not in ('home','listings') or not private.valid_property_order(ordered_property_ids) then
  raise exception 'Choose current public rental listings with no duplicates.' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gary-property-order:'||order_scope,0));
 select property_ids into current_ids from public.property_display_orders where scope=order_scope;
 if expected_property_ids is not null and coalesce(current_ids,'{}'::uuid[]) is distinct from expected_property_ids then
  raise exception 'This order changed. Refresh the page before saving.' using errcode='PT409'; end if;
 insert into public.property_display_orders(scope,property_ids) values(order_scope,ordered_property_ids)
 on conflict(scope) do update set property_ids=excluded.property_ids,updated_at=now();
end; $function$;

commit;
