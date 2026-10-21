begin;

-- Customer identity is always auth.uid(), never a supplied email or metadata role.
create table public.customer_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  preferred_district text references public.neighbourhoods(slug) on delete set null,
  budget_min numeric(14,2) check (budget_min >= 0),
  budget_max numeric(14,2) check (budget_max >= 0),
  move_in_date date,
  preferences text not null default '' check (char_length(preferences) <= 2000),
  updated_at timestamptz not null default now(),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);
create index customer_profiles_district_idx on public.customer_profiles(preferred_district);
alter table public.customer_profiles enable row level security;
revoke all on public.customer_profiles from anon, authenticated;
grant select, insert, update on public.customer_profiles to authenticated;
create policy profiles_read on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_editor()));
create policy profiles_insert_self on public.customer_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy profiles_update_self on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table public.saved_homes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);
create index saved_homes_property_idx on public.saved_homes(property_id);
alter table public.saved_homes enable row level security;
revoke all on public.saved_homes from anon, authenticated;
grant select, insert, delete on public.saved_homes to authenticated;
create policy saved_read_self on public.saved_homes for select to authenticated using (user_id = (select auth.uid()));
create policy saved_insert_self on public.saved_homes for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.properties p where p.id = property_id and p.status = 'published'
  )
);
create policy saved_delete_self on public.saved_homes for delete to authenticated using (user_id = (select auth.uid()));

-- Staff-only CRM records. No customer-facing query can read staff notes.
create table public.customer_records (
  customer_key text primary key check (char_length(customer_key) between 5 and 300),
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  phone text not null default '' check (char_length(phone) <= 40),
  stage text not null default 'new' check (stage in ('new','contacted','viewing','tenant','closed')),
  follow_up_on date,
  notes text not null default '' check (char_length(notes) <= 8000),
  updated_at timestamptz not null default now()
);
create index customer_records_user_idx on public.customer_records(user_id);
create index customer_records_followup_idx on public.customer_records(follow_up_on) where stage <> 'closed';
alter table public.customer_records enable row level security;
revoke all on public.customer_records from anon, authenticated;
grant select, insert, update on public.customer_records to authenticated;
create policy crm_read_staff on public.customer_records for select to authenticated using ((select private.is_editor()));
create policy crm_insert_staff on public.customer_records for insert to authenticated with check ((select private.is_editor()));
create policy crm_update_staff on public.customer_records for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));

alter table public.enquiries add column user_id uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.enquiries add column appointment_at timestamptz;
alter table public.enquiries add column customer_update text not null default '' check (char_length(customer_update) <= 2000);
alter table public.enquiries add column cancelled_at timestamptz;
create index enquiries_customer_idx on public.enquiries(user_id, created_at desc) where user_id is not null;

-- Preserve legacy notes, then remove client access to that column. Explicit
-- column grants are essential: row policies alone cannot hide internal notes.
create table public.enquiry_notes (
  enquiry_id uuid primary key references public.enquiries(id) on delete cascade,
  notes text not null default '' check (char_length(notes) <= 8000)
);
insert into public.enquiry_notes(enquiry_id, notes) select id, notes from public.enquiries where notes <> '';
alter table public.enquiry_notes enable row level security;
revoke all on public.enquiry_notes from anon, authenticated;
grant select, insert, update on public.enquiry_notes to authenticated;
create policy enquiry_notes_read_staff on public.enquiry_notes for select to authenticated using ((select private.is_editor()));
create policy enquiry_notes_insert_staff on public.enquiry_notes for insert to authenticated with check ((select private.is_editor()));
create policy enquiry_notes_update_staff on public.enquiry_notes for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));

revoke select on public.enquiries from authenticated;
grant select (id,property_id,name,email,phone,message,preferred_date,kind,consent,status,created_at,user_id,appointment_at,customer_update,cancelled_at) on public.enquiries to authenticated;
revoke update (notes) on public.enquiries from authenticated;
grant update (appointment_at,customer_update,cancelled_at) on public.enquiries to authenticated;
create policy enquiries_read_self on public.enquiries for select to authenticated using (user_id = (select auth.uid()));

-- Anonymous submissions remain unclaimed. Signing up with the same email does
-- not grant access to someone else's historical messages.
drop policy enquiries_submit on public.enquiries;
create policy enquiries_submit on public.enquiries for insert to anon, authenticated with check (
  consent = true and status = 'new' and notes = '' and appointment_at is null and customer_update = '' and cancelled_at is null and
  (user_id is null or user_id = (select auth.uid())) and
  (preferred_date is null or preferred_date >= current_date) and
  (property_id is null or exists (select 1 from public.properties p where p.id = property_id and p.status = 'published'))
);
create policy enquiries_cancel_self on public.enquiries for update to authenticated
  using (user_id = (select auth.uid()) and kind = 'viewing' and status <> 'closed' and cancelled_at is null)
  with check (user_id = (select auth.uid()) and kind = 'viewing' and cancelled_at is not null);

-- Customers may only cancel. The trigger prevents using the cancellation RLS
-- policy to change staff-controlled status, confirmation time, or reply fields.
create function private.guard_customer_enquiry_update() returns trigger language plpgsql
security invoker set search_path = '' as $$
begin
  if private.is_editor() then return new; end if;
  if auth.uid() is null or old.user_id is distinct from auth.uid()
     or old.kind <> 'viewing' or old.status = 'closed' or old.cancelled_at is not null
     or new.cancelled_at is null
     or (to_jsonb(new) - 'cancelled_at') is distinct from (to_jsonb(old) - 'cancelled_at') then
    raise exception 'Customers may only cancel their own active viewing requests.' using errcode = '42501';
  end if;
  new.cancelled_at := now();
  return new;
end;
$$;
revoke all on function private.guard_customer_enquiry_update() from public, anon, authenticated;
create trigger guard_customer_enquiry_update before update on public.enquiries
  for each row execute function private.guard_customer_enquiry_update();

-- One transaction for staff status, the customer-visible update and private notes.
-- Invoker security preserves RLS and never elevates a caller's privileges.
create function public.save_customer_enquiry(
  enquiry_id uuid, new_status text, internal_notes text,
  scheduled_at timestamptz, public_update text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare saved_id uuid;
begin
  if not private.is_editor() then raise exception 'Editor access required.' using errcode = '42501'; end if;
  if new_status = 'scheduled' and scheduled_at is null then
    raise exception 'Choose a confirmed viewing time before scheduling.' using errcode = '23514';
  end if;
  update public.enquiries set status = new_status, appointment_at = scheduled_at, customer_update = public_update
    where id = enquiry_id returning id into saved_id;
  if saved_id is null then raise exception 'Enquiry not found.' using errcode = 'P0002'; end if;
  insert into public.enquiry_notes(enquiry_id, notes) values (saved_id, internal_notes)
    on conflict on constraint enquiry_notes_pkey do update set notes = excluded.notes;
  return saved_id;
end;
$$;
revoke all on function public.save_customer_enquiry(uuid,text,text,timestamptz,text) from public, anon;
grant execute on function public.save_customer_enquiry(uuid,text,text,timestamptz,text) to authenticated;

notify pgrst, 'reload schema';
commit;
