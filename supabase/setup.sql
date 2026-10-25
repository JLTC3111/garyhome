-- Fresh projects only. Existing projects should apply individual migrations.
begin;

-- Membership is managed only by a trusted project owner, never by a visitor.
create schema if not exists private;
grant usage on schema public to anon, authenticated;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor')),
  created_at timestamptz not null default now()
);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;
grant select on public.team_members to authenticated;
create policy members_read_self on public.team_members for select to authenticated
  using (user_id = (select auth.uid()));

-- A private definer lookup avoids recursive membership RLS. It is not exposed
-- as a public RPC and always requires a real authenticated user.
create function private.is_editor() returns boolean language sql stable
security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.team_members m
    where m.user_id = auth.uid() and m.role in ('owner','editor')
  );
$$;
revoke all on function private.is_editor() from public, anon;
grant execute on function private.is_editor() to authenticated;

create table public.neighbourhoods (
  slug text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 1 and 100),
  tagline_en text not null default '', tagline_vi text not null default '',
  description_en text not null default '', description_vi text not null default '',
  image text not null, sort_order integer not null default 0
);
alter table public.neighbourhoods enable row level security;
revoke all on public.neighbourhoods from anon, authenticated;
grant select on public.neighbourhoods to anon, authenticated;
grant insert, update, delete on public.neighbourhoods to authenticated;
create policy areas_read_public on public.neighbourhoods for select to anon, authenticated using (true);
create policy areas_insert_editor on public.neighbourhoods for insert to authenticated with check ((select private.is_editor()));
create policy areas_update_editor on public.neighbourhoods for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy areas_delete_editor on public.neighbourhoods for delete to authenticated using ((select private.is_editor()));

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 180),
  title_en text not null check (char_length(title_en) between 1 and 200),
  title_vi text not null check (char_length(title_vi) between 1 and 200),
  description_en text not null default '' check (char_length(description_en) <= 12000),
  description_vi text not null default '' check (char_length(description_vi) <= 12000),
  district_slug text not null references public.neighbourhoods(slug),
  address text not null check (char_length(address) between 1 and 300),
  price numeric(14,2) check (price >= 0), currency text not null default 'USD' check (currency = 'USD'),
  listing_type text not null default 'rent' check (listing_type in ('rent','sale')),
  property_type text not null default 'Apartment' check (property_type in ('Apartment','Studio','House & Villa','Office & Restaurant')),
  bedrooms integer not null default 1 check (bedrooms between 0 and 50),
  bathrooms integer check (bathrooms between 0 and 50), area_sqm numeric(10,2) check (area_sqm > 0),
  amenities text[] not null default '{}', images text[] not null default '{}' check (cardinality(images) <= 40),
  featured boolean not null default false,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  availability text not null default 'on_request' check (availability in ('on_request','available','rented','sold')),
  source_url text check (source_url is null or source_url ~ '^https://'),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint published_has_photos check (status <> 'published' or cardinality(images) > 0)
);
create index properties_district_idx on public.properties(district_slug);
create index properties_catalogue_idx on public.properties(listing_type, district_slug, price) where status = 'published';
create index properties_sort_idx on public.properties(sort_order) where status = 'published';
alter table public.properties enable row level security;
revoke all on public.properties from anon, authenticated;
grant select on public.properties to anon, authenticated;
grant insert, update, delete on public.properties to authenticated;
create policy properties_public_read on public.properties for select to anon, authenticated using (status = 'published');
create policy properties_editor_read on public.properties for select to authenticated using ((select private.is_editor()));
create policy properties_editor_insert on public.properties for insert to authenticated with check ((select private.is_editor()));
create policy properties_editor_update on public.properties for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy properties_editor_delete on public.properties for delete to authenticated using ((select private.is_editor()));

create table public.site_settings (
  id text primary key default 'main' check (id = 'main'),
  hero_title_en text not null check (char_length(hero_title_en) between 1 and 160),
  hero_title_vi text not null check (char_length(hero_title_vi) between 1 and 160),
  hero_text_en text not null check (char_length(hero_text_en) <= 1000),
  hero_text_vi text not null check (char_length(hero_text_vi) <= 1000),
  hero_image text not null, contact_email text not null check (char_length(contact_email) <= 254),
  contact_phone text not null check (char_length(contact_phone) <= 40),
  contact_address text not null check (char_length(contact_address) <= 400)
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update on public.site_settings to authenticated;
create policy settings_public_read on public.site_settings for select to anon, authenticated using (true);
create policy settings_editor_insert on public.site_settings for insert to authenticated with check ((select private.is_editor()));
create policy settings_editor_update on public.site_settings for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));

create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  message text not null check (char_length(btrim(message)) between 10 and 4000),
  preferred_date date, kind text not null default 'general' check (kind in ('viewing','general','landlord')),
  consent boolean not null check (consent = true),
  status text not null default 'new' check (status in ('new','contacted','scheduled','closed')),
  notes text not null default '' check (char_length(notes) <= 8000),
  created_at timestamptz not null default now()
);
create index enquiries_property_idx on public.enquiries(property_id);
create index enquiries_inbox_idx on public.enquiries(status, created_at desc);
alter table public.enquiries enable row level security;
revoke all on public.enquiries from anon, authenticated;
-- Visitors can submit only these fields, and cannot choose id/status/notes/time.
grant insert (property_id,name,email,phone,message,preferred_date,kind,consent) on public.enquiries to anon, authenticated;
grant select, delete on public.enquiries to authenticated;
grant update (status,notes) on public.enquiries to authenticated;
create policy enquiries_submit on public.enquiries for insert to anon, authenticated with check (
  consent = true and status = 'new' and notes = '' and
  (preferred_date is null or preferred_date >= current_date) and
  (property_id is null or exists (select 1 from public.properties p where p.id = property_id and p.status = 'published'))
);
create policy enquiries_editor_read on public.enquiries for select to authenticated using ((select private.is_editor()));
create policy enquiries_editor_update on public.enquiries for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy enquiries_editor_delete on public.enquiries for delete to authenticated using ((select private.is_editor()));

-- Publicly viewable images; uploads and mutations require a team membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('property-media','property-media',true,8388608,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy property_media_read on storage.objects for select to anon, authenticated using (bucket_id = 'property-media');
create policy property_media_editor_insert on storage.objects for insert to authenticated with check (bucket_id = 'property-media' and (select private.is_editor()));
create policy property_media_editor_update on storage.objects for update to authenticated using (bucket_id = 'property-media' and (select private.is_editor())) with check (bucket_id = 'property-media' and (select private.is_editor()));
create policy property_media_editor_delete on storage.objects for delete to authenticated using (bucket_id = 'property-media' and (select private.is_editor()));

commit;

begin;

-- Customer identity is always auth.uid(), never a supplied email or metadata role.
create table public.customer_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  preferred_district text references public.neighbourhoods(slug) on delete set null,
  budget_min numeric(14,2) check (budget_min >= 0),
  budget_max numeric(14,2) check (budget_max >= 0),
  move_in_date date,
  preferences text not null default '' check (char_length(preferences) <= 2000),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index customer_profiles_district_idx on public.customer_profiles(preferred_district);
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon, authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
create policy profiles_read on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_editor()));
create policy profiles_insert_self on public.customer_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy profiles_update_self on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.saved_homes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);
create index saved_homes_property_idx on public.saved_homes(property_id);
alter table public.saved_homes enable row level security;
revoke all on public.saved_homes from anon, authenticated;
grant select, insert, delete on public.saved_homes to authenticated;
create policy saved_read_self on public.saved_homes for select to authenticated using (user_id = (select auth.uid()));
create policy saved_insert_self on public.saved_homes for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.properties p where p.id = property_id and p.status = 'published'
  )
);
create policy saved_delete_self on public.saved_homes for delete to authenticated using (user_id = (select auth.uid()));

-- Staff-only CRM records. No customer-facing query can read staff notes.
create table public.customer_records (
  customer_key text primary key check (char_length(customer_key) between 5 and 300),
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  stage text not null default 'new' check (stage in ('new','contacted','viewing','tenant','closed')),
  follow_up_on date,
  notes text not null default '' check (char_length(notes) <= 8000),
  updated_at timestamptz not null default now()
);
create index customer_records_user_idx on public.customer_records(user_id);
create index customer_records_followup_idx on public.customer_records(follow_up_on) where stage <> 'closed';
alter table public.customer_records enable row level security;
revoke all on public.customer_records from anon, authenticated;
grant select, insert, update on public.customer_records to authenticated;
create policy crm_read_staff on public.customer_records for select to authenticated using ((select private.is_editor()));
create policy crm_insert_staff on public.customer_records for insert to authenticated with check ((select private.is_editor()));
create policy crm_update_staff on public.customer_records for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));

alter table public.enquiries add column user_id uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.enquiries add column appointment_at timestamptz;
alter table public.enquiries add column customer_update text not null default '' check (char_length(customer_update) <= 2000);
alter table public.enquiries add column cancelled_at timestamptz;
create index enquiries_customer_idx on public.enquiries(user_id, created_at desc) where user_id is not null;

-- Preserve legacy notes, then remove client access to that column. Explicit
-- column grants are essential: row policies alone cannot hide internal notes.
create table public.enquiry_notes (
  enquiry_id uuid primary key references public.enquiries(id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 8000)
);
insert into public.enquiry_notes(enquiry_id, notes) select id, notes from public.enquiries where notes <> '';
alter table public.enquiry_notes enable row level security;
revoke all on public.enquiry_notes from anon, authenticated;
grant select, insert, update on public.enquiry_notes to authenticated;
create policy enquiry_notes_read_staff on public.enquiry_notes for select to authenticated using ((select private.is_editor()));
create policy enquiry_notes_insert_staff on public.enquiry_notes for insert to authenticated with check ((select private.is_editor()));
create policy enquiry_notes_update_staff on public.enquiry_notes for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));

revoke select on public.enquiries from authenticated;
grant select (id,property_id,name,email,phone,message,preferred_date,kind,consent,status,created_at,user_id,appointment_at,customer_update,cancelled_at) on public.enquiries to authenticated;
revoke update (notes) on public.enquiries from authenticated;
grant update (appointment_at,customer_update,cancelled_at) on public.enquiries to authenticated;
create policy enquiries_read_self on public.enquiries for select to authenticated using (user_id = (select auth.uid()));

-- Anonymous submissions remain unclaimed. Signing up with the same email does
-- not grant access to someone else's historical messages.
drop policy enquiries_submit on public.enquiries;
create policy enquiries_submit on public.enquiries for insert to anon, authenticated with check (
  consent = true and status = 'new' and notes = '' and appointment_at is null and customer_update = '' and cancelled_at is null and
  (user_id is null or user_id = (select auth.uid())) and
  (preferred_date is null or preferred_date >= current_date) and
  (property_id is null or exists (select 1 from public.properties p where p.id = property_id and p.status = 'published'))
);
create policy enquiries_cancel_self on public.enquiries for update to authenticated
  using (user_id = (select auth.uid()) and kind = 'viewing' and status <> 'closed' and cancelled_at is null)
  with check (user_id = (select auth.uid()) and kind = 'viewing' and cancelled_at is not null);

-- Customers may only cancel. The trigger prevents using the cancellation RLS
-- policy to change staff-controlled status, confirmation time, or reply fields.
create function private.guard_customer_enquiry_update() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if private.is_editor() then return new; end if;
  if auth.uid() is null or old.user_id is distinct from auth.uid()
     or old.kind <> 'viewing' or old.status = 'closed' or old.cancelled_at is not null
     or new.cancelled_at is null
     or (to_jsonb(new) - 'cancelled_at') is distinct from (to_jsonb(old) - 'cancelled_at') then
    raise exception 'Customers may only cancel their own active viewing requests.' using errcode = '42501';
  end if;
  new.cancelled_at := now();
  return new;
