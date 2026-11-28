-- Fresh projects only. Existing projects should apply individual migrations.
do $home_setup$
begin
  if to_regclass('public.team_members') is not null or to_regclass('public.properties') is not null then
    raise exception 'Gary Home is already initialized. Apply only the pending migrations.' using errcode='55000';
  end if;
end;
$home_setup$;
-- Migration: 20261021152453_gary_home_cms.sql
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

-- Migration: 20261021201948_customer_portal.sql
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

-- Generated by npm run seed:generate. Existing CMS edits are preserved.
begin;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('tay-ho','Tây Hồ','Lakeside living, at your pace.','An yên bên hồ, theo nhịp của bạn.','Morning walks by West Lake. Coffee on a quiet side street. Discover homes in one of Hanoi’s best-known lakeside neighbourhoods.','Dạo bộ bên Hồ Tây mỗi sáng, thưởng thức cà phê trong những con ngõ yên tĩnh. Khám phá không gian sống bên hồ giữa lòng Hà Nội.','/images/apartments/area-tay-ho.jpg',0) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('ba-dinh','Ba Đình','The city’s history. Your new story.','Nét xưa của phố. Câu chuyện mới của bạn.','Tree-lined streets, familiar local markets, and the city’s historic heart. Explore apartments around Đào Tấn, Kim Mã, and Đội Cấn.','Những con phố rợp bóng cây, khu chợ thân quen và trái tim lịch sử của thành phố. Khám phá căn hộ quanh Đào Tấn, Kim Mã và Đội Cấn.','/images/area-ba-dinh.jpg',1) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('long-bien','Long Biên','A little more space to breathe.','Thêm không gian để tận hưởng.','Across the Red River, discover a different rhythm of Hanoi. Explore homes in Ngọc Thụy and the surrounding residential neighbourhoods.','Bên kia sông Hồng là một nhịp sống Hà Nội khác. Khám phá nhà ở tại Ngọc Thụy và các khu dân cư lân cận.','/images/apartments/area-long-bien.jpg',2) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('bac-tu-liem','Bắc Từ Liêm','A fresh start, within reach.','Khởi đầu mới, trong tầm tay.','Find your own corner of western Hanoi, with studios and apartments to suit a range of budgets.','Tìm góc riêng của bạn tại phía Tây Hà Nội với các căn studio và căn hộ phù hợp nhiều mức ngân sách.','/images/apartments/can-studio-tai-ngoa-long-bac-tu-liem-0.jpg',3) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('cau-giay','Cầu Giấy','An everyday rhythm in western Hanoi.','Nhịp sống thường ngày phía Tây Hà Nội.','Explore Cầu Giấy, from the skyline to its neighbourhood streets. Tell us your preferred address and budget so the team can check suitable rentals.','Khám phá Cầu Giấy, từ những tòa nhà cao tầng đến các khu phố dân cư. Chia sẻ vị trí và ngân sách mong muốn để đội ngũ kiểm tra nhà thuê phù hợp.','/images/neighbourhoods/cau-giay.jpg',4) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('hoan-kiem','Hoàn Kiếm','At the heart of Hanoi.','Giữa trái tim Hà Nội.','Discover the streets around Hoàn Kiếm Lake. Share the part of the centre you have in mind, and we will help you compare available rental options.','Khám phá những con phố quanh Hồ Hoàn Kiếm. Chia sẻ khu vực trung tâm bạn yêu thích để cùng so sánh các lựa chọn thuê hiện có.','/images/neighbourhoods/hoan-kiem.jpg',5) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('dong-da','Đống Đa','A neighbourhood with stories to tell.','Khu phố lưu giữ những câu chuyện.','The Temple of Literature offers a glimpse of Đống Đa’s history. Tell us where you would like to live, and the team can help with your rental search.','Văn Miếu gợi mở một phần lịch sử Đống Đa. Hãy chia sẻ nơi bạn muốn sống để đội ngũ hỗ trợ tìm nhà thuê.','/images/neighbourhoods/dong-da.jpg',6) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('hai-ba-trung','Hai Bà Trưng','City life, with a green pause.','Nhịp sống phố, khoảng xanh riêng.','Get to know the area around Thống Nhất Park and the surrounding streets. Ask us to check rentals that fit your daily routine and preferred location.','Tìm hiểu khu vực quanh công viên Thống Nhất và những con phố lân cận. Nhờ đội ngũ kiểm tra nhà thuê phù hợp với sinh hoạt và vị trí bạn mong muốn.','/images/neighbourhoods/hai-ba-trung.jpg',7) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('nam-tu-liem','Nam Từ Liêm','A new perspective on western Hanoi.','Một góc nhìn mới phía Tây Hà Nội.','Explore the Mỹ Đình area and Nam Từ Liêm neighbourhoods. Share the building or street you prefer so we can discuss current availability and lease terms.','Khám phá Mỹ Đình và các khu dân cư Nam Từ Liêm. Chia sẻ tòa nhà hoặc tuyến phố bạn quan tâm để trao đổi tình trạng và điều kiện thuê hiện tại.','/images/neighbourhoods/nam-tu-liem.jpg',8) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('thanh-xuan','Thanh Xuân','Your own corner of the city.','Một góc thành phố dành cho bạn.','Royal City is one of Thanh Xuân’s recognisable landmarks. Tell us your preferred neighbourhood or building, and we can help you explore rental options.','Royal City là một điểm nhấn quen thuộc tại Thanh Xuân. Chia sẻ khu dân cư hoặc tòa nhà bạn yêu thích để cùng tìm hiểu các lựa chọn thuê.','/images/neighbourhoods/thanh-xuan.jpg',9) on conflict (slug) do nothing;
insert into public.neighbourhoods (slug,name,tagline_en,tagline_vi,description_en,description_vi,image,sort_order) values ('ha-dong','Hà Đông','Local craft. A place to settle.','Nét làng nghề. Chốn an cư.','From Vạn Phúc’s silk village to the surrounding neighbourhoods, discover another side of Hanoi. Contact the team to check rental options in Hà Đông.','Từ làng lụa Vạn Phúc đến các khu dân cư lân cận, khám phá một góc Hà Nội khác. Liên hệ đội ngũ để kiểm tra các lựa chọn thuê tại Hà Đông.','/images/neighbourhoods/ha-dong.jpg',10) on conflict (slug) do nothing;
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

-- Migration: 20261022042327_customer_social_auth_staff_access.sql
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

-- Migration: 20261023093632_rental_catalogue_brand_and_authors.sql
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

-- Migration: 20261023113426_quarantine_unverified_rental_location.sql
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

-- Migration: 20261023120537_restore_hero_and_unify_favourites.sql
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

-- Migration: 20261023124900_media_paths_and_messaging.sql
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

-- Migration: 20261023125023_card_ordering_manager_access.sql
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

-- Migration: 20261023134954_feedback_and_assistance_reports.sql
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

-- Migration: 20261024072805_our_team_collection_image.sql
begin;
-- Supplied collage for Our Team; preserve any subsequent CMS changes.
insert into public.site_activities(id,category,media_kind,caption_en,caption_vi,image_url,source_url,published,sort_order)
values('a3a31423-c458-5988-b9f8-8720996f64ed','team','photo','From our team collection','Hình ảnh từ bộ sưu tập của đội ngũ','/images/ourteam/gary-home-team.png','',true,0)
on conflict(id) do nothing;
notify pgrst, 'reload schema';
commit;

-- Migration: 20261024173814_staff_gmail_inbox_and_deletion_controls.sql
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

-- Migration: 20261025033745_staff_password_setup_retries.sql
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

-- Migration: 20261025055215_direct_staff_accounts_profiles_and_notifications.sql
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

-- Migration: 20261025064523_staff_activity_account_deletion.sql
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

-- Migration: 20261025080124_staff_temporary_password_controls.sql
begin;

-- Only assigned, active, lower-level staff are eligible. Reuse the same fresh
-- Auth-email and membership checks as recovery, and forbid self resets here.
-- Passwords never enter this RPC or the database activity log.
create function private.staff_temporary_password_request(target_user_id uuid,failed boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare target_email text;
begin
 if auth.uid() is null or target_user_id=auth.uid() then raise exception 'Use your own profile to change your password' using errcode='42501';end if;
 if failed is null then raise exception 'Check the request' using errcode='23514';end if;
 target_email:=private.staff_reset_email(target_user_id);
 if not failed then
  update public.team_members set password_change_reminder=true,updated_at=now() where user_id=target_user_id;
 end if;
 perform private.append_studio_event('team',case when failed then 'password.temporary_failed' else 'password.temporary_requested' end,target_user_id,
  (select display_name from public.team_members where user_id=target_user_id),
  (select role from public.team_members where user_id=target_user_id));
 return target_email;
end; $$;
create function public.staff_temporary_password_request(target_user_id uuid,failed boolean default false) returns text
language sql security invoker set search_path='' as $$select private.staff_temporary_password_request(target_user_id,failed);$$;
revoke all on function private.staff_temporary_password_request(uuid,boolean),public.staff_temporary_password_request(uuid,boolean) from public,anon;
grant execute on function private.staff_temporary_password_request(uuid,boolean),public.staff_temporary_password_request(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;

-- Migration: 20261026042448_landlord_introductions_and_private_uploads.sql
begin;

create table public.landlord_submissions (
 id uuid primary key,
 user_id uuid references auth.users(id) on delete set null,
 enquiry_id uuid references public.enquiries(id) on delete set null,
 owner_name text not null check(char_length(btrim(owner_name)) between 2 and 120),
 email text not null check(char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 phone text not null default '' check(char_length(phone)<=40),
 address text not null check(char_length(btrim(address)) between 5 and 300),
 district_slug text references public.neighbourhoods(slug) on delete set null,
 property_type text not null check(property_type in ('Apartment','Villa/Duplex','Office & Restaurant','Vinhomes')),
 bedrooms integer not null check(bedrooms between 0 and 50),
 bathrooms integer check(bathrooms between 0 and 50),
 area_sqm numeric(10,2) check(area_sqm>0),
 expected_rent numeric(14,2) check(expected_rent>=0),
 currency text not null default 'USD' check(currency='USD'),
 message text not null check(char_length(btrim(message)) between 10 and 4000),
 status text not null default 'new' check(status in ('new','reviewing','needs_details','ready','converted','declined','archived')),
 assigned_to uuid references auth.users(id) on delete set null,
 staff_notes text not null default '' check(char_length(staff_notes)<=8000),
 listing_id uuid references public.properties(id) on delete set null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index landlord_queue_idx on public.landlord_submissions(created_at desc,id desc);
create index landlord_assignee_idx on public.landlord_submissions(assigned_to);
create index landlord_user_idx on public.landlord_submissions(user_id);
create index landlord_enquiry_idx on public.landlord_submissions(enquiry_id);
create index landlord_listing_idx on public.landlord_submissions(listing_id);
create index landlord_district_idx on public.landlord_submissions(district_slug);
alter table public.landlord_submissions enable row level security;
revoke all on public.landlord_submissions from public,anon,authenticated;
grant select on public.landlord_submissions to authenticated;
grant all on public.landlord_submissions to service_role;
create policy landlord_staff_read on public.landlord_submissions for select to authenticated using((select private.is_editor()));

create table public.landlord_submission_files (
 id uuid primary key,
 submission_id uuid not null references public.landlord_submissions(id) on delete cascade,
 storage_path text not null unique check(storage_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp|avif|pdf)$' and split_part(storage_path,'/',1)=submission_id::text),
 original_name text not null check(char_length(original_name) between 1 and 160),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','image/avif','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),
 created_at timestamptz not null default now()
);
create index landlord_files_submission_idx on public.landlord_submission_files(submission_id);
alter table public.landlord_submission_files enable row level security;
revoke all on public.landlord_submission_files from public,anon,authenticated;
grant select on public.landlord_submission_files to authenticated;
grant all on public.landlord_submission_files to service_role;
create policy landlord_files_staff_read on public.landlord_submission_files for select to authenticated using((select private.is_editor()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('landlord-files','landlord-files',false,5242880,array['image/jpeg','image/png','image/webp','image/avif','application/pdf']);
-- Only a signed upload capability issued by the server can write a file.
-- Staff may read attachments only after they have been linked to a submission.
create policy landlord_attachment_read on storage.objects for select to authenticated using(
 bucket_id='landlord-files' and (select private.is_editor()) and exists(select 1 from public.landlord_submission_files f where f.storage_path=name)
);

create table private.landlord_upload_limits (
 client_key text primary key check(length(client_key)=64),window_started timestamptz not null,
 requests integer not null,total_bytes bigint not null
);
create index landlord_upload_window_idx on private.landlord_upload_limits(window_started);
alter table private.landlord_upload_limits enable row level security;
revoke all on private.landlord_upload_limits from public,anon,authenticated;
create policy landlord_limits_service on private.landlord_upload_limits to service_role using(true) with check(true);
grant usage on schema private to service_role;
grant all on private.landlord_upload_limits to service_role;
create function public.reserve_landlord_upload(client_key text,upload_bytes bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare allowed boolean;
begin
 if client_key is null or length(client_key)<>64 or upload_bytes is null or upload_bytes<0 or upload_bytes>31457280 then return false;end if;
 insert into private.landlord_upload_limits as q values(client_key,now(),1,upload_bytes)
 on conflict on constraint landlord_upload_limits_pkey do update set
 window_started=case when q.window_started<now()-interval '24 hours' then now() else q.window_started end,
 requests=case when q.window_started<now()-interval '24 hours' then 1 else q.requests+1 end,
 total_bytes=case when q.window_started<now()-interval '24 hours' then upload_bytes else q.total_bytes+upload_bytes end
 where q.window_started<now()-interval '24 hours' or (q.requests<5 and q.total_bytes+upload_bytes<=131072000)
 returning true into allowed;
 delete from private.landlord_upload_limits q where q.window_started<now()-interval '7 days';
 return coalesce(allowed,false);
end; $$;

-- Service-only transaction: no caller-supplied review, assignment or publishing
-- fields are used. Repeating a finalisation returns the same receipt.
grant insert,select on public.enquiries to service_role;
grant insert on public.studio_notifications to service_role;
create function public.finalize_landlord_submission(submission_id uuid,verified_user uuid,details jsonb,files jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare enquiry uuid; file jsonb;
begin
 if submission_id is null or jsonb_typeof(details)<>'object' or jsonb_typeof(files)<>'array' or jsonb_array_length(files)>6 then raise exception 'Invalid introduction' using errcode='23514';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(submission_id::text,0));
 if exists(select 1 from public.landlord_submissions s where s.id=submission_id) then return submission_id;end if;
 insert into public.enquiries(name,email,phone,message,kind,consent,user_id)
 values(details->>'owner_name',lower(details->>'email'),coalesce(details->>'phone',''),details->>'message','landlord',true,verified_user) returning id into enquiry;
 insert into public.landlord_submissions(id,user_id,enquiry_id,owner_name,email,phone,address,district_slug,property_type,bedrooms,bathrooms,area_sqm,expected_rent,currency,message)
 values(submission_id,verified_user,enquiry,details->>'owner_name',lower(details->>'email'),coalesce(details->>'phone',''),details->>'address',nullif(details->>'district_slug',''),details->>'property_type',(details->>'bedrooms')::integer,(details->>'bathrooms')::integer,(details->>'area_sqm')::numeric,(details->>'expected_rent')::numeric,details->>'currency',details->>'message');
 for file in select value from jsonb_array_elements(files) loop
  insert into public.landlord_submission_files(id,submission_id,storage_path,original_name,mime_type,size_bytes)
  values((file->>'id')::uuid,submission_id,file->>'path',file->>'name',file->>'type',(file->>'size')::integer);
 end loop;
 insert into public.studio_notifications(category,action,details) values('landlord','landlord.received',jsonb_build_object('record_id',submission_id));
 return submission_id;
end; $$;

create function public.unused_landlord_uploads() returns table(storage_path text)
language sql stable security invoker set search_path='' as $$
 select o.name from storage.objects o where o.bucket_id='landlord-files' and o.created_at<now()-interval '24 hours'
 and not exists(select 1 from public.landlord_submission_files f where f.storage_path=o.name) order by o.created_at limit 50;
$$;
revoke all on function public.reserve_landlord_upload(text,bigint),public.finalize_landlord_submission(uuid,uuid,jsonb,jsonb),public.unused_landlord_uploads() from public,anon,authenticated;
grant execute on function public.reserve_landlord_upload(text,bigint),public.finalize_landlord_submission(uuid,uuid,jsonb,jsonb),public.unused_landlord_uploads() to service_role;

create function private.review_landlord_submission(target uuid,decision text,notes text,assignee uuid) returns void
language plpgsql security definer set search_path='' as $$
declare row public.landlord_submissions; manager boolean;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 manager:=private.can_order_properties();
 select * into row from public.landlord_submissions where id=target for update;
 if row.id is null then raise exception 'Introduction not found' using errcode='P0002';end if;
 if decision is null or decision not in ('new','reviewing','needs_details','ready','converted','declined','archived') or notes is null or length(notes)>8000 or (decision='converted' and row.listing_id is null) then raise exception 'Check review details' using errcode='23514';end if;
 if assignee is distinct from row.assigned_to then
  if not manager then raise exception 'Manager access required to assign' using errcode='42501';end if;
  if assignee is not null and not exists(select 1 from private.staff_photo_directory() d where d.user_id=assignee) then raise exception 'Choose an active team member' using errcode='23514';end if;
  perform private.append_studio_event('landlord','landlord.assigned',null,'',null,jsonb_build_object('record_id',target));
 end if;
 update public.landlord_submissions set status=decision,staff_notes=notes,assigned_to=assignee,updated_at=now() where id=target;
 perform private.append_studio_event('landlord','landlord.reviewed',null,'',null,jsonb_build_object('record_id',target,'status',decision));
end; $$;
create function public.review_landlord_submission(target uuid,decision text,notes text,assignee uuid) returns void language sql security invoker set search_path='' as $$select private.review_landlord_submission(target,decision,notes,assignee);$$;

create function private.landlord_listing_draft(target uuid,district text) returns uuid
language plpgsql security definer set search_path='' as $$
declare row public.landlord_submissions; listing uuid; district_name text; type_en text;type_vi text; rooms_en text;rooms_vi text;
begin
 if not coalesce(private.can_order_properties(),false) then raise exception 'Manager access required' using errcode='42501';end if;
 select * into row from public.landlord_submissions where id=target for update;
 if row.id is null then raise exception 'Introduction not found' using errcode='P0002';end if;
 if row.listing_id is not null then return row.listing_id;end if;
 if row.status not in ('reviewing','ready') then raise exception 'Review the property first' using errcode='23514';end if;
 select name into district_name from public.neighbourhoods where slug=district;
 if district_name is null then raise exception 'Choose a district' using errcode='23514';end if;
 listing:=gen_random_uuid();
 type_en:=case row.property_type when 'Apartment' then 'Apartment' when 'Villa/Duplex' then 'Villa / Duplex' else row.property_type end;
 type_vi:=case row.property_type when 'Apartment' then 'Căn hộ' when 'Villa/Duplex' then 'Biệt thự / Duplex' when 'Office & Restaurant' then 'Văn phòng & Nhà hàng' else row.property_type end;
 rooms_en:=case when row.property_type='Office & Restaurant' then '' when row.bedrooms=0 then 'studio ' else row.bedrooms::text||'-bedroom ' end;
 rooms_vi:=case when row.property_type='Office & Restaurant' then '' when row.bedrooms=0 then ' studio' else ' '||row.bedrooms::text||' phòng ngủ' end;
 -- Contact details, private owner notes and unreviewed attachments are never
 -- copied into publicly readable listing fields or the public media bucket.
 insert into public.properties(id,slug,title_en,title_vi,address,district_slug,property_type,bedrooms,bathrooms,area_sqm,price,currency,status,listing_type,availability,description_en,description_vi)
 values(listing,'rental-'||listing::text,left(rooms_en||type_en||' for rent in '||district_name,200),left(type_vi||rooms_vi||' cho thuê tại '||district_name,200),row.address,district,row.property_type,row.bedrooms,row.bathrooms,row.area_sqm,row.expected_rent,row.currency,'draft','rent','on_request','','');
 update public.landlord_submissions set listing_id=listing,district_slug=district,status='converted',updated_at=now() where id=target;
 perform private.append_studio_event('landlord','landlord.draft_created',null,'',null,jsonb_build_object('record_id',target,'listing_id',listing));
 return listing;
end; $$;
create function public.landlord_listing_draft(target uuid,district text) returns uuid language sql security invoker set search_path='' as $$select private.landlord_listing_draft(target,district);$$;
revoke all on function private.review_landlord_submission(uuid,text,text,uuid),public.review_landlord_submission(uuid,text,text,uuid),private.landlord_listing_draft(uuid,text),public.landlord_listing_draft(uuid,text) from public,anon;
grant execute on function private.review_landlord_submission(uuid,text,text,uuid),public.review_landlord_submission(uuid,text,text,uuid),private.landlord_listing_draft(uuid,text),public.landlord_listing_draft(uuid,text) to authenticated;

alter table public.studio_notifications drop constraint studio_notifications_category_check;
alter table public.studio_notifications add constraint studio_notifications_category_check check(category in ('team','profile','enquiry','feedback','commission','landlord'));
drop policy studio_notifications_staff_read on public.studio_notifications;
create policy studio_notifications_staff_read on public.studio_notifications for select to authenticated using(
 (select private.is_editor()) and (
 category in ('enquiry','feedback','landlord') or category='commission' and (select private.can_order_properties()) or
 category in ('team','profile') and ((select private.staff_role())='owner' or actor_user_id=(select auth.uid()) or target_user_id=(select auth.uid()) or (select private.staff_rank(private.staff_role()))>=2 and private.staff_rank(target_role)<(select private.staff_rank(private.staff_role())))
 ));
create function private.delete_landlord_submission(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare row public.landlord_submissions;
begin
 if not coalesce(private.is_editor(),false) or private.staff_role() not in ('owner','admin') then raise exception 'Owner or admin access required' using errcode='42501';end if;
 select * into row from public.landlord_submissions where id=target for update;
 if row.id is null then raise exception 'Introduction not found' using errcode='P0002';end if;
 delete from public.landlord_submissions where id=target;
 delete from public.enquiries where id=row.enquiry_id and kind='landlord';
 perform private.append_studio_event('landlord','landlord.deleted',null,'',null,jsonb_build_object('record_id',target));
end; $$;
create function public.delete_landlord_submission(target uuid) returns void language sql security invoker set search_path='' as $$select private.delete_landlord_submission(target);$$;
revoke all on function private.delete_landlord_submission(uuid),public.delete_landlord_submission(uuid) from public,anon;
grant execute on function private.delete_landlord_submission(uuid),public.delete_landlord_submission(uuid) to authenticated;
commit;

-- Migration: 20261026064456_staff_peer_and_lower_role_visibility.sql
begin;

-- A pure rank comparison matches the browser helper. Callers must obtain the
-- actor role from private.staff_role(), never a supplied JWT/user-metadata role.
create function private.can_view_staff_role(actor_role text,target_role text) returns boolean
language sql immutable security invoker set search_path='' as $$
 select private.staff_rank(target_role)>0 and private.staff_rank(target_role)<=private.staff_rank(actor_role);
$$;
revoke all on function private.can_view_staff_role(text,text) from public,anon;
grant execute on function private.can_view_staff_role(text,text) to authenticated;

create or replace function private.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)=0 then raise exception 'Staff access required' using errcode='42501';end if;
 return query select m.user_id,m.email,m.display_name,m.role,m.active,u.email_confirmed_at is not null,m.created_at,m.updated_at
 from public.team_members m join auth.users u on u.id=m.user_id
 where m.email is not null and private.can_view_staff_role(actor_role,m.role) and (after_email is null or m.email>after_email)
 order by m.email limit 51;
end; $$;

-- Protect the direct profile API too, instead of relying on the rendered list.
-- This private lookup bypasses members_read_self only to check the target's
-- assigned role; it returns no contact/profile fields and uses fresh membership.
create function private.can_view_staff_account(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and private.can_view_staff_role(private.staff_role(),(select m.role from public.team_members m where m.user_id=target));
$$;
revoke all on function private.can_view_staff_account(uuid) from public,anon;
grant execute on function private.can_view_staff_account(uuid) to authenticated;
drop policy staff_profiles_staff_read on public.staff_profiles;
create policy staff_profiles_staff_read on public.staff_profiles for select to authenticated using(private.can_view_staff_account(user_id));

create or replace function private.staff_photo_directory() returns table(user_id uuid,display_name text,avatar_path text)
language plpgsql stable security definer set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)=0 then raise exception 'Staff access required' using errcode='42501';end if;
 return query select m.user_id,m.display_name,coalesce(p.avatar_path,'')
 from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main' left join public.staff_profiles p on p.user_id=m.user_id
 where m.active and u.email_confirmed_at is not null and m.email=lower(u.email)
 and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains)) and private.can_view_staff_role(actor_role,m.role)
 order by m.display_name,m.user_id limit 500;
end; $$;

create or replace function private.attribution_staff() returns table(user_id uuid,display_name text,role text)
language plpgsql stable security definer set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then return;end if;
 return query select m.user_id,coalesce(nullif(m.display_name,''),split_part(u.email,'@',1)),m.role::text
 from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.active and u.email_confirmed_at is not null and m.email=lower(u.email)
 and (m.bootstrap_owner or lower(split_part(u.email,'@',2))=any(s.email_domains)) and private.can_view_staff_role(actor_role,m.role)
 order by m.display_name,m.user_id;
end; $$;

-- A reviewer may retain an existing higher-role commission assignment without
-- receiving that account in a picker. This boolean lookup returns no identity
-- fields, and does not permit creating a new higher-role assignment.
create function private.can_retain_assistance_credit(report_id uuid,target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (select private.can_order_properties()) and exists(
 select 1 from public.assistance_reviews r join public.team_members m on m.user_id=r.credited_staff_id
 join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where r.report_id=can_retain_assistance_credit.report_id and r.credited_staff_id=target
 and m.active and u.email_confirmed_at is not null and m.email=lower(u.email)
 and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains))
 and private.staff_rank(m.role)>private.staff_rank(private.staff_role()));
$$;
revoke all on function private.can_retain_assistance_credit(uuid,uuid) from public,anon;
grant execute on function private.can_retain_assistance_credit(uuid,uuid) to authenticated;

create or replace function public.review_property_assistance(report uuid,decision text,credited_staff uuid default null,helper text default '',review_notes text default '') returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.can_order_properties(),false) then raise exception 'Owner, admin or manager access required' using errcode='42501';end if;
 if decision is null or decision not in ('verified','needs_details','declined') or char_length(btrim(helper))>160 or char_length(review_notes)>4000 or (decision='verified' and char_length(btrim(helper))<2) then raise exception 'Check attribution details' using errcode='23514';end if;
 perform 1 from public.property_assistance where id=report for update;
 if not found then raise exception 'Report no longer exists' using errcode='P0002';end if;
 if credited_staff is not null and not exists(select 1 from private.attribution_staff() s where s.user_id=credited_staff) and not private.can_retain_assistance_credit(report,credited_staff) then raise exception 'Choose an active staff account from your directory' using errcode='23514';end if;
 update public.property_assistance set status=decision where id=report;
 insert into public.assistance_reviews(report_id,credited_staff_id,confirmed_helper,internal_notes,reviewed_by,reviewed_at)
 values(report,credited_staff,btrim(coalesce(helper,'')),coalesce(review_notes,''),auth.uid(),now())
 on conflict(report_id) do update set credited_staff_id=excluded.credited_staff_id,confirmed_helper=excluded.confirmed_helper,internal_notes=excluded.internal_notes,reviewed_by=auth.uid(),reviewed_at=now();
end; $$;

-- Mutating access, role assignment, deletion and password functions retain
-- their existing strict-lower-rank guards. Peers can be viewed, never managed.
commit;

-- Migration: 20261026064510_published_feedback_realtime.sql
begin;
-- Broadcast only the sanitized, consented and moderated public copy. Private
-- submissions, email addresses and customer account IDs are never published.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='feedback_public') then
  alter publication supabase_realtime add table public.feedback_public;
 end if;
end;$$;
commit;

-- Migration: 20261026163743_editorial_articles_and_rental_tips.sql
-- News articles and rental tips share bilingual, structured content.
create function private.valid_editorial_sections(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; field text;
begin
 if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>12 or octet_length(value::text)>64000 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item)<>'object' then return false; end if;
  foreach field in array array['heading_en','heading_vi','body_en','body_vi'] loop
   if jsonb_typeof(item->field) is distinct from 'string' or length(item->>field)>12000 then return false; end if;
  end loop;
 end loop;
 return true;
end; $$;
create function private.valid_editorial_sources(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb;
begin
 if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>12 then return false; end if;
 for item in select * from jsonb_array_elements(value) loop
  if jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title') not between 1 and 300
   or jsonb_typeof(item->'url') is distinct from 'string' or length(item->>'url')>2000 or (item->>'url') !~ '^https?://[^[:space:]]+$' then return false; end if;
 end loop;
 return true;
end; $$;
revoke all on function private.valid_editorial_sections(jsonb),private.valid_editorial_sources(jsonb) from public,anon;
grant execute on function private.valid_editorial_sections(jsonb),private.valid_editorial_sources(jsonb) to authenticated,service_role;
create table public.editorial_articles (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique check(length(slug) between 1 and 180 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 kind text not null check(kind in ('news','tip')),
 title_en text not null default '' check(length(title_en)<=240), title_vi text not null default '' check(length(title_vi)<=240),
 summary_en text not null default '' check(length(summary_en)<=700), summary_vi text not null default '' check(length(summary_vi)<=700),
 category_en text not null default '' check(length(category_en)<=100), category_vi text not null default '' check(length(category_vi)<=100),
 image_url text not null default '' check(length(image_url)<=2000 and (image_url='' or image_url ~ '^https?://[^[:space:]]+$' or (left(image_url,1)='/' and left(image_url,2)<>'//' and position(E'\\' in image_url)=0))),
 sections jsonb not null default '[]' check(private.valid_editorial_sections(sections)),
 sources jsonb not null default '[]' check(private.valid_editorial_sources(sources)),
 status text not null default 'draft' check(status in ('draft','published')),
 published_on date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint editorial_ready_to_publish check(status<>'published' or (
  length(trim(title_en))>0 and length(trim(title_vi))>0 and length(trim(summary_en))>0 and length(trim(summary_vi))>0
  and jsonb_array_length(sections)>0 and not jsonb_path_exists(sections,'$[*] ? (@.heading_en == "" || @.heading_vi == "" || @.body_en == "" || @.body_vi == "")')
  and (kind<>'news' or (image_url<>'' and published_on is not null))
 ))
);
alter table public.editorial_articles enable row level security;
revoke all on public.editorial_articles from anon,authenticated;
grant select on public.editorial_articles to anon;
grant select,insert,update,delete on public.editorial_articles to authenticated,service_role;
create policy editorial_public_read on public.editorial_articles for select to anon,authenticated using(status='published');
create policy editorial_staff_read on public.editorial_articles for select to authenticated using((select private.is_editor()));
create policy editorial_staff_insert on public.editorial_articles for insert to authenticated with check((select private.is_editor()));
create policy editorial_staff_update on public.editorial_articles for update to authenticated using((select private.is_editor())) with check((select private.is_editor()));
create policy editorial_admin_delete on public.editorial_articles for delete to authenticated using((select private.is_staff_admin()));
create index editorial_public_kind_date on public.editorial_articles(kind,published_on desc,created_at desc) where status='published';
create function private.stamp_editorial_article() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.id<>old.id then raise exception 'Article identity cannot change' using errcode='22023'; end if;
  new.created_at=old.created_at;
 end if;
 new.updated_at=clock_timestamp(); return new;
end; $$;
revoke all on function private.stamp_editorial_article() from public,anon,authenticated;
create trigger stamp_editorial_article before insert or update on public.editorial_articles for each row execute function private.stamp_editorial_article();

-- Preserve the six existing, sourced articles and guides.
insert into public.editorial_articles(id,slug,kind,title_en,title_vi,summary_en,summary_vi,category_en,category_vi,image_url,sections,sources,status,published_on,created_at,updated_at) values
('61ec913e-7691-41f8-a741-b0d0cd5869c2','hanoi-rental-outlook-q3-2026','news','Hanoi serviced apartments: reading the Q3 2026 update','Căn hộ dịch vụ Hà Nội: đọc báo cáo quý III/2026','A sourced market note, followed by practical questions for your next rental enquiry.','Điểm tin có nguồn tham khảo và những câu hỏi thực tế cho lần tìm thuê tiếp theo.','Market notes','Góc nhìn thị trường','/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-0.jpg','[{"heading_en": "What the report says", "heading_vi": "Báo cáo nói gì", "body_en": "Savills’ 15 October 2026 Hanoi overview identifies tourism and foreign investment as drivers of demand for hotels and serviced apartments. This is a market-wide observation, not an availability or price quote for a particular home.", "body_vi": "Tổng quan Hà Nội do Savills công bố ngày 15/10/2026 xác định du lịch và đầu tư nước ngoài là động lực nhu cầu khách sạn, căn hộ dịch vụ. Nhận định toàn thị trường này không xác nhận giá hay tình trạng của một căn nhà cụ thể."}, {"heading_en": "Our practical takeaway", "heading_vi": "Gợi ý thực tế của Gary Home", "body_en": "Use broad market news as context, then compare the homes that meet your actual routine: location, bedrooms, natural light, pet rules and the services you will use. A headline cannot replace a viewing.\n\nAsk for a written breakdown of rent, electricity, water, internet, cleaning and parking. Compare the same set of inclusions across your shortlist instead of comparing the advertised rent alone.", "body_vi": "Dùng tin thị trường làm bối cảnh, sau đó so sánh những căn phù hợp nhịp sống thực tế: vị trí, phòng ngủ, ánh sáng, quy định thú cưng và dịch vụ bạn cần. Tiêu đề tin tức không thay thế buổi xem nhà.\n\nĐề nghị bảng chi tiết tiền thuê, điện, nước, internet, dọn phòng và đỗ xe. So sánh cùng một nhóm dịch vụ giữa các căn thay vì chỉ nhìn giá đăng."}, {"heading_en": "Send a useful enquiry", "heading_vi": "Gửi yêu cầu có đủ thông tin", "body_en": "Include the listing ID, your move-in date, intended lease length and any non-negotiable requirements. Ask the team to reconfirm availability and terms before arranging your viewing.", "body_vi": "Gửi mã tin, ngày chuyển vào, thời hạn thuê dự kiến và yêu cầu bắt buộc. Nhờ đội ngũ xác nhận lại tình trạng cùng điều kiện trước khi sắp xếp xem nhà."}]','[{"title": "Savills · Viet Nam Real Estate Market Brief Q3/2026 · 15 October 2026", "url": "https://www.savills.com/research_articles/255800/239332-1"}]','published','2026-10-26','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'),
('bdb5ab29-2456-49d4-aefd-6e1522faf68f','metro-and-your-hanoi-rental-search','news','Put the commute on your rental checklist','Đưa việc đi lại vào danh sách chọn nhà','How to test the whole journey when comparing apartments near Hanoi’s metro.','Cách kiểm tra cả hành trình khi so sánh căn hộ gần metro Hà Nội.','City & moving','Thành phố & chuyển nhà','/images/apartments/can-ho-3-ngu-tai-ngoc-thuy-long-bien-sieu-dep-0.jpg','[{"heading_en": "A useful starting point", "heading_vi": "Điểm bắt đầu hữu ích", "body_en": "Government News reported that the elevated Nhổn–Cầu Giấy segment opened on 8 August 2024, with eight stations over 8.5 kilometres. Check the operator’s current route and service information when planning a trip; a future line on a map is not a confirmed service.", "body_vi": "Báo Điện tử Chính phủ đưa tin đoạn trên cao Nhổn–Cầu Giấy khai thác từ 8/8/2024, gồm tám ga trên 8,5 km. Khi lên kế hoạch, kiểm tra tuyến và dịch vụ hiện hành từ đơn vị vận hành; tuyến tương lai trên bản đồ chưa phải dịch vụ đã hoạt động."}, {"heading_en": "Test door to door", "heading_vi": "Thử hành trình từ cửa đến cửa", "body_en": "At a viewing, walk from the building entrance to the station you would actually use. Check road crossings, pavement access, the return route and how you would manage rain or luggage.\n\nTry the journey at the time you normally travel. Include waiting, transfers and the final walk to work in your comparison. Avoid relying on a straight-line distance or an untested commute estimate.", "body_vi": "Khi xem nhà, đi bộ từ lối vào tòa nhà đến ga bạn thực sự sẽ sử dụng. Quan sát chỗ sang đường, vỉa hè, đường về và cách di chuyển lúc mưa hoặc có hành lý.\n\nThử hành trình vào giờ bạn thường đi. Tính cả chờ tàu, đổi tuyến và đoạn đi bộ cuối đến nơi làm việc. Tránh chỉ dựa vào khoảng cách đường thẳng hoặc thời gian ước lượng chưa kiểm chứng."}, {"heading_en": "Tell the team your destination", "heading_vi": "Cho đội ngũ biết điểm đến", "body_en": "Share your regular destination and preferred way of travelling with Gary Home. Use the district filter to build a shortlist, then confirm the exact building address before the viewing.", "body_vi": "Chia sẻ nơi thường đến và phương tiện mong muốn với Gary Home. Dùng bộ lọc khu vực để chọn nhà, rồi xác nhận địa chỉ tòa nhà trước khi xem."}]','[{"title": "Government News · Second metro line starts commercial run · 8 August 2024", "url": "https://en.baochinhphu.vn/ha-noi-second-metro-line-starts-commercial-run-11124080816055018.htm"}, {"title": "Hanoi Metro · operator route and station information", "url": "https://metrohanoi.vn/en/"}]','published','2026-10-26','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'),
('ba60057b-c5a1-4429-a120-6f4072998678','tay-ho-ba-dinh-neighbourhood-viewings','news','Tây Hồ or Ba Đình? Start with your everyday route','Tây Hồ hay Ba Đình? Bắt đầu từ hành trình hằng ngày','A practical way to compare two search areas without assuming every street offers the same experience.','Cách so sánh hai khu vực mà không mặc định mọi con phố đều có cùng trải nghiệm.','Neighbourhood journal','Cẩm nang khu vực','/images/apartments/can-ho-studio-tai-dao-tan-ba-dinh-0.jpg','[{"heading_en": "Landmarks are a starting point", "heading_vi": "Địa danh là điểm bắt đầu", "body_en": "Hanoi’s culture department introduces West Lake and the One Pillar Pagoda among the city’s landmarks. Those names can help orient a search, but the experience of living nearby depends on the particular street and building.", "body_vi": "Sở Văn hóa và Thể thao Hà Nội giới thiệu Hồ Tây và Chùa Một Cột trong các địa danh của thành phố. Địa danh giúp định hướng tìm kiếm, nhưng trải nghiệm sống gần đó phụ thuộc vào từng phố và tòa nhà."}, {"heading_en": "Walk the neighbourhood, not just the apartment", "heading_vi": "Đi quanh khu phố, không chỉ xem căn hộ", "body_en": "Choose one or two available homes in each area and walk the surrounding streets. Check the route to your usual destinations, where you would buy groceries, building access and the noise you notice during your visit.\n\nView at a time that reflects your routine where possible. Ask about access hours, parking, lifts and pet arrangements for the specific unit. Keep observations tied to a listing ID rather than generalising an entire neighbourhood.", "body_vi": "Chọn một hoặc hai căn còn cho thuê ở mỗi khu vực và đi quanh phố. Kiểm tra đường đến nơi thường lui tới, nơi mua thực phẩm, lối vào tòa nhà và tiếng ồn bạn cảm nhận khi đến.\n\nNếu được, xem vào giờ phù hợp với nhịp sống của bạn. Hỏi giờ ra vào, đỗ xe, thang máy và quy định thú cưng của đúng căn. Ghi nhận theo mã tin thay vì khái quát cho cả khu vực."}, {"heading_en": "Keep the comparison fair", "heading_vi": "So sánh trên cùng tiêu chí", "body_en": "Compare similar bedroom counts, furniture and included services. Save your favourites, record what you still need to confirm and ask the team about the exact homes you want to revisit.", "body_vi": "So sánh các căn có số phòng ngủ, nội thất và dịch vụ tương đồng. Lưu nhà yêu thích, ghi điều cần xác nhận và hỏi đội ngũ về đúng căn bạn muốn xem lại."}]','[{"title": "Hanoi Department of Culture and Sports · Hanoi introduction", "url": "https://sovhtt.hanoi.gov.vn/en/introduction/ha-noi-thu-do-viet-nam/"}]','published','2026-10-26','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'),
('8d59fa72-bfeb-4aa9-a400-ceb88c920aa7','prepare-your-rental-brief','tip','A clear brief makes a better shortlist','Nhu cầu rõ ràng, danh sách nhà phù hợp hơn','The details to share before you start exploring Hanoi rentals.','Những thông tin nên chia sẻ trước khi tìm nhà thuê tại Hà Nội.','','','','[{"heading_en": "Start with your everyday routine", "heading_vi": "Bắt đầu từ nhịp sống của bạn", "body_en": "Tell the team which areas you are considering, where you need to travel regularly and your preferred move-in date.\n\nShare how many bedrooms and bathrooms you need, your preferred property type and the budget range you want to explore.", "body_vi": "Cho đội ngũ biết khu vực bạn quan tâm, nơi thường xuyên di chuyển đến và ngày dự kiến chuyển vào.\n\nChia sẻ số phòng ngủ, phòng tắm, loại nhà mong muốn và khoảng ngân sách bạn muốn tìm kiếm."}, {"heading_en": "Separate essentials from preferences", "heading_vi": "Phân biệt điều cần có và điều mong muốn", "body_en": "List requirements such as pets, a lift, an equipped kitchen, outdoor space or a particular view. Use the amenities filters to narrow your search.\n\nIf an amenity is essential, ask the team to confirm it for the specific apartment rather than assuming it applies to every home in a building.", "body_vi": "Liệt kê yêu cầu như nuôi thú cưng, thang máy, bếp đầy đủ, không gian ngoài trời hoặc tầm nhìn. Dùng bộ lọc tiện nghi để thu hẹp tìm kiếm.\n\nNếu một tiện nghi là bắt buộc, hãy nhờ đội ngũ xác nhận cho đúng căn hộ, thay vì mặc định toàn bộ căn trong tòa nhà đều có."}, {"heading_en": "Keep the conversation connected", "heading_vi": "Giữ thông tin trao đổi liền mạch", "body_en": "Include property IDs when asking about homes. Save favourites and send a viewing request from the listing you want to discuss.", "body_vi": "Khi hỏi về căn nhà, hãy gửi kèm mã tin. Lưu nhà yêu thích và gửi yêu cầu xem nhà ngay từ tin đăng bạn muốn trao đổi."}]','[]','published',null,'2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'),
('6a5353af-3a98-483c-a8a9-c26d9083f6ac','viewing-checklist','tip','Make the most of a property viewing','Tận dụng buổi xem nhà','A practical list of details to look at and questions to bring along.','Những chi tiết nên quan sát và câu hỏi nên chuẩn bị khi xem nhà.','','','','[{"heading_en": "Confirm the appointment", "heading_vi": "Xác nhận lịch hẹn", "body_en": "Quote the listing ID and ask the team to confirm the current availability, meeting point and viewing time. A request becomes a confirmed appointment after the team replies.", "body_vi": "Gửi mã tin và nhờ đội ngũ xác nhận tình trạng nhà, điểm gặp và thời gian xem. Yêu cầu trở thành lịch hẹn được xác nhận sau khi đội ngũ phản hồi."}, {"heading_en": "Look beyond the cover photo", "heading_vi": "Xem kỹ hơn ảnh đại diện", "body_en": "Look at natural light, storage, furniture condition, the kitchen and bathroom, access to the building and the surroundings.\n\nAsk which furniture and appliances belong to the apartment and whether the features you need are available in the specific unit.", "body_vi": "Quan sát ánh sáng tự nhiên, chỗ cất đồ, tình trạng nội thất, bếp, phòng tắm, lối vào tòa nhà và không gian xung quanh.\n\nHỏi những đồ nội thất, thiết bị nào đi cùng căn hộ và những tiện nghi bạn cần có thực sự có trong căn đang xem hay không."}, {"heading_en": "Keep a written record", "heading_vi": "Ghi lại thông tin", "body_en": "Note the property''s ID, the quoted rent, any separately quoted services and unanswered questions. Ask the team to confirm details before making your decision.", "body_vi": "Ghi lại mã tin, mức thuê được báo, dịch vụ được báo riêng và những câu hỏi còn thiếu. Nhờ đội ngũ xác nhận thông tin trước khi quyết định."}]','[]','published',null,'2026-10-26T00:00:00Z','2026-10-26T00:00:00Z'),
('a94c0d6b-4082-4269-aa13-f7fa53f14546','organise-your-shortlist','tip','Keep your rental search in one place','Sắp xếp việc tìm nhà ở một nơi','Use favourites, property IDs and your customer portal to stay organised.','Dùng danh sách yêu thích, mã tin và cổng khách hàng để theo dõi việc tìm nhà.','','','','[{"heading_en": "Save homes you want to revisit", "heading_vi": "Lưu những căn nhà muốn xem lại", "body_en": "Use the heart on a property card to save it. Open My Favourites in the header to return to your shortlist.", "body_vi": "Dùng biểu tượng trái tim trên thẻ căn nhà để lưu. Mở Nhà yêu thích ở đầu trang để quay lại danh sách đã chọn."}, {"heading_en": "Use the property ID", "heading_vi": "Sử dụng mã tin", "body_en": "Each listing has a visible ID. Include it when contacting Gary Home so the team can identify the exact home you mean.", "body_vi": "Mỗi tin đăng có mã tin riêng. Gửi kèm mã khi liên hệ Gary Home để đội ngũ xác định chính xác căn nhà bạn đang nhắc đến."}, {"heading_en": "Follow your enquiries", "heading_vi": "Theo dõi yêu cầu", "body_en": "Sign in to the customer portal before sending a request if you want it linked to your account. You can review your requests and the team''s updates there.\n\nGuest enquiries sent before registration are not automatically added to a new account. Contact the team if you need help finding an earlier conversation.", "body_vi": "Đăng nhập cổng khách hàng trước khi gửi yêu cầu nếu muốn liên kết với tài khoản. Bạn có thể xem lại yêu cầu và cập nhật từ đội ngũ tại đó.\n\nYêu cầu gửi khi chưa đăng nhập không tự động được thêm vào tài khoản mới. Liên hệ đội ngũ nếu cần tìm lại trao đổi trước đó."}]','[]','published',null,'2026-10-26T00:00:00Z','2026-10-26T00:00:00Z')
on conflict(slug) do nothing;

-- Migration: 20261026173334_expand_hanoi_neighbourhoods.sql
-- Add genuine Hanoi areas without overwriting existing CMS edits.
-- Vinhomes is a collection link in the UI, not a district or invented listing.
INSERT INTO public.neighbourhoods (slug, name, tagline_en, tagline_vi, description_en, description_vi, image, sort_order)
VALUES
  ('cau-giay', 'Cầu Giấy', 'An everyday rhythm in western Hanoi.', 'Nhịp sống thường ngày phía Tây Hà Nội.', 'Explore Cầu Giấy, from the skyline to its neighbourhood streets. Tell us your preferred address and budget so the team can check suitable rentals.', 'Khám phá Cầu Giấy, từ những tòa nhà cao tầng đến các khu phố dân cư. Chia sẻ vị trí và ngân sách mong muốn để đội ngũ kiểm tra nhà thuê phù hợp.', '/images/neighbourhoods/cau-giay.jpg', 4),
  ('hoan-kiem', 'Hoàn Kiếm', 'At the heart of Hanoi.', 'Giữa trái tim Hà Nội.', 'Discover the streets around Hoàn Kiếm Lake. Share the part of the centre you have in mind, and we will help you compare available rental options.', 'Khám phá những con phố quanh Hồ Hoàn Kiếm. Chia sẻ khu vực trung tâm bạn yêu thích để cùng so sánh các lựa chọn thuê hiện có.', '/images/neighbourhoods/hoan-kiem.jpg', 5),
  ('dong-da', 'Đống Đa', 'A neighbourhood with stories to tell.', 'Khu phố lưu giữ những câu chuyện.', 'The Temple of Literature offers a glimpse of Đống Đa’s history. Tell us where you would like to live, and the team can help with your rental search.', 'Văn Miếu gợi mở một phần lịch sử Đống Đa. Hãy chia sẻ nơi bạn muốn sống để đội ngũ hỗ trợ tìm nhà thuê.', '/images/neighbourhoods/dong-da.jpg', 6),
  ('hai-ba-trung', 'Hai Bà Trưng', 'City life, with a green pause.', 'Nhịp sống phố, khoảng xanh riêng.', 'Get to know the area around Thống Nhất Park and the surrounding streets. Ask us to check rentals that fit your daily routine and preferred location.', 'Tìm hiểu khu vực quanh công viên Thống Nhất và những con phố lân cận. Nhờ đội ngũ kiểm tra nhà thuê phù hợp với sinh hoạt và vị trí bạn mong muốn.', '/images/neighbourhoods/hai-ba-trung.jpg', 7),
  ('nam-tu-liem', 'Nam Từ Liêm', 'A new perspective on western Hanoi.', 'Một góc nhìn mới phía Tây Hà Nội.', 'Explore the Mỹ Đình area and Nam Từ Liêm neighbourhoods. Share the building or street you prefer so we can discuss current availability and lease terms.', 'Khám phá Mỹ Đình và các khu dân cư Nam Từ Liêm. Chia sẻ tòa nhà hoặc tuyến phố bạn quan tâm để trao đổi tình trạng và điều kiện thuê hiện tại.', '/images/neighbourhoods/nam-tu-liem.jpg', 8),
  ('thanh-xuan', 'Thanh Xuân', 'Your own corner of the city.', 'Một góc thành phố dành cho bạn.', 'Royal City is one of Thanh Xuân’s recognisable landmarks. Tell us your preferred neighbourhood or building, and we can help you explore rental options.', 'Royal City là một điểm nhấn quen thuộc tại Thanh Xuân. Chia sẻ khu dân cư hoặc tòa nhà bạn yêu thích để cùng tìm hiểu các lựa chọn thuê.', '/images/neighbourhoods/thanh-xuan.jpg', 9),
  ('ha-dong', 'Hà Đông', 'Local craft. A place to settle.', 'Nét làng nghề. Chốn an cư.', 'From Vạn Phúc’s silk village to the surrounding neighbourhoods, discover another side of Hanoi. Contact the team to check rental options in Hà Đông.', 'Từ làng lụa Vạn Phúc đến các khu dân cư lân cận, khám phá một góc Hà Nội khác. Liên hệ đội ngũ để kiểm tra các lựa chọn thuê tại Hà Đông.', '/images/neighbourhoods/ha-dong.jpg', 10)
ON CONFLICT (slug) DO NOTHING;

-- Migration: 20261028085344_portal_help_and_onboarding.sql
-- Private, bilingual onboarding resources. Only the current owner can publish
-- or upload. Existing customer/staff membership helpers remain authoritative.
create table public.portal_guides (
 id uuid primary key default gen_random_uuid(),
 title_en text not null default '' check(length(title_en)<=180), title_vi text not null default '' check(length(title_vi)<=180),
 summary_en text not null default '' check(length(summary_en)<=700), summary_vi text not null default '' check(length(summary_vi)<=700),
 body_en text not null default '' check(length(body_en)<=16000), body_vi text not null default '' check(length(body_vi)<=16000),
 audience text not null default 'staff' check(audience in ('customer','staff','both')),
 minimum_role text check(minimum_role in ('editor','manager','admin','owner')),
 published boolean not null default false, sort_order integer not null default 0 check(sort_order between 0 and 9999),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(audience='staff' or minimum_role is null),
 check(not published or (length(trim(title_en))>0 and length(trim(title_vi))>0))
);
create table public.portal_guide_files (
 id uuid primary key default gen_random_uuid(), guide_id uuid not null references public.portal_guides(id) on delete cascade,
 guide_version timestamptz not null,
 storage_path text not null unique check(length(storage_path)<240),
 original_name text not null check(length(original_name) between 1 and 180 and original_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('video/mp4','video/webm','video/quicktime','application/pdf','image/gif','image/webp','image/png','image/apng','image/jpeg')),
 size_bytes bigint not null check(size_bytes between 1 and 52428800), created_at timestamptz not null default now(),
 check(split_part(storage_path,'/',2)=guide_id::text and split_part(storage_path,'/',3) ~ ('^'||id::text||'\.(mp4|webm|mov|pdf|gif|webp|png|jpg)$') and split_part(storage_path,'/',4)='')
);
create index portal_guide_files_guide_idx on public.portal_guide_files(guide_id);
create index portal_guides_created_by_idx on public.portal_guides(created_by);
create index portal_guides_library_idx on public.portal_guides(audience,sort_order,created_at) where published;
alter table public.portal_guides enable row level security;
alter table public.portal_guide_files enable row level security;
revoke all on public.portal_guides,public.portal_guide_files from anon,authenticated;
grant select,insert,delete on public.portal_guides to authenticated;
grant update(title_en,title_vi,summary_en,summary_vi,body_en,body_vi,audience,minimum_role,published,sort_order,updated_at) on public.portal_guides to authenticated;
grant select,insert,update,delete on public.portal_guides to service_role;
grant select,insert,delete on public.portal_guide_files to authenticated,service_role;
create policy portal_guides_read on public.portal_guides for select to authenticated using (
 (select auth.uid()) is not null and ((select private.staff_role())='owner' or (published and (
  audience in ('customer','both') or (audience='staff' and private.staff_rank((select private.staff_role()))>=private.staff_rank(coalesce(minimum_role,'editor')))
 )))
);
create policy portal_guides_insert on public.portal_guides for insert to authenticated with check ((select private.staff_role())='owner');
create policy portal_guides_update on public.portal_guides for update to authenticated using ((select private.staff_role())='owner') with check ((select private.staff_role())='owner');
create policy portal_guides_delete on public.portal_guides for delete to authenticated using ((select private.staff_role())='owner');
create policy portal_guide_files_read on public.portal_guide_files for select to authenticated using (exists(select 1 from public.portal_guides g where g.id=guide_id));
create policy portal_guide_files_insert on public.portal_guide_files for insert to authenticated with check (
 (select private.staff_role())='owner' and split_part(storage_path,'/',1)=(select auth.uid())::text and exists(select 1 from public.portal_guides g where g.id=guide_id)
);
create policy portal_guide_files_delete on public.portal_guide_files for delete to authenticated using ((select private.staff_role())='owner');

create function private.stamp_portal_guide() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=clock_timestamp(); else new.created_at:=old.created_at; end if;
 new.updated_at:=clock_timestamp();
 if new.published and (length(trim(new.body_en))=0 or length(trim(new.body_vi))=0) and not exists(select 1 from public.portal_guide_files f where f.guide_id=new.id) then
  raise exception 'Add written instructions in both languages or upload a visual guide before publishing' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.stamp_portal_guide() from public,anon,authenticated;
create trigger stamp_portal_guide before insert or update on public.portal_guides for each row execute function private.stamp_portal_guide();

create function private.limit_portal_guide_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare current_version timestamptz;
begin
 if auth.uid() is null or private.staff_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 -- Serialize concurrent uploads to enforce the limit across multiple tabs.
 select updated_at into current_version from public.portal_guides where id=new.guide_id for update;
 if current_version is distinct from new.guide_version then raise exception 'The guide changed during upload; review its audience before attaching this file' using errcode='40001';end if;
 if (select count(*) from public.portal_guide_files where guide_id=new.guide_id)>=12 then raise exception 'A guide supports up to 12 files' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function private.limit_portal_guide_files() from public,anon,authenticated;
create trigger limit_portal_guide_files before insert on public.portal_guide_files for each row execute function private.limit_portal_guide_files();
create function private.touch_portal_guide_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 target:=case when tg_op='DELETE' then old.guide_id else new.guide_id end;
 update public.portal_guides g set updated_at=clock_timestamp(), published=case when g.published and (length(trim(g.body_en))=0 or length(trim(g.body_vi))=0) and not exists(select 1 from public.portal_guide_files f where f.guide_id=target) then false else g.published end where g.id=target;
 return null;
end; $$;
revoke all on function private.touch_portal_guide_files() from public,anon,authenticated;
create trigger touch_portal_guide_files after insert or delete on public.portal_guide_files for each row execute function private.touch_portal_guide_files();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'portal-guides','portal-guides',false,52428800,array['video/mp4','video/webm','video/quicktime','application/pdf','image/gif','image/webp','image/png','image/apng','image/jpeg']
);
create policy portal_help_objects_read on storage.objects for select to authenticated using (
 bucket_id='portal-guides' and ((select private.staff_role())='owner' or exists(select 1 from public.portal_guide_files f where f.storage_path=objects.name))
);
create policy portal_help_objects_upload on storage.objects for insert to authenticated with check (
 bucket_id='portal-guides' and (select private.staff_role())='owner' and split_part(name,'/',1)=(select auth.uid())::text
 and exists(select 1 from public.portal_guides g where g.id::text=split_part(objects.name,'/',2))
);
create policy portal_help_objects_delete on storage.objects for delete to authenticated using (bucket_id='portal-guides' and (select private.staff_role())='owner');
-- Restrictive guards keep this bucket private even if a separate application
-- in the same project has a permissive policy. Other buckets are unaffected.
create policy portal_help_anon_guard on storage.objects as restrictive for all to anon using(bucket_id<>'portal-guides') with check(bucket_id<>'portal-guides');
create policy portal_help_read_guard on storage.objects as restrictive for select to authenticated using (
 bucket_id<>'portal-guides' or ((select private.staff_role())='owner' or exists(select 1 from public.portal_guide_files f where f.storage_path=objects.name))
);
create policy portal_help_upload_guard on storage.objects as restrictive for insert to authenticated with check (
 bucket_id<>'portal-guides' or ((select private.staff_role())='owner' and split_part(name,'/',1)=(select auth.uid())::text and exists(select 1 from public.portal_guides g where g.id::text=split_part(objects.name,'/',2)))
);
create policy portal_help_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'portal-guides') with check(bucket_id<>'portal-guides');
create policy portal_help_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'portal-guides' or (select private.staff_role())='owner');

