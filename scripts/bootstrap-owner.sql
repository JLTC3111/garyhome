-- Run with psql -v owner_email='your@email.com' after creating/inviting that
-- Auth user in the selected Gary Home Supabase project. Never grants access
-- based on user-editable metadata. No Supabase account password is required.
insert into public.team_members (user_id,role)
select id,'owner' from auth.users where lower(email) = lower(:'owner_email')
on conflict (user_id) do update set role = excluded.role;

select m.user_id,m.role from public.team_members m
join auth.users u on u.id = m.user_id
where lower(u.email) = lower(:'owner_email');
