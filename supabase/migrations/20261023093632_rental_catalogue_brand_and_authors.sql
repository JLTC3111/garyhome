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
