begin;

-- Reuse cached saved evidence only while the live document digest matches.
-- Extract JSONB membership maps once, then check Storage for matching aliases.
create or replace function private.home_media_classify_files(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_lookup jsonb,p_recovery_held_at timestamptz
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
    select coalesce(p_lookup,(
      select c.reference_lookup from private.home_media_observation c where c.singleton
        and c.reference_lookup is not null and c.reference_digest=private.home_media_reference_digest()
    ),private.home_media_live_reference_lookup()) as keys
    where exists(select 1 from objects)
  ), refs as materialized (
    select keys->'exact' as exact,keys->'aliases' as aliases,keys->'mapped' as mapped from evidence
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
        when h.name is not null and (h.reason<>'recovery_hold' or h.held_at is distinct from p_recovery_held_at) then h.reason
        when i.upload_until>now() or u.name is not null then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when refs.exact ? (o.bucket_id||'/'||o.name) then 'reference'
        when refs.aliases ? lower(o.name) or refs.aliases ? lower(regexp_replace(o.name,'^.*/',''))
          or refs.aliases ? lower(btrim(o.user_metadata->>'original_filename'))
          or exists (
            select 1 from (values (lower(o.name)),(lower(regexp_replace(o.name,'^.*/',''))),
              (lower(btrim(o.user_metadata->>'original_filename')))) a(name)
            cross join lateral jsonb_array_elements_text(refs.mapped->a.name) k(name)
            where not exists(select 1 from private.home_media_identity('property-media',k.name))
          ) then 'filename_match'
        when i.id is not null and not (i.source='unused_listing' and i.state in ('retained','deleting')
          or i.source='upload' and i.state in ('uploading','retained') and o.listing_id is not null) then 'legacy_lifecycle'
        when legacy.name is not null then 'legacy_lifecycle'
        when o.name ~ '(^/|/$|//|(^|/)\.{1,2}(/|$)|[[:cntrl:]])' or strpos(o.name,chr(92))>0
          or length(o.name) not between 1 and 1024
          or b.id is null or coalesce(to_jsonb(b)->>'versioning_status','DISABLED')<>'DISABLED'
          or coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
          or coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
          or to_jsonb(o)->>'archived_at' is not null
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.state='deleting' then 'removing'
            when i.expires_at<=now() then 'eligible' else 'waiting' end
        when i.source='unused_listing' and i.state='deleting' then 'identity'
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

commit;
