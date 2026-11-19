-- Requires the listing photo rename and completion migrations. Review before applying.
begin;

create table private.home_listing_deletions (
  property_id uuid primary key,
  listing_code text not null,
  previous_status text,
  requested_by uuid not null,
  requested_at timestamptz not null default now()
);
create table private.home_listing_deletion_media (
  property_id uuid not null references private.home_listing_deletions(property_id),
  bucket text not null check (bucket in ('property-media','listing-videos')),
  name text not null,
  object_id uuid not null,
  object_version text,
  bytes bigint,
  evidence text not null,
  state text not null default 'captured' check (state in ('captured','pending','retained','review','removed')),
  last_attempt_at timestamptz,
  last_attempt_by uuid,
  removed_at timestamptz,
  primary key (property_id,bucket,name)
);
create unique index home_listing_deletion_reserved_key on private.home_listing_deletion_media(bucket,name)
  where state in ('pending','review','removed');
alter table private.home_listing_deletions enable row level security;
alter table private.home_listing_deletion_media enable row level security;
revoke all on private.home_listing_deletions,private.home_listing_deletion_media from public,anon,authenticated,service_role;

-- Match whole URL paths, including percent-encoded names and transformed images.
-- Treat links on other hosts conservatively when their bucket and key match.
create function private.home_listing_storage_links(body text)
returns table(bucket text,name text) language sql immutable set search_path='' as $$
  select lower(hit[1]), private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||hit[2],null)
  from regexp_matches(body,
    '/(property-media|listing-videos)/([^[:space:]"<>?#,;\\]+\.(?:jpe?g|png|webp|avif|mp4))(?=$|[^[:alnum:]_%/-])','gi') hit;
$$;

create view private.home_listing_media_refs as
  select 'property-media'::text bucket, private.home_photo_key(uri,null) name from private.home_photo_references
  union all
  select r.bucket,r.name from (
    select to_jsonb(t)::text body from public.properties t
    union all select to_jsonb(t)::text from public.neighbourhoods t
    union all select to_jsonb(t)::text from public.site_settings t
    union all select to_jsonb(t)::text from public.listing_authors t
    union all select to_jsonb(t)::text from public.site_activities t
    union all select to_jsonb(t)::text from public.editorial_articles t
    union all select to_jsonb(t)::text from public.enquiries t
    union all select to_jsonb(t)::text from public.enquiry_notes t
    union all select to_jsonb(t)::text from public.feedback_public t
    union all select to_jsonb(t)::text from public.feedback_submissions t
    union all select to_jsonb(t)::text from public.property_assistance t
    union all select to_jsonb(t)::text from public.assistance_reviews t
    union all select to_jsonb(t)::text from public.landlord_submissions t
    union all select to_jsonb(t)::text from public.landlord_submission_files t
  ) records cross join lateral private.home_listing_storage_links(records.body) r;
revoke all on private.home_listing_media_refs from public,anon,authenticated,service_role;

