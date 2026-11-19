-- Review before applying. Requires property image filenames and metadata.
begin;

create table private.property_photo_renames (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  origin text not null,
  old_key text not null,
  new_key text not null,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  applied_by uuid,
  applied_at timestamptz,
  properties jsonb not null default '[]'::jsonb,
  removal_requested_by uuid,
  removed_at timestamptz,
  unique(origin,old_key), unique(origin,new_key)
);
alter table private.property_photo_renames enable row level security;
revoke all on private.property_photo_renames from public,anon,authenticated;
create index property_photo_renames_old_key on private.property_photo_renames(old_key);

-- Normal uploads can still insert new photos. Existing bytes and the rename
-- destination directory are restricted to server-side Storage operations.
create function private.home_photo_upload_key(p_key text) returns boolean language sql stable security definer set search_path='' as $$
  select p_key not like 'properties/renamed/%'
    and not exists(select 1 from private.property_photo_renames where old_key=p_key);
$$;
revoke all on function private.home_photo_upload_key(text) from public,anon,authenticated;
grant execute on function private.home_photo_upload_key(text) to authenticated;
create policy home_photo_rename_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'property-media');
create policy home_photo_rename_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'property-media' or private.home_photo_upload_key(name));
create policy home_photo_rename_update_guard on storage.objects as restrictive for update to anon,authenticated
  using (bucket_id <> 'property-media') with check (bucket_id <> 'property-media');
create policy home_photo_rename_delete_guard on storage.objects as restrictive for delete to anon,authenticated
  using (bucket_id <> 'property-media');

create function private.home_photo_key(uri text, expected_origin text) returns text
language plpgsql immutable set search_path='' as $$
declare path text; token text; bytes bytea:=''::bytea;
begin
  if uri is null or (expected_origin is not null and not starts_with(uri,expected_origin||'/')) then return null;end if;
  path:=substring(split_part(split_part(uri,'?',1),'#',1)
    from '^https?://[a-zA-Z0-9.:-]+/storage/v1/(?:object|render/image)/public/property-media/(.+)$');
  if path is null or char_length(path)>3072 or path ~ '%(?![0-9a-fA-F]{2})' then return null;end if;
  for token in select (regexp_matches(path,'(%[0-9a-fA-F]{2}|[^%]+)','g'))[1] loop
    if starts_with(token,'%') then
      if lower(token) in ('%00','%2f','%5c') then return null;end if;
      bytes:=bytes||decode(substr(token,2),'hex');
    else bytes:=bytes||convert_to(token,'UTF8');end if;
  end loop;
  path:=convert_from(bytes,'UTF8');
  if path ~ '(^|/)\.{1,2}(/|$)|[[:cntrl:]]' or position(chr(92) in path)>0 or char_length(path)>1024 then return null;end if;
  return path;
exception when character_not_in_repertoire or untranslatable_character then return null;
end;$$;

