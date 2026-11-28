begin;

-- A full raw key is evidence even on a legacy path. A bare filename needs
-- context, and percent-encoded keys also keep their literal interpretation.
create function private.home_media_raw_key(p_value text) returns boolean
language sql immutable strict set search_path='' as $$
  select length(p_value) between 1 and 1024 and strpos(p_value,'/')>0
    and p_value !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://' and not starts_with(p_value,'//');
$$;

create function private.home_media_gallery_key(p_value text) returns text
language sql immutable strict set search_path='' as $$
  select coalesce(private.home_photo_key(p_value,null),
    case when private.home_media_raw_key(p_value) then p_value end);
$$;

-- Keep the context of each filename occurrence. Only the two known listing
-- filename fields can resolve through the same document's exact gallery key.
create function private.home_media_reference_evidence(p_doc jsonb)
returns table(bucket text,name text,gallery_key text)
language sql immutable set search_path='' as $$
  with filenames as materialized (
    select * from jsonb_each(case when jsonb_typeof(p_doc->'image_filenames')='object' then p_doc->'image_filenames' end)
  ), metadata as materialized (
    select * from jsonb_each(case when jsonb_typeof(p_doc->'image_metadata')='object' then p_doc->'image_metadata' end)
  ), gallery as materialized (
    select distinct private.home_media_gallery_key(value) as name
    from jsonb_array_elements_text(case when jsonb_typeof(p_doc->'images')='array' then p_doc->'images' end)
  ), fields as (
    select p_doc
      - case when jsonb_typeof(p_doc->'image_filenames')='object' then 'image_filenames' else '' end
      - case when jsonb_typeof(p_doc->'image_metadata')='object' then 'image_metadata' else '' end as value,
      null::text as anchor
    union all select f.value,g.name from filenames f left join gallery g
      on jsonb_typeof(f.value)='string' and g.name=private.home_media_gallery_key(f.key)
    union all select m.value->'public_filename',g.name from metadata m left join gallery g
      on jsonb_typeof(m.value->'public_filename')='string' and g.name=private.home_media_gallery_key(m.key)
    union all select case when jsonb_typeof(m.value)='object' then m.value-'public_filename' else m.value end,null from metadata m
  ), scalars as materialized (
    select distinct v #>> '{}' as value,f.anchor from fields f
    cross join lateral jsonb_path_query(f.value,'strict $.** ? (@.type() == "string")') v
    union select f.key,null from filenames f
    union select m.key,null from metadata m
  ), raw_keys as (
    select distinct s.value from scalars s where private.home_media_raw_key(s.value)
  )
  select l.bucket,l.name,null::text from private.home_listing_storage_links(p_doc::text) l where l.name is not null
  union select 'property-media',l.name,null from scalars s
    cross join lateral (select private.home_photo_key(s.value,null) name) l
    where (starts_with(s.value,'https://') or starts_with(s.value,'http://')) and l.name is not null
  union select b.bucket,k.value,null from raw_keys k cross join (values ('property-media'),('listing-videos')) b(bucket)
  union select b.bucket,l.name,null from raw_keys k cross join (values ('property-media'),('listing-videos')) b(bucket)
    cross join lateral (select private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||k.value,null) name) l
    where strpos(k.value,'%')>0 and l.name is not null
  union select null::text,lower(btrim(s.value)),s.anchor from scalars s where length(btrim(s.value)) between 1 and 1024;
$$;

-- Write guards use the same evidence and protect an alias if its gallery
-- object is gone. Exact keys include legacy paths for writes after reservation.
create or replace function private.home_media_document_evidence(p_doc jsonb)
returns table(bucket text,name text)
language sql stable set search_path='' as $$
  select distinct r.bucket,r.name from private.home_media_reference_evidence(p_doc) r
  where r.gallery_key is null or not exists(select 1 from private.home_media_identity('property-media',r.gallery_key));
$$;

-- Cache saved evidence only. The existence of a mapped Storage key is checked
-- live, including when a batch reuses the previous reference digest.
create function private.home_media_live_reference_lookup() returns jsonb
language sql stable set search_path='' as $$
  with evidence as materialized (
    select distinct r.bucket,r.name,r.gallery_key from private.home_media_reference_documents() d
    cross join lateral private.home_media_reference_evidence(d) r
  ), mapped as (
    select name,jsonb_agg(gallery_key) as keys from evidence where gallery_key is not null group by name
  )
  select jsonb_build_object(
    'exact',coalesce((select jsonb_object_agg(bucket||'/'||name,true) from evidence where bucket is not null),'{}'),
    'aliases',coalesce((select jsonb_object_agg(name,true) from evidence where bucket is null and gallery_key is null),'{}'),
    'mapped',coalesce((select jsonb_object_agg(name,keys) from mapped),'{}'));
$$;

