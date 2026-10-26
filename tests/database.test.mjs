import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('CMS schema and row-level permissions in an isolated Postgres engine', async t => {
  const db=new PGlite();
  t.after(async()=>{await db.close();});
  const owner='00000000-0000-4000-8000-000000000001';
  const stranger='00000000-0000-4000-8000-000000000002';
  const published='00000000-0000-4000-8000-000000000010';
  const draft='00000000-0000-4000-8000-000000000011';
  async function as(role,uid='') {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
    await db.exec(`set role ${role}`);
  }
  {
    // Supabase-owned schemas are emulated locally; application SQL runs unchanged.
    await db.exec(`create role anon; create role authenticated;create role service_role bypassrls; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
      alter table storage.objects enable row level security;
      grant usage on schema auth,public,storage to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;
      grant select on storage.objects to anon;
      grant all on storage.objects to authenticated;`);
    const migration=await readFile(new URL('../supabase/migrations/20261021152453_gary_home_cms.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.exec(`insert into auth.users values ('${owner}','owner@example.invalid'),('${stranger}','stranger@example.invalid');
      insert into public.team_members(user_id,role) values ('${owner}','owner');
      insert into public.neighbourhoods(slug,name,image) values ('tay-ho','Tây Hồ','/images/area-tay-ho.jpg');
      insert into public.properties(id,slug,title_en,title_vi,district_slug,address,images,status) values
      ('${published}','test-home','A test home','Nhà thử nghiệm','tay-ho','Tây Hồ',array['/images/hero.jpg'],'published'),
      ('${draft}','draft-home','A draft','Bản nháp','tay-ho','Tây Hồ',array['/images/hero.jpg'],'draft');`);
    await t.test('anonymous readers see published listings only',async()=>{
      await as('anon');const rows=(await db.query('select id from public.properties')).rows;assert.deepEqual(rows.map(x=>x.id),[published]);
      await assert.rejects(db.exec("insert into public.properties(slug,title_en,title_vi,district_slug,address) values ('attack','Attack','Attack','tay-ho','Hanoi')"));
    });
    await t.test('a signed-in visitor cannot edit listings or self-promote',async()=>{
      await as('authenticated',stranger);
      assert.equal((await db.query('select * from public.team_members')).rows.length,0);
      assert.equal((await db.query("update public.properties set title_en='Changed' where id=$1 returning id",[published])).rows.length,0);
      await assert.rejects(db.exec(`insert into public.team_members(user_id,role) values ('${stranger}','owner')`));
      await assert.rejects(db.exec("insert into public.properties(slug,title_en,title_vi,district_slug,address) values ('attack','Attack','Attack','tay-ho','Hanoi')"));
    });
    await t.test('anonymous enquiry submission cannot read the inbox or forge workflow fields',async()=>{
      await as('anon');
      await db.exec(`insert into public.enquiries(name,email,message,consent,property_id) values ('Test Visitor','visitor@example.invalid','Please arrange a test viewing.',true,'${published}')`);
      await assert.rejects(db.exec('select * from public.enquiries'));
      await assert.rejects(db.exec("insert into public.enquiries(name,email,message,consent,status) values ('Test Visitor','visitor@example.invalid','Please arrange a test viewing.',true,'closed')"));
      await assert.rejects(db.exec(`insert into public.enquiries(name,email,message,consent,property_id) values ('Test Visitor','visitor@example.invalid','Please arrange a test viewing.',true,'${draft}')`));
      await assert.rejects(db.exec("insert into public.enquiries(name,email,message,consent) values ('Test Visitor','visitor@example.invalid','Please arrange a test viewing.',false)"));
    });
    await t.test('ordinary authenticated users cannot see private enquiries',async()=>{
      await as('authenticated',stranger);assert.equal((await db.query('select * from public.enquiries')).rows.length,0);
      assert.equal((await db.query("update public.enquiries set status='closed' returning id")).rows.length,0);
    });
    await t.test('team editors can read drafts, publish listings, and manage the inbox',async()=>{
      await as('authenticated',owner);assert.equal((await db.query('select * from public.properties')).rows.length,2);
      assert.equal((await db.query("update public.properties set status='published' where id=$1 returning id",[draft])).rows.length,1);
      assert.equal((await db.query('select * from public.enquiries')).rows.length,1);
      assert.equal((await db.query("update public.enquiries set status='contacted',notes='Test note' returning id")).rows.length,1);
    });
    await t.test('storage writes require membership and the correct bucket',async()=>{
      await as('authenticated',stranger);await assert.rejects(db.exec("insert into storage.objects(bucket_id,name) values ('property-media','forbidden.jpg')"));
      await as('authenticated',owner);await db.exec("insert into storage.objects(bucket_id,name) values ('property-media','allowed.jpg')");
      await as('anon');assert.equal((await db.query('select name from storage.objects')).rows[0].name,'allowed.jpg');
    });
    await t.test('every application table has RLS enabled',async()=>{
      await as('postgres');const rows=(await db.query("select relname,relrowsecurity from pg_class join pg_namespace n on n.oid=relnamespace where n.nspname='public' and relkind='r'")).rows;
      assert.equal(rows.length,5);assert.ok(rows.every(row=>row.relrowsecurity));
    });
    await t.test('the source listings and neighbourhoods can be seeded without overwriting CMS edits',async()=>{
      await as('postgres');const seed=await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8');
      await db.exec(seed);await db.exec(seed);
      const sources=JSON.parse(await readFile(new URL('../data/properties.json',import.meta.url),'utf8'));
      assert.equal((await db.query('select count(*)::int as total from public.properties')).rows[0].total,sources.length+2);
      assert.equal((await db.query('select count(*)::int as total from public.neighbourhoods')).rows[0].total,4);
    });
  }
});
