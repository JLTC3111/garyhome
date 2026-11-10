import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {listingCreationTime} from '../lib/listing-provenance.ts';

test('listing creation time is explicit Hanoi time, localized and safe for missing legacy dates',()=>{
 const en=listingCreationTime('2026-11-10T18:04:00Z','en'),vi=listingCreationTime('2026-11-10T18:04:00Z','vi');
 assert.equal(en.date,'11/11/2026');assert.equal(en.time,'01:04');assert.equal(vi.time,'01:04');assert.equal(en.iso,'2026-11-10T18:04:00.000Z');
 assert.equal(listingCreationTime('not a date','vi'),null);
});
test('creator records are server captured, private, immutable, and distinct from editable listing authors',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
 create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.team_members(user_id uuid primary key,display_name text,active boolean);create table public.staff_profiles(user_id uuid primary key,display_name text);
 create function private.is_editor()returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.team_members where user_id=auth.uid() and active)$$;
 create table public.properties(id uuid primary key,author_id uuid,created_at timestamptz default now(),title text);grant usage on schema public,private,auth to anon,authenticated,service_role;
 grant insert,update,select on public.properties to authenticated;insert into public.properties(id,title)values('10000000-0000-4000-8000-000000000001','Legacy');
 insert into auth.users values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
 insert into public.team_members values('20000000-0000-4000-8000-000000000001','Assigned staff name',true);
 insert into public.staff_profiles values('20000000-0000-4000-8000-000000000001','Actual poster');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261110145521_listing_creation_provenance.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*)::int n from public.property_creation_records')).rows[0].n,0,'no invented creator backfill');
 await db.query("select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',false)");await db.exec('set role authenticated');
 await db.query("insert into public.properties(id,title,created_at)values('10000000-0000-4000-8000-000000000002','A new listing','2000-01-01')");
 const record=(await db.query('select * from public.property_creation_records')).rows[0];
 assert.equal(record.actor_user_id,'20000000-0000-4000-8000-000000000001');assert.equal(record.actor_name,'Assigned staff name');assert.ok(new Date(record.created_at).getUTCFullYear()>=2026,'timestamp is captured by server rather than trusting submitted date');
 for(const sql of ["update public.property_creation_records set actor_name='forged'","delete from public.property_creation_records","insert into public.property_creation_records(property_id)values('10000000-0000-4000-8000-000000000001')"])
  await assert.rejects(db.query(sql),e=>e.code==='42501');
 await db.query("update public.properties set author_id='20000000-0000-4000-8000-000000000002',created_at='2001-01-01' where id='10000000-0000-4000-8000-000000000002'");
 assert.deepEqual((await db.query('select * from public.property_creation_records')).rows[0],record,'editing contact or client date never rewrites creator provenance');
 await db.exec('reset role');await db.query("update public.team_members set active=false");await db.exec('set role authenticated');assert.equal((await db.query('select * from public.property_creation_records')).rows.length,0,'revoked staff cannot read provenance');
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from public.property_creation_records'),e=>e.code==='42501');
});
