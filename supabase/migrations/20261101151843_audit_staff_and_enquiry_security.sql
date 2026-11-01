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
