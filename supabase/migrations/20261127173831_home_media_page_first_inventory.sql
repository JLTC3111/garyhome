begin;

create type private.home_media_reference_key as (bucket text,name text);

-- Keep the same embedded URLs, direct URLs, scoped keys and aliases. Walk the
-- JSON scalars once and send only possible URLs or scoped keys to the decoders.
create or replace function private.home_media_document_evidence(p_doc jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  with scalars as materialized (
    select distinct value #>> '{}' as value
    from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
  ), direct_photos as materialized (
    select case when starts_with(s.value,'https://') or starts_with(s.value,'http://')
      then private.home_photo_key(s.value,null) end as name from scalars s
  ), raw_values as (
    select s.value from scalars s
    union select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_metadata')='object' then p_doc->'image_metadata' end) key
    union select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_filenames')='object' then p_doc->'image_filenames' end) key
  ), scoped_keys as materialized (
    select r.value,case
      when left(r.value,20) ilike 'properties/listings/' then
        case when private.home_media_scope_id('property-media',r.value) is not null then 'property-media' end
      when strpos(r.value,'/')=37 then
        case when private.home_media_scope_id('listing-videos',r.value) is not null then 'listing-videos' end
      end bucket
    from raw_values r
  )
  select l.bucket,l.name from private.home_listing_storage_links(p_doc::text) l where l.name is not null
  union select 'property-media',p.name from direct_photos p where p.name is not null
  union select k.bucket,coalesce(private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||k.value,null),k.value)
    from scoped_keys k where k.bucket is not null
  union select null::text,lower(btrim(s.value)) from scalars s where length(s.value) between 1 and 1024;
$$;

create function private.home_media_reference_snapshot() returns private.home_media_reference_key[]
language sql stable set search_path='' as $$
  select coalesce(array_agg(row(r.bucket,r.name)::private.home_media_reference_key),'{}')
  from (
    select distinct l.bucket,l.name
    from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
  ) r;
$$;

create function private.home_media_pending_upload_keys() returns table(bucket text,name text)
language plpgsql stable set search_path='' as $$
begin
  if to_regclass('storage.s3_multipart_uploads') is not null then
    return query execute
      'select distinct bucket_id,key from storage.s3_multipart_uploads where bucket_id in (''property-media'',''listing-videos'')';
  end if;
end;
$$;

