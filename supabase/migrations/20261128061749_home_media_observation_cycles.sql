begin;

alter table private.home_media_observation add column cycle bigint not null default 0;
update private.home_media_observation set cycle=1 where state<>'idle';

create or replace function private.home_media_observation_progress(p_status text default null) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('status',coalesce(p_status,state),'cycle',cycle,'checked',checked,'total',total,
    'recorded',recorded,'reset',reset_count,'startedAt',started_at,'lastSuccessfulAt',last_successful_at,'error',error)
  from private.home_media_observation where singleton;
$$;

-- All callers share the existing checkpoint lock. The cycle and checked count
-- make a replay or stale continuation a read, including after completion.
create function private.home_media_advance_observation(p_cycle bigint,p_checked integer,p_start boolean) returns jsonb
language plpgsql set search_path='' as $$
declare prior private.home_media_observation; result jsonb;
begin
  begin
    select * into strict prior from private.home_media_observation where singleton for update nowait;
  exception when lock_not_available then
    return private.home_media_observation_progress('busy');
  end;

  if p_cycle is not null and (p_cycle<>prior.cycle or p_checked<>prior.checked
    or p_start is distinct from (prior.state in ('idle','complete'))) then
    return private.home_media_observation_progress();
  end if;

  result:=private.home_media_observe_batch(32);
  if result->>'status'<>'busy' and prior.state in ('idle','complete') then
    update private.home_media_observation set cycle=prior.cycle+1 where singleton;
    return private.home_media_observation_progress();
  end if;
  return result;
end;
$$;

create function public.home_media_observation_step(p_cycle bigint,p_checked integer,p_start boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_cycle is null or p_cycle<0 or p_checked is null or p_checked<0 or p_start is null then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  return private.home_media_advance_observation(p_cycle,p_checked,p_start);
end;
$$;

-- Keep the previous UI and deployed worker compatible during rollout.
create or replace function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_advance_observation(null,null,true); end if;
  return private.home_media_observation_progress();
end;
$$;

create or replace function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_advance_observation(null,null,true);
$$;

create function public.home_media_observe_hourly_step(p_cycle bigint,p_checked integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_cycle is null or p_cycle<0 or p_checked is null or p_checked<0 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  return private.home_media_advance_observation(p_cycle,p_checked,false);
end;
$$;

revoke all on function private.home_media_advance_observation(bigint,integer,boolean),
  public.home_media_observation_step(bigint,integer,boolean),public.home_media_observe_hourly_step(bigint,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_observation_step(bigint,integer,boolean) to authenticated;
grant execute on function public.home_media_observe_hourly_step(bigint,integer) to service_role;

notify pgrst,'reload schema';
commit;