create function private.guard_home_listing_media_ref() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior text;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old)::text; end if;
  if exists(select 1 from private.home_listing_storage_links(to_jsonb(new)::text) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed')) or (l.bucket='property-media' and exists(
        select 1 from private.property_photo_renames r where r.old_key=l.name and r.removal_requested_by is not null)))
    and not exists(select 1 from private.home_listing_storage_links(prior) p where p.bucket=l.bucket and p.name=l.name)) then
    raise exception 'listing_cleanup.retired_reference' using errcode='40001';
  end if;
  return new;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['properties','neighbourhoods','site_settings','listing_authors','site_activities',
    'editorial_articles','enquiries','enquiry_notes','feedback_public','feedback_submissions','property_assistance',
    'assistance_reviews','landlord_submissions','landlord_submission_files'] loop
    execute format('create trigger guard_home_listing_media before insert or update on public.%I
      for each row execute function private.guard_home_listing_media_ref()',table_name);
  end loop;
end;
$$;

-- The UUID for a scoped upload is part of its actual Storage path.
create function private.home_listing_upload_id(p_bucket text,p_name text) returns text
language sql immutable set search_path='' as $$
  select case when p_bucket='property-media' and p_name ~ '^properties/listings/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9-]+\.(jpg|png|webp|avif)$'
    then split_part(p_name,'/',3)
    when p_bucket='listing-videos' and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
    then split_part(p_name,'/',2) end;
$$;
create function private.home_listing_media_upload_allowed(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.home_listing_deletions d
      where d.property_id::text=private.home_listing_upload_id(p_bucket,p_name))
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=p_bucket and m.name=p_name and m.state in ('pending','review','removed'));
$$;
revoke all on function private.home_listing_media_upload_allowed(text,text) from public,anon,authenticated;
grant execute on function private.home_listing_media_upload_allowed(text,text) to authenticated;
create policy home_listing_deleted_upload_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('property-media','listing-videos') or private.home_listing_media_upload_allowed(bucket_id,name));

create function private.guard_home_listing_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if exists(select 1 from private.home_listing_deletions d where d.property_id=new.id) then
      raise exception 'listing_cleanup.deleted' using errcode='40001';
    end if;
    return new;
  end if;
  if not exists(select 1 from private.home_listing_deletions d where d.property_id=old.id) then
    raise exception 'listing_cleanup.manifest_required' using errcode='42501';
  end if;
  return old;
end;
$$;
create trigger guard_home_listing_delete before insert or delete on public.properties
  for each row execute function private.guard_home_listing_delete();
revoke delete on public.properties from public,anon,authenticated;
revoke execute on function public.delete_property(uuid) from public,anon,authenticated;

-- Serialize against rename reservations and writes to reference-bearing tables.
-- EXCLUSIVE blocks Storage finalization, while public reads remain available.
-- NOWAIT prevents contention with a live upload from stalling the shared project.
create function private.lock_home_listing_media_snapshot(p_include_storage boolean default true) returns void
language plpgsql set search_path='' as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('home.photo.rename',0)) then
    raise exception 'listing_cleanup.media_busy' using errcode='55P03';
  end if;
  lock table public.properties,public.neighbourhoods,public.site_settings,public.listing_authors,public.site_activities,
    public.editorial_articles,public.enquiries,public.enquiry_notes,public.feedback_public,public.feedback_submissions,
    public.property_assistance,public.assistance_reviews,public.landlord_submissions,public.landlord_submission_files
    in share row exclusive mode nowait;
  if p_include_storage then lock table storage.objects in exclusive mode nowait; end if;
end;
$$;

