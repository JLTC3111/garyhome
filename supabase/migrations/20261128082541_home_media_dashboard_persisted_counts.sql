begin;

-- Keep scan and mutation behavior in the existing management RPC. Overview
-- reads are backed by saved statistics and never start an implicit scan.
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
  elsif p_action='overview' then
    -- A fresh project has no scan results until the Owner runs a scan.
    sample:=coalesce(ctrl.inventory_sample,'{}'::jsonb);
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
declare report jsonb; rows jsonb; live_count bigint; live_bytes bigint; early_count bigint;
  observed_count bigint; recovery_count bigint; recorded_refs jsonb; verified_at timestamptz;
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
  -- These counts describe recorded observations. The file lists and worker
  -- keep their own live eligibility checks.
  select reference_lookup->'exact',last_successful_at into recorded_refs,verified_at
    from private.home_media_observation where singleton;
  select count(*) into observed_count from private.home_media_items i
    join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
      and o.id=i.object_id and o.version is not distinct from i.object_version
    where i.source='unused_listing' and i.state='retained' and i.expires_at is not null
      and (i.upload_until is null or i.upload_until<=now())
      and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
      and not private.home_media_edit_referenced(i.bucket,i.name)
      and not exists(select 1 from private.home_media_pending_upload_keys() u where u.bucket=i.bucket and u.name=i.name);
  if recorded_refs is not null then
    select count(*) into recovery_count from private.home_media_review_holds h
      join storage.objects o on o.bucket_id=h.bucket and o.name=h.name
      where h.reason='recovery_hold' and not (recorded_refs ? (h.bucket||'/'||h.name));
  end if;
  return report||jsonb_build_object('crossAppProtection',true,
    'retentionCounts',jsonb_strip_nulls(jsonb_build_object('verified',observed_count,'recovery',recovery_count)),
    'retentionVerifiedAt',verified_at,'objects',live_count,'bytes',live_bytes,
    'inventoryCheckedAt',statement_timestamp(),'earlyEligible',early_count,
    'nextExpiry',(select min(i.expires_at) from private.home_media_items i
      where i.state='trashed' and i.expires_at>now() and i.attempts<4));
end;
$$;

commit;