-- A NULL ID list means all matching objects, as used by the hourly observation.
-- A supplied list restricts all detail work. The worker builds its own snapshot.
create function private.home_media_file_states_batch(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_references private.home_media_reference_key[]
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,private.home_media_scope_id(o.bucket_id,o.name) as listing_id
    from storage.objects o
    where o.bucket_id in ('property-media','listing-videos')
      and (p_ids is null or o.id=any(p_ids))
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
      and (not p_scoped_only or private.home_media_scope_id(o.bucket_id,o.name) is not null)
  ), refs as materialized (
    select * from unnest(coalesce(p_references,case when exists(select 1 from objects)
      then private.home_media_reference_snapshot() else '{}' end))
  ), pending_uploads as materialized (
    select * from private.home_media_pending_upload_keys() where exists(select 1 from objects)
  ), edit_keys as materialized (
    select distinct e.key
    from private.home_media_edit_checkpoints c cross join lateral jsonb_array_elements_text(c.links) e(key)
    where exists(select 1 from objects)
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
        when e.key is not null then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
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
      i.expires_at,i.source,i.state,link.name is not null as saved_reference
    from objects o left join public.properties p on p.id=o.listing_id
    left join storage.buckets b on b.id=o.bucket_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join pending_uploads u on u.bucket=o.bucket_id and u.name=o.name
    left join edit_keys e on e.key=o.bucket_id||'/'||o.name
    left join legacy_keys legacy on legacy.bucket=o.bucket_id and legacy.name=o.name
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

create or replace function private.home_media_file_states(p_bucket text,p_name text,p_scoped_only boolean)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  select * from private.home_media_file_states_batch(p_bucket,p_name,p_scoped_only,null,null);
$$;

-- Start with the retained ledger rows, bound to the still-current Storage identity.
create function private.home_media_retained_observations() returns setof private.home_media_items
language sql stable set search_path='' as $$
  select i.* from private.home_media_items i
  join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
    and o.id=i.object_id and o.version is not distinct from i.object_version
  where i.source='unused_listing' and i.state='retained'
    and private.home_media_scope_id(i.bucket,i.name) is not null;
$$;

create or replace function private.home_media_owner_files(p_offset integer,p_query text,p_scoped_only boolean) returns jsonb
language sql stable set search_path='' as $$
  with args as (
    select lower(left(btrim(coalesce(p_query,'')),120)) needle,
      least(greatest(coalesce(p_offset,0),0),1000000) skip
  ), listing_links as materialized (
    select distinct on (l.bucket,l.name) l.bucket,l.name,p.id
    from public.properties p
    cross join lateral private.home_media_document_evidence(private.home_media_listing_fields(p)) l
    where not p_scoped_only and l.bucket is not null
    order by l.bucket,l.name,p.listing_code,p.id
  ), catalogue as materialized (
    select o.bucket_id bucket,o.name,o.id,private.home_media_scope_id(o.bucket_id,o.name) listing_id
    from storage.objects o where o.bucket_id in ('property-media','listing-videos')
  ), matches as materialized (
    select o.*,p.listing_code,p.title_en as listing_title_en,p.title_vi as listing_title_vi
    from catalogue o
    left join listing_links l on o.listing_id is null and l.bucket=o.bucket and l.name=o.name
    left join public.properties p on p.id=coalesce(o.listing_id,l.id)
    cross join args a
    where (not p_scoped_only or o.listing_id is not null)
      and strpos(lower(concat_ws(' ',o.name,p.listing_code,p.title_en,p.title_vi)),a.needle)>0
  ), reference_snapshot as materialized (
    select case when exists(select 1 from matches) then private.home_media_reference_snapshot() else '{}' end as keys
  ), observations as materialized (
    select i.* from private.home_media_retained_observations() i join matches m on m.id=i.object_id
  ), candidate_states as materialized (
    select r.* from (select array_agg(object_id) ids from observations) o cross join reference_snapshot f
    cross join lateral private.home_media_file_states_batch(null,null,true,coalesce(o.ids,'{}'),f.keys) r
    where o.ids is not null
  ), verified as materialized (
    select i.id,i.object_id,private.home_media_unused_ticket(i) as ticket
    from observations i join candidate_states s on s.object_id=i.object_id
    where s.reason in ('waiting','eligible')
  ), lookahead as materialized (
    select m.*,not p_scoped_only and v.id is not null as priority,v.ticket as manual_target
    from matches m left join verified v on v.object_id=m.id
    order by priority desc,m.bucket,m.name
    limit 31 offset (select skip from args)
  ), page as materialized (
    select * from lookahead order by priority desc,bucket,name limit 30
  ), details as (
    select s.* from candidate_states s join page p on p.id=s.object_id
    union all
    select r.*
    from (select array_agg(p.id) ids from page p
      where not exists(select 1 from candidate_states s where s.object_id=p.id)) remaining
    cross join reference_snapshot f
    cross join lateral private.home_media_file_states_batch(null,null,p_scoped_only,coalesce(remaining.ids,'{}'),f.keys) r
    where remaining.ids is not null
  ), result as (
    select coalesce(jsonb_agg(to_jsonb(s)-'priority' order by s.priority desc,s.bucket,s.name),'[]') items
    from (
      select r.bucket,r.name,r.bytes,r.listing_id,p.listing_code,r.object_id,r.object_version,
        r.reason,r.eligible_at,r.legacy_expiry,r.saved_reference,p.listing_title_en,p.listing_title_vi,
        r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
        p.manual_target,p.priority
      from page p join details r on r.object_id=p.id cross join private.home_media_control c where c.singleton
    ) s
  )
  select jsonb_build_object('items',items,'hasMore',(select count(*)>30 from lookahead),'available',true,
    'manualCount',(select count(*) from verified),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
  from result;
$$;

-- Select-all uses the same live classification over the retained candidates.
create or replace function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_home_photo_owner();
  with observations as materialized (
    select i.* from private.home_media_retained_observations() i
    left join public.properties p on p.id=private.home_media_scope_id(i.bucket,i.name)
    where strpos(lower(concat_ws(' ',i.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0
  ), ids as (select array_agg(object_id) value from observations)
  select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    into result
  from ids cross join lateral private.home_media_file_states_batch(null,null,true,coalesce(ids.value,'{}'),null) s
  join observations i on i.object_id=s.object_id
  where s.reason in ('waiting','eligible');
  return result;
end;
$$;

revoke all on function private.home_media_reference_snapshot(),private.home_media_pending_upload_keys(),
  private.home_media_file_states_batch(text,text,boolean,uuid[],private.home_media_reference_key[]),
  private.home_media_retained_observations() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;