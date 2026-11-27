begin;

-- Selection is a read-only preview. The existing worker rechecks dependencies and identity on every claim.
create function private.home_media_early_block(i private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case
    when i.state='deleting' then 'removal_in_progress'
    when i.state='review' and i.hold_reason in ('storage','storage_present') then 'storage_failure'
    when i.state='review' then 'protected'
    when i.state<>'trashed' then 'no_longer_eligible'
    when i.expires_at is null then 'missing_expiry'
    when i.expires_at<=now() then 'expired'
    when exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name) then 'owner_hold'
    when i.upload_until>now() then 'active_upload'
    when i.retry_after>now() then 'retry_wait'
    when i.attempts>=4 then 'attempt_limit'
    when not exists(select 1 from private.home_media_identity(i.bucket,i.name) o
      where o.id=i.object_id and o.version is not distinct from i.object_version
        and (i.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag')) then 'identity_changed'
    end;
$$;

create or replace function public.home_media_dashboard(p_action text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report jsonb; rows jsonb; live_count bigint; live_bytes bigint; early_count bigint;
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
  return report||jsonb_build_object('crossAppProtection',true,'objects',live_count,'bytes',live_bytes,
    'inventoryCheckedAt',statement_timestamp(),'earlyEligible',early_count,
    'nextExpiry',(select min(i.expires_at) from private.home_media_items i
      where i.state='trashed' and i.expires_at>now() and i.attempts<4));
end;
$$;

create function public.home_media_trash_receipt(p_id uuid,p_expiry timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; result text;
begin
  perform private.require_home_photo_owner();
  select * into item from private.home_media_items where id=p_id;
  if not found or item.expires_at is distinct from p_expiry then return jsonb_build_object('status','selection_changed'); end if;
  if item.state='removed' then
    result:=case when exists(select 1 from private.home_media_runs r where r.id=item.deletion_run
      and r.actor=auth.uid() and r.early_item=item.id and r.early_expiry=p_expiry)
      then 'removed' else 'already_removed' end;
  elsif exists(select 1 from private.home_media_control c join private.home_media_runs r on r.id=c.lease
    where c.singleton and c.lease_until>now() and r.early_item=item.id) then
    result:='removal_in_progress';
  else result:=coalesce(private.home_media_early_block(item),'eligible'); end if;
  return jsonb_build_object('status',result,'bytes',item.bytes);
end;
$$;

revoke all on function private.home_media_early_block(private.home_media_items),public.home_media_trash_receipt(uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_trash_receipt(uuid,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