-- Starter guides describe existing features; the owner can edit or unpublish them.
insert into public.portal_guides(id,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,audience,minimum_role,published,sort_order) values
('94e00d01-ca7d-5aad-b00b-8e5e48d996f3','Start here: your portal','Bắt đầu: cổng thông tin của bạn','Learn the navigation, language controls and safe sign-out.','Làm quen với điều hướng, ngôn ngữ và đăng xuất an toàn.','1. Choose Customer account for your home search, or Staff login for an assigned team account. A customer registration does not grant staff access.

2. Use the portal menu to open a section. On a phone, scroll or expand the navigation when needed. The language control changes between English and Vietnamese.

3. Use Refresh if a connection was interrupted. Wait for a save confirmation before leaving a form; do not repeatedly submit an uncertain write.

4. Use Sign out on a shared device. Never share your password or password-reset link.','1. Chọn Tài khoản khách hàng để tìm nhà, hoặc Đăng nhập nhân viên với tài khoản đã được cấp quyền. Đăng ký khách hàng không cấp quyền nhân viên.

2. Dùng menu trong cổng để mở từng mục. Trên điện thoại, cuộn hoặc mở phần điều hướng khi cần. Bộ chuyển ngôn ngữ cho phép chọn tiếng Anh và tiếng Việt.

3. Dùng Làm mới nếu kết nối bị gián đoạn. Đợi xác nhận lưu trước khi rời biểu mẫu; không gửi liên tục khi chưa chắc thao tác đã hoàn tất.

4. Đăng xuất khi dùng thiết bị chung. Không chia sẻ mật khẩu hoặc liên kết đặt lại mật khẩu.','both',null,true,0),
('d7369854-e9e8-566d-85b7-5c89b2274b21','Find a home and save your favourites','Tìm nhà và lưu danh sách yêu thích','Use filters and property IDs, then keep a shortlist across devices.','Dùng bộ lọc và mã tin, rồi lưu danh sách trên nhiều thiết bị.','1. Open Apartments or Find Your Rental. Filter by district, property type, bedrooms, bathrooms and budget. Requirements includes pets, gym, BBQ, lake view and other amenities.

2. If you already have a code, enter the Property / Post ID, such as GH-000005. Each listing displays its own unique ID.

3. Tap a heart to save a home. My Favourites in the header opens your shortlist; Saved homes in your customer portal shows currently published homes.

4. Homes saved before login are automatically added to your account after signing in. Use Sync browser favourites if a connection interrupted the import. Availability and rental terms must still be confirmed with the team.','1. Mở Căn hộ hoặc Tìm nhà cho thuê. Lọc theo khu vực, loại hình, phòng ngủ, phòng tắm và ngân sách. Yêu cầu riêng có thú cưng, phòng tập, BBQ, hướng hồ và các tiện nghi khác.

2. Nếu đã có mã, nhập Mã căn hộ / bài đăng, ví dụ GH-000005. Mỗi tin đều hiển thị mã riêng.

3. Nhấn trái tim để lưu nhà. Nhà yêu thích ở đầu trang mở danh sách; Nhà đã lưu trong cổng khách hàng hiển thị các tin đang được đăng.

4. Nhà lưu trước khi đăng nhập được tự động thêm vào tài khoản sau khi đăng nhập. Dùng Đồng bộ nhà yêu thích trên trình duyệt nếu kết nối bị gián đoạn. Đội ngũ vẫn cần xác nhận tình trạng và điều kiện thuê.','customer',null,true,10),
('0cf47881-2a77-58ee-b01e-68be7d8ffe19','Follow enquiries and viewing plans','Theo dõi yêu cầu và lịch xem nhà','Know what is requested, what is confirmed and how to keep details current.','Phân biệt yêu cầu và lịch đã xác nhận, đồng thời cập nhật nhu cầu.','1. Sign in before sending a request if you want it linked to your account. Use Contact to send your requirements and include the property ID.

2. Open My enquiries to see your messages and the team’s updates. Earlier guest requests are not linked to a later account automatically; contact the team for help finding them.

3. Open My viewings for requested dates and confirmed appointments. A suggested date is not a confirmed viewing. Confirmed times are shown in Hanoi time (GMT+7).

4. Use the cancellation action when a viewing is no longer needed. Update My details with your phone, neighbourhood, move-in date, budget and preferences; select Save details and wait for confirmation.','1. Đăng nhập trước khi gửi yêu cầu nếu muốn liên kết với tài khoản. Dùng Liên hệ để gửi nhu cầu và kèm mã tin.

2. Mở Yêu cầu của tôi để xem tin nhắn và cập nhật từ đội ngũ. Yêu cầu gửi khi chưa đăng nhập không tự liên kết với tài khoản tạo sau; hãy liên hệ đội ngũ để tìm lại.

3. Mở Lịch xem nhà để xem ngày mong muốn và lịch đã xác nhận. Ngày đề xuất chưa phải lịch hẹn chính thức. Giờ đã xác nhận hiển thị theo Hà Nội (GMT+7).

4. Dùng thao tác hủy khi không còn cần lịch xem. Cập nhật Thông tin của tôi với số điện thoại, khu vực, ngày chuyển vào, ngân sách và sở thích; chọn lưu và đợi xác nhận.','customer',null,true,20),
('9dbe97f5-cd9d-53b7-8a44-f7c1b7f60e8f','Share feedback and credit your helper','Gửi phản hồi và ghi nhận người hỗ trợ','Submit an experience or record who helped you find a property.','Chia sẻ trải nghiệm hoặc ghi nhận ai đã giúp bạn tìm nhà.','1. Open Feedback to choose a rating and write about your experience. Do not include private contact, financial or identity details in the public review text.

2. Publication consent is optional. Feedback appears on the home page only after consent and staff approval; your email is kept private.

3. On a property page, use Record who helped. Enter the helper’s name, channel, place and date so the team can verify assistance and commission attribution. Submission alone does not confirm a commission.

4. Open Feedback & help in your customer portal to follow your signed-in submissions and replies.','1. Mở Phản hồi, chọn số sao và viết về trải nghiệm. Không đưa thông tin liên hệ riêng, tài chính hoặc giấy tờ cá nhân vào nội dung đánh giá công khai.

2. Đồng ý công khai là tùy chọn. Phản hồi chỉ xuất hiện trên trang chủ khi bạn cho phép và được nhân viên duyệt; email được giữ riêng tư.

3. Trên trang căn nhà, chọn Ghi nhận người hỗ trợ. Nhập tên, kênh, địa điểm và ngày để đội ngũ xác minh việc hỗ trợ và hoa hồng. Gửi biểu mẫu chưa đồng nghĩa hoa hồng đã được xác nhận.

4. Mở Phản hồi & hỗ trợ trong cổng khách hàng để theo dõi bài gửi và trả lời khi đã đăng nhập.','customer',null,true,30),
('d225427f-f1b3-5853-a861-90d09922ba14','First staff login and your profile','Đăng nhập lần đầu và hồ sơ nhân viên','Use your assigned account and personalize your profile safely.','Sử dụng tài khoản được cấp và cập nhật hồ sơ an toàn.','1. Open Staff login and enter the exact email and temporary password provided by your manager, administrator or owner. There is no separate first-login page.

2. Change your temporary password after the first login. Open your profile at the bottom of the Studio sidebar, enter a new password and confirmation, then Save changes.

3. In the same profile dialog, upload a JPG, PNG, WebP or AVIF photo up to 2 MB. Wait for the success message. Your staff photo is synchronized with linked public profiles.

4. If you cannot sign in, use Forgot password or ask an authorized team manager to check your access. Reassigning an existing account does not replace its password unless explicitly requested.','1. Mở Đăng nhập nhân viên và nhập chính xác email cùng mật khẩu tạm được quản lý, quản trị viên hoặc chủ sở hữu cấp. Không có trang đăng nhập lần đầu riêng.

2. Đổi mật khẩu tạm sau lần đăng nhập đầu. Mở hồ sơ ở cuối thanh bên Studio, nhập mật khẩu mới và xác nhận, rồi Lưu thay đổi.

3. Trong cùng hộp thoại, tải ảnh JPG, PNG, WebP hoặc AVIF tối đa 2 MB. Đợi thông báo thành công. Ảnh nhân viên đồng bộ với hồ sơ công khai đã liên kết.

4. Nếu không đăng nhập được, dùng Quên mật khẩu hoặc nhờ người có quyền quản lý kiểm tra. Cấp lại quyền cho tài khoản cũ không thay mật khẩu trừ khi chọn rõ thao tác đó.','staff','editor',true,40),
('4066bb49-bc6a-5bd0-be59-c947e6e5419a','Create and update a rental listing','Tạo và cập nhật tin cho thuê','Prepare bilingual details, original images and a publishable listing.','Chuẩn bị thông tin song ngữ, ảnh gốc và tin đăng hoàn chỉnh.','1. In Rentals & content, open Listings and choose Add a property. Keep new work as a draft while preparing it.

2. Fill both language versions, the district, address, property type, bedrooms, bathrooms, floor area, price and confirmed amenities. Organize the text into overview, location and facilities.

3. Upload original property photos. The Media tab inside Listings helps manage listing images. Verify the gallery and property ID before publishing.

4. Save the listing, then check its public page. Only published rentals with a supported availability appear publicly. Owners, administrators and managers can rearrange home/listing cards; deletion is limited to owners and administrators.','1. Trong Nhà cho thuê & nội dung, mở Tin đăng và chọn Thêm bất động sản. Giữ nội dung mới ở bản nháp trong lúc chuẩn bị.

2. Điền cả hai ngôn ngữ, khu vực, địa chỉ, loại hình, phòng ngủ, phòng tắm, diện tích, giá và tiện nghi đã xác nhận. Chia nội dung thành tổng quan, vị trí và tiện nghi.

3. Tải ảnh gốc của căn nhà. Thẻ Thư viện ảnh trong Tin đăng giúp quản lý ảnh. Kiểm tra bộ ảnh và mã tin trước khi xuất bản.

4. Lưu rồi kiểm tra trang công khai. Chỉ tin cho thuê đã đăng với tình trạng phù hợp được hiển thị. Chủ sở hữu, quản trị viên và quản lý có thể sắp xếp thẻ; chỉ chủ sở hữu và quản trị viên được xóa.','staff','editor',true,50),
('01912fac-0745-5fad-aa7c-8c6cfad54f38','Manage enquiries and customers','Quản lý yêu cầu và khách hàng','Keep customer updates clear and internal notes private.','Cập nhật rõ ràng cho khách và giữ ghi chú nội bộ riêng tư.','1. Open Enquiries under Customer care. Opening an enquiry marks it as read. Review the message and property reference before changing its status.

2. Put customer-facing information in Update for the customer. Use Internal notes for team-only details. Agree a time with the customer before entering a confirmed viewing time in Hanoi time.

3. Use Customers to maintain contact details, follow-up dates and customer stages. Refresh after an interrupted save before trying again.

4. In Customer feedback, review consent and the submitted text before approving publication. Never publish private personal details. Approved, consented reviews appear automatically on the home page. Only owners and administrators can delete enquiries.','1. Mở Yêu cầu trong Chăm sóc khách hàng. Mở yêu cầu sẽ đánh dấu đã đọc. Xem lời nhắn và mã nhà trước khi đổi trạng thái.

2. Ghi thông tin dành cho khách vào Cập nhật cho khách hàng. Dùng Ghi chú nội bộ cho chi tiết chỉ dành cho đội ngũ. Thống nhất với khách trước khi nhập lịch xem đã xác nhận theo giờ Hà Nội.

3. Dùng Khách hàng để cập nhật liên hệ, ngày theo dõi và giai đoạn chăm sóc. Làm mới sau lần lưu bị gián đoạn trước khi thử lại.

4. Trong Phản hồi khách hàng, kiểm tra sự đồng ý và nội dung trước khi duyệt. Không đăng thông tin cá nhân riêng tư. Đánh giá đã được cho phép và duyệt tự xuất hiện trên trang chủ. Chỉ chủ sở hữu và quản trị viên được xóa yêu cầu.','staff','editor',true,60),
('ef6d53c4-59cd-5a0c-9fb9-308846f3de56','Update galleries, activities and articles','Cập nhật bộ ảnh, hoạt động và bài viết','Keep the public site useful, current and bilingual.','Giữ nội dung công khai hữu ích, mới và đầy đủ hai ngôn ngữ.','1. Open People & galleries for customers, team photos and feedback screenshots. Choose the correct category; customer photos belong in Customers, and review screenshots belong in Feedback gallery.

2. Open Introduced properties to review landlord submissions and attachments before creating a listing draft. Verify the supplied property details with the landlord.

3. Under Assistance & publishing, open News articles or Rental tips. Write both languages, add appropriate sources and keep unfinished work in draft.

4. Preview published content on the website after saving. Do not invent prices, availability, biographies, reviews or affiliations.','1. Mở Nhân sự & bộ ảnh để quản lý ảnh khách hàng, đội ngũ và ảnh chụp phản hồi. Chọn đúng danh mục; ảnh khách thuộc Khách hàng, ảnh chụp đánh giá thuộc Bộ ảnh phản hồi.

2. Mở Nhà được giới thiệu để xem bài gửi và tệp của chủ nhà trước khi tạo bản nháp tin đăng. Xác minh thông tin với chủ nhà.

3. Trong Hỗ trợ & xuất bản, mở Bài viết tin tức hoặc Cẩm nang thuê nhà. Viết đủ hai ngôn ngữ, thêm nguồn phù hợp và giữ nội dung chưa hoàn tất ở bản nháp.

4. Kiểm tra nội dung công khai sau khi lưu. Không tự tạo giá, tình trạng, tiểu sử, đánh giá hoặc quan hệ hợp tác không có căn cứ.','staff','editor',true,70),
('612efbba-74d8-5a68-956e-9b862c078401','Verify assistance and attribution','Xác minh hỗ trợ và ghi nhận hoa hồng','Review evidence before confirming who helped a customer.','Kiểm tra bằng chứng trước khi ghi nhận người đã hỗ trợ khách.','1. Open Assistance attribution under Assistance & publishing. Read the property reference, helper, channel, location and date supplied by the customer.

2. Ask for more details if the introduction or viewing cannot be verified. Keep sensitive evidence in internal notes.

3. Select the credited staff member or record the confirmed helper, then save a verified review only after checking the evidence. The form records attribution; it does not calculate or pay a commission.

4. This section is available to managers, administrators and the owner.','1. Mở Ghi nhận hỗ trợ trong Hỗ trợ & xuất bản. Đọc mã nhà, tên người hỗ trợ, kênh, địa điểm và ngày khách cung cấp.

2. Yêu cầu bổ sung nếu chưa xác minh được việc giới thiệu hoặc xem nhà. Giữ bằng chứng nhạy cảm trong ghi chú nội bộ.

3. Chọn nhân viên được ghi nhận hoặc nhập người hỗ trợ đã xác nhận, rồi chỉ lưu trạng thái đã xác minh sau khi kiểm tra bằng chứng. Biểu mẫu ghi nhận việc hỗ trợ; không tính hoặc thanh toán hoa hồng.

4. Mục này dành cho quản lý, quản trị viên và chủ sở hữu.','staff','manager',true,80),
('eeeb43d7-926a-5ad7-b4d4-e16856cbe331','Assign and maintain team access','Cấp và quản lý quyền đội ngũ','Understand the role hierarchy and existing-account passwords.','Hiểu cấp bậc vai trò và mật khẩu của tài khoản đã tồn tại.','1. Open Team access. The directory shows your own level and lower levels. Viewing a peer does not allow you to change their account.

2. The hierarchy is Owner → Administrator → Manager → Staff. You can create or manage only lower roles: managers can add Staff; administrators can add Managers and Staff; the owner can add all lower roles.

3. Enter the new member’s name, allowed email, role, password and confirmation. New staff accounts are automatically confirmed and should change the temporary password after first login. Share that password privately.

4. For an existing login, choose assignment and explicitly choose password replacement when needed. Review the result rather than assuming its old password changed. Disable access to revoke membership; deletion is restricted to the permitted owner/administrator actions.','1. Mở Quyền truy cập đội ngũ. Danh sách hiển thị cấp của bạn và cấp thấp hơn. Xem người cùng cấp không có nghĩa được sửa tài khoản của họ.

2. Cấp bậc: Chủ sở hữu → Quản trị viên → Quản lý → Nhân viên. Chỉ được tạo hoặc quản lý cấp thấp hơn: quản lý thêm Nhân viên; quản trị viên thêm Quản lý và Nhân viên; chủ sở hữu thêm mọi cấp thấp hơn.

3. Nhập tên, email được phép, vai trò, mật khẩu và xác nhận. Tài khoản nhân viên mới tự xác nhận và cần đổi mật khẩu tạm sau lần đăng nhập đầu. Chia sẻ mật khẩu qua kênh riêng.

4. Với tài khoản đã có, chọn cấp quyền và chọn rõ thay mật khẩu nếu cần. Kiểm tra kết quả, không mặc định mật khẩu cũ đã đổi. Vô hiệu hóa để thu hồi quyền; thao tác xóa chỉ dành cho chủ sở hữu/quản trị viên theo giới hạn hiện hành.','staff','manager',true,90),
('b24dd86a-aa2f-5ded-8b45-2afc0719e4fc','Publish visual onboarding guides','Xuất bản hướng dẫn trực quan','Upload videos, animations and PDFs for the right audience.','Tải video, hoạt ảnh và PDF cho đúng nhóm người xem.','1. In Help & onboarding, choose Manage guides and Add guide. A private draft is created. Add an English and Vietnamese title, summary and written instructions.

2. Choose Customers, Staff or Everyone signed in. Staff guides can have a minimum role so higher-level procedures are shown only to the relevant team members.

3. Upload MP4/WebM/MOV video, GIF/WebP/APNG animation, PDF or screenshots. Each file supports up to 50 MB; a guide supports up to 12 files. Large uploads show progress and can resume after temporary network failures while this page stays open.

4. Add written steps or a transcript alongside videos for accessibility. Save draft, check the preview, then Publish. Only the owner can upload, edit, publish or delete these resources. Files use private storage and temporary viewing links.','1. Trong Hướng dẫn & hội nhập, chọn Quản lý hướng dẫn và Thêm hướng dẫn. Hệ thống tạo bản nháp riêng tư. Thêm tiêu đề, tóm tắt và nội dung tiếng Anh cùng tiếng Việt.

2. Chọn Khách hàng, Nhân viên hoặc Mọi người đã đăng nhập. Hướng dẫn nhân viên có thể đặt cấp tối thiểu để quy trình dành cho cấp cao chỉ hiển thị với người phù hợp.

3. Tải video MP4/WebM/MOV, hoạt ảnh GIF/WebP/APNG, PDF hoặc ảnh chụp màn hình. Mỗi tệp tối đa 50 MB; mỗi hướng dẫn tối đa 12 tệp. Tệp lớn có tiến trình và tiếp tục sau lỗi mạng tạm khi vẫn mở trang.

4. Thêm hướng dẫn chữ hoặc bản chép lời để dễ tiếp cận. Lưu nháp, kiểm tra xem trước, rồi Xuất bản. Chỉ chủ sở hữu được tải, sửa, đăng hoặc xóa tài liệu. Tệp dùng kho riêng tư và liên kết xem có thời hạn.','staff','owner',true,100)
on conflict(id) do nothing;

-- Migration: 20261030065219_property_price_range.sql
begin;

-- Keep existing fixed prices in price; an upper price makes the listing a range.
alter table public.properties add column price_max numeric(14,2);
alter table public.properties add constraint properties_price_range_check check (
  price_max is null or (
    price is not null and price_max >= price and price_max < 'Infinity'::numeric
  )
);
comment on column public.properties.price_max is 'Optional upper rental price in USD; price stores the lower or fixed price.';

notify pgrst, 'reload schema';
commit;

-- Migration: 20261030075151_listing_vnd_prices.sql
begin;

-- The existing price/price_max columns remain USD; VND quotes are independent.
alter table public.properties
  add column price_vnd numeric(15,0) check (price_vnd >= 0 and price_vnd < 'Infinity'::numeric),
  add column price_vnd_max numeric(15,0);
alter table public.properties add constraint properties_vnd_price_range_check check (
  price_vnd_max is null or (
    price_vnd is not null and price_vnd_max >= price_vnd and price_vnd_max < 'Infinity'::numeric
  )
);
comment on column public.properties.price_vnd is 'Optional fixed or lower VND rental price, entered independently of USD.';
comment on column public.properties.price_vnd_max is 'Optional upper VND rental price; requires price_vnd.';

notify pgrst, 'reload schema';
commit;

-- Migration: 20261030075152_editable_listing_ids.sql
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

-- Migration: 20261101151843_audit_staff_and_enquiry_security.sql
begin;

-- Disabling a lower-level membership must still work after its Auth email or
-- allowed domain changes. Restoration continues to validate the current email.
create or replace function private.set_staff_access(target_user_id uuid,assigned_role text,enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare member public.team_members; checked_id uuid; actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 select * into member from public.team_members where user_id=target_user_id;
 if member.user_id is null then raise exception 'Staff account not found' using errcode='P0002'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.email,0));
 select * into member from public.team_members where user_id=target_user_id for update;
 if member.user_id is null then raise exception 'Staff account not found' using errcode='P0002'; end if;
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 or target_user_id=auth.uid()
  or private.staff_rank(member.role)>=private.staff_rank(actor_role)
  or private.staff_rank(assigned_role)<1 or private.staff_rank(assigned_role)>=private.staff_rank(actor_role) then
  raise exception 'You may manage lower-level staff accounts only' using errcode='42501';
 end if;
 if enabled is null then raise exception 'Check the staff access choice' using errcode='23514'; end if;
 if enabled then
  checked_id:=private.find_staff_account(member.email,assigned_role);
  if checked_id is distinct from target_user_id then raise exception 'Check the assigned staff email' using errcode='23514'; end if;
 end if;
 update public.team_members set role=assigned_role,active=enabled,assigned_by=auth.uid(),updated_at=now() where user_id=target_user_id;
 return target_user_id;
end; $$;

-- Existing customer credentials may be preserved only after mailbox ownership
-- has been verified. New staff accounts are confirmed by the server at creation.
create or replace function private.assign_staff_account(target_email text,full_name text,assigned_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare target_id uuid; was_member boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(target_email)),0));
 target_id:=private.find_staff_account(target_email,assigned_role);
 if target_id is null then raise exception 'Create the Auth account first' using errcode='P0002'; end if;
 perform 1 from auth.users u where u.id=target_id and lower(u.email)=lower(btrim(target_email)) and u.email_confirmed_at is not null for update;
 if not found then raise exception 'The existing login must confirm its email before staff access can be assigned' using errcode='23514'; end if;
 if full_name is null or char_length(btrim(full_name)) not between 2 and 120 then raise exception 'Enter the staff name' using errcode='23514'; end if;
 select exists(select 1 from public.team_members where user_id=target_id) into was_member;
 insert into public.team_members(user_id,email,display_name,role,active,assigned_by) values(target_id,lower(btrim(target_email)),btrim(full_name),assigned_role,true,auth.uid())
 on conflict(user_id) do update set email=excluded.email,display_name=excluded.display_name,role=excluded.role,active=true,assigned_by=auth.uid(),updated_at=now();
 if was_member then perform private.append_studio_event('team','team.assigned',target_id,btrim(full_name),assigned_role); end if;
 return target_id;
end; $$;

-- Foreign-key SET NULL actions are nested trigger writes. Permit only those
-- reference removals by trusted maintenance roles, without exempting ordinary
-- service-role writes or weakening any customer-controlled field restrictions.
create or replace function private.guard_customer_enquiry_update() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if pg_catalog.pg_trigger_depth()>1 and current_user in ('postgres','supabase_admin','supabase_auth_admin','service_role')
  and (to_jsonb(new)-'user_id'-'property_id') is not distinct from (to_jsonb(old)-'user_id'-'property_id')
  and (new.user_id is not distinct from old.user_id or (new.user_id is null and old.user_id is not null))
  and (new.property_id is not distinct from old.property_id or (new.property_id is null and old.property_id is not null)) then
  return new;
 end if;
 if private.is_editor() then return new; end if;
 if auth.uid() is null or old.user_id is distinct from auth.uid()
  or old.kind<>'viewing' or old.status='closed' or old.cancelled_at is not null
  or new.cancelled_at is null
  or (to_jsonb(new)-'cancelled_at') is distinct from (to_jsonb(old)-'cancelled_at') then
  raise exception 'Customers may only cancel their own active viewing requests.' using errcode='42501';
 end if;
 new.cancelled_at:=now();
 return new;
end; $$;

-- Enforce attribution eligibility on the table API as well as the review RPC.
-- The existing stable helper reads the old review to allow retaining an active
-- higher-level assignee; it cannot authorize inserting a new higher-level credit.
alter policy assistance_review_insert on public.assistance_reviews with check (
 (select private.can_order_properties()) and reviewed_by=(select auth.uid())
 and (credited_staff_id is null or exists(select 1 from private.attribution_staff() s where s.user_id=credited_staff_id)
  or private.can_retain_assistance_credit(report_id,credited_staff_id))
);
alter policy assistance_review_update on public.assistance_reviews
 using ((select private.can_order_properties())) with check (
 (select private.can_order_properties()) and reviewed_by=(select auth.uid())
 and (credited_staff_id is null or exists(select 1 from private.attribution_staff() s where s.user_id=credited_staff_id)
  or private.can_retain_assistance_credit(report_id,credited_staff_id))
);

notify pgrst,'reload schema';
commit;

-- Migration: 20261101152018_trusted_public_intake.sql
begin;

-- Public forms enter through the application's validation boundary. Neither a
-- guest nor a signed-in browser can bypass it with a direct Data API insert.
revoke insert on public.enquiries,public.feedback_submissions,public.property_assistance from public,anon,authenticated;
revoke insert(name,email,phone,message,property_id,preferred_date,kind,consent) on public.enquiries from public,anon,authenticated;
revoke insert(name,email,rating,message,property_id,consent,publish_consent) on public.feedback_submissions from public,anon,authenticated;
revoke insert(property_id,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,consent) on public.property_assistance from public,anon,authenticated;

create table private.public_intake_limits (
 channel text not null check(channel in ('enquiry','feedback','assistance')),
 client_key text not null check(client_key ~ '^[a-f0-9]{64}$'),
 window_started timestamptz not null,
 requests integer not null check(requests between 1 and 5),
 primary key(channel,client_key)
);
create index public_intake_limits_window_idx on private.public_intake_limits(window_started);
alter table private.public_intake_limits enable row level security;
revoke all on private.public_intake_limits from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.public_intake_limits to service_role;
create policy intake_limits_service on private.public_intake_limits to service_role using(true) with check(true);
grant insert,select on public.enquiries,public.feedback_submissions,public.property_assistance to service_role;
grant select on public.properties to service_role;

-- Service-only, invoker security. Identity comes from the server's verified
-- Auth response, never from a caller-controlled details field. Reservation and
-- insert commit together, and concurrent instances share the same quota row.
create function public.submit_public_intake(channel text,client_key text,verified_user uuid,details jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare accepted boolean; saved uuid; property uuid;
begin
 if channel is null or channel not in ('enquiry','feedback','assistance') or client_key is null or client_key !~ '^[a-f0-9]{64}$'
  or details is null or jsonb_typeof(details)<>'object' or (details->>'consent')::boolean is distinct from true then
  raise exception 'Invalid submission' using errcode='23514';
 end if;
 property:=nullif(details->>'property_id','')::uuid;
 if property is not null and not exists(select 1 from public.properties p where p.id=property and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request')) then
  raise exception 'Choose an available rental' using errcode='23514';
 end if;
 if channel='enquiry' and nullif(details->>'preferred_date','')::date < (now() at time zone 'UTC')::date then
  raise exception 'Choose a future viewing date' using errcode='23514';
 end if;
 if channel='assistance' and (details->>'helped_on')::date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
  raise exception 'Choose a valid assistance date' using errcode='23514';
 end if;
 insert into private.public_intake_limits as q values(channel,client_key,now(),1)
 on conflict on constraint public_intake_limits_pkey do update set
  window_started=case when q.window_started<=now()-interval '10 minutes' then now() else q.window_started end,
  requests=case when q.window_started<=now()-interval '10 minutes' then 1 else q.requests+1 end
 where q.window_started<=now()-interval '10 minutes' or q.requests<5
 returning true into accepted;
 if not coalesce(accepted,false) then return null;end if;
 delete from private.public_intake_limits q where q.window_started<now()-interval '7 days';
 if channel='enquiry' then
  insert into public.enquiries(user_id,name,email,phone,message,property_id,preferred_date,kind,consent)
  values(verified_user,details->>'name',details->>'email',coalesce(details->>'phone',''),details->>'message',property,nullif(details->>'preferred_date','')::date,coalesce(details->>'kind','general'),true) returning id into saved;
 elsif channel='feedback' then
  insert into public.feedback_submissions(user_id,name,email,rating,message,property_id,consent,publish_consent)
  values(verified_user,details->>'name',details->>'email',(details->>'rating')::integer,details->>'message',property,true,coalesce((details->>'publish_consent')::boolean,false)) returning id into saved;
 else
  insert into public.property_assistance(user_id,property_id,name,email,phone,helper_name,channel,helped_where,helped_on,helped_time,notes,consent)
  values(verified_user,property,details->>'name',details->>'email',coalesce(details->>'phone',''),details->>'helper_name',details->>'channel',details->>'helped_where',(details->>'helped_on')::date,nullif(details->>'helped_time','')::time,coalesce(details->>'notes',''),true) returning id into saved;
 end if;
 return saved;
end; $$;
revoke all on function public.submit_public_intake(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.submit_public_intake(text,text,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261102065952_short_listing_ids.sql
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

-- Migration: 20261102065956_property_map_address.sql
begin;

-- Authors opt in to publishing a precise map destination. Existing listings
-- keep this null and use their public street / area as an approximate view.
alter table public.properties add column map_address text
  constraint properties_map_address_check
  check (map_address is null or (btrim(map_address)<>'' and char_length(map_address)<=300));
comment on column public.properties.map_address is
  'Optional public exact map address or latitude,longitude. Null uses an approximate map of the public location.';

-- This public field inherits the properties table public-read / staff-write
-- permissions and the existing updated_at version trigger.
notify pgrst,'reload schema';
commit;

-- Migration: 20261105080033_listing_mp4_video.sql
begin;

-- One optional video per listing. The upload bucket enforces a decimal 50 MB
-- ceiling strictly: exactly 50,000,000 bytes is not accepted.
alter table public.properties add column video_url text
  constraint properties_video_url_check check (
    video_url is null or (
      char_length(video_url) <= 2048 and
      video_url ~ '^https://duyiihsmaqfgwezmsnjs\.supabase\.co/storage/v1/object/public/listing-videos/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
    )
  );
comment on column public.properties.video_url is 'One optional uploaded MP4 property video, strictly smaller than 50,000,000 bytes.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('listing-videos','listing-videos',true,49999999,array['video/mp4'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy listing_video_read on storage.objects for select to anon,authenticated
  using(bucket_id='listing-videos');
create policy listing_video_upload on storage.objects for insert to authenticated with check(
  bucket_id='listing-videos' and (select private.is_editor()) and
  split_part(name,'/',1)=(select auth.uid())::text and
  name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
);
-- Uploaded objects are immutable. Replacing a listing video uploads a new object.
create policy listing_video_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check(bucket_id<>'listing-videos');
create policy listing_video_anon_update_guard on storage.objects as restrictive for update to anon
  using(bucket_id<>'listing-videos') with check(bucket_id<>'listing-videos');
create policy listing_video_anon_delete_guard on storage.objects as restrictive for delete to anon
  using(bucket_id<>'listing-videos');
create policy listing_video_upload_guard on storage.objects as restrictive for insert to authenticated with check(
  bucket_id<>'listing-videos' or (
    (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
    name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
  )
);
create policy listing_video_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'listing-videos') with check(bucket_id<>'listing-videos');
create policy listing_video_delete_guard on storage.objects as restrictive for delete to authenticated using(
  bucket_id<>'listing-videos' or (
    (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
    not exists(select 1 from public.properties p where p.video_url like '%/storage/v1/object/public/listing-videos/'||storage.objects.name)
  )
);
create policy listing_video_delete on storage.objects for delete to authenticated using(
  bucket_id='listing-videos' and (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
  not exists(select 1 from public.properties p where p.video_url like '%/storage/v1/object/public/listing-videos/'||storage.objects.name)
);

create function private.validate_listing_video() returns trigger language plpgsql security invoker set search_path='' as $$
declare object_path text;
begin
  if new.video_url is null then return new; end if;
  if tg_op='UPDATE' and new.video_url is not distinct from old.video_url then return new; end if;
  object_path:=substring(new.video_url from '/storage/v1/object/public/listing-videos/(.*)$');
  if not exists(
    select 1 from storage.objects o where o.bucket_id='listing-videos' and o.name=object_path
      and o.metadata->>'mimetype'='video/mp4'
      and (o.metadata->>'size') ~ '^[0-9]+$'
      and (o.metadata->>'size')::numeric > 0 and (o.metadata->>'size')::numeric < 50000000
  ) then
    raise exception 'Use one uploaded MP4 video smaller than 50 MB.' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function private.validate_listing_video() from public,anon,authenticated;
create trigger properties_validate_video before insert or update of video_url on public.properties
  for each row execute function private.validate_listing_video();

notify pgrst,'reload schema';
commit;

-- Migration: 20261106061652_property_image_filenames.sql
begin;

-- Keep original basenames separately from immutable/random storage object keys.
-- No relationship to the current image array is required, so older clients can
-- still reorder or remove images without sending this optional metadata.
create function private.valid_property_image_filenames(filenames jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(filenames) = 'object'
    and octet_length(filenames::text) <= 262144 then (
      select count(*) <= 40 and coalesce(bool_and(
        char_length(entry.key) between 1 and 4096
        and jsonb_typeof(entry.value) = 'string'
        and char_length(entry.value #>> '{}') between 1 and 512
        and strpos(entry.value #>> '{}', '/') = 0
        and strpos(entry.value #>> '{}', chr(92)) = 0
        and (entry.value #>> '{}') !~ '[[:cntrl:]]'
      ), true)
      from jsonb_each(filenames) as entry
    ) else false end;
$$;
revoke all on function private.valid_property_image_filenames(jsonb) from public;
grant execute on function private.valid_property_image_filenames(jsonb) to authenticated,service_role;

alter table public.properties add column image_filenames jsonb not null default '{}'::jsonb
  constraint properties_image_filenames_check check (private.valid_property_image_filenames(image_filenames));
comment on column public.properties.image_filenames is 'Original uploaded image basenames, keyed by image URL. Inline browser previews use a compact inline: hash key. Legacy uploads may have no original basename.';

notify pgrst,'reload schema';
commit;

-- Migration: 20261110090607_seo_audit_system.sql
begin;

-- Crawl state is server-owned. Authenticated staff may inspect reports, but
-- cannot enqueue work or forge results through the Data API.
create table public.seo_audit_settings (
  id boolean primary key default true check (id),
  weekly_enabled boolean not null default false,
  next_run_at timestamptz not null default now(),
  limits jsonb not null default '{"maxUrls":500,"maxDepth":4,"concurrency":2,"requestIntervalMs":1000,"timeoutMs":10000,"maxDurationMs":900000}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint seo_audit_limits_object check (jsonb_typeof(limits)='object')
);
insert into public.seo_audit_settings(id) values(true);
create table public.seo_audit_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'queued' check(status in ('queued','running','completed','incomplete','failed')),
  scope text not null check(scope in ('site','page')),
  trigger text not null check(trigger in ('manual','weekly','page')),
  target_url text,
  actor_id uuid references auth.users(id) on delete set null,
  state jsonb not null check(jsonb_typeof(state)='object'),
  content_score integer check(content_score between 0 and 100),
  technical_score integer check(technical_score between 0 and 100),
  page_count integer not null default 0 check(page_count between 0 and 1000),
  critical_count integer not null default 0 check(critical_count>=0),
  lease_token uuid,
  lease_until timestamptz
);
create unique index seo_audit_single_active on public.seo_audit_runs ((true)) where status in ('queued','running');
create index seo_audit_history on public.seo_audit_runs(created_at desc);
alter table public.seo_audit_settings enable row level security;
alter table public.seo_audit_runs enable row level security;
revoke all on public.seo_audit_settings,public.seo_audit_runs from public,anon,authenticated;
grant select on public.seo_audit_settings,public.seo_audit_runs to authenticated;
grant all on public.seo_audit_settings,public.seo_audit_runs to service_role;
create policy seo_settings_staff_read on public.seo_audit_settings for select to authenticated using ((select private.is_editor()));
create policy seo_runs_staff_read on public.seo_audit_runs for select to authenticated using ((select private.is_editor()));

-- All worker RPCs are invokers, service-role only. The singleton row lock
-- serializes manual starts with scheduler starts across serverless instances.
create function public.seo_create_audit(p_state jsonb,p_trigger text,p_scope text,p_target_url text default null,p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare settings public.seo_audit_settings; run public.seo_audit_runs;
begin
  select * into settings from public.seo_audit_settings where id=true for update;
  select * into run from public.seo_audit_runs where status in ('queued','running') limit 1;
  if found then return to_jsonb(run); end if;
  if p_trigger='weekly' and (not settings.weekly_enabled or settings.next_run_at>now()) then return null; end if;
  if p_state->>'status' is distinct from 'queued' then raise exception 'New audits must be queued.' using errcode='23514'; end if;
  insert into public.seo_audit_runs(state,trigger,scope,target_url,actor_id)
    values(p_state,p_trigger,p_scope,p_target_url,p_actor_id) returning * into run;
  if p_trigger='weekly' then update public.seo_audit_settings set next_run_at=now()+interval '7 days',updated_at=now() where id=true; end if;
  delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  return to_jsonb(run);
end;
$$;
create function public.seo_claim_audit(p_run_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.seo_audit_runs;
begin
  select * into run from public.seo_audit_runs
    where status in ('queued','running') and (p_run_id is null or id=p_run_id)
      and (lease_until is null or lease_until<now())
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.seo_audit_runs set status='running',lease_token=gen_random_uuid(),lease_until=now()+interval '60 seconds' where id=run.id returning * into run;
  return to_jsonb(run);
end;
$$;
create function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    page_count=(p_summary->>'page_count')::integer,critical_count=(p_summary->>'critical_count')::integer,
    lease_token=null,lease_until=null
    where id=p_run_id and lease_token=p_lease_token and lease_until>=now() and status in ('queued','running');
  saved:=found;
  if saved then
    delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  end if;
  return saved;
end;
$$;
revoke all on function public.seo_create_audit(jsonb,text,text,text,uuid),public.seo_claim_audit(uuid),public.seo_save_audit(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.seo_create_audit(jsonb,text,text,text,uuid),public.seo_claim_audit(uuid),public.seo_save_audit(uuid,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

-- Migration: 20261110100526_seo_audit_reliability_and_score_basis.sql
begin;
alter table public.seo_audit_runs add column score_basis text;
alter table public.seo_audit_runs add column coverage jsonb;
-- Legacy cached scores intentionally remain unversioned. They must not enter
-- trend comparisons with the new evidence-only, check-weighted calculation.
create or replace function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    score_basis=case when p_summary->>'score_basis'='evaluated-checks-v2' then 'evaluated-checks-v2' else null end,
    coverage=p_summary->'coverage',
    page_count=(p_summary->>'page_count')::integer,critical_count=(p_summary->>'critical_count')::integer,
    lease_token=null,lease_until=null
    where id=p_run_id and lease_token=p_lease_token and lease_until>=now() and status in ('queued','running');
  saved:=found;
  if saved then
    delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  end if;
  return saved;
end;
$$;

create function public.seo_resume_audit(p_run_id uuid,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.seo_audit_runs;
begin
  perform 1 from public.seo_audit_settings where id=true for update;
  if exists(select 1 from public.seo_audit_runs where status in ('queued','running')) then return null; end if;
  select * into run from public.seo_audit_runs where id=p_run_id for update;
  if not found or run.status not in ('failed','incomplete') then return null; end if;
  if p_state->>'status' is distinct from 'queued' then raise exception 'Resumed audits must be queued.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status='queued',finished_at=null,lease_token=null,lease_until=null,
    content_score=null,technical_score=null,score_basis=null,coverage=null
    where id=p_run_id returning * into run;
  return to_jsonb(run);
end;
$$;
revoke all on function public.seo_resume_audit(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.seo_resume_audit(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

-- Migration: 20261110145521_listing_creation_provenance.sql
begin;
-- Creator attribution is private provenance, not the editable public listing
-- contact. Historical authors are intentionally not inferred or backfilled.
create table public.property_creation_records (
 property_id uuid primary key references public.properties(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_name text,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.property_creation_records enable row level security;
revoke all on public.property_creation_records from public,anon,authenticated;
grant select on public.property_creation_records to authenticated;
grant all on public.property_creation_records to service_role;
create policy property_creation_staff_read on public.property_creation_records for select to authenticated using ((select private.is_editor()));
create function private.record_property_creation() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); name text;
begin
 if actor is not null and private.is_editor() then
  select nullif(btrim(m.display_name),'') into name from public.team_members m where m.user_id=actor;
  insert into public.property_creation_records(property_id,actor_user_id,actor_name) values(new.id,actor,left(name,120));
 end if;
 return new;
end;
$$;
revoke all on function private.record_property_creation() from public,anon,authenticated;
create trigger properties_record_creation after insert on public.properties for each row execute function private.record_property_creation();
notify pgrst,'reload schema';
commit;

-- Migration: 20261110150224_seo_audit_method_v3.sql
begin;
-- New summaries distinguish actual response locales and deduplicated evaluated checks.
-- Existing rows retain their original method version for honest comparisons.
create or replace function public.seo_save_audit(p_run_id uuid,p_lease_token uuid,p_state jsonb,p_summary jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare saved boolean; new_status text:=p_state->>'status';
begin
  if new_status not in ('queued','running','completed','incomplete','failed') or new_status is null then raise exception 'Invalid audit status.' using errcode='23514'; end if;
  update public.seo_audit_runs set state=p_state,status=new_status,
    finished_at=case when new_status in ('completed','incomplete','failed') then now() else null end,
    content_score=(p_summary->>'content_score')::integer,technical_score=(p_summary->>'technical_score')::integer,
    score_basis=case when p_summary->>'score_basis'='evaluated-checks-v3' then 'evaluated-checks-v3' else null end,
    coverage=p_summary->'coverage',
    page_count=(p_summary->>'page_count')::integer,critical_count=(p_summary->>'critical_count')::integer,
    lease_token=null,lease_until=null
    where id=p_run_id and lease_token=p_lease_token and lease_until>=now() and status in ('queued','running');
  saved:=found;
  if saved then
    delete from public.seo_audit_runs where id in (select id from public.seo_audit_runs order by created_at desc,id desc offset 20) and status not in ('queued','running');
  end if;
  return saved;
end;
$$;

notify pgrst,'reload schema';
commit;

-- Migration: 20261117202945_staff_eligibility_and_future_grants.sql
-- PENDING APPROVAL: local follow-up only; do not apply without owner approval.
-- Existing identities, memberships, roles and historical records are unchanged.
begin;
create function private.staff_identity_eligible(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null
  and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=now()));
$$;
revoke all on function private.staff_identity_eligible(uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.staff_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.role from public.team_members m
  join auth.users u on u.id = m.user_id
  join public.staff_settings s on s.id = 'main'
  where private.staff_identity_eligible(auth.uid()) and m.user_id = auth.uid() and m.active
    and u.email_confirmed_at is not null and m.email = lower(u.email)
    and ((m.role = 'owner' and m.bootstrap_owner) or split_part(m.email,'@',2) = any(s.email_domains));
$function$;

-- AUTH-008: change defaults for future postgres-owned objects only, never
-- existing API grants. Service-role and provider-owned defaults are untouched.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public,anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public,anon,authenticated;
-- Review supabase_admin-owned defaults separately with the project operator.
-- Every future public API must explicitly grant its intended EXECUTE/table rights.
revoke all on function private.staff_role() from public,anon;
grant execute on function private.staff_role() to authenticated;
commit;

-- Migration: 20261119040445_property_photo_metadata.sql
begin;

alter table public.properties add column image_metadata jsonb not null default '{}'::jsonb
  constraint properties_image_metadata_check check (
    jsonb_typeof(image_metadata) = 'object'
    and octet_length(image_metadata::text) <= 262144
    and jsonb_array_length(jsonb_path_query_array(image_metadata, '$.keyvalue()')) <= 40
    and not jsonb_path_exists(image_metadata, '$.keyvalue() ? (@.key == "" || @.value.type() != "object")')
    and not jsonb_path_exists(image_metadata, '$.*.keyvalue() ? (
      !(@.key like_regex "^(description_(en|vi)|alt_(en|vi)|public_filename)$")
      || @.value.type() != "string"
      || !(@.value like_regex "^.{1,240}$" flag "s")
    )')
  );

comment on column public.properties.image_metadata is
  'Public listing photo descriptions, alt text and explicitly approved original filenames, keyed by image URL or inline preview hash.';

notify pgrst, 'reload schema';
commit;

-- Migration: 20261119054408_property_photo_storage_rename.sql
-- Review before applying. Requires property image filenames and metadata.
begin;

create table private.property_photo_renames (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null,
  origin text not null,
  old_key text not null,
  new_key text not null,
  started_by uuid not null,
  started_at timestamptz not null default now(),
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  applied_by uuid,
  applied_at timestamptz,
  properties jsonb not null default '[]'::jsonb,
  removal_requested_by uuid,
  removed_at timestamptz,
  unique(origin,old_key), unique(origin,new_key)
);
alter table private.property_photo_renames enable row level security;
revoke all on private.property_photo_renames from public,anon,authenticated;
create index property_photo_renames_old_key on private.property_photo_renames(old_key);

-- Normal uploads can still insert new photos. Existing bytes and the rename
-- destination directory are restricted to server-side Storage operations.
create function private.home_photo_upload_key(p_key text) returns boolean language sql stable security definer set search_path='' as $$
  select p_key not like 'properties/renamed/%'
    and not exists(select 1 from private.property_photo_renames where old_key=p_key);
$$;
revoke all on function private.home_photo_upload_key(text) from public,anon,authenticated;
grant execute on function private.home_photo_upload_key(text) to authenticated;
create policy home_photo_rename_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'property-media');
create policy home_photo_rename_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'property-media' or private.home_photo_upload_key(name));
create policy home_photo_rename_update_guard on storage.objects as restrictive for update to anon,authenticated
  using (bucket_id <> 'property-media') with check (bucket_id <> 'property-media');
create policy home_photo_rename_delete_guard on storage.objects as restrictive for delete to anon,authenticated
  using (bucket_id <> 'property-media');

create function private.home_photo_key(uri text, expected_origin text) returns text
language plpgsql immutable set search_path='' as $$
declare path text; token text; bytes bytea:=''::bytea;
begin
  if uri is null or (expected_origin is not null and not starts_with(uri,expected_origin||'/')) then return null;end if;
  path:=substring(split_part(split_part(uri,'?',1),'#',1)
    from '^https?://[a-zA-Z0-9.:-]+/storage/v1/(?:object|render/image)/public/property-media/(.+)$');
  if path is null or char_length(path)>3072 or path ~ '%(?![0-9a-fA-F]{2})' then return null;end if;
  for token in select (regexp_matches(path,'(%[0-9a-fA-F]{2}|[^%]+)','g'))[1] loop
    if starts_with(token,'%') then
      if lower(token) in ('%00','%2f','%5c') then return null;end if;
      bytes:=bytes||decode(substr(token,2),'hex');
    else bytes:=bytes||convert_to(token,'UTF8');end if;
  end loop;
  path:=convert_from(bytes,'UTF8');
  if path ~ '(^|/)\.{1,2}(/|$)|[[:cntrl:]]' or position(chr(92) in path)>0 or char_length(path)>1024 then return null;end if;
  return path;
exception when character_not_in_repertoire or untranslatable_character then return null;
end;$$;

create function private.require_home_photo_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(private.staff_role(),'') not in ('owner','admin') or not exists(
    select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and u.deleted_at is null
    and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now())
  ) then raise exception 'photo_rename.forbidden' using errcode='42501';end if;
end;$$;

create view private.home_photo_references as
  select unnest(images) as uri from public.properties
  union all select jsonb_object_keys(image_filenames) from public.properties
  union all select jsonb_object_keys(image_metadata) from public.properties
  union all select source_url from public.properties
  union all select image from public.neighbourhoods
  union all select hero_image from public.site_settings
  union all select portrait_url from public.listing_authors
  union all select image_url from public.site_activities
  union all select source_url from public.site_activities
  union all select image_url from public.editorial_articles
  union all select entry->>'url' from public.editorial_articles, jsonb_array_elements(sources) entry;

create function private.home_photo_replacement(uri text, origin text, old_key text, new_uri text) returns text
language sql immutable set search_path='' as $$
  select case when private.home_photo_key(uri,origin)=old_key then
    (case when starts_with(uri,origin||'/storage/v1/render/image/public/property-media/')
      then replace(new_uri,'/storage/v1/object/public/','/storage/v1/render/image/public/') else new_uri end)
      || coalesce(substring(uri from '[?#].*$'),'')
    else uri end;
$$;

create function private.home_photo_map(fields jsonb, origin text, old_key text, new_uri text) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; conflict boolean;
begin
  with mapped as (
    select private.home_photo_replacement(key,origin,old_key,new_uri) as key,value
    from jsonb_each(fields)
  ), merged as (
    select key,jsonb_agg(distinct value) as values_present from mapped group by key
  )
  select coalesce(jsonb_object_agg(key,values_present->0),'{}'::jsonb),
    coalesce(bool_or(jsonb_array_length(values_present)>1),false) into result,conflict from merged;
  if conflict then raise exception 'photo_rename.metadata_conflict' using errcode='23514';end if;
  return result;
end;$$;

create function private.home_photo_blocked(uri text) returns boolean language sql security definer set search_path='' as $$
  select exists(
    select 1 from private.property_photo_renames r
    where case when r.applied_at is null then r.new_key else r.old_key end=private.home_photo_key(uri,null)
  );
$$;
create function private.guard_home_photo_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='properties' then
    if exists(select 1 from
      (select unnest(new.images) uri union all select jsonb_object_keys(new.image_filenames)
       union all select jsonb_object_keys(new.image_metadata) union all select new.source_url) refs
       where private.home_photo_blocked(refs.uri))
    then raise exception 'photo_rename.stale_reference' using errcode='40001';end if;
  elsif tg_table_name='editorial_articles' then
    if private.home_photo_blocked(new.image_url) or exists(
      select 1 from jsonb_array_elements(new.sources) entry where private.home_photo_blocked(entry->>'url')
    ) then raise exception 'photo_rename.stale_reference' using errcode='40001';end if;
  elsif private.home_photo_blocked(to_jsonb(new)->>tg_argv[0])
    or (tg_nargs>1 and private.home_photo_blocked(to_jsonb(new)->>tg_argv[1])) then
    raise exception 'photo_rename.stale_reference' using errcode='40001';
  end if;
  return new;
end;$$;
create trigger guard_property_photo_reference before insert or update of images,image_filenames,image_metadata,source_url on public.properties
  for each row execute function private.guard_home_photo_reference();
create trigger guard_neighbourhood_photo_reference before insert or update of image on public.neighbourhoods
  for each row execute function private.guard_home_photo_reference('image');
create trigger guard_hero_photo_reference before insert or update of hero_image on public.site_settings
  for each row execute function private.guard_home_photo_reference('hero_image');
create trigger guard_author_photo_reference before insert or update of portrait_url on public.listing_authors
  for each row execute function private.guard_home_photo_reference('portrait_url');
create trigger guard_activity_photo_reference before insert or update of image_url,source_url on public.site_activities
  for each row execute function private.guard_home_photo_reference('image_url','source_url');
create trigger guard_editorial_photo_reference before insert or update of image_url,sources on public.editorial_articles
  for each row execute function private.guard_home_photo_reference();

create function public.home_photo_rename_lookup(p_property uuid,p_origin text,p_old_key text,p_name text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare job private.property_photo_renames;
begin
  perform private.require_home_photo_admin();
  select * into job from private.property_photo_renames
    where property_id=p_property and origin=p_origin and old_key=p_old_key
    and new_key='properties/renamed/'||p_property::text||'/'||p_name;
  return case when found then to_jsonb(job) else null end;
end;$$;

create function public.home_photo_rename_reserve(p_property uuid,p_origin text,p_old_key text,p_name text,p_version timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; listing public.properties; target text;
begin
  perform private.require_home_photo_admin();
  if p_name is null or p_name !~ '^[a-z0-9]+(-[a-z0-9]+)*\.(jpg|png|webp|avif)$' or char_length(p_name)>120
    or p_origin is null or p_origin !~ '^https?://[a-zA-Z0-9.:-]+$' then raise exception 'photo_rename.invalid_name' using errcode='22023';end if;
  target:='properties/renamed/'||p_property::text||'/'||p_name;
  if p_old_key=target then raise exception 'photo_rename.same_name' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where origin=p_origin and old_key=p_old_key;
  if found and (job.property_id<>p_property or job.new_key<>target) then
    raise exception 'photo_rename.pending_name' using errcode='40001';
  end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  select * into listing from public.properties where id=p_property;
  if not found or listing.updated_at is distinct from p_version then raise exception 'photo_rename.stale_listing' using errcode='40001';end if;
  if not exists(select 1 from unnest(listing.images) uri where private.home_photo_key(uri,p_origin)=p_old_key) then
    raise exception 'photo_rename.photo_not_saved' using errcode='P0002';
  end if;
  if job.id is not null then return to_jsonb(job);end if;
  if exists(select 1 from private.property_photo_renames r where r.new_key=target or r.old_key=target)
    or exists(select 1 from storage.objects where bucket_id='property-media' and name=target)
    or exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=target)
  then raise exception 'photo_rename.collision' using errcode='23505';end if;
  insert into private.property_photo_renames(property_id,origin,old_key,new_key,started_by)
    values(p_property,p_origin,p_old_key,target,auth.uid()) returning * into job;
  return to_jsonb(job);
end;$$;

-- The server attests to the Storage copy only after comparing both objects.
create function public.home_photo_rename_verified(p_id uuid,p_sha256 text) returns boolean
language sql security definer set search_path='' as $$
  with verified as (
    update private.property_photo_renames r set sha256=p_sha256
    where id=p_id and (sha256 is null or sha256=p_sha256)
    and exists (select 1 from storage.objects o where o.bucket_id='property-media' and o.name=r.new_key)
    returning id
  ) select exists(select 1 from verified);
$$;

create function public.home_photo_rename_apply(p_id uuid,p_version timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; listing public.properties; new_uri text; changed jsonb;
begin
  perform private.require_home_photo_admin();
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id for update;
  if not found or job.sha256 is null then raise exception 'photo_rename.unverified' using errcode='40001';end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  -- Exclude concurrent reference changes for the duration of this transaction.
  lock table public.properties, public.neighbourhoods, public.site_settings, public.listing_authors,
    public.site_activities, public.editorial_articles in share row exclusive mode;
  select * into listing from public.properties where id=job.property_id;
  if not found or listing.updated_at is distinct from p_version or not exists(
    select 1 from unnest(listing.images) uri where private.home_photo_key(uri,job.origin)=job.old_key
  ) then raise exception 'photo_rename.stale_listing' using errcode='40001';end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key
    and private.home_photo_key(uri,job.origin) is null)
  then raise exception 'photo_rename.other_origin' using errcode='40001';end if;
  new_uri:=job.origin||'/storage/v1/object/public/property-media/'||job.new_key;
  update private.property_photo_renames set applied_at=clock_timestamp(),applied_by=auth.uid() where id=job.id;
  with before_rename as materialized (
    select p.id,p.updated_at from public.properties p where exists(
      select 1 from (select unnest(p.images) uri union all select jsonb_object_keys(p.image_filenames)
        union all select jsonb_object_keys(p.image_metadata) union all select p.source_url) refs
      where private.home_photo_key(refs.uri,job.origin)=job.old_key
    )
  ), rewritten as (
    update public.properties p set
      images=array(select private.home_photo_replacement(uri,job.origin,job.old_key,new_uri)
        from unnest(p.images) with ordinality as i(uri,position) order by position),
      image_filenames=private.home_photo_map(p.image_filenames,job.origin,job.old_key,new_uri),
      image_metadata=private.home_photo_map(p.image_metadata,job.origin,job.old_key,new_uri),
      source_url=private.home_photo_replacement(p.source_url,job.origin,job.old_key,new_uri),
      updated_at=clock_timestamp()
    from before_rename b where p.id=b.id
    returning p.id,p.updated_at,b.updated_at as previous_updated_at
  ) select coalesce(jsonb_agg(to_jsonb(rewritten)),'[]'::jsonb) into changed from rewritten;
  update public.neighbourhoods set image=private.home_photo_replacement(image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image,job.origin)=job.old_key;
  update public.site_settings set hero_image=private.home_photo_replacement(hero_image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(hero_image,job.origin)=job.old_key;
  update public.listing_authors set portrait_url=private.home_photo_replacement(portrait_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(portrait_url,job.origin)=job.old_key;
  update public.site_activities set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    source_url=private.home_photo_replacement(source_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image_url,job.origin)=job.old_key or private.home_photo_key(source_url,job.origin)=job.old_key;
  update public.editorial_articles set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    sources=(select coalesce(jsonb_agg(
      case when private.home_photo_key(entry->>'url',job.origin)=job.old_key
      then jsonb_set(entry,'{url}',to_jsonb(private.home_photo_replacement(entry->>'url',job.origin,job.old_key,new_uri)))
      else entry end order by position),'[]'::jsonb) from jsonb_array_elements(sources) with ordinality as s(entry,position))
    where private.home_photo_key(image_url,job.origin)=job.old_key or exists(
      select 1 from jsonb_array_elements(sources) entry where private.home_photo_key(entry->>'url',job.origin)=job.old_key
    );
  update private.property_photo_renames set properties=changed where id=job.id returning * into job;
  return to_jsonb(job);
end;$$;

create function public.home_photo_rename_history(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_admin();
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    select id,old_key,new_key,applied_at,removed_at from private.property_photo_renames
    where property_id=p_property order by started_at desc limit 40
  ) r),'[]'::jsonb);
end;$$;

create function public.home_photo_rename_request_removal(p_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='40001';end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key);end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key)
    then raise exception 'photo_rename.in_use' using errcode='40001';end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='40001';end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;$$;

create function public.home_photo_rename_removed(p_id uuid) returns boolean
language sql security definer set search_path='' as $$
  with removed as (
    update private.property_photo_renames r set removed_at=coalesce(removed_at,clock_timestamp())
    where id=p_id and applied_at is not null and removal_requested_by is not null
     and not exists(select 1 from storage.objects o where o.bucket_id='property-media' and o.name=r.old_key)
     returning id
  ) select exists(select 1 from removed);
$$;

revoke all on private.home_photo_references from public,anon,authenticated;
revoke all on function private.home_photo_key(text,text),private.require_home_photo_admin(),
  private.home_photo_replacement(text,text,text,text),private.home_photo_map(jsonb,text,text,text),
  private.home_photo_blocked(text),private.guard_home_photo_reference()
  from public,anon,authenticated;
revoke all on function public.home_photo_rename_lookup(uuid,text,text,text),public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),public.home_photo_rename_request_removal(uuid,boolean),
  public.home_photo_rename_verified(uuid,text),public.home_photo_rename_removed(uuid) from public,anon,authenticated;
grant execute on function public.home_photo_rename_lookup(uuid,text,text,text),public.home_photo_rename_reserve(uuid,text,text,text,timestamptz),
  public.home_photo_rename_apply(uuid,timestamptz),public.home_photo_rename_history(uuid),
  public.home_photo_rename_request_removal(uuid,boolean) to authenticated;
grant execute on function public.home_photo_rename_verified(uuid,text),public.home_photo_rename_removed(uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261119073707_property_photo_rename_completion.sql
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

-- Migration: 20261119095000_property_deletion_media_cleanup.sql
-- Requires the listing photo rename and completion migrations. Review before applying.
begin;

create table private.home_listing_deletions (
  property_id uuid primary key,
  listing_code text not null,
  previous_status text,
  requested_by uuid not null,
  requested_at timestamptz not null default now()
);
create table private.home_listing_deletion_media (
  property_id uuid not null references private.home_listing_deletions(property_id),
  bucket text not null check (bucket in ('property-media','listing-videos')),
  name text not null,
  object_id uuid not null,
  object_version text,
  bytes bigint,
  evidence text not null,
  state text not null default 'captured' check (state in ('captured','pending','retained','review','removed')),
  last_attempt_at timestamptz,
  last_attempt_by uuid,
  removed_at timestamptz,
  primary key (property_id,bucket,name)
);
create unique index home_listing_deletion_reserved_key on private.home_listing_deletion_media(bucket,name)
  where state in ('pending','review','removed');
alter table private.home_listing_deletions enable row level security;
alter table private.home_listing_deletion_media enable row level security;
revoke all on private.home_listing_deletions,private.home_listing_deletion_media from public,anon,authenticated,service_role;

-- Match whole URL paths, including percent-encoded names and transformed images.
-- Treat links on other hosts conservatively when their bucket and key match.
create function private.home_listing_storage_links(body text)
returns table(bucket text,name text) language sql immutable set search_path='' as $$
  select lower(hit[1]), private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||hit[2],null)
  from regexp_matches(body,
    '/(property-media|listing-videos)/([^[:space:]"<>?#,;\\]+\.(?:jpe?g|png|webp|avif|mp4))(?=$|[^[:alnum:]_%/-])','gi') hit;
$$;

create view private.home_listing_media_refs as
  select 'property-media'::text bucket, private.home_photo_key(uri,null) name from private.home_photo_references
  union all
  select r.bucket,r.name from (
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
  ) records cross join lateral private.home_listing_storage_links(records.body) r;
revoke all on private.home_listing_media_refs from public,anon,authenticated,service_role;

create function private.guard_home_listing_media_ref() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior text;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old)::text; end if;
  if exists(select 1 from private.home_listing_storage_links(to_jsonb(new)::text) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed')) or (l.bucket='property-media' and exists(
        select 1 from private.property_photo_renames r where r.old_key=l.name and r.removal_requested_by is not null)))
    and not exists(select 1 from private.home_listing_storage_links(prior) p where p.bucket=l.bucket and p.name=l.name)) then
    raise exception 'listing_cleanup.retired_reference' using errcode='40001';
  end if;
  return new;
end;
$$;
do $$
declare table_name text;
begin
  foreach table_name in array array['properties','neighbourhoods','site_settings','listing_authors','site_activities',
    'editorial_articles','enquiries','enquiry_notes','feedback_public','feedback_submissions','property_assistance',
    'assistance_reviews','landlord_submissions','landlord_submission_files'] loop
    execute format('create trigger guard_home_listing_media before insert or update on public.%I
      for each row execute function private.guard_home_listing_media_ref()',table_name);
  end loop;
end;
$$;

-- The UUID for a scoped upload is part of its actual Storage path.
create function private.home_listing_upload_id(p_bucket text,p_name text) returns text
language sql immutable set search_path='' as $$
  select case when p_bucket='property-media' and p_name ~ '^properties/listings/[0-9a-f-]{36}/[0-9a-f-]{36}/[a-z0-9-]+\.(jpg|png|webp|avif)$'
    then split_part(p_name,'/',3)
    when p_bucket='listing-videos' and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
    then split_part(p_name,'/',2) end;
$$;
create function private.home_listing_media_upload_allowed(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.home_listing_deletions d
      where d.property_id::text=private.home_listing_upload_id(p_bucket,p_name))
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=p_bucket and m.name=p_name and m.state in ('pending','review','removed'));
$$;
revoke all on function private.home_listing_media_upload_allowed(text,text) from public,anon,authenticated;
grant execute on function private.home_listing_media_upload_allowed(text,text) to authenticated;
create policy home_listing_deleted_upload_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id not in ('property-media','listing-videos') or private.home_listing_media_upload_allowed(bucket_id,name));

create function private.guard_home_listing_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if exists(select 1 from private.home_listing_deletions d where d.property_id=new.id) then
      raise exception 'listing_cleanup.deleted' using errcode='40001';
    end if;
    return new;
  end if;
  if not exists(select 1 from private.home_listing_deletions d where d.property_id=old.id) then
    raise exception 'listing_cleanup.manifest_required' using errcode='42501';
  end if;
  return old;
end;
$$;
create trigger guard_home_listing_delete before insert or delete on public.properties
  for each row execute function private.guard_home_listing_delete();
revoke delete on public.properties from public,anon,authenticated;
revoke execute on function public.delete_property(uuid) from public,anon,authenticated;

-- Serialize against rename reservations and writes to reference-bearing tables.
-- EXCLUSIVE blocks Storage finalization, while public reads remain available.
-- NOWAIT prevents contention with a live upload from stalling the shared project.
create function private.lock_home_listing_media_snapshot(p_include_storage boolean default true) returns void
language plpgsql set search_path='' as $$
begin
  if not pg_try_advisory_xact_lock(hashtextextended('home.photo.rename',0)) then
    raise exception 'listing_cleanup.media_busy' using errcode='55P03';
  end if;
  lock table public.properties,public.neighbourhoods,public.site_settings,public.listing_authors,public.site_activities,
    public.editorial_articles,public.enquiries,public.enquiry_notes,public.feedback_public,public.feedback_submissions,
    public.property_assistance,public.assistance_reviews,public.landlord_submissions,public.landlord_submission_files
    in share row exclusive mode nowait;
  if p_include_storage then lock table storage.objects in exclusive mode nowait; end if;
end;
$$;

create function private.home_listing_delete_result(p_property uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('propertyId',d.property_id,'listingCode',d.listing_code,'requestedAt',d.requested_at,
    'pending',count(m.name) filter (where m.state in ('pending','captured')),
    'removed',count(m.name) filter (where m.state='removed'),
    'retained',count(m.name) filter (where m.state='retained'),
    'review',count(m.name) filter (where m.state='review'))
  from private.home_listing_deletions d left join private.home_listing_deletion_media m using(property_id)
  where d.property_id=p_property group by d.property_id;
$$;

create function public.home_listing_delete_prepare(p_property uuid,p_version timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare listing public.properties; storage_origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if exists(select 1 from private.home_listing_deletions d where d.property_id=p_property) then
    return private.home_listing_delete_result(p_property);
  end if;
  select * into listing from public.properties where id=p_property;
  if not found then raise exception 'listing_cleanup.missing' using errcode='P0002'; end if;
  if listing.updated_at is distinct from p_version then raise exception 'listing_cleanup.stale' using errcode='40001'; end if;
  if exists(select 1 from private.property_photo_renames r where r.applied_at is null and
    (r.property_id=p_property or r.old_key in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri))) then
    raise exception 'listing_cleanup.rename_pending' using errcode='40001';
  end if;

  insert into private.home_listing_deletions(property_id,listing_code,previous_status,requested_by)
    values(p_property,listing.listing_code,listing.status,auth.uid());
  insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence)
    select p_property,o.bucket_id,o.name,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
      case when renamed.name is not null then 'rename_ledger' when owned.path then 'listing_path'
        when owned.gallery then 'saved_gallery' when owned.prior then 'previously_shared' else 'unverified_ownership' end
    from storage.objects o
    left join lateral (
      select o.name from private.property_photo_renames r where r.property_id=p_property and r.origin=storage_origin
        and r.applied_at is not null and o.bucket_id='property-media' and o.name in (r.old_key,r.new_key) limit 1
    ) renamed on true
    cross join lateral (select (o.bucket_id='property-media' and o.name in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri)) or
      (o.bucket_id='listing-videos' and starts_with(listing.video_url,storage_origin||'/') and exists(
        select 1 from private.home_listing_storage_links(listing.video_url) l where l.bucket=o.bucket_id and l.name=o.name)) as linked) saved
    cross join lateral (select private.home_listing_upload_id(o.bucket_id,o.name)=p_property::text as path,
      o.bucket_id='property-media' and saved.linked and o.name ~ '^properties/[0-9a-f-]{36}(/[a-z0-9-]+)?\.(jpe?g|png|webp|avif)$'
        and not exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key) and r.property_id<>p_property) as gallery,
      saved.linked and exists(select 1 from private.home_listing_deletion_media m
        where m.bucket=o.bucket_id and m.name=o.name and m.object_id=o.id and m.object_version is not distinct from o.version
          and m.state='retained' and m.evidence<>'unverified_ownership') as prior) owned
    where o.bucket_id in ('property-media','listing-videos')
      and coalesce(to_jsonb(o)->>'archived_at','')='' and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)=false
      and (renamed.name is not null or owned.path or saved.linked)
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=o.bucket_id and m.name=o.name and m.state in ('pending','review','removed'));

  -- Keep the existing FK cascades and CRM attribution trigger in this transaction.
  delete from public.properties where id=p_property;
  update private.home_listing_deletion_media m set state=case
    when m.evidence='unverified_ownership' or exists(
      select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name) then 'retained'
    when not exists(select 1 from private.home_listing_storage_links('/'||m.bucket||'/'||m.name) l
      where l.bucket=m.bucket and l.name=m.name) then 'review'
    else 'pending' end
    where m.property_id=p_property;
  return private.home_listing_delete_result(p_property);
end;
$$;

-- Accept only an explicitly reviewed identity for each historical object.
-- A committed rename is durable proof that the missing listing once existed.
create function public.home_listing_delete_adopt(p_property uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; target storage.objects; previous private.home_listing_deletion_media;
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 80 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if exists(select 1 from public.properties p where p.id=p_property) or not exists(
    select 1 from private.property_photo_renames r where r.property_id=p_property and r.applied_at is not null
      and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co') then
    raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
  insert into private.home_listing_deletions(property_id,listing_code,requested_by)
    values(p_property,'',auth.uid()) on conflict do nothing;
  for item in select value from jsonb_array_elements(p_manifest) loop
    select * into previous from private.home_listing_deletion_media m where m.property_id=p_property
      and m.bucket=item->>'bucket' and m.name=item->>'name';
    if found and previous.object_id::text=item->>'id' and previous.object_version is not distinct from item->>'version'
      and previous.state in ('pending','removed') then continue; end if;
    select o.* into target from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id=item->>'bucket' and o.name=item->>'name' and o.id::text=item->>'id'
        and o.version is not distinct from item->>'version'
        and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
        and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false);
    if not found or not exists(select 1 from private.home_listing_storage_links('/'||target.bucket_id||'/'||target.name) l
        where l.bucket=target.bucket_id and l.name=target.name)
      or exists(select 1 from private.home_listing_media_refs r where r.bucket=target.bucket_id and r.name=target.name) then
      raise exception 'listing_cleanup.manifest_changed' using errcode='40001'; end if;
    if not ((target.bucket_id='listing-videos' and coalesce(private.home_listing_upload_id(target.bucket_id,target.name)=p_property::text,false))
       or (target.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r
        where r.property_id=p_property and r.applied_at is not null and target.name in (r.old_key,r.new_key)
          and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co'))) then
      raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
    insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence,state)
      values(p_property,target.bucket_id,target.name,target.id,target.version,
        case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,'approved_history','pending');
  end loop;
  return private.home_listing_delete_result(p_property);
end;
$$;

create function public.home_listing_delete_status(p_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_admin();
  if p_property is not null then return private.home_listing_delete_result(p_property); end if;
  return coalesce((select jsonb_agg(private.home_listing_delete_result(q.property_id) order by q.requested_at desc)
    from (select d.property_id,d.requested_at from private.home_listing_deletions d where exists(
      select 1 from private.home_listing_deletion_media m where m.property_id=d.property_id and m.state in ('pending','review'))
      order by d.requested_at desc limit 40) q),'[]'::jsonb);
end;
$$;

create function public.home_listing_delete_targets(p_property uuid,p_actor uuid)
returns table(bucket text,name text) language plpgsql security definer set search_path='' as $$
begin
  update private.home_listing_deletion_media m set state=case
    when exists(select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name) then 'retained'
    else 'review' end
  where m.property_id=p_property and m.state='pending' and (
    exists(select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name)
    or not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id=m.bucket and o.name=m.name and o.id=m.object_id and o.version is not distinct from m.object_version
        and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
        and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)));
  return query update private.home_listing_deletion_media m set last_attempt_at=clock_timestamp(),last_attempt_by=p_actor
    where m.property_id=p_property and (m.bucket,m.name) in (
      select q.bucket,q.name from private.home_listing_deletion_media q
      where q.property_id=p_property and q.state='pending' order by q.bucket,q.name limit 300)
    returning m.bucket,m.name;
end;
$$;

create function public.home_listing_delete_confirm(p_property uuid,p_bucket text,p_names text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.home_listing_deletion_media m set state='removed',removed_at=clock_timestamp()
    where m.property_id=p_property and m.bucket=p_bucket and m.name=any(p_names)
      and m.state in ('pending','review') and m.last_attempt_at is not null and not exists(
      select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name);
end;
$$;

-- Prevent two app requests from sending the same server-only copy. If its
-- outcome is unknown, the existing retry verifies the reserved object first.
alter table private.property_photo_renames add column copy_claimed_at timestamptz;
create function public.home_photo_rename_claim_copy(p_id uuid) returns boolean
language sql security definer set search_path='' as $$
  with claim as (update private.property_photo_renames r set copy_claimed_at=clock_timestamp()
    where r.id=p_id and r.applied_at is null and r.copy_claimed_at is null returning id)
  select exists(select 1 from claim);
$$;

-- Apply the broader reference inventory to the existing rename cleanup path.
create or replace function public.home_photo_rename_request_removal(p_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot(false);
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='40001'; end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key); end if;
  if exists(select 1 from private.home_listing_media_refs r where r.bucket='property-media' and r.name=job.old_key) then
    raise exception 'photo_rename.in_use' using errcode='40001'; end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='40001'; end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;
$$;

revoke all on function private.home_listing_storage_links(text),private.home_listing_upload_id(text,text),
  private.guard_home_listing_media_ref(),private.guard_home_listing_delete(),private.lock_home_listing_media_snapshot(boolean),
  private.home_listing_delete_result(uuid) from public,anon,authenticated,service_role;
revoke all on function public.home_listing_delete_prepare(uuid,timestamptz),public.home_listing_delete_status(uuid),
  public.home_listing_delete_adopt(uuid,jsonb),
  public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_photo_rename_claim_copy(uuid) from public,anon,authenticated,service_role;
grant execute on function public.home_listing_delete_prepare(uuid,timestamptz),public.home_listing_delete_status(uuid) to authenticated;
grant execute on function public.home_listing_delete_adopt(uuid,jsonb) to authenticated;
grant execute on function public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_photo_rename_claim_copy(uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261119183631_property_photo_rename_owner_only.sql
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

-- Migration: 20261124063907_home_staff_credential_boundary.sql
begin;

-- Retire the legacy temporary-password RPC while retaining reminder and audit
-- history. Self-service password changes still clear a user's own reminder.
revoke all on function public.staff_temporary_password_request(uuid,boolean),
  private.staff_temporary_password_request(uuid,boolean) from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261124064334_home_public_listing_projection.sql
begin;

-- Public catalogues use this read-only projection. The staff table retains
-- original upload names and full listing history for authorized editors.
create view public.home_public_properties with (security_barrier=true) as
select id,slug,title_en,title_vi,listing_code,author_id,price_period,rental_term,
       overview_en,overview_vi,location_en,location_vi,furnishings_en,furnishings_vi,seo_features,
       description_en,description_vi,district_slug,address,map_address,price,price_max,currency,
       price_vnd,price_vnd_max,listing_type,property_type,bedrooms,bathrooms,area_sqm,
       amenities,images,image_metadata,video_url,featured,status,availability,published_at,source_url,
       sort_order,created_at,updated_at
from public.properties
where status='published' and listing_type='rent' and availability in ('available','on_request');

revoke all on public.home_public_properties from public,anon,authenticated;
grant select on public.home_public_properties to anon,authenticated;

notify pgrst,'reload schema';
commit;

-- Migration: 20261124064349_home_restrict_internal_listing_reads.sql
-- Existing installations finish this step after deploying the clients that
-- read home_public_properties. Fresh setups already use the current clients.
begin;
-- Customer favourites still validate against the published catalogue.
alter policy saved_insert_self on public.saved_homes with check (
  user_id=(select auth.uid()) and exists(
    select 1 from public.home_public_properties p where p.id=property_id
  )
);
alter policy saved_rental_only on public.saved_homes with check (
  exists(select 1 from public.home_public_properties p where p.id=property_id)
);

drop policy properties_public_read on public.properties;
revoke select on public.properties from public,anon;

-- Keep the catalogue of object keys staff-only. The existing public bucket
-- URLs still serve published files without a Storage table SELECT.
create policy home_listing_media_no_anon_catalogue on storage.objects as restrictive for select to anon
  using (bucket_id not in ('property-media','listing-videos'));
create policy home_listing_media_staff_catalogue on storage.objects as restrictive for select to authenticated
  using (bucket_id not in ('property-media','listing-videos') or (select private.is_editor()));

notify pgrst,'reload schema';
commit;

-- Migration: 20261124102511_home_listing_cleanup_retry.sql
begin;

alter table private.home_listing_deletions
  add column cleanup_lease uuid,
  add column cleanup_lease_until timestamptz,
  add column cleanup_retry_after timestamptz not null default '-infinity',
  add column cleanup_retry_count integer not null default 0;

create function public.home_listing_delete_due() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'jobs',coalesce((select jsonb_agg(q.property_id order by q.requested_at,q.property_id)
      from (select d.property_id,d.requested_at from private.home_listing_deletions d
            where d.cleanup_retry_count<6 and d.cleanup_retry_after<=now()
              and coalesce(d.cleanup_lease_until,'-infinity')<=now()
              and exists(select 1 from private.home_listing_deletion_media m
                         where m.property_id=d.property_id and m.state='pending')
            order by d.requested_at,d.property_id limit 2) q),'[]'::jsonb),
    'overdue',(select count(*) from private.home_listing_deletions d
               where d.requested_at<now()-interval '24 hours'
                 and exists(select 1 from private.home_listing_deletion_media m
                            where m.property_id=d.property_id and m.state in ('pending','review')))
  );
$$;

-- Manual and scheduled requests share a lease. A stopped worker's lease
-- expires before another worker can retry the same batch.
create function public.home_listing_delete_claim(p_property uuid,p_background boolean) returns uuid
language sql volatile security definer set search_path='' as $$
  update private.home_listing_deletions d
  set cleanup_lease=gen_random_uuid(),cleanup_lease_until=now()+interval '2 minutes',
      cleanup_retry_after=now()+interval '1 hour',
      cleanup_retry_count=cleanup_retry_count+case when p_background then 1 else 0 end
  where d.property_id=p_property and coalesce(d.cleanup_lease_until,'-infinity')<=now()
    and (p_background is false or p_background is true and d.cleanup_retry_after<=now() and d.cleanup_retry_count<6)
    and exists(select 1 from private.home_listing_deletion_media m
               where m.property_id=d.property_id and m.state='pending')
  returning cleanup_lease;
$$;

create function public.home_listing_delete_release(p_property uuid,p_lease uuid) returns void
language sql volatile security definer set search_path='' as $$
  update private.home_listing_deletions
    set cleanup_lease=null,cleanup_lease_until=null
    where property_id=p_property and cleanup_lease=p_lease;
$$;

revoke all on function public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),
  public.home_listing_delete_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),
  public.home_listing_delete_release(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261124202612_home_postgrest_conflict_sqlstates.sql
-- Deterministic application conflicts must reach the caller as HTTP 409.
-- PostgreSQL's own serialization failures and deadlocks retain their SQLSTATEs.
begin;
set local search_path = pg_catalog, public;

CREATE OR REPLACE FUNCTION private.guard_home_listing_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='INSERT' then
    if exists(select 1 from private.home_listing_deletions d where d.property_id=new.id) then
      raise exception 'listing_cleanup.deleted' using errcode='PT409';
    end if;
    return new;
  end if;
  if not exists(select 1 from private.home_listing_deletions d where d.property_id=old.id) then
    raise exception 'listing_cleanup.manifest_required' using errcode='42501';
  end if;
  return old;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_home_listing_media_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prior text;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old)::text; end if;
  if exists(select 1 from private.home_listing_storage_links(to_jsonb(new)::text) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed')) or (l.bucket='property-media' and exists(
        select 1 from private.property_photo_renames r where r.old_key=l.name and r.removal_requested_by is not null)))
    and not exists(select 1 from private.home_listing_storage_links(prior) p where p.bucket=l.bucket and p.name=l.name)) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_home_photo_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_table_name='properties' then
    if exists(select 1 from
      (select unnest(new.images) uri union all select jsonb_object_keys(new.image_filenames)
       union all select jsonb_object_keys(new.image_metadata) union all select new.source_url) refs
       where private.home_photo_blocked(refs.uri))
    then raise exception 'photo_rename.stale_reference' using errcode='PT409';end if;
  elsif tg_table_name='editorial_articles' then
    if private.home_photo_blocked(new.image_url) or exists(
      select 1 from jsonb_array_elements(new.sources) entry where private.home_photo_blocked(entry->>'url')
    ) then raise exception 'photo_rename.stale_reference' using errcode='PT409';end if;
  elsif private.home_photo_blocked(to_jsonb(new)->>tg_argv[0])
    or (tg_nargs>1 and private.home_photo_blocked(to_jsonb(new)->>tg_argv[1])) then
    raise exception 'photo_rename.stale_reference' using errcode='PT409';
  end if;
  return new;
end;$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_apply(p_id uuid, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; listing public.properties; new_uri text; changed jsonb;
begin
  perform private.require_home_photo_admin();
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where id=p_id for update;
  if not found or job.sha256 is null then raise exception 'photo_rename.unverified' using errcode='PT409';end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  -- Exclude concurrent reference changes for the duration of this transaction.
  lock table public.properties, public.neighbourhoods, public.site_settings, public.listing_authors,
    public.site_activities, public.editorial_articles in share row exclusive mode;
  select * into listing from public.properties where id=job.property_id;
  if not found or listing.updated_at is distinct from p_version or not exists(
    select 1 from unnest(listing.images) uri where private.home_photo_key(uri,job.origin)=job.old_key
  ) then raise exception 'photo_rename.stale_listing' using errcode='PT409';end if;
  if exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=job.old_key
    and private.home_photo_key(uri,job.origin) is null)
  then raise exception 'photo_rename.other_origin' using errcode='PT409';end if;
  new_uri:=job.origin||'/storage/v1/object/public/property-media/'||job.new_key;
  update private.property_photo_renames set applied_at=clock_timestamp(),applied_by=auth.uid() where id=job.id;
  with before_rename as materialized (
    select p.id,p.updated_at from public.properties p where exists(
      select 1 from (select unnest(p.images) uri union all select jsonb_object_keys(p.image_filenames)
        union all select jsonb_object_keys(p.image_metadata) union all select p.source_url) refs
      where private.home_photo_key(refs.uri,job.origin)=job.old_key
    )
  ), rewritten as (
    update public.properties p set
      images=array(select private.home_photo_replacement(uri,job.origin,job.old_key,new_uri)
        from unnest(p.images) with ordinality as i(uri,position) order by position),
      image_filenames=private.home_photo_map(p.image_filenames,job.origin,job.old_key,new_uri),
      image_metadata=private.home_photo_map(p.image_metadata,job.origin,job.old_key,new_uri),
      source_url=private.home_photo_replacement(p.source_url,job.origin,job.old_key,new_uri),
      updated_at=clock_timestamp()
    from before_rename b where p.id=b.id
    returning p.id,p.updated_at,b.updated_at as previous_updated_at
  ) select coalesce(jsonb_agg(to_jsonb(rewritten)),'[]'::jsonb) into changed from rewritten;
  update public.neighbourhoods set image=private.home_photo_replacement(image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image,job.origin)=job.old_key;
  update public.site_settings set hero_image=private.home_photo_replacement(hero_image,job.origin,job.old_key,new_uri)
    where private.home_photo_key(hero_image,job.origin)=job.old_key;
  update public.listing_authors set portrait_url=private.home_photo_replacement(portrait_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(portrait_url,job.origin)=job.old_key;
  update public.site_activities set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    source_url=private.home_photo_replacement(source_url,job.origin,job.old_key,new_uri)
    where private.home_photo_key(image_url,job.origin)=job.old_key or private.home_photo_key(source_url,job.origin)=job.old_key;
  update public.editorial_articles set
    image_url=private.home_photo_replacement(image_url,job.origin,job.old_key,new_uri),
    sources=(select coalesce(jsonb_agg(
      case when private.home_photo_key(entry->>'url',job.origin)=job.old_key
      then jsonb_set(entry,'{url}',to_jsonb(private.home_photo_replacement(entry->>'url',job.origin,job.old_key,new_uri)))
      else entry end order by position),'[]'::jsonb) from jsonb_array_elements(sources) with ordinality as s(entry,position))
    where private.home_photo_key(image_url,job.origin)=job.old_key or exists(
      select 1 from jsonb_array_elements(sources) entry where private.home_photo_key(entry->>'url',job.origin)=job.old_key
    );
  update private.property_photo_renames set properties=changed where id=job.id returning * into job;
  return to_jsonb(job);
end;$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_request_removal(p_id uuid, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; target text;
begin
  perform private.require_home_photo_admin();
  if p_confirm is distinct from true then raise exception 'photo_rename.confirm_required' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot(false);
  select * into job from private.property_photo_renames where id=p_id and applied_at is not null for update;
  if not found then raise exception 'photo_rename.unverified' using errcode='PT409'; end if;
  if job.removed_at is not null then return to_jsonb(job)||jsonb_build_object('current_key',job.new_key); end if;
  if exists(select 1 from private.home_listing_media_refs r where r.bucket='property-media' and r.name=job.old_key) then
    raise exception 'photo_rename.in_use' using errcode='PT409'; end if;
  with recursive chain(key) as (
    select job.new_key union all
    select r.new_key from private.property_photo_renames r join chain c on c.key=r.old_key
      where r.origin=job.origin and r.applied_at is not null
  ) select c.key into target from chain c where not exists(
    select 1 from private.property_photo_renames r where r.old_key=c.key and r.origin=job.origin and r.applied_at is not null
  );
  if not exists(select 1 from public.properties p, unnest(p.images) uri where private.home_photo_key(uri,job.origin)=target)
    then raise exception 'photo_rename.replacement_unavailable' using errcode='PT409'; end if;
  update private.property_photo_renames set removal_requested_by=auth.uid() where id=job.id;
  return to_jsonb(job)||jsonb_build_object('current_key',target);
end;
$function$;

CREATE OR REPLACE FUNCTION private.home_photo_rename_reserve(p_property uuid, p_origin text, p_old_key text, p_name text, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare job private.property_photo_renames; listing public.properties; target text;
begin
  perform private.require_home_photo_admin();
  if p_name is null or p_name !~ '^[a-z0-9]+(-[a-z0-9]+)*\.(jpg|png|webp|avif)$' or char_length(p_name)>120
    or p_origin is null or p_origin !~ '^https?://[a-zA-Z0-9.:-]+$' then raise exception 'photo_rename.invalid_name' using errcode='22023';end if;
  target:='properties/renamed/'||p_property::text||'/'||p_name;
  if p_old_key=target then raise exception 'photo_rename.same_name' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('home.photo.rename',0));
  select * into job from private.property_photo_renames where origin=p_origin and old_key=p_old_key;
  if found and (job.property_id<>p_property or job.new_key<>target) then
    raise exception 'photo_rename.pending_name' using errcode='PT409';
  end if;
  if job.applied_at is not null then return to_jsonb(job);end if;
  select * into listing from public.properties where id=p_property;
  if not found or listing.updated_at is distinct from p_version then raise exception 'photo_rename.stale_listing' using errcode='PT409';end if;
  if not exists(select 1 from unnest(listing.images) uri where private.home_photo_key(uri,p_origin)=p_old_key) then
    raise exception 'photo_rename.photo_not_saved' using errcode='P0002';
  end if;
  if job.id is not null then return to_jsonb(job);end if;
  if exists(select 1 from private.property_photo_renames r where r.new_key=target or r.old_key=target)
    or exists(select 1 from storage.objects where bucket_id='property-media' and name=target)
    or exists(select 1 from private.home_photo_references where private.home_photo_key(uri,null)=target)
  then raise exception 'photo_rename.collision' using errcode='23505';end if;
  insert into private.property_photo_renames(property_id,origin,old_key,new_key,started_by)
    values(p_property,p_origin,p_old_key,target,auth.uid()) returning * into job;
  return to_jsonb(job);
end;$function$;

CREATE OR REPLACE FUNCTION private.limit_portal_guide_files()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_version timestamptz;
begin
 if auth.uid() is null or private.staff_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 -- Serialize concurrent uploads to enforce the limit across multiple tabs.
 select updated_at into current_version from public.portal_guides where id=new.guide_id for update;
 if current_version is distinct from new.guide_version then raise exception 'The guide changed during upload; review its audience before attaching this file' using errcode='PT409';end if;
 if (select count(*) from public.portal_guide_files where guide_id=new.guide_id)>=12 then raise exception 'A guide supports up to 12 files' using errcode='23514';end if;
 return new;
end; $function$;

CREATE OR REPLACE FUNCTION public.home_listing_delete_adopt(p_property uuid, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare item jsonb; target storage.objects; previous private.home_listing_deletion_media;
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if jsonb_typeof(p_manifest) is distinct from 'array' or jsonb_array_length(p_manifest) not between 1 and 80 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if exists(select 1 from public.properties p where p.id=p_property) or not exists(
    select 1 from private.property_photo_renames r where r.property_id=p_property and r.applied_at is not null
      and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co') then
    raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
  insert into private.home_listing_deletions(property_id,listing_code,requested_by)
    values(p_property,'',auth.uid()) on conflict do nothing;
  for item in select value from jsonb_array_elements(p_manifest) loop
    select * into previous from private.home_listing_deletion_media m where m.property_id=p_property
      and m.bucket=item->>'bucket' and m.name=item->>'name';
    if found and previous.object_id::text=item->>'id' and previous.object_version is not distinct from item->>'version'
      and previous.state in ('pending','removed') then continue; end if;
    select o.* into target from storage.objects o join storage.buckets b on b.id=o.bucket_id
      where o.bucket_id=item->>'bucket' and o.name=item->>'name' and o.id::text=item->>'id'
        and o.version is not distinct from item->>'version'
        and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
        and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false);
    if not found or not exists(select 1 from private.home_listing_storage_links('/'||target.bucket_id||'/'||target.name) l
        where l.bucket=target.bucket_id and l.name=target.name)
      or exists(select 1 from private.home_listing_media_refs r where r.bucket=target.bucket_id and r.name=target.name) then
      raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
    if not ((target.bucket_id='listing-videos' and coalesce(private.home_listing_upload_id(target.bucket_id,target.name)=p_property::text,false))
       or (target.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r
        where r.property_id=p_property and r.applied_at is not null and target.name in (r.old_key,r.new_key)
          and r.origin='https://duyiihsmaqfgwezmsnjs.supabase.co'))) then
      raise exception 'listing_cleanup.ownership_unverified' using errcode='22023'; end if;
    insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence,state)
      values(p_property,target.bucket_id,target.name,target.id,target.version,
        case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,'approved_history','pending');
  end loop;
  return private.home_listing_delete_result(p_property);
end;
$function$;

CREATE OR REPLACE FUNCTION public.home_listing_delete_prepare(p_property uuid, p_version timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare listing public.properties; storage_origin constant text:='https://duyiihsmaqfgwezmsnjs.supabase.co';
begin
  perform private.require_home_photo_admin();
  perform private.lock_home_listing_media_snapshot();
  if exists(select 1 from private.home_listing_deletions d where d.property_id=p_property) then
    return private.home_listing_delete_result(p_property);
  end if;
  select * into listing from public.properties where id=p_property;
  if not found then raise exception 'listing_cleanup.missing' using errcode='P0002'; end if;
  if listing.updated_at is distinct from p_version then raise exception 'listing_cleanup.stale' using errcode='PT409'; end if;
  if exists(select 1 from private.property_photo_renames r where r.applied_at is null and
    (r.property_id=p_property or r.old_key in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri))) then
    raise exception 'listing_cleanup.rename_pending' using errcode='PT409';
  end if;

  insert into private.home_listing_deletions(property_id,listing_code,previous_status,requested_by)
    values(p_property,listing.listing_code,listing.status,auth.uid());
  insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,bytes,evidence)
    select p_property,o.bucket_id,o.name,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
      case when renamed.name is not null then 'rename_ledger' when owned.path then 'listing_path'
        when owned.gallery then 'saved_gallery' when owned.prior then 'previously_shared' else 'unverified_ownership' end
    from storage.objects o
    left join lateral (
      select o.name from private.property_photo_renames r where r.property_id=p_property and r.origin=storage_origin
        and r.applied_at is not null and o.bucket_id='property-media' and o.name in (r.old_key,r.new_key) limit 1
    ) renamed on true
    cross join lateral (select (o.bucket_id='property-media' and o.name in
      (select private.home_photo_key(uri,storage_origin) from unnest(listing.images) uri)) or
      (o.bucket_id='listing-videos' and starts_with(listing.video_url,storage_origin||'/') and exists(
        select 1 from private.home_listing_storage_links(listing.video_url) l where l.bucket=o.bucket_id and l.name=o.name)) as linked) saved
    cross join lateral (select private.home_listing_upload_id(o.bucket_id,o.name)=p_property::text as path,
      o.bucket_id='property-media' and saved.linked and o.name ~ '^properties/[0-9a-f-]{36}(/[a-z0-9-]+)?\.(jpe?g|png|webp|avif)$'
        and not exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key) and r.property_id<>p_property) as gallery,
      saved.linked and exists(select 1 from private.home_listing_deletion_media m
        where m.bucket=o.bucket_id and m.name=o.name and m.object_id=o.id and m.object_version is not distinct from o.version
          and m.state='retained' and m.evidence<>'unverified_ownership') as prior) owned
    where o.bucket_id in ('property-media','listing-videos')
      and coalesce(to_jsonb(o)->>'archived_at','')='' and coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)=false
      and (renamed.name is not null or owned.path or saved.linked)
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=o.bucket_id and m.name=o.name and m.state in ('pending','review','removed'));

  -- Keep the existing FK cascades and CRM attribution trigger in this transaction.
  delete from public.properties where id=p_property;
  update private.home_listing_deletion_media m set state=case
    when m.evidence='unverified_ownership' or exists(
      select 1 from private.home_listing_media_refs r where r.bucket=m.bucket and r.name=m.name) then 'retained'
    when not exists(select 1 from private.home_listing_storage_links('/'||m.bucket||'/'||m.name) l
      where l.bucket=m.bucket and l.name=m.name) then 'review'
    else 'pending' end
    where m.property_id=p_property;
  return private.home_listing_delete_result(p_property);
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_property_order(order_scope text, ordered_property_ids uuid[], expected_property_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_ids uuid[];
begin
 if not private.can_order_properties() then raise exception 'Owner, admin or manager access required.' using errcode='42501'; end if;
 if order_scope is null or order_scope not in ('home','listings') or not private.valid_property_order(ordered_property_ids) then
  raise exception 'Choose current public rental listings with no duplicates.' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gary-property-order:'||order_scope,0));
 select property_ids into current_ids from public.property_display_orders where scope=order_scope;
 if expected_property_ids is not null and coalesce(current_ids,'{}'::uuid[]) is distinct from expected_property_ids then
  raise exception 'This order changed. Refresh the page before saving.' using errcode='PT409'; end if;
 insert into public.property_display_orders(scope,property_ids) values(order_scope,ordered_property_ids)
 on conflict(scope) do update set property_ids=excluded.property_ids,updated_at=now();
end; $function$;

commit;

-- Migration: 20261126100000_home_media_retention.sql
-- Review and apply only after the Gary Home WebP and delivery verification.
begin;

create table private.home_media_control (
  singleton boolean primary key default true check(singleton),
  permanent_enabled boolean not null default false,
  last_scan_at timestamptz,
  lease uuid,
  lease_until timestamptz
);
insert into private.home_media_control default values;

create table private.home_media_items (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check(bucket in ('property-media','listing-videos')),
  name text not null,
  source text not null check(source in ('listing','rename','upload','detached','historical')),
  source_id uuid,
  upload_owner uuid,
  upload_until timestamptz,
  object_id uuid,
  object_version text,
  bytes bigint,
  state text not null check(state in ('uploading','candidate','trashed','deleting','removed','restored','retained','review')),
  hold_reason text,
  unreferenced_since timestamptz,
  expires_at timestamptz,
  retry_after timestamptz,
  attempts integer not null default 0,
  removed_at timestamptz,
  replacement_key text,
  replacement_sha256 text,
  replacement_id uuid,
  replacement_version text,
  restore_media jsonb,
  restored_to uuid,
  deletion_started_at timestamptz,
  deletion_run uuid,
  historical_review jsonb,
  unique(bucket,name)
);
create index home_media_due on private.home_media_items(expires_at,retry_after,id)
  where state in ('trashed','deleting');
create index home_media_reconcile on private.home_media_items(retry_after,id)
  where deletion_started_at is not null and state in ('deleting','review');
create index home_media_upload_due on private.home_media_items(upload_until,id) where state='uploading';
create index home_media_detached_due on private.home_media_items(expires_at,id) where state='candidate';
create index home_media_reserved_name on private.home_media_items(name)
  where state in ('trashed','deleting','removed','review');

create table private.home_media_deleted_listings (
  listing_id uuid primary key,
  snapshot jsonb not null,
  expires_at timestamptz not null,
  draft_id uuid
);
create index home_media_deleted_listings_expiry on private.home_media_deleted_listings(expires_at);
create table private.home_media_renamed_listings (
  rename_id uuid not null references private.property_photo_renames(id),
  listing_id uuid not null,
  before_media jsonb not null,
  after_media jsonb not null,
  primary key(rename_id,listing_id)
);

create table private.home_media_runs (
  id uuid primary key,
  actor uuid,
  early_item uuid,
  early_expiry timestamptz,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempted integer not null default 0,
  removed integer not null default 0,
  failed integer not null default 0
);
create index home_media_runs_recent on private.home_media_runs(started_at desc);
alter table private.home_media_control enable row level security;
alter table private.home_media_items enable row level security;
alter table private.home_media_runs enable row level security;
alter table private.home_media_deleted_listings enable row level security;
alter table private.home_media_renamed_listings enable row level security;
revoke all on private.home_media_control,private.home_media_items,private.home_media_runs,
  private.home_media_deleted_listings,private.home_media_renamed_listings
  from public,anon,authenticated,service_role;

-- Extend the existing dependencies to recognize typed paths with encoded or raw filenames.
-- Exact URL references remain distinct from filename-only hints used for the report.
create function private.home_media_links(body jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  select l.bucket,l.name from private.home_listing_storage_links(body::text) l
  union
  select 'property-media',private.home_photo_key(v #>> '{}',null)
  from jsonb_path_query(body,'strict $.** ? (@.type() == "string")') v
  where private.home_photo_key(v #>> '{}',null) is not null;
$$;

create function private.home_media_listing_fields(p public.properties) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('images',p.images,'image_filenames',p.image_filenames,'image_metadata',p.image_metadata,
    'video_url',p.video_url,'source_url',p.source_url);
$$;

create function private.home_media_saved_attachment(p_fields jsonb,p_bucket text,p_name text) returns boolean
language sql immutable set search_path='' as $$
  select case when p_bucket='property-media' then exists(
      select 1 from jsonb_array_elements_text(p_fields->'images') u where private.home_photo_key(u,null)=p_name)
    else exists(select 1 from private.home_listing_storage_links(p_fields->>'video_url') l where l.bucket=p_bucket and l.name=p_name)
  end;
$$;

-- Keep existing triggers and augment their durable key reservation.
create or replace function private.guard_home_listing_media_ref() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  if exists(select 1 from private.home_media_links(to_jsonb(new)) l where (
    exists(select 1 from private.home_listing_deletion_media m where m.bucket=l.bucket and m.name=l.name
      and m.state in ('pending','review','removed'))
    or exists(select 1 from private.home_media_items i where i.bucket=l.bucket and i.name=l.name
      and i.state in ('trashed','deleting','removed','review'))
    or (l.bucket='property-media' and exists(select 1 from private.property_photo_renames r
      where r.old_key=l.name and r.removal_requested_by is not null))
  ) and not exists(select 1 from private.home_media_links(prior) p where p.bucket=l.bucket and p.name=l.name))
    or exists(select 1 from jsonb_path_query(to_jsonb(new),'strict $.** ? (@.type() == "string")') v
      join private.home_media_items i on i.name=(v #>> '{}') and i.state in ('trashed','deleting','removed','review')
      where not exists(select 1 from jsonb_path_query(prior,'strict $.** ? (@.type() == "string")') p where p=v))
  then raise exception 'listing_cleanup.retired_reference' using errcode='PT409'; end if;
  return new;
end;
$$;

-- Route listing-video deletions through the same recoverable workflow.
alter policy listing_video_delete_guard on storage.objects using (bucket_id<>'listing-videos');

create or replace function private.home_listing_media_upload_allowed(p_bucket text,p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.home_listing_deletions d
      where d.property_id::text=private.home_listing_upload_id(p_bucket,p_name))
    and not exists(select 1 from private.home_listing_deletion_media m
      where m.bucket=p_bucket and m.name=p_name and m.state in ('pending','review','removed'))
    and not exists(select 1 from private.home_media_items i where i.bucket=p_bucket and i.name=p_name
      and i.state in ('trashed','deleting','removed','review'));
$$;

create function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_listing_media_refs r where r.bucket=p_bucket and r.name=p_name)
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

create function private.home_media_identity(p_bucket text,p_name text) returns setof storage.objects
language sql stable set search_path='' as $$
  select o.* from storage.objects o join storage.buckets b on b.id=o.bucket_id
  where o.bucket_id=p_bucket and o.name=p_name
    and coalesce(to_jsonb(b)->>'versioning_status','DISABLED')='DISABLED'
    and not coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
    and not coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
    and to_jsonb(o)->>'archived_at' is null;
$$;

-- Applied renames retain their old-key guard until the Owner restores the
-- same retained object and its captured listing relations in one transaction.
create or replace function private.home_photo_blocked(uri text) returns boolean
language sql security definer set search_path='' as $$
  select exists(select 1 from private.property_photo_renames r
    where (case when r.applied_at is null then r.new_key else r.old_key end)=private.home_photo_key(uri,null)
    and (r.applied_at is null or not exists(select 1 from private.home_media_items i
      join lateral private.home_media_identity(i.bucket,i.name) o on o.id=i.object_id and o.version is not distinct from i.object_version
      where i.bucket='property-media' and i.name=r.old_key and i.source='rename' and i.source_id=r.id and i.state='restored')));
$$;

create function private.home_media_provider_upload(p_bucket text,p_name text) returns boolean
language plpgsql stable set search_path='' as $$
declare pending boolean;
begin
  if to_regclass('storage.s3_multipart_uploads') is null then return false; end if;
  execute 'select exists(select 1 from storage.s3_multipart_uploads where bucket_id=$1 and key=$2)'
    into pending using p_bucket,p_name;
  return pending;
end;
$$;

-- A historical decision is its own review record. The Owner supplies the
-- independently verified backup checksum and an actual custody evidence reference.
create function public.home_media_enroll_historical(p_review jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target storage.objects; item private.home_media_items; proof jsonb;
  object_name text:=p_review->>'key'; sha text:=p_review->>'backupSha256'; evidence text:=btrim(p_review->>'evidenceRef');
begin
  perform private.require_home_photo_owner();
  if p_confirm is not true or coalesce(sha,'') !~ '^[0-9a-f]{64}$' or coalesce(length(evidence),0) not between 3 and 240
    or coalesce(p_review->>'bytes','') !~ '^[0-9]{1,12}$' or nullif(p_review->>'version','') is null
    or nullif(p_review->>'etag','') is null or char_length(coalesce(object_name,'')) not between 1 and 1024 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  perform private.lock_home_listing_media_snapshot();
  select * into target from private.home_media_identity('property-media',object_name);
  if not found or target.id::text is distinct from p_review->>'objectId'
    or target.version is distinct from p_review->>'version' or target.metadata->>'size' is distinct from p_review->>'bytes'
    or btrim(coalesce(target.metadata->>'eTag',target.metadata->>'etag'),'"') is distinct from btrim(p_review->>'etag','"')
    or not exists(select 1 from private.home_listing_storage_links('/property-media/'||object_name) l where l.name=object_name)
    or private.home_media_referenced('property-media',object_name,true) or private.home_media_provider_upload('property-media',object_name)
    or exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id('property-media',object_name))
    or exists(select 1 from private.property_photo_renames r where object_name in(r.old_key,r.new_key))
    or exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=object_name)
  then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  proof:=jsonb_build_object('evidenceRef',evidence,'backupSha256',sha,'etag',btrim(p_review->>'etag','"'));
  insert into private.home_media_items(bucket,name,source,object_id,object_version,bytes,state,unreferenced_since,expires_at,historical_review)
  values('property-media',object_name,'historical',target.id,target.version,(p_review->>'bytes')::bigint,'trashed',now(),now()+interval '48 hours',
    proof||jsonb_build_object('actor',auth.uid(),'reviewedAt',clock_timestamp()))
  on conflict(bucket,name) do nothing;
  select * into item from private.home_media_items i where i.bucket='property-media' and i.name=object_name;
  if item.source<>'historical' or item.state<>'trashed' or item.object_id is distinct from target.id
    or item.object_version is distinct from target.version or not (item.historical_review @> proof) then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  return jsonb_build_object('id',item.id,'expiresAt',item.expires_at);
end;
$$;

-- Ordinary uploaders can protect a fresh key of their own. They cannot audit or
-- modify a cleanup reservation. Live listing paths are held even after expiry.
create function public.home_media_upload_lease(p_bucket text,p_name text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(private.is_editor(),false) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501';
  end if;
  if p_bucket not in ('property-media','listing-videos') or p_bucket is null or
    (private.home_listing_upload_id(p_bucket,p_name) is null and
      not coalesce(p_bucket='property-media' and p_name ~ '^properties/[0-9a-f-]{36}/[a-z0-9-]+\.(jpe?g|png|webp|avif)$',false))
  then raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  if p_bucket='listing-videos' and split_part(p_name,'/',1)<>auth.uid()::text then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if not private.home_listing_media_upload_allowed(p_bucket,p_name) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  insert into private.home_media_items(bucket,name,source,upload_owner,upload_until,state)
    select p_bucket,p_name,'upload',auth.uid(),now()+interval '24 hours','uploading'
    where not exists(select 1 from storage.objects o where o.bucket_id=p_bucket and o.name=p_name)
  on conflict(bucket,name) do update set upload_until=excluded.upload_until
    where home_media_items.source='upload' and home_media_items.state='uploading'
      and home_media_items.upload_owner=auth.uid();
  if not found then
    update private.home_media_items set upload_until=now()+interval '24 hours'
    where bucket=p_bucket and name=p_name and source='upload' and state='uploading' and upload_owner=auth.uid();
    if not found then raise exception 'listing_cleanup.retired_reference' using errcode='PT409'; end if;
  end if;
end;
$$;

create function private.home_media_record_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.state='pending' and (tg_op='INSERT' or old.state<>'pending') then
    insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
    values(new.bucket,new.name,'listing',new.property_id,new.object_id,new.object_version,new.bytes,'trashed',
      now(),now()+interval '48 hours')
    on conflict(bucket,name) do update set source=excluded.source,source_id=excluded.source_id,
      object_id=excluded.object_id,object_version=excluded.object_version,bytes=excluded.bytes,state='trashed',
      unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,
      upload_owner=null,upload_until=null,restored_to=null,restore_media=null,attempts=0,retry_after=null,
      deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored');
  end if;
  return new;
end;
$$;
create trigger home_media_record_listing after insert or update of state on private.home_listing_deletion_media
  for each row execute function private.home_media_record_listing();
-- Existing pending items receive a full recovery window after rollout.
insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
  select bucket,name,'listing',property_id,object_id,object_version,bytes,'trashed',now(),now()+interval '48 hours'
  from private.home_listing_deletion_media where state='pending';

create function private.home_media_capture_deleted_listing() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.home_listing_deletion_media m where m.property_id=old.id and m.state='captured') then
    insert into private.home_media_deleted_listings(listing_id,snapshot,expires_at)
      values(old.id,to_jsonb(old),now()+interval '48 hours');
  end if;
  return old;
end;
$$;
create trigger home_media_capture_deleted_listing before delete on public.properties
  for each row execute function private.home_media_capture_deleted_listing();

-- Record a saved gallery/video removal without scanning other writers during save.
-- The worker checks all dependencies while holding the existing snapshot lock.
create function private.home_media_record_detached() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_media jsonb:=private.home_media_listing_fields(old);
  after_media jsonb:=private.home_media_listing_fields(new);
begin
  insert into private.home_media_renamed_listings(rename_id,listing_id,before_media,after_media)
  select r.id,old.id,before_media,after_media from private.property_photo_renames r where r.applied_at is not null
    and exists(select 1 from private.home_media_links(before_media) l where l.bucket='property-media' and l.name=r.old_key)
    and exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.new_key)
    and not exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.old_key)
  on conflict do nothing;
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,
    unreferenced_since,expires_at,restore_media)
  select o.bucket_id,o.name,'detached',old.id,o.id,o.version,
    case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
    'candidate',now(),now()+interval '48 hours',before_media
  from (
    select 'property-media'::text bucket,private.home_photo_key(u,null) name from unnest(old.images) u
    union select bucket,name from private.home_listing_storage_links(old.video_url) where bucket='listing-videos'
  ) prior cross join lateral private.home_media_identity(prior.bucket,prior.name) o
  where (private.home_listing_upload_id(o.bucket_id,o.name)=old.id::text or exists(
    select 1 from private.home_media_items i where i.bucket=o.bucket_id and i.name=o.name and i.state='restored'
      and i.restored_to=old.id and i.object_id=o.id and i.object_version is not distinct from o.version))
    and not exists(select 1 from private.home_media_links(to_jsonb(new)) l where l.bucket=o.bucket_id and l.name=o.name)
    and not exists(select 1 from private.property_photo_renames r where o.bucket_id='property-media' and o.name in (r.old_key,r.new_key))
  on conflict(bucket,name) do update set source='detached',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='candidate',hold_reason=null,
    unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,attempts=0,retry_after=null,
    restore_media=excluded.restore_media,restored_to=null,deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored','retained');
  return new;
end;
$$;
create trigger home_media_record_detached after update of images,video_url,image_metadata,image_filenames,source_url on public.properties
  for each row when (old.images is distinct from new.images or old.video_url is distinct from new.video_url
    or old.image_metadata is distinct from new.image_metadata or old.image_filenames is distinct from new.image_filenames
    or old.source_url is distinct from new.source_url)
  execute function private.home_media_record_detached();

create function public.home_media_trash_rename(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb; target storage.objects; replacement storage.objects; item private.home_media_items;
begin
  perform private.require_home_photo_owner();
  perform private.lock_home_listing_media_snapshot();
  job:=private.home_photo_rename_request_removal(p_id,true);
  if job->>'removed_at' is not null then return jsonb_build_object('removed',true); end if;
  select * into target from private.home_media_identity('property-media',job->>'old_key');
  if not found or job->>'current_key' is null or coalesce(job->>'sha256','') !~ '^[0-9a-f]{64}$'
    or private.home_media_referenced('property-media',target.name)
  then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  select * into replacement from private.home_media_identity('property-media',job->>'current_key');
  if not found then raise exception 'listing_cleanup.manifest_changed' using errcode='PT409'; end if;
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,
    unreferenced_since,expires_at,replacement_key,replacement_sha256,replacement_id,replacement_version)
  values('property-media',target.name,'rename',p_id,target.id,target.version,
    case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
    'trashed',now(),now()+interval '48 hours',job->>'current_key',job->>'sha256',replacement.id,replacement.version)
  on conflict(bucket,name) do update set source='rename',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='trashed',unreferenced_since=excluded.unreferenced_since,
    expires_at=excluded.expires_at,replacement_key=excluded.replacement_key,replacement_sha256=excluded.replacement_sha256,
    replacement_id=excluded.replacement_id,replacement_version=excluded.replacement_version,upload_owner=null,upload_until=null,
    restored_to=null,restore_media=null,attempts=0,retry_after=null,deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored') and (home_media_items.object_id is null
      or home_media_items.object_id=excluded.object_id and home_media_items.object_version is not distinct from excluded.object_version);
  select * into item from private.home_media_items where bucket='property-media' and name=target.name;
  if item.source<>'rename' or item.source_id<>p_id or item.state not in ('trashed','deleting') then
    raise exception 'listing_cleanup.manifest_changed' using errcode='PT409';
  end if;
  return jsonb_build_object('removed',false,'expiresAt',item.expires_at);
end;
$$;

create or replace function public.home_photo_rename_history(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return coalesce((select jsonb_agg(to_jsonb(h)) from (
    select r.id,r.old_key,r.new_key,r.applied_at,r.removed_at,r.auto_cleanup_requested,
      case when i.state in ('trashed','deleting') then i.expires_at end trash_expires_at
    from private.property_photo_renames r left join private.home_media_items i on i.source='rename' and i.source_id=r.id
    where r.property_id=p_property order by r.started_at desc limit 40
  ) h),'[]'::jsonb);
end;
$$;

-- Use recorded upload ownership and a completed Storage object. A legacy file,
-- saved listing path or in-flight rename has no proof of abandonment here.
create function private.home_media_stage_candidates() returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and not exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id(i.bucket,i.name))
    and (retry_after is null or retry_after<=now()) order by upload_until,id limit 40
  loop
    select * into target from private.home_media_identity(candidate.bucket,candidate.name);
    if not found and not exists(select 1 from storage.objects o where o.bucket_id=candidate.bucket and o.name=candidate.name) then
      -- The expired reservation never produced a completed object. Provider-side
      -- resumable sessions expire independently of this app metadata.
      delete from private.home_media_items where id=candidate.id and state='uploading' and upload_until<=now();
      continue;
    end if;
    if found and to_jsonb(target)->>'owner_id'=candidate.upload_owner::text
      and not exists(select 1 from public.properties p
        where p.id::text=private.home_listing_upload_id(candidate.bucket,candidate.name))
      and not exists(select 1 from private.property_photo_renames r where candidate.bucket='property-media'
        and candidate.name in(r.old_key,r.new_key))
      and not private.home_media_referenced(candidate.bucket,candidate.name)
    then
      update private.home_media_items set state='trashed',object_id=target.id,object_version=target.version,
        bytes=case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
        unreferenced_since=now(),expires_at=now()+interval '48 hours',retry_after=null
      where id=candidate.id and state='uploading' and upload_until<=now();
      if found then staged:=staged+1; end if;
    else
      update private.home_media_items set state='retained',hold_reason='upload_dependency',retry_after=null
        where id=candidate.id and state='uploading' and upload_until<=now();
    end if;
  end loop;
  return staged;
end;
$$;

create function private.home_media_restore_mode(item private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case item.source
    when 'detached' then case when item.restore_media is not null then 'listing' else 'unavailable' end
    when 'rename' then case when exists(select 1 from private.property_photo_renames r where r.id=item.source_id
      and jsonb_array_length(r.properties)>0 and not exists(select 1 from jsonb_array_elements(r.properties) p
        where not exists(select 1 from private.home_media_renamed_listings s where s.rename_id=r.id and s.listing_id::text=p->>'id')))
      then 'rename' else 'unavailable' end
    when 'listing' then coalesce((select case when private.home_media_saved_attachment(d.snapshot,item.bucket,item.name)
      then 'draft' else 'file' end from private.home_media_deleted_listings d
      where d.listing_id=item.source_id and d.expires_at>now()),'unavailable')
    else 'file' end;
$$;

create function private.home_media_apply_listing_fields(p_listing uuid,p_fields jsonb) returns void
language sql set search_path='' as $$
  update public.properties set images=array(select jsonb_array_elements_text(p_fields->'images')),
    image_filenames=p_fields->'image_filenames',image_metadata=p_fields->'image_metadata',
    video_url=p_fields->>'video_url',source_url=p_fields->>'source_url',updated_at=clock_timestamp()
  where id=p_listing;
$$;

-- Recover one file from its saved fields. Keep other links and use the prior
-- gallery neighbours to place it among the current images.
create function private.home_media_restore_attachment(p_listing uuid,item private.home_media_items,saved jsonb) returns void
language plpgsql set search_path='' as $$
declare current_listing public.properties; previous text[]; images text[]; ref record; position integer;
  filenames jsonb; meta jsonb; video text; source text;
begin
  select * into current_listing from public.properties where id=p_listing for update;
  if not found or not private.home_media_saved_attachment(saved,item.bucket,item.name) then
    raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
  images:=current_listing.images; video:=current_listing.video_url; source:=current_listing.source_url;
  filenames:='{}'; meta:='{}';
  if item.bucket='property-media' then
    previous:=array(select jsonb_array_elements_text(saved->'images'));
    for ref in select uri,ord from unnest(previous) with ordinality u(uri,ord)
      where private.home_photo_key(uri,null)=item.name order by ord
    loop
      if cardinality(array_positions(images,ref.uri))>=cardinality(array_positions(previous[1:ref.ord::integer],ref.uri))
      then continue; end if;
      select array_position(images,u.uri) into position from unnest(previous) with ordinality u(uri,ord)
        where u.ord>ref.ord and u.uri=any(images) order by u.ord limit 1;
      if not found then
        select array_position(images,u.uri)+1 into position from unnest(previous) with ordinality u(uri,ord)
          where u.ord<ref.ord and u.uri=any(images) order by u.ord desc limit 1;
      end if;
      position:=coalesce(position,least(ref.ord::integer,cardinality(images)+1));
      images:=images[1:position-1]||array[ref.uri]||images[position:cardinality(images)];
    end loop;
    select coalesce(jsonb_object_agg(key,value),'{}') into filenames from jsonb_each(saved->'image_filenames')
      where private.home_photo_key(key,null)=item.name;
    select coalesce(jsonb_object_agg(key,value),'{}') into meta from jsonb_each(saved->'image_metadata')
      where private.home_photo_key(key,null)=item.name;
    if cardinality(images)>40 or exists(select 1 from jsonb_each(filenames) f
      where current_listing.image_filenames ? f.key and current_listing.image_filenames->f.key is distinct from f.value)
      or exists(select 1 from jsonb_each(meta) m
      where current_listing.image_metadata ? m.key and current_listing.image_metadata->m.key is distinct from m.value)
      or exists(select 1 from unnest(current_listing.images) u where private.home_photo_key(u,null)=item.name and not u=any(previous))
    then raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
  else
    if video is not null and video is distinct from saved->>'video_url' then
      raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    video:=saved->>'video_url';
  end if;
  if exists(select 1 from private.home_media_links(to_jsonb(saved->>'source_url')) l
    where l.bucket=item.bucket and l.name=item.name) then
    if source is not null and source is distinct from saved->>'source_url' then
      raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    source:=saved->>'source_url';
  end if;
  perform private.home_media_apply_listing_fields(p_listing,jsonb_build_object('images',images,
    'image_filenames',current_listing.image_filenames||filenames,'image_metadata',current_listing.image_metadata||meta,
    'video_url',video,'source_url',source));
end;
$$;

create function private.home_media_restore_saved(item private.home_media_items,mode text) returns uuid
language plpgsql set search_path='' as $$
declare recovered private.home_media_deleted_listings; draft public.properties; target uuid;
begin
  if mode='listing' then
    perform private.home_media_restore_attachment(item.source_id,item,item.restore_media);
    return item.source_id;
  elsif mode='draft' then
    select * into recovered from private.home_media_deleted_listings where listing_id=item.source_id for update;
    if recovered.draft_id is null then
      target:=gen_random_uuid();
      draft:=jsonb_populate_record(null::public.properties,recovered.snapshot||jsonb_build_object('id',target,
        'slug',rtrim(left(recovered.snapshot->>'slug',132),'-')||'-restored-'||replace(target::text,'-',''),
        'listing_code',null,'status','draft','featured',false,'published_at',null,'created_at',now(),'updated_at',now(),
        'images','[]'::jsonb,'image_filenames','{}'::jsonb,'image_metadata','{}'::jsonb,'video_url',null,
        'source_url',case when not exists(select 1 from private.home_media_links(to_jsonb(recovered.snapshot->>'source_url')))
          then recovered.snapshot->>'source_url' end));
      insert into public.properties select (draft).*;
      update private.home_media_deleted_listings set draft_id=target where listing_id=item.source_id;
    else
      target:=recovered.draft_id;
      if not exists(select 1 from public.properties p where p.id=target and p.status='draft') then
        raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    end if;
    perform private.home_media_restore_attachment(target,item,recovered.snapshot);
    return target;
  elsif mode='rename' then
    if exists(select 1 from private.home_media_renamed_listings s left join public.properties p on p.id=s.listing_id
      where s.rename_id=item.source_id and (p.id is null or private.home_media_listing_fields(p) is distinct from s.after_media))
    then raise exception 'listing_cleanup.restore_conflict' using errcode='PT409'; end if;
    perform private.home_media_apply_listing_fields(s.listing_id,s.before_media)
      from private.home_media_renamed_listings s where s.rename_id=item.source_id;
    return (select property_id from private.property_photo_renames where id=item.source_id);
  end if;
  return null;
end;
$$;

create function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; ctrl private.home_media_control; changed integer:=0; mode text; target uuid;
begin
  perform private.require_home_photo_owner();
  if p_action='authorize' then
    return jsonb_build_object('actor',auth.uid());
  elsif p_action='restore' then
    perform private.lock_home_listing_media_snapshot();
    select * into item from private.home_media_items where id=p_id for update;
    if found and item.state='restored' then
      return jsonb_build_object('id',p_id,'restored',true,'listingId',item.restored_to); end if;
    if not found or item.state not in ('candidate','trashed') or item.expires_at<=now() or not exists(
      select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version)
    then raise exception 'listing_cleanup.restore_unavailable' using errcode='PT409'; end if;
    mode:=private.home_media_restore_mode(item);
    if mode='unavailable' then raise exception 'listing_cleanup.restore_snapshot_missing' using errcode='PT409'; end if;
    update private.home_media_items set state='restored',retry_after=null,hold_reason=null where id=p_id;
    if item.source='listing' then
      update private.home_listing_deletion_media set state='retained'
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
    elsif item.source='rename' then
      update private.property_photo_renames set removal_requested_by=null,auto_cleanup_requested=false where id=item.source_id;
    end if;
    target:=private.home_media_restore_saved(item,mode);
    update private.home_media_items set restored_to=target,restore_media=null where id=p_id;
    return jsonb_build_object('id',p_id,'restored',true,'listingId',target);
  elsif p_action in ('scan','trash') then
    if p_action='trash' then
      perform private.lock_home_listing_media_snapshot();
      changed:=private.home_media_stage_candidates();
    end if;
    update private.home_media_control set last_scan_at=now();
  elsif p_action is distinct from 'status' then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  select * into ctrl from private.home_media_control where singleton;
  return (
    with refs as materialized (
      select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
    ), objects as materialized (
      select o.bucket_id bucket,o.name,case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes
      from storage.objects o where o.bucket_id in ('property-media','listing-videos')
    ), observed as (
      select o.*,r.name is null unlinked from objects o left join refs r using(bucket,name)
    ), history as (
      select i.id,i.bucket,i.name,i.state,i.hold_reason,i.expires_at,i.removed_at,i.unreferenced_since,
        private.home_media_restore_mode(i) as restore_mode
      from private.home_media_items i where i.state<>'uploading'
      union all
      select m.object_id,m.bucket,m.name,'removed',null,null,m.removed_at,null,'unavailable' from private.home_listing_deletion_media m
      where m.state='removed' and not exists(select 1 from private.home_media_items i where i.bucket=m.bucket and i.name=m.name)
      union all
      select r.id,'property-media',r.old_key,'removed',null,null,r.removed_at,null,'unavailable' from private.property_photo_renames r
      where r.removed_at is not null and not exists(select 1 from private.home_media_items i where i.bucket='property-media' and i.name=r.old_key)
        and not exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=r.old_key and m.state='removed')
    )
    select jsonb_build_object(
      'objects',(select count(*) from observed),'bytes',(select coalesce(sum(bytes),0) from observed),
      'candidates',(select count(*) from observed where unlinked),
      'candidateBytes',(select coalesce(sum(bytes),0) from observed where unlinked),
      'broken',(select count(*) from refs where not exists(select 1 from objects o where o.bucket=refs.bucket and o.name=refs.name)),
      'activeUploads',(select count(*) from private.home_media_items where state='uploading' and upload_until>now()),
      'abandoned',(select count(*) from private.home_media_items where source='upload' and state in ('trashed','deleting')),
      'trashed',(select count(*) from private.home_media_items where state='trashed'),
      'overdue',(select count(*) from private.home_media_items where state in ('candidate','trashed','deleting','review') and expires_at<=now()),
      'lastScanAt',ctrl.last_scan_at,'checkedAt',statement_timestamp(),'enabled',ctrl.permanent_enabled,'newlyTrashed',changed,
      'totalItems',(select count(*) from history),
      'items',coalesce((select jsonb_agg(to_jsonb(i)) from (
        select id,bucket,name,state,hold_reason,expires_at,removed_at,restore_mode from history
        order by (state in ('candidate','trashed') and expires_at>now()) desc nulls last,
          coalesce(removed_at,unreferenced_since) desc nulls last,id limit 30
          offset least(greatest(coalesce(p_offset,0),0),1000000)
      ) i),'[]'::jsonb),
      'runs',coalesce((select jsonb_agg(to_jsonb(r)) from (
        select started_at,finished_at,attempted,removed,failed from private.home_media_runs order by started_at desc limit 10
      ) r),'[]'::jsonb)
    )
  );
end;
$$;

create function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  if p_item is not null and p_actor is null then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry) values(job,p_actor,p_item,p_expiry);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items m
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now()) and (
        (state='trashed' and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

-- Recheck immediately before the Storage API call. The durable reservation
-- blocks new links and authenticated uploads after this transaction commits.
create function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean;
begin
  select r.* into job from private.home_media_control c join private.home_media_runs r on r.id=c.lease
  where c.lease=p_run and c.lease_until>now() and c.permanent_enabled;
  if not found then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if job.actor is not null then
    perform set_config('request.jwt.claim.sub',job.actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  perform private.lock_home_listing_media_snapshot();
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.retry_after>now() or item.upload_until>now()
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry))
    then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if (job.early_item is null and (item.state not in ('trashed','deleting')
      or (item.deletion_started_at is null and item.expires_at>now())))
    or (job.early_item is not null and item.state not in ('candidate','trashed')) or item.attempts>=4
    then return null; end if;
  if private.home_media_referenced(item.bucket,item.name,item.source='historical')
    or not present
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version
      and (item.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=item.historical_review->>'etag')))
    or (item.source='historical' and private.home_media_provider_upload(item.bucket,item.name))
    or (item.source='rename' and (not exists(select 1 from private.home_media_identity('property-media',item.replacement_key) o
      where o.id=item.replacement_id and o.version is not distinct from item.replacement_version)
      or not exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=item.replacement_key)))
  then
    update private.home_media_items set state='review',hold_reason='dependency_or_identity' where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return null;
  end if;
  if item.source='rename' and p_replacement_verified is not true then
    update private.home_media_items set attempts=attempts+1,retry_after=now()+interval '1 hour',
      state=case when attempts>=3 then 'review' else state end,hold_reason='replacement' where id=p_id;
    update private.home_media_runs set attempted=attempted+1,failed=failed+1 where id=p_run;
    return null;
  end if;
  update private.home_media_items set state='deleting',attempts=attempts+1,retry_after=now()+interval '1 hour',
    deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),deletion_run=p_run where id=p_id;
  update private.home_media_runs set attempted=attempted+1 where id=p_run;
  return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',present,
    'replacementKey',item.replacement_key,'replacementSha256',item.replacement_sha256);
