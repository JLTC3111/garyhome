begin;

create table private.home_media_bulk_authorizations (
  id uuid primary key,
  actor uuid not null,
  authorized_at timestamptz not null default clock_timestamp(),
  manifest_sha256 text not null,
  gh56_sha256 text not null,
  initial_egress_budget bigint not null check(initial_egress_budget>=0),
  members jsonb not null,
  gh56_prior_decision text not null default 'Owner reported these two audited test uploads intentionally deleted'
);
alter table private.home_media_bulk_authorizations enable row level security;
revoke all on private.home_media_bulk_authorizations from public,anon,authenticated,service_role;

create function public.home_media_authorize_bulk(p_id uuid,p_manifest text,p_gh56_manifest text,p_budget bigint,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare expected constant text:='0e2a7f77be12267d0e463d8cbc0ede1dfb89200c4fc61755740e0b09d830b8bf';
  expected_gh56 constant text:='9e4754cb4843fa03190c3a968ad03d1f1f4f4a5d4a64135c2ac6c273ba0dafd2';
  actor_id uuid:=auth.uid(); approval private.home_media_bulk_authorizations; member_map jsonb;
  report jsonb;
begin
  perform private.require_home_photo_owner();
  if actor_id is null or p_id is null or p_budget is null or p_budget<0 or p_confirm is null
    or octet_length(p_manifest) is distinct from 70656 or octet_length(p_gh56_manifest) is distinct from 423
    or encode(sha256(convert_to(p_manifest,'UTF8')),'hex') is distinct from expected
    or encode(sha256(convert_to(p_gh56_manifest,'UTF8')),'hex') is distinct from expected_gh56 then
    raise exception 'listing_cleanup.invalid_bulk_manifest' using errcode='22023'; end if;
  report:=jsonb_build_object('actorId',actor_id,'manifestSha256',expected,'gh56Sha256',expected_gh56,
    'files',499,'bytes',355051170,'excluded',118,'gh56Files',2,'gh56Bytes',43725,'initialBudget',p_budget);
  if not p_confirm then return report; end if;
  select * into approval from private.home_media_bulk_authorizations where id=p_id;
  if not found then
    select jsonb_object_agg(v->>0,jsonb_build_array(scope,v->>1,(v->>2)::bigint,v->>3)) into member_map from (
      select 'historical'::text as scope,value as v from jsonb_array_elements(p_manifest::jsonb)
      union all select 'GH-56',value from jsonb_array_elements(p_gh56_manifest::jsonb)
    ) members;
    insert into private.home_media_bulk_authorizations(id,actor,manifest_sha256,gh56_sha256,initial_egress_budget,members)
      values(p_id,actor_id,expected,expected_gh56,p_budget,member_map) on conflict(id) do nothing;
    select * into approval from private.home_media_bulk_authorizations where id=p_id;
  end if;
  if approval.actor is distinct from actor_id or approval.manifest_sha256 is distinct from expected
    or approval.gh56_sha256 is distinct from expected_gh56 or approval.initial_egress_budget is distinct from p_budget then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  return report||jsonb_build_object('id',approval.id,'authorizedAt',approval.authorized_at,
    'reference','owner-bulk-authorization:'||approval.id::text);
end;
$$;

-- Preserve exact/encoded references, filename aliases and Owner holds for every intake path.
create function private.home_media_content_referenced(p_bucket text,p_name text,p_include_original_name boolean) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_media_review_holds h where h.bucket=p_bucket and h.name=p_name)
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

