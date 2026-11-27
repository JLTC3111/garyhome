begin;

create function private.home_media_shared_catalogs() returns text[]
language sql immutable set search_path='' as $$
  select array['jobs_cms_entries','jobs_cms_revisions','jobs_cms_media','jobs_public_content',
    'gary_cms_entries','gary_cms_revisions','gary_cms_media','gary_cms_public']::text[];
$$;

create function private.home_media_shared_documents() returns setof jsonb
language plpgsql stable set search_path='' as $$
declare catalog text;
begin
  foreach catalog in array private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      return query execute format('select to_jsonb(t) from public.%I t',catalog);
    end if;
  end loop;
end;
$$;

-- The common removal check covers both scheduled expiry and Owner-initiated removal.
create or replace function private.home_media_content_referenced(p_bucket text,p_name text,p_include_original_name boolean) returns boolean
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
      or exists(select 1 from private.home_media_links(v) l where l.bucket=p_bucket and l.name=p_name))
    or exists(select 1 from private.home_media_shared_documents() d(doc)
      where (strpos(d.doc::text,'/'||p_bucket||'/')>0 and exists(
        select 1 from private.home_media_links(d.doc) l where l.bucket=p_bucket and l.name=p_name))
        or exists(select 1 from jsonb_path_query(d.doc,'strict $.** ? (@.type() == "string")') v
          where (v #>> '{}') in (p_name,regexp_replace(p_name,'^.*/',''))
            or (p_include_original_name and lower(btrim(v #>> '{}')) in (lower(regexp_replace(p_name,'^.*/','')),(
              select lower(btrim(o.user_metadata->>'original_filename')) from storage.objects o
              where o.bucket_id=p_bucket and o.name=p_name limit 1)))));
$$;

create function private.home_media_shared_links(p_doc jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  select * from private.home_media_links(p_doc)
  union
  select 'property-media',v #>> '{}' from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') v
  where (v #>> '{}') like 'properties/%';
$$;

-- Only CMS writes that introduce a Home media link share the removal transaction lock.
create function private.guard_home_media_shared_links() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb; added jsonb;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  select jsonb_agg(to_jsonb(l)) into added from (
    select * from private.home_media_shared_links(to_jsonb(new))
    except select * from private.home_media_shared_links(prior)
  ) l;
  if added is not null then
    perform private.lock_home_listing_media_snapshot();
    if exists(select 1 from jsonb_to_recordset(added) l(bucket text,name text)
      where not private.home_listing_media_upload_allowed(l.bucket,l.name)
      or (l.bucket='property-media' and exists(select 1 from private.property_photo_renames r
        where r.old_key=l.name and r.removal_requested_by is not null))) then
      raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
    end if;
  end if;
  return new;
end;
$$;

do $$
declare catalog text;
begin
  foreach catalog in array private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      execute format('create trigger guard_home_media_shared_links before insert or update on public.%I
        for each row execute function private.guard_home_media_shared_links()',catalog);
    end if;
  end loop;
end;
$$;

create function public.home_media_dashboard(p_action text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report jsonb; rows jsonb; live_count bigint; live_bytes bigint;
begin
  perform private.require_home_photo_owner();
  if p_action='readiness' then return jsonb_build_object('crossAppProtection',true); end if;
  if p_action='trash_page' then
    report:=public.home_media_management(p_action,null,p_offset);
    select coalesce(jsonb_agg(e.value||jsonb_build_object('purge_block',case
      when h.name is not null then 'owner_hold'
      when i.upload_until>now() then 'active_upload'
      when i.retry_after>now() then 'retry_wait'
      when i.attempts>=4 then 'attempt_limit'
      end,'retry_after',i.retry_after) order by e.ordinality),'[]'::jsonb) into rows
      from jsonb_array_elements(report->'items') with ordinality e
      join private.home_media_items i on i.id=(e.value->>'id')::uuid
      left join private.home_media_review_holds h on h.bucket=i.bucket and h.name=i.name;
    return report||jsonb_build_object('items',rows);
  end if;
  if p_action is distinct from 'overview' then raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  report:=public.home_media_management('overview',null,0);
  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end),0)
    into live_count,live_bytes from storage.objects o where o.bucket_id in ('property-media','listing-videos');
  return report||jsonb_build_object('crossAppProtection',true,'objects',live_count,'bytes',live_bytes,
    'inventoryCheckedAt',statement_timestamp(),
    'nextExpiry',(select min(i.expires_at) from private.home_media_items i
      where i.state='trashed' and i.expires_at>now() and i.attempts<4));
end;
$$;

revoke all on function private.home_media_shared_catalogs(),private.home_media_shared_documents(),
  private.home_media_shared_links(jsonb),private.guard_home_media_shared_links(),public.home_media_dashboard(text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_dashboard(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