end;
$$;

create function public.home_media_settle(p_run uuid,p_id uuid,p_ok boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items;
begin
  if not exists(select 1 from private.home_media_control c where c.lease=p_run and c.lease_until>now()) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.deletion_run is distinct from p_run or item.deletion_started_at is null then return false; end if;
  if item.state='removed' then return true; end if;
  if item.state<>'deleting' then return false; end if;
  if exists(select 1 from storage.objects where bucket_id=item.bucket and name=item.name) then
    update private.home_media_items set state=case when item.attempts>=4 then 'review' else state end,
      hold_reason=case when p_ok is true then 'storage_present' else 'storage' end where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return false;
  end if;
  update private.home_media_items set state='removed',removed_at=clock_timestamp(),upload_owner=null,
    upload_until=null,object_id=null,object_version=null,replacement_key=null,replacement_sha256=null,replacement_id=null,replacement_version=null,
    retry_after=null,hold_reason=null,restore_media=null where id=p_id;
  if item.source='listing' then
    update private.home_listing_deletion_media set state='removed',removed_at=clock_timestamp()
      where property_id=item.source_id and bucket=item.bucket and name=item.name and state='pending';
  elsif item.source='rename' then
    update private.property_photo_renames set removed_at=clock_timestamp() where id=item.source_id;
    delete from private.home_media_renamed_listings where rename_id=item.source_id;
  end if;
  update private.home_media_runs set removed=removed+1 where id=p_run;
  return true;
end;
$$;

create function public.home_media_finish(p_run uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
  update private.home_media_control set lease=null,lease_until=null where lease=p_run;
  if found then update private.home_media_runs set finished_at=clock_timestamp() where id=p_run; end if;
  return (select count(*)::integer from private.home_media_items
    where state in ('candidate','trashed','deleting','review') and expires_at<=now());
end;
$$;

-- The Owner panel owns bulk inventory. Admins retain the receipt of an individual listing deletion.
create or replace function public.home_listing_delete_status(p_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if p_property is not null then
    perform private.require_home_photo_admin();
    return private.home_listing_delete_result(p_property);
  end if;
  perform private.require_home_photo_owner();
  return coalesce((select jsonb_agg(private.home_listing_delete_result(q.property_id)) from (
    select property_id from private.home_listing_deletions order by requested_at desc limit 40
  ) q),'[]'::jsonb);
end;
$$;

alter function public.home_listing_delete_adopt(uuid,jsonb) set schema private;
revoke all on function private.home_listing_delete_adopt(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.home_listing_delete_adopt(p_property uuid,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_listing_delete_adopt(p_property,p_manifest);
end;
$$;
revoke all on function public.home_listing_delete_adopt(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.home_listing_delete_adopt(uuid,jsonb) to authenticated;

-- Close the legacy immediate worker. Existing ledgers are settled by the
-- lifecycle worker only, with the typed object identity and a verified absence.
revoke execute on function public.home_listing_delete_targets(uuid,uuid),public.home_listing_delete_confirm(uuid,text,text[]),
  public.home_listing_delete_due(),public.home_listing_delete_claim(uuid,boolean),public.home_listing_delete_release(uuid,uuid)
  from public,anon,authenticated,service_role;

revoke all on function private.home_media_links(jsonb),private.home_media_referenced(text,text,boolean),
  private.home_media_identity(text,text),private.home_media_record_listing(),private.home_media_record_detached(),private.home_media_stage_candidates(),
  private.home_media_listing_fields(public.properties),private.home_media_saved_attachment(jsonb,text,text),
  private.home_media_capture_deleted_listing(),private.home_media_provider_upload(text,text),
  private.home_media_restore_mode(private.home_media_items),private.home_media_apply_listing_fields(uuid,jsonb),
  private.home_media_restore_attachment(uuid,private.home_media_items,jsonb),private.home_media_restore_saved(private.home_media_items,text)
  from public,anon,authenticated,service_role;
revoke all on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid),public.home_media_enroll_historical(jsonb,boolean),
  public.home_media_claim(uuid,uuid,timestamptz),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) from public,anon,authenticated,service_role;
grant execute on function public.home_media_upload_lease(text,text),public.home_media_management(text,uuid,integer),
  public.home_media_trash_rename(uuid),public.home_media_enroll_historical(jsonb,boolean) to authenticated;
grant execute on function public.home_media_claim(uuid,uuid,timestamptz),public.home_media_target(uuid,uuid,boolean),
  public.home_media_settle(uuid,uuid,boolean),public.home_media_finish(uuid) to service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261126100206_gary_home_website_profile_photos.sql
begin;

-- Every app owns a separate private bucket. This migration does not move,
-- register or delete legacy objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('gary-home-profile-photos','gary-home-profile-photos',false,102400,array['image/webp']);

-- The existing avatar_path NOT NULL/format/owner constraint stays in place.
-- A removed photo has no staff_profiles row. The write RPC updates its listing
-- portrait aliases in the same transaction and keeps the old bucket readable.
alter table public.staff_profiles add column avatar_bucket text not null default 'staff-avatars'
  check (avatar_bucket in ('staff-avatars','gary-home-profile-photos'));
revoke insert(user_id,avatar_path),update(user_id,avatar_path) on public.staff_profiles from authenticated;
-- Linked portraits use the existing resolver. Prevent new durable references
-- to a private object path that could outlive its active profile.
alter table public.listing_authors add constraint listing_authors_managed_avatar_url_check
  check (strpos(portrait_url,'/gary-home-profile-photos/')=0) not valid;

create table private.home_avatar_uploads (
  id uuid primary key,
  user_id uuid not null,
  path text generated always as (user_id::text || '/' || id::text || '.webp') stored unique,
  removing boolean not null default false,
  state text not null default 'pending' check (state in ('pending','active','retired','deleting')),
  retry_at timestamptz not null default now() + interval '15 minutes',
  cleanup_token uuid,
  unique(user_id,path)
);
alter table private.home_avatar_uploads enable row level security;
revoke all on private.home_avatar_uploads from public,anon,authenticated;
create index home_avatar_cleanup_due on private.home_avatar_uploads(retry_at,id)
where state in ('pending','retired','deleting') and not removing;

create table public.home_avatar_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version uuid not null,
  path text,
  foreign key (user_id,path) references private.home_avatar_uploads(user_id,path)
);
alter table public.home_avatar_profiles enable row level security;
revoke all on public.home_avatar_profiles from public,anon,authenticated;
grant select on public.home_avatar_profiles to authenticated;
create policy home_avatar_profile_read on public.home_avatar_profiles for select to authenticated
using (auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true' and private.can_view_staff_account(user_id));

-- Legacy Home portraits remain readable. Freeze direct writes to the old bucket
-- so pre-cutover browser tabs cannot leave new unmanaged uploads.
-- The Storage read policy sees only the current pointer and inherits its RLS.
-- Restrictive policies keep other applications' permissive policies out of this bucket.
create policy home_avatar_managed_read on storage.objects for select to authenticated
using (bucket_id='gary-home-profile-photos' and exists (
  select 1 from public.home_avatar_profiles p
  where p.user_id::text=split_part(name,'/',1) and p.path=name
));
create policy home_avatar_managed_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id<>'gary-home-profile-photos' or exists (
  select 1 from public.home_avatar_profiles p
  where p.user_id::text=split_part(name,'/',1) and p.path=name
));
-- Public listing portraits already use the staff_profiles anonymous RLS view
-- of linked, published staff. A private object is readable only through that
-- same active and published reference.
create policy home_avatar_published_read on storage.objects for select to anon
using (bucket_id='gary-home-profile-photos' and exists (
  select 1 from public.staff_profiles p where p.avatar_bucket=bucket_id and p.avatar_path=name
));
create policy home_avatar_published_read_guard on storage.objects as restrictive for select to anon
using (bucket_id<>'gary-home-profile-photos' or exists (
  select 1 from public.staff_profiles p where p.avatar_bucket=bucket_id and p.avatar_path=name
));
create policy home_avatar_managed_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check (bucket_id not in ('gary-home-profile-photos','staff-avatars'));
create policy home_avatar_managed_update_guard on storage.objects as restrictive for update to anon,authenticated
using (bucket_id not in ('gary-home-profile-photos','staff-avatars')) with check (bucket_id not in ('gary-home-profile-photos','staff-avatars'));
create policy home_avatar_managed_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using (bucket_id not in ('gary-home-profile-photos','staff-avatars'));

-- The upload reservation and Storage's service-written user metadata must agree.
-- A basename or the presence of a Storage object alone is insufficient.
create function private.home_avatar_object_owned(p_path text,p_owner uuid,p_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id='gary-home-profile-photos' and o.name=p_path
      and o.user_metadata->'profileAvatar'=jsonb_build_object('app','home','owner',p_owner,'id',p_id)
  );
$$;
revoke all on function private.home_avatar_object_owned(text,uuid,uuid) from public,anon,authenticated;

create function private.home_avatar_save(p_id uuid,p_expected uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  previous public.home_avatar_profiles;
  replacement private.home_avatar_uploads;
  next_path text;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or not coalesce(private.is_editor(),false) then
    raise exception 'Own profile required' using errcode='42501';
  end if;
  -- Serialize the first write as well as replacements/removals for the same identity.
  perform pg_advisory_xact_lock(hashtextextended('home:profile-avatar:' || actor::text,0));
  select * into previous from public.home_avatar_profiles p where p.user_id=actor;
  if previous.version=p_id then
    return jsonb_build_object('ok',true,'version',previous.version,'path',previous.path);
  end if;
  if previous.version is distinct from p_expected then
    raise exception 'Avatar version changed' using errcode='PT409';
  end if;

  select * into replacement from private.home_avatar_uploads u
  where u.id=p_id and u.user_id=actor and u.state='pending' and u.retry_at>now() for update;
  if not found then raise exception 'Avatar reservation unavailable' using errcode='42501'; end if;
  if not replacement.removing then
    if not private.home_avatar_object_owned(replacement.path,actor,p_id) then
      raise exception 'Avatar upload unavailable' using errcode='PT422';
    end if;
    next_path:=replacement.path;
  end if;

  insert into public.home_avatar_profiles(user_id,version,path)
  values(actor,p_id,next_path)
  on conflict(user_id) do update set version=excluded.version,path=excluded.path;

  if next_path is null then
    delete from public.staff_profiles where user_id=actor;
    if found then
      update public.listing_authors set portrait_url='',updated_at=now() where staff_user_id=actor;
      perform private.append_studio_event('profile','profile.photo_changed',actor,
        (select display_name from public.team_members where user_id=actor),
        (select role from public.team_members where user_id=actor));
    end if;
  else
    -- Existing staff checks, portrait synchronization and activity triggers run here.
    insert into public.staff_profiles(user_id,avatar_path,avatar_bucket)
    values(actor,next_path,'gary-home-profile-photos')
    on conflict(user_id) do update set avatar_path=excluded.avatar_path,avatar_bucket=excluded.avatar_bucket;
  end if;

  if replacement.removing then
    delete from private.home_avatar_uploads where id=p_id;
  else
    update private.home_avatar_uploads set state='active',retry_at='infinity' where id=p_id;
  end if;
  update private.home_avatar_uploads set state='retired',retry_at=now()
  where id=previous.version and state='active' and user_id=actor;
  return jsonb_build_object('ok',true,'version',p_id,'path',next_path);
end;
$$;

create function public.home_avatar_save(p_id uuid,p_expected uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select private.home_avatar_save(p_id,p_expected);
$$;
revoke all on function private.home_avatar_save(uuid,uuid),public.home_avatar_save(uuid,uuid) from public,anon,authenticated;
grant execute on function private.home_avatar_save(uuid,uuid),public.home_avatar_save(uuid,uuid) to authenticated;

-- Only the Edge Function may reserve paths or claim cleanup. Claims fence out
-- publication and keep a retry deadline even if the Storage call is interrupted.
create function public.home_avatar_maintenance(
  p_action text,p_owner uuid default null,p_id uuid default null,p_remove boolean default false,p_token uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  case p_action
    when 'reserve' then
      insert into private.home_avatar_uploads(id,user_id,removing)
      values(p_id,p_owner,p_remove) returning jsonb_build_object('id',id,'path',path) into result;
      return result;
    when 'abandon' then
      -- The commit might have succeeded even if its response was lost.
      update private.home_avatar_uploads set state='retired'
      where id=p_id and user_id=p_owner and state='pending';
      return 'null'::jsonb;
    when 'claim' then
      with due as (
        select u.id from private.home_avatar_uploads u
        where (p_owner is null or u.user_id=p_owner)
          and not u.removing and u.retry_at<=now()
          and u.state in ('pending','retired','deleting')
          and not exists (select 1 from public.home_avatar_profiles p where p.user_id=u.user_id and p.path=u.path)
          and not exists (select 1 from public.staff_profiles p
                          where p.avatar_bucket='gary-home-profile-photos' and p.avatar_path=u.path)
          and not exists (select 1 from public.listing_authors a
                          where strpos(a.portrait_url,'/gary-home-profile-photos/' || u.path)>0)

          and (private.home_avatar_object_owned(u.path,u.user_id,u.id)
            or (u.state='deleting' and not exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path)))
        order by u.retry_at,u.id limit 8 for update of u skip locked
      ), claimed as (
        update private.home_avatar_uploads u
        set state='deleting',cleanup_token=gen_random_uuid(),retry_at=now()+interval '15 minutes'
        from due where u.id=due.id
        returning u.id,u.path,u.cleanup_token,exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path) as remove_object
      )
      select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
      return result;
    when 'finish' then
      delete from private.home_avatar_uploads u
      where u.id=p_id and u.state='deleting' and u.cleanup_token=p_token
        and not exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path);
      return to_jsonb(found);
    else
      raise exception 'Unknown avatar maintenance action' using errcode='22023';
  end case;
end;
$$;
revoke all on function public.home_avatar_maintenance(text,uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.home_avatar_maintenance(text,uuid,uuid,boolean,uuid) to service_role;

create or replace function public.get_staff_profile() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'avatar_path',coalesce(p.avatar_path,''),'avatar_bucket',p.avatar_bucket,'updated_at',p.updated_at,'password_change_reminder',m.password_change_reminder) into result from public.team_members m left join public.staff_profiles p on p.user_id=m.user_id where m.user_id=auth.uid();
 return result;
end; $$;

create or replace function public.get_studio_notifications(before_time timestamptz default null,before_id uuid default null,page_size integer default 30) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare seen timestamptz; items jsonb; unread bigint;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select last_seen_at into seen from public.staff_notification_reads where user_id=auth.uid();
 select count(*) into unread from public.studio_notifications where seen is null or created_at>seen;
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from(select n.*,coalesce(p.avatar_path,'') as actor_avatar_path,p.avatar_bucket as actor_avatar_bucket,seen is null or n.created_at>seen as unread from public.studio_notifications n left join public.staff_profiles p on p.user_id=n.actor_user_id where before_time is null or (n.created_at,n.id)<(before_time,before_id) order by n.created_at desc,n.id desc limit least(greatest(page_size,1),50)) rows;
 return jsonb_build_object('items',items,'unread_count',unread);
end; $$;

notify pgrst,'reload schema';
commit;

-- Migration: 20261126114500_home_media_inventory_diagnostics.sql
-- Read-only additions to the deployed Owner inventory. The cleanup gate remains in its control table.
begin;

alter function public.home_media_management(text,uuid,integer) set schema private;
revoke all on function private.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;

create function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; scheduled boolean:=false; verified bigint; verified_bytes bigint;
begin
  perform private.require_home_photo_owner();
  result:=private.home_media_management(p_action,p_id,p_offset);
  if p_action not in ('status','scan','trash') then return result; end if;

  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active)'
      into scheduled using 'gary-home-media-expiry';
  end if;

  -- Admit only reserved objects with their audited Storage identities and no current exact reference.
  select count(*),coalesce(sum(i.bytes),0) into verified,verified_bytes
  from private.home_media_items i
  join lateral private.home_media_identity(i.bucket,i.name) o
    on o.id=i.object_id and o.version is not distinct from i.object_version
  where i.state in ('trashed','deleting') and (i.upload_until is null or i.upload_until<=now())
    and not private.home_media_referenced(i.bucket,i.name,i.source='historical')
    and (i.source<>'historical' or (
      btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag'
      and not private.home_media_provider_upload(i.bucket,i.name)))
    and (i.source<>'rename' or (
      exists(select 1 from private.home_media_identity('property-media',i.replacement_key) r
        where r.id=i.replacement_id and r.version is not distinct from i.replacement_version)
      and exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=i.replacement_key)));

  return result||jsonb_build_object(
    'automaticScheduled',scheduled,'verifiedCandidates',verified,'verifiedCandidateBytes',verified_bytes,
    'heldCandidates',greatest(0,coalesce((result->>'candidates')::bigint,0)-verified)
  );
end;
$$;

revoke all on function public.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.home_media_management(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

-- Migration: 20261126170756_home_media_panel_pagination.sql
-- Owner inventory and page reads. Leave the retention gate and worker controls unchanged.
begin;

alter table private.home_media_control add column inventory_sample jsonb;

create function private.home_media_take_inventory(p_scan boolean,p_after uuid default null) returns jsonb
language sql stable set search_path='' as $$
  with refs as materialized (
    select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
  ), checking as materialized (
    select i.* from private.home_media_items i
    where p_scan and (i.state='candidate' or (i.state='uploading' and i.upload_until<=now()
      and not exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id(i.bucket,i.name))))
      and coalesce(i.upload_until,'-infinity')<=now() and coalesce(i.retry_after,'-infinity')<=now()
    order by (p_after is not null and i.id<=p_after),i.id limit 1
  ), verified as materialized (
    select i.id,o.id as object_id,o.version from checking i cross join lateral private.home_media_identity(i.bucket,i.name) o
    where (i.state='candidate' and o.id=i.object_id and o.version is not distinct from i.object_version
      or i.state='uploading' and o.owner_id::text=i.upload_owner::text
        and not exists(select 1 from private.property_photo_renames r where i.bucket='property-media' and i.name in(r.old_key,r.new_key)))
      and not exists(select 1 from refs r where r.bucket=i.bucket and r.name=i.name)
      and not private.home_media_provider_upload(i.bucket,i.name)
      and not private.home_media_referenced(i.bucket,i.name)
  ), observed as materialized (
    select o.bucket_id as bucket,o.name,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      r.name is null unlinked,
      case when r.name is not null then 'reference'
        when i.state in ('trashed','deleting') then 'scheduled'
        when v.id is not null then 'verified'
        when i.state='uploading' and i.upload_until>now() then 'upload'
        when i.state in ('review','retained') then 'review'
        when exists(select 1 from public.properties p where p.id::text=case o.bucket_id
          when 'property-media' then case when o.name like 'properties/listings/%' then split_part(o.name,'/',3) end
          else split_part(o.name,'/',2) end) then 'listing'
        when o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames pr
          where (pr.new_key=o.name and pr.applied_at is null) or (pr.old_key=o.name and pr.removed_at is null)) then 'rename'
        else 'potential' end as reason
    from storage.objects o left join refs r on r.bucket=o.bucket_id and r.name=o.name
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name left join verified v on v.id=i.id
    where o.bucket_id in ('property-media','listing-videos')
  ), totals as (
    select count(*) as objects,coalesce(sum(bytes),0) as bytes,
      count(*) filter(where unlinked) as candidates,coalesce(sum(bytes) filter(where unlinked),0) as candidate_bytes,
      count(*) filter(where reason in ('reference','upload','review','listing','rename')) as protected,
      count(*) filter(where unlinked and reason in ('upload','review','listing','rename')) as protected_candidates,
      count(*) filter(where reason='potential') as unreviewed,
      count(*) filter(where reason='verified') as verified_count,
      coalesce(sum(bytes) filter(where reason='verified'),0) as verified_bytes
    from observed
  )
  select jsonb_build_object('objects',t.objects,'bytes',t.bytes,'candidates',t.candidates,'candidateBytes',t.candidate_bytes,
    'protected',t.protected,'protectedCandidates',t.protected_candidates,'unreviewed',t.unreviewed,
    'verifiedAtScan',t.verified_count,'verifiedBytesAtScan',t.verified_bytes,'checkedAt',statement_timestamp(),
    'checkedQueue',(select count(*) from checking),'reviewedId',(select id from checking),
    'broken',(select count(*) from refs r where not exists(select 1 from observed o where o.bucket=r.bucket and o.name=r.name)))
    || case when p_scan then jsonb_build_object(
      'entries',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'name',name,'bytes',bytes,'reason',reason) order by bucket,name)
        from observed),'[]'::jsonb),
      'verifiedObjects',coalesce((select jsonb_agg(to_jsonb(v)) from verified v),'[]'::jsonb)) else '{}'::jsonb end
  from totals t;
