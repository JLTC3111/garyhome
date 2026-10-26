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
