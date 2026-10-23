import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('the fresh-project setup includes every rental schema item and public source seed',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 await db.exec('set role anon');assert.equal((await db.query('select id,listing_code,author_id from public.properties')).rows.length,15);
 assert.equal((await db.query('select id from public.listing_authors')).rows.length,1);
 assert.equal((await db.query('select id from public.site_activities')).rows.length,6);
 await assert.rejects(db.exec('select * from public.rental_cart'));
});

test('rental catalogue, public authors, media and carts enforce their real Postgres permissions',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const owner='00000000-0000-4000-8000-000000000001',alice='00000000-0000-4000-8000-000000000002',bob='00000000-0000-4000-8000-000000000003';
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
 alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
 for(const name of ['20261021152453_gary_home_cms.sql','20261021201948_customer_portal.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@protonmail.com',now()),('${alice}','alice@example.invalid',now()),('${bob}','bob@example.invalid',now());insert into public.team_members(user_id,role) values('${owner}','owner');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261022042327_customer_social_auth_staff_access.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261023093632_rental_catalogue_brand_and_authors.sql',import.meta.url),'utf8'));
 async function as(role='postgres',id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
 const home=(await db.query('select id,listing_code from public.properties order by sort_order limit 1')).rows[0];
 let sale,draft;
 await t.test('IDs are unique, permanent and assigned to future listings; lease lengths remain unconfirmed',async()=>{
  const rows=(await db.query('select listing_code,rental_term,author_id from public.properties')).rows;
  assert.equal(rows.length,15);assert.equal(new Set(rows.map(p=>p.listing_code)).size,15);assert.ok(rows.every(p=>/^GH-\d{6}$/.test(p.listing_code)&&p.rental_term==='on_request'&&p.author_id));
  await as('authenticated',owner);
  await assert.rejects(db.query("update public.properties set listing_code='GH-999999' where id=$1",[home.id]));
  sale=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,images,status,listing_type) values('test-sale','Sale','Bán','tay-ho','Tây Hồ',array['/images/hero.jpg'],'published','sale') returning id,listing_code")).rows[0];
  draft=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,status) values('test-draft','Draft','Nháp','tay-ho','Tây Hồ','draft') returning id,listing_code")).rows[0];
  assert.notEqual(sale.listing_code,home.listing_code);assert.notEqual(draft.listing_code,sale.listing_code);
 });
 await t.test('anonymous visitors see rentals and approved placeholder/media content but cannot write it',async()=>{
  await as('anon');const properties=(await db.query('select * from public.properties')).rows;
  assert.equal(properties.length,15);assert.ok(properties.every(p=>p.listing_type==='rent'));
  const authors=(await db.query('select * from public.listing_authors')).rows;assert.equal(authors.length,1);assert.equal(authors[0].is_placeholder,true);assert.equal(authors[0].portrait_url,'');
  const activities=(await db.query('select * from public.site_activities')).rows;assert.equal(activities.length,6);assert.ok(activities.every(a=>a.category==='feedback'&&a.media_kind==='photo'));
  await assert.rejects(db.exec("insert into public.listing_authors(slug,display_name)values('attack','Attack')"));
  await assert.rejects(db.exec("update public.site_activities set published=false"));
  await assert.rejects(db.exec('select * from public.rental_cart'));
 });
 await t.test('ordinary customers cannot read unpublished author/media drafts or grant themselves publishing access',async()=>{
  await as('authenticated',owner);await db.exec("insert into public.listing_authors(slug,display_name,bio_en)values('private-profile','Draft specialist','Private unpublished bio');insert into public.site_activities(category,image_url,caption_en)values('team','/images/hero.jpg','Private media draft');");
  await as('authenticated',alice);assert.equal((await db.query('select * from public.listing_authors')).rows.length,1);assert.equal((await db.query('select * from public.site_activities')).rows.length,6);
  assert.equal((await db.query("update public.listing_authors set published=true returning id")).rows.length,0);
  await assert.rejects(db.exec("insert into public.site_activities(category,image_url)values('team','/images/hero.jpg')"));
 });
 await t.test('carts belong only to their customer and cannot contain sale or draft listings',async()=>{
  await as('authenticated',alice);await db.query('insert into public.rental_cart(user_id,property_id)values($1,$2)',[alice,home.id]);
  await assert.rejects(db.query('insert into public.rental_cart(user_id,property_id)values($1,$2)',[bob,home.id]));
  for(const property of [sale,draft])await assert.rejects(db.query('insert into public.rental_cart(user_id,property_id)values($1,$2)',[alice,property.id]));
  await as('authenticated',bob);assert.equal((await db.query('select * from public.rental_cart')).rows.length,0);assert.equal((await db.query('delete from public.rental_cart returning property_id')).rows.length,0);
  await as('authenticated',owner);assert.equal((await db.query('select * from public.rental_cart')).rows.length,0);
  await as('authenticated',alice);assert.equal((await db.query('delete from public.rental_cart returning property_id')).rows.length,1);
 });
 await t.test('a multi-property request is atomic and rejects unavailable inventory',async()=>{
  await as('anon');await assert.rejects(db.query("insert into public.enquiries(property_id,name,email,message,kind,consent)values($1,'Test guest','guest@example.invalid','Please arrange these viewings.','viewing',true),($2,'Test guest','guest@example.invalid','Please arrange these viewings.','viewing',true)",[home.id,sale.id]));
  await as();assert.equal((await db.query('select count(*)::int n from public.enquiries')).rows[0].n,0);
 });
 await t.test('an imported conflicting location is retained privately for staff review',async()=>{
  await as();await db.exec("insert into public.properties(slug,title_en,title_vi,district_slug,address,status,images)values('beautiful-apartment-with-one-bedroom-peaceful-place','Unverified source','Nguồn chưa xác minh','tay-ho','Tỉnh Lào Cai, Việt Nam','published',array['/images/hero.jpg'])");
  await db.exec(await readFile(new URL('../supabase/migrations/20261023113426_quarantine_unverified_rental_location.sql',import.meta.url),'utf8'));
  await as('anon');assert.equal((await db.query("select id from public.properties where slug='beautiful-apartment-with-one-bedroom-peaceful-place'")).rows.length,0);
  await as('authenticated',owner);const row=(await db.query("select status,address from public.properties where slug='beautiful-apartment-with-one-bedroom-peaceful-place'")).rows[0];assert.equal(row.status,'draft');assert.equal(row.address,'Tỉnh Lào Cai, Việt Nam');
 });
 await t.test('every new public table has RLS and no privileged public functions were added',async()=>{
  await as();const rows=(await db.query("select relname,relrowsecurity from pg_class where oid in ('public.listing_authors'::regclass,'public.site_activities'::regclass,'public.rental_cart'::regclass)")).rows;assert.equal(rows.length,3);assert.ok(rows.every(row=>row.relrowsecurity));
  const functions=(await db.query("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like '%rental%' ")).rows;assert.ok(functions.every(fn=>!fn.prosecdef));
 });
 await t.test('the single-shortlist migration preserves customer ownership, retires cart access and moves photos to Customers',async()=>{
  await as();const second=(await db.query('select id from public.properties where status=\'published\' and listing_type=\'rent\' and id<>$1 limit 1',[home.id])).rows[0].id;
  await db.query('insert into public.saved_homes(user_id,property_id)values($1,$2)',[alice,home.id]);
  await db.query('insert into public.rental_cart(user_id,property_id)values($1,$2),($3,$4)',[alice,home.id,bob,second]);
  const migration=await readFile(new URL('../supabase/migrations/20261023120537_restore_hero_and_unify_favourites.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query('select count(*)::int n from public.rental_cart')).rows[0].n,2);
  await as('authenticated',alice);assert.deepEqual((await db.query('select property_id from public.saved_homes')).rows.map(p=>p.property_id),[home.id]);await assert.rejects(db.exec('select * from public.rental_cart'));
  await as('authenticated',bob);assert.deepEqual((await db.query('select property_id from public.saved_homes')).rows.map(p=>p.property_id),[second]);
  await as('anon');assert.equal((await db.query("select id from public.site_activities where category='customers'")).rows.length,6);assert.equal((await db.query("select id from public.site_activities where category='feedback' and media_kind='photo'")).rows.length,0);
  assert.equal((await db.query('select hero_title_en from public.site_settings')).rows[0].hero_title_en,'Find a place.\nFeel at home.');
 });
});
