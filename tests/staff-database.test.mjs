import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const platform=`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
  alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;
  alter default privileges in schema public grant all on tables to anon,authenticated;`;

test('company staff accounts enforce assignment, verification, hierarchy and immediate revocation',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const owner='00000000-0000-4000-8000-000000000001',admin='00000000-0000-4000-8000-000000000002',staff='00000000-0000-4000-8000-000000000003',customer='00000000-0000-4000-8000-000000000004',pending='00000000-0000-4000-8000-000000000005',legacy='00000000-0000-4000-8000-000000000006',unassigned='00000000-0000-4000-8000-000000000007';
 async function as(uid='',role='authenticated'){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+role);
 }
 const editor=async()=> (await db.query('select private.is_editor() as value')).rows[0].value;
 const assign=(email,name,role='editor')=>db.query('select public.assign_staff_account($1,$2,$3) as id',[email,name,role]);
 const access=(id,role,active)=>db.query('select public.set_staff_access($1,$2,$3)',[id,role,active]);
 await db.exec(platform);
 for(const name of ['20261021152453_gary_home_cms.sql','20261021201948_customer_portal.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
  ('${owner}','owner@protonmail.com',now()),('${admin}','admin@garyhome.com',now()),('${staff}','staff@icue.vn',now()),
  ('${customer}','customer@gmail.com',now()),('${pending}','pending@garyhome.com',null),('${legacy}','legacy@gmail.com',now()),('${unassigned}','unassigned@garyhome.com',now());
  insert into public.team_members(user_id,role) values ('${owner}','owner'),('${legacy}','editor');
  insert into public.neighbourhoods(slug,name,image) values ('tay-ho','Tây Hồ','/image.jpg');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261022042327_customer_social_auth_staff_access.sql',import.meta.url),'utf8'));

 await t.test('the existing personal-email owner retains access while legacy personal-email staff lose it',async()=>{
  await as(owner);assert.equal(await editor(),true);assert.equal((await db.query('select role from public.team_members')).rows[0].role,'owner');
  await as(legacy);assert.equal(await editor(),false);assert.equal((await db.query('select * from public.team_members')).rows.length,0);
 });
 await t.test('personal and unassigned company customers cannot self-promote or read the staff directory',async()=>{
  for(const id of [customer,unassigned]){
   await as(id);assert.equal(await editor(),false);
   await assert.rejects(assign('unassigned@garyhome.com','Self appointed','admin'));
   await assert.rejects(db.query('select * from public.list_staff_accounts(null)'));
   await assert.rejects(db.query('insert into public.team_members(user_id,role,email) values ($1,$2,$3)',[id,'owner','unassigned@garyhome.com']));
   await assert.rejects(db.exec("insert into public.neighbourhoods(slug,name,image) values ('forged','Forged','/image.jpg')"));
  }
 });
 await t.test('metadata and a forged JWT email never override database membership or the verified Auth email',async()=>{
  await db.exec('reset role');await db.query("update auth.users set raw_user_meta_data='{"+'"role":"owner","email":"admin@garyhome.com"'+"}' where id=$1",[customer]);
  await as(customer);await db.query("select set_config('request.jwt.claim.email','admin@garyhome.com',false)");assert.equal(await editor(),false);
 });
 await t.test('owners assign only exact company-domain accounts and can appoint administrators',async()=>{
  await as(owner);
  for(const email of ['customer@gmail.com','someone@garyhome.com.evil.invalid','someone@evilgaryhome.com','someone@sub.garyhome.com'])await assert.rejects(assign(email,'Invalid domain'));
  assert.equal((await assign('ADMIN@GARYHOME.COM','Team admin','admin')).rows[0].id,admin);
  assert.equal((await assign('staff@icue.vn','Team staff')).rows[0].id,staff);
  await assert.rejects(assign('owner@protonmail.com','Owner','admin'));
  await assert.rejects(assign('missing@garyhome.com','Missing Auth account'));
 });
 await t.test('administrators manage staff but cannot appoint admins, edit other admins, or change themselves',async()=>{
  await as(admin);assert.equal(await editor(),true);
  await assign('staff@icue.vn','Managed by admin');
  await assert.rejects(assign('unassigned@garyhome.com','Escalation','admin'));
  await assert.rejects(access(admin,'editor',false));await assert.rejects(access(owner,'editor',false));
  await access(staff,'editor',false);
  await as(staff);assert.equal(await editor(),false);
  await as(admin);await access(staff,'editor',true);
  await as(staff);assert.equal(await editor(),true);
 });
 await t.test('unconfirmed invitations cannot use Studio until the company mailbox is verified',async()=>{
  await as(owner);await assign('pending@garyhome.com','Pending colleague');
  await as(pending);assert.equal(await editor(),false);
  await db.exec('reset role');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[pending]);
  await as(pending);assert.equal(await editor(),true);
 });
 await t.test('revocation takes effect with the same existing user JWT and preserves customer data',async()=>{
  await as(staff);await db.exec("insert into public.customer_profiles(full_name,email) values ('Staff customer','staff@icue.vn')");
  await as(owner);await access(staff,'editor',false);
  await as(staff);assert.equal(await editor(),false);assert.equal((await db.query('select * from public.customer_profiles')).rows.length,1);
  await assert.rejects(db.exec("insert into public.neighbourhoods(slug,name,image) values ('blocked','Blocked','/image.jpg')"));
  await as(owner);await access(staff,'editor',true);
 });
 await t.test('changing the Auth email immediately invalidates the old staff assignment',async()=>{
  await db.exec('reset role');await db.query("update auth.users set email='changed@gmail.com' where id=$1",[staff]);
  await as(staff);assert.equal(await editor(),false);
  await as(owner);await assert.rejects(access(staff,'editor',true));
  await db.exec('reset role');await db.query("update auth.users set email='staff@icue.vn' where id=$1",[staff]);
  await as(staff);assert.equal(await editor(),true);
 });
 await t.test('anonymous roles cannot execute staff RPCs; public wrappers never bypass RLS',async()=>{
  await as('','anon');
  for(const sql of ["select public.find_staff_account('staff@icue.vn','editor')","select public.assign_staff_account('staff@icue.vn','Forged','editor')","select * from public.list_staff_accounts(null)"])await assert.rejects(db.exec(sql));
  assert.deepEqual((await db.query('select email_domains from public.staff_settings')).rows[0].email_domains,['garyhome.com','icue.vn']);
  await assert.rejects(db.exec("update public.staff_settings set email_domains=array['gmail.com']"));
  await db.exec('reset role');
  const functions=(await db.query("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('find_staff_account','assign_staff_account','set_staff_access','list_staff_accounts')")).rows;
  assert.equal(functions.length,4);assert.ok(functions.every(fn=>!fn.prosecdef));
  const rls=(await db.query("select relrowsecurity from pg_class where oid='public.staff_settings'::regclass")).rows[0];assert.equal(rls.relrowsecurity,true);
 });
});


test('fresh setup and owner bootstrap establish the same company staff security model',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(platform);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 await db.exec("insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-4000-8000-000000000001','skycastle3@protonmail.com',now())");
 const ownerSetup=await readFile(new URL('../supabase/owner.sql',import.meta.url),'utf8');await db.exec(ownerSetup);await db.exec(ownerSetup);
 await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);set role authenticated;");
 const owner=(await db.query('select role,email,bootstrap_owner from public.team_members')).rows[0];
 assert.equal(owner.role,'owner');assert.equal(owner.email,'skycastle3@protonmail.com');assert.equal(owner.bootstrap_owner,true);
 assert.equal((await db.query('select private.is_editor() as value')).rows[0].value,true);
 assert.equal((await db.query('select * from public.list_staff_accounts(null)')).rows.length,1);
});
