begin;

-- One optional video per listing. The upload bucket enforces a decimal 50 MB
-- ceiling strictly: exactly 50,000,000 bytes is not accepted.
alter table public.properties add column video_url text
  constraint properties_video_url_check check (
    video_url is null or (
      char_length(video_url) <= 2048 and
      video_url ~ '^https://duyiihsmaqfgwezmsnjs\.supabase\.co/storage/v1/object/public/listing-videos/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
    )
  );
comment on column public.properties.video_url is 'One optional uploaded MP4 property video, strictly smaller than 50,000,000 bytes.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('listing-videos','listing-videos',true,49999999,array['video/mp4'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy listing_video_read on storage.objects for select to anon,authenticated
  using(bucket_id='listing-videos');
create policy listing_video_upload on storage.objects for insert to authenticated with check(
  bucket_id='listing-videos' and (select private.is_editor()) and
  split_part(name,'/',1)=(select auth.uid())::text and
  name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
);
-- Uploaded objects are immutable. Replacing a listing video uploads a new object.
create policy listing_video_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check(bucket_id<>'listing-videos');
create policy listing_video_anon_update_guard on storage.objects as restrictive for update to anon
  using(bucket_id<>'listing-videos') with check(bucket_id<>'listing-videos');
create policy listing_video_anon_delete_guard on storage.objects as restrictive for delete to anon
  using(bucket_id<>'listing-videos');
create policy listing_video_upload_guard on storage.objects as restrictive for insert to authenticated with check(
  bucket_id<>'listing-videos' or (
    (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
    name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'
  )
);
create policy listing_video_update_guard on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'listing-videos') with check(bucket_id<>'listing-videos');
create policy listing_video_delete_guard on storage.objects as restrictive for delete to authenticated using(
  bucket_id<>'listing-videos' or (
    (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
    not exists(select 1 from public.properties p where p.video_url like '%/storage/v1/object/public/listing-videos/'||storage.objects.name)
  )
);
create policy listing_video_delete on storage.objects for delete to authenticated using(
  bucket_id='listing-videos' and (select private.is_editor()) and split_part(name,'/',1)=(select auth.uid())::text and
  not exists(select 1 from public.properties p where p.video_url like '%/storage/v1/object/public/listing-videos/'||storage.objects.name)
);

create function private.validate_listing_video() returns trigger language plpgsql security invoker set search_path='' as $$
declare object_path text;
begin
  if new.video_url is null then return new; end if;
  if tg_op='UPDATE' and new.video_url is not distinct from old.video_url then return new; end if;
  object_path:=substring(new.video_url from '/storage/v1/object/public/listing-videos/(.*)$');
  if not exists(
    select 1 from storage.objects o where o.bucket_id='listing-videos' and o.name=object_path
      and o.metadata->>'mimetype'='video/mp4'
      and (o.metadata->>'size') ~ '^[0-9]+$'
      and (o.metadata->>'size')::numeric > 0 and (o.metadata->>'size')::numeric < 50000000
  ) then
    raise exception 'Use one uploaded MP4 video smaller than 50 MB.' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function private.validate_listing_video() from public,anon,authenticated;
create trigger properties_validate_video before insert or update of video_url on public.properties
  for each row execute function private.validate_listing_video();

notify pgrst,'reload schema';
commit;
