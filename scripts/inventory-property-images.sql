-- Run manually in a read-only session after approving the metadata inventory.
-- Uses the same known references as Home's guarded listing cleanup.
with refs as materialized (
  select name, count(*) as sightings
  from private.home_listing_media_refs
  where bucket = 'property-media' and name is not null
  group by name
), gallery as materialized (
  select distinct private.home_photo_key(uri,'https://duyiihsmaqfgwezmsnjs.supabase.co') as key, p.id, p.updated_at
  from public.properties p cross join lateral unnest(p.images) uri
), gallery_lists as (
  select key, jsonb_agg(jsonb_build_object('id',id,'version',updated_at) order by id) as listings
  from gallery where key is not null group by key
), objects as (
  select o.name as key, o.id, o.version,
    case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end as bytes,
    o.metadata->>'mimetype' as mime,
    coalesce(o.metadata->>'eTag',o.metadata->>'etag') as etag,
    o.metadata->>'cacheControl' as "cacheControl",
    o.user_metadata as "userMetadata",
    coalesce(b.versioning_status::text <> 'DISABLED', true) or coalesce(o.is_versioned,true)
    or coalesce(o.is_delete_marker,true) or o.archived_at is not null
    or exists (select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key))
    or exists (select 1 from private.home_listing_deletion_media d where d.bucket=o.bucket_id and d.name=o.name)
      as protected
  from storage.objects o
  join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id = 'property-media'
)
select jsonb_build_object(
  'schemaVersion',1,'bucket','property-media','capturedAt',statement_timestamp(),
  'objects',coalesce((select jsonb_agg(to_jsonb(o) order by o.key,o.version) from objects o),'[]'::jsonb),
  'references',coalesce((select jsonb_object_agg(name,sightings) from refs),'{}'::jsonb),
  'galleryListings',coalesce((select jsonb_object_agg(key,listings) from gallery_lists),'{}'::jsonb)
) as inventory;