create function private.home_media_filename_protected(p_lookup jsonb,p_name text,p_original text) returns boolean
language sql stable set search_path='' as $$
  select exists (
    select 1 from unnest(array[lower(p_name),lower(regexp_replace(p_name,'^.*/','')),lower(btrim(p_original))]) a(name)
    where p_lookup->'aliases' ? a.name or exists (
      select 1 from jsonb_array_elements_text(p_lookup->'mapped'->a.name) k(name)
      where not exists(select 1 from private.home_media_identity('property-media',k.name))
    )
  );
$$;

alter table private.home_media_runs add column recovery_held_at timestamptz;
create index home_media_runs_recovery_item on private.home_media_runs(early_item,early_expiry,recovery_held_at)
  where recovery_held_at is not null;

create function private.home_media_confirmed_recovery(p_item uuid,p_expiry timestamptz,p_held_at timestamptz) returns boolean
language sql stable strict set search_path='' as $$
  select exists(select 1 from private.home_media_runs r where r.early_item=p_item
    and r.early_expiry=p_expiry and r.recovery_held_at=p_held_at);
$$;

create function private.home_media_classify_files(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_lookup jsonb,p_recovery_held_at timestamptz
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with candidates as (
    select o.* from storage.objects o where p_ids is not null and o.id=any(p_ids)
    union all
    select o.* from storage.objects o where p_ids is null
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), objects as materialized (
    select o.*,private.home_media_scope_id(o.bucket_id,o.name) as listing_id
    from candidates o where o.bucket_id in ('property-media','listing-videos')
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
      and (not p_scoped_only or private.home_media_scope_id(o.bucket_id,o.name) is not null)
  ), evidence as materialized (
    select coalesce(p_lookup,private.home_media_live_reference_lookup()) as keys
    where exists(select 1 from objects)
  ), refs as materialized (
    select keys->'exact' as exact,keys as lookup from evidence
  ), pending_uploads as materialized (
    select * from private.home_media_pending_upload_keys() where exists(select 1 from objects)
  ), legacy_keys as materialized (
    select m.bucket,m.name from private.home_listing_deletion_media m
    union select 'property-media',r.old_key from private.property_photo_renames r
    union select 'property-media',r.new_key from private.property_photo_renames r
  ), observed as materialized (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null and (h.reason<>'recovery_hold' or h.held_at is distinct from p_recovery_held_at) then h.reason
        when i.upload_until>now() or u.name is not null then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when refs.exact ? (o.bucket_id||'/'||o.name) then 'reference'
        when private.home_media_filename_protected(refs.lookup,o.name,o.user_metadata->>'original_filename') then 'filename_match'
        when i.id is not null and not (i.source='unused_listing' and i.state in ('retained','deleting')
          or i.source='upload' and i.state in ('uploading','retained') and o.listing_id is not null) then 'legacy_lifecycle'
        when legacy.name is not null then 'legacy_lifecycle'
        when o.name ~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]])' or strpos(o.name,chr(92))>0
          or length(o.name) not between 1 and 1024
          or b.id is null or coalesce(to_jsonb(b)->>'versioning_status','DISABLED')<>'DISABLED'
          or coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
          or coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
          or to_jsonb(o)->>'archived_at' is not null
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.state='deleting' then 'removing'
            when i.expires_at<=now() then 'eligible' else 'waiting' end
        when i.source='unused_listing' and i.state='deleting' then 'identity'
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state,refs.exact ? (o.bucket_id||'/'||o.name) as saved_reference
    from objects o cross join refs left join public.properties p on p.id=o.listing_id
    left join storage.buckets b on b.id=o.bucket_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join pending_uploads u on u.bucket=o.bucket_id and u.name=o.name
    left join legacy_keys legacy on legacy.bucket=o.bucket_id and legacy.name=o.name
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end,o.saved_reference
  from observed o;
$$;

create or replace function private.home_media_file_states_indexed(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_lookup jsonb
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  select * from private.home_media_classify_files(p_bucket,p_name,p_scoped_only,p_ids,p_lookup,null);
$$;

create or replace function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz)
language sql stable set search_path='' as $$
  select r.bucket,r.name,r.listing_id,r.listing_code,r.object_id,r.object_version,r.bytes,r.reason,r.eligible_at,r.legacy_expiry
  from private.home_media_file_states(p_bucket,p_name,false) r;
$$;

-- Start a fresh pass for the expanded catalogue and cache format. Keep every
-- existing verified deadline and the date of the last completed pass.
update private.home_media_observation
set state='idle',cycle=cycle+1,cursor_bucket=null,cursor_name=null,checked=0,total=0,
  recorded=0,reset_count=0,started_at=null,error=null,reference_digest=null,reference_lookup=null where singleton;

create or replace function private.home_media_observe_batch(p_limit integer default 32) returns jsonb
language plpgsql set search_path='' as $$
declare
  progress private.home_media_observation;
  batch_limit integer:=least(greatest(coalesce(p_limit,32),1),32);
  batch_keys jsonb; batch_checked integer; batch_recorded integer; batch_reset integer;
  has_more boolean; last_bucket text; last_name text;
  current_digest bytea; current_lookup jsonb; error_code text;
