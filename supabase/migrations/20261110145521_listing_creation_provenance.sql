begin;
-- Creator attribution is private provenance, not the editable public listing
-- contact. Historical authors are intentionally not inferred or backfilled.
create table public.property_creation_records (
 property_id uuid primary key references public.properties(id) on delete cascade,
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_name text,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.property_creation_records enable row level security;
revoke all on public.property_creation_records from public,anon,authenticated;
grant select on public.property_creation_records to authenticated;
grant all on public.property_creation_records to service_role;
create policy property_creation_staff_read on public.property_creation_records for select to authenticated using ((select private.is_editor()));
create function private.record_property_creation() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); name text;
begin
 if actor is not null and private.is_editor() then
  select nullif(btrim(m.display_name),'') into name from public.team_members m where m.user_id=actor;
  insert into public.property_creation_records(property_id,actor_user_id,actor_name) values(new.id,actor,left(name,120));
 end if;
 return new;
end;
$$;
revoke all on function private.record_property_creation() from public,anon,authenticated;
create trigger properties_record_creation after insert on public.properties for each row execute function private.record_property_creation();
notify pgrst,'reload schema';
commit;
