-- Owner inventory and page reads. Leave the retention gate and worker controls unchanged.
begin;

alter table private.home_media_control add column inventory_sample jsonb;

create function private.home_media_take_inventory(p_scan boolean,p_after uuid default null) returns jsonb
language sql stable set search_path='' as $$
  with refs as materialized (
    select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
  ), checking as materialized (
    select i.* from private.home_media_items i
    where p_scan and (i.state='candidate' or (i.state='uploading' and i.upload_until<=now()
      and not exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id(i.bucket,i.name))))
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
        when i.state in ('review','retained') then 'review'
        when exists(select 1 from public.properties p where p.id::text=case o.bucket_id
          when 'property-media' then case when o.name like 'properties/listings/%' then split_part(o.name,'/',3) end
          else split_part(o.name,'/',2) end) then 'listing'
        when o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames pr
          where (pr.new_key=o.name and pr.applied_at is null) or (pr.old_key=o.name and pr.removed_at is null)) then 'rename'
        else 'potential' end as reason
    from storage.objects o left join refs r on r.bucket=o.bucket_id and r.name=o.name
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name left join verified v on v.id=i.id
    where o.bucket_id in ('property-media','listing-videos')
  ), totals as (
    select count(*) as objects,coalesce(sum(bytes),0) as bytes,
      count(*) filter(where unlinked) as candidates,coalesce(sum(bytes) filter(where unlinked),0) as candidate_bytes,
      count(*) filter(where reason in ('reference','upload','review','listing','rename')) as protected,
      count(*) filter(where unlinked and reason in ('upload','review','listing','rename')) as protected_candidates,
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

create function private.home_media_panel_page(p_action text,p_offset integer) returns jsonb
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
        where state in ('trashed','deleting') order by expires_at,id limit 31 offset skip
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

-- Scheduled cleanup keeps its existing batch. The manual move uses the same guards for one scanned file.
create function private.home_media_stage_candidates(p_only uuid) returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    and (p_only is null or id=p_only)
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif p_only is not null and private.home_media_provider_upload(candidate.bucket,candidate.name) then
      raise exception 'listing_cleanup.media_busy' using errcode='55P03';
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and (p_only is null or i.id=p_only)
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
      and (p_only is null or not private.home_media_provider_upload(candidate.bucket,candidate.name))
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

create or replace function private.home_media_stage_candidates() returns integer
language sql set search_path='' as $$select private.home_media_stage_candidates(null::uuid)$$;
revoke all on function private.home_media_stage_candidates(uuid) from public,anon,authenticated,service_role;

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
    from private.home_media_items where state in ('trashed','deleting');
  select count(*) into due from private.home_media_items i
    where coalesce(i.retry_after,'-infinity')<=now() and (
      (i.state='trashed' and i.expires_at<=now() and i.attempts<4) or
      (i.state in ('deleting','review') and i.deletion_started_at is not null and (
        (i.state='deleting' and i.attempts<4) or not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name)
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

revoke all on function private.home_media_take_inventory(boolean,uuid),private.home_media_panel_page(text,integer) from public,anon,authenticated,service_role;
revoke all on function public.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.home_media_management(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
