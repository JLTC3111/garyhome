-- The same bounded observation is available to the Owner and the hourly worker.
-- Only the unused-listing ledger and its progress record are written here.
begin;

create table private.home_media_observation (
  singleton boolean primary key default true check (singleton),
  state text not null default 'idle' check (state in ('idle','running','complete','failed')),
  cursor_bucket text, cursor_name text,
  checked integer not null default 0, total integer not null default 0,
  recorded integer not null default 0, reset_count integer not null default 0,
  started_at timestamptz, last_successful_at timestamptz, error text
);
alter table private.home_media_observation enable row level security;
revoke all on private.home_media_observation from public,anon,authenticated,service_role;
insert into private.home_media_observation(singleton) values(true);

create function private.home_media_observation_progress(p_status text default null) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('status',coalesce(p_status,state),'checked',checked,'total',total,
    'recorded',recorded,'reset',reset_count,'startedAt',started_at,'lastSuccessfulAt',last_successful_at,'error',error)
  from private.home_media_observation where singleton;
$$;

create function private.home_media_observe_batch(p_limit integer default 1000) returns jsonb
language plpgsql set search_path='' as $$
declare
  progress private.home_media_observation;
  batch_limit integer:=least(greatest(coalesce(p_limit,1000),1),1000);
  remaining integer; batch_checked integer; batch_recorded integer; batch_reset integer;
  error_code text;
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
    -- Include old ledger keys to clear timers for missing or replaced objects.
    with remaining_keys as materialized (
      select o.bucket_id bucket,o.name from storage.objects o
      where o.bucket_id in ('property-media','listing-videos')
        and (progress.cursor_bucket is null or (o.bucket_id,o.name)>(progress.cursor_bucket,progress.cursor_name))
        and private.home_media_scope_id(o.bucket_id,o.name) is not null
      union
      select i.bucket,i.name from private.home_media_items i
      where i.source='unused_listing' and i.state='retained'
        and (progress.cursor_bucket is null or (i.bucket,i.name)>(progress.cursor_bucket,progress.cursor_name))
    ), batch as materialized (
      select k.bucket,k.name from remaining_keys k order by k.bucket,k.name limit batch_limit
    ), unused as materialized (
      select s.* from private.home_media_file_states_batch(null,null,true,coalesce((
        select array_agg(o.id) from batch b join storage.objects o on o.bucket_id=b.bucket and o.name=b.name
      ),'{}'),null) s where s.reason in ('awaiting_observation','waiting','eligible')
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
    select (select count(*) from remaining_keys),(select count(*) from batch),
      (select count(*) from recorded),(select count(*) from reset),last.bucket,last.name
    into remaining,batch_checked,batch_recorded,batch_reset,progress.cursor_bucket,progress.cursor_name
    from (values (true)) seed(one) left join lateral (select b.bucket,b.name from batch b order by b.bucket desc,b.name desc limit 1) last on true;

    progress.total:=progress.checked+remaining;
    progress.checked:=progress.checked+batch_checked;
    progress.recorded:=progress.recorded+batch_recorded;
    progress.reset_count:=progress.reset_count+batch_reset;
    progress.state:=case when remaining=batch_checked then 'complete' else 'running' end;
    if progress.state='complete' then progress.last_successful_at:=clock_timestamp(); end if;
  exception
    when query_canceled then error_code:='observation_timeout';
    when lock_not_available then return private.home_media_observation_progress('busy');
    when others then
      raise log 'Gary Home unused media observation failed with SQLSTATE %',sqlstate;
      error_code:='observation_failed';
  end;

  update private.home_media_observation set state=case when error_code is null then progress.state else 'failed' end,
    cursor_bucket=progress.cursor_bucket,cursor_name=progress.cursor_name,checked=progress.checked,total=progress.total,
    recorded=progress.recorded,reset_count=progress.reset_count,started_at=progress.started_at,
    last_successful_at=progress.last_successful_at,error=error_code where singleton;
  return private.home_media_observation_progress();
end;
$$;

create function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_observe_batch(); end if;
  return private.home_media_observation_progress();
end;
$$;

create function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_observe_batch();
$$;

-- Keep legacy staging and claims independent of observation failures.
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
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name)
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

revoke all on function private.home_media_observation_progress(text),private.home_media_observe_batch(integer),
  public.home_media_observation(boolean),public.home_media_observe_hourly() from public,anon,authenticated,service_role;
grant execute on function public.home_media_observation(boolean) to authenticated;
grant execute on function public.home_media_observe_hourly() to service_role;
notify pgrst,'reload schema';
commit;