$$;

create function private.home_media_panel_page(p_action text,p_offset integer) returns jsonb
language plpgsql stable set search_path='' as $$
declare rows jsonb; sample jsonb; skip integer:=least(greatest(coalesce(p_offset,0),0),1000000);
begin
  if p_action='inventory_page' then
    select inventory_sample into sample from private.home_media_control where singleton;
    select coalesce(jsonb_agg(e.value order by e.ordinality),'[]'::jsonb) into rows from (
      select * from jsonb_array_elements(sample->'entries') with ordinality limit 31 offset skip
    ) e;
  elsif p_action='trash_page' then
    select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('restore_mode',private.home_media_restore_mode(i)) order by p.expires_at,p.id),'[]'::jsonb)
      into rows from (
        select id,bucket,name,state,expires_at,hold_reason from private.home_media_items
        where state in ('trashed','deleting') order by expires_at,id limit 31 offset skip
      ) p join private.home_media_items i on i.id=p.id;
  elsif p_action='removed_page' then
    with receipts as (
      select i.id,i.bucket,i.name,i.removed_at,i.source from private.home_media_items i where i.state='removed'
      union all
      select m.object_id,m.bucket,m.name,m.removed_at,'listing' from private.home_listing_deletion_media m
      where m.state='removed' and not exists(select 1 from private.home_media_items i where i.bucket=m.bucket and i.name=m.name and i.state='removed')
      union all
      select r.id,'property-media',r.old_key,r.removed_at,'rename' from private.property_photo_renames r
      where r.removed_at is not null and not exists(select 1 from private.home_media_items i
          where i.bucket='property-media' and i.name=r.old_key and i.state='removed')
        and not exists(select 1 from private.home_listing_deletion_media m where m.bucket='property-media' and m.name=r.old_key and m.state='removed')
    )
    select coalesce(jsonb_agg(to_jsonb(p) order by p.removed_at desc nulls last,p.id),'[]'::jsonb) into rows from (
      select * from receipts order by removed_at desc nulls last,id limit 31 offset skip
    ) p;
  elsif p_action='run_page' then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.started_at desc,p.id),'[]'::jsonb) into rows from (
      select id,started_at,finished_at,attempted,removed,failed from private.home_media_runs
      order by started_at desc,id limit 31 offset skip
    ) p;
  end if;
  return jsonb_build_object('items',rows-30,'hasMore',jsonb_array_length(rows)>30,
    'available',p_action<>'inventory_page' or sample is not null);
