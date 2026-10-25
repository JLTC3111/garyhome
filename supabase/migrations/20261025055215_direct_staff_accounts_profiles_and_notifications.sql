begin;

create function private.staff_rank(role_name text) returns integer language sql immutable security invoker set search_path='' as $$
 select case role_name when 'owner' then 4 when 'admin' then 3 when 'manager' then 2 when 'editor' then 1 else 0 end;
$$;
revoke all on function private.staff_rank(text) from public,anon;
grant execute on function private.staff_rank(text) to authenticated;

create or replace function private.find_staff_account(target_email text,assigned_role text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor_role text; target_id uuid; target_role text; domains text[];
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 if private.staff_rank(assigned_role)<1 or private.staff_rank(assigned_role)>=private.staff_rank(actor_role) then raise exception 'You may assign roles below your own level only' using errcode='42501'; end if;
 select email_domains into domains from public.staff_settings where id='main';
 if target_email is null or char_length(target_email)>254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+$' or not coalesce(split_part(lower(btrim(target_email)),'@',2)=any(domains),false) then raise exception 'Use an allowed company or Gmail address' using errcode='23514'; end if;
 select id into target_id from auth.users where lower(email)=lower(btrim(target_email));
 select role into target_role from public.team_members where user_id=target_id;
 if target_id=auth.uid() or (target_role is not null and private.staff_rank(target_role)>=private.staff_rank(actor_role)) then raise exception 'You cannot change your own access, a peer or a higher role' using errcode='42501'; end if;
 return target_id;
end; $$;

create or replace function private.set_staff_access(target_user_id uuid,assigned_role text,enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare member public.team_members; checked_id uuid;
begin
 if auth.uid() is null or private.staff_rank(private.staff_role())<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 select * into member from public.team_members where user_id=target_user_id;
 if member.user_id is null then raise exception 'Staff account not found' using errcode='P0002'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(member.email,0));
 checked_id:=private.find_staff_account(member.email,assigned_role);
 if checked_id is distinct from target_user_id or enabled is null then raise exception 'Check the assigned staff email' using errcode='23514'; end if;
 update public.team_members set role=assigned_role,active=enabled,assigned_by=auth.uid(),updated_at=now() where user_id=target_user_id;
 return target_user_id;
end; $$;

create or replace function private.list_staff_accounts(after_email text default null)
returns table(user_id uuid,email text,display_name text,role text,active boolean,confirmed boolean,created_at timestamptz,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare actor_role text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 return query select m.user_id,m.email,m.display_name,m.role,m.active,u.email_confirmed_at is not null,m.created_at,m.updated_at
 from public.team_members m join auth.users u on u.id=m.user_id
 where m.email is not null and (m.user_id=auth.uid() or private.staff_rank(m.role)<private.staff_rank(actor_role)) and (after_email is null or m.email>after_email)
 order by m.email limit 51;
end; $$;

create or replace function private.staff_reset_email(target_user_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare actor_role text; target_role text; target_email text;
begin
 actor_role:=private.staff_role();
 if auth.uid() is null or private.staff_rank(actor_role)<2 then raise exception 'Team management access required' using errcode='42501'; end if;
 select m.role,lower(u.email) into target_role,target_email from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where m.user_id=target_user_id and m.active and m.email=lower(u.email) and ((m.role='owner' and m.bootstrap_owner) or split_part(lower(u.email),'@',2)=any(s.email_domains));
 if target_email is null then raise exception 'Restore staff access and check the assigned email' using errcode='23514'; end if;
 if target_user_id<>auth.uid() and private.staff_rank(target_role)>=private.staff_rank(actor_role) then raise exception 'You cannot reset a peer or higher role' using errcode='42501'; end if;
 return target_email;
end; $$;

alter table public.team_members add column password_change_reminder boolean not null default false;
alter table public.team_members alter column password_change_reminder set default true;

create table public.staff_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 avatar_path text not null check(char_length(avatar_path)<=250 and avatar_path ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|jpeg|webp|avif)$' and split_part(avatar_path,'/',1)=user_id::text),
 updated_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from public,anon,authenticated;
grant select on public.staff_profiles to anon,authenticated;
-- PostgREST upserts include the key in ON CONFLICT UPDATE. RLS and the
-- ownership trigger still prevent changing it to another account.
grant insert(user_id,avatar_path),update(user_id,avatar_path) on public.staff_profiles to authenticated;
create policy staff_profiles_staff_read on public.staff_profiles for select to authenticated using ((select private.is_editor()));
create policy staff_profiles_self_insert on public.staff_profiles for insert to authenticated with check(user_id=(select auth.uid()) and (select private.is_editor()) and exists(select 1 from storage.objects o where o.bucket_id='staff-avatars' and o.name=avatar_path));
create policy staff_profiles_self_update on public.staff_profiles for update to authenticated using(user_id=(select auth.uid()) and (select private.is_editor())) with check(user_id=(select auth.uid()) and (select private.is_editor()) and exists(select 1 from storage.objects o where o.bucket_id='staff-avatars' and o.name=avatar_path));

grant select,insert,delete on storage.objects to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('staff-avatars','staff-avatars',true,2097152,array['image/jpeg','image/png','image/webp','image/avif']);
create policy staff_avatar_upload on storage.objects for insert to authenticated with check(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()));
create policy staff_avatar_read_own on storage.objects for select to authenticated using(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()));
create policy staff_avatar_delete_own on storage.objects for delete to authenticated using(bucket_id='staff-avatars' and split_part(name,'/',1)=(select auth.uid())::text and (select private.is_editor()) and not exists(select 1 from public.staff_profiles p where p.user_id=(select auth.uid()) and p.avatar_path=name));

alter table public.listing_authors drop constraint listing_authors_portrait_url_check;
alter table public.listing_authors add constraint listing_authors_portrait_url_check check(portrait_url='' or portrait_url ~ '^(/images/|https://)' or portrait_url ~ '^/api/staff-avatar/[a-f0-9-]{36}\?v=[0-9.]+$');
alter table public.listing_authors add column staff_user_id uuid references auth.users(id) on delete set null;
create index listing_authors_staff_user_id_idx on public.listing_authors(staff_user_id);
create function private.has_public_staff_portrait(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.listing_authors a join public.team_members m on m.user_id=a.staff_user_id join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main'
 where a.staff_user_id=target and a.published and m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains)));
