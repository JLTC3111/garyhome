begin;

alter table public.properties add column image_metadata jsonb not null default '{}'::jsonb
  constraint properties_image_metadata_check check (
    jsonb_typeof(image_metadata) = 'object'
    and octet_length(image_metadata::text) <= 262144
    and jsonb_array_length(jsonb_path_query_array(image_metadata, '$.keyvalue()')) <= 40
    and not jsonb_path_exists(image_metadata, '$.keyvalue() ? (@.key == "" || @.value.type() != "object")')
    and not jsonb_path_exists(image_metadata, '$.*.keyvalue() ? (
      !(@.key like_regex "^(description_(en|vi)|alt_(en|vi)|public_filename)$")
      || @.value.type() != "string"
      || !(@.value like_regex "^.{1,240}$" flag "s")
    )')
  );

comment on column public.properties.image_metadata is
  'Public listing photo descriptions, alt text and explicitly approved original filenames, keyed by image URL or inline preview hash.';

notify pgrst, 'reload schema';
commit;
