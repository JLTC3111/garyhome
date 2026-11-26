-- Review and apply only after the Gary Home WebP and delivery verification.
begin;

create table private.home_media_control (
  singleton boolean primary key default true check(singleton),
  permanent_enabled boolean not null default false,
  last_scan_at timestamptz,
  lease uuid,
  lease_until timestamptz
);
insert into private.home_media_control default values;

create table private.home_media_items (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check(bucket in ('property-media','listing-videos')),
  name text not null,
  source text not null check(source in ('listing','rename','upload','detached','historical')),
  source_id uuid,
  upload_owner uuid,
  upload_until timestamptz,
  object_id uuid,
  object_version text,
  bytes bigint,
  state text not null check(state in ('uploading','candidate','trashed','deleting','removed','restored','retained','review')),
  hold_reason text,
  unreferenced_since timestamptz,
  expires_at timestamptz,
  retry_after timestamptz,
  attempts integer not null default 0,
  removed_at timestamptz,
  replacement_key text,
  replacement_sha256 text,
  replacement_id uuid,
  replacement_version text,
  restore_media jsonb,
  restored_to uuid,
  deletion_started_at timestamptz,
  deletion_run uuid,
  historical_review jsonb,
  unique(bucket,name)
);
create index home_media_due on private.home_media_items(expires_at,retry_after,id)
  where state in ('trashed','deleting');
create index home_media_reconcile on private.home_media_items(retry_after,id)
  where deletion_started_at is not null and state in ('deleting','review');
create index home_media_upload_due on private.home_media_items(upload_until,id) where state='uploading';
create index home_media_detached_due on private.home_media_items(expires_at,id) where state='candidate';
create index home_media_reserved_name on private.home_media_items(name)
  where state in ('trashed','deleting','removed','review');

create table private.home_media_deleted_listings (
  listing_id uuid primary key,
  snapshot jsonb not null,
  expires_at timestamptz not null,
  draft_id uuid
);
create index home_media_deleted_listings_expiry on private.home_media_deleted_listings(expires_at);
create table private.home_media_renamed_listings (
  rename_id uuid not null references private.property_photo_renames(id),
  listing_id uuid not null,
  before_media jsonb not null,
  after_media jsonb not null,
  primary key(rename_id,listing_id)
);

create table private.home_media_runs (
  id uuid primary key,
  actor uuid,
  early_item uuid,
  early_expiry timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempted integer not null default 0,
  removed integer not null default 0,
  failed integer not null default 0
);
create index home_media_runs_recent on private.home_media_runs(started_at desc);
alter table private.home_media_control enable row level security;
alter table private.home_media_items enable row level security;
alter table private.home_media_runs enable row level security;
alter table private.home_media_deleted_listings enable row level security;
alter table private.home_media_renamed_listings enable row level security;
revoke all on private.home_media_control,private.home_media_items,private.home_media_runs,
  private.home_media_deleted_listings,private.home_media_renamed_listings
  from public,anon,authenticated,service_role;