begin
  begin
    select * into strict progress from private.home_media_observation where singleton for update nowait;
    if exists(select 1 from private.home_media_control where singleton and lease_until>now()) then
      return private.home_media_observation_progress('busy');
    end if;
    perform private.lock_home_listing_media_snapshot();
    perform private.home_media_lock_listing_inactivity();
  exception when lock_not_available then
    return private.home_media_observation_progress('busy');
  end;

  if progress.state in ('idle','complete') then
    progress.cursor_bucket:=null;
    progress.cursor_name:=null;
    progress.checked:=0;
    progress.total:=0;
    progress.recorded:=0;
    progress.reset_count:=0;
    progress.started_at:=clock_timestamp();
  end if;

  begin
    -- Estimate the total once per pass. Resume by key, including retained rows
    -- for missing Storage objects so their old timers can still be cleared.
    if progress.checked=0 and progress.total=0 then
      select count(*) into progress.total from (
        select o.bucket_id,o.name from storage.objects o where o.bucket_id in ('property-media','listing-videos')
        union
        select i.bucket,i.name from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      ) keys;
    end if;

    with storage_page as (
      select distinct o.bucket_id as bucket,o.name from storage.objects o
      where o.bucket_id in ('property-media','listing-videos')
        and (o.bucket_id,o.name)>(coalesce(progress.cursor_bucket,''),coalesce(progress.cursor_name,''))
      order by o.bucket_id,o.name limit batch_limit+1
    ), ledger_page as (
      select i.bucket,i.name from private.home_media_items i
      where i.source='unused_listing' and i.state='retained'
        and (i.bucket,i.name)>(coalesce(progress.cursor_bucket,''),coalesce(progress.cursor_name,''))
      order by i.bucket,i.name limit batch_limit+1
    ), page as materialized (
      select k.bucket,k.name from (select * from storage_page union select * from ledger_page) k
      order by k.bucket,k.name limit batch_limit+1
    ), batch as materialized (
      select p.bucket,p.name from page p order by p.bucket,p.name limit batch_limit
    )
    select coalesce((select jsonb_agg(to_jsonb(b)) from batch b),'[]'),(select count(*) from batch),
      (select count(*)>batch_limit from page),last.bucket,last.name
    into batch_keys,batch_checked,has_more,last_bucket,last_name
    from (values (true)) seed(one)
    left join lateral (select b.bucket,b.name from batch b order by b.bucket desc,b.name desc limit 1) last on true;

    current_digest:=progress.reference_digest;
    current_lookup:=progress.reference_lookup;
    batch_recorded:=0;
    batch_reset:=0;
    if batch_checked>0 then
      current_digest:=private.home_media_reference_digest();
      if current_lookup is null or current_digest is distinct from progress.reference_digest then
        current_lookup:=private.home_media_live_reference_lookup();
      end if;

      with batch as materialized (
        select * from jsonb_to_recordset(batch_keys) b(bucket text,name text)
      ), unused as materialized (
        select s.* from private.home_media_file_states_indexed(null,null,false,array(
          select o.id from batch b join storage.objects o on o.bucket_id=b.bucket and o.name=b.name
        ),current_lookup) s where s.reason in ('awaiting_observation','waiting','eligible')
      ), reset as (
        delete from private.home_media_items i using batch b
        where i.bucket=b.bucket and i.name=b.name and i.source='unused_listing' and i.state='retained'
          and not exists(select 1 from unused s where s.bucket=i.bucket and s.name=i.name)
        returning 1
      ), recorded as (
        insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
        select s.bucket,s.name,'unused_listing',s.listing_id,s.object_id,s.object_version,s.bytes,'retained',now(),now()+interval '96 hours'
        from unused s where s.reason='awaiting_observation'
        on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
          object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
          upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
        where home_media_items.source='unused_listing' and home_media_items.state='retained'
          or home_media_items.source='upload' and home_media_items.state in ('uploading','retained')
        returning 1
      )
      select (select count(*) from recorded),(select count(*) from reset) into batch_recorded,batch_reset;
    end if;

    update private.home_media_observation set state=case when has_more then 'running' else 'complete' end,
      cursor_bucket=coalesce(last_bucket,progress.cursor_bucket),cursor_name=coalesce(last_name,progress.cursor_name),
      checked=progress.checked+batch_checked,
      total=case when has_more then greatest(progress.total,progress.checked+batch_checked+1) else progress.checked+batch_checked end,
      recorded=progress.recorded+batch_recorded,reset_count=progress.reset_count+batch_reset,started_at=progress.started_at,
      last_successful_at=case when has_more then progress.last_successful_at else clock_timestamp() end,error=null,
      reference_digest=current_digest,reference_lookup=current_lookup where singleton;
  exception
    when query_canceled then error_code:='observation_timeout';
    when lock_not_available then return private.home_media_observation_progress('busy');
    when others then
      raise log 'Gary Home unused media observation failed with SQLSTATE %',sqlstate;
      error_code:='observation_failed';
  end;

  if error_code is not null then
    update private.home_media_observation set state='failed',error=error_code,
      cursor_bucket=progress.cursor_bucket,cursor_name=progress.cursor_name,checked=progress.checked,total=progress.total,
      recorded=progress.recorded,reset_count=progress.reset_count,started_at=progress.started_at where singleton;
  end if;
  return private.home_media_observation_progress();