end;
$$;

-- Scheduled cleanup keeps its existing batch. The manual move uses the same guards for one scanned file.
create function private.home_media_stage_candidates(p_only uuid) returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    and (p_only is null or id=p_only)
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif p_only is not null and private.home_media_provider_upload(candidate.bucket,candidate.name) then
      raise exception 'listing_cleanup.media_busy' using errcode='55P03';
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and (p_only is null or i.id=p_only)
    and not exists(select 1 from public.properties p where p.id::text=private.home_listing_upload_id(i.bucket,i.name))
    and (retry_after is null or retry_after<=now()) order by upload_until,id limit 40
  loop
    select * into target from private.home_media_identity(candidate.bucket,candidate.name);
    if not found and not exists(select 1 from storage.objects o where o.bucket_id=candidate.bucket and o.name=candidate.name) then
      -- The expired reservation never produced a completed object. Provider-side
      -- resumable sessions expire independently of this app metadata.
      delete from private.home_media_items where id=candidate.id and state='uploading' and upload_until<=now();
      continue;
    end if;
    if found and to_jsonb(target)->>'owner_id'=candidate.upload_owner::text
      and not exists(select 1 from public.properties p
        where p.id::text=private.home_listing_upload_id(candidate.bucket,candidate.name))
      and not exists(select 1 from private.property_photo_renames r where candidate.bucket='property-media'
        and candidate.name in(r.old_key,r.new_key))
      and (p_only is null or not private.home_media_provider_upload(candidate.bucket,candidate.name))
      and not private.home_media_referenced(candidate.bucket,candidate.name)
    then
      update private.home_media_items set state='trashed',object_id=target.id,object_version=target.version,
        bytes=case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
        unreferenced_since=now(),expires_at=now()+interval '48 hours',retry_after=null
      where id=candidate.id and state='uploading' and upload_until<=now();
      if found then staged:=staged+1; end if;
    else
      update private.home_media_items set state='retained',hold_reason='upload_dependency',retry_after=null
        where id=candidate.id and state='uploading' and upload_until<=now();
    end if;
  end loop;
  return staged;