end;
$$;
revoke all on function private.guard_customer_enquiry_update() from public, anon, authenticated;
create trigger guard_customer_enquiry_update before update on public.enquiries
  for each row execute function private.guard_customer_enquiry_update();

-- One transaction for staff status, the customer-visible update and private notes.
-- Invoker security preserves RLS and never elevates a caller's privileges.
create function public.save_customer_enquiry(
  enquiry_id uuid, new_status text, internal_notes text,
  scheduled_at timestamptz, public_update text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare saved_id uuid;
begin
  if not private.is_editor() then raise exception 'Editor access required.' using errcode = '42501'; end if;
  if new_status = 'scheduled' and scheduled_at is null then
    raise exception 'Choose a confirmed viewing time before scheduling.' using errcode = '23514';
  end if;
  update public.enquiries set status = new_status, appointment_at = scheduled_at, customer_update = public_update
    where id = enquiry_id returning id into saved_id;
  if saved_id is null then raise exception 'Enquiry not found.' using errcode = 'P0002'; end if;
  insert into public.enquiry_notes(enquiry_id, notes) values (saved_id, internal_notes)
    on conflict on constraint enquiry_notes_pkey do update set notes = excluded.notes;
  return saved_id;
end;
$$;
revoke all on function public.save_customer_enquiry(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.save_customer_enquiry(uuid,text,text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
commit;

begin;

create function private.valid_staff_domains(domains text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(cardinality(domains) between 1 and 10 and not exists (
    select 1 from unnest(domains) as entry(domain)
    where domain is null or domain <> lower(btrim(domain))
      or domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'
  ), false);
$$;
revoke all on function private.valid_staff_domains(text[]) from public,anon,authenticated;

create table public.staff_settings (
  id text primary key default 'main' check (id = 'main'),
  email_domains text[] not null check (private.valid_staff_domains(email_domains))
);
alter table public.staff_settings enable row level security;
revoke all on public.staff_settings from public, anon, authenticated;
grant select on public.staff_settings to anon, authenticated;
create policy staff_domain_public on public.staff_settings for select to anon, authenticated using (true);
insert into public.staff_settings(id,email_domains) values ('main',array['garyhome.com','icue.vn']);

alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check (role in ('owner','admin','editor'));
alter table public.team_members add column email text;
alter table public.team_members add column display_name text not null default '' check (char_length(display_name) <= 120);
alter table public.team_members add column active boolean not null default true;
alter table public.team_members add column bootstrap_owner boolean not null default false;
alter table public.team_members add column assigned_by uuid references auth.users(id) on delete set null;
alter table public.team_members add column updated_at timestamptz not null default now();
update public.team_members m set email = lower(u.email), bootstrap_owner = m.role = 'owner'
  from auth.users u where u.id = m.user_id;
create unique index team_members_email_idx on public.team_members(email) where email is not null;

-- Authorization reads the current verified Auth email and a server-assigned
-- membership. Changing an email, disabling a member, or changing the company
-- domain takes effect in RLS even while an old access token is still valid.
-- Existing owners are preserved so migration cannot strand the project owner.
create function private.staff_role() returns text language sql stable
security definer set search_path = '' as $$
  select m.role from public.team_members m
  join auth.users u on u.id = m.user_id
  join public.staff_settings s on s.id = 'main'
  where auth.uid() is not null and m.user_id = auth.uid() and m.active
    and u.email_confirmed_at is not null and m.email = lower(u.email)
    and ((m.role = 'owner' and m.bootstrap_owner) or split_part(m.email,'@',2) = any(s.email_domains));
$$;
revoke all on function private.staff_role() from public, anon;
grant execute on function private.staff_role() to authenticated;

create or replace function private.is_editor() returns boolean language sql stable
security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','editor'), false);
$$;

drop policy members_read_self on public.team_members;
create policy members_read_self on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) and (select private.staff_role()) is not null);

-- Privileged functions stay in the non-exposed schema. Public RPC wrappers
-- are invokers; every privileged entry point independently checks auth.uid().
create function private.find_staff_account(target_email text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; target_role text; company_domains text[];
begin
  actor_role := private.staff_role();
  if auth.uid() is null or actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  if assigned_role is null or assigned_role not in ('admin','editor') or (actor_role = 'admin' and assigned_role <> 'editor') then
    raise exception 'Only the owner can assign administrator access.' using errcode = '42501';
  end if;
  select email_domains into company_domains from public.staff_settings where id = 'main';
  if target_email is null or char_length(target_email) > 254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or not coalesce(split_part(lower(btrim(target_email)),'@',2) = any(company_domains), false) then
    raise exception 'Use an email address at the company domain.' using errcode = '23514';
  end if;
  select id into target_id from auth.users where lower(email) = lower(btrim(target_email));
  select role into target_role from public.team_members where user_id = target_id;
  if target_id = auth.uid() or target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'You cannot change your own access or a protected account.' using errcode = '42501';
  end if;
  return target_id;
end;
$$;

create function private.assign_staff_account(target_email text, full_name text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(target_email)),0));
  target_id := private.find_staff_account(target_email, assigned_role);
  if target_id is null then raise exception 'Create the Auth account before assigning staff access.' using errcode = 'P0002'; end if;
  if full_name is null or char_length(btrim(full_name)) not between 2 and 120 then
    raise exception 'Enter the staff member''s name.' using errcode = '23514';
  end if;
  insert into public.team_members(user_id,email,display_name,role,active,assigned_by)
  values (target_id,lower(btrim(target_email)),btrim(full_name),assigned_role,true,auth.uid())
  on conflict (user_id) do update set email = excluded.email, display_name = excluded.display_name,
    role = excluded.role, active = true, assigned_by = auth.uid(), updated_at = now();
  return target_id;
end;
$$;

create function private.set_staff_access(target_user_id uuid, assigned_role text, enabled boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare member public.team_members; checked_id uuid;
begin
  if auth.uid() is null or coalesce(private.staff_role(),'') not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  select * into member from public.team_members where user_id = target_user_id;
  if member.user_id is null then raise exception 'Staff account not found.' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.email,0));
  checked_id := private.find_staff_account(member.email, assigned_role);
  if checked_id is distinct from target_user_id or enabled is null then
    raise exception 'The company email changed. Assign the account again.' using errcode = '23514';
  end if;
  update public.team_members set role = assigned_role, active = enabled, assigned_by = auth.uid(), updated_at = now()
    where user_id = target_user_id;
  return target_user_id;
end;
$$;

create function private.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(private.staff_role(),'') not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  return query select m.user_id,m.email,m.display_name,m.role,m.active,u.email_confirmed_at is not null,m.created_at,m.updated_at
    from public.team_members m join auth.users u on u.id = m.user_id
    where m.email is not null and (after_email is null or m.email > after_email)
    order by m.email limit 51;
end;
$$;

create function public.find_staff_account(target_email text, assigned_role text) returns uuid
language sql security invoker set search_path = '' as $$ select private.find_staff_account(target_email,assigned_role); $$;
create function public.assign_staff_account(target_email text, full_name text, assigned_role text) returns uuid
language sql security invoker set search_path = '' as $$ select private.assign_staff_account(target_email,full_name,assigned_role); $$;
create function public.set_staff_access(target_user_id uuid, assigned_role text, enabled boolean) returns uuid
language sql security invoker set search_path = '' as $$ select private.set_staff_access(target_user_id,assigned_role,enabled); $$;
create function public.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from private.list_staff_accounts(after_email); $$;

revoke all on function private.find_staff_account(text,text),private.assign_staff_account(text,text,text),
  private.set_staff_access(uuid,text,boolean),private.list_staff_accounts(text),
  public.find_staff_account(text,text),public.assign_staff_account(text,text,text),
  public.set_staff_access(uuid,text,boolean),public.list_staff_accounts(text) from public,anon;
grant execute on function private.find_staff_account(text,text),private.assign_staff_account(text,text,text),
  private.set_staff_access(uuid,text,boolean),private.list_staff_accounts(text),
  public.find_staff_account(text,text),public.assign_staff_account(text,text,text),
  public.set_staff_access(uuid,text,boolean),public.list_staff_accounts(text) to authenticated;

commit;

begin;

