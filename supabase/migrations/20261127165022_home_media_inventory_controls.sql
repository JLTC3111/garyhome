-- Both tabs read the same classification and issue the existing manual removal ticket.
begin;

create function private.home_media_file_states(p_bucket text,p_name text,p_scoped_only boolean)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,s.listing_id from storage.objects o
    cross join lateral (select private.home_media_scope_id(o.bucket_id,o.name) listing_id) s
    where o.bucket_id in ('property-media','listing-videos') and (not p_scoped_only or s.listing_id is not null)
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), refs as materialized (
    select distinct l.bucket,l.name from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
    where exists(select 1 from objects)
  ), observed as (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or private.home_media_provider_upload(o.bucket_id,o.name) then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when exists(select 1 from private.home_listing_deletion_media m where m.bucket=o.bucket_id and m.name=o.name)
          or (o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key)))
          then 'legacy_lifecycle'
        when not exists(select 1 from private.home_media_identity(o.bucket_id,o.name) verified where verified.id=o.id)
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when o.listing_id is null then 'outside_listing_scope'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state,link.name is not null as saved_reference
    from objects o left join public.properties p on p.id=o.listing_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join refs link on link.bucket=o.bucket_id and link.name=o.name
    left join refs full_key on full_key.bucket is null and full_key.name=lower(o.name)
    left join refs filename on filename.bucket is null and filename.name=lower(regexp_replace(o.name,'^.*/',''))
    left join refs original on original.bucket is null and original.name=lower(btrim(o.user_metadata->>'original_filename'))
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end,o.saved_reference
  from observed o;
$$;

create or replace function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz)
language sql stable set search_path='' as $$
  select r.bucket,r.name,r.listing_id,r.listing_code,r.object_id,r.object_version,r.bytes,r.reason,r.eligible_at,r.legacy_expiry
  from private.home_media_file_states(p_bucket,p_name,true) r;
$$;

create function private.home_media_owner_files(p_offset integer,p_query text,p_scoped_only boolean) returns jsonb
language sql stable set search_path='' as $$
  with listing_links as materialized (
    select distinct on (l.bucket,l.name) l.bucket,l.name,p.id
    from public.properties p
    cross join lateral private.home_media_document_evidence(private.home_media_listing_fields(p)) l
    where not p_scoped_only and l.bucket is not null
    order by l.bucket,l.name,p.listing_code,p.id
  ), matches as materialized (
    select r.bucket,r.name,r.bytes,r.listing_id,p.listing_code,r.object_id,r.object_version,
      r.reason,r.eligible_at,r.legacy_expiry,r.saved_reference,
      p.title_en as listing_title_en,p.title_vi as listing_title_vi,
      r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
      private.home_media_unused_ticket(i) as manual_target
    from private.home_media_file_states(null,null,p_scoped_only) r
    cross join private.home_media_control c
    left join listing_links l on r.listing_id is null and r.saved_reference and l.bucket=r.bucket and l.name=r.name
    left join public.properties p on p.id=coalesce(r.listing_id,l.id)
    left join private.home_media_items i on i.bucket=r.bucket and i.name=r.name
      and i.source='unused_listing' and i.state='retained' and r.reason in ('waiting','eligible')
    where c.singleton and strpos(lower(concat_ws(' ',r.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0
  ), page as (
    select coalesce(jsonb_agg(to_jsonb(s)-'shortlist' order by shortlist desc,s.bucket,s.name),'[]') items
    from (select m.*,not p_scoped_only and m.manual_target is not null as shortlist
      from matches m order by shortlist desc,bucket,name
      limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)) s
  )
  select jsonb_build_object('items',items-30,'hasMore',jsonb_array_length(items)>30,'available',true,
    'manualCount',(select count(*) from matches where manual_target is not null),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
  from page;
$$;

create function public.home_media_inventory_files(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_media_owner_files(p_offset,p_query,false);
end;
$$;

create or replace function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_media_owner_files(p_offset,p_query,true);
end;
$$;

-- The existing runner still revalidates selected identities against this manifest.
create or replace function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return (select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    from private.home_media_inactivity_inventory() r
    join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing' and i.state='retained'
    left join public.properties p on p.id=r.listing_id
    where r.reason in ('waiting','eligible') and strpos(lower(concat_ws(' ', r.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0);
end;
$$;

revoke all on function private.home_media_file_states(text,text,boolean),private.home_media_owner_files(integer,text,boolean),
  public.home_media_inventory_files(integer,text) from public,anon,authenticated,service_role;
grant execute on function public.home_media_inventory_files(integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