-- Extend the existing dependencies to recognize typed paths with encoded or raw filenames.
-- Exact URL references remain distinct from filename-only hints used for the report.
create function private.home_media_links(body jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  select l.bucket,l.name from private.home_listing_storage_links(body::text) l
  union
  select 'property-media',private.home_photo_key(v #>> '{}',null)
  from jsonb_path_query(body,'strict $.** ? (@.type() == "string")') v
  where private.home_photo_key(v #>> '{}',null) is not null;
$$;

create function private.home_media_listing_fields(p public.properties) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('images',p.images,'image_filenames',p.image_filenames,'image_metadata',p.image_metadata,
    'video_url',p.video_url,'source_url',p.source_url);
$$;

create function private.home_media_saved_attachment(p_fields jsonb,p_bucket text,p_name text) returns boolean
language sql immutable set search_path='' as $$
  select case when p_bucket='property-media' then exists(
      select 1 from jsonb_array_elements_text(p_fields->'images') u where private.home_photo_key(u,null)=p_name)
    else exists(select 1 from private.home_listing_storage_links(p_fields->>'video_url') l where l.bucket=p_bucket and l.name=p_name)
  end;
$$;

-- Keep existing triggers and augment their durable key reservation.
create or replace function private.guard_home_listing_media_ref() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  if exists(select 1 from private.home_media_links(to_jsonb(new)) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed'))
    or exists(select 1 from private.home_media_items i where i.bucket=l.bucket and i.name=l.name
      and i.state in ('trashed','deleting','removed','review'))
    or (l.bucket='property-media' and exists(select 1 from private.property_photo_renames r
      where r.old_key=l.name and r.removal_requested_by is not null))
  ) and not exists(select 1 from private.home_media_links(prior) p where p.bucket=l.bucket and p.name=l.name))
    or exists(select 1 from jsonb_path_query(to_jsonb(new),'strict $.** ? (@.type() == "string")') v
      join private.home_media_items i on i.name=(v #>> '{}') and i.state in ('trashed','deleting','removed','review')
      where not exists(select 1 from jsonb_path_query(prior,'strict $.** ? (@.type() == "string")') p where p=v))
  then raise exception 'listing_cleanup.retired_reference' using errcode='PT409'; end if;
  return new;
end;
$$;

-- Route listing-video deletions through the same recoverable workflow.
alter policy listing_video_delete_guard on storage.objects using (bucket_id<>'listing-videos');

create or replace function private.home_listing_media_upload_allowed(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.home_listing_deletions d
      where d.property_id::text=private.home_listing_upload_id(p_bucket,p_name))
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=p_bucket and m.name=p_name and m.state in ('pending','review','removed'))
    and not exists(select 1 from private.home_media_items i where i.bucket=p_bucket and i.name=p_name
      and i.state in ('trashed','deleting','removed','review'));
$$;

create function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_listing_media_refs r where r.bucket=p_bucket and r.name=p_name)
    or exists(select 1 from (
      select to_jsonb(p) data from public.properties p
      union all select to_jsonb(e) from public.editorial_articles e
      union all select to_jsonb(n) from public.neighbourhoods n
      union all select to_jsonb(s) from public.site_settings s
      union all select to_jsonb(a) from public.listing_authors a
      union all select to_jsonb(a) from public.site_activities a
      union all select to_jsonb(e) from public.enquiries e
      union all select to_jsonb(n) from public.enquiry_notes n
      union all select to_jsonb(f) from public.feedback_public f
      union all select to_jsonb(f) from public.feedback_submissions f
      union all select to_jsonb(a) from public.property_assistance a
      union all select to_jsonb(a) from public.assistance_reviews a
      union all select to_jsonb(l) from public.landlord_submissions l
      union all select to_jsonb(f) from public.landlord_submission_files f
    ) p cross join lateral jsonb_path_query(p.data,'strict $.** ? (@.type() == "string")') v
    where (v #>> '{}') in (p_name,regexp_replace(p_name,'^.*/',''))
      or (p_include_original_name and lower(btrim(v #>> '{}')) in (lower(regexp_replace(p_name,'^.*/','')),(
        select lower(btrim(o.user_metadata->>'original_filename')) from storage.objects o
        where o.bucket_id=p_bucket and o.name=p_name limit 1)))
      or exists(select 1 from private.home_media_links(v) l where l.bucket=p_bucket and l.name=p_name));
$$;

create function private.home_media_identity(p_bucket text,p_name text) returns setof storage.objects
language sql stable set search_path='' as $$
  select o.* from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id=p_bucket and o.name=p_name
    and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
    and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
    and not coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
    and to_jsonb(o)->>'archived_at' is null;
$$;

-- Applied renames retain their old-key guard until the Owner restores the
-- same retained object and its captured listing relations in one transaction.
create or replace function private.home_photo_blocked(uri text) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from private.property_photo_renames r
    where (case when r.applied_at is null then r.new_key else r.old_key end)=private.home_photo_key(uri,null)
    and (r.applied_at is null or not exists(select 1 from private.home_media_items i
      join lateral private.home_media_identity(i.bucket,i.name) o on o.id=i.object_id and o.version is not distinct from i.object_version
      where i.bucket='property-media' and i.name=r.old_key and i.source='rename' and i.source_id=r.id and i.state='restored')));
$$;

create function private.home_media_provider_upload(p_bucket text,p_name text) returns boolean
language plpgsql stable set search_path='' as $$
declare pending boolean;
begin
  if to_regclass('storage.s3_multipart_uploads') is null then return false; end if;
  execute 'select exists(select 1 from storage.s3_multipart_uploads where bucket_id=$1 and key=$2)'
    into pending using p_bucket,p_name;
  return pending;
end;
$$;

-- A historical decision is its own review record. The Owner supplies the
-- independently verified backup checksum and an actual custody evidence reference.
create function public.home_media_enroll_historical(p_review jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target storage.objects; item private.home_media_items; proof jsonb;
  object_name text:=p_review->>'key'; sha text:=p_review->>'backupSha256'; evidence text:=btrim(p_review->>'evidenceRef');
begin
  perform private.require_home_photo_owner();
  if p_confirm is not true or coalesce(sha,'') !~ '^[0-9a-f]{64}$' or coalesce(length(evidence),0) not between 3 and 240
    or coalesce(p_review->>'bytes','') !~ '^[0-9]{1,12}$' or nullif(p_review->>'version','') is null
    or nullif(p_review->>'etag','') is null or char_length(coalesce(object_name,'')) not between 1 and 1024 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot();
  select * into target from private.home_media_identity('property-media',object_name);
  if not found or target.id::text is distinct from p_review->>'objectId'
    or target.version is distinct from p_review->>'version' or target.metadata->>'size' is distinct from p_review->>'bytes'
    or btrim(coalesce(target.metadata->>'eTag',target.metadata->>'etag'),'"') is distinct from btrim(p_review->>'etag','"')
    or not exists(select 1 from private.home_listing_storage_links('/property-media/'||object_name) l where l.name=object_name)
    or private.home_media_referenced('property-media',object_name,true) or private.home_media_provider_upload('property-media',object_name)
    or exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id('property-media',object_name))
    or exists(select 1 from private.property_photo_renames r where object_name in(r.old_key,r.new_key))
    or exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=object_name)
  then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  proof:=jsonb_build_object('evidenceRef',evidence,'backupSha256',sha,'etag',btrim(p_review->>'etag','"'));
  insert into private.home_media_items(bucket,name,source,object_id,object_version,bytes,state,unreferenced_since,expires_at,historical_review)
  values('property-media',object_name,'historical',target.id,target.version,(p_review->>'bytes')::bigint,'trashed',now(),now()+interval '48 hours',
    proof||jsonb_build_object('actor',auth.uid(),'reviewedAt',clock_timestamp()))
  on conflict(bucket,name) do nothing;
  select * into item from private.home_media_items i where i.bucket='property-media' and i.name=object_name;
  if item.source<>'historical' or item.state<>'trashed' or item.object_id is distinct from target.id
    or item.object_version is distinct from target.version or not (item.historical_review @> proof) then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  return jsonb_build_object('id',item.id,'expiresAt',item.expires_at);
