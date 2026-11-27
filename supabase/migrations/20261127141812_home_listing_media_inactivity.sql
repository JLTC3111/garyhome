-- The existing worker observes scoped media while the new policy is in preview.
begin;

alter table private.home_media_control add column listing_inactivity_enabled boolean not null default false;
alter table private.home_media_items drop constraint home_media_items_source_check,
  add constraint home_media_items_source_check
    check(source in ('listing','rename','upload','detached','historical','unused_listing'));
create index home_media_listing_inactivity_due on private.home_media_items(expires_at,id)
  where source='unused_listing' and state='retained';

alter table private.home_media_review_holds alter column actor drop not null,
  add column reason text not null default 'owner_hold',
  add check (reason in ('owner_hold','recovery_hold','file_trash_test') and (actor is not null or reason<>'owner_hold'));

create function private.home_media_scope_id(p_bucket text,p_name text) returns uuid
language sql immutable set search_path='' as $$
  select (case p_bucket
    when 'property-media' then substring(p_name from
      '(?i)^properties/listings/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/.+\.(?:jpe?g|png|webp|avif)$')
    when 'listing-videos' then substring(p_name from
      '(?i)^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/[^/]+\.mp4$')
    end)::uuid;
$$;

-- Exact links and keys are distinct from ambiguous original filename matches.
create function private.home_media_document_evidence(p_doc jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  select * from private.home_media_links(p_doc) where name is not null
  union
  select b.bucket,coalesce(private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||v.name,null),v.name)
  from (values ('property-media'),('listing-videos')) b(bucket)
  cross join lateral (
    select value #>> '{}' name from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
    union all
    select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_metadata')='object' then p_doc->'image_metadata' end) key
    union all
    select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_filenames')='object' then p_doc->'image_filenames' end) key
  ) v where private.home_media_scope_id(b.bucket,v.name) is not null
  union
  select null::text,lower(btrim(value #>> '{}'))
  from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
  where length(value #>> '{}') between 1 and 1024;
$$;

create function private.home_media_reference_documents() returns setof jsonb
language sql stable set search_path='' as $$
  select to_jsonb(t) from public.properties t
  union all select to_jsonb(t) from public.neighbourhoods t
  union all select to_jsonb(t) from public.site_settings t
  union all select to_jsonb(t) from public.listing_authors t
  union all select to_jsonb(t) from public.site_activities t
  union all select to_jsonb(t) from public.editorial_articles t
  union all select to_jsonb(t) from public.enquiries t
  union all select to_jsonb(t) from public.enquiry_notes t
  union all select to_jsonb(t) from public.feedback_public t
  union all select to_jsonb(t) from public.feedback_submissions t
  union all select to_jsonb(t) from public.property_assistance t
  union all select to_jsonb(t) from public.assistance_reviews t
  union all select to_jsonb(t) from public.landlord_submissions t
  union all select to_jsonb(t) from public.landlord_submission_files t
  union all select * from private.home_media_shared_documents();
$$;

create table private.home_media_edit_checkpoints (
  actor uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  revision bigint not null,
  checkpoint jsonb,
  links jsonb not null default '[]',
  primary key(actor,id)
);
create index home_media_checkpoint_links on private.home_media_edit_checkpoints using gin(links jsonb_path_ops);
alter table private.home_media_edit_checkpoints enable row level security;
revoke all on private.home_media_edit_checkpoints from public,anon,authenticated,service_role;

create function private.home_media_edit_referenced(p_bucket text,p_name text) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_media_edit_checkpoints c where c.links @> jsonb_build_array(p_bucket||'/'||p_name));
$$;

create function public.home_media_gallery_checkpoints(p_actor uuid,p_checkpoint jsonb default null,p_discard boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session_id uuid; listing_id uuid; revision bigint; current_revision bigint; current_checkpoint jsonb; media jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor or not coalesce(private.is_editor(),false) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501';
  end if;
  if p_checkpoint is null and p_discard is false then
    return (select coalesce(jsonb_agg(c.checkpoint order by c.revision desc),'[]')
      from private.home_media_edit_checkpoints c where c.actor=p_actor and c.checkpoint is not null);
  end if;
  if jsonb_typeof(p_checkpoint) is distinct from 'object' or p_discard is null
    or length(p_checkpoint::text)>262144 or coalesce(p_checkpoint->>'savedAt','') !~ '^[0-9]{1,16}$'
    or p_checkpoint->>'key' is null or p_checkpoint->>'listingId' is null
    or jsonb_typeof(p_checkpoint->'title') is distinct from 'string'
    or jsonb_typeof(p_checkpoint#>'{baseGallery,images}') is distinct from 'array'
    or jsonb_typeof(p_checkpoint#>'{gallery,images}') is distinct from 'array'
    or jsonb_typeof(p_checkpoint->'pending') is distinct from 'array' then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  session_id:=(p_checkpoint->>'key')::uuid;
  listing_id:=(p_checkpoint->>'listingId')::uuid;
  revision:=(p_checkpoint->>'savedAt')::bigint;
  if revision>9007199254740991 or jsonb_array_length(p_checkpoint#>'{gallery,images}')>40
    or exists(select 1 from jsonb_array_elements(p_checkpoint#>'{gallery,images}') v where jsonb_typeof(v)<>'string')
    or exists(select 1 from jsonb_array_elements(p_checkpoint->'pending') u
      where private.home_media_scope_id('property-media',u->>'path') is distinct from listing_id) then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  -- Share the existing reservation lock. A checkpoint and a delete intent cannot win together.
  if not pg_try_advisory_xact_lock(hashtextextended('home.photo.rename',0)) then
    raise exception 'listing_cleanup.media_busy' using errcode='55P03';
  end if;
  select c.revision,c.checkpoint into current_revision,current_checkpoint
    from private.home_media_edit_checkpoints c where c.actor=p_actor and c.id=session_id;
  if found and current_checkpoint is null then return '"discarded"'::jsonb; end if;
  if current_revision>revision then return '"newer"'::jsonb; end if;
  if p_discard then
    p_checkpoint:=null;
    media:='[]';
  else
    select coalesce(jsonb_agg(l.bucket||'/'||l.name),'[]') into media from private.home_media_document_evidence(
      jsonb_build_array(p_checkpoint->'gallery'->'images',p_checkpoint->'gallery'->'video_url',
        coalesce((select jsonb_agg(u->'path') from jsonb_array_elements(p_checkpoint->'pending') u),'[]'))) l
    where private.home_media_scope_id(l.bucket,l.name) is not null;
    if exists(select 1 from private.home_media_items i where i.source='unused_listing'
      and i.state in ('deleting','removed','review') and media @> jsonb_build_array(i.bucket||'/'||i.name)
      and not private.home_media_edit_referenced(i.bucket,i.name)) then
      raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
    end if;
    delete from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      and media @> jsonb_build_array(i.bucket||'/'||i.name);
  end if;
  insert into private.home_media_edit_checkpoints(actor,id,revision,checkpoint,links)
    values(p_actor,session_id,revision,p_checkpoint,media)
  on conflict(actor,id) do update set revision=excluded.revision,checkpoint=excluded.checkpoint,links=excluded.links;
  return to_jsonb(case when p_discard then 'discarded' else 'saved' end);
end;
$$;

-- Existing detached and historical rows keep their lifecycle. A directory is scope metadata.
create or replace function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false)
returns boolean language sql stable set search_path='' as $$
  select private.home_media_edit_referenced(p_bucket,p_name)
    or private.home_media_content_referenced(p_bucket,p_name,p_include_original_name)
    -- Preserve the earlier GH-56 receipt's exact draft and identity guard.
    or (p_include_original_name and p_bucket='property-media' and exists(
      select 1 from private.home_media_items i where i.bucket=p_bucket and i.name=p_name
        and i.source='historical' and i.historical_review->>'scope'='GH-56'
        and not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name
          and o.id=i.object_id and o.version=i.object_version and o.metadata->>'size'=i.bytes::text
          and btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag'
          and private.home_media_gh56_identity(i.name,i.object_id,i.object_version,i.bytes,i.historical_review->>'etag')
          and not private.home_media_gh56_pending(i.name))));
$$;

create function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,s.listing_id from storage.objects o
    cross join lateral (select private.home_media_scope_id(o.bucket_id,o.name) listing_id) s
    where o.bucket_id in ('property-media','listing-videos') and s.listing_id is not null
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), refs as materialized (
    select distinct l.bucket,l.name from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
    where exists(select 1 from objects)
  ), observed as (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or private.home_media_provider_upload(o.bucket_id,o.name) then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when exists(select 1 from private.home_listing_deletion_media m where m.bucket=o.bucket_id and m.name=o.name)
          or (o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key)))
          then 'legacy_lifecycle'
        when not exists(select 1 from private.home_media_identity(o.bucket_id,o.name) verified where verified.id=o.id)
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state
    from objects o left join public.properties p on p.id=o.listing_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join refs link on link.bucket=o.bucket_id and link.name=o.name
    left join refs full_key on full_key.bucket is null and full_key.name=lower(o.name)
    left join refs filename on filename.bucket is null and filename.name=lower(regexp_replace(o.name,'^.*/',''))
    left join refs original on original.bucket is null and original.name=lower(btrim(o.user_metadata->>'original_filename'))
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end
  from observed o;
$$;

-- The Owner can inspect old and new objects without moving any of them to Trash.
create function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page jsonb; needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  select coalesce(jsonb_agg(to_jsonb(s) order by s.bucket,s.name),'[]') into page from (
    select r.*,r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible
    from private.home_media_inactivity_inventory() r cross join private.home_media_control c
    where c.singleton and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0)
    order by r.bucket,r.name limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)
  ) s;
  return jsonb_build_object('items',page-30,'hasMore',jsonb_array_length(page)>30,'available',true,
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton));
end;
$$;

-- Observe and clear timers in a single snapshot. Legacy Trash and its receipts are outside the update.
create function private.home_media_observe_listing_inactivity() returns void
language sql set search_path='' as $$
  with unused as materialized (
    select * from private.home_media_inactivity_inventory() where reason in ('awaiting_observation','waiting','eligible')
  ), reset as (
    delete from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      and not exists(select 1 from unused s where s.bucket=i.bucket and s.name=i.name)
  )
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
  select s.bucket,s.name,'unused_listing',s.listing_id,s.object_id,s.object_version,s.bytes,'retained',now(),now()+interval '96 hours'
  from unused s where s.reason='awaiting_observation'
  on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
    upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
  where home_media_items.source='unused_listing' and home_media_items.state='retained'
    or home_media_items.source='upload' and home_media_items.state in ('uploading','retained');
$$;

-- Use the existing worker lock plus the same shared catalogues inspected for references.
create function private.home_media_lock_listing_inactivity() returns void
language plpgsql set search_path='' as $$
declare catalog text;
begin
  foreach catalog in array private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      execute format('lock table public.%I in share row exclusive mode nowait',catalog);
    end if;
  end loop;
end;
$$;

-- A use that starts and ends between hourly observations still resets the clock.
-- Reserve at delete intent so a file remains attachable right up to that point.
create function private.home_media_reset_listing_inactivity() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb; keys jsonb;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  select jsonb_agg(to_jsonb(added)) into keys from (
    select * from private.home_media_document_evidence(to_jsonb(new))
    except select * from private.home_media_document_evidence(prior)
  ) added;
  if keys is null then return new; end if;
  if exists(select 1 from private.home_media_items i
    join jsonb_to_recordset(keys) k(bucket text,name text) on k.bucket=i.bucket and k.name=i.name
    where i.source='unused_listing' and i.state in ('deleting','removed','review'))
    or exists(select 1 from private.home_media_items i join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
      join jsonb_to_recordset(keys) k(bucket text,name text) on k.bucket is null and k.name in
        (lower(i.name),lower(regexp_replace(i.name,'^.*/','')),lower(btrim(o.user_metadata->>'original_filename')))
      where i.source='unused_listing' and i.state in ('deleting','review')) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  delete from private.home_media_items i using jsonb_to_recordset(keys) k(bucket text,name text),storage.objects o
    where i.source='unused_listing' and i.state='retained' and o.bucket_id=i.bucket and o.name=i.name
      and (k.bucket=i.bucket and k.name=i.name or k.bucket is null and k.name in
        (lower(i.name),lower(regexp_replace(i.name,'^.*/','')),lower(btrim(o.user_metadata->>'original_filename'))));
  return new;
end;
$$;

do $$
declare catalog text;
begin
  foreach catalog in array array['properties','neighbourhoods','site_settings','listing_authors','site_activities',
    'editorial_articles','enquiries','enquiry_notes','feedback_public','feedback_submissions','property_assistance',
    'assistance_reviews','landlord_submissions','landlord_submission_files']||private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      execute format('create trigger home_media_reset_listing_inactivity before insert or update on public.%I
        for each row execute function private.home_media_reset_listing_inactivity()',catalog);
    end if;
  end loop;
end;
$$;

create function private.home_media_reset_on_hold() returns trigger
language plpgsql set search_path='' as $$
begin
  delete from private.home_media_items where bucket=new.bucket and name=new.name and source='unused_listing' and state='retained';
  return new;
end;
$$;
create trigger home_media_reset_on_hold after insert on private.home_media_review_holds
  for each row execute function private.home_media_reset_on_hold();

-- An explicit listing deletion takes over an observation. A reserved removal already has a receipt.
create function private.home_media_release_listing_observation() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.home_media_items where bucket=new.bucket and name=new.name
    and source='unused_listing' and state in ('deleting','removed','review')) then return null; end if;
  delete from private.home_media_items where bucket=new.bucket and name=new.name and source='unused_listing' and state='retained';
  return new;
end;
$$;
create trigger home_media_release_listing_observation before insert on private.home_listing_deletion_media
  for each row execute function private.home_media_release_listing_observation();

create or replace function private.home_media_record_detached() returns trigger
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
  where (private.home_media_scope_id(o.bucket_id,o.name)=old.id or exists(
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

-- Keep manually verified File Trash staging and its 48-hour deadlines.
create or replace function private.home_media_stage_candidates(p_only uuid) returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items i where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    and (p_only is null or id=p_only)
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif private.home_media_provider_upload(candidate.bucket,candidate.name) then
      if p_only is not null then raise exception 'listing_cleanup.media_busy' using errcode='55P03'; end if;
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and (p_only is null or i.id=p_only)
    and (private.home_media_scope_id(i.bucket,i.name) is null
      or not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name))
    and not private.home_media_provider_upload(i.bucket,i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
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

create or replace function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
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
  if p_item is not null and not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    perform private.home_media_lock_listing_inactivity();
    perform private.home_media_observe_listing_inactivity();
    if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)) then
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
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now())
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name)
        and not private.home_media_edit_referenced(m.bucket,m.name) and (
        ((state='trashed' or (source='unused_listing' and state='retained' and ctrl.listing_inactivity_enabled))
          and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4 and (source<>'unused_listing' or ctrl.listing_inactivity_enabled)) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

create or replace function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean; protection text;
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
  if exists(select 1 from private.home_media_review_holds h where h.bucket=item.bucket and h.name=item.name)
    or private.home_media_edit_referenced(item.bucket,item.name)
    or private.home_media_provider_upload(item.bucket,item.name) then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if item.source='unused_listing' then
    if job.early_item is not null or item.state not in ('retained','deleting') or item.expires_at>now()
      or item.attempts>=4 or not (select listing_inactivity_enabled from private.home_media_control where singleton)
      then return null; end if;
    perform private.home_media_lock_listing_inactivity();
    select r.reason into protection from private.home_media_inactivity_inventory(item.bucket,item.name) r;
    if protection is null or protection not in ('eligible','removing') then
      delete from private.home_media_items where id=p_id and state='retained';
      return null;
    end if;
  elsif (job.early_item is null and (item.state not in ('trashed','deleting')
      or (item.deletion_started_at is null and item.expires_at>now())))
    or (job.early_item is not null and item.state not in ('candidate','trashed')) or item.attempts>=4
    then return null; end if;
  if (item.source<>'unused_listing' and private.home_media_referenced(item.bucket,item.name,item.source='historical'))
    or not present
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version
      and (item.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=item.historical_review->>'etag')))
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

