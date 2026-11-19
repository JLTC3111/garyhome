-- Review before applying. Requires 20261119054408_property_photo_storage_rename.
begin;

-- The default protects every existing operation from automatic removal,
-- including historical reservations resumed by a newer client.
alter table private.property_photo_renames
  add column auto_cleanup_requested boolean not null default false;

create function public.home_photo_rename_resume(p_property uuid,p_origin text,p_old_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
  declare job private.property_photo_renames;
begin
  perform private.require_home_photo_admin();
  select * into job from private.property_photo_renames
    where property_id=p_property and origin=p_origin and old_key=p_old_key;
  return case when found then to_jsonb(job) else null end;
end;$$;

create function public.home_photo_rename_reserve_v2(
  p_property uuid,p_origin text,p_old_key text,p_name text,p_version timestamptz,p_cleanup_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
  declare existing boolean; job jsonb;
begin
  perform private.require_home_photo_admin();
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select exists(select 1 from private.property_photo_renames where origin=p_origin and old_key=p_old_key) into existing;
  job:=public.home_photo_rename_reserve(p_property,p_origin,p_old_key,p_name,p_version);
  if not existing and p_cleanup_confirmed is true then
    update private.property_photo_renames r set auto_cleanup_requested=true
      where r.id=(job->>'id')::uuid returning to_jsonb(r) into job;
  end if;
  return job;
end;$$;

create or replace function public.home_photo_rename_history(p_property uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_admin();
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select id,old_key,new_key,applied_at,removed_at,auto_cleanup_requested
    from private.property_photo_renames where property_id=p_property order by started_at desc limit 40
  ) r),'[]'::jsonb);
end;$$;

revoke all on function public.home_photo_rename_resume(uuid,text,text),
  public.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean),
  public.home_photo_rename_history(uuid) from public,anon,authenticated;
grant execute on function public.home_photo_rename_resume(uuid,text,text),
  public.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean),
  public.home_photo_rename_history(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
