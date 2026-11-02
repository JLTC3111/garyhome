import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('exact map locations are optional public details with normal staff write permissions',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
    alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;
    alter default privileges in schema public grant all on tables to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
  const owner='00000000-0000-4000-8000-000000000001',customer='00000000-0000-4000-8000-000000000002';
  await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@protonmail.com',now()),('${customer}','customer@example.invalid',now());
    insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)values('${owner}','owner','owner@protonmail.com','QA owner',true);`);
  const existing=await db.query('select count(*)::int as total from public.properties where map_address is not null');
  assert.equal(existing.rows[0].total,0,'reference listings stay approximate until an author supplies an exact destination');
  async function as(role='postgres',id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
  await as('authenticated',owner);
  const row=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,images,status)values('map-location-test','Test home','Nhà thử','tay-ho','Tây Hồ',array['/images/apartments/hero.jpg'],'published')returning id,map_address,updated_at::text as version")).rows[0];
  assert.equal(row.map_address,null);
  for(const destination of ['12 Đặng Thai Mai, Tây Hồ, Hà Nội','21.0648,105.8196']){
    const saved=(await db.query('update public.properties set map_address=$1 where id=$2 returning map_address,updated_at::text as version',[destination,row.id])).rows[0];
    assert.equal(saved.map_address,destination);assert.notEqual(saved.version,row.version);
  }
  for(const destination of ['', '   ', 'x'.repeat(301)])await assert.rejects(db.query('update public.properties set map_address=$1 where id=$2',[destination,row.id]),error=>error.code==='23514');
  await as('anon');
  assert.equal((await db.query('select map_address from public.properties where id=$1',[row.id])).rows[0].map_address,'21.0648,105.8196');
  await assert.rejects(db.query("update public.properties set map_address='Forged location' where id=$1",[row.id]));
  await as('authenticated',customer);
  assert.equal((await db.query("update public.properties set map_address='Forged location' where id=$1 returning id",[row.id])).rows.length,0);
  await as('authenticated',owner);
  assert.equal((await db.query('update public.properties set map_address=null where id=$1 returning map_address',[row.id])).rows[0].map_address,null);
});