create or replace function public.home_media_finish(p_run uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
  update private.home_media_control set lease=null,lease_until=null where lease=p_run;
  if found then update private.home_media_runs set finished_at=clock_timestamp() where id=p_run; end if;
  return (select count(*)::integer from private.home_media_items i
    where (i.state in ('candidate','trashed','deleting','review') or (i.source='unused_listing' and i.state='retained'
      and (select listing_inactivity_enabled from private.home_media_control where singleton))) and i.expires_at<=now()
      and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
      and not private.home_media_edit_referenced(i.bucket,i.name));
end;
$$;

create or replace function private.home_media_take_inventory(p_scan boolean,p_after uuid default null) returns jsonb
language sql stable set search_path='' as $$
  with refs as materialized (
    select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
  ), checking as materialized (
    select i.* from private.home_media_items i
    where p_scan and (i.state='candidate' or (i.state='uploading' and i.upload_until<=now()
      and private.home_media_scope_id(i.bucket,i.name) is null))
      and coalesce(i.upload_until,'-infinity')<=now() and coalesce(i.retry_after,'-infinity')<=now()
    order by (p_after is not null and i.id<=p_after),i.id limit 1
  ), verified as materialized (
    select i.id,o.id as object_id,o.version from checking i cross join lateral private.home_media_identity(i.bucket,i.name) o
    where (i.state='candidate' and o.id=i.object_id and o.version is not distinct from i.object_version
      or i.state='uploading' and o.owner_id::text=i.upload_owner::text
        and not exists(select 1 from private.property_photo_renames r where i.bucket='property-media' and i.name in(r.old_key,r.new_key)))
      and not exists(select 1 from refs r where r.bucket=i.bucket and r.name=i.name)
      and not private.home_media_provider_upload(i.bucket,i.name)
      and not private.home_media_referenced(i.bucket,i.name)
  ), observed as materialized (
    select o.bucket_id as bucket,o.name,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      r.name is null unlinked,
      case when r.name is not null then 'reference'
        when i.state in ('trashed','deleting') then 'scheduled'
        when v.id is not null then 'verified'
        when i.state='uploading' and i.upload_until>now() then 'upload'
        when i.state='review' or (i.state='retained' and i.source not in ('unused_listing','upload')) then 'review'
        when h.name is not null then h.reason
        when private.home_media_scope_id(o.bucket_id,o.name) is not null then 'scope_retention'
        when o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames pr
          where (pr.new_key=o.name and pr.applied_at is null) or (pr.old_key=o.name and pr.removed_at is null)) then 'rename'
        else 'potential' end as reason
    from storage.objects o left join refs r on r.bucket=o.bucket_id and r.name=o.name
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name left join verified v on v.id=i.id
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    where o.bucket_id in ('property-media','listing-videos')
  ), totals as (
    select count(*) as objects,coalesce(sum(bytes),0) as bytes,
      count(*) filter(where unlinked) as candidates,coalesce(sum(bytes) filter(where unlinked),0) as candidate_bytes,
      count(*) filter(where reason in ('reference','upload','review','rename','owner_hold','recovery_hold','file_trash_test')) as protected,
      count(*) filter(where unlinked and reason in ('upload','review','rename','owner_hold','recovery_hold','file_trash_test')) as protected_candidates,
      count(*) filter(where reason='potential') as unreviewed,
      count(*) filter(where reason='verified') as verified_count,
      coalesce(sum(bytes) filter(where reason='verified'),0) as verified_bytes
    from observed
  )
  select jsonb_build_object('objects',t.objects,'bytes',t.bytes,'candidates',t.candidates,'candidateBytes',t.candidate_bytes,
    'protected',t.protected,'protectedCandidates',t.protected_candidates,'unreviewed',t.unreviewed,
    'verifiedAtScan',t.verified_count,'verifiedBytesAtScan',t.verified_bytes,'checkedAt',statement_timestamp(),
    'checkedQueue',(select count(*) from checking),'reviewedId',(select id from checking),
    'broken',(select count(*) from refs r where not exists(select 1 from observed o where o.bucket=r.bucket and o.name=r.name)))
    || case when p_scan then jsonb_build_object(
      'entries',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'name',name,'bytes',bytes,'reason',reason) order by bucket,name)
        from observed),'[]'::jsonb),
      'verifiedObjects',coalesce((select jsonb_agg(to_jsonb(v)) from verified v),'[]'::jsonb)) else '{}'::jsonb end
  from totals t;