create table public.listing_authors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  bio_en text not null default '' check (char_length(bio_en)<=2000),
  bio_vi text not null default '' check (char_length(bio_vi)<=2000),
  portrait_url text not null default '' check (portrait_url='' or portrait_url ~ '^(/images/|https://)'),
  phone text not null default '' check (char_length(phone)<=40),
  whatsapp_phone text not null default '' check (whatsapp_phone='' or whatsapp_phone ~ '^\+?[0-9]{8,15}$'),
  zalo_phone text not null default '' check (zalo_phone='' or zalo_phone ~ '^\+?[0-9]{8,15}$'),
  email text not null default '' check (email='' or (char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  is_placeholder boolean not null default true,
  published boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.listing_authors enable row level security;
revoke all on public.listing_authors from anon, authenticated;
grant select on public.listing_authors to anon, authenticated;
grant insert,update,delete on public.listing_authors to authenticated;
create policy authors_public on public.listing_authors for select to anon using (published);
create policy authors_authenticated on public.listing_authors for select to authenticated using (published or (select private.is_editor()));
create policy authors_staff_insert on public.listing_authors for insert to authenticated with check ((select private.is_editor()));
create policy authors_staff_update on public.listing_authors for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy authors_staff_delete on public.listing_authors for delete to authenticated using ((select private.is_editor()));

create table public.site_activities (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('customers','feedback','team')),
  media_kind text not null default 'photo' check (media_kind in ('photo','screenshot')),
  caption_en text not null default '' check (char_length(caption_en)<=500),
  caption_vi text not null default '' check (char_length(caption_vi)<=500),
  image_url text not null check (image_url ~ '^(/images/|https://)'),
  source_url text not null default '' check (source_url='' or source_url ~ '^https://'),
  published boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.site_activities enable row level security;
revoke all on public.site_activities from anon,authenticated;
grant select on public.site_activities to anon,authenticated;
grant insert,update,delete on public.site_activities to authenticated;
create policy activities_public on public.site_activities for select to anon using (published);
create policy activities_authenticated on public.site_activities for select to authenticated using (published or (select private.is_editor()));
create policy activities_staff_insert on public.site_activities for insert to authenticated with check ((select private.is_editor()));
create policy activities_staff_update on public.site_activities for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy activities_staff_delete on public.site_activities for delete to authenticated using ((select private.is_editor()));
create index activities_category_sort_idx on public.site_activities(category,sort_order) where published;

create sequence public.property_listing_code_seq;
alter table public.properties add column listing_code text;
with numbered as (
  select id, row_number() over(order by created_at,sort_order,id) as num from public.properties
) update public.properties p set listing_code='GH-'||lpad(n.num::text,6,'0') from numbered n where p.id=n.id;
select setval('public.property_listing_code_seq',greatest((select count(*) from public.properties),1), exists(select 1 from public.properties));
alter table public.properties alter column listing_code set default ('GH-'||lpad(nextval('public.property_listing_code_seq')::text,6,'0'));
alter table public.properties alter column listing_code set not null;
alter table public.properties add constraint properties_listing_code_key unique(listing_code);
alter table public.properties add constraint properties_listing_code_check check (listing_code ~ '^GH-[0-9]{6,}$');
grant usage on sequence public.property_listing_code_seq to authenticated;
create function private.keep_listing_code() returns trigger language plpgsql set search_path='' as $$
begin
  if new.listing_code is distinct from old.listing_code then raise exception 'Property IDs cannot be changed'; end if;
  return new;
end; $$;
revoke all on function private.keep_listing_code() from public,anon,authenticated;
create trigger properties_keep_listing_code before update on public.properties for each row execute function private.keep_listing_code();

alter table public.properties
  add column author_id uuid references public.listing_authors(id) on delete set null,
  add column price_period text not null default 'month' check (price_period in ('month','week','night')),
  add column rental_term text not null default 'on_request' check (rental_term in ('short','long','both','on_request')),
  add column overview_en text not null default '' check (char_length(overview_en)<=12000),
  add column overview_vi text not null default '' check (char_length(overview_vi)<=12000),
  add column location_en text not null default '' check (char_length(location_en)<=8000),
  add column location_vi text not null default '' check (char_length(location_vi)<=8000),
  add column furnishings_en text not null default '' check (char_length(furnishings_en)<=8000),
  add column furnishings_vi text not null default '' check (char_length(furnishings_vi)<=8000),
  add column seo_features text[] not null default '{}' check (cardinality(seo_features)<=4);
update public.properties set overview_en=description_en,overview_vi=description_vi;
create index properties_author_idx on public.properties(author_id);
alter table public.properties drop constraint properties_property_type_check;
alter table public.properties add constraint properties_property_type_check check (property_type in ('Apartment','Studio','House & Villa','Villa/Duplex','Office & Restaurant','Vinhomes'));
alter policy properties_public_read on public.properties using (status='published' and listing_type='rent' and availability in ('available','on_request'));
create index properties_rental_filters_idx on public.properties(district_slug,property_type,price,bedrooms,bathrooms) where status='published' and listing_type='rent' and availability in ('available','on_request');

alter table public.site_settings
  add column whatsapp_phone text not null default '' check (whatsapp_phone='' or whatsapp_phone ~ '^\+?[0-9]{8,15}$'),
  add column zalo_phone text not null default '' check (zalo_phone='' or zalo_phone ~ '^\+?[0-9]{8,15}$');
insert into public.site_settings(id,hero_title_en,hero_title_vi,hero_text_en,hero_text_vi,hero_image,contact_email,contact_phone,contact_address)
values('main','SERVICED APARTMENTS IN HANOI FOR RENT | GARY HOME','CĂN HỘ DỊCH VỤ CHO THUÊ TẠI HÀ NỘI | GARY HOME','','','/images/hero.jpg','info@garyhome.vn','+84 356 175 046','Eurowindow Tower, 27 Trần Duy Hưng, Cầu Giấy, Hà Nội, Vietnam')
on conflict(id) do nothing;
update public.site_settings set
  hero_title_en='SERVICED APARTMENTS IN HANOI FOR RENT | GARY HOME',
  hero_title_vi='CĂN HỘ DỊCH VỤ CHO THUÊ TẠI HÀ NỘI | GARY HOME',
  hero_text_en='Explore apartments, villas, offices and Vinhomes rentals. Compare real property details and arrange a viewing with Gary Home.',
  hero_text_vi='Khám phá căn hộ, biệt thự, văn phòng và nhà cho thuê tại Vinhomes. Xem thông tin thực tế và đặt lịch xem nhà cùng Gary Home.',
  whatsapp_phone='+84356175046',zalo_phone='+84356175046'
where id='main';
insert into public.listing_authors(slug,display_name,phone,email,whatsapp_phone,zalo_phone,bio_en,bio_vi,is_placeholder,published)
select 'gary-home-team','Gary Home',contact_phone,contact_email,whatsapp_phone,zalo_phone,
  'Contact Gary Home for your assigned listing specialist. Individual profiles will be added shortly.',
  'Liên hệ Gary Home để được kết nối với chuyên viên phụ trách. Hồ sơ cá nhân sẽ được bổ sung.',true,true
from public.site_settings where id='main';
update public.properties set author_id=(select id from public.listing_authors where slug='gary-home-team') where author_id is null;

create function private.rental_property_defaults() returns trigger language plpgsql set search_path='' as $$
begin
 if new.author_id is null then select id into new.author_id from public.listing_authors where slug='gary-home-team'; end if;
 return new;
end; $$;
revoke all on function private.rental_property_defaults() from public,anon,authenticated;
create trigger properties_rental_defaults before insert on public.properties for each row execute function private.rental_property_defaults();

create table public.rental_cart (
  user_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,property_id)
);
create index rental_cart_property_idx on public.rental_cart(property_id);
alter table public.rental_cart enable row level security;
revoke all on public.rental_cart from anon,authenticated;
grant select,insert,delete on public.rental_cart to authenticated;
create policy rental_cart_read_self on public.rental_cart for select to authenticated using (user_id=(select auth.uid()));
create policy rental_cart_insert_self on public.rental_cart for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.properties p where p.id=property_id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
);
create policy rental_cart_delete_self on public.rental_cart for delete to authenticated using (user_id=(select auth.uid()));

create policy enquiries_rental_only on public.enquiries as restrictive for insert to anon,authenticated with check (
 property_id is null or exists(select 1 from public.properties p where p.id=property_id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
);
create policy saved_rental_only on public.saved_homes as restrictive for insert to authenticated with check (
 exists(select 1 from public.properties p where p.id=property_id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
);

-- Tighten the default event-trigger function without changing its event-trigger role.
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
 end if;
end $$;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order) values
('2636d3f7-a64b-55ed-812e-727ba3783afe','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-1.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z7492597927255_24cea9054d12e6f3fc97a8e7e054e88d-scaled-1.jpg',true,1),
('c09f4dd6-9a06-5c6c-a478-d52c57d478c4','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-2.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z7492597855442_14c4fcb97fd1c8d97e5c160986c39156.jpg',true,2),
('8d865e4d-3a47-513e-86ef-968525a400d3','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-3.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z6422320127186_6a07e56449ed0ecb165edad56a33141a.jpg',true,3),
('f734cadd-3302-5f5c-83a6-5ddbbb72bbb5','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-4.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z6422320132669_33241c0251191f90fe399966364335e5.jpg',true,4),
('3125792e-e8ae-5b83-aa17-81d6830be01c','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-5.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z6422318845001_604fa1aca917a232a8d02361bcb592a0.jpg',true,5),
('78109c4d-5602-57da-9a6b-d59d22b70342','feedback','photo','From Gary Home’s Feedback collection','Từ bộ ảnh Phản hồi của Gary Home','/images/activities/feedback-6.jpg','https://garyhome.vn/wp-content/uploads/2026/06/z6422320121310_a3216eb6ce353db34a1ea562a2042a20.jpg',true,6);
notify pgrst,'reload schema';
commit;

begin;
-- The original source itself states Lào Cai while this import was assigned to
-- Tây Hồ. Keep the record for staff review rather than invent a Hanoi address.
-- Match source identity and conflicting facts, never a generated database ID.
update public.properties set status='draft',updated_at=now()
where slug='beautiful-apartment-with-one-bedroom-peaceful-place'
  and address='Tỉnh Lào Cai, Việt Nam' and district_slug='tay-ho'
  and status='published';
notify pgrst,'reload schema';
commit;

begin;

-- Preserve existing customer selections in their own favourites before retiring the cart.
lock table public.rental_cart in share row exclusive mode;
insert into public.saved_homes(user_id,property_id,created_at)
select c.user_id,c.property_id,c.created_at from public.rental_cart c
join public.properties p on p.id=c.property_id and p.status='published'
  and p.listing_type='rent' and p.availability in ('available','on_request')
on conflict(user_id,property_id) do nothing;
-- Historical records remain stored privately; the app no longer exposes a second shortlist.
revoke all on public.rental_cart from anon,authenticated;

-- Restore the previous introduction in both languages. Preserve the selected photo.
update public.site_settings set
  hero_title_en='Find a place.
Feel at home.',
  hero_title_vi='Tìm một nơi.
Gọi là nhà.',
  hero_text_en='Thoughtfully chosen homes. A team that knows Hanoi. Let’s find the place that feels like you.',
  hero_text_vi='Những ngôi nhà được chọn lọc. Đội ngũ am hiểu Hà Nội. Cùng tìm nơi thuộc về bạn.'
where id='main';
-- The user requested that photographs live under Customers; screenshots stay in Feedback.
update public.site_activities set category='customers',
 caption_en=case when caption_en='From Gary Home’s Feedback collection' then 'Moments with Gary Home' else caption_en end,
 caption_vi=case when caption_vi='Từ bộ ảnh Phản hồi của Gary Home' then 'Khoảnh khắc cùng Gary Home' else caption_vi end,
 updated_at=now()
where category='feedback' and media_kind='photo' and published;
notify pgrst,'reload schema';
commit;

begin;
create temporary table moved_media(old_path text primary key,new_path text not null) on commit drop;
insert into moved_media values
('/images/activities/feedback-1.jpg','/images/activities/activity-1.jpg'),
('/images/activities/feedback-2.jpg','/images/activities/activity-2.jpg'),
('/images/activities/feedback-3.jpg','/images/activities/activity-3.jpg'),
('/images/activities/feedback-4.jpg','/images/activities/activity-4.jpg'),
('/images/activities/feedback-5.jpg','/images/activities/activity-5.jpg'),
('/images/activities/feedback-6.jpg','/images/activities/activity-6.jpg'),
('/images/area-bac-tu-liem.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg'),
('/images/area-long-bien.jpg','/images/apartments/area-long-bien.jpg'),
('/images/area-tay-ho.jpg','/images/apartments/area-tay-ho.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-0.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-1.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-2.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-2.jpg'),
('/images/beautiful-apartment-with-one-bedroom-peaceful-place-3.jpg','/images/apartments/beautiful-apartment-with-one-bedroom-peaceful-place-3.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-0.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-0.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-1.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-1.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-2.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-2.jpg'),
('/images/can-ho-1n-co-ban-cong-buoi-3.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-3.jpg'),
('/images/can-ho-1n-pho-dao-tan-0.jpg','/images/apartments/can-ho-1n-pho-dao-tan-0.jpg'),
('/images/can-ho-1n-pho-dao-tan-1.jpg','/images/apartments/can-ho-1n-pho-dao-tan-1.jpg'),
('/images/can-ho-1n-pho-dao-tan-2.jpg','/images/apartments/can-ho-1n-pho-dao-tan-2.jpg'),
('/images/can-ho-1n-pho-dao-tan-3.jpg','/images/apartments/can-ho-1n-pho-dao-tan-3.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-0.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-0.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-1.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-1.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-2.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-2.jpg'),
('/images/can-ho-1n-tai-290-kim-ma-3.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-0.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-3.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-3.jpg'),
('/images/can-ho-2n-2wc-dao-tan-1.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-1.jpg'),
('/images/can-ho-2n-2wc-dao-tan-2.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-2.jpg'),
('/images/can-ho-2n-doi-can-0.jpg','/images/apartments/can-ho-2n-doi-can-1.jpg'),
('/images/can-ho-2n-doi-can-1.jpg','/images/apartments/can-ho-2n-doi-can-1.jpg'),
('/images/can-ho-2n-doi-can-2.jpg','/images/apartments/can-ho-2n-doi-can-2.jpg'),
('/images/can-ho-2n-doi-can-3.jpg','/images/apartments/can-ho-2n-doi-can-3.jpg'),
('/images/can-ho-2n-gan-ho-0.jpg','/images/apartments/can-ho-2n-gan-ho-1.jpg'),
('/images/can-ho-2n-gan-ho-1.jpg','/images/apartments/can-ho-2n-gan-ho-1.jpg'),
('/images/can-ho-2n-gan-ho-2.jpg','/images/apartments/can-ho-2n-gan-ho-2.jpg'),
('/images/can-ho-2n-gan-ho-3.jpg','/images/apartments/can-ho-2n-gan-ho-3.jpg'),
('/images/can-ho-2n-tai-kim-ma-0.jpg','/images/apartments/can-ho-2n-tai-kim-ma-0.jpg'),
('/images/can-ho-2n-tai-kim-ma-1.jpg','/images/apartments/can-ho-2n-tai-kim-ma-1.jpg'),
('/images/can-ho-2n-tai-kim-ma-2.jpg','/images/apartments/can-ho-2n-tai-kim-ma-2.jpg'),
('/images/can-ho-2n-tai-kim-ma-3.jpg','/images/apartments/can-ho-2n-tai-kim-ma-3.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-1.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-1.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-2.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-2.jpg'),
('/images/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-3.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-3.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-0.jpg','/images/apartments/hero.jpg'),
('/images/hero.jpg','/images/apartments/hero.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-1.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-1.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-2.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-2.jpg'),
('/images/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-3.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-3.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-0.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-0.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-1.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-1.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-2.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-2.jpg'),
('/images/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-3.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-0.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-1.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-1.jpg'),
('/images/can-ho-studio-tai-dao-tan-ba-dinh-2.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-2.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-0.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-2.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-2.jpg'),
('/images/can-ho-studio-tai-thuy-khe-tay-ho-2-3.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-3.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-1.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-1.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-2.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-2.jpg'),
('/images/can-studio-tai-ngoa-long-bac-tu-liem-3.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-3.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-0.jpg','/images/apartments/gary-way.jpg'),
('/images/gary-way.jpg','/images/apartments/gary-way.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-1.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-1.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-2.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-2.jpg'),
('/images/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-3.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-3.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-2.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-2.jpg'),
('/images/lux-apartment-in-dang-thai-ma-tay-ho-3.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-3.jpg'),
('/images/feeback/1.jpg','/images/feedback/1.jpg');
update public.properties p set images=(select array_agg(coalesce(m.new_path,v.url) order by v.position) from unnest(p.images) with ordinality v(url,position) left join moved_media m on m.old_path=v.url) where exists(select 1 from unnest(p.images) v(url) join moved_media m on m.old_path=v.url);
update public.neighbourhoods n set image=m.new_path from moved_media m where n.image=m.old_path;
update public.site_settings s set hero_image=m.new_path from moved_media m where s.hero_image=m.old_path;
update public.site_activities a set image_url=m.new_path from moved_media m where a.image_url=m.old_path;
update public.listing_authors a set portrait_url=m.new_path from moved_media m where a.portrait_url=m.old_path;
update public.site_settings set whatsapp_phone='+84363327342',zalo_phone='0363327342' where id='main';
update public.listing_authors set whatsapp_phone='+84363327342',zalo_phone='0363327342' where slug='gary-home-team' and is_placeholder;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('81145523-90a0-5659-b203-c071c4755a3b','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758363774_250296199991685643_250296199991685643_8d57aff1a985be89d04e709012310333.jpg','',true,-20) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('9a0d7b0d-738a-5114-8cc7-f0b38b2eb247','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758372920_250296199991685643_250296199991685643_8f7a49949dc1bc9736e22ee5ad5712a5.jpg','',true,-19) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('892ea64a-8a73-538a-a1bf-31d36b20a4ca','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403181_250296199991685643_250296199991685643_5f2331433c19d7fc214897ba9d222ae7.jpg','',true,-18) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('1833b425-cd8c-52c7-bffe-3ca3911c73d2','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403190_250296199991685643_250296199991685643_5261cdcc406e3ff6352a67fe20c39fbe.jpg','',true,-17) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('4f25795d-a2c1-5d39-9a83-cdbd1ed87b34','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403196_250296199991685643_250296199991685643_8dcd84faaab5a65e6f1a7ca531826322.jpg','',true,-16) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('13975278-7c4f-55c1-b61d-c8fb4ae10e16','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403206_250296199991685643_250296199991685643_0cc9015f7965edf29d422df98b2d6880.jpg','',true,-15) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('04895f81-82cc-563a-a99b-c3eeccdae28a','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758403213_250296199991685643_250296199991685643_ba2b14bd2a82bd8c638ca2f70aaa2a7e.jpg','',true,-14) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('988f3dcf-d9aa-5e96-b443-5cd6626b2700','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410595_250296199991685643_250296199991685643_b1a1bb38db4acd04e4c8f7bfb8de67a7.jpg','',true,-13) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('8c237014-6403-5356-9488-78ca4eccc803','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410599_250296199991685643_250296199991685643_e73fcef432b38ff9e97dfc6428c2ec22.jpg','',true,-12) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('457c442d-31e9-531c-a459-d0efe19b6615','customers','photo','Moments with Gary Home','Khoảnh khắc cùng Gary Home','/images/customers/1792758410603_250296199991685643_250296199991685643_f2a18d093dbd9d44cc5834f51d32e306.jpg','',true,-11) on conflict(id) do nothing;
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)values('152b4164-efaf-5e3f-a40b-35ccfa761eac','feedback','screenshot','Customer feedback shared with Gary Home','Phản hồi khách hàng gửi đến Gary Home','/images/feedback/1.jpg','',true,-10) on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;

