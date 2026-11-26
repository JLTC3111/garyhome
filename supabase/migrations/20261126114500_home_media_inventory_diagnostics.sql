-- Read-only additions to the deployed Owner inventory. The cleanup gate remains in its control table.
begin;

alter function public.home_media_management(text,uuid,integer) set schema private;
revoke all on function private.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;

create function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; scheduled boolean:=false; verified bigint; verified_bytes bigint;
begin
  perform private.require_home_photo_owner();
  result:=private.home_media_management(p_action,p_id,p_offset);
  if p_action not in ('status','scan','trash') then return result; end if;

  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active)'
      into scheduled using 'gary-home-media-expiry';
  end if;

  -- Admit only reserved objects with their audited Storage identities and no current exact reference.
  select count(*),coalesce(sum(i.bytes),0) into verified,verified_bytes
  from private.home_media_items i
  join lateral private.home_media_identity(i.bucket,i.name) o
    on o.id=i.object_id and o.version is not distinct from i.object_version
  where i.state in ('trashed','deleting') and (i.upload_until is null or i.upload_until<=now())
    and not private.home_media_referenced(i.bucket,i.name,i.source='historical')
    and (i.source<>'historical' or (
      btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag'
      and not private.home_media_provider_upload(i.bucket,i.name)))
    and (i.source<>'rename' or (
      exists(select 1 from private.home_media_identity('property-media',i.replacement_key) r
        where r.id=i.replacement_id and r.version is not distinct from i.replacement_version)
      and exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=i.replacement_key)));

  return result||jsonb_build_object(
    'automaticScheduled',scheduled,'verifiedCandidates',verified,'verifiedCandidateBytes',verified_bytes,
    'heldCandidates',greatest(0,coalesce((result->>'candidates')::bigint,0)-verified)
  );
end;
$$;

revoke all on function public.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.home_media_management(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