end;
$$;

-- Ordinary uploaders can protect a fresh key of their own. They cannot audit or
-- modify a cleanup reservation. Live listing paths are held even after expiry.
create function public.home_media_upload_lease(p_bucket text,p_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(private.is_editor(),false) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501';
  end if;
  if p_bucket not in ('property-media','listing-videos') or p_bucket is null or
    (private.home_listing_upload_id(p_bucket,p_name) is null and
      not coalesce(p_bucket='property-media' and p_name ~ '^properties/[0-9a-f-]{36}/[a-z0-9-]+\.(jpe?g|png|webp|avif)$',false))
  then raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if p_bucket='listing-videos' and split_part(p_name,'/',1)<>auth.uid()::text then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if not private.home_listing_media_upload_allowed(p_bucket,p_name) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  insert into private.home_media_items(bucket,name,source,upload_owner,upload_until,state)
    select p_bucket,p_name,'upload',auth.uid(),now()+interval '24 hours','uploading'
    where not exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_name)
  on conflict(bucket,name) do update set upload_until=excluded.upload_until
    where home_media_items.source='upload' and home_media_items.state='uploading'
      and home_media_items.upload_owner=auth.uid();
  if not found then
    update private.home_media_items set upload_until=now()+interval '24 hours'
    where bucket=p_bucket and name=p_name and source='upload' and state='uploading' and upload_owner=auth.uid();
    if not found then raise exception 'listing_cleanup.retired_reference' using errcode='PT409'; end if;
  end if;
end;
$$;

create function private.home_media_record_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='pending' and (tg_op='INSERT' or old.state<>'pending') then
    insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
    values(new.bucket,new.name,'listing',new.property_id,new.object_id,new.object_version,new.bytes,'trashed',
      now(),now()+interval '48 hours')
    on conflict(bucket,name) do update set source=excluded.source,source_id=excluded.source_id,
      object_id=excluded.object_id,object_version=excluded.object_version,bytes=excluded.bytes,state='trashed',
      unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,
      upload_owner=null,upload_until=null,restored_to=null,restore_media=null,attempts=0,retry_after=null,
      deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored');
  end if;
  return new;
end;
$$;
create trigger home_media_record_listing after insert or update of state on private.home_listing_deletion_media
  for each row execute function private.home_media_record_listing();
-- Existing pending items receive a full recovery window after rollout.
insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
  select bucket,name,'listing',property_id,object_id,object_version,bytes,'trashed',now(),now()+interval '48 hours'
  from private.home_listing_deletion_media where state='pending';

create function private.home_media_capture_deleted_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.home_listing_deletion_media m where m.property_id=old.id and m.state='captured') then
    insert into private.home_media_deleted_listings(listing_id,snapshot,expires_at)
      values(old.id,to_jsonb(old),now()+interval '48 hours');
  end if;
  return old;
end;
$$;
create trigger home_media_capture_deleted_listing before delete on public.properties
  for each row execute function private.home_media_capture_deleted_listing();

