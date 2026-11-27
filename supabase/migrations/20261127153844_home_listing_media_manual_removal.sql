-- Owner-initiated removal uses the same worker lease, target and settlement.
begin;

alter table private.home_media_runs add column early_unused boolean not null default false;

create function private.home_media_unused_ticket(i private.home_media_items) returns jsonb
language sql stable strict set search_path='' as $$
  select jsonb_build_object('id',i.id,'name',i.name,'bucket',i.bucket,'bytes',i.bytes,'expires_at',i.expires_at,
    'source','unused_listing');
$$;

-- The signed-in Owner can select only live, verified identities from the inactivity ledger.
create or replace function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  with matches as materialized (
    select r.*,r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
      private.home_media_unused_ticket(i) as manual_target
    from private.home_media_inactivity_inventory() r cross join private.home_media_control c
    left join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing'
      and i.state='retained' and r.reason in ('waiting','eligible')
    where c.singleton and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0)
  ), page as (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.bucket,s.name),'[]') items from (
      select * from matches order by bucket,name limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)
    ) s
  )
  select jsonb_build_object('items',items-30,'hasMore',jsonb_array_length(items)>30,'available',true,
    'manualCount',(select count(*) from matches where manual_target is not null),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
    into result from page;
  return result;
end;
$$;

create function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  return (select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    from private.home_media_inactivity_inventory() r
    join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing' and i.state='retained'
    where r.reason in ('waiting','eligible') and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0));
end;
$$;

create function public.home_media_claim_unused(p_actor uuid,p_item uuid,p_expiry timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
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
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry,early_unused) values(job,p_actor,p_item,p_expiry,true);
  return jsonb_build_object('status','ok','id',job,'items',jsonb_build_array(jsonb_build_object('id',p_item)));
end;
$$;

create function public.home_media_unused_receipt(p_id uuid,p_expiry timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item private.home_media_items; result text;
begin
  perform private.require_home_photo_owner();
  select * into item from private.home_media_items where id=p_id and source='unused_listing' and expires_at=p_expiry;
  if not found then return jsonb_build_object('status','selection_changed'); end if;
  if item.state='removed' then
    result:=case when exists(select 1 from private.home_media_runs r where r.id=item.deletion_run
      and r.actor=auth.uid() and r.early_unused and r.early_item=item.id and r.early_expiry=p_expiry)
      then 'removed' else 'already_removed' end;
  elsif exists(select 1 from private.home_media_control c join private.home_media_runs r on r.id=c.lease
    where c.singleton and c.lease_until>now() and r.early_unused and r.early_item=item.id) then
    result:='removal_in_progress';
  elsif item.state='deleting' then
    result:=case when item.hold_reason in ('storage','storage_present') then 'storage_failure' else 'removal_in_progress' end;
  elsif item.state='retained' then
    select case
      when r.reason in ('waiting','eligible') then 'eligible'
      when r.reason in ('owner_hold','recovery_hold','file_trash_test','editing_session','active_upload') then r.reason
      when r.reason in ('reference','filename_match') then 'protected'
      else 'identity_changed' end into result
    from private.home_media_inactivity_inventory(item.bucket,item.name) r;
  else result:='no_longer_eligible'; end if;
  return jsonb_build_object('status',coalesce(result,'identity_changed'),'bytes',item.bytes);
end;
$$;

-- A failed manual attempt cannot advance the date of scheduled removal.
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
          (state='deleting' and attempts<4 and (source<>'unused_listing' or (ctrl.listing_inactivity_enabled and expires_at<=now()))) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
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
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry
      or job.early_unused is distinct from (item.source='unused_listing')))
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
    if item.attempts>=4 or (job.early_unused and item.state<>'retained')
      or (not job.early_unused and (item.state not in ('retained','deleting') or item.expires_at>now()
        or not (select listing_inactivity_enabled from private.home_media_control where singleton)))
      then return null; end if;
    perform private.home_media_lock_listing_inactivity();
    select r.reason into protection from private.home_media_inactivity_inventory(item.bucket,item.name) r;
    if protection is null or not (protection='eligible' or (job.early_unused and protection='waiting')
      or (not job.early_unused and protection='removing')) then
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

revoke all on function private.home_media_unused_ticket(private.home_media_items),
  public.home_media_retention_manifest(text),public.home_media_unused_receipt(uuid,timestamptz),
  public.home_media_claim_unused(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.home_media_retention_manifest(text),
  public.home_media_unused_receipt(uuid,timestamptz) to authenticated;
grant execute on function public.home_media_claim_unused(uuid,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
