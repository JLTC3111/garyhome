begin;

-- Keep original basenames separately from immutable/random storage object keys.
-- No relationship to the current image array is required, so older clients can
-- still reorder or remove images without sending this optional metadata.
create function private.valid_property_image_filenames(filenames jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(filenames) = 'object'
    and octet_length(filenames::text) <= 262144 then (
      select count(*) <= 40 and coalesce(bool_and(
        char_length(entry.key) between 1 and 4096
        and jsonb_typeof(entry.value) = 'string'
        and char_length(entry.value #>> '{}') between 1 and 512
        and strpos(entry.value #>> '{}', '/') = 0
        and strpos(entry.value #>> '{}', chr(92)) = 0
        and (entry.value #>> '{}') !~ '[[:cntrl:]]'
      ), true)
      from jsonb_each(filenames) as entry
    ) else false end;
$$;
revoke all on function private.valid_property_image_filenames(jsonb) from public;
grant execute on function private.valid_property_image_filenames(jsonb) to authenticated,service_role;

alter table public.properties add column image_filenames jsonb not null default '{}'::jsonb
  constraint properties_image_filenames_check check (private.valid_property_image_filenames(image_filenames));
comment on column public.properties.image_filenames is 'Original uploaded image basenames, keyed by image URL. Inline browser previews use a compact inline: hash key. Legacy uploads may have no original basename.';

notify pgrst,'reload schema';
commit;