$$;
revoke all on function private.has_public_staff_portrait(uuid) from public;
grant usage on schema private to anon;
grant execute on function private.has_public_staff_portrait(uuid) to anon,authenticated;
create policy staff_profiles_published_portrait on public.staff_profiles for select to anon using(private.has_public_staff_portrait(user_id));

create table public.studio_notifications(
 id uuid primary key default gen_random_uuid(),
 category text not null check(category in ('team','profile','enquiry','feedback','commission')),
 action text not null,
 actor_user_id uuid references auth.users(id) on delete set null,
 actor_name text not null default '',
 target_user_id uuid references auth.users(id) on delete set null,
 target_name text not null default '',
 target_role text,
 details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
 created_at timestamptz not null default now()
);
create index studio_notifications_created_idx on public.studio_notifications(created_at desc,id desc);
create index studio_notifications_actor_idx on public.studio_notifications(actor_user_id,created_at desc);
create index studio_notifications_target_idx on public.studio_notifications(target_user_id,created_at desc);
alter table public.studio_notifications enable row level security;
revoke all on public.studio_notifications from public,anon,authenticated;
grant select on public.studio_notifications to authenticated;
create policy studio_notifications_staff_read on public.studio_notifications for select to authenticated using(
 (select private.is_editor()) and (
 category in ('enquiry','feedback') or category='commission' and (select private.can_order_properties()) or
 category in ('team','profile') and ((select private.staff_role())='owner' or actor_user_id=(select auth.uid()) or target_user_id=(select auth.uid()) or (select private.staff_rank(private.staff_role()))>=2 and private.staff_rank(target_role)<(select private.staff_rank(private.staff_role())))
 ));
create table public.staff_notification_reads(user_id uuid primary key references auth.users(id) on delete cascade,last_seen_at timestamptz not null default now());
alter table public.staff_notification_reads enable row level security;
revoke all on public.staff_notification_reads from public,anon,authenticated;
grant select,insert,update on public.staff_notification_reads to authenticated;
create policy staff_notification_reads_self on public.staff_notification_reads to authenticated using(user_id=(select auth.uid()) and (select private.is_editor())) with check(user_id=(select auth.uid()) and (select private.is_editor()));

create function private.append_studio_event(event_category text,event_action text,target uuid,target_label text,target_level text,event_details jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 insert into public.studio_notifications(category,action,actor_user_id,actor_name,target_user_id,target_name,target_role,details)
 values(event_category,event_action,auth.uid(),coalesce((select display_name from public.team_members where user_id=auth.uid()),''),target,coalesce(target_label,''),target_level,event_details);
end; $$;
revoke all on function private.append_studio_event(text,text,uuid,text,text,jsonb) from public,anon,authenticated;

create or replace function private.assign_staff_account(target_email text,full_name text,assigned_role text) returns uuid language plpgsql security definer set search_path='' as $$
declare target_id uuid; was_member boolean;
begin
 if auth.uid() is null then raise exception 'Sign in first' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(target_email)),0));
 target_id:=private.find_staff_account(target_email,assigned_role);
 if target_id is null then raise exception 'Create the Auth account first' using errcode='P0002';end if;
 if full_name is null or char_length(btrim(full_name)) not between 2 and 120 then raise exception 'Enter the staff name' using errcode='23514';end if;
 select exists(select 1 from public.team_members where user_id=target_id) into was_member;
 insert into public.team_members(user_id,email,display_name,role,active,assigned_by) values(target_id,lower(btrim(target_email)),btrim(full_name),assigned_role,true,auth.uid())
 on conflict(user_id)do update set email=excluded.email,display_name=excluded.display_name,role=excluded.role,active=true,assigned_by=auth.uid(),updated_at=now();
 if was_member then perform private.append_studio_event('team','team.assigned',target_id,btrim(full_name),assigned_role);end if;
 return target_id;
