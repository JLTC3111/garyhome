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