$$;

create or replace function public.home_media_review(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sample jsonb; page jsonb; target storage.objects; reason text;
  media_bucket text:=p_payload->>'bucket'; object_name text:=p_payload->>'key';
  skip integer:=0; needle text:=lower(left(btrim(coalesce(p_payload->>'query','')),120));
begin
  perform private.require_home_photo_owner();
  if p_action='page' then
    if coalesce(p_payload->>'offset','0') !~ '^[0-9]{1,6}$' then
      raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
    skip:=coalesce((p_payload->>'offset')::integer,0);
    select inventory_sample into sample from private.home_media_control where singleton;
    select coalesce(jsonb_agg(jsonb_build_object('bucket',c.bucket,'key',c.name,
      'bytes',case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint end,
      'objectId',o.id,'version',o.version,'etag',btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"'),
      'listingCode',coalesce(c.listing_code,c.listing_id::text),'listingStatus',c.status,'held',h.name is not null,
      'reason',case when o.id is null then 'identity' when h.name is not null then h.reason
        when private.home_media_scope_id(c.bucket,c.name) is not null then 'scope_retention' when i.id is not null then 'tracked'
        when c.reason not in ('potential','verified') then c.reason
        when c.bucket='listing-videos' then 'video_review' else 'potential' end) order by c.ordinality),'[]'::jsonb)
    into page from (
      select e.value->>'bucket' as bucket,e.value->>'name' as name,e.value->>'reason' as reason,e.ordinality,p.id as listing_id,p.listing_code,p.status
      from jsonb_array_elements(sample->'entries') with ordinality e
      left join public.properties p on p.id=private.home_media_scope_id(e.value->>'bucket',e.value->>'name')
      where e.value->>'reason' not in ('reference','scheduled')
        and (needle='' or position(needle in lower(e.value->>'name'))>0 or position(needle in lower(p.listing_code))>0)
        and not exists(select 1 from private.home_media_items q where q.bucket=e.value->>'bucket' and q.name=e.value->>'name'
          and q.state in ('trashed','deleting','removed'))
      order by e.ordinality limit 31 offset skip
    ) c left join storage.objects o on o.bucket_id=c.bucket and o.name=c.name
      left join private.home_media_items i on i.bucket=c.bucket and i.name=c.name
      left join private.home_media_review_holds h on h.bucket=c.bucket and h.name=c.name;
    return jsonb_build_object('items',page-30,'hasMore',jsonb_array_length(page)>30,'available',sample is not null,
      'holds',(select count(*) from private.home_media_review_holds));
  end if;

  if p_action is null or p_action not in ('verify','hold','release','enroll')
    or media_bucket is null or media_bucket not in ('property-media','listing-videos')
    or char_length(coalesce(object_name,'')) not between 1 and 1024 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if p_action='enroll' then
    if media_bucket<>'property-media' then raise exception 'listing_cleanup.video_review' using errcode='PT409'; end if;
    return public.home_media_enroll_historical(p_payload,p_payload->'confirm'='true'::jsonb);
  end if;

  if p_action in ('hold','release') then perform private.lock_home_listing_media_snapshot(); end if;
  select * into target from private.home_media_identity(media_bucket,object_name);
  if not found or target.id::text is distinct from p_payload->>'objectId'
    or target.version is distinct from p_payload->>'version'
    or target.metadata->>'size' is distinct from p_payload->>'bytes'
    or btrim(coalesce(target.metadata->>'eTag',target.metadata->>'etag'),'"') is distinct from p_payload->>'etag' then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;

  if p_action in ('hold','release') then
    if p_payload->'confirm' is distinct from 'true'::jsonb then
      raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
    if exists(select 1 from private.home_media_items i where i.bucket=media_bucket and i.name=object_name
      and (i.state in ('removed','deleting') or i.deletion_started_at is not null)) then
      raise exception 'listing_cleanup.media_busy' using errcode='55P03'; end if;
    if p_action='hold' then
      insert into private.home_media_review_holds(bucket,name,actor) values(media_bucket,object_name,auth.uid()) on conflict do nothing;
    else
      delete from private.home_media_review_holds h where h.bucket=media_bucket and h.name=object_name;
    end if;
    return jsonb_build_object('held',p_action='hold');
  end if;

  reason:=case
    when private.home_media_scope_id(media_bucket,object_name) is not null then
      (select case when s.reason in ('owner_hold','recovery_hold','file_trash_test','reference','filename_match','identity')
        then s.reason else 'scope_retention' end from private.home_media_inactivity_inventory(media_bucket,object_name) s)
    when exists(select 1 from private.home_media_review_holds h where h.bucket=media_bucket and h.name=object_name) then 'owner_hold'
    when exists(select 1 from private.home_media_items i where i.bucket=media_bucket and i.name=object_name) then 'tracked'
    when private.home_media_provider_upload(media_bucket,object_name) then 'upload'
    when media_bucket='listing-videos' then 'video_review'
    when exists(select 1 from private.property_photo_renames r where object_name in(r.old_key,r.new_key)) then 'rename'
    when exists(select 1 from private.home_listing_deletion_media m where m.bucket=media_bucket and m.name=object_name) then 'tracked'
    when not exists(select 1 from private.home_listing_storage_links('/property-media/'||object_name) l where l.name=object_name) then 'identity'
    when private.home_media_referenced(media_bucket,object_name,true) then 'reference'
    else 'evidence_required' end;
  return jsonb_build_object('result',reason);
end;
$$;

create or replace function private.home_media_early_block(i private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case
    when i.state='deleting' then 'removal_in_progress'
    when i.state='review' and i.hold_reason in ('storage','storage_present') then 'storage_failure'
    when i.state='review' then 'protected'
    when i.state<>'trashed' then 'no_longer_eligible'
    when i.expires_at is null then 'missing_expiry'
    when exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name) then
      (select h.reason from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    when private.home_media_edit_referenced(i.bucket,i.name) then 'editing_session'
    when i.expires_at<=now() then 'expired'
    when i.upload_until>now() then 'active_upload'
    when i.retry_after>now() then 'retry_wait'
    when i.attempts>=4 then 'attempt_limit'
    when not exists(select 1 from private.home_media_identity(i.bucket,i.name) o
      where o.id=i.object_id and o.version is not distinct from i.object_version
        and (i.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag')) then 'identity_changed'
    end;
$$;

-- Use the audited object ID and version for the 14 recovery photos and the two
-- GH-56 File Trash tests. These holds do not rewrite the File Trash records.
insert into private.home_media_review_holds(bucket,name,reason)
select o.bucket_id,o.name,a.reason from (values
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/2bd6c300-127b-4be3-8818-2adfe45784d9/1795572992608-7775080045339692044-7775080045339692044-0ae40c547edcc18bcb5c18d4d4c5104a.jpg',
   'b966a9a6-c782-4a8c-918b-43d8944c4c92'::uuid,'3f0ebf9b-322a-44fe-b431-aec27f6a7891','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/b9002740-2ca8-4124-aee7-21f8b621c5d6/1795572992589-7775080045339692044-7775080045339692044-4f46cd03edad4d273045d0f578be4c5b.jpg',
   '781e3623-0ead-48e1-829a-a83ca868df61'::uuid,'0f33605e-f8ec-453e-934e-155e6d5e8d42','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/17c628e9-92da-442c-a14f-6b5ea28e873b/1795572992605-7775080045339692044-7775080045339692044-60e4283f896761a6755dc784f8c866de.jpg',
   '5901cb59-0bcf-4b65-9e54-dd1b09b1e555'::uuid,'3c9a0cd9-917a-4d86-b1db-4993a4904503','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/d8f287c2-2861-4a7c-aa3b-70c57a7f8454/1795572992608-7775080045339692044-7775080045339692044-0ae40c547edcc18bcb5c18d4d4c5104a.jpg',
   '9f154194-7c18-4834-8f9d-32de4fb2d26e'::uuid,'609abc27-0927-4a6a-b90d-82ccf3270ad1','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/ee4aa432-e05d-4712-b5aa-3274465c32c0/1795572992600-7775080045339692044-7775080045339692044-e10ee1f29d4eff41f84170ecd3d138a0.jpg',
   '491ff5c0-e54b-49de-8fd3-d9e6c3ea6ed1'::uuid,'9f8690de-8f31-49a2-9b60-f2bbf9206fcb','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/13f328a4-23c2-42c1-86d4-59cff7051dfa/1795572992610-7775080045339692044-7775080045339692044-00c06460ff3c70cb209ec74d766478cf.jpg',
   'ee7a2908-28f3-4157-8b7e-ac2371d79df9'::uuid,'ec67320f-d4f8-4be3-a516-7a5b59da606d','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/ced2f575-c908-404d-a4c9-9ec9cfca9e84/1795572992613-7775080045339692044-7775080045339692044-c436a70c695412a8a38f70816c406324.jpg',
   'a010ecfe-8185-4469-87b8-0af2611c6237'::uuid,'18a4bf29-65b3-4a88-8fbc-7ae2a3a2ce33','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/86d1931b-de23-4ce2-9f9e-8c8223ea8910/1795572992615-7775080045339692044-7775080045339692044-d32f9ecc5def53e2e21d769da3e2d2a9.jpg',
   'e9d2becb-ae87-45f4-832b-b8cd81a4c3f4'::uuid,'21a1e8dd-c702-4698-afb0-a451c1672b0f','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/a1094fdd-7474-4561-8fe4-c7b5b8d651fb/1795572992617-7775080045339692044-7775080045339692044-a4c3f52c819b5716d8515924119260b6.jpg',
   '7e2f365a-e569-42cc-bb23-9f31ae61fef8'::uuid,'47371c38-4d75-4608-a5aa-c47beb9ba973','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/f0acd9ec-d4ba-4e71-bd99-b2da420094b3/1795572992620-7775080045339692044-7775080045339692044-06ee880780e00457bb1165fb9b71ffff.jpg',
   '20f3dd67-efa7-46b0-b2ab-f4e68785841a'::uuid,'62dc0b76-d172-4914-b8e9-d19258bd7edc','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/753be0c5-ed95-4870-9399-d96320489006/1795572992622-7775080045339692044-7775080045339692044-aa294a9486d83dbaa379cc5cb0335b87.jpg',
   '32f07c22-ff4d-4083-a9c5-c668a56b8d16'::uuid,'10b573bf-a980-4cdc-9527-90b9e8895c7c','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/a5b7a812-a79e-4cba-b928-275933377e7a/1795572992624-7775080045339692044-7775080045339692044-c778c479268808edebe813d6af4cc91d.jpg',
   'e9253c65-490b-432a-8f77-c5c17b2dd1f3'::uuid,'1d8deef4-da73-4ad5-a7ef-3fa79f39cd04','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/db21cc8a-2806-437a-9335-36fbf018a45e/1795572992626-7775080045339692044-7775080045339692044-95d210c6fb3ab9bcaf866c51357e41df.jpg',
   '04302ae3-39bb-43c2-bf03-ef9cf12b6d88'::uuid,'44c5c631-fa6e-4444-bb60-bb57ba67a535','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/74bc62e6-92c3-4a05-b389-8da3f38de1cb/1795572992628-7775080045339692044-7775080045339692044-59e77b11c0c9feed4f07dcfd80d35a80.jpg',
   '4922b448-83d6-4e5d-9efa-70a60ec8872f'::uuid,'da521d9f-9a60-477e-bc64-ab91d7834b81','recovery_hold'),
  ('properties/listings/198b8547-8614-4a8e-b125-7e6d9846df57/37e55a65-d019-447b-bb88-99c03a0bca07/jobs-staff-portal-header.webp',
   '5cdcb39e-b324-418b-a447-71886cac26f2'::uuid,'8e02bfef-0ea4-4b4f-ab34-510a0289f39a','file_trash_test'),
  ('properties/listings/198b8547-8614-4a8e-b125-7e6d9846df57/fd2c8e2f-4e52-4df3-aa4a-610c946830b2/manual-cleanup-fronend-1.jpg',
   '16a878a9-f1b2-4c9b-a4cd-966e4c2e82ea'::uuid,'6adbf40f-494e-490c-b553-1967119cca30','file_trash_test')
) a(name,id,version,reason) join storage.objects o on o.bucket_id='property-media'
  and o.name=a.name and o.id=a.id and o.version=a.version
on conflict(bucket,name) do update set reason=excluded.reason;

revoke all on function private.home_media_scope_id(text,text),private.home_media_document_evidence(jsonb),
  private.home_media_reference_documents(),private.home_media_edit_referenced(text,text),
  private.home_media_inactivity_inventory(text,text),private.home_media_observe_listing_inactivity(),
  private.home_media_lock_listing_inactivity(),private.home_media_reset_listing_inactivity(),private.home_media_reset_on_hold(),
  private.home_media_release_listing_observation(),
  public.home_media_gallery_checkpoints(uuid,jsonb,boolean),public.home_media_retention_preview(integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_gallery_checkpoints(uuid,jsonb,boolean),
  public.home_media_retention_preview(integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