-- Record a saved gallery/video removal without scanning other writers during save.
-- The worker checks all dependencies while holding the existing snapshot lock.
create function private.home_media_record_detached() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_media jsonb:=private.home_media_listing_fields(old);
  after_media jsonb:=private.home_media_listing_fields(new);
begin
  insert into private.home_media_renamed_listings(rename_id,listing_id,before_media,after_media)
  select r.id,old.id,before_media,after_media from private.property_photo_renames r where r.applied_at is not null
    and exists(select 1 from private.home_media_links(before_media) l where l.bucket='property-media' and l.name=r.old_key)
    and exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.new_key)
    and not exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.old_key)
  on conflict do nothing;
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,
    unreferenced_since,expires_at,restore_media)
  select o.bucket_id,o.name,'detached',old.id,o.id,o.version,
    case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
    'candidate',now(),now()+interval '48 hours',before_media
  from (
    select 'property-media'::text bucket,private.home_photo_key(u,null) name from unnest(old.images) u
    union select bucket,name from private.home_listing_storage_links(old.video_url) where bucket='listing-videos'
  ) prior cross join lateral private.home_media_identity(prior.bucket,prior.name) o
  where (private.home_listing_upload_id(o.bucket_id,o.name)=old.id::text or exists(
    select 1 from private.home_media_items i where i.bucket=o.bucket_id and i.name=o.name and i.state='restored'
      and i.restored_to=old.id and i.object_id=o.id and i.object_version is not distinct from o.version))
    and not exists(select 1 from private.home_media_links(to_jsonb(new)) l where l.bucket=o.bucket_id and l.name=o.name)
    and not exists(select 1 from private.property_photo_renames r where o.bucket_id='property-media' and o.name in (r.old_key,r.new_key))
  on conflict(bucket,name) do update set source='detached',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='candidate',hold_reason=null,
    unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,attempts=0,retry_after=null,
    restore_media=excluded.restore_media,restored_to=null,deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored','retained');
  return new;
end;
$$;
create trigger home_media_record_detached after update of images,video_url,image_metadata,image_filenames,source_url on public.properties
  for each row when (old.images is distinct from new.images or old.video_url is distinct from new.video_url
    or old.image_metadata is distinct from new.image_metadata or old.image_filenames is distinct from new.image_filenames
    or old.source_url is distinct from new.source_url)
  execute function private.home_media_record_detached();

create function public.home_media_trash_rename(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb; target storage.objects; replacement storage.objects; item private.home_media_items;
begin
  perform private.require_home_photo_owner();
  perform private.lock_home_listing_media_snapshot();
  job:=private.home_photo_rename_request_removal(p_id,true);
  if job->>'removed_at' is not null then return jsonb_build_object('removed',true); end if;
  select * into target from private.home_media_identity('property-media',job->>'old_key');
  if not found or job->>'current_key' is null or coalesce(job->>'sha256','') !~ '^[0-9a-f]{64}$'
    or private.home_media_referenced('property-media',target.name)
  then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  select * into replacement from private.home_media_identity('property-media',job->>'current_key');
  if not found then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,
    unreferenced_since,expires_at,replacement_key,replacement_sha256,replacement_id,replacement_version)
  values('property-media',target.name,'rename',p_id,target.id,target.version,
    case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
    'trashed',now(),now()+interval '48 hours',job->>'current_key',job->>'sha256',replacement.id,replacement.version)
  on conflict(bucket,name) do update set source='rename',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='trashed',unreferenced_since=excluded.unreferenced_since,
    expires_at=excluded.expires_at,replacement_key=excluded.replacement_key,replacement_sha256=excluded.replacement_sha256,
    replacement_id=excluded.replacement_id,replacement_version=excluded.replacement_version,upload_owner=null,upload_until=null,
    restored_to=null,restore_media=null,attempts=0,retry_after=null,deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored') and (home_media_items.object_id is null
      or home_media_items.object_id=excluded.object_id and home_media_items.object_version is not distinct from excluded.object_version);
  select * into item from private.home_media_items where bucket='property-media' and name=target.name;
  if item.source<>'rename' or item.source_id<>p_id or item.state not in ('trashed','deleting') then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409';
  end if;
  return jsonb_build_object('removed',false,'expiresAt',item.expires_at);
end;
$$;

