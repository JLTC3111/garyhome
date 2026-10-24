begin;

-- A permitted address still needs an explicit owner/admin staff assignment.
update public.staff_settings set email_domains=array_append(email_domains,'gmail.com')
where id='main' and not ('gmail.com'=any(email_domains));

create function private.is_staff_admin() returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and coalesce(private.staff_role() in ('owner','admin'),false);
$$;
revoke all on function private.is_staff_admin() from public,anon;
grant execute on function private.is_staff_admin() to authenticated;

create or replace function private.attribution_staff() returns table(user_id uuid,display_name text,role text)
language sql stable security definer set search_path='' as $$
 select m.user_id,coalesce(nullif(m.display_name,''),split_part(u.email,'@',1)),m.role::text
 from public.team_members m join auth.users u on u.id=m.user_id
 join public.staff_settings s on s.id='main'
 where private.can_order_properties() and m.active and u.email_confirmed_at is not null
 and m.email=lower(u.email)
 and (m.bootstrap_owner or lower(split_part(u.email,'@',2))=any(s.email_domains))
 order by m.display_name,m.user_id;
$$;

-- Read tracking stays with private staff notes, outside customer-facing columns.
alter table public.enquiry_notes add column read_at timestamptz;
alter table public.enquiry_notes add column read_by uuid references auth.users(id) on delete set null;
alter table public.enquiry_notes add column property_code text not null default '';
alter table public.enquiry_notes add column property_address text not null default '';
create index enquiry_notes_read_by_idx on public.enquiry_notes(read_by);

create function public.mark_enquiry_read(target_enquiry uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare property_code text; property_address text; result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501'; end if;
 select p.listing_code,p.address into property_code,property_address from public.enquiries e
 left join public.properties p on p.id=e.property_id where e.id=target_enquiry;
 if not found then raise exception 'Enquiry no longer exists' using errcode='P0002'; end if;
 insert into public.enquiry_notes(enquiry_id,notes,read_at,read_by,property_code,property_address)
 values(target_enquiry,'',now(),auth.uid(),coalesce(property_code,''),coalesce(property_address,''))
 on conflict(enquiry_id) do update set
  read_at=coalesce(public.enquiry_notes.read_at,excluded.read_at),
  read_by=case when public.enquiry_notes.read_at is null then excluded.read_by else public.enquiry_notes.read_by end,
  property_code=coalesce(nullif(public.enquiry_notes.property_code,''),excluded.property_code),
  property_address=coalesce(nullif(public.enquiry_notes.property_address,''),excluded.property_address)
 returning jsonb_build_object('read_at',enquiry_notes.read_at,'read_by',enquiry_notes.read_by,'property_code',enquiry_notes.property_code,'property_address',enquiry_notes.property_address) into result;
 return result;
end;
$$;
revoke all on function public.mark_enquiry_read(uuid) from public,anon;
grant execute on function public.mark_enquiry_read(uuid) to authenticated;

-- Keep commission evidence if an administrator removes its public listing.
alter table public.property_assistance add column property_code text not null default '';
alter table public.property_assistance add column property_address text not null default '';
update public.property_assistance a set property_code=p.listing_code,property_address=p.address
from public.properties p where p.id=a.property_id;
alter table public.property_assistance drop constraint property_assistance_property_id_fkey;
alter table public.property_assistance alter column property_id drop not null;
alter table public.property_assistance add constraint property_assistance_property_id_fkey foreign key(property_id) references public.properties(id) on delete set null;
create function private.capture_assistance_property() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 select p.listing_code,p.address into new.property_code,new.property_address from public.properties p where p.id=new.property_id;
 new.property_code:=coalesce(new.property_code,'');new.property_address:=coalesce(new.property_address,'');
 return new;
end; $$;
revoke all on function private.capture_assistance_property() from public,anon,authenticated;
create trigger capture_assistance_property before insert on public.property_assistance for each row execute function private.capture_assistance_property();

create function private.preserve_deleted_property() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.enquiry_notes(enquiry_id,notes,property_code,property_address)
 select e.id,'',old.listing_code,old.address from public.enquiries e where e.property_id=old.id
 on conflict(enquiry_id) do update set property_code=coalesce(nullif(public.enquiry_notes.property_code,''),excluded.property_code),property_address=coalesce(nullif(public.enquiry_notes.property_address,''),excluded.property_address);
 update public.property_display_orders o set property_ids=array(
  select item.id from unnest(o.property_ids) with ordinality item(id,position)
  where item.id<>old.id and exists(select 1 from public.properties p where p.id=item.id and p.status='published' and p.listing_type='rent' and p.availability in ('available','on_request'))
  order by item.position
 ) where old.id=any(o.property_ids);
 return old;
end; $$;
revoke all on function private.preserve_deleted_property() from public,anon,authenticated;
create trigger preserve_deleted_property before delete on public.properties for each row execute function private.preserve_deleted_property();

alter policy properties_editor_delete on public.properties using ((select private.is_staff_admin()));
alter policy enquiries_editor_delete on public.enquiries using ((select private.is_staff_admin()));
create function public.delete_property(target_property uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.is_staff_admin(),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 delete from public.properties where id=target_property;return true;
end; $$;
create function public.delete_enquiry(target_enquiry uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce(private.is_staff_admin(),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 delete from public.enquiries where id=target_enquiry;return true;
end; $$;
revoke all on function public.delete_property(uuid),public.delete_enquiry(uuid) from public,anon;
grant execute on function public.delete_property(uuid),public.delete_enquiry(uuid) to authenticated;

-- Membership changes use guarded definer functions in the unexposed schema.
create function private.remove_staff_access(target_user_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or not coalesce(actor_role in ('owner','admin'),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 select role into target_role from public.team_members where user_id=target_user_id for update;
 if target_user_id=auth.uid() or target_role='owner' or (actor_role='admin' and target_role='admin') then raise exception 'You cannot remove your own access or a protected account' using errcode='42501'; end if;
 delete from public.team_members where user_id=target_user_id;return true;
end; $$;
create function public.remove_staff_access(target_user_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.remove_staff_access(target_user_id); $$;
revoke all on function private.remove_staff_access(uuid),public.remove_staff_access(uuid) from public,anon;
grant execute on function private.remove_staff_access(uuid),public.remove_staff_access(uuid) to authenticated;

create function private.staff_reset_email(target_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text; target_role text; target_email text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or not coalesce(actor_role in ('owner','admin'),false) then raise exception 'Owner or admin access required' using errcode='42501'; end if;
 select m.role,lower(u.email) into target_role,target_email from public.team_members m
 join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.user_id=target_user_id and m.active and u.email_confirmed_at is not null and m.email=lower(u.email)
 and ((m.role='owner' and m.bootstrap_owner) or split_part(lower(u.email),'@',2)=any(s.email_domains));
 if target_email is null then raise exception 'Confirm the invitation and restore staff access before requesting a password reset' using errcode='23514'; end if;
 if target_user_id<>auth.uid() and (target_role='owner' or (actor_role='admin' and target_role='admin')) then raise exception 'You cannot reset a protected account' using errcode='42501'; end if;
 return target_email;
end; $$;
create function public.staff_reset_email(target_user_id uuid) returns text language sql stable security invoker set search_path='' as $$ select private.staff_reset_email(target_user_id); $$;
revoke all on function private.staff_reset_email(uuid),public.staff_reset_email(uuid) from public,anon;
grant execute on function private.staff_reset_email(uuid),public.staff_reset_email(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
