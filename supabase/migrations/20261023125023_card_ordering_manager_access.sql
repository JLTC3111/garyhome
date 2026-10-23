begin;
alter table public.team_members drop constraint team_members_role_check;
alter table public.team_members add constraint team_members_role_check check(role in ('owner','admin','manager','editor'));
create or replace function private.is_editor() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','manager','editor'),false);
$$;
create or replace function private.find_staff_account(target_email text, assigned_role text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; target_role text; company_domains text[];
begin
  actor_role := private.staff_role();
  if auth.uid() is null or actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Owner or admin access required.' using errcode = '42501';
  end if;
  if assigned_role is null or assigned_role not in ('admin','manager','editor') or (actor_role = 'admin' and assigned_role not in ('manager','editor')) then
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
create function private.can_order_properties() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin','manager'),false);
$$;
revoke all on function private.can_order_properties() from public,anon;
grant execute on function private.can_order_properties() to authenticated;

alter table public.properties add column published_at timestamptz;
update public.properties set published_at=created_at where status='published';
create function private.stamp_property_publication() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.published_at=case when new.status='published' then now() else null end;
 elsif new.status='published' and old.status<>'published' then new.published_at=now();
 else new.published_at=old.published_at; end if;
 return new;
end; $$;
revoke all on function private.stamp_property_publication() from public,anon,authenticated;
create trigger property_publication_time before insert or update on public.properties for each row execute function private.stamp_property_publication();

create function private.valid_property_order(ids uuid[]) returns boolean language sql stable security invoker set search_path='' as $$
 select ids is not null and cardinality(ids)<=500
 and cardinality(ids)=(select count(distinct id) from unnest(ids) t(id))
 and not exists(select 1 from unnest(ids) t(id) left join public.properties p on p.id=t.id
 where p.id is null or p.status<>'published' or p.listing_type<>'rent' or p.availability not in ('available','on_request'));
$$;
revoke all on function private.valid_property_order(uuid[]) from public,anon;
grant execute on function private.valid_property_order(uuid[]) to authenticated;
create table public.property_display_orders(
 scope text primary key check(scope in ('home','listings')),
 property_ids uuid[] not null default '{}',
 updated_at timestamptz not null default now()
);
alter table public.property_display_orders enable row level security;
revoke all on public.property_display_orders from public,anon,authenticated;
grant select on public.property_display_orders to anon,authenticated;
grant insert,update,delete on public.property_display_orders to authenticated;
create policy orders_public_read on public.property_display_orders for select to anon,authenticated using(true);
create policy orders_staff_insert on public.property_display_orders for insert to authenticated
 with check((select private.can_order_properties()) and private.valid_property_order(property_ids));
create policy orders_staff_update on public.property_display_orders for update to authenticated
 using((select private.can_order_properties()))
 with check((select private.can_order_properties()) and private.valid_property_order(property_ids));
create policy orders_staff_delete on public.property_display_orders for delete to authenticated using((select private.can_order_properties()));

create function public.save_property_order(order_scope text,ordered_property_ids uuid[],expected_property_ids uuid[] default null)
returns void language plpgsql security invoker set search_path='' as $$
declare current_ids uuid[];
begin
 if not private.can_order_properties() then raise exception 'Owner, admin or manager access required.' using errcode='42501'; end if;
 if order_scope is null or order_scope not in ('home','listings') or not private.valid_property_order(ordered_property_ids) then
  raise exception 'Choose current public rental listings with no duplicates.' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gary-property-order:'||order_scope,0));
 select property_ids into current_ids from public.property_display_orders where scope=order_scope;
 if expected_property_ids is not null and coalesce(current_ids,'{}'::uuid[]) is distinct from expected_property_ids then
  raise exception 'This order changed. Refresh the page before saving.' using errcode='40001'; end if;
 insert into public.property_display_orders(scope,property_ids) values(order_scope,ordered_property_ids)
 on conflict(scope) do update set property_ids=excluded.property_ids,updated_at=now();
end; $$;
revoke all on function public.save_property_order(text,uuid[],uuid[]) from public,anon;
grant execute on function public.save_property_order(text,uuid[],uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
