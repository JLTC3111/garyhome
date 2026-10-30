begin;

-- Keep the internal UUID and unique index. Only the public-facing code becomes editable.
drop trigger properties_keep_listing_code on public.properties;
drop function private.keep_listing_code();
alter table public.properties alter column listing_code drop default;

create function private.assign_listing_code() returns trigger language plpgsql set search_path='' as $$
declare raw_code text; digits text; generated text;
begin
  if current_user in ('anon','authenticated') and not coalesce(private.is_editor(),false) then
    raise exception 'Staff access is required to assign listing IDs.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.listing_code is not distinct from old.listing_code then return new; end if;
  -- Serialize code assignments so automatic allocation also skips concurrently reserved custom IDs.
  perform pg_catalog.pg_advisory_xact_lock(1734439538, 1818848868);
  raw_code := upper(translate(btrim(coalesce(new.listing_code,'')), '‐‑‒–—―−', '-------'));
  if raw_code='' then
    if tg_op='UPDATE' then raise exception 'Enter a listing ID for this property.' using errcode='23514'; end if;
    loop
      digits := nextval('public.property_listing_code_seq')::text;
      generated := 'GH-'||lpad(digits,greatest(6,length(digits)),'0');
      exit when not exists(select 1 from public.properties p where p.listing_code=generated);
    end loop;
    new.listing_code := generated;
  else
    if raw_code !~ '^(GH[[:space:]-]*)?[0-9]{1,12}$' then
      raise exception 'Use a listing ID such as GH-000123, with up to 12 digits.' using errcode='23514';
    end if;
    digits := regexp_replace(regexp_replace(raw_code,'^GH[[:space:]-]*',''),'^0+(?=[0-9])','');
    new.listing_code := 'GH-'||lpad(digits,greatest(6,length(digits)),'0');
  end if;
  if exists(select 1 from public.properties p where p.listing_code=new.listing_code and p.id<>new.id) then
    raise exception 'That listing ID is already in use. Choose another ID.' using errcode='23505',constraint='properties_listing_code_key';
  end if;
  return new;
end $$;
revoke all on function private.assign_listing_code() from public,anon,authenticated;
create trigger properties_assign_listing_code before insert or update of listing_code on public.properties for each row execute function private.assign_listing_code();

-- Every write advances the server version used by the Studio's conditional update.
create function private.stamp_property_update() returns trigger language plpgsql set search_path='' as $$
begin
  new.updated_at := greatest(pg_catalog.clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
end $$;
revoke all on function private.stamp_property_update() from public,anon,authenticated;
create trigger properties_update_version before update on public.properties for each row execute function private.stamp_property_update();

notify pgrst, 'reload schema';
commit;