begin;
alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check(role in ('owner','admin','manager','editor'));
create or replace function private.is_editor() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','manager','editor'),false);
$$;
create or replace function private.find_staff_account(target_email text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; target_role text; company_domains text[];
begin
  actor_role := private.staff_role();
  if auth.uid() is null or actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  if assigned_role is null or assigned_role not in ('admin','manager','editor') or (actor_role = 'admin' and assigned_role not in ('manager','editor')) then
    raise exception 'Only the owner can assign administrator access.' using errcode = '42501';
  end if;
  select email_domains into company_domains from public.staff_settings where id = 'main';
  if target_email is null or char_length(target_email) > 254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or not coalesce(split_part(lower(btrim(target_email)),'@',2) = any(company_domains), false) then
    raise exception 'Use an email address at the company domain.' using errcode = '23514';
  end if;
  select id into target_id from auth.users where lower(email) = lower(btrim(target_email));
  select role into target_role from public.team_members where user_id = target_id;
  if target_id = auth.uid() or target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'You cannot change your own access or a protected account.' using errcode = '42501';
  end if;
  return target_id;
end;
$$;
create function private.can_order_properties() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','manager'),false);
$$;
revoke all on function private.can_order_properties() from public,anon;
grant execute on function private.can_order_properties() to authenticated;

alter table public.properties add column published_at timestamptz;
update public.properties set published_at=created_at where status='published';
create function private.stamp_property_publication() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.published_at=case when new.status='published' then now() else null end;
 elsif new.status='published' and old.status<>'published' then new.published_at=now();
 else new.published_at=old.published_at; end if;
 return new;
end; $$;
revoke all on function private.stamp_property_publication() from public,anon,authenticated;
create trigger property_publication_time before insert or update on public.properties for each row execute function private.stamp_property_publication();

create function private.valid_property_order(ids uuid[]) returns boolean language sql stable security invoker set search_path='' as $$
 select ids is not null and cardinality(ids)<=500
 and cardinality(ids)=(select count(distinct id) from unnest(ids) t(id))
 and not exists(select 1 from unnest(ids) t(id) left join public.properties p on p.id=t.id
 where p.id is null or p.status<>'published' or p.listing_type<>'rent' or p.availability not in ('available','on_request'));
$$;
revoke all on function private.valid_property_order(uuid[]) from public,anon;
grant execute on function private.valid_property_order(uuid[]) to authenticated;
create table public.property_display_orders(
 scope text primary key check(scope in ('home','listings')),
 property_ids uuid[] not null default '{}',
 updated_at timestamptz not null default now()
);
alter table public.property_display_orders enable row level security;
revoke all on public.property_display_orders from public,anon,authenticated;
grant select on public.property_display_orders to anon,authenticated;
grant insert,update,delete on public.property_display_orders to authenticated;
create policy orders_public_read on public.property_display_orders for select to anon,authenticated using(true);
create policy orders_staff_insert on public.property_display_orders for insert to authenticated
 with check((select private.can_order_properties()) and private.valid_property_order(property_ids));
create policy orders_staff_update on public.property_display_orders for update to authenticated
 using((select private.can_order_properties()))
 with check((select private.can_order_properties()) and private.valid_property_order(property_ids));
create policy orders_staff_delete on public.property_display_orders for delete to authenticated using((select private.can_order_properties()));

create function public.save_property_order(order_scope text,ordered_property_ids uuid[],expected_property_ids uuid[] default null)
returns void language plpgsql security invoker set search_path='' as $$
declare current_ids uuid[];
begin
 if not private.can_order_properties() then raise exception 'Owner, admin or manager access required.' using errcode='42501'; end if;
 if order_scope is null or order_scope not in ('home','listings') or not private.valid_property_order(ordered_property_ids) then
  raise exception 'Choose current public rental listings with no duplicates.' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gary-property-order:'||order_scope,0));
 select property_ids into current_ids from public.property_display_orders where scope=order_scope;
 if expected_property_ids is not null and coalesce(current_ids,'{}'::uuid[]) is distinct from expected_property_ids then
  raise exception 'This order changed. Refresh the page before saving.' using errcode='40001'; end if;
 insert into public.property_display_orders(scope,property_ids) values(order_scope,ordered_property_ids)
 on conflict(scope) do update set property_ids=excluded.property_ids,updated_at=now();
end; $$;
revoke all on function public.save_property_order(text,uuid[],uuid[]) from public,anon;
grant execute on function public.save_property_order(text,uuid[],uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;

begin;
-- Public reviews are deliberately separate from private submissions and contact details.
create table public.feedback_submissions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 2 and 120),
 email text not null check (char_length(email) between 3 and 254 and email like '%@%'),
 rating integer not null check (rating between 1 and 5),
 message text not null check (char_length(btrim(message)) between 10 and 4000),
 property_id uuid references public.properties(id) on delete set null,
 consent boolean not null check (consent),
 publish_consent boolean not null default false,
 status text not null default 'pending' check (status in ('pending','approved','declined')),
 created_at timestamptz not null default now()
);
create table public.feedback_public (
 id uuid primary key references public.feedback_submissions(id) on delete cascade,
 name text not null, rating integer not null check (rating between 1 and 5), message text not null,
 property_id uuid references public.properties(id) on delete set null,
 staff_reply text not null default '' check (char_length(staff_reply)<=2000),
 published_at timestamptz not null default now()
);
create index feedback_submissions_user_id_idx on public.feedback_submissions(user_id);
create index feedback_submissions_property_id_idx on public.feedback_submissions(property_id);
create index feedback_submissions_created_at_idx on public.feedback_submissions(created_at desc);
create index feedback_public_property_id_idx on public.feedback_public(property_id);
create index feedback_public_published_at_idx on public.feedback_public(published_at desc);
alter table public.feedback_submissions enable row level security;
alter table public.feedback_public enable row level security;
revoke all on public.feedback_submissions,public.feedback_public from anon,authenticated;
grant insert(name,email,rating,message,property_id,consent,publish_consent) on public.feedback_submissions to anon,authenticated;
grant select,delete on public.feedback_submissions to authenticated;
grant update(status) on public.feedback_submissions to authenticated;
grant select on public.feedback_public to anon,authenticated;
grant insert,update,delete on public.feedback_public to authenticated;
create policy feedback_submit on public.feedback_submissions for insert to anon,authenticated with check (
 user_id is not distinct from (select auth.uid()) and status='pending' and consent
 and (property_id is null or exists(select 1 from public.properties p where p.id=property_id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request')))
);
create policy feedback_read on public.feedback_submissions for select to authenticated using (user_id=(select auth.uid()) or (select private.is_editor()));
create policy feedback_delete on public.feedback_submissions for delete to authenticated using (user_id=(select auth.uid()) or (select private.is_editor()));
create policy feedback_moderate on public.feedback_submissions for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy feedback_public_read on public.feedback_public for select to anon,authenticated using (true);
create policy feedback_public_insert on public.feedback_public for insert to authenticated with check (
 (select private.is_editor()) and exists(select 1 from public.feedback_submissions s where s.id=feedback_public.id and s.status='approved' and s.publish_consent and s.name=feedback_public.name and s.rating=feedback_public.rating and s.message=feedback_public.message and s.property_id is not distinct from feedback_public.property_id)
);
create policy feedback_public_update on public.feedback_public for update to authenticated using ((select private.is_editor())) with check (
 (select private.is_editor()) and exists(select 1 from public.feedback_submissions s where s.id=feedback_public.id and s.status='approved' and s.publish_consent and s.name=feedback_public.name and s.rating=feedback_public.rating and s.message=feedback_public.message and s.property_id is not distinct from feedback_public.property_id)
);
create policy feedback_public_delete on public.feedback_public for delete to authenticated using ((select private.is_editor()));

create function public.moderate_feedback(submission_id uuid, decision text, reply text default '') returns void
language plpgsql security invoker set search_path='' as $$
declare s public.feedback_submissions;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501'; end if;
 if decision not in ('approved','declined') or char_length(reply)>2000 then raise exception 'Invalid review decision' using errcode='23514'; end if;
 select * into s from public.feedback_submissions where id=submission_id for update;
 if not found then raise exception 'Submission no longer exists' using errcode='P0002'; end if;
 if decision='approved' and not s.publish_consent then raise exception 'Publication permission was not given' using errcode='23514'; end if;
 update public.feedback_submissions set status=decision where id=submission_id;
 delete from public.feedback_public where id=submission_id;
 if decision='approved' then
  insert into public.feedback_public(id,name,rating,message,property_id,staff_reply) values(s.id,s.name,s.rating,s.message,s.property_id,btrim(coalesce(reply,'')));
 end if;
end;
$$;
revoke all on function public.moderate_feedback(uuid,text,text) from public,anon;
grant execute on function public.moderate_feedback(uuid,text,text) to authenticated;

-- Assistance reports are evidence for internal attribution, never automatic payouts.
create table public.property_assistance (
 id uuid primary key default gen_random_uuid(),
 user_id uuid default auth.uid() references auth.users(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 2 and 120),
 email text not null check (char_length(email) between 3 and 254 and email like '%@%'),
 phone text not null default '' check (char_length(phone)<=40),
 helper_name text not null check (char_length(btrim(helper_name)) between 2 and 160),
 channel text not null check (channel in ('in_person','phone','zalo','whatsapp','email','website','referral','other')),
 helped_where text not null check (char_length(btrim(helped_where)) between 2 and 300),
 helped_on date not null check (helped_on>='2000-01-01'),
 helped_time time,
 notes text not null default '' check (char_length(notes)<=2000),
 consent boolean not null check (consent),
 status text not null default 'submitted' check (status in ('submitted','verified','needs_details','declined')),
 created_at timestamptz not null default now()
);
create table public.assistance_reviews (
 report_id uuid primary key references public.property_assistance(id) on delete cascade,
 credited_staff_id uuid references public.team_members(user_id) on delete set null,
 confirmed_helper text not null default '' check (char_length(confirmed_helper)<=160),
 internal_notes text not null default '' check (char_length(internal_notes)<=4000),
 reviewed_by uuid default auth.uid() references auth.users(id) on delete set null,
 reviewed_at timestamptz not null default now()
);
create index property_assistance_user_id_idx on public.property_assistance(user_id);
create index property_assistance_property_id_idx on public.property_assistance(property_id);
create index property_assistance_created_at_idx on public.property_assistance(created_at desc);
create index assistance_reviews_credited_staff_id_idx on public.assistance_reviews(credited_staff_id);
create index assistance_reviews_reviewed_by_idx on public.assistance_reviews(reviewed_by);
alter table public.property_assistance enable row level security;
alter table public.assistance_reviews enable row level security;
revoke all on public.property_assistance,public.assistance_reviews from anon,authenticated;
grant insert(property_id,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,consent) on public.property_assistance to anon,authenticated;
grant select on public.property_assistance to authenticated;
grant update(status) on public.property_assistance to authenticated;
grant select,insert,update on public.assistance_reviews to authenticated;
create policy assistance_submit on public.property_assistance for insert to anon,authenticated with check (
 user_id is not distinct from (select auth.uid()) and status='submitted' and consent
 and helped_on<=(now() at time zone 'Asia/Ho_Chi_Minh')::date
 and exists(select 1 from public.properties p where p.id=property_id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
);
create policy assistance_read on public.property_assistance for select to authenticated using (user_id=(select auth.uid()) or (select private.can_order_properties()));
create policy assistance_staff_update on public.property_assistance for update to authenticated using ((select private.can_order_properties())) with check ((select private.can_order_properties()));
create policy assistance_review_read on public.assistance_reviews for select to authenticated using ((select private.can_order_properties()));
create policy assistance_review_insert on public.assistance_reviews for insert to authenticated with check ((select private.can_order_properties()) and reviewed_by=(select auth.uid()));
create policy assistance_review_update on public.assistance_reviews for update to authenticated using ((select private.can_order_properties())) with check ((select private.can_order_properties()) and reviewed_by=(select auth.uid()));

-- The guarded definer exposes only eligible staff IDs/names to attribution reviewers.
create function private.attribution_staff() returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(nullif(m.display_name,''),split_part(u.email,'@',1)),m.role::text
 from public.team_members m join auth.users u on u.id=m.user_id
 where private.can_order_properties() and m.active and u.email_confirmed_at is not null
 and (m.bootstrap_owner or lower(split_part(u.email,'@',2)) in ('garyhome.com','icue.vn'))
 order by m.display_name,m.user_id;
$$;
revoke all on function private.attribution_staff() from public,anon;
grant execute on function private.attribution_staff() to authenticated;
create function public.list_attribution_staff() returns table(user_id uuid,display_name text,role text)
language sql stable security invoker set search_path='' as $$ select * from private.attribution_staff(); $$;
revoke all on function public.list_attribution_staff() from public,anon;
grant execute on function public.list_attribution_staff() to authenticated;

create function public.review_property_assistance(report uuid,decision text,credited_staff uuid default null,helper text default '',review_notes text default '') returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.can_order_properties(),false) then raise exception 'Owner, admin or manager access required' using errcode='42501'; end if;
 if decision not in ('verified','needs_details','declined') or char_length(btrim(helper))>160 or char_length(review_notes)>4000 or (decision='verified' and char_length(btrim(helper))<2) then raise exception 'Check attribution details' using errcode='23514'; end if;
 if credited_staff is not null and not exists(select 1 from private.attribution_staff() s where s.user_id=credited_staff) then raise exception 'Choose an active staff account' using errcode='23514'; end if;
 perform 1 from public.property_assistance where id=report for update;
 if not found then raise exception 'Report no longer exists' using errcode='P0002'; end if;
 update public.property_assistance set status=decision where id=report;
 insert into public.assistance_reviews(report_id,credited_staff_id,confirmed_helper,internal_notes,reviewed_by,reviewed_at)
 values(report,credited_staff,btrim(coalesce(helper,'')),coalesce(review_notes,''),auth.uid(),now())
 on conflict(report_id) do update set credited_staff_id=excluded.credited_staff_id,confirmed_helper=excluded.confirmed_helper,internal_notes=excluded.internal_notes,reviewed_by=auth.uid(),reviewed_at=now();
end;
$$;
revoke all on function public.review_property_assistance(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.review_property_assistance(uuid,text,uuid,text,text) to authenticated;
commit;

begin;
-- Supplied collage for Our Team; preserve any subsequent CMS changes.
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)
values('a3a31423-c458-5988-b9f8-8720996f64ed','team','photo','From our team collection','Hình ảnh từ bộ sưu tập của đội ngũ','/images/ourteam/gary-home-team.png','',true,0)
on conflict(id) do nothing;
notify pgrst, 'reload schema';
commit;

begin;

-- A permitted address still needs an explicit owner/admin staff assignment.
update public.staff_settings set email_domains=array_append(email_domains,'gmail.com')
where id='main' and not ('gmail.com'=any(email_domains));

create function private.is_staff_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin'),false);
$$;
revoke all on function private.is_staff_admin() from public,anon;
grant execute on function private.is_staff_admin() to authenticated;

create or replace function private.attribution_staff() returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(nullif(m.display_name,''),split_part(u.email,'@',1)),m.role::text
 from public.team_members m join auth.users u on u.id=m.user_id
 join public.staff_settings s on s.id='main'
 where private.can_order_properties() and m.active and u.email_confirmed_at is not null
 and m.email=lower(u.email)
 and (m.bootstrap_owner or lower(split_part(u.email,'@',2))=any(s.email_domains))
 order by m.display_name,m.user_id;
$$;

-- Read tracking stays with private staff notes, outside customer-facing columns.
alter table public.enquiry_notes add column read_at timestamptz;
alter table public.enquiry_notes add column read_by uuid references auth.users(id) on delete set null;
alter table public.enquiry_notes add column property_code text not null default '';
alter table public.enquiry_notes add column property_address text not null default '';
create index enquiry_notes_read_by_idx on public.enquiry_notes(read_by);

create function public.mark_enquiry_read(target_enquiry uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare property_code text; property_address text; result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501'; end if;
 select p.listing_code,p.address into property_code,property_address from public.enquiries e
 left join public.properties p on p.id=e.property_id where e.id=target_enquiry;
 if not found then raise exception 'Enquiry no longer exists' using errcode='P0002'; end if;
 insert into public.enquiry_notes(enquiry_id,notes,read_at,read_by,property_code,property_address)
 values(target_enquiry,'',now(),auth.uid(),coalesce(property_code,''),coalesce(property_address,''))
 on conflict(enquiry_id) do update set
  read_at=coalesce(public.enquiry_notes.read_at,excluded.read_at),
  read_by=case when public.enquiry_notes.read_at is null then excluded.read_by else public.enquiry_notes.read_by end,
  property_code=coalesce(nullif(public.enquiry_notes.property_code,''),excluded.property_code),
  property_address=coalesce(nullif(public.enquiry_notes.property_address,''),excluded.property_address)
 returning jsonb_build_object('read_at',enquiry_notes.read_at,'read_by',enquiry_notes.read_by,'property_code',enquiry_notes.property_code,'property_address',enquiry_notes.property_address) into result;
 return result;
end;
$$;
revoke all on function public.mark_enquiry_read(uuid) from public,anon;
grant execute on function public.mark_enquiry_read(uuid) to authenticated;

-- Keep commission evidence if an administrator removes its public listing.
alter table public.property_assistance add column property_code text not null default '';
alter table public.property_assistance add column property_address text not null default '';
update public.property_assistance a set property_code=p.listing_code,property_address=p.address
from public.properties p where p.id=a.property_id;
alter table public.property_assistance drop constraint property_assistance_property_id_fkey;
alter table public.property_assistance alter column property_id drop not null;
alter table public.property_assistance add constraint property_assistance_property_id_fkey foreign key(property_id) references public.properties(id) on delete set null;
create function private.capture_assistance_property() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select p.listing_code,p.address into new.property_code,new.property_address from public.properties p where p.id=new.property_id;
 new.property_code:=coalesce(new.property_code,'');new.property_address:=coalesce(new.property_address,'');
 return new;
end; $$;
revoke all on function private.capture_assistance_property() from public,anon,authenticated;
create trigger capture_assistance_property before insert on public.property_assistance for each row execute function private.capture_assistance_property();

create function private.preserve_deleted_property() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.enquiry_notes(enquiry_id,notes,property_code,property_address)
 select e.id,'',old.listing_code,old.address from public.enquiries e where e.property_id=old.id
 on conflict(enquiry_id) do update set property_code=coalesce(nullif(public.enquiry_notes.property_code,''),excluded.property_code),property_address=coalesce(nullif(public.enquiry_notes.property_address,''),excluded.property_address);
 update public.property_display_orders o set property_ids=array(
  select item.id from unnest(o.property_ids) with ordinality item(id,position)
  where item.id<>old.id and exists(select 1 from public.properties p where p.id=item.id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
  order by item.position
 ) where old.id=any(o.property_ids);
 return old;
end; $$;
revoke all on function private.preserve_deleted_property() from public,anon,authenticated;
create trigger preserve_deleted_property before delete on public.properties for each row execute function private.preserve_deleted_property();

alter policy properties_editor_delete on public.properties using ((select private.is_staff_admin()));
alter policy enquiries_editor_delete on public.enquiries using ((select private.is_staff_admin()));
create function public.delete_property(target_property uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.is_staff_admin(),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 delete from public.properties where id=target_property;return true;
end; $$;
create function public.delete_enquiry(target_enquiry uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.is_staff_admin(),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 delete from public.enquiries where id=target_enquiry;return true;
end; $$;
revoke all on function public.delete_property(uuid),public.delete_enquiry(uuid) from public,anon;
grant execute on function public.delete_property(uuid),public.delete_enquiry(uuid) to authenticated;

-- Membership changes use guarded definer functions in the unexposed schema.
create function private.remove_staff_access(target_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or not coalesce(actor_role in ('owner','admin'),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 select role into target_role from public.team_members where user_id=target_user_id for update;
 if target_user_id=auth.uid() or target_role='owner' or (actor_role='admin' and target_role='admin') then raise exception 'You cannot remove your own access or a protected account' using errcode='42501'; end if;
 delete from public.team_members where user_id=target_user_id;return true;
end; $$;
create function public.remove_staff_access(target_user_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.remove_staff_access(target_user_id); $$;
revoke all on function private.remove_staff_access(uuid),public.remove_staff_access(uuid) from public,anon;
grant execute on function private.remove_staff_access(uuid),public.remove_staff_access(uuid) to authenticated;

create function private.staff_reset_email(target_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text; target_role text; target_email text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or not coalesce(actor_role in ('owner','admin'),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 select m.role,lower(u.email) into target_role,target_email from public.team_members m
 join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.user_id=target_user_id and m.active and u.email_confirmed_at is not null and m.email=lower(u.email)
 and ((m.role='owner' and m.bootstrap_owner) or split_part(lower(u.email),'@',2)=any(s.email_domains));
 if target_email is null then raise exception 'Confirm the invitation and restore staff access before requesting a password reset' using errcode='23514'; end if;
 if target_user_id<>auth.uid() and (target_role='owner' or (actor_role='admin' and target_role='admin')) then raise exception 'You cannot reset a protected account' using errcode='42501'; end if;
 return target_email;
end; $$;
create function public.staff_reset_email(target_user_id uuid) returns text language sql stable security invoker set search_path='' as $$ select private.staff_reset_email(target_user_id); $$;
revoke all on function private.staff_reset_email(uuid),public.staff_reset_email(uuid) from public,anon;
grant execute on function private.staff_reset_email(uuid),public.staff_reset_email(uuid) to authenticated;

notify pgrst,'reload schema';
commit;

begin;

-- Pending staff can request setup again without being granted access before mailbox verification.
-- The actor still needs fresh, confirmed owner/admin membership.
create or replace function private.staff_reset_email(target_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text; target_role text; target_email text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or not coalesce(actor_role in ('owner','admin'),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 select m.role,lower(u.email) into target_role,target_email from public.team_members m
 join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.user_id=target_user_id and m.active and m.email=lower(u.email)
 and ((m.role='owner' and m.bootstrap_owner) or split_part(lower(u.email),'@',2)=any(s.email_domains));
 if target_email is null then raise exception 'Restore staff access and check the assigned email before requesting a password link' using errcode='23514'; end if;
 if target_user_id<>auth.uid() and (target_role='owner' or (actor_role='admin' and target_role='admin')) then raise exception 'You cannot reset a protected account' using errcode='42501'; end if;
 return target_email;
end; $$;

notify pgrst,'reload schema';
commit;

begin;

create function private.staff_rank(role_name text) returns integer language sql immutable security invoker set search_path='' as $$
 select case role_name when 'owner' then 4 when 'admin' then 3 when 'manager' then 2 when 'editor' then 1 else 0 end;
$$;
revoke all on function private.staff_rank(text) from public,anon;
grant execute on function private.staff_rank(text) to authenticated;

create or replace function private.find_staff_account(target_email text,assigned_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor_role text; target_id uuid; target_role text; domains text[];
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 if private.staff_rank(assigned_role)<1 or private.staff_rank(assigned_role)>=private.staff_rank(actor_role) then raise exception 'You may assign roles below your own level only' using errcode='42501'; end if;
 select email_domains into domains from public.staff_settings where id='main';
 if target_email is null or char_length(target_email)>254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or not coalesce(split_part(lower(btrim(target_email)),'@',2)=any(domains),false) then raise exception 'Use an allowed company or Gmail address' using errcode='23514'; end if;
 select id into target_id from auth.users where lower(email)=lower(btrim(target_email));
 select role into target_role from public.team_members where user_id=target_id;
 if target_id=auth.uid() or (target_role is not null and private.staff_rank(target_role)>=private.staff_rank(actor_role)) then raise exception 'You cannot change your own access, a peer or a higher role' using errcode='42501'; end if;
 return target_id;
end; $$;

create or replace function private.set_staff_access(target_user_id uuid,assigned_role text,enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare member public.team_members; checked_id uuid;
begin
 if auth.uid() is null or private.staff_rank(private.staff_role())<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 select * into member from public.team_members where user_id=target_user_id;
 if member.user_id is null then raise exception 'Staff account not found' using errcode='P0002'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.email,0));
 checked_id:=private.find_staff_account(member.email,assigned_role);
 if checked_id is distinct from target_user_id or enabled is null then raise exception 'Check the assigned staff email' using errcode='23514'; end if;
 update public.team_members set role=assigned_role,active=enabled,assigned_by=auth.uid(),updated_at=now() where user_id=target_user_id;
 return target_user_id;
end; $$;

create or replace function private.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 return query select m.user_id,m.email,m.display_name,m.role,m.active,u.email_confirmed_at is not null,m.created_at,m.updated_at
 from public.team_members m join auth.users u on u.id=m.user_id
 where m.email is not null and (m.user_id=auth.uid() or private.staff_rank(m.role)<private.staff_rank(actor_role)) and (after_email is null or m.email>after_email)
 order by m.email limit 51;
end; $$;

create or replace function private.staff_reset_email(target_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text; target_role text; target_email text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 select m.role,lower(u.email) into target_role,target_email from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.user_id=target_user_id and m.active and m.email=lower(u.email) and ((m.role='owner' and m.bootstrap_owner) or split_part(lower(u.email),'@',2)=any(s.email_domains));
 if target_email is null then raise exception 'Restore staff access and check the assigned email' using errcode='23514'; end if;
 if target_user_id<>auth.uid() and private.staff_rank(target_role)>=private.staff_rank(actor_role) then raise exception 'You cannot reset a peer or higher role' using errcode='42501'; end if;
 return target_email;
end; $$;

alter table public.team_members add column password_change_reminder boolean not null default false;
alter table public.team_members alter column password_change_reminder set default true;

create table public.staff_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 avatar_path text not null check(char_length(avatar_path)<=250 and avatar_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|jpeg|webp|avif)$' and split_part(avatar_path,'/',1)=user_id::text),
 updated_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from public,anon,authenticated;
grant select on public.staff_profiles to anon,authenticated;
-- PostgREST upserts include the key in ON CONFLICT UPDATE. RLS and the
-- ownership trigger still prevent changing it to another account.
grant insert(user_id,avatar_path),update(user_id,avatar_path) on public.staff_profiles to authenticated;
create policy staff_profiles_staff_read on public.staff_profiles for select to authenticated using ((select private.is_editor()));
create policy staff_profiles_self_insert on public.staff_profiles for insert to authenticated with check(user_id=(select auth.uid()) and (select private.is_editor()) and exists(select 1 from storage.objects o where o.bucket_id='staff-avatars' and o.name=avatar_path));
create policy staff_profiles_self_update on public.staff_profiles for update to authenticated using(user_id=(select auth.uid()) and (select private.is_editor())) with check(user_id=(select auth.uid()) and (select private.is_editor()) and exists(select 1 from storage.objects o where o.bucket_id='staff-avatars' and o.name=avatar_path));

grant select,insert,delete on storage.objects to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('staff-avatars','staff-avatars',true,2097152,array['image/jpeg','image/png','image/webp','image/avif']);
create policy staff_avatar_upload on storage.objects for insert to authenticated with check(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()));
create policy staff_avatar_read_own on storage.objects for select to authenticated using(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()));
create policy staff_avatar_delete_own on storage.objects for delete to authenticated using(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()) and not exists(select 1 from public.staff_profiles p where p.user_id=(select auth.uid()) and p.avatar_path=name));

alter table public.listing_authors drop constraint listing_authors_portrait_url_check;
alter table public.listing_authors add constraint listing_authors_portrait_url_check check(portrait_url='' or portrait_url ~ '^(/images/|https://)' or portrait_url ~ '^/api/staff-avatar/[a-f0-9-]{36}\?v=[0-9.]+$');
alter table public.listing_authors add column staff_user_id uuid references auth.users(id) on delete set null;
create index listing_authors_staff_user_id_idx on public.listing_authors(staff_user_id);
create function private.has_public_staff_portrait(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.listing_authors a join public.team_members m on m.user_id=a.staff_user_id join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where a.staff_user_id=target and a.published and m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains)));
$$;
revoke all on function private.has_public_staff_portrait(uuid) from public;
grant usage on schema private to anon;
grant execute on function private.has_public_staff_portrait(uuid) to anon,authenticated;
create policy staff_profiles_published_portrait on public.staff_profiles for select to anon using(private.has_public_staff_portrait(user_id));

create table public.studio_notifications(
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('team','profile','enquiry','feedback','commission')),
 action text not null,
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_name text not null default '',
 target_user_id uuid references auth.users(id) on delete set null,
 target_name text not null default '',
 target_role text,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index studio_notifications_created_idx on public.studio_notifications(created_at desc,id desc);
create index studio_notifications_actor_idx on public.studio_notifications(actor_user_id,created_at desc);
create index studio_notifications_target_idx on public.studio_notifications(target_user_id,created_at desc);
alter table public.studio_notifications enable row level security;
revoke all on public.studio_notifications from public,anon,authenticated;
grant select on public.studio_notifications to authenticated;
create policy studio_notifications_staff_read on public.studio_notifications for select to authenticated using(
 (select private.is_editor()) and (
 category in ('enquiry','feedback') or category='commission' and (select private.can_order_properties()) or
 category in ('team','profile') and ((select private.staff_role())='owner' or actor_user_id=(select auth.uid()) or target_user_id=(select auth.uid()) or (select private.staff_rank(private.staff_role()))>=2 and private.staff_rank(target_role)<(select private.staff_rank(private.staff_role())))
 ));
create table public.staff_notification_reads(user_id uuid primary key references auth.users(id) on delete cascade,last_seen_at timestamptz not null default now());
alter table public.staff_notification_reads enable row level security;
revoke all on public.staff_notification_reads from public,anon,authenticated;
grant select,insert,update on public.staff_notification_reads to authenticated;
create policy staff_notification_reads_self on public.staff_notification_reads to authenticated using(user_id=(select auth.uid()) and (select private.is_editor())) with check(user_id=(select auth.uid()) and (select private.is_editor()));

create function private.append_studio_event(event_category text,event_action text,target uuid,target_label text,target_level text,event_details jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.studio_notifications(category,action,actor_user_id,actor_name,target_user_id,target_name,target_role,details)
 values(event_category,event_action,auth.uid(),coalesce((select display_name from public.team_members where user_id=auth.uid()),''),target,coalesce(target_label,''),target_level,event_details);
end; $$;
revoke all on function private.append_studio_event(text,text,uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function private.assign_staff_account(target_email text,full_name text,assigned_role text) returns uuid language plpgsql security definer set search_path='' as $$
declare target_id uuid; was_member boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(target_email)),0));
 target_id:=private.find_staff_account(target_email,assigned_role);
 if target_id is null then raise exception 'Create the Auth account first' using errcode='P0002';end if;
 if full_name is null or char_length(btrim(full_name)) not between 2 and 120 then raise exception 'Enter the staff name' using errcode='23514';end if;
 select exists(select 1 from public.team_members where user_id=target_id) into was_member;
 insert into public.team_members(user_id,email,display_name,role,active,assigned_by) values(target_id,lower(btrim(target_email)),btrim(full_name),assigned_role,true,auth.uid())
 on conflict(user_id)do update set email=excluded.email,display_name=excluded.display_name,role=excluded.role,active=true,assigned_by=auth.uid(),updated_at=now();
 if was_member then perform private.append_studio_event('team','team.assigned',target_id,btrim(full_name),assigned_role);end if;
 return target_id;
end; $$;

create function private.log_team_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform private.append_studio_event('team','team.created',new.user_id,new.display_name,new.role,jsonb_build_object('role',new.role,'password_reminder',new.password_change_reminder));return new;end if;
 if tg_op='DELETE' then perform private.append_studio_event('team','team.deleted',old.user_id,old.display_name,old.role);return old;end if;
 if old.role is distinct from new.role then perform private.append_studio_event('team','team.role_changed',new.user_id,new.display_name,new.role,jsonb_build_object('from',old.role,'to',new.role));end if;
 if old.active is distinct from new.active then perform private.append_studio_event('team',case when new.active then 'team.restored' else 'team.disabled' end,new.user_id,new.display_name,new.role);end if;
 if old.display_name is distinct from new.display_name or old.email is distinct from new.email then perform private.append_studio_event('team','team.details_changed',new.user_id,new.display_name,new.role);end if;
 if old.password_change_reminder is distinct from new.password_change_reminder then perform private.append_studio_event('team',case when new.password_change_reminder then 'password.reminder_enabled' else 'password.reminder_cleared' end,new.user_id,new.display_name,new.role);end if;
 return new;
end; $$;
revoke all on function private.log_team_access() from public,anon,authenticated;
create trigger log_team_access after insert or update or delete on public.team_members for each row execute function private.log_team_access();

create function private.sync_staff_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is distinct from new.user_id or not coalesce(private.is_editor(),false) then raise exception 'Own staff profile required' using errcode='42501';end if;
 new.updated_at:=now();
 return new;
end; $$;
create trigger stamp_staff_portrait before insert or update on public.staff_profiles for each row execute function private.sync_staff_portrait();
create function private.publish_staff_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is distinct from new.user_id or not coalesce(private.is_editor(),false) then raise exception 'Own staff profile required' using errcode='42501';end if;
 update public.listing_authors set portrait_url='/api/staff-avatar/'||new.user_id::text||'?v='||extract(epoch from new.updated_at)::text,updated_at=now() where staff_user_id=new.user_id;
 if tg_op='INSERT' or old.avatar_path is distinct from new.avatar_path then perform private.append_studio_event('profile','profile.photo_changed',new.user_id,(select display_name from public.team_members where user_id=new.user_id),(select role from public.team_members where user_id=new.user_id));end if;
 return new;
end; $$;
create trigger publish_staff_portrait after insert or update on public.staff_profiles for each row execute function private.publish_staff_portrait();
revoke all on function private.sync_staff_portrait(),private.publish_staff_portrait() from public,anon,authenticated;

create function private.link_listing_portrait() returns trigger language plpgsql security definer set search_path='' as $$
declare photo public.staff_profiles;
begin
 if new.staff_user_id is not null then
  if not exists(select 1 from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main' where m.user_id=new.staff_user_id and m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains))) then raise exception 'Choose an active verified staff account' using errcode='23514';end if;
  select * into photo from public.staff_profiles where user_id=new.staff_user_id;
  new.portrait_url:=case when photo.avatar_path is null then '' else '/api/staff-avatar/'||new.staff_user_id::text||'?v='||extract(epoch from photo.updated_at)::text end;
 end if;return new;
end; $$;
revoke all on function private.link_listing_portrait() from public,anon,authenticated;
create trigger link_listing_portrait before insert or update on public.listing_authors for each row execute function private.link_listing_portrait();

create function public.get_staff_profile() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'avatar_path',coalesce(p.avatar_path,''),'updated_at',p.updated_at,'password_change_reminder',m.password_change_reminder) into result from public.team_members m left join public.staff_profiles p on p.user_id=m.user_id where m.user_id=auth.uid();
 return result;
end; $$;
create function private.acknowledge_staff_password_reminder() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 update public.team_members set password_change_reminder=false,updated_at=now() where user_id=auth.uid();
end; $$;
create function public.acknowledge_staff_password_reminder() returns void language sql security invoker set search_path='' as $$select private.acknowledge_staff_password_reminder();$$;
revoke all on function private.acknowledge_staff_password_reminder(),public.acknowledge_staff_password_reminder(),public.get_staff_profile() from public,anon;
grant execute on function private.acknowledge_staff_password_reminder(),public.acknowledge_staff_password_reminder(),public.get_staff_profile() to authenticated;

create function private.staff_photo_directory() returns table(user_id uuid,display_name text,avatar_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 return query select m.user_id,m.display_name,coalesce(p.avatar_path,'') from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main' left join public.staff_profiles p on p.user_id=m.user_id where m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains)) order by m.display_name,m.user_id limit 500;
end; $$;
create function public.staff_photo_directory() returns table(user_id uuid,display_name text,avatar_path text) language sql stable security invoker set search_path='' as $$ select * from private.staff_photo_directory(); $$;
revoke all on function private.staff_photo_directory(),public.staff_photo_directory() from public,anon;
grant execute on function private.staff_photo_directory(),public.staff_photo_directory() to authenticated;

create function public.get_studio_notifications(before_time timestamptz default null,before_id uuid default null,page_size integer default 30) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare seen timestamptz; items jsonb; unread bigint;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select last_seen_at into seen from public.staff_notification_reads where user_id=auth.uid();
 select count(*) into unread from public.studio_notifications where seen is null or created_at>seen;
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from(select n.*,coalesce(p.avatar_path,'') as actor_avatar_path,seen is null or n.created_at>seen as unread from public.studio_notifications n left join public.staff_profiles p on p.user_id=n.actor_user_id where before_time is null or (n.created_at,n.id)<(before_time,before_id) order by n.created_at desc,n.id desc limit least(greatest(page_size,1),50)) rows;
 return jsonb_build_object('items',items,'unread_count',unread);
end; $$;
create function public.mark_studio_notifications_read() returns timestamptz language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 insert into public.staff_notification_reads(user_id,last_seen_at) values(auth.uid(),stamp) on conflict(user_id)do update set last_seen_at=excluded.last_seen_at;
 return stamp;
end; $$;
revoke all on function public.get_studio_notifications(timestamptz,uuid,integer),public.mark_studio_notifications_read() from public,anon;
grant execute on function public.get_studio_notifications(timestamptz,uuid,integer),public.mark_studio_notifications_read() to authenticated;

create function private.log_staff_password_link(target_user_id uuid,failed boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.staff_reset_email(target_user_id);
 perform private.append_studio_event('team',case when failed then 'password.link_failed' else 'password.link_requested' end,target_user_id,(select display_name from public.team_members where user_id=target_user_id),(select role from public.team_members where user_id=target_user_id));
end; $$;
create function public.log_staff_password_link(target_user_id uuid,failed boolean default false) returns void language sql security invoker set search_path='' as $$ select private.log_staff_password_link(target_user_id,failed); $$;
revoke all on function private.log_staff_password_link(uuid,boolean),public.log_staff_password_link(uuid,boolean) from public,anon;
grant execute on function private.log_staff_password_link(uuid,boolean),public.log_staff_password_link(uuid,boolean) to authenticated;

create function private.log_submission_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare event_category text; event_action text;
begin
 event_category:=case tg_table_name when 'enquiries' then 'enquiry' when 'feedback_submissions' then 'feedback' when 'property_assistance' then 'commission' else null end;
 if event_category is null then raise exception 'Unsupported activity source';end if;
 if tg_op='INSERT' then event_action:=event_category||'.received';else if old.status is not distinct from new.status then return new;end if;event_action:=event_category||'.status_changed';end if;
 perform private.append_studio_event(event_category,event_action,null,'',null,jsonb_build_object('record_id',new.id,'status',new.status));return new;
end; $$;
revoke all on function private.log_submission_activity() from public,anon,authenticated;
create trigger notify_new_enquiry after insert or update of status on public.enquiries for each row execute function private.log_submission_activity();
create trigger notify_customer_feedback after insert or update of status on public.feedback_submissions for each row execute function private.log_submission_activity();
create trigger notify_assistance_activity after insert or update of status on public.property_assistance for each row execute function private.log_submission_activity();

-- Enable live updates only when the host has Supabase Realtime configured.
do $$declare item text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach item in array array['staff_profiles','studio_notifications'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=item) then execute format('alter publication supabase_realtime add table public.%I',item);end if;
  end loop;
 end if;
end;$$;

notify pgrst,'reload schema';
commit;

begin;

-- Keep audit snapshots when an Auth account is removed through Supabase.
-- Cascading membership deletion runs after the Auth row has disappeared.
create or replace function private.append_studio_event(event_category text,event_action text,target uuid,target_label text,target_level text,event_details jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.studio_notifications(category,action,actor_user_id,actor_name,target_user_id,target_name,target_role,details)
 values(event_category,event_action,
  (select u.id from auth.users u where u.id=auth.uid()),
  coalesce((select display_name from public.team_members where user_id=auth.uid()),''),
  (select u.id from auth.users u where u.id=target),
  coalesce(target_label,''),target_level,event_details);
end; $$;
revoke all on function private.append_studio_event(text,text,uuid,text,text,jsonb) from public,anon,authenticated;

commit;

-- Generated by npm run seed:generate. Existing CMS edits are preserved.
begin;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('tay-ho','Tây Hồ','Lakeside living, at your pace.','An yên bên hồ, theo nhịp của bạn.','Morning walks by West Lake. Coffee on a quiet side street. Discover homes in one of Hanoi’s best-known lakeside neighbourhoods.','Dạo bộ bên Hồ Tây mỗi sáng, thưởng thức cà phê trong những con ngõ yên tĩnh. Khám phá không gian sống bên hồ giữa lòng Hà Nội.','/images/apartments/area-tay-ho.jpg',0) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('ba-dinh','Ba Đình','The city’s history. Your new story.','Nét xưa của phố. Câu chuyện mới của bạn.','Tree-lined streets, familiar local markets, and the city’s historic heart. Explore apartments around Đào Tấn, Kim Mã, and Đội Cấn.','Những con phố rợp bóng cây, khu chợ thân quen và trái tim lịch sử của thành phố. Khám phá căn hộ quanh Đào Tấn, Kim Mã và Đội Cấn.','/images/area-ba-dinh.jpg',1) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('long-bien','Long Biên','A little more space to breathe.','Thêm không gian để tận hưởng.','Across the Red River, discover a different rhythm of Hanoi. Explore homes in Ngọc Thụy and the surrounding residential neighbourhoods.','Bên kia sông Hồng là một nhịp sống Hà Nội khác. Khám phá nhà ở tại Ngọc Thụy và các khu dân cư lân cận.','/images/apartments/area-long-bien.jpg',2) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('bac-tu-liem','Bắc Từ Liêm','A fresh start, within reach.','Khởi đầu mới, trong tầm tay.','Find your own corner of western Hanoi, with studios and apartments to suit a range of budgets.','Tìm góc riêng của bạn tại phía Tây Hà Nội với các căn studio và căn hộ phù hợp nhiều mức ngân sách.','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg',3) on conflict (slug) do nothing;
insert into public.site_settings (id,hero_image,hero_text_en,hero_text_vi,contact_email,contact_phone,hero_title_en,hero_title_vi,contact_address) values ('main','/images/apartments/hero.jpg','Thoughtfully chosen homes. A team that knows Hanoi. Let’s find the place that feels like you.','Những ngôi nhà được chọn lọc. Đội ngũ am hiểu Hà Nội. Cùng tìm nơi thuộc về bạn.','info@garyhome.vn','+84 356 175 046','Find a place.
Feel at home.','Tìm một nơi.
Gọi là nhà.','Eurowindow Tower, 27 Trần Duy Hưng, Cầu Giấy, Hà Nội, Vietnam') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('d4c744f8-f4d9-53e2-a964-0d863095296c','can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho',null,array['/images/apartments/hero.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-1.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-2.jpg','/images/apartments/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho-3.jpg']::text[],'published','Tây Hồ, Hà Nội',null,2,'USD',true,'A little more room in Tô Ngọc Vân','Căn hộ dịch vụ 2 phòng ngủ tại Tô Ngọc Vân, Tây Hồ',array['Balcony','Bathtub','Air conditioning','Equipped kitchen','Lake view','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],2,'2026-10-21T00:00:00+00:00',0,'https://garyhome.vn/en/property/can-ho-dich-vu-2-phong-ngu-tai-to-ngoc-van-tay-ho/','2026-10-21T00:00:00+00:00','on_request','rent','tay-ho','Apartment','Explore this home in Tây Hồ, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Tây Hồ, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('625ba7e1-5658-5a03-b440-e150332bb514','can-ho-2n-2wc-dao-tan',800,array['/images/apartments/can-ho-2n-2wc-dao-tan-3.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-1.jpg','/images/apartments/can-ho-2n-2wc-dao-tan-2.jpg']::text[],'published','Ba Đình, Hà Nội',null,2,'USD',false,'The Đào Tấn two-bedroom','2-Bedroom, 2-Bathroom Apartment on Dao Tan Street',array['Balcony','Bathtub','Air conditioning','Equipped kitchen','Microwave','Washing machine','TV','Cable TV','Refrigerator','Wi-Fi','Gym']::text[],null,'2026-10-21T00:00:00+00:00',1,'https://garyhome.vn/en/property/can-ho-2n-2wc-dao-tan/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('7d193d7b-e1c6-54d4-9576-ba65c7bebed6','can-ho-1n-pho-dao-tan',550,array['/images/apartments/can-ho-1n-pho-dao-tan-0.jpg','/images/apartments/can-ho-1n-pho-dao-tan-1.jpg','/images/apartments/can-ho-1n-pho-dao-tan-2.jpg','/images/apartments/can-ho-1n-pho-dao-tan-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,1,'USD',false,'A quiet corner of Đào Tấn','1-Bedroom Apartment on Dao Tan Street',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi','Gym']::text[],1,'2026-10-21T00:00:00+00:00',2,'https://garyhome.vn/en/property/can-ho-1n-pho-dao-tan/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('adde520e-5b62-55a6-85fc-96d4c09556ac','can-ho-1n-co-ban-cong-buoi',null,array['/images/apartments/can-ho-1n-co-ban-cong-buoi-0.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-1.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-2.jpg','/images/apartments/can-ho-1n-co-ban-cong-buoi-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,1,'USD',false,'A balcony above Bưởi Street','1-Bedroom Apartment with Balcony – Buoi Street',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',3,'https://garyhome.vn/en/property/can-ho-1n-co-ban-cong-buoi/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('59082e72-2a40-5eba-86ea-1efc2835d75d','can-ho-2n-gan-ho',1200,array['/images/apartments/can-ho-2n-gan-ho-1.jpg','/images/apartments/can-ho-2n-gan-ho-2.jpg','/images/apartments/can-ho-2n-gan-ho-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,2,'USD',true,'Life by the lake','2-bedroom apartment near the lake',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],2,'2026-10-21T00:00:00+00:00',4,'https://garyhome.vn/en/property/can-ho-2n-gan-ho/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('6ff23699-0337-57c7-9732-1aecdd2b5ed2','can-ho-studio-tai-dao-tan-ba-dinh',302,array['/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-3.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-1.jpg','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-2.jpg']::text[],'published','Ba Đình, Hà Nội',null,1,'USD',false,'Your own space in Ba Đình','Căn hộ Studio tại Đào Tấn, Ba Đình',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',5,'https://garyhome.vn/en/property/can-ho-studio-tai-dao-tan-ba-dinh/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Studio','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('4a91b427-7f9c-558c-8767-bebcf4fe0f9d','can-ho-2n-tai-kim-ma',950,array['/images/apartments/can-ho-2n-tai-kim-ma-0.jpg','/images/apartments/can-ho-2n-tai-kim-ma-1.jpg','/images/apartments/can-ho-2n-tai-kim-ma-2.jpg','/images/apartments/can-ho-2n-tai-kim-ma-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,2,'USD',false,'City living on Kim Mã','Căn Hộ 2N Kim Mã',array['Balcony','Bathtub','Air conditioning','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],2,'2026-10-21T00:00:00+00:00',6,'https://garyhome.vn/en/property/can-ho-2n-tai-kim-ma/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('7fa7f7c8-fe1c-5fa9-810f-d9baa4c09220','can-ho-2n-doi-can',550,array['/images/apartments/can-ho-2n-doi-can-1.jpg','/images/apartments/can-ho-2n-doi-can-2.jpg','/images/apartments/can-ho-2n-doi-can-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,2,'USD',false,'Make yourself at home in Đội Cấn','Căn hộ 2N Đội Cấn',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','TV','Cable TV','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',7,'https://garyhome.vn/en/property/can-ho-2n-doi-can/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('c305aafc-b470-5833-930b-2d9190605eaf','can-ho-1n-tai-290-kim-ma',400,array['/images/apartments/can-ho-1n-tai-290-kim-ma-0.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-1.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-2.jpg','/images/apartments/can-ho-1n-tai-290-kim-ma-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,1,'USD',false,'Căn hộ 1N tại 290 Kim Mã','Căn hộ 1N tại 290 Kim Mã',array['Balcony','Air conditioning','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',8,'https://garyhome.vn/en/property/can-ho-1n-tai-290-kim-ma/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('8412dd15-0dc0-5b87-b052-aeec33cb6130','can-studio-tai-ngoa-long-bac-tu-liem',170,array['/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-1.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-2.jpg','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-3.jpg']::text[],'published','Hà Nội',null,1,'USD',false,'A bright studio, all your own','Căn Studio tại Ngoạ Long, Bắc Từ Liêm',array['Balcony','Air conditioning','Equipped kitchen','Washing machine','Curtains','Refrigerator']::text[],1,'2026-10-21T00:00:00+00:00',9,'https://garyhome.vn/en/property/can-studio-tai-ngoa-long-bac-tu-liem/','2026-10-21T00:00:00+00:00','on_request','rent','bac-tu-liem','Studio','Explore this home in Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('6b9bf10b-d4b5-5519-943b-ac5f07eea87a','can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep',604,array['/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-1.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-2.jpg','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-3.jpg']::text[],'published','Long Biên, Hà Nội',null,3,'USD',true,'Căn hộ 3 ngủ tại Ngọc thuỵ, Long Biên siêu đẹp','Căn hộ 3 ngủ tại Ngọc thuỵ, Long Biên siêu đẹp',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','TV','Cable TV','Refrigerator','Wi-Fi']::text[],2,'2026-10-21T00:00:00+00:00',10,'https://garyhome.vn/en/property/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep/','2026-10-21T00:00:00+00:00','on_request','rent','long-bien','Apartment','Explore this home in Long Biên, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Long Biên, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('b410e961-bd9a-5d3a-a24f-9157d888795b','can-ho-studio-tai-thuy-khe-tay-ho-2',245,array['/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-1.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-2.jpg','/images/apartments/can-ho-studio-tai-thuy-khe-tay-ho-2-3.jpg']::text[],'published','Ba Đình, Hà Nội',null,1,'USD',false,'A bright studio, all your own','Căn hộ Studio tại Thuỵ Khê, Tây Hồ',array['Air conditioning','Equipped kitchen','Washing machine','Curtains','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',11,'https://garyhome.vn/en/property/can-ho-studio-tai-thuy-khe-tay-ho-2/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Studio','Explore this home in Ba Đình, Hà Nội. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Ba Đình, Hà Nội. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('b8144180-eb33-57c7-9dc6-a5e2bbf0dc0c','lux-apartment-in-dang-thai-ma-tay-ho',1600,array['/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-2.jpg','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-3.jpg']::text[],'published','Phố Đặng Thai Mai, Khu biệt thự bán đảo Hồ Tây, Phường Tây Hồ, Hà Nội, 11214, Việt Nam',null,3,'USD',true,'Lux Apartment in Dang Thai Ma, Tay Ho','Lux Apartment in Dang Thai Ma, Tay Ho',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','Cable TV','Refrigerator','Wi-Fi']::text[],2,'2026-10-21T00:00:00+00:00',13,'https://garyhome.vn/en/property/lux-apartment-in-dang-thai-ma-tay-ho/','2026-10-21T00:00:00+00:00','on_request','rent','tay-ho','Apartment','Explore this home in Phố Đặng Thai Mai, Khu biệt thự bán đảo Hồ Tây, Phường Tây Hồ, Hà Nội, 11214, Việt Nam. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Phố Đặng Thai Mai, Khu biệt thự bán đảo Hồ Tây, Phường Tây Hồ, Hà Nội, 11214, Việt Nam. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('8a49ed3e-76f4-5ef9-aadb-badbba112752','cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho',380,array['/images/apartments/gary-way.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-1.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-2.jpg','/images/apartments/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho-3.jpg']::text[],'published','An Duong Vuong, Tay Ho',null,1,'USD',true,'A bright studio, all your own','Cho thuê căn hộ Studio mới  tại An Duong Vuong, Tay Ho',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Curtains','Cable TV','Refrigerator','Wi-Fi']::text[],1,'2026-10-21T00:00:00+00:00',14,'https://garyhome.vn/en/property/cho-thue-can-ho-studio-moi-tai-an-duong-vuong-tay-ho/','2026-10-21T00:00:00+00:00','on_request','rent','tay-ho','Studio','Explore this home in An Duong Vuong, Tay Ho. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại An Duong Vuong, Tay Ho. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
insert into public.properties (id,slug,price,images,status,address,area_sqm,bedrooms,currency,featured,title_en,title_vi,amenities,bathrooms,created_at,sort_order,source_url,updated_at,availability,listing_type,district_slug,property_type,description_en,description_vi) values ('fb60c2dd-0a3c-55a9-824f-0828f4435a83','can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh',600,array['/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-0.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-1.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-2.jpg','/images/apartments/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh-3.jpg']::text[],'published','Hoang Hoa Tham, Ba Dinh',null,1,'USD',true,'A welcoming home on Hoàng Hoa Thám','Căn hộ dịch vụ một ngủ cao cấp tại Hoang Hoa Tham, Ba Dinh từ 600$ – 800$',array['Balcony','Air conditioning','Equipped kitchen','Microwave','Washing machine','Dryer','Curtains','Refrigerator','Wi-Fi','Gym']::text[],1,'2026-10-21T00:00:00+00:00',15,'https://garyhome.vn/en/property/can-ho-dich-vu-mot-ngu-cao-cap-tai-hoang-hoa-tham-ba-dinh/','2026-10-21T00:00:00+00:00','on_request','rent','ba-dinh','Apartment','Explore this home in Hoang Hoa Tham, Ba Dinh. Browse the original property photos, save it to your shortlist, and ask our local team about the lease, included services, and current availability. We will help you arrange a viewing that fits your schedule.','Khám phá căn hộ tại Hoang Hoa Tham, Ba Dinh. Xem ảnh thực tế, lưu vào danh sách yêu thích và liên hệ đội ngũ Gary Home để xác nhận tình trạng, điều kiện thuê và đặt lịch xem nhà.') on conflict (id) do nothing;
commit;
