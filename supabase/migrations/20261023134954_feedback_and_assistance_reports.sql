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