end; $$;

create function private.log_team_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform private.append_studio_event('team','team.created',new.user_id,new.display_name,new.role,jsonb_build_object('role',new.role,'password_reminder',new.password_change_reminder));return new;end if;
 if tg_op='DELETE' then perform private.append_studio_event('team','team.deleted',old.user_id,old.display_name,old.role);return old;end if;
 if old.role is distinct from new.role then perform private.append_studio_event('team','team.role_changed',new.user_id,new.display_name,new.role,jsonb_build_object('from',old.role,'to',new.role));end if;
 if old.active is distinct from new.active then perform private.append_studio_event('team',case when new.active then 'team.restored' else 'team.disabled' end,new.user_id,new.display_name,new.role);end if;
 if old.display_name is distinct from new.display_name or old.email is distinct from new.email then perform private.append_studio_event('team','team.details_changed',new.user_id,new.display_name,new.role);end if;
 if old.password_change_reminder is distinct from new.password_change_reminder then perform private.append_studio_event('team',case when new.password_change_reminder then 'password.reminder_enabled' else 'password.reminder_cleared' end,new.user_id,new.display_name,new.role);end if;
 return new;
end; $$;
revoke all on function private.log_team_access() from public,anon,authenticated;
create trigger log_team_access after insert or update or delete on public.team_members for each row execute function private.log_team_access();

create function private.sync_staff_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is distinct from new.user_id or not coalesce(private.is_editor(),false) then raise exception 'Own staff profile required' using errcode='42501';end if;
 new.updated_at:=now();
 return new;
end; $$;
create trigger stamp_staff_portrait before insert or update on public.staff_profiles for each row execute function private.sync_staff_portrait();
create function private.publish_staff_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is distinct from new.user_id or not coalesce(private.is_editor(),false) then raise exception 'Own staff profile required' using errcode='42501';end if;
 update public.listing_authors set portrait_url='/api/staff-avatar/'||new.user_id::text||'?v='||extract(epoch from new.updated_at)::text,updated_at=now() where staff_user_id=new.user_id;
 if tg_op='INSERT' or old.avatar_path is distinct from new.avatar_path then perform private.append_studio_event('profile','profile.photo_changed',new.user_id,(select display_name from public.team_members where user_id=new.user_id),(select role from public.team_members where user_id=new.user_id));end if;
 return new;
end; $$;
create trigger publish_staff_portrait after insert or update on public.staff_profiles for each row execute function private.publish_staff_portrait();
revoke all on function private.sync_staff_portrait(),private.publish_staff_portrait() from public,anon,authenticated;

create function private.link_listing_portrait() returns trigger language plpgsql security definer set search_path='' as $$
declare photo public.staff_profiles;
begin
 if new.staff_user_id is not null then
  if not exists(select 1 from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main' where m.user_id=new.staff_user_id and m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains))) then raise exception 'Choose an active verified staff account' using errcode='23514';end if;
  select * into photo from public.staff_profiles where user_id=new.staff_user_id;
  new.portrait_url:=case when photo.avatar_path is null then '' else '/api/staff-avatar/'||new.staff_user_id::text||'?v='||extract(epoch from photo.updated_at)::text end;
 end if;return new;
end; $$;
revoke all on function private.link_listing_portrait() from public,anon,authenticated;
create trigger link_listing_portrait before insert or update on public.listing_authors for each row execute function private.link_listing_portrait();

create function public.get_staff_profile() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'avatar_path',coalesce(p.avatar_path,''),'updated_at',p.updated_at,'password_change_reminder',m.password_change_reminder) into result from public.team_members m left join public.staff_profiles p on p.user_id=m.user_id where m.user_id=auth.uid();
 return result;
