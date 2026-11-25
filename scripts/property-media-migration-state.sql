-- Session-local catalogue and retirement helpers for the operator CLI.
create or replace function pg_temp.property_media_identity(p_key text)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('key',o.name,'id',o.id,'version',o.version,
    'etag',coalesce(o.metadata->>'eTag',o.metadata->>'etag'),
    'bytes',case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
    'mime',o.metadata->>'mimetype','userMetadata',coalesce(o.user_metadata,'{}'::jsonb))
  from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id='property-media' and o.name=p_key
    and b.versioning_status::text='DISABLED' and o.is_versioned is false
    and o.is_delete_marker is false and o.archived_at is null;
$$;

create or replace function pg_temp.property_media_migration_state(p_listing uuid,p_old text,p_new text,p_job uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  with refs as (
    select name,count(*) as n from private.home_listing_media_refs
    where bucket='property-media' and name in (p_old,p_new) group by name
  )
  select jsonb_build_object(
    'original',pg_temp.property_media_identity(p_old),'optimized',pg_temp.property_media_identity(p_new),
    'originalPresent',exists(select 1 from storage.objects where bucket_id='property-media' and name=p_old),
    'optimizedPresent',exists(select 1 from storage.objects where bucket_id='property-media' and name=p_new),
    'sourceRefs',coalesce((select n from refs where name=p_old),0),
    'targetRefs',coalesce((select n from refs where name=p_new),0),
    'listing',(select jsonb_build_object('version',p.updated_at,'images',p.images,
      'fields',jsonb_build_object('images',p.images,'image_filenames',p.image_filenames,
        'image_metadata',p.image_metadata,'source_url',p.source_url)) from public.properties p where p.id=p_listing),
    'retirement',(select jsonb_build_object('id',r.id,'removed',r.removed_at is not null)
      from private.property_photo_renames r where r.id=p_job)
  );
$$;

create or replace function pg_temp.review_property_media_batch(p_entries jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  with wanted as materialized (
    select * from jsonb_to_recordset(p_entries) as e(token text, listing uuid, old_key text, new_key text)
  ), keys as materialized (
    select old_key name from wanted union select new_key from wanted
  ), refs as (
    select r.name,count(*) n from private.home_listing_media_refs r join keys k on k.name=r.name
    where r.bucket='property-media' group by r.name
  ), protected as (
    select old_key name from private.property_photo_renames union select new_key from private.property_photo_renames
    union select name from private.home_listing_deletion_media where bucket='property-media'
  )
  select coalesce(jsonb_object_agg(w.token,jsonb_build_object(
    'version',p.updated_at,'original',pg_temp.property_media_identity(w.old_key),
    'hasOriginal',exists(select 1 from unnest(p.images) uri where
      private.home_photo_key(uri,'https://duyiihsmaqfgwezmsnjs.supabase.co')=w.old_key),
    'exclusive',coalesce(src.n,0)>0 and src.n=pg_temp.optimized_photo_listing_refs(p,w.old_key),
    'destinationClear',dst.n is null and not exists(select 1 from storage.objects
      where bucket_id='property-media' and name=w.new_key),
    'protected',exists(select 1 from protected where name in (w.old_key,w.new_key))
  )), '{}'::jsonb)
  from wanted w join public.properties p on p.id=w.listing
  left join refs src on src.name=w.old_key left join refs dst on dst.name=w.new_key;
$$;

create or replace function pg_temp.verify_property_media_run(p_entries jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  with selected as materialized (
    select * from jsonb_to_recordset(p_entries) as x(listing uuid, old_key text, new_key text, job uuid, identity jsonb)
  ), refs as materialized (
    select distinct r.name from private.home_listing_media_refs r join selected s on r.name in (s.old_key,s.new_key)
    where r.bucket='property-media'
  ), verified as (
    select s.*,p.slug,p.listing_type,p.status,p.availability
    from selected s join public.properties p on p.id=s.listing join private.property_photo_renames j on j.id=s.job
    where j.removed_at is not null and j.property_id=s.listing and j.old_key=s.old_key and j.new_key=s.new_key
      and j.sha256=s.identity->>'sha256' and pg_temp.property_media_identity(s.new_key)=s.identity-'sha256'
      and not exists(select 1 from storage.objects o where o.bucket_id='property-media' and o.name=s.old_key)
      and not exists(select 1 from refs where name=s.old_key) and exists(select 1 from refs where name=s.new_key)
      and exists(select 1 from unnest(p.images) uri where
        private.home_photo_key(uri,'https://duyiihsmaqfgwezmsnjs.supabase.co')=s.new_key)
  )
  select jsonb_build_object('confirmed',(select count(*) from verified), 'objects',count(*),
    'bytes',sum(case when metadata->>'size' ~ '^[0-9]{1,15}$' then (metadata->>'size')::bigint else 0 end),
    'sample',(select jsonb_build_object('slug',slug,'key',new_key) from verified
      where listing_type='rent' and status='published' and availability in ('available','on_request')
      and nullif(slug,'') is not null order by new_key limit 1))
  from storage.objects where bucket_id='property-media';
$$;

-- After verification and separate approval, reserve retirement through the
-- existing rename guards. This records a verified substitution and performs
-- no copy or delete. The existing Owner-only retire route removes the object.
create or replace function pg_temp.reserve_optimized_photo_retirement(p_transfer jsonb,p_job uuid,p_actor uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
  listing_id uuid:=(p_transfer->>'listing')::uuid;
  original jsonb:=p_transfer->'original'; optimized jsonb:=p_transfer->'optimized';
  original_key text:=original->>'key'; optimized_key text:=optimized->>'key';
  evidence jsonb; prior private.property_photo_renames;
begin
  -- The CLI passes the user ID from Supabase Auth after its Owner RPC succeeds.
  -- This transaction-local identity rechecks the same current membership gate.
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform private.require_home_photo_owner();
  if p_transfer->>'applied' is distinct from 'true' or listing_id is null or p_job is null
    or original_key is null or optimized_key is null or original_key=optimized_key
    or coalesce(original->>'sha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(optimized->>'sha256','') !~ '^[0-9a-f]{64}$'
    or private.home_listing_upload_id('property-media',optimized_key) is distinct from listing_id::text
  then raise exception 'photo_optimization.invalid_retirement' using errcode='22023'; end if;
  evidence:=jsonb_build_object('id',listing_id,'updated_at',p_transfer->>'versionAfter',
    'previous_updated_at',p_transfer->>'versionBefore','operation','photo_optimization',
    'original',original-'userMetadata','optimized',optimized-'userMetadata');

  perform private.lock_home_listing_media_snapshot();
  select * into prior from private.property_photo_renames where id=p_job;
  if found and (prior.origin<>origin or prior.property_id<>listing_id or prior.old_key<>original_key
    or prior.new_key<>optimized_key or prior.sha256 is distinct from optimized->>'sha256'
    or prior.properties is distinct from jsonb_build_array(evidence) or prior.removal_requested_by is null)
  then raise exception 'photo_optimization.retirement_conflict' using errcode='PT409'; end if;
  if prior.removed_at is not null and not exists(
      select 1 from storage.objects where bucket_id='property-media' and name=original_key) then return p_job; end if;

  if (pg_temp.property_media_identity(original_key) is distinct from original-'sha256'
        and (prior.id is null or exists(select 1 from storage.objects where bucket_id='property-media' and name=original_key)))
    or pg_temp.property_media_identity(optimized_key) is distinct from optimized-'sha256'
  then raise exception 'photo_optimization.object_changed' using errcode='PT409'; end if;
  if exists(select 1 from private.home_listing_media_refs where bucket='property-media' and name=original_key)
    or not exists(select 1 from public.properties p,unnest(p.images) uri
      where p.id=listing_id and private.home_photo_key(uri,origin)=optimized_key)
    or exists(select 1 from private.property_photo_renames r where r.id<>p_job
        and (r.old_key in (original_key,optimized_key) or r.new_key in (original_key,optimized_key)))
    or exists(select 1 from private.home_listing_deletion_media d where d.bucket='property-media'
        and d.name in (original_key,optimized_key))
  then raise exception 'photo_optimization.protected_reference' using errcode='PT409'; end if;
  if prior.id is null then
    insert into private.property_photo_renames(id,property_id,origin,old_key,new_key,started_by,
      applied_at,applied_by,properties,sha256,removal_requested_by,auto_cleanup_requested)
    values(p_job,listing_id,origin,original_key,optimized_key,p_actor,
      clock_timestamp(),p_actor,jsonb_build_array(evidence),optimized->>'sha256',p_actor,false);
  end if;
  return p_job;
end;
$$;

revoke all on function pg_temp.property_media_identity(text),
  pg_temp.property_media_migration_state(uuid,text,text,uuid),
  pg_temp.review_property_media_batch(jsonb),
  pg_temp.verify_property_media_run(jsonb),
  pg_temp.reserve_optimized_photo_retirement(jsonb,uuid,uuid) from public;
