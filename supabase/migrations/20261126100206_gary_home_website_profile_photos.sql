begin;

-- Every app owns a separate private bucket. This migration does not move,
-- register or delete legacy objects.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('gary-home-profile-photos','gary-home-profile-photos',false,102400,array['image/webp']);

-- The existing avatar_path NOT NULL/format/owner constraint stays in place.
-- A removed photo has no staff_profiles row. The write RPC updates its listing
-- portrait aliases in the same transaction and keeps the old bucket readable.
alter table public.staff_profiles add column avatar_bucket text not null default 'staff-avatars'
  check (avatar_bucket in ('staff-avatars','gary-home-profile-photos'));
revoke insert(user_id,avatar_path),update(user_id,avatar_path) on public.staff_profiles from authenticated;
-- Linked portraits use the existing resolver. Prevent new durable references
-- to a private object path that could outlive its active profile.
alter table public.listing_authors add constraint listing_authors_managed_avatar_url_check
  check (strpos(portrait_url,'/gary-home-profile-photos/')=0) not valid;

create table private.home_avatar_uploads (
  id uuid primary key,
  user_id uuid not null,
  path text generated always as (user_id::text || '/' || id::text || '.webp') stored unique,
  removing boolean not null default false,
  state text not null default 'pending' check (state in ('pending','active','retired','deleting')),
  retry_at timestamptz not null default now() + interval '15 minutes',
  cleanup_token uuid,
  unique(user_id,path)
);
alter table private.home_avatar_uploads enable row level security;
revoke all on private.home_avatar_uploads from public,anon,authenticated;
create index home_avatar_cleanup_due on private.home_avatar_uploads(retry_at,id)
where state in ('pending','retired','deleting') and not removing;

