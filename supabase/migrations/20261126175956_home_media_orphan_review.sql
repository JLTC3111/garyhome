-- A dependency check and an explicit hold never create a removal reservation.
begin;

create table private.home_media_review_holds (
  bucket text not null check(bucket in ('property-media','listing-videos')),
  name text not null,
  actor uuid not null,
  held_at timestamptz not null default now(),
  primary key(bucket,name)
);
alter table private.home_media_review_holds enable row level security;
revoke all on private.home_media_review_holds from public,anon,authenticated,service_role;

create function private.home_media_review_scope(p_bucket text,p_name text) returns text
language sql immutable set search_path='' as $$
  select case when p_bucket='property-media' and p_name like 'properties/listings/%' then split_part(p_name,'/',3)
    when p_bucket='listing-videos' then split_part(p_name,'/',2) end;
$$;

-- Retain the existing full reference checks. A hold applies to any cleanup path.
-- Historical review also protects legacy filenames under a saved listing UUID.
create or replace function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_media_review_holds h where h.bucket=p_bucket and h.name=p_name)
    or (p_include_original_name and exists(select 1 from public.properties p where p.id::text=private.home_media_review_scope(p_bucket,p_name)))
    or exists(select 1 from private.home_listing_media_refs r where r.bucket=p_bucket and r.name=p_name)
    or exists(select 1 from (
      select to_jsonb(p) data from public.properties p
      union all select to_jsonb(e) from public.editorial_articles e
      union all select to_jsonb(n) from public.neighbourhoods n
      union all select to_jsonb(s) from public.site_settings s
      union all select to_jsonb(a) from public.listing_authors a
      union all select to_jsonb(a) from public.site_activities a
      union all select to_jsonb(e) from public.enquiries e
      union all select to_jsonb(n) from public.enquiry_notes n
      union all select to_jsonb(f) from public.feedback_public f
      union all select to_jsonb(f) from public.feedback_submissions f
      union all select to_jsonb(a) from public.property_assistance a
      union all select to_jsonb(a) from public.assistance_reviews a
      union all select to_jsonb(l) from public.landlord_submissions l
      union all select to_jsonb(f) from public.landlord_submission_files f
    ) p cross join lateral jsonb_path_query(p.data,'strict $.** ? (@.type() == "string")') v
    where (v #>> '{}') in (p_name,regexp_replace(p_name,'^.*/',''))
      or (p_include_original_name and lower(btrim(v #>> '{}')) in (lower(regexp_replace(p_name,'^.*/','')),(
        select lower(btrim(o.user_metadata->>'original_filename')) from storage.objects o
        where o.bucket_id=p_bucket and o.name=p_name limit 1)))
      or exists(select 1 from private.home_media_links(v) l where l.bucket=p_bucket and l.name=p_name));
$$;

create function public.home_media_review(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sample jsonb; page jsonb; target storage.objects; reason text;
  media_bucket text:=p_payload->>'bucket'; object_name text:=p_payload->>'key';
  skip integer:=0; needle text:=lower(left(btrim(coalesce(p_payload->>'query','')),120));
begin
  perform private.require_home_photo_owner();
  if p_action='page' then
    if coalesce(p_payload->>'offset','0') !~ '^[0-9]{1,6}$' then
      raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
    skip:=coalesce((p_payload->>'offset')::integer,0);
    select inventory_sample into sample from private.home_media_control where singleton;
    select coalesce(jsonb_agg(jsonb_build_object('bucket',c.bucket,'key',c.name,
      'bytes',case when o.metadata->>'size' ~ '^[0-9]{1,12}$' then (o.metadata->>'size')::bigint end,
      'objectId',o.id,'version',o.version,'etag',btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"'),
      'listingCode',coalesce(c.listing_code,c.listing_id::text),'listingStatus',c.status,'held',h.name is not null,
      'reason',case when o.id is null then 'identity' when h.name is not null then 'owner_hold'
        when c.listing_id is not null then 'listing' when i.id is not null then 'tracked'
        when c.reason not in ('potential','verified') then c.reason
        when c.bucket='listing-videos' then 'video_review' else 'potential' end) order by c.ordinality),'[]'::jsonb)
    into page from (
      select e.value->>'bucket' as bucket,e.value->>'name' as name,e.value->>'reason' as reason,e.ordinality,p.id as listing_id,p.listing_code,p.status
      from jsonb_array_elements(sample->'entries') with ordinality e
      left join public.properties p on p.id::text=private.home_media_review_scope(e.value->>'bucket',e.value->>'name')
      where e.value->>'reason' not in ('reference','scheduled')
        and (needle='' or position(needle in lower(e.value->>'name'))>0 or position(needle in lower(p.listing_code))>0)
        and not exists(select 1 from private.home_media_items q where q.bucket=e.value->>'bucket' and q.name=e.value->>'name'
          and q.state in ('trashed','deleting','removed'))
      order by e.ordinality limit 31 offset skip
    ) c left join storage.objects o on o.bucket_id=c.bucket and o.name=c.name
      left join private.home_media_items i on i.bucket=c.bucket and i.name=c.name
      left join private.home_media_review_holds h on h.bucket=c.bucket and h.name=c.name;
    return jsonb_build_object('items',page-30,'hasMore',jsonb_array_length(page)>30,'available',sample is not null,
      'holds',(select count(*) from private.home_media_review_holds));
  end if;

  if p_action is null or p_action not in ('verify','hold','release','enroll')
    or media_bucket is null or media_bucket not in ('property-media','listing-videos')
    or char_length(coalesce(object_name,'')) not between 1 and 1024 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if p_action='enroll' then
    if media_bucket<>'property-media' then raise exception 'listing_cleanup.video_review' using errcode='PT409'; end if;
    return public.home_media_enroll_historical(p_payload,p_payload->'confirm'='true'::jsonb);
  end if;

  if p_action in ('hold','release') then perform private.lock_home_listing_media_snapshot(); end if;
  select * into target from private.home_media_identity(media_bucket,object_name);
  if not found or target.id::text is distinct from p_payload->>'objectId'
    or target.version is distinct from p_payload->>'version'
    or target.metadata->>'size' is distinct from p_payload->>'bytes'
    or btrim(coalesce(target.metadata->>'eTag',target.metadata->>'etag'),'"') is distinct from p_payload->>'etag' then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;

  if p_action in ('hold','release') then
    if p_payload->'confirm' is distinct from 'true'::jsonb then
      raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
    if exists(select 1 from private.home_media_items i where i.bucket=media_bucket and i.name=object_name
      and (i.state in ('removed','deleting') or i.deletion_started_at is not null)) then
      raise exception 'listing_cleanup.media_busy' using errcode='55P03'; end if;
    if p_action='hold' then
      insert into private.home_media_review_holds(bucket,name,actor) values(media_bucket,object_name,auth.uid()) on conflict do nothing;
    else
      delete from private.home_media_review_holds h where h.bucket=media_bucket and h.name=object_name;
    end if;
    return jsonb_build_object('held',p_action='hold');
  end if;

  reason:=case
    when exists(select 1 from private.home_media_review_holds h where h.bucket=media_bucket and h.name=object_name) then 'owner_hold'
    when exists(select 1 from public.properties p where p.id::text=private.home_media_review_scope(media_bucket,object_name)) then 'listing'
    when exists(select 1 from private.home_media_items i where i.bucket=media_bucket and i.name=object_name) then 'tracked'
    when private.home_media_provider_upload(media_bucket,object_name) then 'upload'
    when media_bucket='listing-videos' then 'video_review'
    when exists(select 1 from private.property_photo_renames r where object_name in(r.old_key,r.new_key)) then 'rename'
    when exists(select 1 from private.home_listing_deletion_media m where m.bucket=media_bucket and m.name=object_name) then 'tracked'
    when not exists(select 1 from private.home_listing_storage_links('/property-media/'||object_name) l where l.name=object_name) then 'identity'
    when private.home_media_referenced(media_bucket,object_name,true) then 'reference'
    else 'evidence_required' end;
  return jsonb_build_object('result',reason);
end;
$$;

revoke all on function private.home_media_review_scope(text,text),public.home_media_review(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.home_media_review(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
