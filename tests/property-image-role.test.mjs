import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('verified active administrators and editors can upload listing images while customer, guest and revoked staff cannot',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,user_metadata jsonb,created_at timestamptz default now());
 alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;
 grant select,insert,update,delete on storage.objects to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));

 const users={admin:'71000000-0000-4000-8000-000000000001',editor:'71000000-0000-4000-8000-000000000002',customer:'71000000-0000-4000-8000-000000000003',unconfirmed:'71000000-0000-4000-8000-000000000004'};
 for(const [name,id] of Object.entries(users)){
  const email=name+'@gmail.com';
  await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)',[id,email,name==='unconfirmed'?null:new Date().toISOString()]);
  if(name!=='customer')await db.query('insert into public.team_members(user_id,role,email,display_name)values($1,$2,$3,$4)',[id,name==='admin'?'admin':'editor',email,name]);
 }
 const as=async(role='postgres',id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);};
 const put=async(name,original)=>{
  const path=`properties/${crypto.randomUUID()}.jpg`;
  return db.query("insert into storage.objects(bucket_id,name,metadata,user_metadata)values('property-media',$1,$2,$3) returning name,user_metadata",[path,{size:1024,mimetype:'image/jpeg'},{original_filename:original||name}]);
 };
 const bucket=(await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='property-media'")).rows[0];
 assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),8*1024*1024);
 assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp','image/avif']);
 const originals=['3-bedroom-apartment-tay-ho-1-2-3.jpg','Căn hộ Tây Hồ - lake view.JPEG'];
 for(const [index,role] of ['admin','editor'].entries()){
  await as('authenticated',users[role]);
  assert.equal((await db.query('select private.is_editor() as allowed')).rows[0].allowed,true);
  const result=(await put(role,originals[index])).rows[0];
  assert.match(result.name,/^properties\/[\da-f-]{36}\.jpg$/);
  assert.equal(result.user_metadata.original_filename,originals[index]);
 }
 for(const [role,id] of [['anon',''],['authenticated',users.customer],['authenticated',users.unconfirmed]]){
  await as(role,id);await assert.rejects(put('forbidden.jpg'),error=>error.code==='42501');
 }
 await as();await db.query('update public.team_members set active=false where user_id=$1',[users.admin]);
 await as('authenticated',users.admin);
 assert.equal((await db.query('select private.is_editor() as allowed')).rows[0].allowed,false);
 await assert.rejects(put('revoked-admin.jpg'),error=>error.code==='42501');
});