create table public.home_avatar_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version uuid not null,
  path text,
  foreign key (user_id,path) references private.home_avatar_uploads(user_id,path)
);
alter table public.home_avatar_profiles enable row level security;
revoke all on public.home_avatar_profiles from public,anon,authenticated;
grant select on public.home_avatar_profiles to authenticated;
create policy home_avatar_profile_read on public.home_avatar_profiles for select to authenticated
using (auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true' and private.can_view_staff_account(user_id));

-- Legacy Home portraits remain readable. Freeze direct writes to the old bucket
-- so pre-cutover browser tabs cannot leave new unmanaged uploads.
-- The Storage read policy sees only the current pointer and inherits its RLS.
-- Restrictive policies keep other applications' permissive policies out of this bucket.
create policy home_avatar_managed_read on storage.objects for select to authenticated
using (bucket_id='gary-home-profile-photos' and exists (
  select 1 from public.home_avatar_profiles p
  where p.user_id::text=split_part(name,'/',1) and p.path=name
));
create policy home_avatar_managed_read_guard on storage.objects as restrictive for select to authenticated
using (bucket_id<>'gary-home-profile-photos' or exists (
  select 1 from public.home_avatar_profiles p
  where p.user_id::text=split_part(name,'/',1) and p.path=name
));
-- Public listing portraits already use the staff_profiles anonymous RLS view
-- of linked, published staff. A private object is readable only through that
-- same active and published reference.
create policy home_avatar_published_read on storage.objects for select to anon
using (bucket_id='gary-home-profile-photos' and exists (
  select 1 from public.staff_profiles p where p.avatar_bucket=bucket_id and p.avatar_path=name
));
create policy home_avatar_published_read_guard on storage.objects as restrictive for select to anon
using (bucket_id<>'gary-home-profile-photos' or exists (
  select 1 from public.staff_profiles p where p.avatar_bucket=bucket_id and p.avatar_path=name
));
create policy home_avatar_managed_insert_guard on storage.objects as restrictive for insert to anon,authenticated
with check (bucket_id not in ('gary-home-profile-photos','staff-avatars'));
create policy home_avatar_managed_update_guard on storage.objects as restrictive for update to anon,authenticated
using (bucket_id not in ('gary-home-profile-photos','staff-avatars')) with check (bucket_id not in ('gary-home-profile-photos','staff-avatars'));
create policy home_avatar_managed_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using (bucket_id not in ('gary-home-profile-photos','staff-avatars'));

-- The upload reservation and Storage's service-written user metadata must agree.
-- A basename or the presence of a Storage object alone is insufficient.
create function private.home_avatar_object_owned(p_path text,p_owner uuid,p_id uuid)
returns boolean language sql stable set search_path='' as $$
  select exists (
    select 1 from storage.objects o
    where o.bucket_id='gary-home-profile-photos' and o.name=p_path
      and o.user_metadata->'profileAvatar'=jsonb_build_object('app','home','owner',p_owner,'id',p_id)
  );
$$;
revoke all on function private.home_avatar_object_owned(text,uuid,uuid) from public,anon,authenticated;

create function private.home_avatar_save(p_id uuid,p_expected uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  previous public.home_avatar_profiles;
  replacement private.home_avatar_uploads;
  next_path text;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' or not coalesce(private.is_editor(),false) then
    raise exception 'Own profile required' using errcode='42501';
  end if;
  -- Serialize the first write as well as replacements/removals for the same identity.
  perform pg_advisory_xact_lock(hashtextextended('home:profile-avatar:' || actor::text,0));
  select * into previous from public.home_avatar_profiles p where p.user_id=actor;
  if previous.version=p_id then
    return jsonb_build_object('ok',true,'version',previous.version,'path',previous.path);
  end if;
  if previous.version is distinct from p_expected then
    raise exception 'Avatar version changed' using errcode='PT409';
  end if;

  select * into replacement from private.home_avatar_uploads u
  where u.id=p_id and u.user_id=actor and u.state='pending' and u.retry_at>now() for update;
  if not found then raise exception 'Avatar reservation unavailable' using errcode='42501'; end if;
  if not replacement.removing then
    if not private.home_avatar_object_owned(replacement.path,actor,p_id) then
      raise exception 'Avatar upload unavailable' using errcode='PT422';
    end if;
    next_path:=replacement.path;
  end if;

  insert into public.home_avatar_profiles(user_id,version,path)
  values(actor,p_id,next_path)
  on conflict(user_id) do update set version=excluded.version,path=excluded.path;

  if next_path is null then
    delete from public.staff_profiles where user_id=actor;
    if found then
      update public.listing_authors set portrait_url='',updated_at=now() where staff_user_id=actor;
      perform private.append_studio_event('profile','profile.photo_changed',actor,
        (select display_name from public.team_members where user_id=actor),
        (select role from public.team_members where user_id=actor));
    end if;
  else
    -- Existing staff checks, portrait synchronization and activity triggers run here.
    insert into public.staff_profiles(user_id,avatar_path,avatar_bucket)
    values(actor,next_path,'gary-home-profile-photos')
    on conflict(user_id) do update set avatar_path=excluded.avatar_path,avatar_bucket=excluded.avatar_bucket;
  end if;

  if replacement.removing then
    delete from private.home_avatar_uploads where id=p_id;
  else
    update private.home_avatar_uploads set state='active',retry_at='infinity' where id=p_id;
  end if;
  update private.home_avatar_uploads set state='retired',retry_at=now()
  where id=previous.version and state='active' and user_id=actor;
  return jsonb_build_object('ok',true,'version',p_id,'path',next_path);
end;
$$;

create function public.home_avatar_save(p_id uuid,p_expected uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select private.home_avatar_save(p_id,p_expected);
$$;
revoke all on function private.home_avatar_save(uuid,uuid),public.home_avatar_save(uuid,uuid) from public,anon,authenticated;
grant execute on function private.home_avatar_save(uuid,uuid),public.home_avatar_save(uuid,uuid) to authenticated;

-- Only the Edge Function may reserve paths or claim cleanup. Claims fence out
-- publication and keep a retry deadline even if the Storage call is interrupted.
create function public.home_avatar_maintenance(
  p_action text,p_owner uuid default null,p_id uuid default null,p_remove boolean default false,p_token uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  case p_action
    when 'reserve' then
      insert into private.home_avatar_uploads(id,user_id,removing)
      values(p_id,p_owner,p_remove) returning jsonb_build_object('id',id,'path',path) into result;
      return result;
    when 'abandon' then
      -- The commit might have succeeded even if its response was lost.
      update private.home_avatar_uploads set state='retired'
      where id=p_id and user_id=p_owner and state='pending';
      return 'null'::jsonb;
    when 'claim' then
      with due as (
        select u.id from private.home_avatar_uploads u
        where (p_owner is null or u.user_id=p_owner)
          and not u.removing and u.retry_at<=now()
          and u.state in ('pending','retired','deleting')
          and not exists (select 1 from public.home_avatar_profiles p where p.user_id=u.user_id and p.path=u.path)
          and not exists (select 1 from public.staff_profiles p
                          where p.avatar_bucket='gary-home-profile-photos' and p.avatar_path=u.path)
          and not exists (select 1 from public.listing_authors a
                          where strpos(a.portrait_url,'/gary-home-profile-photos/' || u.path)>0)

          and (private.home_avatar_object_owned(u.path,u.user_id,u.id)
            or (u.state='deleting' and not exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path)))
        order by u.retry_at,u.id limit 8 for update of u skip locked
      ), claimed as (
        update private.home_avatar_uploads u
        set state='deleting',cleanup_token=gen_random_uuid(),retry_at=now()+interval '15 minutes'
        from due where u.id=due.id
        returning u.id,u.path,u.cleanup_token,exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path) as remove_object
      )
      select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
      return result;
    when 'finish' then
      delete from private.home_avatar_uploads u
      where u.id=p_id and u.state='deleting' and u.cleanup_token=p_token
        and not exists (select 1 from storage.objects o where o.bucket_id='gary-home-profile-photos' and o.name=u.path);
      return to_jsonb(found);
    else
      raise exception 'Unknown avatar maintenance action' using errcode='22023';
  end case;
end;
$$;
revoke all on function public.home_avatar_maintenance(text,uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.home_avatar_maintenance(text,uuid,uuid,boolean,uuid) to service_role;

create or replace function public.get_staff_profile() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'avatar_path',coalesce(p.avatar_path,''),'avatar_bucket',p.avatar_bucket,'updated_at',p.updated_at,'password_change_reminder',m.password_change_reminder) into result from public.team_members m left join public.staff_profiles p on p.user_id=m.user_id where m.user_id=auth.uid();
 return result;
end; $$;

create or replace function public.get_studio_notifications(before_time timestamptz default null,before_id uuid default null,page_size integer default 30) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare seen timestamptz; items jsonb; unread bigint;
begin
 if not coalesce(private.is_editor(),false) then raise exception 'Staff access required' using errcode='42501';end if;
 select last_seen_at into seen from public.staff_notification_reads where user_id=auth.uid();
 select count(*) into unread from public.studio_notifications where seen is null or created_at>seen;
 select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc,rows.id desc),'[]') into items from(select n.*,coalesce(p.avatar_path,'') as actor_avatar_path,p.avatar_bucket as actor_avatar_bucket,seen is null or n.created_at>seen as unread from public.studio_notifications n left join public.staff_profiles p on p.user_id=n.actor_user_id where before_time is null or (n.created_at,n.id)<(before_time,before_id) order by n.created_at desc,n.id desc limit least(greatest(page_size,1),50)) rows;
 return jsonb_build_object('items',items,'unread_count',unread);
end; $$;

notify pgrst,'reload schema';
commit;
