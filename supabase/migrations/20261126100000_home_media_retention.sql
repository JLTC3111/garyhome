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
  source text not null check(source in ('listing','rename','upload')),
  source_id uuid,
  upload_owner uuid,
  upload_until timestamptz,
  object_id uuid,
  object_version text,
  bytes bigint,
  state text not null check(state in ('uploading','trashed','deleting','removed','restored','review')),
  unreferenced_since timestamptz,
  expires_at timestamptz,
  retry_after timestamptz,
  attempts integer not null default 0,
  removed_at timestamptz,
  replacement_key text,
  replacement_sha256 text,
  replacement_id uuid,
  replacement_version text,
  unique(bucket,name)
);
create index home_media_due on private.home_media_items(expires_at,retry_after,id)
  where state in ('trashed','deleting');
create index home_media_upload_due on private.home_media_items(upload_until,id) where state='uploading';
create index home_media_reserved_name on private.home_media_items(name)
  where state in ('trashed','deleting','removed');

create table private.home_media_runs (
  id uuid primary key,
  actor uuid,
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
revoke all on private.home_media_control,private.home_media_items,private.home_media_runs
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
      and i.state in ('trashed','deleting','removed'))
    or (l.bucket='property-media' and exists(select 1 from private.property_photo_renames r
      where r.old_key=l.name and r.removal_requested_by is not null))
  ) and not exists(select 1 from private.home_media_links(prior) p where p.bucket=l.bucket and p.name=l.name))
    or exists(select 1 from jsonb_path_query(to_jsonb(new),'strict $.** ? (@.type() == "string")') v
      join private.home_media_items i on i.name=(v #>> '{}') and i.state in ('trashed','deleting','removed')
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
      and i.state in ('trashed','deleting','removed'));
$$;

create function private.home_media_referenced(p_bucket text,p_name text) returns boolean
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
      upload_owner=null,upload_until=null
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
    replacement_id=excluded.replacement_id,replacement_version=excluded.replacement_version,upload_owner=null,upload_until=null
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
create function private.home_media_stage_uploads() returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and (retry_after is null or retry_after<=now()) order by upload_until,id limit 40
  loop
    select * into target from private.home_media_identity(candidate.bucket,candidate.name);
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
      update private.home_media_items set retry_after=now()+interval '1 hour' where id=candidate.id and state='uploading';
    end if;
  end loop;
  return staged;
end;
$$;

create function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; ctrl private.home_media_control; changed integer:=0;
begin
  perform private.require_home_photo_owner();
  if p_action='authorize' then
    return jsonb_build_object('actor',auth.uid());
  elsif p_action='restore' then
    perform private.lock_home_listing_media_snapshot();
    select * into item from private.home_media_items where id=p_id for update;
    if not found or item.state<>'trashed' or item.expires_at<=now() or not exists(
      select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version)
    then raise exception 'listing_cleanup.restore_unavailable' using errcode='PT409'; end if;
    update private.home_media_items set state='restored',retry_after=null where id=p_id;
    if item.source='listing' then
      update private.home_listing_deletion_media set state='retained'
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
    elsif item.source='rename' then
      update private.property_photo_renames set removal_requested_by=null,auto_cleanup_requested=false where id=item.source_id;
    end if;
    return jsonb_build_object('id',p_id,'restored',true);
  elsif p_action in ('scan','trash') then
    if p_action='trash' then
      perform private.lock_home_listing_media_snapshot();
      changed:=private.home_media_stage_uploads();
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
      select id,bucket,name,state,expires_at,removed_at,unreferenced_since from private.home_media_items where state<>'uploading'
      union all
      select m.object_id,m.bucket,m.name,'removed',null,m.removed_at,null from private.home_listing_deletion_media m
      where m.state='removed' and not exists(select 1 from private.home_media_items i where i.bucket=m.bucket and i.name=m.name)
      union all
      select r.id,'property-media',r.old_key,'removed',null,r.removed_at,null from private.property_photo_renames r
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
      'overdue',(select count(*) from private.home_media_items where state in ('trashed','deleting','review') and expires_at<=now()),
      'lastScanAt',ctrl.last_scan_at,'checkedAt',statement_timestamp(),'enabled',ctrl.permanent_enabled,'newlyTrashed',changed,
      'totalItems',(select count(*) from history),
      'items',coalesce((select jsonb_agg(to_jsonb(i)) from (
        select id,bucket,name,state,expires_at,removed_at from history
        order by (state='trashed' and expires_at>now()) desc nulls last,
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

create function public.home_media_claim(p_actor uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid(); row_count integer:=0;
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  perform private.home_media_stage_uploads();
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor) values(job,p_actor);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items where state in ('trashed','deleting') and expires_at<=now()
        and (retry_after is null or retry_after<=now()) and attempts<4 order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

-- Recheck immediately before the Storage API call. The durable reservation
-- blocks new links and authenticated uploads after this transaction commits.
create function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; previous_attempt boolean; present boolean;
begin
  if not exists(select 1 from private.home_media_control c where c.lease=p_run and c.lease_until>now() and c.permanent_enabled) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  perform private.lock_home_listing_media_snapshot();
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.state not in ('trashed','deleting') or item.expires_at>now()
    or item.retry_after>now() or item.attempts>=4 then return null; end if;
  previous_attempt:=item.state='deleting';
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if private.home_media_referenced(item.bucket,item.name)
    or (not present and not previous_attempt)
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version))
    or (item.source='rename' and (not exists(select 1 from private.home_media_identity('property-media',item.replacement_key) o
      where o.id=item.replacement_id and o.version is not distinct from item.replacement_version)
      or not exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=item.replacement_key)))
  then
    update private.home_media_items set state='review' where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return null;
  end if;
  if item.source='rename' and p_replacement_verified is not true then
    update private.home_media_items set attempts=attempts+1,retry_after=now()+interval '1 hour',
      state=case when attempts>=3 then 'review' else state end where id=p_id;
    update private.home_media_runs set attempted=attempted+1,failed=failed+1 where id=p_run;
    return null;
  end if;
  update private.home_media_items set state='deleting',attempts=attempts+1,retry_after=now()+interval '1 hour' where id=p_id;
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
  if not found or item.state<>'deleting' then return false; end if;
  if p_ok is not true or exists(select 1 from storage.objects where bucket_id=item.bucket and name=item.name) then
    if item.attempts>=4 then update private.home_media_items set state='review' where id=p_id; end if;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return false;
  end if;
  update private.home_media_items set state='removed',removed_at=clock_timestamp(),upload_owner=null,
    upload_until=null,object_version=null,replacement_key=null,replacement_sha256=null,replacement_id=null,replacement_version=null,
    retry_after=null where id=p_id;
  if item.source='listing' then
    update private.home_listing_deletion_media set state='removed',removed_at=clock_timestamp()
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
  elsif item.source='rename' then
    update private.property_photo_renames set removed_at=clock_timestamp() where id=item.source_id;
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
    where state in ('trashed','deleting','review') and expires_at<=now());
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

revoke all on function private.home_media_links(jsonb),private.home_media_referenced(text,text),
  private.home_media_identity(text,text),private.home_media_record_listing(),private.home_media_stage_uploads()
  from public,anon,authenticated,service_role;
revoke all on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid),public.home_media_claim(uuid),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) from public,anon,authenticated,service_role;
grant execute on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid) to authenticated;
grant execute on function public.home_media_claim(uuid),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) to service_role;

notify pgrst,'reload schema';
commit;