end;
$$;

create or replace function private.home_media_stage_candidates() returns integer
language sql set search_path='' as $$select private.home_media_stage_candidates(null::uuid)$$;
revoke all on function private.home_media_stage_candidates(uuid) from public,anon,authenticated,service_role;

create or replace function public.home_media_management(p_action text,p_id uuid default null,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; sample jsonb; result jsonb; scheduled boolean:=false;
  ready bigint; ready_bytes bigint; queued bigint; queued_bytes bigint; due bigint; changed integer:=0; verified uuid;
begin
  perform private.require_home_photo_owner();
  if p_action in ('authorize','restore') then return private.home_media_management(p_action,p_id,p_offset); end if;
  if p_action in ('inventory_page','trash_page','removed_page','run_page') then
    return private.home_media_panel_page(p_action,p_offset);
  end if;
  if p_action is null or p_action not in ('overview','inventory_scan','status','scan','trash') then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  select * into ctrl from private.home_media_control where singleton;
  if p_action in ('inventory_scan','scan') then
    if not pg_try_advisory_xact_lock(hashtextextended('home.media.inventory',0)) then
      raise exception 'listing_cleanup.scan_busy' using errcode='55P03';
    end if;
    sample:=private.home_media_take_inventory(true,(ctrl.inventory_sample->>'reviewedId')::uuid);
    update private.home_media_control set inventory_sample=sample,last_scan_at=clock_timestamp()
      where singleton returning * into ctrl;
  else
    sample:=coalesce(ctrl.inventory_sample,private.home_media_take_inventory(false));
  end if;
  if p_action='trash' then
    if ctrl.inventory_sample is null then raise exception 'listing_cleanup.scan_required' using errcode='PT409'; end if;
    -- Reuse the existing guarded reservation. The scan never authorizes a Storage removal.
    verified:=(sample->'verifiedObjects'->0->>'id')::uuid;
    if verified is not null then
      perform private.lock_home_listing_media_snapshot();
      if exists(select 1 from private.home_media_items i join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
        where i.id=verified and o.id=(sample->'verifiedObjects'->0->>'object_id')::uuid
          and o.version is not distinct from (sample->'verifiedObjects'->0->>'version')) then
        changed:=private.home_media_stage_candidates(verified);
      end if;
    end if;
  end if;

  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end),0) into ready,ready_bytes
    from jsonb_to_recordset(sample->'verifiedObjects') v(id uuid,object_id uuid,version text) join private.home_media_items i on i.id=v.id
    join storage.objects o on o.bucket_id=i.bucket and o.name=i.name and o.id=v.object_id and o.version is not distinct from v.version
    where (i.state='candidate' and o.id=i.object_id and o.version is not distinct from i.object_version
      or i.state='uploading' and o.owner_id::text=i.upload_owner::text and i.upload_until<=now());
  select count(*),coalesce(sum(bytes),0) into queued,queued_bytes
    from private.home_media_items where state in ('trashed','deleting');
  select count(*) into due from private.home_media_items i
    where coalesce(i.retry_after,'-infinity')<=now() and (
      (i.state='trashed' and i.expires_at<=now() and i.attempts<4) or
      (i.state in ('deleting','review') and i.deletion_started_at is not null and (
        (i.state='deleting' and i.attempts<4) or not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name)
      )));
  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=$1 and active)' into scheduled using 'gary-home-media-expiry';
  end if;
  result:=(sample-'entries'-'verifiedObjects'-'reviewedId')||jsonb_build_object('panelVersion',2,
    'lastScanAt',ctrl.last_scan_at,'enabled',ctrl.permanent_enabled,'automaticScheduled',scheduled,'newlyTrashed',changed,
    'readyToTrash',ready,'readyBytes',ready_bytes,'trashed',queued,'scheduledBytes',queued_bytes,'overdue',due,
    'activeUploads',(select count(*) from private.home_media_items where state='uploading' and upload_until>now()),
    'abandoned',(select count(*) from private.home_media_items where source='upload' and state in ('trashed','deleting')));
  -- Legacy callers expect inline arrays. The new overview and scan return no pages.
  if p_action in ('status','scan','trash') then
    result:=result||jsonb_build_object('totalItems',queued,'items',private.home_media_panel_page('trash_page',p_offset)->'items',
      'runs',private.home_media_panel_page('run_page',0)->'items','verifiedCandidates',queued,'verifiedCandidateBytes',queued_bytes,
      'heldCandidates',sample->'protectedCandidates');
  end if;
  return result;
end;
$$;

revoke all on function private.home_media_take_inventory(boolean,uuid),private.home_media_panel_page(text,integer) from public,anon,authenticated,service_role;
revoke all on function public.home_media_management(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.home_media_management(text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;

-- Migration: 20261126175956_home_media_orphan_review.sql
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

-- Migration: 20261126200632_home_media_historical_bulk_enrollment.sql
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

-- Migration: 20261127062248_home_media_permanent_controls.sql
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

-- Migration: 20261127064432_home_media_bulk_trash_reads.sql
begin;

-- Selection is a read-only preview. The existing worker rechecks dependencies and identity on every claim.
create function private.home_media_early_block(i private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case
    when i.state='deleting' then 'removal_in_progress'
    when i.state='review' and i.hold_reason in ('storage','storage_present') then 'storage_failure'
    when i.state='review' then 'protected'
    when i.state<>'trashed' then 'no_longer_eligible'
    when i.expires_at is null then 'missing_expiry'
    when i.expires_at<=now() then 'expired'
    when exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name) then 'owner_hold'
    when i.upload_until>now() then 'active_upload'
    when i.retry_after>now() then 'retry_wait'
    when i.attempts>=4 then 'attempt_limit'
    when not exists(select 1 from private.home_media_identity(i.bucket,i.name) o
      where o.id=i.object_id and o.version is not distinct from i.object_version
        and (i.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag')) then 'identity_changed'
    end;
$$;

create or replace function public.home_media_dashboard(p_action text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report jsonb; rows jsonb; live_count bigint; live_bytes bigint; early_count bigint;
begin
  perform private.require_home_photo_owner();
  if p_action='readiness' then return jsonb_build_object('crossAppProtection',true); end if;
  if p_action='trash_manifest' then
    select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'bucket',i.bucket,'name',i.name,
      'expires_at',i.expires_at,'bytes',i.bytes) order by i.expires_at,i.id),'[]'::jsonb) into rows
      from private.home_media_items i where i.state='trashed' and private.home_media_early_block(i) is null;
    return jsonb_build_object('items',rows);
  end if;
  if p_action='trash_page' then
    report:=public.home_media_management(p_action,null,p_offset);
    select coalesce(jsonb_agg(e.value||jsonb_build_object('purge_block',private.home_media_early_block(i),
      'retry_after',i.retry_after,'bytes',i.bytes) order by e.ordinality),'[]'::jsonb) into rows
      from jsonb_array_elements(report->'items') with ordinality e
      join private.home_media_items i on i.id=(e.value->>'id')::uuid;
    return report||jsonb_build_object('items',rows);
  end if;
  if p_action is distinct from 'overview' then raise exception 'listing_cleanup.invalid_manifest' using errcode='22023'; end if;
  report:=public.home_media_management('overview',null,0);
  select count(*),coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end),0)
    into live_count,live_bytes from storage.objects o where o.bucket_id in ('property-media','listing-videos');
  select count(*) into early_count from private.home_media_items i where i.state='trashed' and private.home_media_early_block(i) is null;
  return report||jsonb_build_object('crossAppProtection',true,'objects',live_count,'bytes',live_bytes,
    'inventoryCheckedAt',statement_timestamp(),'earlyEligible',early_count,
    'nextExpiry',(select min(i.expires_at) from private.home_media_items i
      where i.state='trashed' and i.expires_at>now() and i.attempts<4));
end;
$$;