create or replace function public.home_photo_rename_history(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return coalesce((select jsonb_agg(to_jsonb(h)) from (
    select r.id,r.old_key,r.new_key,r.applied_at,r.removed_at,r.auto_cleanup_requested,
      case when i.state in ('trashed','deleting') then i.expires_at end trash_expires_at
    from private.property_photo_renames r left join private.home_media_items i on i.source='rename' and i.source_id=r.id
    where r.property_id=p_property order by r.started_at desc limit 40
  ) h),'[]'::jsonb);
end;
$$;

-- Use recorded upload ownership and a completed Storage object. A legacy file,
-- saved listing path or in-flight rename has no proof of abandonment here.
create function private.home_media_stage_candidates() returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and not exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id(i.bucket,i.name))
    and (retry_after is null or retry_after<=now()) order by upload_until,id limit 40
  loop
    select * into target from private.home_media_identity(candidate.bucket,candidate.name);
    if not found and not exists(select 1 from storage.objects o where o.bucket_id=candidate.bucket and o.name=candidate.name) then
      -- The expired reservation never produced a completed object. Provider-side
      -- resumable sessions expire independently of this app metadata.
      delete from private.home_media_items where id=candidate.id and state='uploading' and upload_until<=now();
      continue;
    end if;
    if found and to_jsonb(target)->>'owner_id'=candidate.upload_owner::text
      and not exists(select 1 from public.properties p
        where p.id::text=private.home_listing_upload_id(candidate.bucket,candidate.name))
      and not exists(select 1 from private.property_photo_renames r where candidate.bucket='property-media'
        and candidate.name in(r.old_key,r.new_key))
      and not private.home_media_referenced(candidate.bucket,candidate.name)
    then
      update private.home_media_items set state='trashed',object_id=target.id,object_version=target.version,
        bytes=case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
        unreferenced_since=now(),expires_at=now()+interval '48 hours',retry_after=null
      where id=candidate.id and state='uploading' and upload_until<=now();
      if found then staged:=staged+1; end if;
    else
      update private.home_media_items set state='retained',hold_reason='upload_dependency',retry_after=null
        where id=candidate.id and state='uploading' and upload_until<=now();
    end if;
  end loop;
  return staged;
end;
$$;

