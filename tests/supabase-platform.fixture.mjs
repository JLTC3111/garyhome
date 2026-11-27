// Minimal Supabase-owned schemas for the in-memory staff and listing video fixtures.
export const supabasePlatform = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create schema storage;
  create table auth.users(
    id uuid primary key, email text, email_confirmed_at timestamptz,
    deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false,
    raw_user_meta_data jsonb default '{}'
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,jsonb_strip_nulls(jsonb_build_object(
      'sub',nullif(current_setting('request.jwt.claim.sub',true),''),
      'email',nullif(current_setting('request.jwt.claim.email',true),'')
    )))
  $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(
    id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id), name text not null,
    metadata jsonb, user_metadata jsonb, owner_id text, version text default gen_random_uuid()::text,
    created_at timestamptz default now(), updated_at timestamptz default now(), unique(bucket_id,name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth,public,storage to anon,authenticated,service_role;
  alter default privileges in schema public grant all on tables to anon,authenticated;
`;
