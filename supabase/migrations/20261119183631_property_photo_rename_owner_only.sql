-- Keep listing deletion and its cleanup on the existing Admin/Owner guard.
-- Restrict each user-facing photo rename RPC, including the legacy entry points.
begin;

create function private.require_home_photo_owner() returns void
language plpgsql stable set search_path='' as $$
begin
  if private.staff_role() is distinct from 'owner' then
    raise exception 'photo_rename.forbidden' using errcode='42501';
  end if;
  perform private.require_home_photo_admin();
end;
$$;
revoke all on function private.require_home_photo_owner() from public,anon,authenticated,service_role;

alter function public.home_photo_rename_lookup(uuid,text,text,text) set schema private;
alter function public.home_photo_rename_reserve(uuid,text,text,text,timestamptz) set schema private;
alter function public.home_photo_rename_resume(uuid,text,text) set schema private;
alter function public.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean) set schema private;
alter function public.home_photo_rename_apply(uuid,timestamptz) set schema private;
alter function public.home_photo_rename_history(uuid) set schema private;
alter function public.home_photo_rename_request_removal(uuid,boolean) set schema private;

revoke all on function private.home_photo_rename_lookup(uuid,text,text,text),
  private.home_photo_rename_reserve(uuid,text,text,text,timestamptz),
  private.home_photo_rename_resume(uuid,text,text),
  private.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean),
  private.home_photo_rename_apply(uuid,timestamptz),private.home_photo_rename_history(uuid),
  private.home_photo_rename_request_removal(uuid,boolean) from public,anon,authenticated,service_role;

create function public.home_photo_rename_lookup(p_property uuid,p_origin text,p_old_key text,p_name text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_lookup(p_property,p_origin,p_old_key,p_name);
end;
$$;

create function public.home_photo_rename_reserve(p_property uuid,p_origin text,p_old_key text,p_name text,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_reserve(p_property,p_origin,p_old_key,p_name,p_version);
end;
$$;

create function public.home_photo_rename_resume(p_property uuid,p_origin text,p_old_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_resume(p_property,p_origin,p_old_key);
end;
$$;

create function public.home_photo_rename_reserve_v2(
  p_property uuid,p_origin text,p_old_key text,p_name text,p_version timestamptz,p_cleanup_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_reserve_v2(p_property,p_origin,p_old_key,p_name,p_version,p_cleanup_confirmed);
end;
$$;

create function public.home_photo_rename_apply(p_id uuid,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_apply(p_id,p_version);
end;
$$;

create function public.home_photo_rename_history(p_property uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_history(p_property);
end;
$$;

create function public.home_photo_rename_request_removal(p_id uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_photo_rename_request_removal(p_id,p_confirm);
end;
$$;

revoke all on function public.home_photo_rename_lookup(uuid,text,text,text),
  public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),public.home_photo_rename_resume(uuid,text,text),
  public.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),
  public.home_photo_rename_request_removal(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.home_photo_rename_lookup(uuid,text,text,text),
  public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),public.home_photo_rename_resume(uuid,text,text),
  public.home_photo_rename_reserve_v2(uuid,text,text,text,timestamptz,boolean),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),
  public.home_photo_rename_request_removal(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