end; $$;
create function private.acknowledge_staff_password_reminder() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 update public.team_members set password_change_reminder=false,updated_at=now() where user_id=auth.uid();
end; $$;
create function public.acknowledge_staff_password_reminder() returns void language sql security invoker set search_path='' as $$select private.acknowledge_staff_password_reminder();$$;
revoke all on function private.acknowledge_staff_password_reminder(),public.acknowledge_staff_password_reminder(),public.get_staff_profile() from public,anon;
grant execute on function private.acknowledge_staff_password_reminder(),public.acknowledge_staff_password_reminder(),public.get_staff_profile() to authenticated;

create function private.staff_photo_directory() returns table(user_id uuid,display_name text,avatar_path text) language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 return query select m.user_id,m.display_name,coalesce(p.avatar_path,'') from public.team_members m join auth.users u on u.id=m.user_id join public.staff_settings s on s.id='main' left join public.staff_profiles p on p.user_id=m.user_id where m.active and u.email_confirmed_at is not null and m.email=lower(u.email) and (m.bootstrap_owner or split_part(m.email,'@',2)=any(s.email_domains)) order by m.display_name,m.user_id limit 500;
end; $$;
create function public.staff_photo_directory() returns table(user_id uuid,display_name text,avatar_path text) language sql stable security invoker set search_path='' as $$ select * from private.staff_photo_directory(); $$;
revoke all on function private.staff_photo_directory(),public.staff_photo_directory() from public,anon;
grant execute on function private.staff_photo_directory(),public.staff_photo_directory() to authenticated;

create function public.get_studio_notifications(before_time timestamptz default null,before_id uuid default null,page_size integer default 30) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare seen timestamptz; items jsonb; unread bigint;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select last_seen_at into seen from public.staff_notification_reads where user_id=auth.uid();
 select count(*) into unread from public.studio_notifications where seen is null or created_at>seen;
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from(select n.*,coalesce(p.avatar_path,'') as actor_avatar_path,seen is null or n.created_at>seen as unread from public.studio_notifications n left join public.staff_profiles p on p.user_id=n.actor_user_id where before_time is null or (n.created_at,n.id)<(before_time,before_id) order by n.created_at desc,n.id desc limit least(greatest(page_size,1),50)) rows;
 return jsonb_build_object('items',items,'unread_count',unread);
end; $$;
create function public.mark_studio_notifications_read() returns timestamptz language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz:=clock_timestamp();
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 insert into public.staff_notification_reads(user_id,last_seen_at) values(auth.uid(),stamp) on conflict(user_id)do update set last_seen_at=excluded.last_seen_at;
 return stamp;
end; $$;
revoke all on function public.get_studio_notifications(timestamptz,uuid,integer),public.mark_studio_notifications_read() from public,anon;
grant execute on function public.get_studio_notifications(timestamptz,uuid,integer),public.mark_studio_notifications_read() to authenticated;

create function private.log_staff_password_link(target_user_id uuid,failed boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.staff_reset_email(target_user_id);
 perform private.append_studio_event('team',case when failed then 'password.link_failed' else 'password.link_requested' end,target_user_id,(select display_name from public.team_members where user_id=target_user_id),(select role from public.team_members where user_id=target_user_id));
end; $$;
create function public.log_staff_password_link(target_user_id uuid,failed boolean default false) returns void language sql security invoker set search_path='' as $$ select private.log_staff_password_link(target_user_id,failed); $$;
revoke all on function private.log_staff_password_link(uuid,boolean),public.log_staff_password_link(uuid,boolean) from public,anon;
grant execute on function private.log_staff_password_link(uuid,boolean),public.log_staff_password_link(uuid,boolean) to authenticated;

create function private.log_submission_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare event_category text; event_action text;
begin
 event_category:=case tg_table_name when 'enquiries' then 'enquiry' when 'feedback_submissions' then 'feedback' when 'property_assistance' then 'commission' else null end;
 if event_category is null then raise exception 'Unsupported activity source';end if;
 if tg_op='INSERT' then event_action:=event_category||'.received';else if old.status is not distinct from new.status then return new;end if;event_action:=event_category||'.status_changed';end if;
 perform private.append_studio_event(event_category,event_action,null,'',null,jsonb_build_object('record_id',new.id,'status',new.status));return new;
end; $$;
revoke all on function private.log_submission_activity() from public,anon,authenticated;
create trigger notify_new_enquiry after insert or update of status on public.enquiries for each row execute function private.log_submission_activity();
create trigger notify_customer_feedback after insert or update of status on public.feedback_submissions for each row execute function private.log_submission_activity();
create trigger notify_assistance_activity after insert or update of status on public.property_assistance for each row execute function private.log_submission_activity();

-- Enable live updates only when the host has Supabase Realtime configured.
do $$declare item text;begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  foreach item in array array['staff_profiles','studio_notifications'] loop
   if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=item) then execute format('alter publication supabase_realtime add table public.%I',item);end if;
  end loop;
 end if;
end;$$;

notify pgrst,'reload schema';
commit;
