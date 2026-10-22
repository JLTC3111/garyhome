begin;

create function private.valid_staff_domains(domains text[]) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(cardinality(domains) between 1 and 10 and not exists (
    select 1 from unnest(domains) as entry(domain)
    where domain is null or domain <> lower(btrim(domain))
      or domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$'
  ), false);
$$;
revoke all on function private.valid_staff_domains(text[]) from public,anon,authenticated;

create table public.staff_settings (
  id text primary key default 'main' check (id = 'main'),
  email_domains text[] not null check (private.valid_staff_domains(email_domains))
);
alter table public.staff_settings enable row level security;
revoke all on public.staff_settings from public, anon, authenticated;
grant select on public.staff_settings to anon, authenticated;
create policy staff_domain_public on public.staff_settings for select to anon, authenticated using (true);
insert into public.staff_settings(id,email_domains) values ('main',array['garyhome.com','icue.vn']);

alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check (role in ('owner','admin','editor'));
alter table public.team_members add column email text;
alter table public.team_members add column display_name text not null default '' check (char_length(display_name) <= 120);
alter table public.team_members add column active boolean not null default true;
alter table public.team_members add column bootstrap_owner boolean not null default false;
alter table public.team_members add column assigned_by uuid references auth.users(id) on delete set null;
alter table public.team_members add column updated_at timestamptz not null default now();
update public.team_members m set email = lower(u.email), bootstrap_owner = m.role = 'owner'
  from auth.users u where u.id = m.user_id;
create unique index team_members_email_idx on public.team_members(email) where email is not null;

-- Authorization reads the current verified Auth email and a server-assigned
-- membership. Changing an email, disabling a member, or changing the company
-- domain takes effect in RLS even while an old access token is still valid.
-- Existing owners are preserved so migration cannot strand the project owner.
create function private.staff_role() returns text language sql stable
security definer set search_path = '' as $$
  select m.role from public.team_members m
  join auth.users u on u.id = m.user_id
  join public.staff_settings s on s.id = 'main'
  where auth.uid() is not null and m.user_id = auth.uid() and m.active
    and u.email_confirmed_at is not null and m.email = lower(u.email)
    and ((m.role = 'owner' and m.bootstrap_owner) or split_part(m.email,'@',2) = any(s.email_domains));
$$;
revoke all on function private.staff_role() from public, anon;
grant execute on function private.staff_role() to authenticated;

create or replace function private.is_editor() returns boolean language sql stable
security definer set search_path = '' as $$
  select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','editor'), false);
$$;

drop policy members_read_self on public.team_members;
create policy members_read_self on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) and (select private.staff_role()) is not null);

-- Privileged functions stay in the non-exposed schema. Public RPC wrappers
-- are invokers; every privileged entry point independently checks auth.uid().
create function private.find_staff_account(target_email text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; target_role text; company_domains text[];
begin
  actor_role := private.staff_role();
  if auth.uid() is null or actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  if assigned_role is null or assigned_role not in ('admin','editor') or (actor_role = 'admin' and assigned_role <> 'editor') then
    raise exception 'Only the owner can assign administrator access.' using errcode = '42501';
  end if;
  select email_domains into company_domains from public.staff_settings where id = 'main';
  if target_email is null or char_length(target_email) > 254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    or not coalesce(split_part(lower(btrim(target_email)),'@',2) = any(company_domains), false) then
    raise exception 'Use an email address at the company domain.' using errcode = '23514';
  end if;
  select id into target_id from auth.users where lower(email) = lower(btrim(target_email));
  select role into target_role from public.team_members where user_id = target_id;
  if target_id = auth.uid() or target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'You cannot change your own access or a protected account.' using errcode = '42501';
  end if;
  return target_id;
end;
$$;

create function private.assign_staff_account(target_email text, full_name text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(target_email)),0));
  target_id := private.find_staff_account(target_email, assigned_role);
  if target_id is null then raise exception 'Create the Auth account before assigning staff access.' using errcode = 'P0002'; end if;
  if full_name is null or char_length(btrim(full_name)) not between 2 and 120 then
    raise exception 'Enter the staff member''s name.' using errcode = '23514';
  end if;
  insert into public.team_members(user_id,email,display_name,role,active,assigned_by)
  values (target_id,lower(btrim(target_email)),btrim(full_name),assigned_role,true,auth.uid())
  on conflict (user_id) do update set email = excluded.email, display_name = excluded.display_name,
    role = excluded.role, active = true, assigned_by = auth.uid(), updated_at = now();
  return target_id;
end;
$$;

create function private.set_staff_access(target_user_id uuid, assigned_role text, enabled boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare member public.team_members; checked_id uuid;
begin
  if auth.uid() is null or coalesce(private.staff_role(),'') not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  select * into member from public.team_members where user_id = target_user_id;
  if member.user_id is null then raise exception 'Staff account not found.' using errcode = 'P0002'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.email,0));
  checked_id := private.find_staff_account(member.email, assigned_role);
  if checked_id is distinct from target_user_id or enabled is null then
    raise exception 'The company email changed. Assign the account again.' using errcode = '23514';
  end if;
  update public.team_members set role = assigned_role, active = enabled, assigned_by = auth.uid(), updated_at = now()
    where user_id = target_user_id;
  return target_user_id;
end;
$$;

create function private.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(private.staff_role(),'') not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  return query select m.user_id,m.email,m.display_name,m.role,m.active,u.email_confirmed_at is not null,m.created_at,m.updated_at
    from public.team_members m join auth.users u on u.id = m.user_id
    where m.email is not null and (after_email is null or m.email > after_email)
    order by m.email limit 51;
end;
$$;

create function public.find_staff_account(target_email text, assigned_role text) returns uuid
language sql security invoker set search_path = '' as $$ select private.find_staff_account(target_email,assigned_role); $$;
create function public.assign_staff_account(target_email text, full_name text, assigned_role text) returns uuid
language sql security invoker set search_path = '' as $$ select private.assign_staff_account(target_email,full_name,assigned_role); $$;
create function public.set_staff_access(target_user_id uuid, assigned_role text, enabled boolean) returns uuid
language sql security invoker set search_path = '' as $$ select private.set_staff_access(target_user_id,assigned_role,enabled); $$;
create function public.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language sql security invoker set search_path = '' as $$ select * from private.list_staff_accounts(after_email); $$;

revoke all on function private.find_staff_account(text,text),private.assign_staff_account(text,text,text),
  private.set_staff_access(uuid,text,boolean),private.list_staff_accounts(text),
  public.find_staff_account(text,text),public.assign_staff_account(text,text,text),
  public.set_staff_access(uuid,text,boolean),public.list_staff_accounts(text) from public,anon;
grant execute on function private.find_staff_account(text,text),private.assign_staff_account(text,text,text),
  private.set_staff_access(uuid,text,boolean),private.list_staff_accounts(text),
  public.find_staff_account(text,text),public.assign_staff_account(text,text,text),
  public.set_staff_access(uuid,text,boolean),public.list_staff_accounts(text) to authenticated;

commit;