-- One-time GH-56 case, bound to the original draft snapshot and both audited Storage identities.
create function private.home_media_gh56_identity(p_name text,p_id uuid,p_version text,p_bytes bigint,p_etag text) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.properties p
    where p.id='198b8547-8614-4a8e-b125-7e6d9846df57' and p.listing_code='GH-56' and p.status='draft'
      and p.updated_at='2026-11-26T05:45:17.517353+00'::timestamptz and coalesce(cardinality(p.images),0)=0)
    and exists(select 1 from (values
      ('37e55a65-d019-447b-bb88-99c03a0bca07/jobs-staff-portal-header.webp',
       '5cdcb39e-b324-418b-a447-71886cac26f2'::uuid,'8e02bfef-0ea4-4b4f-ab34-510a0289f39a',7704,'12c8bd03f06507b71526120002e96df9-1'),
      ('fd2c8e2f-4e52-4df3-aa4a-610c946830b2/manual-cleanup-fronend-1.jpg',
       '16a878a9-f1b2-4c9b-a4cd-966e4c2e82ea'::uuid,'6adbf40f-494e-490c-b553-1967119cca30',36021,'5d67a55b687a2c33fdf29adff2506821-1')
    ) a(suffix,id,version,bytes,etag)
    where p_name='properties/listings/198b8547-8614-4a8e-b125-7e6d9846df57/'||a.suffix
      and p_id=a.id and p_version=a.version and p_bytes=a.bytes and p_etag=a.etag);
$$;

create function private.home_media_gh56_pending(p_name text) returns boolean
language sql stable set search_path='' as $$
  select private.home_media_provider_upload('property-media',p_name)
    or exists(select 1 from private.property_photo_renames r where p_name in(r.old_key,r.new_key))
    or exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=p_name)
    or not exists(select 1 from private.home_listing_storage_links('/property-media/'||p_name) l where l.name=p_name);
$$;

create or replace function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false) returns boolean
language sql stable set search_path='' as $$
  select (p_include_original_name and (exists(select 1 from public.properties p
      where p.id::text=private.home_media_review_scope(p_bucket,p_name))
    or (p_bucket='property-media' and exists(select 1 from private.home_media_items i
      where i.bucket=p_bucket and i.name=p_name and i.source='historical' and i.historical_review->>'scope'='GH-56')))
    and not (p_bucket='property-media' and exists(select 1 from private.home_media_items i
      join storage.objects o on o.bucket_id=i.bucket and o.name=i.name and o.id=i.object_id and o.version=i.object_version
      where i.bucket=p_bucket and i.name=p_name and i.source='historical' and i.state in ('trashed','deleting')
        and i.source_id='198b8547-8614-4a8e-b125-7e6d9846df57' and i.historical_review->>'scope'='GH-56'
        and o.metadata->>'size'=i.bytes::text
        and btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag'
        and private.home_media_gh56_identity(i.name,i.object_id,i.object_version,i.bytes,i.historical_review->>'etag')
        and not private.home_media_gh56_pending(i.name))))
    or private.home_media_content_referenced(p_bucket,p_name,p_include_original_name);
$$;