end;
$$;

create function private.home_media_recovery_ticket(o storage.objects,h private.home_media_review_holds) returns jsonb
language sql stable strict set search_path='' as $$
  select jsonb_build_object('bucket',o.bucket_id,'name',o.name,'objectId',o.id,'version',o.version,'heldAt',h.held_at,
    'bytes',case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end);
$$;

create function private.home_media_file_status(p_reason text,p_saved_reference boolean) returns text
language sql immutable set search_path='' as $$
  select case
    when p_reason='recovery_hold' and not p_saved_reference then 'recovery'
    when p_reason='awaiting_observation' then 'awaiting'
    when p_reason in ('waiting','eligible') then 'verified'
    when p_reason='removing' then 'removing'
    else 'protected' end;
$$;

create function private.home_media_file_catalogue()
returns table(bucket text,name text,object_id uuid,object_version text,bytes bigint,listing_id uuid,listing_code text,
  listing_title_en text,listing_title_vi text,reason text,status text,saved_reference boolean,
  eligible_at timestamptz,legacy_expiry timestamptz,manual_target jsonb,recovery_target jsonb)
language sql stable set search_path='' as $$
  with states as materialized (
    select * from private.home_media_file_states_indexed(null,null,false,null,null)
  ), listing_links as materialized (
    select distinct on (l.bucket,l.name) l.bucket,l.name,p.id
    from public.properties p
    cross join lateral private.home_media_reference_evidence(private.home_media_listing_fields(p)) l
    join states s on s.bucket=l.bucket and s.name=l.name and s.listing_id is null and s.saved_reference
    order by l.bucket,l.name,p.listing_code,p.id
  )
  select s.bucket,s.name,s.object_id,s.object_version,s.bytes,p.id,p.listing_code,p.title_en,p.title_vi,s.reason,
    private.home_media_file_status(s.reason,s.saved_reference),s.saved_reference,s.eligible_at,s.legacy_expiry,
    case when s.reason in ('waiting','eligible') then private.home_media_unused_ticket(i) end,
    case when h.name is not null then private.home_media_recovery_ticket(o,h) end
  from states s
  left join listing_links l on l.bucket=s.bucket and l.name=s.name
  left join public.properties p on p.id=coalesce(s.listing_id,l.id)
  left join private.home_media_items i on i.bucket=s.bucket and i.name=s.name and s.reason in ('waiting','eligible')
  left join private.home_media_review_holds h on h.bucket=s.bucket and h.name=s.name and h.reason='recovery_hold'
  left join storage.objects o on h.name is not null and o.id=s.object_id;
$$;

-- Classify before filtering and pagination, so the preview, counters and
-- bulk manifests all describe the same live files.
create function private.home_media_file_page(p_offset integer,p_query text,p_preview boolean,p_filter text) returns jsonb
language sql stable set search_path='' as $$
  with catalogue as materialized (select * from private.home_media_file_catalogue()),
  matches as materialized (
    select * from catalogue r where (not p_preview or r.status<>'protected')
      and strpos(lower(concat_ws(' ',r.name,r.listing_code,r.listing_title_en,r.listing_title_vi)),
        lower(left(btrim(coalesce(p_query,'')),120)))>0
  ), lookahead as materialized (
    select r.*,r.manual_target is not null as priority,
      r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible
    from matches r cross join private.home_media_control c
    where c.singleton and (p_filter='all' or p_filter=r.status)
    order by priority desc,r.bucket,r.name
    limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(p)-'priority' order by p.priority desc,p.bucket,p.name) from lookahead p),'[]')-30,
    'hasMore',(select count(*)>30 from lookahead),'available',true,
    'counts',jsonb_build_object('all',(select count(*) from matches))||coalesce((
      select jsonb_object_agg(status,files) from (select status,count(*) files from matches group by status) totals
    ),'{}'),
    'retentionCounts',coalesce((
      select jsonb_object_agg(status,files) from (select status,count(*) files from catalogue where status<>'protected' group by status) totals
    ),'{}'),
    'manualCount',(select count(*) from matches where manual_target is not null),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton));
$$;

create or replace function private.home_media_owner_files(p_offset integer,p_query text,p_scoped_only boolean) returns jsonb
language sql stable set search_path='' as $$
  select private.home_media_file_page(p_offset,p_query,p_scoped_only,'all');