create function public.home_media_trash_receipt(p_id uuid,p_expiry timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; result text;
begin
  perform private.require_home_photo_owner();
  select * into item from private.home_media_items where id=p_id;
  if not found or item.expires_at is distinct from p_expiry then return jsonb_build_object('status','selection_changed'); end if;
  if item.state='removed' then
    result:=case when exists(select 1 from private.home_media_runs r where r.id=item.deletion_run
      and r.actor=auth.uid() and r.early_item=item.id and r.early_expiry=p_expiry)
      then 'removed' else 'already_removed' end;
  elsif exists(select 1 from private.home_media_control c join private.home_media_runs r on r.id=c.lease
    where c.singleton and c.lease_until>now() and r.early_item=item.id) then
    result:='removal_in_progress';
  else result:=coalesce(private.home_media_early_block(item),'eligible'); end if;
  return jsonb_build_object('status',result,'bytes',item.bytes);
end;
$$;

revoke all on function private.home_media_early_block(private.home_media_items),public.home_media_trash_receipt(uuid,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_trash_receipt(uuid,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;

-- Migration: 20261127141812_home_listing_media_inactivity.sql
-- The existing worker observes scoped media while the new policy is in preview.
begin;

alter table private.home_media_control add column listing_inactivity_enabled boolean not null default false;
alter table private.home_media_items drop constraint home_media_items_source_check,
  add constraint home_media_items_source_check
    check(source in ('listing','rename','upload','detached','historical','unused_listing'));
create index home_media_listing_inactivity_due on private.home_media_items(expires_at,id)
  where source='unused_listing' and state='retained';

alter table private.home_media_review_holds alter column actor drop not null,
  add column reason text not null default 'owner_hold',
  add check (reason in ('owner_hold','recovery_hold','file_trash_test') and (actor is not null or reason<>'owner_hold'));

create function private.home_media_scope_id(p_bucket text,p_name text) returns uuid
language sql immutable set search_path='' as $$
  select (case p_bucket
    when 'property-media' then substring(p_name from
      '(?i)^properties/listings/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/.+\.(?:jpe?g|png|webp|avif)$')
    when 'listing-videos' then substring(p_name from
      '(?i)^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/([0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})/[^/]+\.mp4$')
    end)::uuid;
$$;

-- Exact links and keys are distinct from ambiguous original filename matches.
create function private.home_media_document_evidence(p_doc jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  select * from private.home_media_links(p_doc) where name is not null
  union
  select b.bucket,coalesce(private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||v.name,null),v.name)
  from (values ('property-media'),('listing-videos')) b(bucket)
  cross join lateral (
    select value #>> '{}' name from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
    union all
    select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_metadata')='object' then p_doc->'image_metadata' end) key
    union all
    select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_filenames')='object' then p_doc->'image_filenames' end) key
  ) v where private.home_media_scope_id(b.bucket,v.name) is not null
  union
  select null::text,lower(btrim(value #>> '{}'))
  from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
  where length(value #>> '{}') between 1 and 1024;
$$;

create function private.home_media_reference_documents() returns setof jsonb
language sql stable set search_path='' as $$
  select to_jsonb(t) from public.properties t
  union all select to_jsonb(t) from public.neighbourhoods t
  union all select to_jsonb(t) from public.site_settings t
  union all select to_jsonb(t) from public.listing_authors t
  union all select to_jsonb(t) from public.site_activities t
  union all select to_jsonb(t) from public.editorial_articles t
  union all select to_jsonb(t) from public.enquiries t
  union all select to_jsonb(t) from public.enquiry_notes t
  union all select to_jsonb(t) from public.feedback_public t
  union all select to_jsonb(t) from public.feedback_submissions t
  union all select to_jsonb(t) from public.property_assistance t
  union all select to_jsonb(t) from public.assistance_reviews t
  union all select to_jsonb(t) from public.landlord_submissions t
  union all select to_jsonb(t) from public.landlord_submission_files t
  union all select * from private.home_media_shared_documents();
$$;

create table private.home_media_edit_checkpoints (
  actor uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  revision bigint not null,
  checkpoint jsonb,
  links jsonb not null default '[]',
  primary key(actor,id)
);
create index home_media_checkpoint_links on private.home_media_edit_checkpoints using gin(links jsonb_path_ops);
alter table private.home_media_edit_checkpoints enable row level security;
revoke all on private.home_media_edit_checkpoints from public,anon,authenticated,service_role;

create function private.home_media_edit_referenced(p_bucket text,p_name text) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.home_media_edit_checkpoints c where c.links @> jsonb_build_array(p_bucket||'/'||p_name));
$$;

create function public.home_media_gallery_checkpoints(p_actor uuid,p_checkpoint jsonb default null,p_discard boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare session_id uuid; listing_id uuid; revision bigint; current_revision bigint; current_checkpoint jsonb; media jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_actor or not coalesce(private.is_editor(),false) then
    raise exception 'listing_cleanup.forbidden' using errcode='42501';
  end if;
  if p_checkpoint is null and p_discard is false then
    return (select coalesce(jsonb_agg(c.checkpoint order by c.revision desc),'[]')
      from private.home_media_edit_checkpoints c where c.actor=p_actor and c.checkpoint is not null);
  end if;
  if jsonb_typeof(p_checkpoint) is distinct from 'object' or p_discard is null
    or length(p_checkpoint::text)>262144 or coalesce(p_checkpoint->>'savedAt','') !~ '^[0-9]{1,16}$'
    or p_checkpoint->>'key' is null or p_checkpoint->>'listingId' is null
    or jsonb_typeof(p_checkpoint->'title') is distinct from 'string'
    or jsonb_typeof(p_checkpoint#>'{baseGallery,images}') is distinct from 'array'
    or jsonb_typeof(p_checkpoint#>'{gallery,images}') is distinct from 'array'
    or jsonb_typeof(p_checkpoint->'pending') is distinct from 'array' then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  session_id:=(p_checkpoint->>'key')::uuid;
  listing_id:=(p_checkpoint->>'listingId')::uuid;
  revision:=(p_checkpoint->>'savedAt')::bigint;
  if revision>9007199254740991 or jsonb_array_length(p_checkpoint#>'{gallery,images}')>40
    or exists(select 1 from jsonb_array_elements(p_checkpoint#>'{gallery,images}') v where jsonb_typeof(v)<>'string')
    or exists(select 1 from jsonb_array_elements(p_checkpoint->'pending') u
      where private.home_media_scope_id('property-media',u->>'path') is distinct from listing_id) then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  -- Share the existing reservation lock. A checkpoint and a delete intent cannot win together.
  if not pg_try_advisory_xact_lock(hashtextextended('home.photo.rename',0)) then
    raise exception 'listing_cleanup.media_busy' using errcode='55P03';
  end if;
  select c.revision,c.checkpoint into current_revision,current_checkpoint
    from private.home_media_edit_checkpoints c where c.actor=p_actor and c.id=session_id;
  if found and current_checkpoint is null then return '"discarded"'::jsonb; end if;
  if current_revision>revision then return '"newer"'::jsonb; end if;
  if p_discard then
    p_checkpoint:=null;
    media:='[]';
  else
    select coalesce(jsonb_agg(l.bucket||'/'||l.name),'[]') into media from private.home_media_document_evidence(
      jsonb_build_array(p_checkpoint->'gallery'->'images',p_checkpoint->'gallery'->'video_url',
        coalesce((select jsonb_agg(u->'path') from jsonb_array_elements(p_checkpoint->'pending') u),'[]'))) l
    where private.home_media_scope_id(l.bucket,l.name) is not null;
    if exists(select 1 from private.home_media_items i where i.source='unused_listing'
      and i.state in ('deleting','removed','review') and media @> jsonb_build_array(i.bucket||'/'||i.name)
      and not private.home_media_edit_referenced(i.bucket,i.name)) then
      raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
    end if;
    delete from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      and media @> jsonb_build_array(i.bucket||'/'||i.name);
  end if;
  insert into private.home_media_edit_checkpoints(actor,id,revision,checkpoint,links)
    values(p_actor,session_id,revision,p_checkpoint,media)
  on conflict(actor,id) do update set revision=excluded.revision,checkpoint=excluded.checkpoint,links=excluded.links;
  return to_jsonb(case when p_discard then 'discarded' else 'saved' end);
end;
$$;

-- Existing detached and historical rows keep their lifecycle. A directory is scope metadata.
create or replace function private.home_media_referenced(p_bucket text,p_name text,p_include_original_name boolean default false)
returns boolean language sql stable set search_path='' as $$
  select private.home_media_edit_referenced(p_bucket,p_name)
    or private.home_media_content_referenced(p_bucket,p_name,p_include_original_name)
    -- Preserve the earlier GH-56 receipt's exact draft and identity guard.
    or (p_include_original_name and p_bucket='property-media' and exists(
      select 1 from private.home_media_items i where i.bucket=p_bucket and i.name=p_name
        and i.source='historical' and i.historical_review->>'scope'='GH-56'
        and not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name
          and o.id=i.object_id and o.version=i.object_version and o.metadata->>'size'=i.bytes::text
          and btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag'
          and private.home_media_gh56_identity(i.name,i.object_id,i.object_version,i.bytes,i.historical_review->>'etag')
          and not private.home_media_gh56_pending(i.name))));
$$;

create function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,s.listing_id from storage.objects o
    cross join lateral (select private.home_media_scope_id(o.bucket_id,o.name) listing_id) s
    where o.bucket_id in ('property-media','listing-videos') and s.listing_id is not null
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), refs as materialized (
    select distinct l.bucket,l.name from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
    where exists(select 1 from objects)
  ), observed as (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or private.home_media_provider_upload(o.bucket_id,o.name) then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when exists(select 1 from private.home_listing_deletion_media m where m.bucket=o.bucket_id and m.name=o.name)
          or (o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key)))
          then 'legacy_lifecycle'
        when not exists(select 1 from private.home_media_identity(o.bucket_id,o.name) verified where verified.id=o.id)
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state
    from objects o left join public.properties p on p.id=o.listing_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join refs link on link.bucket=o.bucket_id and link.name=o.name
    left join refs full_key on full_key.bucket is null and full_key.name=lower(o.name)
    left join refs filename on filename.bucket is null and filename.name=lower(regexp_replace(o.name,'^.*/',''))
    left join refs original on original.bucket is null and original.name=lower(btrim(o.user_metadata->>'original_filename'))
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end
  from observed o;
$$;

-- The Owner can inspect old and new objects without moving any of them to Trash.
create function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page jsonb; needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  select coalesce(jsonb_agg(to_jsonb(s) order by s.bucket,s.name),'[]') into page from (
    select r.*,r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible
    from private.home_media_inactivity_inventory() r cross join private.home_media_control c
    where c.singleton and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0)
    order by r.bucket,r.name limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)
  ) s;
  return jsonb_build_object('items',page-30,'hasMore',jsonb_array_length(page)>30,'available',true,
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton));
end;
$$;

-- Observe and clear timers in a single snapshot. Legacy Trash and its receipts are outside the update.
create function private.home_media_observe_listing_inactivity() returns void
language sql set search_path='' as $$
  with unused as materialized (
    select * from private.home_media_inactivity_inventory() where reason in ('awaiting_observation','waiting','eligible')
  ), reset as (
    delete from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      and not exists(select 1 from unused s where s.bucket=i.bucket and s.name=i.name)
  )
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
  select s.bucket,s.name,'unused_listing',s.listing_id,s.object_id,s.object_version,s.bytes,'retained',now(),now()+interval '96 hours'
  from unused s where s.reason='awaiting_observation'
  on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
    upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
  where home_media_items.source='unused_listing' and home_media_items.state='retained'
    or home_media_items.source='upload' and home_media_items.state in ('uploading','retained');
$$;

-- Use the existing worker lock plus the same shared catalogues inspected for references.
create function private.home_media_lock_listing_inactivity() returns void
language plpgsql set search_path='' as $$
declare catalog text;
begin
  foreach catalog in array private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      execute format('lock table public.%I in share row exclusive mode nowait',catalog);
    end if;
  end loop;
end;
$$;

-- A use that starts and ends between hourly observations still resets the clock.
-- Reserve at delete intent so a file remains attachable right up to that point.
create function private.home_media_reset_listing_inactivity() returns trigger
language plpgsql security definer set search_path='' as $$
declare prior jsonb; keys jsonb;
begin
  if tg_op='UPDATE' then prior:=to_jsonb(old); end if;
  select jsonb_agg(to_jsonb(added)) into keys from (
    select * from private.home_media_document_evidence(to_jsonb(new))
    except select * from private.home_media_document_evidence(prior)
  ) added;
  if keys is null then return new; end if;
  if exists(select 1 from private.home_media_items i
    join jsonb_to_recordset(keys) k(bucket text,name text) on k.bucket=i.bucket and k.name=i.name
    where i.source='unused_listing' and i.state in ('deleting','removed','review'))
    or exists(select 1 from private.home_media_items i join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
      join jsonb_to_recordset(keys) k(bucket text,name text) on k.bucket is null and k.name in
        (lower(i.name),lower(regexp_replace(i.name,'^.*/','')),lower(btrim(o.user_metadata->>'original_filename')))
      where i.source='unused_listing' and i.state in ('deleting','review')) then
    raise exception 'listing_cleanup.retired_reference' using errcode='PT409';
  end if;
  delete from private.home_media_items i using jsonb_to_recordset(keys) k(bucket text,name text),storage.objects o
    where i.source='unused_listing' and i.state='retained' and o.bucket_id=i.bucket and o.name=i.name
      and (k.bucket=i.bucket and k.name=i.name or k.bucket is null and k.name in
        (lower(i.name),lower(regexp_replace(i.name,'^.*/','')),lower(btrim(o.user_metadata->>'original_filename'))));
  return new;
end;
$$;

do $$
declare catalog text;
begin
  foreach catalog in array array['properties','neighbourhoods','site_settings','listing_authors','site_activities',
    'editorial_articles','enquiries','enquiry_notes','feedback_public','feedback_submissions','property_assistance',
    'assistance_reviews','landlord_submissions','landlord_submission_files']||private.home_media_shared_catalogs() loop
    if to_regclass(format('public.%I',catalog)) is not null then
      execute format('create trigger home_media_reset_listing_inactivity before insert or update on public.%I
        for each row execute function private.home_media_reset_listing_inactivity()',catalog);
    end if;
  end loop;
end;
$$;

create function private.home_media_reset_on_hold() returns trigger
language plpgsql set search_path='' as $$
begin
  delete from private.home_media_items where bucket=new.bucket and name=new.name and source='unused_listing' and state='retained';
  return new;
end;
$$;
create trigger home_media_reset_on_hold after insert on private.home_media_review_holds
  for each row execute function private.home_media_reset_on_hold();

-- An explicit listing deletion takes over an observation. A reserved removal already has a receipt.
create function private.home_media_release_listing_observation() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from private.home_media_items where bucket=new.bucket and name=new.name
    and source='unused_listing' and state in ('deleting','removed','review')) then return null; end if;
  delete from private.home_media_items where bucket=new.bucket and name=new.name and source='unused_listing' and state='retained';
  return new;
end;
$$;
create trigger home_media_release_listing_observation before insert on private.home_listing_deletion_media
  for each row execute function private.home_media_release_listing_observation();

create or replace function private.home_media_record_detached() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_media jsonb:=private.home_media_listing_fields(old);
  after_media jsonb:=private.home_media_listing_fields(new);
begin
  insert into private.home_media_renamed_listings(rename_id,listing_id,before_media,after_media)
  select r.id,old.id,before_media,after_media from private.property_photo_renames r where r.applied_at is not null
    and exists(select 1 from private.home_media_links(before_media) l where l.bucket='property-media' and l.name=r.old_key)
    and exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.new_key)
    and not exists(select 1 from private.home_media_links(after_media) l where l.bucket='property-media' and l.name=r.old_key)
  on conflict do nothing;
  insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,
    unreferenced_since,expires_at,restore_media)
  select o.bucket_id,o.name,'detached',old.id,o.id,o.version,
    case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end,
    'candidate',now(),now()+interval '48 hours',before_media
  from (
    select 'property-media'::text bucket,private.home_photo_key(u,null) name from unnest(old.images) u
    union select bucket,name from private.home_listing_storage_links(old.video_url) where bucket='listing-videos'
  ) prior cross join lateral private.home_media_identity(prior.bucket,prior.name) o
  where (private.home_media_scope_id(o.bucket_id,o.name)=old.id or exists(
    select 1 from private.home_media_items i where i.bucket=o.bucket_id and i.name=o.name and i.state='restored'
      and i.restored_to=old.id and i.object_id=o.id and i.object_version is not distinct from o.version))
    and not exists(select 1 from private.home_media_links(to_jsonb(new)) l where l.bucket=o.bucket_id and l.name=o.name)
    and not exists(select 1 from private.property_photo_renames r where o.bucket_id='property-media' and o.name in (r.old_key,r.new_key))
  on conflict(bucket,name) do update set source='detached',source_id=excluded.source_id,object_id=excluded.object_id,
    object_version=excluded.object_version,bytes=excluded.bytes,state='candidate',hold_reason=null,
    unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,attempts=0,retry_after=null,
    restore_media=excluded.restore_media,restored_to=null,deletion_started_at=null,deletion_run=null
    where home_media_items.state in ('uploading','restored','retained');
  return new;
end;
$$;

-- Keep manually verified File Trash staging and its 48-hour deadlines.
create or replace function private.home_media_stage_candidates(p_only uuid) returns integer
language plpgsql set search_path='' as $$
declare candidate private.home_media_items; target storage.objects; staged integer:=0;
begin
  delete from private.home_media_deleted_listings where listing_id in (
    select listing_id from private.home_media_deleted_listings where expires_at<=now() order by expires_at limit 40);
  update private.home_media_items set restore_media=null where id in (
    select id from private.home_media_items where restore_media is not null and expires_at<=now() order by expires_at limit 40);
  for candidate in select * from private.home_media_items i where state='candidate' and coalesce(upload_until,'-infinity')<=now()
    and (p_only is null or id=p_only)
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)
    order by expires_at,id limit 40
  loop
    if not exists(select 1 from private.home_media_identity(candidate.bucket,candidate.name) o
      where o.id=candidate.object_id and o.version is not distinct from candidate.object_version) then
      update private.home_media_items set state='review',hold_reason='identity' where id=candidate.id;
    elsif private.home_media_provider_upload(candidate.bucket,candidate.name) then
      if p_only is not null then raise exception 'listing_cleanup.media_busy' using errcode='55P03'; end if;
    elsif private.home_media_referenced(candidate.bucket,candidate.name) then
      update private.home_media_items set state='retained',hold_reason='reference' where id=candidate.id;
    else
      update private.home_media_items set state='trashed' where id=candidate.id;
      staged:=staged+1;
    end if;
  end loop;
  for candidate in select * from private.home_media_items i where state='uploading' and upload_until<=now()
    and (p_only is null or i.id=p_only)
    and (private.home_media_scope_id(i.bucket,i.name) is null
      or not exists(select 1 from storage.objects o where o.bucket_id=i.bucket and o.name=i.name))
    and not private.home_media_provider_upload(i.bucket,i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and (retry_after is null or retry_after<=now()) order by upload_until,id limit 40
  loop
    select * into target from private.home_media_identity(candidate.bucket,candidate.name);
    if not found and not exists(select 1 from storage.objects o where o.bucket_id=candidate.bucket and o.name=candidate.name) then
      -- The expired reservation never produced a completed object. Provider-side
      -- resumable sessions expire independently of this app metadata.
      delete from private.home_media_items where id=candidate.id and state='uploading' and upload_until<=now();
      continue;
    end if;
    if found and to_jsonb(target)->>'owner_id'=candidate.upload_owner::text
      and not exists(select 1 from private.property_photo_renames r where candidate.bucket='property-media'
        and candidate.name in(r.old_key,r.new_key))
      and not private.home_media_referenced(candidate.bucket,candidate.name)
    then
      update private.home_media_items set state='trashed',object_id=target.id,object_version=target.version,
        bytes=case when target.metadata->>'size' ~ '^[0-9]{1,15}$' then (target.metadata->>'size')::bigint end,
        unreferenced_since=now(),expires_at=now()+interval '48 hours',retry_after=null
      where id=candidate.id and state='uploading' and upload_until<=now();
      if found then staged:=staged+1; end if;
    else
      update private.home_media_items set state='retained',hold_reason='upload_dependency',retry_after=null
        where id=candidate.id and state='uploading' and upload_until<=now();
    end if;
  end loop;
  return staged;
end;
$$;

create or replace function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  if p_item is not null and p_actor is null then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if p_item is not null and not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    perform private.home_media_lock_listing_inactivity();
    perform private.home_media_observe_listing_inactivity();
    if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry) values(job,p_actor,p_item,p_expiry);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items m
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now())
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name)
        and not private.home_media_edit_referenced(m.bucket,m.name) and (
        ((state='trashed' or (source='unused_listing' and state='retained' and ctrl.listing_inactivity_enabled))
          and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4 and (source<>'unused_listing' or ctrl.listing_inactivity_enabled)) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

create or replace function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean; protection text;
begin
  select r.* into job from private.home_media_control c join private.home_media_runs r on r.id=c.lease
  where c.lease=p_run and c.lease_until>now() and c.permanent_enabled;
  if not found then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if job.actor is not null then
    perform set_config('request.jwt.claim.sub',job.actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  perform private.lock_home_listing_media_snapshot();
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.retry_after>now() or item.upload_until>now()
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry))
    then return null; end if;
  if exists(select 1 from private.home_media_review_holds h where h.bucket=item.bucket and h.name=item.name)
    or private.home_media_edit_referenced(item.bucket,item.name)
    or private.home_media_provider_upload(item.bucket,item.name) then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if item.source='unused_listing' then
    if job.early_item is not null or item.state not in ('retained','deleting') or item.expires_at>now()
      or item.attempts>=4 or not (select listing_inactivity_enabled from private.home_media_control where singleton)
      then return null; end if;
    perform private.home_media_lock_listing_inactivity();
    select r.reason into protection from private.home_media_inactivity_inventory(item.bucket,item.name) r;
    if protection is null or protection not in ('eligible','removing') then
      delete from private.home_media_items where id=p_id and state='retained';
      return null;
    end if;
  elsif (job.early_item is null and (item.state not in ('trashed','deleting')
      or (item.deletion_started_at is null and item.expires_at>now())))
    or (job.early_item is not null and item.state not in ('candidate','trashed')) or item.attempts>=4
    then return null; end if;
  if (item.source<>'unused_listing' and private.home_media_referenced(item.bucket,item.name,item.source='historical'))
    or not present
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version
      and (item.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=item.historical_review->>'etag')))
    or (item.source='rename' and (not exists(select 1 from private.home_media_identity('property-media',item.replacement_key) o
      where o.id=item.replacement_id and o.version is not distinct from item.replacement_version)
      or not exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=item.replacement_key)))
  then
    update private.home_media_items set state='review',hold_reason='dependency_or_identity' where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return null;
  end if;
  if item.source='rename' and p_replacement_verified is not true then
    update private.home_media_items set attempts=attempts+1,retry_after=now()+interval '1 hour',
      state=case when attempts>=3 then 'review' else state end,hold_reason='replacement' where id=p_id;
    update private.home_media_runs set attempted=attempted+1,failed=failed+1 where id=p_run;
    return null;
  end if;
  update private.home_media_items set state='deleting',attempts=attempts+1,retry_after=now()+interval '1 hour',
    deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),deletion_run=p_run where id=p_id;
  update private.home_media_runs set attempted=attempted+1 where id=p_run;
  return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',present,
    'replacementKey',item.replacement_key,'replacementSha256',item.replacement_sha256);
end;
$$;

create or replace function public.home_media_finish(p_run uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
  update private.home_media_control set lease=null,lease_until=null where lease=p_run;
  if found then update private.home_media_runs set finished_at=clock_timestamp() where id=p_run; end if;
  return (select count(*)::integer from private.home_media_items i
    where (i.state in ('candidate','trashed','deleting','review') or (i.source='unused_listing' and i.state='retained'
      and (select listing_inactivity_enabled from private.home_media_control where singleton))) and i.expires_at<=now()
      and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
      and not private.home_media_edit_referenced(i.bucket,i.name));
end;
$$;

create or replace function private.home_media_take_inventory(p_scan boolean,p_after uuid default null) returns jsonb
language sql stable set search_path='' as $$
  with refs as materialized (
    select distinct r.bucket,r.name from private.home_listing_media_refs r where r.name is not null
  ), checking as materialized (
    select i.* from private.home_media_items i
    where p_scan and (i.state='candidate' or (i.state='uploading' and i.upload_until<=now()
      and private.home_media_scope_id(i.bucket,i.name) is null))
      and coalesce(i.upload_until,'-infinity')<=now() and coalesce(i.retry_after,'-infinity')<=now()
    order by (p_after is not null and i.id<=p_after),i.id limit 1
  ), verified as materialized (
    select i.id,o.id as object_id,o.version from checking i cross join lateral private.home_media_identity(i.bucket,i.name) o
    where (i.state='candidate' and o.id=i.object_id and o.version is not distinct from i.object_version
      or i.state='uploading' and o.owner_id::text=i.upload_owner::text
        and not exists(select 1 from private.property_photo_renames r where i.bucket='property-media' and i.name in(r.old_key,r.new_key)))
      and not exists(select 1 from refs r where r.bucket=i.bucket and r.name=i.name)
      and not private.home_media_provider_upload(i.bucket,i.name)
      and not private.home_media_referenced(i.bucket,i.name)
  ), observed as materialized (
    select o.bucket_id as bucket,o.name,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      r.name is null unlinked,
      case when r.name is not null then 'reference'
        when i.state in ('trashed','deleting') then 'scheduled'
        when v.id is not null then 'verified'
        when i.state='uploading' and i.upload_until>now() then 'upload'
        when i.state='review' or (i.state='retained' and i.source not in ('unused_listing','upload')) then 'review'
        when h.name is not null then h.reason
        when private.home_media_scope_id(o.bucket_id,o.name) is not null then 'scope_retention'
        when o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames pr
          where (pr.new_key=o.name and pr.applied_at is null) or (pr.old_key=o.name and pr.removed_at is null)) then 'rename'
        else 'potential' end as reason
    from storage.objects o left join refs r on r.bucket=o.bucket_id and r.name=o.name
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name left join verified v on v.id=i.id
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    where o.bucket_id in ('property-media','listing-videos')
  ), totals as (
    select count(*) as objects,coalesce(sum(bytes),0) as bytes,
      count(*) filter(where unlinked) as candidates,coalesce(sum(bytes) filter(where unlinked),0) as candidate_bytes,
      count(*) filter(where reason in ('reference','upload','review','rename','owner_hold','recovery_hold','file_trash_test')) as protected,
      count(*) filter(where unlinked and reason in ('upload','review','rename','owner_hold','recovery_hold','file_trash_test')) as protected_candidates,
      count(*) filter(where reason='potential') as unreviewed,
      count(*) filter(where reason='verified') as verified_count,
      coalesce(sum(bytes) filter(where reason='verified'),0) as verified_bytes
    from observed
  )
  select jsonb_build_object('objects',t.objects,'bytes',t.bytes,'candidates',t.candidates,'candidateBytes',t.candidate_bytes,
    'protected',t.protected,'protectedCandidates',t.protected_candidates,'unreviewed',t.unreviewed,
    'verifiedAtScan',t.verified_count,'verifiedBytesAtScan',t.verified_bytes,'checkedAt',statement_timestamp(),
    'checkedQueue',(select count(*) from checking),'reviewedId',(select id from checking),
    'broken',(select count(*) from refs r where not exists(select 1 from observed o where o.bucket=r.bucket and o.name=r.name)))
    || case when p_scan then jsonb_build_object(
      'entries',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'name',name,'bytes',bytes,'reason',reason) order by bucket,name)
        from observed),'[]'::jsonb),
      'verifiedObjects',coalesce((select jsonb_agg(to_jsonb(v)) from verified v),'[]'::jsonb)) else '{}'::jsonb end
  from totals t;
$$;

create or replace function public.home_media_review(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
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
      'reason',case when o.id is null then 'identity' when h.name is not null then h.reason
        when private.home_media_scope_id(c.bucket,c.name) is not null then 'scope_retention' when i.id is not null then 'tracked'
        when c.reason not in ('potential','verified') then c.reason
        when c.bucket='listing-videos' then 'video_review' else 'potential' end) order by c.ordinality),'[]'::jsonb)
    into page from (
      select e.value->>'bucket' as bucket,e.value->>'name' as name,e.value->>'reason' as reason,e.ordinality,p.id as listing_id,p.listing_code,p.status
      from jsonb_array_elements(sample->'entries') with ordinality e
      left join public.properties p on p.id=private.home_media_scope_id(e.value->>'bucket',e.value->>'name')
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
    when private.home_media_scope_id(media_bucket,object_name) is not null then
      (select case when s.reason in ('owner_hold','recovery_hold','file_trash_test','reference','filename_match','identity')
        then s.reason else 'scope_retention' end from private.home_media_inactivity_inventory(media_bucket,object_name) s)
    when exists(select 1 from private.home_media_review_holds h where h.bucket=media_bucket and h.name=object_name) then 'owner_hold'
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

create or replace function private.home_media_early_block(i private.home_media_items) returns text
language sql stable set search_path='' as $$
  select case
    when i.state='deleting' then 'removal_in_progress'
    when i.state='review' and i.hold_reason in ('storage','storage_present') then 'storage_failure'
    when i.state='review' then 'protected'
    when i.state<>'trashed' then 'no_longer_eligible'
    when i.expires_at is null then 'missing_expiry'
    when exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name) then
      (select h.reason from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    when private.home_media_edit_referenced(i.bucket,i.name) then 'editing_session'
    when i.expires_at<=now() then 'expired'
    when i.upload_until>now() then 'active_upload'
    when i.retry_after>now() then 'retry_wait'
    when i.attempts>=4 then 'attempt_limit'
    when not exists(select 1 from private.home_media_identity(i.bucket,i.name) o
      where o.id=i.object_id and o.version is not distinct from i.object_version
        and (i.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=i.historical_review->>'etag')) then 'identity_changed'
    end;
$$;

-- Use the audited object ID and version for the 14 recovery photos and the two
-- GH-56 File Trash tests. These holds do not rewrite the File Trash records.
insert into private.home_media_review_holds(bucket,name,reason)
select o.bucket_id,o.name,a.reason from (values
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/2bd6c300-127b-4be3-8818-2adfe45784d9/1795572992608-7775080045339692044-7775080045339692044-0ae40c547edcc18bcb5c18d4d4c5104a.jpg',
   'b966a9a6-c782-4a8c-918b-43d8944c4c92'::uuid,'3f0ebf9b-322a-44fe-b431-aec27f6a7891','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/b9002740-2ca8-4124-aee7-21f8b621c5d6/1795572992589-7775080045339692044-7775080045339692044-4f46cd03edad4d273045d0f578be4c5b.jpg',
   '781e3623-0ead-48e1-829a-a83ca868df61'::uuid,'0f33605e-f8ec-453e-934e-155e6d5e8d42','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/17c628e9-92da-442c-a14f-6b5ea28e873b/1795572992605-7775080045339692044-7775080045339692044-60e4283f896761a6755dc784f8c866de.jpg',
   '5901cb59-0bcf-4b65-9e54-dd1b09b1e555'::uuid,'3c9a0cd9-917a-4d86-b1db-4993a4904503','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/d8f287c2-2861-4a7c-aa3b-70c57a7f8454/1795572992608-7775080045339692044-7775080045339692044-0ae40c547edcc18bcb5c18d4d4c5104a.jpg',
   '9f154194-7c18-4834-8f9d-32de4fb2d26e'::uuid,'609abc27-0927-4a6a-b90d-82ccf3270ad1','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/ee4aa432-e05d-4712-b5aa-3274465c32c0/1795572992600-7775080045339692044-7775080045339692044-e10ee1f29d4eff41f84170ecd3d138a0.jpg',
   '491ff5c0-e54b-49de-8fd3-d9e6c3ea6ed1'::uuid,'9f8690de-8f31-49a2-9b60-f2bbf9206fcb','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/13f328a4-23c2-42c1-86d4-59cff7051dfa/1795572992610-7775080045339692044-7775080045339692044-00c06460ff3c70cb209ec74d766478cf.jpg',
   'ee7a2908-28f3-4157-8b7e-ac2371d79df9'::uuid,'ec67320f-d4f8-4be3-a516-7a5b59da606d','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/ced2f575-c908-404d-a4c9-9ec9cfca9e84/1795572992613-7775080045339692044-7775080045339692044-c436a70c695412a8a38f70816c406324.jpg',
   'a010ecfe-8185-4469-87b8-0af2611c6237'::uuid,'18a4bf29-65b3-4a88-8fbc-7ae2a3a2ce33','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/86d1931b-de23-4ce2-9f9e-8c8223ea8910/1795572992615-7775080045339692044-7775080045339692044-d32f9ecc5def53e2e21d769da3e2d2a9.jpg',
   'e9d2becb-ae87-45f4-832b-b8cd81a4c3f4'::uuid,'21a1e8dd-c702-4698-afb0-a451c1672b0f','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/a1094fdd-7474-4561-8fe4-c7b5b8d651fb/1795572992617-7775080045339692044-7775080045339692044-a4c3f52c819b5716d8515924119260b6.jpg',
   '7e2f365a-e569-42cc-bb23-9f31ae61fef8'::uuid,'47371c38-4d75-4608-a5aa-c47beb9ba973','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/f0acd9ec-d4ba-4e71-bd99-b2da420094b3/1795572992620-7775080045339692044-7775080045339692044-06ee880780e00457bb1165fb9b71ffff.jpg',
   '20f3dd67-efa7-46b0-b2ab-f4e68785841a'::uuid,'62dc0b76-d172-4914-b8e9-d19258bd7edc','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/753be0c5-ed95-4870-9399-d96320489006/1795572992622-7775080045339692044-7775080045339692044-aa294a9486d83dbaa379cc5cb0335b87.jpg',
   '32f07c22-ff4d-4083-a9c5-c668a56b8d16'::uuid,'10b573bf-a980-4cdc-9527-90b9e8895c7c','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/a5b7a812-a79e-4cba-b928-275933377e7a/1795572992624-7775080045339692044-7775080045339692044-c778c479268808edebe813d6af4cc91d.jpg',
   'e9253c65-490b-432a-8f77-c5c17b2dd1f3'::uuid,'1d8deef4-da73-4ad5-a7ef-3fa79f39cd04','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/db21cc8a-2806-437a-9335-36fbf018a45e/1795572992626-7775080045339692044-7775080045339692044-95d210c6fb3ab9bcaf866c51357e41df.jpg',
   '04302ae3-39bb-43c2-bf03-ef9cf12b6d88'::uuid,'44c5c631-fa6e-4444-bb60-bb57ba67a535','recovery_hold'),
  ('properties/listings/003be3a7-963d-4e2c-911d-90774a70fe44/74bc62e6-92c3-4a05-b389-8da3f38de1cb/1795572992628-7775080045339692044-7775080045339692044-59e77b11c0c9feed4f07dcfd80d35a80.jpg',
   '4922b448-83d6-4e5d-9efa-70a60ec8872f'::uuid,'da521d9f-9a60-477e-bc64-ab91d7834b81','recovery_hold'),
  ('properties/listings/198b8547-8614-4a8e-b125-7e6d9846df57/37e55a65-d019-447b-bb88-99c03a0bca07/jobs-staff-portal-header.webp',
   '5cdcb39e-b324-418b-a447-71886cac26f2'::uuid,'8e02bfef-0ea4-4b4f-ab34-510a0289f39a','file_trash_test'),
  ('properties/listings/198b8547-8614-4a8e-b125-7e6d9846df57/fd2c8e2f-4e52-4df3-aa4a-610c946830b2/manual-cleanup-fronend-1.jpg',
   '16a878a9-f1b2-4c9b-a4cd-966e4c2e82ea'::uuid,'6adbf40f-494e-490c-b553-1967119cca30','file_trash_test')
) a(name,id,version,reason) join storage.objects o on o.bucket_id='property-media'
  and o.name=a.name and o.id=a.id and o.version=a.version
on conflict(bucket,name) do update set reason=excluded.reason;

revoke all on function private.home_media_scope_id(text,text),private.home_media_document_evidence(jsonb),
  private.home_media_reference_documents(),private.home_media_edit_referenced(text,text),
  private.home_media_inactivity_inventory(text,text),private.home_media_observe_listing_inactivity(),
  private.home_media_lock_listing_inactivity(),private.home_media_reset_listing_inactivity(),private.home_media_reset_on_hold(),
  private.home_media_release_listing_observation(),
  public.home_media_gallery_checkpoints(uuid,jsonb,boolean),public.home_media_retention_preview(integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_gallery_checkpoints(uuid,jsonb,boolean),
  public.home_media_retention_preview(integer,text) to authenticated;
notify pgrst,'reload schema';
commit;

-- Migration: 20261127153844_home_listing_media_manual_removal.sql
-- Owner-initiated removal uses the same worker lease, target and settlement.
begin;

alter table private.home_media_runs add column early_unused boolean not null default false;

create function private.home_media_unused_ticket(i private.home_media_items) returns jsonb
language sql stable strict set search_path='' as $$
  select jsonb_build_object('id',i.id,'name',i.name,'bucket',i.bucket,'bytes',i.bytes,'expires_at',i.expires_at,
    'source','unused_listing');
$$;

-- The signed-in Owner can select only live, verified identities from the inactivity ledger.
create or replace function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  with matches as materialized (
    select r.*,r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
      private.home_media_unused_ticket(i) as manual_target
    from private.home_media_inactivity_inventory() r cross join private.home_media_control c
    left join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing'
      and i.state='retained' and r.reason in ('waiting','eligible')
    where c.singleton and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0)
  ), page as (
    select coalesce(jsonb_agg(to_jsonb(s) order by s.bucket,s.name),'[]') items from (
      select * from matches order by bucket,name limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)
    ) s
  )
  select jsonb_build_object('items',items-30,'hasMore',jsonb_array_length(items)>30,'available',true,
    'manualCount',(select count(*) from matches where manual_target is not null),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
    into result from page;
  return result;
end;
$$;

create function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare needle text:=lower(left(btrim(coalesce(p_query,'')),120));
begin
  perform private.require_home_photo_owner();
  return (select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    from private.home_media_inactivity_inventory() r
    join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing' and i.state='retained'
    where r.reason in ('waiting','eligible') and (needle='' or strpos(lower(r.name),needle)>0 or strpos(lower(r.listing_code),needle)>0));
end;
$$;

create function public.home_media_claim_unused(p_actor uuid,p_item uuid,p_expiry timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is null then raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  perform set_config('request.jwt.claim.sub',p_actor::text,true);
  perform private.require_home_photo_owner();
  select * into ctrl from private.home_media_control where singleton for update;
  if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  if not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.source='unused_listing' and i.state='retained' and i.attempts<4) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry,early_unused) values(job,p_actor,p_item,p_expiry,true);
  return jsonb_build_object('status','ok','id',job,'items',jsonb_build_array(jsonb_build_object('id',p_item)));
end;
$$;

