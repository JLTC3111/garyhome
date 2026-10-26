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