create function private.home_media_restore_mode(item private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case item.source
    when 'detached' then case when item.restore_media is not null then 'listing' else 'unavailable' end
    when 'rename' then case when exists(select 1 from private.property_photo_renames r where r.id=item.source_id
      and jsonb_array_length(r.properties)>0 and not exists(select 1 from jsonb_array_elements(r.properties) p
        where not exists(select 1 from private.home_media_renamed_listings s where s.rename_id=r.id and s.listing_id::text=p->>'id')))
      then 'rename' else 'unavailable' end
    when 'listing' then coalesce((select case when private.home_media_saved_attachment(d.snapshot,item.bucket,item.name)
      then 'draft' else 'file' end from private.home_media_deleted_listings d
      where d.listing_id=item.source_id and d.expires_at>now()),'unavailable')
    else 'file' end;
$$;

create function private.home_media_apply_listing_fields(p_listing uuid,p_fields jsonb) returns void
language sql set search_path='' as $$
  update public.properties set images=array(select jsonb_array_elements_text(p_fields->'images')),
    image_filenames=p_fields->'image_filenames',image_metadata=p_fields->'image_metadata',
    video_url=p_fields->>'video_url',source_url=p_fields->>'source_url',updated_at=clock_timestamp()
  where id=p_listing;
$$;

-- Recover one file from its saved fields. Keep other links and use the prior
-- gallery neighbours to place it among the current images.
create function private.home_media_restore_attachment(p_listing uuid,item private.home_media_items,saved jsonb) returns void
language plpgsql set search_path='' as $$
declare current_listing public.properties; previous text[]; images text[]; ref record; position integer;
  filenames jsonb; meta jsonb; video text; source text;
begin
  select * into current_listing from public.properties where id=p_listing for update;
  if not found or not private.home_media_saved_attachment(saved,item.bucket,item.name) then
    raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
  images:=current_listing.images; video:=current_listing.video_url; source:=current_listing.source_url;
  filenames:='{}'; meta:='{}';
  if item.bucket='property-media' then
    previous:=array(select jsonb_array_elements_text(saved->'images'));
    for ref in select uri,ord from unnest(previous) with ordinality u(uri,ord)
      where private.home_photo_key(uri,null)=item.name order by ord
    loop
      if cardinality(array_positions(images,ref.uri))>=cardinality(array_positions(previous[1:ref.ord::integer],ref.uri))
      then continue; end if;
      select array_position(images,u.uri) into position from unnest(previous) with ordinality u(uri,ord)
        where u.ord>ref.ord and u.uri=any(images) order by u.ord limit 1;
      if not found then
        select array_position(images,u.uri)+1 into position from unnest(previous) with ordinality u(uri,ord)
          where u.ord<ref.ord and u.uri=any(images) order by u.ord desc limit 1;
      end if;
      position:=coalesce(position,least(ref.ord::integer,cardinality(images)+1));
      images:=images[1:position-1]||array[ref.uri]||images[position:cardinality(images)];
    end loop;
    select coalesce(jsonb_object_agg(key,value),'{}') into filenames from jsonb_each(saved->'image_filenames')
      where private.home_photo_key(key,null)=item.name;
    select coalesce(jsonb_object_agg(key,value),'{}') into meta from jsonb_each(saved->'image_metadata')
      where private.home_photo_key(key,null)=item.name;
    if cardinality(images)>40 or exists(select 1 from jsonb_each(filenames) f
      where current_listing.image_filenames ? f.key and current_listing.image_filenames->f.key is distinct from f.value)
      or exists(select 1 from jsonb_each(meta) m
      where current_listing.image_metadata ? m.key and current_listing.image_metadata->m.key is distinct from m.value)
      or exists(select 1 from unnest(current_listing.images) u where private.home_photo_key(u,null)=item.name and not u=any(previous))
    then raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
  else
    if video is not null and video is distinct from saved->>'video_url' then
      raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    video:=saved->>'video_url';
  end if;
  if exists(select 1 from private.home_media_links(to_jsonb(saved->>'source_url')) l
    where l.bucket=item.bucket and l.name=item.name) then
    if source is not null and source is distinct from saved->>'source_url' then
      raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    source:=saved->>'source_url';
  end if;
  perform private.home_media_apply_listing_fields(p_listing,jsonb_build_object('images',images,
    'image_filenames',current_listing.image_filenames||filenames,'image_metadata',current_listing.image_metadata||meta,
    'video_url',video,'source_url',source));
end;
$$;

create function private.home_media_restore_saved(item private.home_media_items,mode text) returns uuid
language plpgsql set search_path='' as $$
declare recovered private.home_media_deleted_listings; draft public.properties; target uuid;
begin
  if mode='listing' then
    perform private.home_media_restore_attachment(item.source_id,item,item.restore_media);
    return item.source_id;
  elsif mode='draft' then
    select * into recovered from private.home_media_deleted_listings where listing_id=item.source_id for update;
    if recovered.draft_id is null then
      target:=gen_random_uuid();
      draft:=jsonb_populate_record(null::public.properties,recovered.snapshot||jsonb_build_object('id',target,
        'slug',rtrim(left(recovered.snapshot->>'slug',132),'-')||'-restored-'||replace(target::text,'-',''),
        'listing_code',null,'status','draft','featured',false,'published_at',null,'created_at',now(),'updated_at',now(),
        'images','[]'::jsonb,'image_filenames','{}'::jsonb,'image_metadata','{}'::jsonb,'video_url',null,
        'source_url',case when not exists(select 1 from private.home_media_links(to_jsonb(recovered.snapshot->>'source_url')))
          then recovered.snapshot->>'source_url' end));
      insert into public.properties select (draft).*;
      update private.home_media_deleted_listings set draft_id=target where listing_id=item.source_id;
    else
      target:=recovered.draft_id;
      if not exists(select 1 from public.properties p where p.id=target and p.status='draft') then
        raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    end if;
    perform private.home_media_restore_attachment(target,item,recovered.snapshot);
    return target;
  elsif mode='rename' then
    if exists(select 1 from private.home_media_renamed_listings s left join public.properties p on p.id=s.listing_id
      where s.rename_id=item.source_id and (p.id is null or private.home_media_listing_fields(p) is distinct from s.after_media))
    then raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    perform private.home_media_apply_listing_fields(s.listing_id,s.before_media)
      from private.home_media_renamed_listings s where s.rename_id=item.source_id;
    return (select property_id from private.property_photo_renames where id=item.source_id);
  end if;
  return null;
end;
$$;

create function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; ctrl private.home_media_control; changed integer:=0; mode text; target uuid;
begin
  perform private.require_home_photo_owner();
  if p_action='authorize' then
    return jsonb_build_object('actor',auth.uid());
  elsif p_action='restore' then
    perform private.lock_home_listing_media_snapshot();
    select * into item from private.home_media_items where id=p_id for update;
    if found and item.state='restored' then
      return jsonb_build_object('id',p_id,'restored',true,'listingId',item.restored_to); end if;
    if not found or item.state not in ('candidate','trashed') or item.expires_at<=now() or not exists(
      select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version)
    then raise exception 'listing_cleanup.restore_unavailable' using errcode='PT409'; end if;
    mode:=private.home_media_restore_mode(item);
    if mode='unavailable' then raise exception 'listing_cleanup.restore_snapshot_missing' using errcode='PT409'; end if;
    update private.home_media_items set state='restored',retry_after=null,hold_reason=null where id=p_id;
    if item.source='listing' then
      update private.home_listing_deletion_media set state='retained'
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
    elsif item.source='rename' then
      update private.property_photo_renames set removal_requested_by=null,auto_cleanup_requested=false where id=item.source_id;
    end if;
    target:=private.home_media_restore_saved(item,mode);
    update private.home_media_items set restored_to=target,restore_media=null where id=p_id;
    return jsonb_build_object('id',p_id,'restored',true,'listingId',target);
  elsif p_action in ('scan','trash') then
    if p_action='trash' then
      perform private.lock_home_listing_media_snapshot();
      changed:=private.home_media_stage_candidates();
    end if;
    update private.home_media_control set last_scan_at=now();
  elsif p_action is distinct from 'status' then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  select * into ctrl from private.home_media_control where singleton;
  return (
    with refs as materialized (
      select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
    ), objects as materialized (
      select o.bucket_id bucket,o.name,case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes
      from storage.objects o where o.bucket_id in ('property-media','listing-videos')
    ), observed as (
      select o.*,r.name is null unlinked from objects o left join refs r using(bucket,name)
    ), history as (
      select i.id,i.bucket,i.name,i.state,i.hold_reason,i.expires_at,i.removed_at,i.unreferenced_since,
        private.home_media_restore_mode(i) as restore_mode
      from private.home_media_items i where i.state<>'uploading'
      union all
      select m.object_id,m.bucket,m.name,'removed',null,null,m.removed_at,null,'unavailable' from private.home_listing_deletion_media m
      where m.state='removed' and not exists(select 1 from private.home_media_items i where i.bucket=m.bucket and i.name=m.name)
      union all
      select r.id,'property-media',r.old_key,'removed',null,null,r.removed_at,null,'unavailable' from private.property_photo_renames r
      where r.removed_at is not null and not exists(select 1 from private.home_media_items i where i.bucket='property-media' and i.name=r.old_key)
        and not exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=r.old_key and m.state='removed')
    )
    select jsonb_build_object(
      'objects',(select count(*) from observed),'bytes',(select coalesce(sum(bytes),0) from observed),
      'candidates',(select count(*) from observed where unlinked),
      'candidateBytes',(select coalesce(sum(bytes),0) from observed where unlinked),
      'broken',(select count(*) from refs where not exists(select 1 from objects o where o.bucket=refs.bucket and o.name=refs.name)),
      'activeUploads',(select count(*) from private.home_media_items where state='uploading' and upload_until>now()),
      'abandoned',(select count(*) from private.home_media_items where source='upload' and state in ('trashed','deleting')),
      'trashed',(select count(*) from private.home_media_items where state='trashed'),
      'overdue',(select count(*) from private.home_media_items where state in ('candidate','trashed','deleting','review') and expires_at<=now()),
      'lastScanAt',ctrl.last_scan_at,'checkedAt',statement_timestamp(),'enabled',ctrl.permanent_enabled,'newlyTrashed',changed,
      'totalItems',(select count(*) from history),
      'items',coalesce((select jsonb_agg(to_jsonb(i)) from (
        select id,bucket,name,state,hold_reason,expires_at,removed_at,restore_mode from history
        order by (state in ('candidate','trashed') and expires_at>now()) desc nulls last,
          coalesce(removed_at,unreferenced_since) desc nulls last,id limit 30
          offset least(greatest(coalesce(p_offset,0),0),1000000)
      ) i),'[]'::jsonb),
      'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
        select started_at,finished_at,attempted,removed,failed from private.home_media_runs order by started_at desc limit 10
      ) r),'[]'::jsonb)
    )
  );
