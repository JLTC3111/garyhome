-- Read-only. Scope is the two Gary Home listing buckets and known Home references.
with payloads as (
  select to_jsonb(t)::text body from public.properties t
  union all select to_jsonb(t)::text from public.neighbourhoods t
  union all select to_jsonb(t)::text from public.site_settings t
  union all select to_jsonb(t)::text from public.listing_authors t
  union all select to_jsonb(t)::text from public.site_activities t
  union all select to_jsonb(t)::text from public.editorial_articles t
  union all select to_jsonb(t)::text from public.enquiries t
  union all select to_jsonb(t)::text from public.enquiry_notes t
  union all select to_jsonb(t)::text from public.feedback_public t
  union all select to_jsonb(t)::text from public.feedback_submissions t
  union all select to_jsonb(t)::text from public.property_assistance t
  union all select to_jsonb(t)::text from public.assistance_reviews t
  union all select to_jsonb(t)::text from public.landlord_submissions t
  union all select to_jsonb(t)::text from public.landlord_submission_files t
), refs as materialized (
  select 'property-media'::text bucket,private.home_photo_key(uri,null) name from private.home_photo_references
  union
  select lower(hit[1]),private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||hit[2],null)
  from payloads p cross join lateral regexp_matches(p.body,
    '/(property-media|listing-videos)/([^[:space:]"<>?#,;\\]+\.(?:jpe?g|png|webp|avif|mp4))(?=$|[^[:alnum:]_%/-])','gi') hit
), renames as materialized (
  select r.id,r.property_id,r.old_key,r.new_key,r.applied_at,p.id is null as deleted
  from private.property_photo_renames r left join public.properties p on p.id=r.property_id
  where r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co'
), classified as materialized (
  select o.bucket_id as bucket,o.name,o.id,o.version,r.property_id,r.id as rename_id,
    case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end as bytes,
    case
      when b.versioning_status::text<>'DISABLED' or o.is_versioned or o.is_delete_marker or o.archived_at is not null
        then 'ambiguous'
      when exists(select 1 from refs f where f.bucket=o.bucket_id and f.name=o.name) then 'referenced'
      when r.applied_at is null and r.id is not null then 'ambiguous'
      when r.deleted and r.applied_at is not null then 'verified_deleted_listing'
      when o.name=r.old_key and r.applied_at is not null then 'obsolete_rename'
      when r.id is not null then 'ambiguous'
      when o.bucket_id='listing-videos' and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
        then 'possible_unused_upload'
      when o.bucket_id='property-media' and o.name ~ '^properties/[0-9a-f-]{36}(/[a-z0-9-]+)?\.(jpe?g|png|webp|avif)$'
        and (o.owner_id is not null or o.user_metadata ? 'original_filename') then 'possible_unused_upload'
      else 'ambiguous' end as category
  from storage.objects o join storage.buckets b on b.id=o.bucket_id
  left join lateral (
    select x.* from renames x
    where (o.bucket_id='property-media' and o.name in (x.old_key,x.new_key)) or
      (o.bucket_id='listing-videos' and x.deleted and x.applied_at is not null
       and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$' and split_part(o.name,'/',2)=x.property_id::text)
    order by (x.applied_at is null) desc,x.deleted desc,x.applied_at desc limit 1
  ) r on true
  where o.bucket_id in ('property-media','listing-videos')
)
select
  (select jsonb_agg(to_jsonb(t) order by t.bucket,t.category) from (
    select c.bucket,c.category,count(*) objects,coalesce(sum(c.bytes),0) bytes,count(*) filter(where c.bytes is null) unknown_sizes
    from classified c group by 1,2) t) as totals,
  (select jsonb_agg(to_jsonb(c) order by c.category,c.bucket,c.name) from (
    select * from classified where category in ('verified_deleted_listing','obsolete_rename') order by category,bucket,name limit 40
  ) c) as reviewed_candidates,
  (select jsonb_agg(to_jsonb(c) order by c.name) from (
    select name,id,version,bytes,split_part(name,'/',2) as path_listing_id from classified
    where bucket='listing-videos' and category='possible_unused_upload' order by name limit 5
  ) c) as uncertain_video_sample;