$$;

create function public.home_media_filtered_files(p_offset integer,p_query text,p_preview boolean,p_filter text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_preview is null or p_filter is null or p_filter not in ('verified','protected','awaiting','recovery','removing') then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  return private.home_media_file_page(p_offset,p_query,p_preview,p_filter);
end;
$$;

create or replace function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return (select jsonb_build_object(
    'items',coalesce(jsonb_agg(manual_target order by name,object_id) filter(where manual_target is not null),'[]'),
    'recoveryItems',coalesce(jsonb_agg(recovery_target order by name,object_id) filter(where status='recovery'),'[]'))
    from private.home_media_file_catalogue() r
    where (r.manual_target is not null or r.status='recovery')
      and strpos(lower(concat_ws(' ',r.name,r.listing_code,r.listing_title_en,r.listing_title_vi)),
        lower(left(btrim(coalesce(p_query,'')),120)))>0);
end;
$$;

-- Validate the hold and current object together under the existing media locks.
create function private.home_media_check_recovery(p_target jsonb,p_confirm boolean) returns storage.objects
language plpgsql set search_path='' as $$
declare target storage.objects;
begin
  if p_confirm is distinct from true or jsonb_typeof(p_target) is distinct from 'object'
    or not (p_target ?& array['bucket','name','objectId','version','heldAt'])
    or coalesce(p_target->>'bucket','') not in ('property-media','listing-videos')
    or coalesce(length(p_target->>'name'),0) not between 1 and 1024
    or coalesce(p_target->>'objectId','') !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    or coalesce(length(p_target->>'heldAt'),0) not between 20 and 48
    or jsonb_typeof(p_target->'version') not in ('string','null')
    or length(p_target->>'version')>100 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot();
  select o.* into target from private.home_media_identity(p_target->>'bucket',p_target->>'name') o
  join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
  where o.id=(p_target->>'objectId')::uuid and o.version is not distinct from p_target->>'version'
    and h.reason='recovery_hold' and h.held_at=(p_target->>'heldAt')::timestamptz;
  if not found then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  return target;
end;
$$;

create function public.home_media_release_recovery(p_target jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target storage.objects; hold_time timestamptz;
begin
  perform private.require_home_photo_owner();
  target:=private.home_media_check_recovery(p_target,p_confirm);
  hold_time:=(p_target->>'heldAt')::timestamptz;
  if exists(select 1 from private.home_media_items i where i.bucket=target.bucket_id and i.name=target.name
    and (i.state in ('deleting','removed') or i.deletion_started_at is not null))
    or exists(select 1 from private.home_media_control c join private.home_media_runs r on r.id=c.lease
      join private.home_media_items i on i.id=r.early_item
      where c.singleton and c.lease_until>now() and r.recovery_held_at=hold_time
        and i.bucket=target.bucket_id and i.name=target.name) then
    raise exception 'listing_cleanup.media_busy' using errcode='55P03'; end if;
  delete from private.home_media_review_holds h where h.bucket=target.bucket_id and h.name=target.name
    and h.reason='recovery_hold' and h.held_at=hold_time;
  if not found then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  delete from private.home_media_items i where i.bucket=target.bucket_id and i.name=target.name
    and i.source='unused_listing' and i.state='retained';
  return jsonb_build_object('status','released');
end;
$$;

-- Both confirmed early-removal actions reserve the existing worker lease.
create function private.home_media_start_unused(p_actor uuid,p_item uuid,p_expiry timestamptz,p_held_at timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare job uuid:=gen_random_uuid();
begin
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=(select lease from private.home_media_control where singleton) and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry,early_unused,recovery_held_at)
    values(job,p_actor,p_item,p_expiry,true,p_held_at);
  return jsonb_build_object('status','ok','id',job,'items',jsonb_build_array(jsonb_build_object('id',p_item)));
end;
$$;

create or replace function public.home_media_claim_unused(p_actor uuid,p_item uuid,p_expiry timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control;
begin
  if p_actor is null then raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform private.require_home_photo_owner();
  select * into ctrl from private.home_media_control where singleton for update;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  if not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.source='unused_listing' and i.state='retained' and i.attempts<4) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  return private.home_media_start_unused(p_actor,p_item,p_expiry,null);
end;
$$;

-- Keep the selected hold through Storage settlement. Only this exact Owner
-- run may reserve a held object, and a fresh check is repeated at target time.
create function public.home_media_claim_recovery(p_actor uuid,p_target jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; target storage.objects; item private.home_media_items;
  candidate record; hold_time timestamptz;
begin
  if p_actor is null then raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform private.require_home_photo_owner();
  select * into strict ctrl from private.home_media_control where singleton for update nowait;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  target:=private.home_media_check_recovery(p_target,p_confirm);
  hold_time:=(p_target->>'heldAt')::timestamptz;
  perform private.home_media_lock_listing_inactivity();
  select * into candidate from private.home_media_classify_files(target.bucket_id,target.name,false,array[target.id],null,hold_time);
  if not found or candidate.reason not in ('awaiting_observation','waiting','eligible','removing') then
    raise exception 'listing_cleanup.recovery_protected' using errcode='PT409'; end if;
  if candidate.reason='awaiting_observation' then
    insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
    values(target.bucket_id,target.name,'unused_listing',candidate.listing_id,target.id,target.version,candidate.bytes,
      'retained',now(),now()+interval '96 hours')
    on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
      object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
      upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
    where (home_media_items.source='unused_listing' and home_media_items.state='retained'
      or home_media_items.source='upload' and home_media_items.state in ('uploading','retained'))
      and home_media_items.deletion_started_at is null;
  end if;
  select * into item from private.home_media_items i where i.bucket=target.bucket_id and i.name=target.name
    and i.source='unused_listing' and i.object_id=target.id and i.object_version is not distinct from target.version;
  if not found or item.attempts>=4 or item.expires_at is null or item.retry_after>now()
    or (item.state<>'retained' and (item.state<>'deleting' or not exists(
      select 1 from private.home_media_runs r where r.id=item.deletion_run and r.recovery_held_at=hold_time))) then
    raise exception 'listing_cleanup.recovery_protected' using errcode='PT409'; end if;
  return private.home_media_start_unused(p_actor,item.id,item.expires_at,hold_time);
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
    if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
    perform private.home_media_lock_listing_inactivity();
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
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name
          and not (h.reason='recovery_hold' and m.state in ('deleting','review') and m.deletion_started_at is not null
            and private.home_media_confirmed_recovery(m.id,m.expires_at,h.held_at)
            and not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)))
        and not private.home_media_edit_referenced(m.bucket,m.name) and (
        ((state='trashed' or (source='unused_listing' and state='retained' and ctrl.listing_inactivity_enabled))
          and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4 and (source<>'unused_listing' or (ctrl.listing_inactivity_enabled and expires_at<=now()))) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

create or replace function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean; protection text; hold_time timestamptz;
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
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry
      or job.early_unused is distinct from (item.source='unused_listing')))
    then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  hold_time:=job.recovery_held_at;
  -- Reconcile only a previously authorized removal when the object is already
  -- absent. Scheduled runs never get permission to remove a held Storage key.
  if hold_time is null and not present and item.deletion_started_at is not null then
    select h.held_at into hold_time from private.home_media_review_holds h
    where h.bucket=item.bucket and h.name=item.name and h.reason='recovery_hold'
      and private.home_media_confirmed_recovery(item.id,item.expires_at,h.held_at);
  end if;
  if (hold_time is not null and not exists(select 1 from private.home_media_review_holds h
      where h.bucket=item.bucket and h.name=item.name and h.reason='recovery_hold' and h.held_at=hold_time))
    or exists(select 1 from private.home_media_review_holds h where h.bucket=item.bucket and h.name=item.name
      and (h.reason<>'recovery_hold' or h.held_at is distinct from hold_time))
    or private.home_media_edit_referenced(item.bucket,item.name)
    or private.home_media_provider_upload(item.bucket,item.name) then return null; end if;
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if item.source='unused_listing' then
    if item.attempts>=4 or (job.early_unused and item.state<>'retained'
      and (job.recovery_held_at is null or item.state<>'deleting'))
      or (not job.early_unused and (item.state not in ('retained','deleting') or item.expires_at>now()
        or not (select listing_inactivity_enabled from private.home_media_control where singleton)))
      then return null; end if;
    perform private.home_media_lock_listing_inactivity();
    select r.reason into protection from private.home_media_classify_files(item.bucket,item.name,false,null,null,job.recovery_held_at) r;
    if protection is null or not (protection='eligible' or (job.early_unused and protection='waiting')
      or (protection='removing' and (not job.early_unused or job.recovery_held_at is not null))) then
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

