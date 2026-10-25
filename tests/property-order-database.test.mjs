import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('published card ordering enforces assigned roles, ownership of staff access and concurrent edits in Postgres',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const users={};let i=0;for(const role of ['owner','admin','manager','editor','customer','foreign','unconfirmed','disabled','new-manager']){
  const id='00000000-0000-4000-8000-'+String(++i).padStart(12,'0');users[role]=id;
  const email=role==='owner'?'owner@protonmail.com':role==='foreign'?'foreign@example.invalid':role==='customer'?'customer@example.invalid':role+'@garyhome.com';
  await db.query("insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)values($1,$2,$3,'{\"role\":\"owner\"}')",[id,email,role==='unconfirmed'?null:new Date().toISOString()]);
  if(!['customer','new-manager'].includes(role))await db.query('insert into public.team_members(user_id,role,email,bootstrap_owner,active)values($1,$2,$3,$4,$5)',[id,['foreign','unconfirmed','disabled'].includes(role)?'manager':role,email,role==='owner',role!=='disabled']);
 }
 const homes=(await db.query("select id from public.properties where status='published' order by id limit 3")).rows.map(p=>p.id);
 async function as(role,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
 const save=(scope,ids,expected=[])=>db.query('select public.save_property_order($1,$2::uuid[],$3::uuid[])',[scope,ids,expected]);
 await t.test('owner, admin and confirmed company managers can save; all other callers are denied',async()=>{
  for(const role of ['owner','admin','manager']){await as('postgres');await db.exec('delete from public.property_display_orders');await as('authenticated',users[role]);await save('home',homes);assert.deepEqual((await db.query("select property_ids from public.property_display_orders where scope='home'")).rows[0].property_ids,homes);}
  for(const role of ['editor','customer','foreign','unconfirmed','disabled']){await as('authenticated',users[role]);await assert.rejects(save('home',homes,homes));await assert.rejects(db.query("insert into public.property_display_orders(scope,property_ids)values('listings',$1)",[homes]));}
  await as('anon');await assert.rejects(save('home',homes,homes));assert.equal((await db.query('select scope from public.property_display_orders')).rows.length,1);
 });
 await t.test('scopes are independent and stale editors cannot overwrite a newer saved order',async()=>{
  await as('authenticated',users.manager);const reversed=[...homes].reverse();await save('home',reversed,homes);await save('listings',homes,[]);
  await assert.rejects(save('home',homes,homes),e=>e.code==='40001');const rows=(await db.query('select scope,property_ids from public.property_display_orders')).rows;
  assert.deepEqual(rows.find(r=>r.scope==='home').property_ids,reversed);assert.deepEqual(rows.find(r=>r.scope==='listings').property_ids,homes);
  await save('home',[],reversed);assert.deepEqual((await db.query("select property_ids from public.property_display_orders where scope='home'")).rows[0].property_ids,[]);
 });
 await t.test('RPC and direct writes reject duplicates, unknown IDs and nonpublic properties',async()=>{
  await as('authenticated',users.manager);for(const ids of [[homes[0],homes[0]],['ffffffff-ffff-4fff-8fff-ffffffffffff'],[null]]){await assert.rejects(save('home',ids,[]));await assert.rejects(db.query("update public.property_display_orders set property_ids=$1 where scope='home'",[ids]));}
  const draft=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,status)values('ordering-private','Private','Nháp','tay-ho','Hanoi','draft')returning id")).rows[0].id;await assert.rejects(save('home',[draft],[]));await assert.rejects(save('other',homes,[]));
 });
 await t.test('manager is assignable by an administrator and can administer lower staff only',async()=>{
  await as('authenticated',users.admin);await db.query("select public.assign_staff_account('new-manager@garyhome.com','New Manager','manager')");
  await as('authenticated',users['new-manager']);assert.equal((await db.query('select private.staff_role() role,private.is_editor() editor')).rows[0].role,'manager');assert.equal((await db.query('select private.is_editor() editor')).rows[0].editor,true);const managed=(await db.query('select * from public.list_staff_accounts(null)')).rows;assert.ok(managed.every(m=>m.user_id===users['new-manager']||m.role==='editor'));await assert.rejects(db.query("select public.assign_staff_account('editor@garyhome.com','Editor','manager')"));
  await as('authenticated',users.admin);await assert.rejects(db.query("select public.assign_staff_account('new-manager@garyhome.com','New Manager','admin')"));
 });
 await t.test('publication time is stamped when a draft goes public and cannot be forged on an edit',async()=>{
  await as('authenticated',users.editor);const p=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,status,images,published_at)values('publication-check','Publication','Đăng tin','tay-ho','Hanoi','draft',array['/images/apartments/hero.jpg'],'2000-01-01')returning id,published_at")).rows[0];assert.equal(p.published_at,null);
  const published=(await db.query("update public.properties set status='published' where id=$1 returning published_at",[p.id])).rows[0].published_at;assert.ok(Date.now()-Date.parse(published)<10000);
  assert.equal((await db.query("update public.properties set published_at='2000-01-01' where id=$1 returning published_at",[p.id])).rows[0].published_at.getTime(),published.getTime());
 });
});