end;
$$;

create function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  if p_item is not null and p_actor is null then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry) values(job,p_actor,p_item,p_expiry);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items m
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now()) and (
        (state='trashed' and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

-- Recheck immediately before the Storage API call. The durable reservation
-- blocks new links and authenticated uploads after this transaction commits.
create function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean;
begin
  select r.* into job from private.home_media_control c join private.home_media_runs r on r.id=c.lease
  where c.lease=p_run and c.lease_until>now() and c.permanent_enabled;
  if not found then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if job.actor is not null then
    perform set_config('request.jwt.claim.sub',job.actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  perform private.lock_home_listing_media_snapshot();
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.retry_after>now() or item.upload_until>now()
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry))
    then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if (job.early_item is null and (item.state not in ('trashed','deleting')
      or (item.deletion_started_at is null and item.expires_at>now())))
    or (job.early_item is not null and item.state not in ('candidate','trashed')) or item.attempts>=4
    then return null; end if;
  if private.home_media_referenced(item.bucket,item.name,item.source='historical')
    or not present
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version
      and (item.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=item.historical_review->>'etag')))
    or (item.source='historical' and private.home_media_provider_upload(item.bucket,item.name))
    or (item.source='rename' and (not exists(select 1 from private.home_media_identity('property-media',item.replacement_key) o
      where o.id=item.replacement_id and o.version is not distinct from item.replacement_version)
      or not exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=item.replacement_key)))
  then
    update private.home_media_items set state='review',hold_reason='dependency_or_identity' where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return null;
  end if;
  if item.source='rename' and p_replacement_verified is not true then
    update private.home_media_items set attempts=attempts+1,retry_after=now()+interval '1 hour',
      state=case when attempts>=3 then 'review' else state end,hold_reason='replacement' where id=p_id;
    update private.home_media_runs set attempted=attempted+1,failed=failed+1 where id=p_run;
    return null;
  end if;
  update private.home_media_items set state='deleting',attempts=attempts+1,retry_after=now()+interval '1 hour',
    deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),deletion_run=p_run where id=p_id;
  update private.home_media_runs set attempted=attempted+1 where id=p_run;
  return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',present,
    'replacementKey',item.replacement_key,'replacementSha256',item.replacement_sha256);