create function public.home_media_unused_receipt(p_id uuid,p_expiry timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare item private.home_media_items; result text;
begin
  perform private.require_home_photo_owner();
  select * into item from private.home_media_items where id=p_id and source='unused_listing' and expires_at=p_expiry;
  if not found then return jsonb_build_object('status','selection_changed'); end if;
  if item.state='removed' then
    result:=case when exists(select 1 from private.home_media_runs r where r.id=item.deletion_run
      and r.actor=auth.uid() and r.early_unused and r.early_item=item.id and r.early_expiry=p_expiry)
      then 'removed' else 'already_removed' end;
  elsif exists(select 1 from private.home_media_control c join private.home_media_runs r on r.id=c.lease
    where c.singleton and c.lease_until>now() and r.early_unused and r.early_item=item.id) then
    result:='removal_in_progress';
  elsif item.state='deleting' then
    result:=case when item.hold_reason in ('storage','storage_present') then 'storage_failure' else 'removal_in_progress' end;
  elsif item.state='retained' then
    select case
      when r.reason in ('waiting','eligible') then 'eligible'
      when r.reason in ('owner_hold','recovery_hold','file_trash_test','editing_session','active_upload') then r.reason
      when r.reason in ('reference','filename_match') then 'protected'
      else 'identity_changed' end into result
    from private.home_media_inactivity_inventory(item.bucket,item.name) r;
  else result:='no_longer_eligible'; end if;
  return jsonb_build_object('status',coalesce(result,'identity_changed'),'bytes',item.bytes);
end;
$$;

-- A failed manual attempt cannot advance the date of scheduled removal.
create or replace function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  if p_item is not null and p_actor is null then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if p_item is not null and not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    perform private.home_media_lock_listing_inactivity();
    perform private.home_media_observe_listing_inactivity();
    if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry) values(job,p_actor,p_item,p_expiry);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items m
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now())
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name)
        and not private.home_media_edit_referenced(m.bucket,m.name) and (
        ((state='trashed' or (source='unused_listing' and state='retained' and ctrl.listing_inactivity_enabled))
          and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4 and (source<>'unused_listing' or (ctrl.listing_inactivity_enabled and expires_at<=now()))) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

create or replace function public.home_media_target(p_run uuid,p_id uuid,p_replacement_verified boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item private.home_media_items; job private.home_media_runs; present boolean; protection text;
begin
  select r.* into job from private.home_media_control c join private.home_media_runs r on r.id=c.lease
  where c.lease=p_run and c.lease_until>now() and c.permanent_enabled;
  if not found then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  if job.actor is not null then
    perform set_config('request.jwt.claim.sub',job.actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  perform private.lock_home_listing_media_snapshot();
  select * into item from private.home_media_items where id=p_id for update;
  if not found or item.retry_after>now() or item.upload_until>now()
    or (job.early_item is not null and (p_id<>job.early_item or item.expires_at is distinct from job.early_expiry
      or job.early_unused is distinct from (item.source='unused_listing')))
    then return null; end if;
  if exists(select 1 from private.home_media_review_holds h where h.bucket=item.bucket and h.name=item.name)
    or private.home_media_edit_referenced(item.bucket,item.name)
    or private.home_media_provider_upload(item.bucket,item.name) then return null; end if;
  present:=exists(select 1 from storage.objects o where o.bucket_id=item.bucket and o.name=item.name);
  if item.state in ('deleting','review') and item.deletion_started_at is not null and not present then
    update private.home_media_items set state='deleting',deletion_run=p_run where id=p_id;
    update private.home_media_runs set attempted=attempted+1 where id=p_run;
    return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',false);
  end if;
  if item.source='unused_listing' then
    if item.attempts>=4 or (job.early_unused and item.state<>'retained')
      or (not job.early_unused and (item.state not in ('retained','deleting') or item.expires_at>now()
        or not (select listing_inactivity_enabled from private.home_media_control where singleton)))
      then return null; end if;
    perform private.home_media_lock_listing_inactivity();
    select r.reason into protection from private.home_media_inactivity_inventory(item.bucket,item.name) r;
    if protection is null or not (protection='eligible' or (job.early_unused and protection='waiting')
      or (not job.early_unused and protection='removing')) then
      delete from private.home_media_items where id=p_id and state='retained';
      return null;
    end if;
  elsif (job.early_item is null and (item.state not in ('trashed','deleting')
      or (item.deletion_started_at is null and item.expires_at>now())))
    or (job.early_item is not null and item.state not in ('candidate','trashed')) or item.attempts>=4
    then return null; end if;
  if (item.source<>'unused_listing' and private.home_media_referenced(item.bucket,item.name,item.source='historical'))
    or not present
    or (present and not exists(select 1 from private.home_media_identity(item.bucket,item.name) o
      where o.id=item.object_id and o.version is not distinct from item.object_version
      and (item.source<>'historical' or btrim(coalesce(o.metadata->>'eTag',o.metadata->>'etag'),'"')=item.historical_review->>'etag')))
    or (item.source='rename' and (not exists(select 1 from private.home_media_identity('property-media',item.replacement_key) o
      where o.id=item.replacement_id and o.version is not distinct from item.replacement_version)
      or not exists(select 1 from public.properties p,unnest(p.images) u where private.home_photo_key(u,null)=item.replacement_key)))
  then
    update private.home_media_items set state='review',hold_reason='dependency_or_identity' where id=p_id;
    update private.home_media_runs set failed=failed+1 where id=p_run;
    return null;
  end if;
  if item.source='rename' and p_replacement_verified is not true then
    update private.home_media_items set attempts=attempts+1,retry_after=now()+interval '1 hour',
      state=case when attempts>=3 then 'review' else state end,hold_reason='replacement' where id=p_id;
    update private.home_media_runs set attempted=attempted+1,failed=failed+1 where id=p_run;
    return null;
  end if;
  update private.home_media_items set state='deleting',attempts=attempts+1,retry_after=now()+interval '1 hour',
    deletion_started_at=coalesce(deletion_started_at,clock_timestamp()),deletion_run=p_run where id=p_id;
  update private.home_media_runs set attempted=attempted+1 where id=p_run;
  return jsonb_build_object('bucket',item.bucket,'name',item.name,'present',present,
    'replacementKey',item.replacement_key,'replacementSha256',item.replacement_sha256);
end;
$$;

revoke all on function private.home_media_unused_ticket(private.home_media_items),
  public.home_media_retention_manifest(text),public.home_media_unused_receipt(uuid,timestamptz),
  public.home_media_claim_unused(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.home_media_retention_manifest(text),
  public.home_media_unused_receipt(uuid,timestamptz) to authenticated;
grant execute on function public.home_media_claim_unused(uuid,uuid,timestamptz) to service_role;
notify pgrst,'reload schema';
commit;

-- Migration: 20261127165022_home_media_inventory_controls.sql
-- Both tabs read the same classification and issue the existing manual removal ticket.
begin;

create function private.home_media_file_states(p_bucket text,p_name text,p_scoped_only boolean)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,s.listing_id from storage.objects o
    cross join lateral (select private.home_media_scope_id(o.bucket_id,o.name) listing_id) s
    where o.bucket_id in ('property-media','listing-videos') and (not p_scoped_only or s.listing_id is not null)
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), refs as materialized (
    select distinct l.bucket,l.name from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
    where exists(select 1 from objects)
  ), observed as (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or private.home_media_provider_upload(o.bucket_id,o.name) then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when exists(select 1 from private.home_listing_deletion_media m where m.bucket=o.bucket_id and m.name=o.name)
          or (o.bucket_id='property-media' and exists(select 1 from private.property_photo_renames r where o.name in (r.old_key,r.new_key)))
          then 'legacy_lifecycle'
        when not exists(select 1 from private.home_media_identity(o.bucket_id,o.name) verified where verified.id=o.id)
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when o.listing_id is null then 'outside_listing_scope'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state,link.name is not null as saved_reference
    from objects o left join public.properties p on p.id=o.listing_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join refs link on link.bucket=o.bucket_id and link.name=o.name
    left join refs full_key on full_key.bucket is null and full_key.name=lower(o.name)
    left join refs filename on filename.bucket is null and filename.name=lower(regexp_replace(o.name,'^.*/',''))
    left join refs original on original.bucket is null and original.name=lower(btrim(o.user_metadata->>'original_filename'))
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end,o.saved_reference
  from observed o;
$$;

create or replace function private.home_media_inactivity_inventory(p_bucket text default null,p_name text default null)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz)
language sql stable set search_path='' as $$
  select r.bucket,r.name,r.listing_id,r.listing_code,r.object_id,r.object_version,r.bytes,r.reason,r.eligible_at,r.legacy_expiry
  from private.home_media_file_states(p_bucket,p_name,true) r;
$$;

create function private.home_media_owner_files(p_offset integer,p_query text,p_scoped_only boolean) returns jsonb
language sql stable set search_path='' as $$
  with listing_links as materialized (
    select distinct on (l.bucket,l.name) l.bucket,l.name,p.id
    from public.properties p
    cross join lateral private.home_media_document_evidence(private.home_media_listing_fields(p)) l
    where not p_scoped_only and l.bucket is not null
    order by l.bucket,l.name,p.listing_code,p.id
  ), matches as materialized (
    select r.bucket,r.name,r.bytes,r.listing_id,p.listing_code,r.object_id,r.object_version,
      r.reason,r.eligible_at,r.legacy_expiry,r.saved_reference,
      p.title_en as listing_title_en,p.title_vi as listing_title_vi,
      r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
      private.home_media_unused_ticket(i) as manual_target
    from private.home_media_file_states(null,null,p_scoped_only) r
    cross join private.home_media_control c
    left join listing_links l on r.listing_id is null and r.saved_reference and l.bucket=r.bucket and l.name=r.name
    left join public.properties p on p.id=coalesce(r.listing_id,l.id)
    left join private.home_media_items i on i.bucket=r.bucket and i.name=r.name
      and i.source='unused_listing' and i.state='retained' and r.reason in ('waiting','eligible')
    where c.singleton and strpos(lower(concat_ws(' ',r.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0
  ), page as (
    select coalesce(jsonb_agg(to_jsonb(s)-'shortlist' order by shortlist desc,s.bucket,s.name),'[]') items
    from (select m.*,not p_scoped_only and m.manual_target is not null as shortlist
      from matches m order by shortlist desc,bucket,name
      limit 31 offset least(greatest(coalesce(p_offset,0),0),1000000)) s
  )
  select jsonb_build_object('items',items-30,'hasMore',jsonb_array_length(items)>30,'available',true,
    'manualCount',(select count(*) from matches where manual_target is not null),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
  from page;
$$;

create function public.home_media_inventory_files(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_media_owner_files(p_offset,p_query,false);
end;
$$;

create or replace function public.home_media_retention_preview(p_offset integer default 0,p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return private.home_media_owner_files(p_offset,p_query,true);
end;
$$;

-- The existing runner still revalidates selected identities against this manifest.
create or replace function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  return (select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    from private.home_media_inactivity_inventory() r
    join private.home_media_items i on i.bucket=r.bucket and i.name=r.name and i.source='unused_listing' and i.state='retained'
    left join public.properties p on p.id=r.listing_id
    where r.reason in ('waiting','eligible') and strpos(lower(concat_ws(' ', r.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0);
end;
$$;

revoke all on function private.home_media_file_states(text,text,boolean),private.home_media_owner_files(integer,text,boolean),
  public.home_media_inventory_files(integer,text) from public,anon,authenticated,service_role;
grant execute on function public.home_media_inventory_files(integer,text) to authenticated;
notify pgrst,'reload schema';
commit;

-- Migration: 20261127173831_home_media_page_first_inventory.sql
begin;

create type private.home_media_reference_key as (bucket text,name text);

-- Keep the same embedded URLs, direct URLs, scoped keys and aliases. Walk the
-- JSON scalars once and send only possible URLs or scoped keys to the decoders.
create or replace function private.home_media_document_evidence(p_doc jsonb) returns table(bucket text,name text)
language sql immutable set search_path='' as $$
  with scalars as materialized (
    select distinct value #>> '{}' as value
    from jsonb_path_query(p_doc,'strict $.** ? (@.type() == "string")') value
  ), direct_photos as materialized (
    select case when starts_with(s.value,'https://') or starts_with(s.value,'http://')
      then private.home_photo_key(s.value,null) end as name from scalars s
  ), raw_values as (
    select s.value from scalars s
    union select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_metadata')='object' then p_doc->'image_metadata' end) key
    union select key from jsonb_object_keys(case when jsonb_typeof(p_doc->'image_filenames')='object' then p_doc->'image_filenames' end) key
  ), scoped_keys as materialized (
    select r.value,case
      when left(r.value,20) ilike 'properties/listings/' then
        case when private.home_media_scope_id('property-media',r.value) is not null then 'property-media' end
      when strpos(r.value,'/')=37 then
        case when private.home_media_scope_id('listing-videos',r.value) is not null then 'listing-videos' end
      end bucket
    from raw_values r
  )
  select l.bucket,l.name from private.home_listing_storage_links(p_doc::text) l where l.name is not null
  union select 'property-media',p.name from direct_photos p where p.name is not null
  union select k.bucket,coalesce(private.home_photo_key('https://key.invalid/storage/v1/object/public/property-media/'||k.value,null),k.value)
    from scoped_keys k where k.bucket is not null
  union select null::text,lower(btrim(s.value)) from scalars s where length(s.value) between 1 and 1024;
$$;

create function private.home_media_reference_snapshot() returns private.home_media_reference_key[]
language sql stable set search_path='' as $$
  select coalesce(array_agg(row(r.bucket,r.name)::private.home_media_reference_key),'{}')
  from (
    select distinct l.bucket,l.name
    from private.home_media_reference_documents() d
    cross join lateral private.home_media_document_evidence(d) l
  ) r;
$$;

create function private.home_media_pending_upload_keys() returns table(bucket text,name text)
language plpgsql stable set search_path='' as $$
begin
  if to_regclass('storage.s3_multipart_uploads') is not null then
    return query execute
      'select distinct bucket_id,key from storage.s3_multipart_uploads where bucket_id in (''property-media'',''listing-videos'')';
  end if;
end;
$$;

-- A NULL ID list means all matching objects, as used by the hourly observation.
-- A supplied list restricts all detail work. The worker builds its own snapshot.
create function private.home_media_file_states_batch(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_references private.home_media_reference_key[]
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with objects as materialized (
    select o.*,private.home_media_scope_id(o.bucket_id,o.name) as listing_id
    from storage.objects o
    where o.bucket_id in ('property-media','listing-videos')
      and (p_ids is null or o.id=any(p_ids))
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
      and (not p_scoped_only or private.home_media_scope_id(o.bucket_id,o.name) is not null)
  ), refs as materialized (
    select * from unnest(coalesce(p_references,case when exists(select 1 from objects)
      then private.home_media_reference_snapshot() else '{}' end))
  ), pending_uploads as materialized (
    select * from private.home_media_pending_upload_keys() where exists(select 1 from objects)
  ), edit_keys as materialized (
    select distinct e.key
    from private.home_media_edit_checkpoints c cross join lateral jsonb_array_elements_text(c.links) e(key)
    where exists(select 1 from objects)
  ), legacy_keys as materialized (
    select m.bucket,m.name from private.home_listing_deletion_media m
    union select 'property-media',r.old_key from private.property_photo_renames r
    union select 'property-media',r.new_key from private.property_photo_renames r
  ), observed as materialized (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or u.name is not null then 'active_upload'
        when e.key is not null then 'editing_session'
        when link.name is not null then 'reference'
        when coalesce(full_key.name,filename.name,original.name) is not null then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when legacy.name is not null then 'legacy_lifecycle'
        when b.id is null or coalesce(to_jsonb(b)->>'versioning_status','DISABLED')<>'DISABLED'
          or coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
          or coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
          or to_jsonb(o)->>'archived_at' is not null
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when o.listing_id is null then 'outside_listing_scope'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state,link.name is not null as saved_reference
    from objects o left join public.properties p on p.id=o.listing_id
    left join storage.buckets b on b.id=o.bucket_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join pending_uploads u on u.bucket=o.bucket_id and u.name=o.name
    left join edit_keys e on e.key=o.bucket_id||'/'||o.name
    left join legacy_keys legacy on legacy.bucket=o.bucket_id and legacy.name=o.name
    left join refs link on link.bucket=o.bucket_id and link.name=o.name
    left join refs full_key on full_key.bucket is null and full_key.name=lower(o.name)
    left join refs filename on filename.bucket is null and filename.name=lower(regexp_replace(o.name,'^.*/',''))
    left join refs original on original.bucket is null and original.name=lower(btrim(o.user_metadata->>'original_filename'))
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end,o.saved_reference
  from observed o;
$$;

create or replace function private.home_media_file_states(p_bucket text,p_name text,p_scoped_only boolean)
returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  select * from private.home_media_file_states_batch(p_bucket,p_name,p_scoped_only,null,null);
$$;

-- Start with the retained ledger rows, bound to the still-current Storage identity.
create function private.home_media_retained_observations() returns setof private.home_media_items
language sql stable set search_path='' as $$
  select i.* from private.home_media_items i
  join storage.objects o on o.bucket_id=i.bucket and o.name=i.name
    and o.id=i.object_id and o.version is not distinct from i.object_version
  where i.source='unused_listing' and i.state='retained'
    and private.home_media_scope_id(i.bucket,i.name) is not null;
$$;

create or replace function private.home_media_owner_files(p_offset integer,p_query text,p_scoped_only boolean) returns jsonb
language sql stable set search_path='' as $$
  with args as (
    select lower(left(btrim(coalesce(p_query,'')),120)) needle,
      least(greatest(coalesce(p_offset,0),0),1000000) skip
  ), listing_links as materialized (
    select distinct on (l.bucket,l.name) l.bucket,l.name,p.id
    from public.properties p
    cross join lateral private.home_media_document_evidence(private.home_media_listing_fields(p)) l
    where not p_scoped_only and l.bucket is not null
    order by l.bucket,l.name,p.listing_code,p.id
  ), catalogue as materialized (
    select o.bucket_id bucket,o.name,o.id,private.home_media_scope_id(o.bucket_id,o.name) listing_id
    from storage.objects o where o.bucket_id in ('property-media','listing-videos')
  ), matches as materialized (
    select o.*,p.listing_code,p.title_en as listing_title_en,p.title_vi as listing_title_vi
    from catalogue o
    left join listing_links l on o.listing_id is null and l.bucket=o.bucket and l.name=o.name
    left join public.properties p on p.id=coalesce(o.listing_id,l.id)
    cross join args a
    where (not p_scoped_only or o.listing_id is not null)
      and strpos(lower(concat_ws(' ',o.name,p.listing_code,p.title_en,p.title_vi)),a.needle)>0
  ), reference_snapshot as materialized (
    select case when exists(select 1 from matches) then private.home_media_reference_snapshot() else '{}' end as keys
  ), observations as materialized (
    select i.* from private.home_media_retained_observations() i join matches m on m.id=i.object_id
  ), candidate_states as materialized (
    select r.* from (select array_agg(object_id) ids from observations) o cross join reference_snapshot f
    cross join lateral private.home_media_file_states_batch(null,null,true,coalesce(o.ids,'{}'),f.keys) r
    where o.ids is not null
  ), verified as materialized (
    select i.id,i.object_id,private.home_media_unused_ticket(i) as ticket
    from observations i join candidate_states s on s.object_id=i.object_id
    where s.reason in ('waiting','eligible')
  ), lookahead as materialized (
    select m.*,not p_scoped_only and v.id is not null as priority,v.ticket as manual_target
    from matches m left join verified v on v.object_id=m.id
    order by priority desc,m.bucket,m.name
    limit 31 offset (select skip from args)
  ), page as materialized (
    select * from lookahead order by priority desc,bucket,name limit 30
  ), details as (
    select s.* from candidate_states s join page p on p.id=s.object_id
    union all
    select r.*
    from (select array_agg(p.id) ids from page p
      where not exists(select 1 from candidate_states s where s.object_id=p.id)) remaining
    cross join reference_snapshot f
    cross join lateral private.home_media_file_states_batch(null,null,p_scoped_only,coalesce(remaining.ids,'{}'),f.keys) r
    where remaining.ids is not null
  ), result as (
    select coalesce(jsonb_agg(to_jsonb(s)-'priority' order by s.priority desc,s.bucket,s.name),'[]') items
    from (
      select r.bucket,r.name,r.bytes,r.listing_id,p.listing_code,r.object_id,r.object_version,
        r.reason,r.eligible_at,r.legacy_expiry,r.saved_reference,p.listing_title_en,p.listing_title_vi,
        r.reason='eligible' and c.permanent_enabled and c.listing_inactivity_enabled as scheduled_eligible,
        p.manual_target,p.priority
      from page p join details r on r.object_id=p.id cross join private.home_media_control c where c.singleton
    ) s
  )
  select jsonb_build_object('items',items,'hasMore',(select count(*)>30 from lookahead),'available',true,
    'manualCount',(select count(*) from verified),
    'automatic',(select permanent_enabled and listing_inactivity_enabled from private.home_media_control where singleton))
  from result;
$$;

-- Select-all uses the same live classification over the retained candidates.
create or replace function public.home_media_retention_manifest(p_query text default '') returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_home_photo_owner();
  with observations as materialized (
    select i.* from private.home_media_retained_observations() i
    left join public.properties p on p.id=private.home_media_scope_id(i.bucket,i.name)
    where strpos(lower(concat_ws(' ',i.name,p.listing_code,p.title_en,p.title_vi)),
      lower(left(btrim(coalesce(p_query,'')),120)))>0
  ), ids as (select array_agg(object_id) value from observations)
  select jsonb_build_object('items',coalesce(jsonb_agg(private.home_media_unused_ticket(i) order by i.name,i.id),'[]'))
    into result
  from ids cross join lateral private.home_media_file_states_batch(null,null,true,coalesce(ids.value,'{}'),null) s
  join observations i on i.object_id=s.object_id
  where s.reason in ('waiting','eligible');
  return result;
end;
$$;

revoke all on function private.home_media_reference_snapshot(),private.home_media_pending_upload_keys(),
  private.home_media_file_states_batch(text,text,boolean,uuid[],private.home_media_reference_key[]),
  private.home_media_retained_observations() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
-- Migration: 20261127203648_home_media_verify_unused.sql
-- The same bounded observation is available to the Owner and the hourly worker.
-- Only the unused-listing ledger and its progress record are written here.
begin;

create table private.home_media_observation (
  singleton boolean primary key default true check (singleton),
  state text not null default 'idle' check (state in ('idle','running','complete','failed')),
  cursor_bucket text, cursor_name text,
  checked integer not null default 0, total integer not null default 0,
  recorded integer not null default 0, reset_count integer not null default 0,
  started_at timestamptz, last_successful_at timestamptz, error text
);
alter table private.home_media_observation enable row level security;
revoke all on private.home_media_observation from public,anon,authenticated,service_role;
insert into private.home_media_observation(singleton) values(true);

create function private.home_media_observation_progress(p_status text default null) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('status',coalesce(p_status,state),'checked',checked,'total',total,
    'recorded',recorded,'reset',reset_count,'startedAt',started_at,'lastSuccessfulAt',last_successful_at,'error',error)
  from private.home_media_observation where singleton;
$$;

create function private.home_media_observe_batch(p_limit integer default 1000) returns jsonb
language plpgsql set search_path='' as $$
declare
  progress private.home_media_observation;
  batch_limit integer:=least(greatest(coalesce(p_limit,1000),1),1000);
  remaining integer; batch_checked integer; batch_recorded integer; batch_reset integer;
  error_code text;
begin
  begin
    select * into strict progress from private.home_media_observation where singleton for update nowait;
    if exists(select 1 from private.home_media_control where singleton and lease_until>now()) then
      return private.home_media_observation_progress('busy');
    end if;
    perform private.lock_home_listing_media_snapshot();
    perform private.home_media_lock_listing_inactivity();
  exception when lock_not_available then
    return private.home_media_observation_progress('busy');
  end;

  if progress.state in ('idle','complete') then
    progress.cursor_bucket:=null;
    progress.cursor_name:=null;
    progress.checked:=0;
    progress.total:=0;
    progress.recorded:=0;
    progress.reset_count:=0;
    progress.started_at:=clock_timestamp();
  end if;

  begin
    -- Include old ledger keys to clear timers for missing or replaced objects.
    with remaining_keys as materialized (
      select o.bucket_id bucket,o.name from storage.objects o
      where o.bucket_id in ('property-media','listing-videos')
        and (progress.cursor_bucket is null or (o.bucket_id,o.name)>(progress.cursor_bucket,progress.cursor_name))
        and private.home_media_scope_id(o.bucket_id,o.name) is not null
      union
      select i.bucket,i.name from private.home_media_items i
      where i.source='unused_listing' and i.state='retained'
        and (progress.cursor_bucket is null or (i.bucket,i.name)>(progress.cursor_bucket,progress.cursor_name))
    ), batch as materialized (
      select k.bucket,k.name from remaining_keys k order by k.bucket,k.name limit batch_limit
    ), unused as materialized (
      select s.* from private.home_media_file_states_batch(null,null,true,coalesce((
        select array_agg(o.id) from batch b join storage.objects o on o.bucket_id=b.bucket and o.name=b.name
      ),'{}'),null) s where s.reason in ('awaiting_observation','waiting','eligible')
    ), reset as (
      delete from private.home_media_items i using batch b
      where i.bucket=b.bucket and i.name=b.name and i.source='unused_listing' and i.state='retained'
        and not exists(select 1 from unused s where s.bucket=i.bucket and s.name=i.name)
      returning 1
    ), recorded as (
      insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
      select s.bucket,s.name,'unused_listing',s.listing_id,s.object_id,s.object_version,s.bytes,'retained',now(),now()+interval '96 hours'
      from unused s where s.reason='awaiting_observation'
      on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
        object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
        upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
      where home_media_items.source='unused_listing' and home_media_items.state='retained'
        or home_media_items.source='upload' and home_media_items.state in ('uploading','retained')
      returning 1
    )
    select (select count(*) from remaining_keys),(select count(*) from batch),
      (select count(*) from recorded),(select count(*) from reset),last.bucket,last.name
    into remaining,batch_checked,batch_recorded,batch_reset,progress.cursor_bucket,progress.cursor_name
    from (values (true)) seed(one) left join lateral (select b.bucket,b.name from batch b order by b.bucket desc,b.name desc limit 1) last on true;

    progress.total:=progress.checked+remaining;
    progress.checked:=progress.checked+batch_checked;
    progress.recorded:=progress.recorded+batch_recorded;
    progress.reset_count:=progress.reset_count+batch_reset;
    progress.state:=case when remaining=batch_checked then 'complete' else 'running' end;
    if progress.state='complete' then progress.last_successful_at:=clock_timestamp(); end if;
  exception
    when query_canceled then error_code:='observation_timeout';
    when lock_not_available then return private.home_media_observation_progress('busy');
    when others then
      raise log 'Gary Home unused media observation failed with SQLSTATE %',sqlstate;
      error_code:='observation_failed';
  end;

  update private.home_media_observation set state=case when error_code is null then progress.state else 'failed' end,
    cursor_bucket=progress.cursor_bucket,cursor_name=progress.cursor_name,checked=progress.checked,total=progress.total,
    recorded=progress.recorded,reset_count=progress.reset_count,started_at=progress.started_at,
    last_successful_at=progress.last_successful_at,error=error_code where singleton;
  return private.home_media_observation_progress();
end;
$$;

create function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_observe_batch(); end if;
  return private.home_media_observation_progress();
end;
$$;

create function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_observe_batch();
$$;

-- Keep legacy staging and claims independent of observation failures.
create or replace function public.home_media_claim(p_actor uuid default null,p_item uuid default null,p_expiry timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctrl private.home_media_control; job uuid:=gen_random_uuid();
begin
  if p_actor is not null then
    perform set_config('request.jwt.claim.sub',p_actor::text,true);
    perform private.require_home_photo_owner();
  end if;
  if p_item is not null and p_actor is null then
    raise exception 'listing_cleanup.forbidden' using errcode='42501'; end if;
  select * into ctrl from private.home_media_control where singleton for update;
  if p_item is not null and not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
  if ctrl.lease_until>now() then return jsonb_build_object('status','busy'); end if;
  perform private.lock_home_listing_media_snapshot();
  if p_item is null then
    if not ctrl.permanent_enabled then return jsonb_build_object('status','disabled'); end if;
    perform private.home_media_lock_listing_inactivity();
    perform private.home_media_stage_candidates();
  elsif not exists(select 1 from private.home_media_items i where i.id=p_item and i.expires_at=p_expiry
    and i.state in ('candidate','trashed') and (i.upload_until is null or i.upload_until<=now())
    and not exists(select 1 from private.home_media_review_holds h where h.bucket=i.bucket and h.name=i.name)
    and not private.home_media_edit_referenced(i.bucket,i.name)) then
    raise exception 'listing_cleanup.purge_unavailable' using errcode='PT409';
  end if;
  update private.home_media_runs set finished_at=now(),failed=greatest(failed,attempted-removed)
    where id=ctrl.lease and finished_at is null;
  update private.home_media_control set lease=job,lease_until=now()+interval '3 minutes' where singleton;
  insert into private.home_media_runs(id,actor,early_item,early_expiry) values(job,p_actor,p_item,p_expiry);
  return jsonb_build_object('status','ok','id',job,'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',i.id,'replacementKey',i.replacement_key,
      'replacementSha256',i.replacement_sha256) order by i.expires_at,i.id) from (
      select id,expires_at,replacement_key,replacement_sha256 from private.home_media_items m
      where (p_item is not null and id=p_item) or (p_item is null and (retry_after is null or retry_after<=now())
        and not exists(select 1 from private.home_media_review_holds h where h.bucket=m.bucket and h.name=m.name)
        and not private.home_media_edit_referenced(m.bucket,m.name) and (
        ((state='trashed' or (source='unused_listing' and state='retained' and ctrl.listing_inactivity_enabled))
          and expires_at<=now() and attempts<4) or
        (state in ('deleting','review') and deletion_started_at is not null and (
          (state='deleting' and attempts<4 and (source<>'unused_listing' or (ctrl.listing_inactivity_enabled and expires_at<=now()))) or not exists(select 1 from storage.objects o where o.bucket_id=m.bucket and o.name=m.name)
        ))
      )) order by expires_at,id limit 20
    ) i
  ),'[]'::jsonb));
end;
$$;

revoke all on function private.home_media_observation_progress(text),private.home_media_observe_batch(integer),
  public.home_media_observation(boolean),public.home_media_observe_hourly() from public,anon,authenticated,service_role;
grant execute on function public.home_media_observation(boolean) to authenticated;
grant execute on function public.home_media_observe_hourly() to service_role;
notify pgrst,'reload schema';
commit;

-- Migration: 20261128054200_home_media_bounded_observation.sql
begin;

alter table private.home_media_observation add column reference_digest bytea,
  add column reference_lookup jsonb;

-- Build two membership maps from the same normalized evidence as live checks.
create function private.home_media_reference_lookup(p_keys private.home_media_reference_key[]) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object(
    'exact',coalesce(jsonb_object_agg(k.bucket||'/'||k.name,true) filter(where k.bucket is not null),'{}'),
    'aliases',coalesce(jsonb_object_agg(k.name,true) filter(where k.bucket is null),'{}'))
  from unnest(p_keys) k where k.name is not null;
$$;

create function private.home_media_file_states_indexed(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_lookup jsonb
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  with candidates as (
    select o.* from storage.objects o where p_ids is not null and o.id=any(p_ids)
    union all
    select o.* from storage.objects o where p_ids is null
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
  ), objects as materialized (
    select o.*,private.home_media_scope_id(o.bucket_id,o.name) as listing_id
    from candidates o where o.bucket_id in ('property-media','listing-videos')
      and (p_bucket is null or o.bucket_id=p_bucket) and (p_name is null or o.name=p_name)
      and (not p_scoped_only or private.home_media_scope_id(o.bucket_id,o.name) is not null)
  ), evidence as materialized (
    select coalesce(p_lookup,private.home_media_reference_lookup(private.home_media_reference_snapshot())) as keys
    where exists(select 1 from objects)
  ), refs as materialized (
    select keys->'exact' as exact,keys->'aliases' as aliases from evidence
  ), pending_uploads as materialized (
    select * from private.home_media_pending_upload_keys() where exists(select 1 from objects)
  ), legacy_keys as materialized (
    select m.bucket,m.name from private.home_listing_deletion_media m
    union select 'property-media',r.old_key from private.property_photo_renames r
    union select 'property-media',r.new_key from private.property_photo_renames r
  ), observed as materialized (
    select o.bucket_id,o.name,o.listing_id,p.listing_code,o.id,o.version,
      case when o.metadata->>'size' ~ '^[0-9]{1,15}$' then (o.metadata->>'size')::bigint end bytes,
      case
        when h.name is not null then h.reason
        when i.upload_until>now() or u.name is not null then 'active_upload'
        when private.home_media_edit_referenced(o.bucket_id,o.name) then 'editing_session'
        when refs.exact ? (o.bucket_id||'/'||o.name) then 'reference'
        when refs.aliases ? lower(o.name) or refs.aliases ? lower(regexp_replace(o.name,'^.*/',''))
          or refs.aliases ? lower(btrim(o.user_metadata->>'original_filename')) then 'filename_match'
        when i.source='unused_listing' and i.state='deleting' then 'removing'
        when i.id is not null and not (i.source='unused_listing' and i.state='retained'
          or i.source='upload' and i.state in ('uploading','retained')) then 'legacy_lifecycle'
        when legacy.name is not null then 'legacy_lifecycle'
        when b.id is null or coalesce(to_jsonb(b)->>'versioning_status','DISABLED')<>'DISABLED'
          or coalesce((to_jsonb(o)->>'is_versioned')::boolean,false)
          or coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)
          or to_jsonb(o)->>'archived_at' is not null
          or (i.source='upload' and i.upload_owner::text is distinct from o.owner_id::text) then 'identity'
        when o.listing_id is null then 'outside_listing_scope'
        when i.source='unused_listing' and i.object_id=o.id and i.object_version is not distinct from o.version then
          case when i.expires_at<=now() then 'eligible' else 'waiting' end
        else 'awaiting_observation' end reason,
      i.expires_at,i.source,i.state,refs.exact ? (o.bucket_id||'/'||o.name) as saved_reference
    from objects o cross join refs left join public.properties p on p.id=o.listing_id
    left join storage.buckets b on b.id=o.bucket_id
    left join private.home_media_items i on i.bucket=o.bucket_id and i.name=o.name
    left join private.home_media_review_holds h on h.bucket=o.bucket_id and h.name=o.name
    left join pending_uploads u on u.bucket=o.bucket_id and u.name=o.name
    left join legacy_keys legacy on legacy.bucket=o.bucket_id and legacy.name=o.name
  )
  select o.bucket_id,o.name,o.listing_id,o.listing_code,o.id,o.version,o.bytes,o.reason,
    case when o.reason in ('waiting','eligible','removing') then o.expires_at end,
    case when o.source<>'unused_listing' and o.state in ('candidate','trashed','deleting') then o.expires_at end,o.saved_reference
  from observed o;
$$;

-- Existing inventory and removal callers still get fresh evidence by default.
create or replace function private.home_media_file_states_batch(
  p_bucket text,p_name text,p_scoped_only boolean,p_ids uuid[],p_references private.home_media_reference_key[]
) returns table(bucket text,name text,listing_id uuid,listing_code text,object_id uuid,object_version text,bytes bigint,
  reason text,eligible_at timestamptz,legacy_expiry timestamptz,saved_reference boolean)
language sql stable set search_path='' as $$
  select * from private.home_media_file_states_indexed(p_bucket,p_name,p_scoped_only,p_ids,
    case when p_references is not null then private.home_media_reference_lookup(p_references) end);
$$;

-- Compare the actual saved documents under the existing snapshot locks. Only
-- changed documents require decoding links and rebuilding the membership maps.
create function private.home_media_reference_digest() returns bytea
language sql stable set search_path='' as $$
  with hashes as materialized (
    select sha256(convert_to(d::text,'UTF8')) as digest from private.home_media_reference_documents() d
  )
  select sha256(coalesce(string_agg(digest,''::bytea order by digest),''::bytea)) from hashes;
$$;

create or replace function private.home_media_observe_batch(p_limit integer default 32) returns jsonb
language plpgsql set search_path='' as $$
declare
  progress private.home_media_observation;
  batch_limit integer:=least(greatest(coalesce(p_limit,32),1),32);
  batch_keys jsonb; batch_checked integer; batch_recorded integer; batch_reset integer;
  has_more boolean; last_bucket text; last_name text;
  current_digest bytea; current_lookup jsonb; error_code text;
begin
  begin
    select * into strict progress from private.home_media_observation where singleton for update nowait;
    if exists(select 1 from private.home_media_control where singleton and lease_until>now()) then
      return private.home_media_observation_progress('busy');
    end if;
    perform private.lock_home_listing_media_snapshot();
    perform private.home_media_lock_listing_inactivity();
  exception when lock_not_available then
    return private.home_media_observation_progress('busy');
  end;

  if progress.state in ('idle','complete') then
    progress.cursor_bucket:=null;
    progress.cursor_name:=null;
    progress.checked:=0;
    progress.total:=0;
    progress.recorded:=0;
    progress.reset_count:=0;
    progress.started_at:=clock_timestamp();
  end if;

  begin
    -- Estimate the total once per pass. Resume by key, including retained rows
    -- for missing Storage objects so their old timers can still be cleared.
    if progress.checked=0 and progress.total=0 then
      select count(*) into progress.total from (
        select o.bucket_id,o.name from storage.objects o where o.bucket_id in ('property-media','listing-videos')
          and private.home_media_scope_id(o.bucket_id,o.name) is not null
        union
        select i.bucket,i.name from private.home_media_items i where i.source='unused_listing' and i.state='retained'
      ) keys;
    end if;

    with storage_page as (
      select distinct o.bucket_id as bucket,o.name from storage.objects o
      where o.bucket_id in ('property-media','listing-videos')
        and (o.bucket_id,o.name)>(coalesce(progress.cursor_bucket,''),coalesce(progress.cursor_name,''))
        and private.home_media_scope_id(o.bucket_id,o.name) is not null
      order by o.bucket_id,o.name limit batch_limit+1
    ), ledger_page as (
      select i.bucket,i.name from private.home_media_items i
      where i.source='unused_listing' and i.state='retained'
        and (i.bucket,i.name)>(coalesce(progress.cursor_bucket,''),coalesce(progress.cursor_name,''))
      order by i.bucket,i.name limit batch_limit+1
    ), page as materialized (
      select k.bucket,k.name from (select * from storage_page union select * from ledger_page) k
      order by k.bucket,k.name limit batch_limit+1
    ), batch as materialized (
      select p.bucket,p.name from page p order by p.bucket,p.name limit batch_limit
    )
    select coalesce((select jsonb_agg(to_jsonb(b)) from batch b),'[]'),(select count(*) from batch),
      (select count(*)>batch_limit from page),last.bucket,last.name
    into batch_keys,batch_checked,has_more,last_bucket,last_name
    from (values (true)) seed(one)
    left join lateral (select b.bucket,b.name from batch b order by b.bucket desc,b.name desc limit 1) last on true;

    current_digest:=progress.reference_digest;
    current_lookup:=progress.reference_lookup;
    batch_recorded:=0;
    batch_reset:=0;
    if batch_checked>0 then
      current_digest:=private.home_media_reference_digest();
      if current_lookup is null or current_digest is distinct from progress.reference_digest then
        current_lookup:=private.home_media_reference_lookup(private.home_media_reference_snapshot());
      end if;

      with batch as materialized (
        select * from jsonb_to_recordset(batch_keys) b(bucket text,name text)
      ), unused as materialized (
        select s.* from private.home_media_file_states_indexed(null,null,true,array(
          select o.id from batch b join storage.objects o on o.bucket_id=b.bucket and o.name=b.name
        ),current_lookup) s where s.reason in ('awaiting_observation','waiting','eligible')
      ), reset as (
        delete from private.home_media_items i using batch b
        where i.bucket=b.bucket and i.name=b.name and i.source='unused_listing' and i.state='retained'
          and not exists(select 1 from unused s where s.bucket=i.bucket and s.name=i.name)
        returning 1
      ), recorded as (
        insert into private.home_media_items(bucket,name,source,source_id,object_id,object_version,bytes,state,unreferenced_since,expires_at)
        select s.bucket,s.name,'unused_listing',s.listing_id,s.object_id,s.object_version,s.bytes,'retained',now(),now()+interval '96 hours'
        from unused s where s.reason='awaiting_observation'
        on conflict(bucket,name) do update set source='unused_listing',source_id=excluded.source_id,object_id=excluded.object_id,
          object_version=excluded.object_version,bytes=excluded.bytes,state='retained',hold_reason=null,upload_owner=null,
          upload_until=null,unreferenced_since=excluded.unreferenced_since,expires_at=excluded.expires_at,retry_after=null
        where home_media_items.source='unused_listing' and home_media_items.state='retained'
          or home_media_items.source='upload' and home_media_items.state in ('uploading','retained')
        returning 1
      )
      select (select count(*) from recorded),(select count(*) from reset) into batch_recorded,batch_reset;
    end if;

    update private.home_media_observation set state=case when has_more then 'running' else 'complete' end,
      cursor_bucket=coalesce(last_bucket,progress.cursor_bucket),cursor_name=coalesce(last_name,progress.cursor_name),
      checked=progress.checked+batch_checked,
      total=case when has_more then greatest(progress.total,progress.checked+batch_checked+1) else progress.checked+batch_checked end,
      recorded=progress.recorded+batch_recorded,reset_count=progress.reset_count+batch_reset,started_at=progress.started_at,
      last_successful_at=case when has_more then progress.last_successful_at else clock_timestamp() end,error=null,
      reference_digest=current_digest,reference_lookup=current_lookup where singleton;
  exception
    when query_canceled then error_code:='observation_timeout';
    when lock_not_available then return private.home_media_observation_progress('busy');
    when others then
      raise log 'Gary Home unused media observation failed with SQLSTATE %',sqlstate;
      error_code:='observation_failed';
  end;

  if error_code is not null then
    update private.home_media_observation set state='failed',error=error_code,
      cursor_bucket=progress.cursor_bucket,cursor_name=progress.cursor_name,checked=progress.checked,total=progress.total,
      recorded=progress.recorded,reset_count=progress.reset_count,started_at=progress.started_at where singleton;
  end if;
  return private.home_media_observation_progress();
end;
$$;

create or replace function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_observe_batch(32); end if;
  return private.home_media_observation_progress();
end;
$$;

create or replace function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_observe_batch(32);
$$;

revoke all on function private.home_media_reference_lookup(private.home_media_reference_key[]),
  private.home_media_reference_digest(),private.home_media_file_states_indexed(text,text,boolean,uuid[],jsonb)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;

-- Migration: 20261128061749_home_media_observation_cycles.sql
begin;

alter table private.home_media_observation add column cycle bigint not null default 0;
update private.home_media_observation set cycle=1 where state<>'idle';

create or replace function private.home_media_observation_progress(p_status text default null) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('status',coalesce(p_status,state),'cycle',cycle,'checked',checked,'total',total,
    'recorded',recorded,'reset',reset_count,'startedAt',started_at,'lastSuccessfulAt',last_successful_at,'error',error)
  from private.home_media_observation where singleton;
$$;

-- All callers share the existing checkpoint lock. The cycle and checked count
-- make a replay or stale continuation a read, including after completion.
create function private.home_media_advance_observation(p_cycle bigint,p_checked integer,p_start boolean) returns jsonb
language plpgsql set search_path='' as $$
declare prior private.home_media_observation; result jsonb;
begin
  begin
    select * into strict prior from private.home_media_observation where singleton for update nowait;
  exception when lock_not_available then
    return private.home_media_observation_progress('busy');
  end;

  if p_cycle is not null and (p_cycle<>prior.cycle or p_checked<>prior.checked
    or p_start is distinct from (prior.state in ('idle','complete'))) then
    return private.home_media_observation_progress();
  end if;

  result:=private.home_media_observe_batch(32);
  if result->>'status'<>'busy' and prior.state in ('idle','complete') then
    update private.home_media_observation set cycle=prior.cycle+1 where singleton;
    return private.home_media_observation_progress();
  end if;
  return result;
end;
$$;

create function public.home_media_observation_step(p_cycle bigint,p_checked integer,p_start boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_cycle is null or p_cycle<0 or p_checked is null or p_checked<0 or p_start is null then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  return private.home_media_advance_observation(p_cycle,p_checked,p_start);
end;
$$;

-- Keep the previous UI and deployed worker compatible during rollout.
create or replace function public.home_media_observation(p_verify boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_home_photo_owner();
  if p_verify is true then return private.home_media_advance_observation(null,null,true); end if;
  return private.home_media_observation_progress();
end;
$$;

create or replace function public.home_media_observe_hourly() returns jsonb
language sql security definer set search_path='' as $$
  select private.home_media_advance_observation(null,null,true);
$$;

create function public.home_media_observe_hourly_step(p_cycle bigint,p_checked integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_cycle is null or p_cycle<0 or p_checked is null or p_checked<0 then
    raise exception 'listing_cleanup.invalid_manifest' using errcode='22023';
  end if;
  return private.home_media_advance_observation(p_cycle,p_checked,false);
end;
$$;

revoke all on function private.home_media_advance_observation(bigint,integer,boolean),
  public.home_media_observation_step(bigint,integer,boolean),public.home_media_observe_hourly_step(bigint,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.home_media_observation_step(bigint,integer,boolean) to authenticated;
grant execute on function public.home_media_observe_hourly_step(bigint,integer) to service_role;

notify pgrst,'reload schema';
commit;
