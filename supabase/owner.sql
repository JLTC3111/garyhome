-- Gary Home CMS owner setup, for the selected project's SQL Editor.
-- 1. Run setup.sql first.
-- 2. In Authentication > Users > Add user, create the email/password user
--    skycastle3@protonmail.com and enable Auto Confirm User.
--    Choose your own password; do not share it with the agent.
-- 3. Run this file in the same project's SQL Editor.

begin;

do $$
begin
  if not exists (
    select 1 from auth.users
    where lower(email) = 'skycastle3@protonmail.com'
      and email_confirmed_at is not null
  ) then
    raise exception 'Create and confirm the Auth user skycastle3@protonmail.com under Authentication > Users before running owner.sql.';
  end if;
end;
$$;

insert into public.team_members (user_id, role)
select id, 'owner'
from auth.users
where lower(email) = 'skycastle3@protonmail.com'
  and email_confirmed_at is not null
on conflict (user_id) do update set role = excluded.role;

commit;

select m.role, u.email
from public.team_members m
join auth.users u on u.id = m.user_id
where lower(u.email) = 'skycastle3@protonmail.com';