create or replace function public.home_media_settle(p_run uuid,p_id uuid,p_ok boolean) returns boolean
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
  delete from private.home_media_review_holds h
    where h.bucket=item.bucket and h.name=item.name and h.reason='recovery_hold'
      and private.home_media_confirmed_recovery(item.id,item.expires_at,h.held_at);
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

create or replace function private.home_media_panel_page(p_action text,p_offset integer) returns jsonb
language plpgsql stable set search_path='' as $$
declare rows jsonb; sample jsonb; skip integer:=least(greatest(coalesce(p_offset,0),0),1000000);
begin
  if p_action='inventory_page' then
    select inventory_sample into sample from private.home_media_control where singleton;
    select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb) into rows from (
      select * from jsonb_array_elements(sample->'entries') with ordinality limit 31 offset skip
    ) e;
  elsif p_action='trash_page' then
    select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('restore_mode',private.home_media_restore_mode(i)) order by p.expires_at,p.id),'[]'::jsonb)
      into rows from (
        select id,bucket,name,state,expires_at,hold_reason from private.home_media_items
        where source<>'unused_listing' and state in ('trashed','deleting') order by expires_at,id limit 31 offset skip
      ) p join private.home_media_items i on i.id=p.id;
  elsif p_action='removed_page' then
    with receipts as (
      select i.id,i.bucket,i.name,i.removed_at,i.source from private.home_media_items i where i.state='removed'
      union all
      select m.object_id,m.bucket,m.name,m.removed_at,'listing' from private.home_listing_deletion_media m
      where m.state='removed' and not exists(select 1 from private.home_media_items i where i.bucket=m.bucket and i.name=m.name and i.state='removed')
      union all
      select r.id,'property-media',r.old_key,r.removed_at,'rename' from private.property_photo_renames r
      where r.removed_at is not null and not exists(select 1 from private.home_media_items i
          where i.bucket='property-media' and i.name=r.old_key and i.state='removed')
        and not exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=r.old_key and m.state='removed')
    )
    select coalesce(jsonb_agg(to_jsonb(p) order by p.removed_at desc nulls last,p.id),'[]'::jsonb) into rows from (
      select * from receipts order by removed_at desc nulls last,id limit 31 offset skip
    ) p;
  elsif p_action='run_page' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.started_at desc,p.id),'[]'::jsonb) into rows from (
      select id,started_at,finished_at,attempted,removed,failed from private.home_media_runs
      order by started_at desc,id limit 31 offset skip
    ) p;
  end if;
  return jsonb_build_object('items',rows-30,'hasMore',jsonb_array_length(rows)>30,
    'available',p_action<>'inventory_page' or sample is not null);
