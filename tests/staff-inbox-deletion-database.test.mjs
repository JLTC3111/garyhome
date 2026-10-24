import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('assigned Gmail staff, enquiry reads and protected deletion use current database permissions',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const ids={};let next=0;
 for(const name of ['owner','admin','admin2','manager','editor','gmail','unassigned','customer','pending','disabled']){
  const id='20000000-0000-4000-8000-'+String(++next).padStart(12,'0');ids[name]=id;
  const email=name==='owner'?'owner@protonmail.com':name+(['gmail','unassigned','pending','disabled','customer'].includes(name)?'@gmail.com':'@garyhome.com');
  await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)',[id,email,name==='pending'?null:new Date().toISOString()]);
  if(!['gmail','unassigned','customer','pending','disabled'].includes(name))await db.query('insert into public.team_members(user_id,role,email,bootstrap_owner)values($1,$2,$3,$4)',[id,name==='admin2'?'admin':name,email,name==='owner']);
 }
 async function as(name){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);await db.exec('set role '+(name==='anon'?'anon':name==='root'?'postgres':'authenticated'));}
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const denied=promise=>assert.rejects(promise,error=>error.code==='42501');
 const property=(await one("select id,listing_code,address from public.properties where status='published' and listing_type='rent' limit 1"));
 let enquiry,report;

 await t.test('Gmail needs explicit assignment and verified email; unassigned accounts cannot self-promote',async()=>{
  await as('unassigned');assert.equal((await one('select private.is_editor() as allowed')).allowed,false);
  await denied(db.query("select public.assign_staff_account('unassigned@gmail.com','Self appointed','admin')"));
  await as('owner');await db.query("select public.assign_staff_account('GMAIL@GMAIL.COM','Gmail colleague','editor')");
  await db.query("select public.assign_staff_account('pending@gmail.com','Pending colleague','editor')");
  await db.query("select public.assign_staff_account('disabled@gmail.com','Disabled colleague','editor')");
  await db.query("select public.set_staff_access($1,'editor',false)",[ids.disabled]);
  await assert.rejects(db.query("select public.assign_staff_account('outsider@elsewhere.invalid','Unapproved domain','editor')"));
  await as('gmail');assert.equal((await one('select private.is_editor() as allowed')).allowed,true);
  for(const name of ['pending','disabled','customer']){await as(name);assert.equal((await one('select private.is_editor() as allowed')).allowed,false);}
  await as('root');await db.query("update auth.users set raw_user_meta_data='{"+'"role":"owner","email":"owner@protonmail.com"'+"}' where id=$1",[ids.unassigned]);
  await as('unassigned');await db.query("select set_config('request.jwt.claim.email','owner@protonmail.com',false)");assert.equal((await one('select private.is_editor() as allowed')).allowed,false);
  await as('manager');const choices=(await db.query('select * from public.list_attribution_staff()')).rows;
  assert.ok(choices.some(row=>row.user_id===ids.gmail));assert.ok(choices.every(row=>!('email' in row)));
 });

 await t.test('reading an enquiry records the first reader without changing status or concurrent staff notes',async()=>{
  await as('customer');enquiry=(await one("insert into public.enquiries(property_id,name,email,message,consent)values($1,'A Customer','customer@gmail.com','Please arrange a viewing',true)returning id",[property.id])).id;
  await denied(db.query('select public.mark_enquiry_read($1)',[enquiry]));
  await as('editor');await db.query("select public.save_customer_enquiry($1,'contacted','Existing internal follow-up',null,'We will call you')",[enquiry]);
  const first=(await one('select public.mark_enquiry_read($1) as result',[enquiry])).result;
  assert.equal(first.read_by,ids.editor);assert.ok(first.read_at);assert.equal(first.property_code,property.listing_code);
  await db.query("update public.enquiry_notes set notes='Concurrent private draft' where enquiry_id=$1",[enquiry]);
  await as('gmail');const again=(await one('select public.mark_enquiry_read($1) as result',[enquiry])).result;
  assert.deepEqual(again,first);assert.equal((await one('select notes from public.enquiry_notes where enquiry_id=$1',[enquiry])).notes,'Concurrent private draft');
  assert.equal((await one('select status from public.enquiries where id=$1',[enquiry])).status,'contacted');
  await as('customer');assert.deepEqual((await db.query('select * from public.enquiry_notes')).rows,[]);
  await assert.rejects(db.query('insert into public.enquiry_notes(enquiry_id,read_at)values($1,now())',[enquiry]));
  await as('anon');await denied(db.query('select public.mark_enquiry_read($1)',[enquiry]));
 });

 await t.test('manager, editor, customer and disabled sessions cannot delete listings or enquiries through RPC or direct RLS',async()=>{
  for(const name of ['manager','editor','gmail','customer','disabled']){
   await as(name);await denied(db.query('select public.delete_property($1)',[property.id]));await denied(db.query('select public.delete_enquiry($1)',[enquiry]));
   assert.equal((await db.query('delete from public.properties where id=$1 returning id',[property.id])).rows.length,0);
   assert.equal((await db.query('delete from public.enquiries where id=$1 returning id',[enquiry])).rows.length,0);
  }
 });

 await t.test('admin listing deletion preserves enquiry and commission evidence while clearing favourites and manual card order',async()=>{
  await as('customer');await db.query('insert into public.saved_homes(property_id)values($1)',[property.id]);
  await db.query("insert into public.property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent)values($1,'A Customer','customer@gmail.com','Gmail colleague','in_person','Hanoi office',current_date-1,true)",[property.id]);
  report=(await one('select id from public.property_assistance')).id;
  await as('admin');await db.query("select public.review_property_assistance($1,'verified',$2,'Gmail colleague','Viewing checked')",[report,ids.gmail]);
  await db.query("insert into public.property_display_orders(scope,property_ids)values('home',array[$1]::uuid[])on conflict(scope)do update set property_ids=excluded.property_ids",[property.id]);
  assert.equal((await one('select public.delete_property($1) as removed',[property.id])).removed,true);
  assert.equal((await one('select public.delete_property($1) as removed',[property.id])).removed,true,'A repeated confirmed deletion is safe');
  const savedEnquiry=await one('select property_id from public.enquiries where id=$1',[enquiry]);assert.equal(savedEnquiry.property_id,null);
  const notes=await one('select * from public.enquiry_notes where enquiry_id=$1',[enquiry]);assert.equal(notes.property_code,property.listing_code);assert.equal(notes.property_address,property.address);assert.equal(notes.notes,'Concurrent private draft');assert.equal(notes.read_by,ids.editor);
  const assistance=await one('select * from public.property_assistance where id=$1',[report]);assert.equal(assistance.property_id,null);assert.equal(assistance.property_code,property.listing_code);assert.equal(assistance.property_address,property.address);
  assert.equal((await one('select status from public.property_assistance where id=$1',[report])).status,'verified');
  assert.deepEqual((await one("select property_ids from public.property_display_orders where scope='home'")).property_ids,[]);
  await as('customer');assert.equal((await db.query('select * from public.saved_homes')).rows.length,0);assert.equal((await db.query('select * from public.property_assistance')).rows.length,1);
 });

 await t.test('reset targets use current confirmed membership and cannot cross protected role boundaries',async()=>{
  await as('owner');assert.equal((await one('select public.staff_reset_email($1) as email',[ids.gmail])).email,'gmail@gmail.com');
  assert.equal((await one('select public.staff_reset_email($1) as email',[ids.owner])).email,'owner@protonmail.com');
  for(const name of ['pending','disabled','customer'])await assert.rejects(db.query('select public.staff_reset_email($1)',[ids[name]]),error=>error.code==='23514');
  await as('admin');for(const name of ['owner','admin2'])await denied(db.query('select public.staff_reset_email($1)',[ids[name]]));
  assert.equal((await one('select public.staff_reset_email($1) as email',[ids.admin])).email,'admin@garyhome.com');
  for(const name of ['manager','editor','customer']){await as(name);await denied(db.query('select public.staff_reset_email($1)',[ids.gmail]));}
  await as('root');await db.query("update auth.users set email='changed@gmail.com' where id=$1",[ids.gmail]);
  await as('owner');await assert.rejects(db.query('select public.staff_reset_email($1)',[ids.gmail]),error=>error.code==='23514');
  await as('root');await db.query("update auth.users set email='gmail@gmail.com' where id=$1",[ids.gmail]);
 });

 await t.test('staff deletion removes only membership and protects self, owner and peer administrators',async()=>{
  await as('gmail');await db.query("insert into public.customer_profiles(full_name,email)values('Gmail colleague','gmail@gmail.com')");
  for(const name of ['manager','editor','customer']){await as(name);await denied(db.query('select public.remove_staff_access($1)',[ids.gmail]));}
  await as('admin');for(const name of ['owner','admin','admin2'])await denied(db.query('select public.remove_staff_access($1)',[ids[name]]));
  await denied(db.query('delete from public.team_members where user_id=$1 returning user_id',[ids.gmail]));
  assert.equal((await one('select public.remove_staff_access($1) as removed',[ids.gmail])).removed,true);
  await as('gmail');assert.equal((await one('select private.is_editor() as allowed')).allowed,false);assert.equal((await db.query('select * from public.customer_profiles')).rows.length,1);
  await as('owner');await denied(db.query('select public.remove_staff_access($1)',[ids.owner]));
  assert.equal((await one('select public.remove_staff_access($1) as removed',[ids.admin2])).removed,true);
  assert.equal((await one('select public.remove_staff_access($1) as removed',[ids.gmail])).removed,true);
  await as('root');assert.ok(await one('select id from auth.users where id=$1',[ids.gmail]));
  assert.equal((await one('select confirmed_helper,credited_staff_id from public.assistance_reviews where report_id=$1',[report])).confirmed_helper,'Gmail colleague');
  assert.equal((await one('select credited_staff_id from public.assistance_reviews where report_id=$1',[report])).credited_staff_id,null);
 });

 await t.test('owner enquiry deletion also deletes private notes and cannot be replayed by a revoked session',async()=>{
  await as('owner');assert.equal((await one('select public.delete_enquiry($1) as removed',[enquiry])).removed,true);
  assert.equal((await db.query('select * from public.enquiry_notes where enquiry_id=$1',[enquiry])).rows.length,0);
  await as('gmail');await denied(db.query('select public.delete_enquiry($1)',[enquiry]));
  await as('anon');await denied(db.query('select public.delete_enquiry($1)',[enquiry]));
 });
});
