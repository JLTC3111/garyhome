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