end;
$$;

create or replace function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; sample jsonb; result jsonb; scheduled boolean:=false;
  ready bigint; ready_bytes bigint; queued bigint; queued_bytes bigint; due bigint; changed integer:=0; verified uuid;
begin
  perform private.require_home_photo_owner();
  if p_action in ('authorize','restore') then return private.home_media_management(p_action,p_id,p_offset); end if;
  if p_action in ('inventory_page','trash_page','removed_page','run_page') then
    return private.home_media_panel_page(p_action,p_offset);
  end if;
  if p_action is null or p_action not in ('overview','inventory_scan','status','scan','trash') then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  select * into ctrl from private.home_media_control where singleton;
  if p_action in ('inventory_scan','scan') then
    if not pg_try_advisory_xact_lock(hashtextextended('home.media.inventory',0)) then
      raise exception 'listing_cleanup.scan_busy' using errcode='55P03';
    end if;
    sample:=private.home_media_take_inventory(true,(ctrl.inventory_sample->>'reviewedId')::uuid);
    update private.home_media_control set inventory_sample=sample,last_scan_at=clock_timestamp()
      where singleton returning * into ctrl;
  else
    sample:=coalesce(ctrl.inventory_sample,private.home_media_take_inventory(false));
  end if;
  if p_action='trash' then
    if ctrl.inventory_sample is null then raise exception 'listing_cleanup.scan_required' using errcode='PT409'; end if;
    -- Reuse the existing guarded reservation. The scan never authorizes a Storage removal.
    verified:=(sample->'verifiedObjects'->0->>'id')::uuid;
    if verified is not null then
      perform private.lock_home_listing_media_snapshot();
      if exists(select 1 from private.home_media_items i join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
        where i.id=verified and o.id=(sample->'verifiedObjects'->0->>'object_id')::uuid
          and o.version is not distinct from (sample->'verifiedObjects'->0->>'version')) then
        changed:=private.home_media_stage_candidates(verified);
      end if;
    end if;
  end if;

  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end),0) into ready,ready_bytes
    from jsonb_to_recordset(sample->'verifiedObjects') v(id uuid,object_id uuid,version text) join private.home_media_items i on i.id=v.id
    join storage.objects o on o.bucket_id=i.bucket and o.name=i.name and o.id=v.object_id and o.version is not distinct from v.version
    where (i.state='candidate' and o.id=i.object_id and o.version is not distinct from i.object_version
      or i.state='uploading' and o.owner_id::text=i.upload_owner::text and i.upload_until<=now());
  select count(*),coalesce(sum(bytes),0) into queued,queued_bytes
    from private.home_media_items where source<>'unused_listing' and state in ('trashed','deleting');
  select count(*) into due from private.home_media_items i
    where coalesce(i.retry_after,'-infinity')<=now()
      and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name
        and not (h.reason='recovery_hold' and i.state in ('deleting','review') and i.deletion_started_at is not null
          and private.home_media_confirmed_recovery(i.id,i.expires_at,h.held_at)
          and not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name)))
      and not private.home_media_edit_referenced(i.bucket,i.name) and (
      ((i.state='trashed' or (i.source='unused_listing' and i.state='retained' and ctrl.listing_inactivity_enabled))
        and i.expires_at<=now() and i.attempts<4) or
      (i.state in ('deleting','review') and i.deletion_started_at is not null and (
        (i.state='deleting' and i.attempts<4 and (i.source<>'unused_listing' or (ctrl.listing_inactivity_enabled and i.expires_at<=now())))
        or not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name)
      )));
  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active)' into scheduled using 'gary-home-media-expiry';
  end if;
  result:=(sample-'entries'-'verifiedObjects'-'reviewedId')||jsonb_build_object('panelVersion',2,
    'lastScanAt',ctrl.last_scan_at,'enabled',ctrl.permanent_enabled,'automaticScheduled',scheduled,'newlyTrashed',changed,
    'readyToTrash',ready,'readyBytes',ready_bytes,'trashed',queued,'scheduledBytes',queued_bytes,'overdue',due,
    'activeUploads',(select count(*) from private.home_media_items where state='uploading' and upload_until>now()),
    'abandoned',(select count(*) from private.home_media_items where source='upload' and state in ('trashed','deleting')));
  -- Legacy callers expect inline arrays. The new overview and scan return no pages.
  if p_action in ('status','scan','trash') then
    result:=result||jsonb_build_object('totalItems',queued,'items',private.home_media_panel_page('trash_page',p_offset)->'items',
      'runs',private.home_media_panel_page('run_page',0)->'items','verifiedCandidates',queued,'verifiedCandidateBytes',queued_bytes,
      'heldCandidates',sample->'protectedCandidates');
  end if;
  return result;