end;
$$;

create function public.home_media_settle(p_run uuid,p_id uuid,p_ok boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items;
begin
  if not exists(select 1 from private.home_media_control c where c.lease=p_run and c.lease_until>now()) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.deletion_run is distinct from p_run or item.deletion_started_at is null then return false; end if;
  if item.state='removed' then return true; end if;
  if item.state<>'deleting' then return false; end if;
  if exists(select 1 from storage.objects where bucket_id=item.bucket and name=item.name) then
    update private.home_media_items set state=case when item.attempts>=4 then 'review' else state end,
      hold_reason=case when p_ok is true then 'storage_present' else 'storage' end where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return false;
  end if;
  update private.home_media_items set state='removed',removed_at=clock_timestamp(),upload_owner=null,
    upload_until=null,object_id=null,object_version=null,replacement_key=null,replacement_sha256=null,replacement_id=null,replacement_version=null,
    retry_after=null,hold_reason=null,restore_media=null where id=p_id;
  if item.source='listing' then
    update private.home_listing_deletion_media set state='removed',removed_at=clock_timestamp()
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
  elsif item.source='rename' then
    update private.property_photo_renames set removed_at=clock_timestamp() where id=item.source_id;
    delete from private.home_media_renamed_listings where rename_id=item.source_id;
  end if;
  update private.home_media_runs set removed=removed+1 where id=p_run;
  return true;
end;
$$;

create function public.home_media_finish(p_run uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
  update private.home_media_control set lease=null,lease_until=null where lease=p_run;
  if found then update private.home_media_runs set finished_at=clock_timestamp() where id=p_run; end if;
  return (select count(*)::integer from private.home_media_items
    where state in ('candidate','trashed','deleting','review') and expires_at<=now());
end;
$$;

-- The Owner panel owns bulk inventory. Admins retain the receipt of an individual listing deletion.
create or replace function public.home_listing_delete_status(p_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_property is not null then
    perform private.require_home_photo_admin();
    return private.home_listing_delete_result(p_property);
  end if;
  perform private.require_home_photo_owner();
  return coalesce((select jsonb_agg(private.home_listing_delete_result(q.property_id)) from (
    select property_id from private.home_listing_deletions order by requested_at desc limit 40
  ) q),'[]'::jsonb);
end;
$$;

alter function public.home_listing_delete_adopt(uuid,jsonb) set schema private;
revoke all on function private.home_listing_delete_adopt(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.home_listing_delete_adopt(p_property uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_listing_delete_adopt(p_property,p_manifest);
end;
$$;
revoke all on function public.home_listing_delete_adopt(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.home_listing_delete_adopt(uuid,jsonb) to authenticated;

-- Close the legacy immediate worker. Existing ledgers are settled by the
-- lifecycle worker only, with the typed object identity and a verified absence.
revoke execute on function public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),public.home_listing_delete_release(uuid,uuid)
  from public,anon,authenticated,service_role;

revoke all on function private.home_media_links(jsonb),private.home_media_referenced(text,text,boolean),
  private.home_media_identity(text,text),private.home_media_record_listing(),private.home_media_record_detached(),private.home_media_stage_candidates(),
  private.home_media_listing_fields(public.properties),private.home_media_saved_attachment(jsonb,text,text),
  private.home_media_capture_deleted_listing(),private.home_media_provider_upload(text,text),
  private.home_media_restore_mode(private.home_media_items),private.home_media_apply_listing_fields(uuid,jsonb),
  private.home_media_restore_attachment(uuid,private.home_media_items,jsonb),private.home_media_restore_saved(private.home_media_items,text)
  from public,anon,authenticated,service_role;
revoke all on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid),public.home_media_enroll_historical(jsonb,boolean),
  public.home_media_claim(uuid,uuid,timestamptz),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) from public,anon,authenticated,service_role;
grant execute on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid),public.home_media_enroll_historical(jsonb,boolean) to authenticated;
grant execute on function public.home_media_claim(uuid,uuid,timestamptz),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) to service_role;

notify pgrst,'reload schema';
commit;
