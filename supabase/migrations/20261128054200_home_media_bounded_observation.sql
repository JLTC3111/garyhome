begin;

alter table private.home_media_observation add column reference_digest bytea,
  add column reference_lookup jsonb;

-- Build two membership maps from the same normalized evidence as live checks.
create function private.home_media_reference_lookup(p_keys private.home_media_reference_key[]) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'exact',coalesce(jsonb_object_agg(k.bucket||'/'||k.name,true) filter(where k.bucket is not null),'{}'),
    'aliases',coalesce(jsonb_object_agg(k.name,true) filter(where k.bucket is null),'{}'))
  from unnest(p_keys) k where k.name is not null;
$$;

create function private.home_media_file_states_indexed(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_lookup jsonb
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
    select coalesce(p_lookup,private.home_media_reference_lookup(private.home_media_reference_snapshot())) as keys
    where exists(select 1 from objects)
  ), refs as materialized (
    select keys->'exact' as exact,keys->'aliases' as aliases from evidence
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
        when h.name is not null then h.reason
        when i.upload_until>now() or u.name is not null then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when refs.exact ? (o.bucket_id||'/'||o.name) then 'reference'
        when refs.aliases ? lower(o.name) or refs.aliases ? lower(regexp_replace(o.name,'^.*/',''))
          or refs.aliases ? lower(btrim(o.user_metadata->>'original_filename')) then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when legacy.name is not null then 'legacy_lifecycle'
        when b.id is null or coalesce(to_jsonb(b)->>'versioning_status','DISABLED')<>'DISABLED'
          or coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
          or coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
          or to_jsonb(o)->>'archived_at' is not null
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when o.listing_id is null then 'outside_listing_scope'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
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

-- Existing inventory and removal callers still get fresh evidence by default.
create or replace function private.home_media_file_states_batch(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_references private.home_media_reference_key[]
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  select * from private.home_media_file_states_indexed(p_bucket,p_name,p_scoped_only,p_ids,
    case when p_references is not null then private.home_media_reference_lookup(p_references) end);
$$;

-- Compare the actual saved documents under the existing snapshot locks. Only
-- changed documents require decoding links and rebuilding the membership maps.
create function private.home_media_reference_digest() returns bytea
language sql stable set search_path='' as $$
  with hashes as materialized (
    select sha256(convert_to(d::text,'UTF8')) as digest from private.home_media_reference_documents() d
  )
  select sha256(coalesce(string_agg(digest,''::bytea order by digest),''::bytea)) from hashes;
$$;

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
          and private.home_media_scope_id(o.bucket_id,o.name) is not null
        union
        select i.bucket,i.name from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      ) keys;
    end if;

    with storage_page as (
      select distinct o.bucket_id as bucket,o.name from storage.objects o
      where o.bucket_id in ('property-media','listing-videos')
        and (o.bucket_id,o.name)>(coalesce(progress.cursor_bucket,''),coalesce(progress.cursor_name,''))
        and private.home_media_scope_id(o.bucket_id,o.name) is not null
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
        current_lookup:=private.home_media_reference_lookup(private.home_media_reference_snapshot());
      end if;

      with batch as materialized (
        select * from jsonb_to_recordset(batch_keys) b(bucket text,name text)
      ), unused as materialized (
        select s.* from private.home_media_file_states_indexed(null,null,true,array(
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

create or replace function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_observe_batch(32); end if;
  return private.home_media_observation_progress();
end;
$$;

create or replace function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_observe_batch(32);
$$;

revoke all on function private.home_media_reference_lookup(private.home_media_reference_key[]),
  private.home_media_reference_digest(),private.home_media_file_states_indexed(text,text,boolean,uuid[],jsonb)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