end;
$$;

create or replace function public.home_media_dashboard(p_action text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report jsonb; rows jsonb; live_count bigint; live_bytes bigint; early_count bigint; retention_counts jsonb;
begin
  perform private.require_home_photo_owner();
  if p_action='readiness' then return jsonb_build_object('crossAppProtection',true); end if;
  if p_action='trash_manifest' then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'bucket',i.bucket,'name',i.name,
      'expires_at',i.expires_at,'bytes',i.bytes) order by i.expires_at,i.id),'[]'::jsonb) into rows
      from private.home_media_items i where i.state='trashed' and private.home_media_early_block(i) is null;
    return jsonb_build_object('items',rows);
  end if;
  if p_action='trash_page' then
    report:=public.home_media_management(p_action,null,p_offset);
    select coalesce(jsonb_agg(e.value||jsonb_build_object('purge_block',private.home_media_early_block(i),
      'retry_after',i.retry_after,'bytes',i.bytes) order by e.ordinality),'[]'::jsonb) into rows
      from jsonb_array_elements(report->'items') with ordinality e
      join private.home_media_items i on i.id=(e.value->>'id')::uuid;
    return report||jsonb_build_object('items',rows);
  end if;
  if p_action is distinct from 'overview' then raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  report:=public.home_media_management('overview',null,0);
  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end),0)
    into live_count,live_bytes from storage.objects o where o.bucket_id in ('property-media','listing-videos');
  select count(*) into early_count from private.home_media_items i where i.state='trashed' and private.home_media_early_block(i) is null;
  select coalesce(jsonb_object_agg(status,files),'{}') into retention_counts from (
    select status,count(*) files from (
      select private.home_media_file_status(reason,saved_reference) as status
      from private.home_media_file_states_indexed(null,null,false,null,null)
    ) classified where status<>'protected' group by status
  ) totals;
  return report||jsonb_build_object('crossAppProtection',true,'retentionCounts',retention_counts,'objects',live_count,'bytes',live_bytes,
    'inventoryCheckedAt',statement_timestamp(),'earlyEligible',early_count,
    'nextExpiry',(select min(i.expires_at) from private.home_media_items i
      where i.state='trashed' and i.expires_at>now() and i.attempts<4));
end;
$$;

revoke all on function private.home_media_raw_key(text),private.home_media_gallery_key(text),
  private.home_media_reference_evidence(jsonb),private.home_media_live_reference_lookup(),
  private.home_media_filename_protected(jsonb,text,text),
  private.home_media_confirmed_recovery(uuid,timestamptz,timestamptz),
  private.home_media_classify_files(text,text,boolean,uuid[],jsonb,timestamptz),
  private.home_media_recovery_ticket(storage.objects,private.home_media_review_holds),
  private.home_media_file_status(text,boolean),private.home_media_file_catalogue(),
  private.home_media_file_page(integer,text,boolean,text),private.home_media_check_recovery(jsonb,boolean),
  private.home_media_start_unused(uuid,uuid,timestamptz,timestamptz),
  public.home_media_filtered_files(integer,text,boolean,text),public.home_media_release_recovery(jsonb,boolean),
  public.home_media_claim_recovery(uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.home_media_filtered_files(integer,text,boolean,text),
  public.home_media_release_recovery(jsonb,boolean) to authenticated;
grant execute on function public.home_media_claim_recovery(uuid,jsonb,boolean) to service_role;

notify pgrst,'reload schema';
commit;