create function private.require_home_photo_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(private.staff_role(),'') not in ('owner','admin') or not exists(
    select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and u.deleted_at is null
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'photo_rename.forbidden' using errcode='42501';end if;
end;$$;

create view private.home_photo_references as
  select unnest(images) as uri from public.properties
  union all select jsonb_object_keys(image_filenames) from public.properties
  union all select jsonb_object_keys(image_metadata) from public.properties
  union all select source_url from public.properties
  union all select image from public.neighbourhoods
  union all select hero_image from public.site_settings
  union all select portrait_url from public.listing_authors
  union all select image_url from public.site_activities
  union all select source_url from public.site_activities
  union all select image_url from public.editorial_articles
  union all select entry->>'url' from public.editorial_articles, jsonb_array_elements(sources) entry;

create function private.home_photo_replacement(uri text, origin text, old_key text, new_uri text) returns text
language sql immutable set search_path='' as $$
  select case when private.home_photo_key(uri,origin)=old_key then
    (case when starts_with(uri,origin||'/storage/v1/render/image/public/property-media/')
      then replace(new_uri,'/storage/v1/object/public/','/storage/v1/render/image/public/') else new_uri end)
      || coalesce(substring(uri from '[?#].*$'),'')
    else uri end;
$$;

create function private.home_photo_map(fields jsonb, origin text, old_key text, new_uri text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; conflict boolean;
begin
  with mapped as (
    select private.home_photo_replacement(key,origin,old_key,new_uri) as key,value
    from jsonb_each(fields)
  ), merged as (
    select key,jsonb_agg(distinct value) as values_present from mapped group by key
  )
  select coalesce(jsonb_object_agg(key,values_present->0),'{}'::jsonb),
    coalesce(bool_or(jsonb_array_length(values_present)>1),false) into result,conflict from merged;
  if conflict then raise exception 'photo_rename.metadata_conflict' using errcode='23514';end if;
  return result;
end;$$;

create function private.home_photo_blocked(uri text) returns boolean language sql security definer set search_path='' as $$
  select exists(
    select 1 from private.property_photo_renames r
    where case when r.applied_at is null then r.new_key else r.old_key end=private.home_photo_key(uri,null)
  );
$$;
create function private.guard_home_photo_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='properties' then
    if exists(select 1 from
      (select unnest(new.images) uri union all select jsonb_object_keys(new.image_filenames)
       union all select jsonb_object_keys(new.image_metadata) union all select new.source_url) refs
       where private.home_photo_blocked(refs.uri))
    then raise exception 'photo_rename.stale_reference' using errcode='40001';end if;
  elsif tg_table_name='editorial_articles' then
    if private.home_photo_blocked(new.image_url) or exists(
      select 1 from jsonb_array_elements(new.sources) entry where private.home_photo_blocked(entry->>'url')
    ) then raise exception 'photo_rename.stale_reference' using errcode='40001';end if;
  elsif private.home_photo_blocked(to_jsonb(new)->>tg_argv[0])
    or (tg_nargs>1 and private.home_photo_blocked(to_jsonb(new)->>tg_argv[1])) then
    raise exception 'photo_rename.stale_reference' using errcode='40001';
  end if;
  return new;
end;$$;
create trigger guard_property_photo_reference before insert or update of images,image_filenames,image_metadata,source_url on public.properties
  for each row execute function private.guard_home_photo_reference();
create trigger guard_neighbourhood_photo_reference before insert or update of image on public.neighbourhoods
  for each row execute function private.guard_home_photo_reference('image');
create trigger guard_hero_photo_reference before insert or update of hero_image on public.site_settings
  for each row execute function private.guard_home_photo_reference('hero_image');
create trigger guard_author_photo_reference before insert or update of portrait_url on public.listing_authors
  for each row execute function private.guard_home_photo_reference('portrait_url');
create trigger guard_activity_photo_reference before insert or update of image_url,source_url on public.site_activities
  for each row execute function private.guard_home_photo_reference('image_url','source_url');
create trigger guard_editorial_photo_reference before insert or update of image_url,sources on public.editorial_articles
  for each row execute function private.guard_home_photo_reference();

create function public.home_photo_rename_lookup(p_property uuid,p_origin text,p_old_key text,p_name text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare job private.property_photo_renames;
begin
  perform private.require_home_photo_admin();
  select * into job from private.property_photo_renames
    where property_id=p_property and origin=p_origin and old_key=p_old_key
    and new_key='properties/renamed/'||p_property::text||'/'||p_name;
  return case when found then to_jsonb(job) else null end;
end;$$;

create function public.home_photo_rename_reserve(p_property uuid,p_origin text,p_old_key text,p_name text,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
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
    raise exception 'photo_rename.pending_name' using errcode='40001';
  end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  select * into listing from public.properties where id=p_property;
  if not found or listing.updated_at is distinct from p_version then raise exception 'photo_rename.stale_listing' using errcode='40001';end if;
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
end;$$;

-- The server attests to the Storage copy only after comparing both objects.
create function public.home_photo_rename_verified(p_id uuid,p_sha256 text) returns boolean
language sql security definer set search_path='' as $$
  with verified as (
    update private.property_photo_renames r set sha256=p_sha256
    where id=p_id and (sha256 is null or sha256=p_sha256)
    and exists (select 1 from storage.objects o where o.bucket_id='property-media' and o.name=r.new_key)
    returning id
  ) select exists(select 1 from verified);
$$;

create function public.home_photo_rename_apply(p_id uuid,p_version timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; listing public.properties; new_uri text; changed jsonb;
begin
  perform private.require_home_photo_admin();
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id for update;
  if not found or job.sha256 is null then raise exception 'photo_rename.unverified' using errcode='40001';end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  -- Exclude concurrent reference changes for the duration of this transaction.
  lock table public.properties, public.neighbourhoods, public.site_settings, public.listing_authors,
    public.site_activities, public.editorial_articles in share row exclusive mode;
  select * into listing from public.properties where id=job.property_id;
  if not found or listing.updated_at is distinct from p_version or not exists(
    select 1 from unnest(listing.images) uri where private.home_photo_key(uri,job.origin)=job.old_key
  ) then raise exception 'photo_rename.stale_listing' using errcode='40001';end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key
    and private.home_photo_key(uri,job.origin) is null)
  then raise exception 'photo_rename.other_origin' using errcode='40001';end if;
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
end;$$;

create function public.home_photo_rename_history(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_admin();
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select id,old_key,new_key,applied_at,removed_at from private.property_photo_renames
    where property_id=p_property order by started_at desc limit 40
  ) r),'[]'::jsonb);
end;$$;

create function public.home_photo_rename_request_removal(p_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='40001';end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key);end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key)
    then raise exception 'photo_rename.in_use' using errcode='40001';end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='40001';end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;$$;

create function public.home_photo_rename_removed(p_id uuid) returns boolean
language sql security definer set search_path='' as $$
  with removed as (
    update private.property_photo_renames r set removed_at=coalesce(removed_at,clock_timestamp())
    where id=p_id and applied_at is not null and removal_requested_by is not null
     and not exists(select 1 from storage.objects o where o.bucket_id='property-media' and o.name=r.old_key)
     returning id
  ) select exists(select 1 from removed);
$$;

revoke all on private.home_photo_references from public,anon,authenticated;
revoke all on function private.home_photo_key(text,text),private.require_home_photo_admin(),
  private.home_photo_replacement(text,text,text,text),private.home_photo_map(jsonb,text,text,text),
  private.home_photo_blocked(text),private.guard_home_photo_reference()
  from public,anon,authenticated;
revoke all on function public.home_photo_rename_lookup(uuid,text,text,text),public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),public.home_photo_rename_request_removal(uuid,boolean),
  public.home_photo_rename_verified(uuid,text),public.home_photo_rename_removed(uuid) from public,anon,authenticated;
grant execute on function public.home_photo_rename_lookup(uuid,text,text,text),public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),
  public.home_photo_rename_request_removal(uuid,boolean) to authenticated;
grant execute on function public.home_photo_rename_verified(uuid,text),public.home_photo_rename_removed(uuid) to service_role;

notify pgrst,'reload schema';
commit;
