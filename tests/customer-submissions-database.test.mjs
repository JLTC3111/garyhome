import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('feedback moderation and private assistance attribution enforce consent and assigned roles in Postgres',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const users={};let i=0;
 for(const role of ['owner','admin','manager','editor','customer','other','disabled','foreign','unconfirmed']){
  const id='10000000-0000-4000-8000-'+String(++i).padStart(12,'0');users[role]=id;
  const email=role==='owner'?'owner@protonmail.com':['customer','other','foreign'].includes(role)?role+'@example.invalid':role+'@garyhome.com';
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[id,email,role==='unconfirmed'?null:new Date().toISOString()]);
  if(!['customer','other'].includes(role))await db.query('insert into public.team_members(user_id,role,email,bootstrap_owner,active) values($1,$2,$3,$4,$5)',[id,['disabled','foreign','unconfirmed'].includes(role)?'manager':role,email,role==='owner',role!=='disabled']);
 }
 const property=(await db.query("select id from public.properties where status='published' limit 1")).rows[0].id;
 const draft=(await db.query("insert into public.properties(slug,title_en,title_vi,district_slug,address,status)values('private-assistance-test','Private','Nháp','tay-ho','Hanoi','draft')returning id")).rows[0].id;
 async function as(role,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);}
 const feedback=(publish=false)=>db.query("insert into public.feedback_submissions(name,email,rating,message,property_id,consent,publish_consent)values('A Customer','customer@example.invalid',4,'A useful and honest experience.',$1,true,$2)",[property,publish]);
 const assistance=()=>db.query("insert into public.property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent)values($1,'A Customer','customer@example.invalid','Named Helper','in_person','Hanoi office',current_date-1,true)",[property]);
 let guestReview,privateReview,ownReview,report;
 await t.test('guests submit without gaining access to private records or choosing workflow fields',async()=>{
  await as('anon');await feedback(true);await assistance();
  await assert.rejects(db.query('select * from public.feedback_submissions'));await assert.rejects(db.query('select * from public.property_assistance'));
  await assert.rejects(db.query("insert into public.feedback_submissions(name,email,rating,message,consent,status) values('Bad','bad@example.invalid',5,'Trying to approve myself',true,'approved')"));
  await assert.rejects(db.query("insert into public.feedback_submissions(user_id,name,email,rating,message,consent) values($1,'Bad','bad@example.invalid',5,'Trying to claim identity',true)",[users.other]));
  assert.deepEqual((await db.query('select * from public.feedback_public')).rows,[]);
  await as('postgres');guestReview=(await db.query('select id from public.feedback_submissions')).rows[0].id;report=(await db.query('select id from public.property_assistance')).rows[0].id;
 });
 await t.test('customers see their own submissions and cannot publish, verify or read internal notes',async()=>{
  await as('authenticated',users.customer);await feedback(false);privateReview=(await db.query('select id,user_id,status from public.feedback_submissions')).rows[0];assert.equal(privateReview.user_id,users.customer);privateReview=privateReview.id;
  await feedback(true);ownReview=(await db.query('select id from public.feedback_submissions where id<>$1',[privateReview])).rows[0].id;
  await assistance();assert.equal((await db.query('select * from public.property_assistance')).rows.length,1);
  assert.deepEqual((await db.query('select * from public.assistance_reviews')).rows,[]);
  await assert.rejects(db.query("select public.moderate_feedback($1,'approved','')",[ownReview]));
  await assert.rejects(db.query("select public.review_property_assistance($1,'verified',null,'Forged','')",[report]));
  assert.equal((await db.query("update public.feedback_submissions set status='approved' where id=$1 returning id",[ownReview])).rows.length,0);
  await as('authenticated',users.other);assert.equal((await db.query('select * from public.feedback_submissions')).rows.length,0);
  assert.equal((await db.query('delete from public.feedback_submissions where id=$1 returning id',[ownReview])).rows.length,0);
 });
 await t.test('only consented original review fields can be published, with no email or ownership leak',async()=>{
  await as('authenticated',users.editor);await assert.rejects(db.query("select public.moderate_feedback($1,'approved','Thank you')",[privateReview]),e=>e.code==='23514');
  await db.query("select public.moderate_feedback($1,'approved','Thank you for the feedback.')",[guestReview]);
  await assert.rejects(db.query("update public.feedback_public set message='A fabricated review' where id=$1",[guestReview]));
  await as('anon');const rows=(await db.query('select * from public.feedback_public')).rows;assert.equal(rows.length,1);assert.equal(rows[0].message,'A useful and honest experience.');assert.equal(rows[0].staff_reply,'Thank you for the feedback.');assert.ok(!('email' in rows[0]));assert.ok(!('user_id' in rows[0]));
  await as('authenticated',users.manager);await db.query("select public.moderate_feedback($1,'declined','')",[guestReview]);assert.equal((await db.query('select * from public.feedback_public')).rows.length,0);
 });
 await t.test('owner, admin and manager verify credit; all other identities are denied',async()=>{
  for(const role of ['owner','admin','manager']){
   await as('authenticated',users[role]);await db.query("select public.review_property_assistance($1,'verified',$2,'Named Helper','Checked the viewing record')",[report,users.editor]);
   const r=(await db.query('select * from public.assistance_reviews where report_id=$1',[report])).rows[0];assert.equal(r.reviewed_by,users[role]);assert.equal(r.credited_staff_id,users.editor);
   const choices=(await db.query('select * from public.list_attribution_staff()')).rows;assert.ok(choices.some(s=>s.user_id===users.editor));assert.ok(choices.every(s=>!('email' in s)));assert.ok(!choices.some(s=>[users.disabled,users.foreign,users.unconfirmed].includes(s.user_id)));
  }
  for(const role of ['editor','customer','disabled','foreign','unconfirmed']){await as('authenticated',users[role]);await assert.rejects(db.query("select public.review_property_assistance($1,'verified',null,'Wrong','')",[report]));assert.equal((await db.query('select * from public.list_attribution_staff()')).rows.length,0);assert.equal((await db.query('select * from public.assistance_reviews')).rows.length,0);}
  await as('authenticated',users.manager);await assert.rejects(db.query("select public.review_property_assistance($1,'verified',$2,'Wrong','')",[report,users.disabled]));
 });
 await t.test('private property IDs and future assistance dates cannot be submitted',async()=>{
  await as('anon');await assert.rejects(db.query("insert into public.feedback_submissions(name,email,rating,message,property_id,consent) values('Test','test@example.invalid',5,'A private property review',$1,true)",[draft]));
  await assert.rejects(db.query("insert into public.property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent) values($1,'Test','test@example.invalid','Helper','phone','Hanoi',current_date+2,true)",[property]));
 });
 await t.test('withdrawing owned feedback also removes its public copy',async()=>{
  await as('authenticated',users.admin);await db.query("select public.moderate_feedback($1,'approved','')",[ownReview]);
  await as('authenticated',users.customer);await db.query('delete from public.feedback_submissions where id=$1',[ownReview]);
  await as('anon');assert.equal((await db.query('select * from public.feedback_public where id=$1',[ownReview])).rows.length,0);
 });
});
