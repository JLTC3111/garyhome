begin;

-- Keep the numeric identity, UUID, URLs and related records; remove only padding.
-- Exclude concurrent catalogue writes while the constraint and existing rows change.
lock table public.properties in share row exclusive mode;
do $$
begin
  if exists (
    select 1 from public.properties
    group by regexp_replace(substring(listing_code from 4),'^0+(?=[0-9])','')
    having count(*) > 1
  ) then
    raise exception 'Listing IDs contain duplicate numbers. Resolve them before shortening IDs.';
  end if;
end $$;

alter table public.properties drop constraint properties_listing_code_check;

create or replace function private.assign_listing_code() returns trigger language plpgsql set search_path='' as $$
declare raw_code text; digits text; generated text;
begin
  if current_user in ('anon','authenticated') and not coalesce(private.is_editor(),false) then
    raise exception 'Staff access is required to assign listing IDs.' using errcode='42501';
  end if;
  if tg_op='UPDATE' and new.listing_code is not distinct from old.listing_code then return new; end if;
  -- Retain atomic allocation and collision checks for custom and automatic IDs.
  perform pg_catalog.pg_advisory_xact_lock(1734439538, 1818848868);
  raw_code := upper(translate(btrim(coalesce(new.listing_code,'')), '‐‑‒–—―−', '-------'));
  if raw_code='' then
    if tg_op='UPDATE' then raise exception 'Enter a listing ID for this property.' using errcode='23514'; end if;
    loop
      digits := nextval('public.property_listing_code_seq')::text;
      generated := 'GH-'||lpad(digits,greatest(2,length(digits)),'0');
      exit when not exists(select 1 from public.properties p where p.listing_code=generated);
    end loop;
    new.listing_code := generated;
  else
    if raw_code !~ '^(GH[[:space:]-]*)?[0-9]{1,12}$' then
      raise exception 'Use a listing ID such as GH-05, with up to 12 digits.' using errcode='23514';
    end if;
    digits := regexp_replace(regexp_replace(raw_code,'^GH[[:space:]-]*',''),'^0+(?=[0-9])','');
    new.listing_code := 'GH-'||lpad(digits,greatest(2,length(digits)),'0');
  end if;
  if exists(select 1 from public.properties p where p.listing_code=new.listing_code and p.id<>new.id) then
    raise exception 'That listing ID is already in use. Choose another ID.' using errcode='23505',constraint='properties_listing_code_key';
  end if;
  return new;
end $$;
revoke all on function private.assign_listing_code() from public,anon,authenticated;

update public.properties
set listing_code='GH-'||lpad(digits,greatest(2,length(digits)),'0')
from (
  select id,regexp_replace(substring(listing_code from 4),'^0+(?=[0-9])','') as digits
  from public.properties
) as codes
where public.properties.id=codes.id
  and public.properties.listing_code is distinct from 'GH-'||lpad(digits,greatest(2,length(digits)),'0');

alter table public.properties add constraint properties_listing_code_check
  check (listing_code ~ '^GH-([0-9]{2}|[1-9][0-9]{2,})$');

-- Refresh the built-in help example without replacing staff-authored guide text.
update public.portal_guides
set body_en=replace(body_en,'GH-000005','GH-05'),body_vi=replace(body_vi,'GH-000005','GH-05')
where body_en like '%GH-000005%' or body_vi like '%GH-000005%';

notify pgrst, 'reload schema';
commit;