-- Exact-key readback survives worker settlement, which clears the active object identity.
-- Ordinary enrollment still uses the existing historical intake and its guards.
create function public.home_media_historical_intake(p_action text,p_review jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare object_name text:=p_review->>'key'; object_id uuid; object_version text:=p_review->>'version';
  object_bytes bigint; object_etag text; object_mime text;
  scope text:=coalesce(p_review->>'scope','historical'); evidence text;
  bulk_approval private.home_media_bulk_authorizations; authorization_id uuid;
  proof jsonb; reviewed jsonb; result text; item private.home_media_items; target storage.objects;
begin
  perform private.require_home_photo_owner();
  if p_action is null or p_action not in ('inspect','receipt','enroll') or scope not in ('historical','GH-56')
    or coalesce(char_length(object_name),0) not between 1 and 1024
    or coalesce(p_review->>'objectId','') !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    or coalesce(p_review->>'authorizationId','') !~ '^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$'
    or coalesce(char_length(object_version),0) not between 1 and 100
    or coalesce(p_review->>'bytes','') !~ '^[1-9][0-9]{0,11}$' then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  object_id:=(p_review->>'objectId')::uuid;
  object_bytes:=(p_review->>'bytes')::bigint;
  authorization_id:=(p_review->>'authorizationId')::uuid;
  select * into bulk_approval from private.home_media_bulk_authorizations a where a.id=authorization_id and a.actor=auth.uid();
  if not found then raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if bulk_approval.members->(object_id::text) is distinct from jsonb_build_array(scope,object_version,object_bytes,object_name) then
    return jsonb_build_object('status','outside_authorized_manifest'); end if;
  evidence:='owner-bulk-authorization:'||bulk_approval.id::text;
  p_review:=p_review||jsonb_build_object('evidenceRef',evidence);
  if p_action in ('enroll','receipt') then
    if coalesce(p_review->>'backupSha256','') !~ '^[a-f0-9]{64}$'
      or coalesce(char_length(p_review->>'etag'),0) not between 1 and 200
      or (p_action='enroll' and p_review->'confirm' is distinct from 'true'::jsonb) then
      raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
    proof:=jsonb_build_object('authorizationId',authorization_id,'scope',scope,'objectId',object_id,'version',object_version,'bytes',object_bytes,
      'etag',p_review->>'etag','evidenceRef',evidence,'backupSha256',p_review->>'backupSha256');
  end if;
  if p_action='enroll' then perform private.lock_home_listing_media_snapshot(); end if;
  select * into item from private.home_media_items i where i.bucket='property-media' and i.name=object_name;
  if found then
    if p_action='inspect' or item.source<>'historical' or item.historical_review->'intake' is distinct from proof then
      return jsonb_build_object('status','tracked'); end if;
  elsif p_action='receipt' then return jsonb_build_object('status','missing');
  else
    select * into target from private.home_media_identity('property-media',object_name);
    object_etag:=btrim(coalesce(target.metadata->>'eTag',target.metadata->>'etag'),'"');
    object_mime:=target.metadata->>'mimetype';
    if not found or target.id is distinct from object_id or target.version is distinct from object_version
      or target.metadata->>'size' is distinct from object_bytes::text or not coalesce(object_mime ~ '^image/(jpeg|png|webp|avif)$',false)
      or not coalesce(object_etag ~ '^[a-fA-F0-9]{32}(-[0-9]+)?$',false)
      or (p_action='enroll' and object_etag is distinct from p_review->>'etag') then
      return jsonb_build_object('status','identity'); end if;
    reviewed:=p_review||jsonb_build_object('bucket','property-media','etag',object_etag);
    if scope='GH-56' then
      result:=case when not private.home_media_gh56_identity(object_name,object_id,object_version,object_bytes,object_etag) then 'scope'
        when private.home_media_gh56_pending(object_name) then 'dependency'
        when private.home_media_content_referenced('property-media',object_name,true) then 'reference'
        else 'evidence_required' end;
    elsif p_action='inspect' then
      result:=public.home_media_review('verify',reviewed)->>'result';
    else
      result:='evidence_required'; -- The existing enrollment function checks dependencies under the lock.
    end if;
    if p_action='inspect' or result is distinct from 'evidence_required' then
      return jsonb_build_object('status',result,'etag',object_etag,'mime',object_mime); end if;
    if scope='GH-56' then
      insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at,historical_review)
      values('property-media',object_name,'historical','198b8547-8614-4a8e-b125-7e6d9846df57',object_id,object_version,object_bytes,'trashed',now(),now()+interval '48 hours',
        jsonb_build_object('scope',scope,'evidenceRef',evidence,'backupSha256',p_review->>'backupSha256','etag',object_etag,
          'actor',auth.uid(),'reviewedAt',clock_timestamp(),'intake',proof)) returning * into item;
    else
      reviewed:=public.home_media_enroll_historical(reviewed,true);
      update private.home_media_items i set historical_review=i.historical_review||jsonb_build_object('intake',proof)
        where id=(reviewed->>'id')::uuid returning * into item;
    end if;
  end if;
  return jsonb_build_object('status','receipt','id',item.id,'state',item.state,
    'enrolledAt',item.unreferenced_since,'expiresAt',item.expires_at,'removedAt',item.removed_at,
    'storagePresent',exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name),
    'liveObjectMatches',exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name
      and o.id=object_id and o.version=object_version and o.metadata->>'size'=object_bytes::text
      and btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=p_review->>'etag'));
end;
$$;

revoke all on function private.home_media_content_referenced(text,text,boolean),private.home_media_gh56_identity(text,uuid,text,bigint,text),
  private.home_media_gh56_pending(text),public.home_media_historical_intake(text,jsonb),
  public.home_media_authorize_bulk(uuid,text,text,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.home_media_historical_intake(text,jsonb),
  public.home_media_authorize_bulk(uuid,text,text,bigint,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