create function private.home_listing_delete_result(p_property uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('propertyId',d.property_id,'listingCode',d.listing_code,'requestedAt',d.requested_at,
    'pending',count(m.name) filter (where m.state in ('pending','captured')),
    'removed',count(m.name) filter (where m.state='removed'),
    'retained',count(m.name) filter (where m.state='retained'),
    'review',count(m.name) filter (where m.state='review'))
  from private.home_listing_deletions d left join private.home_listing_deletion_media m using(property_id)
  where d.property_id=p_property group by d.property_id;
$$;

create function public.home_listing_delete_prepare(p_property uuid,p_version timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare listing public.properties; storage_origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if exists(select 1 from private.home_listing_deletions d where d.property_id=p_property) then
    return private.home_listing_delete_result(p_property);
  end if;
  select * into listing from public.properties where id=p_property;
  if not found then raise exception 'listing_cleanup.missing' using errcode='P0002'; end if;
  if listing.updated_at is distinct from p_version then raise exception 'listing_cleanup.stale' using errcode='40001'; end if;
  if exists(select 1 from private.property_photo_renames r where r.applied_at is null and
    (r.property_id=p_property or r.old_key in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri))) then
    raise exception 'listing_cleanup.rename_pending' using errcode='40001';
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
$$;

-- Accept only an explicitly reviewed identity for each historical object.
-- A committed rename is durable proof that the missing listing once existed.
create function public.home_listing_delete_adopt(p_property uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
      raise exception 'listing_cleanup.manifest_changed' using errcode='40001'; end if;
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
$$;

create function public.home_listing_delete_status(p_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_admin();
  if p_property is not null then return private.home_listing_delete_result(p_property); end if;
  return coalesce((select jsonb_agg(private.home_listing_delete_result(q.property_id) order by q.requested_at desc)
    from (select d.property_id,d.requested_at from private.home_listing_deletions d where exists(
      select 1 from private.home_listing_deletion_media m where m.property_id=d.property_id and m.state in ('pending','review'))
      order by d.requested_at desc limit 40) q),'[]'::jsonb);
end;
$$;

create function public.home_listing_delete_targets(p_property uuid,p_actor uuid)
returns table(bucket text,name text) language plpgsql security definer set search_path='' as $$
begin
  update private.home_listing_deletion_media m set state=case
    when exists(select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name) then 'retained'
    else 'review' end
  where m.property_id=p_property and m.state='pending' and (
    exists(select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name)
    or not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id=m.bucket and o.name=m.name and o.id=m.object_id and o.version is not distinct from m.object_version
        and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
        and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)));
  return query update private.home_listing_deletion_media m set last_attempt_at=clock_timestamp(),last_attempt_by=p_actor
    where m.property_id=p_property and (m.bucket,m.name) in (
      select q.bucket,q.name from private.home_listing_deletion_media q
      where q.property_id=p_property and q.state='pending' order by q.bucket,q.name limit 300)
    returning m.bucket,m.name;
end;
$$;

create function public.home_listing_delete_confirm(p_property uuid,p_bucket text,p_names text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.home_listing_deletion_media m set state='removed',removed_at=clock_timestamp()
    where m.property_id=p_property and m.bucket=p_bucket and m.name=any(p_names)
      and m.state in ('pending','review') and m.last_attempt_at is not null and not exists(
      select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name);
end;
$$;

-- Prevent two app requests from sending the same server-only copy. If its
-- outcome is unknown, the existing retry verifies the reserved object first.
alter table private.property_photo_renames add column copy_claimed_at timestamptz;
create function public.home_photo_rename_claim_copy(p_id uuid) returns boolean
language sql security definer set search_path='' as $$
  with claim as (update private.property_photo_renames r set copy_claimed_at=clock_timestamp()
    where r.id=p_id and r.applied_at is null and r.copy_claimed_at is null returning id)
  select exists(select 1 from claim);
$$;

-- Apply the broader reference inventory to the existing rename cleanup path.
create or replace function public.home_photo_rename_request_removal(p_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot(false);
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='40001'; end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key); end if;
  if exists(select 1 from private.home_listing_media_refs r where r.bucket='property-media' and r.name=job.old_key) then
    raise exception 'photo_rename.in_use' using errcode='40001'; end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='40001'; end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;
$$;

revoke all on function private.home_listing_storage_links(text),private.home_listing_upload_id(text,text),
  private.guard_home_listing_media_ref(),private.guard_home_listing_delete(),private.lock_home_listing_media_snapshot(boolean),
  private.home_listing_delete_result(uuid) from public,anon,authenticated,service_role;
revoke all on function public.home_listing_delete_prepare(uuid,timestamptz),public.home_listing_delete_status(uuid),
  public.home_listing_delete_adopt(uuid,jsonb),
  public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_photo_rename_claim_copy(uuid) from public,anon,authenticated,service_role;
grant execute on function public.home_listing_delete_prepare(uuid,timestamptz),public.home_listing_delete_status(uuid) to authenticated;
grant execute on function public.home_listing_delete_adopt(uuid,jsonb) to authenticated;
grant execute on function public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_photo_rename_claim_copy(uuid) to service_role;

notify pgrst,'reload schema';
commit;
