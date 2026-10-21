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
