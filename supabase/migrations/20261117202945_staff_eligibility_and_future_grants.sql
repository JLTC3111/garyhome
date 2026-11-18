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
