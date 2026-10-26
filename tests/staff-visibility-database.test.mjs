import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
test('the database enforces peer/lower visibility across accounts, portraits and assignment directories',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const ranks={owner:4,admin:3,manager:2,editor:1},people=[];
 for(const [role] of Object.entries(ranks))for(let peer=0;peer<2;peer++){
  const id='b0000000-0000-4000-8000-'+String(people.length+1).padStart(12,'0'),name=role+(peer?'_peer':''),email=name+'@icue.vn';
  await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[id,email]);await db.query('insert into team_members(user_id,email,display_name,role)values($1,$2,$3,$4)',[id,email,name,role]);people.push({id,name,email,role});
 }
 const as=async name=>{await db.exec('reset role');const person=people.find(p=>p.name===name);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[person?.id||'']);await db.exec('set role '+(name==='root'?'postgres':name==='anon'?'anon':'authenticated'));};
 const list=async cursor=>(await db.query('select * from list_staff_accounts($1)',[cursor||null])).rows;
 const deny=promise=>assert.rejects(promise,error=>error.code==='42501');
 for(const person of people){await as(person.name);const path=person.id+'/c0000000-0000-4000-8000-000000000001.png';await db.query("insert into storage.objects(bucket_id,name)values('staff-avatars',$1)",[path]);await db.query('insert into staff_profiles(user_id,avatar_path)values($1,$2)',[person.id,path]);}
 await t.test('every role sees peers and lower roles in the raw account RPC, photo RLS and picker RPCs',async()=>{
  for(const actor of people){await as(actor.name);const expected=people.filter(person=>ranks[person.role]<=ranks[actor.role]).map(person=>person.id).sort();assert.deepEqual((await list()).map(row=>row.user_id).sort(),expected,actor.name+' directory');assert.deepEqual((await db.query('select user_id from staff_profiles')).rows.map(row=>row.user_id).sort(),expected,actor.name+' direct photo table');assert.deepEqual((await db.query('select user_id from staff_photo_directory()')).rows.map(row=>row.user_id).sort(),expected,actor.name+' photo picker');const attribution=(await db.query('select user_id from list_attribution_staff()')).rows.map(row=>row.user_id).sort();assert.deepEqual(attribution,ranks[actor.role]>=2?expected:[],actor.name+' attribution');}
 });
 await t.test('seeing a peer never permits demoting, disabling, deleting access or resetting their password',async()=>{
  for(const actor of people.filter(person=>!person.name.endsWith('_peer'))){await as(actor.name);const peer=people.find(person=>person.name===actor.name+'_peer');await deny(db.query("select set_staff_access($1,'editor',false)",[peer.id]));await deny(db.query('select remove_staff_access($1)',[peer.id]));await deny(db.query('select staff_reset_email($1)',[peer.id]));await deny(db.query('select staff_temporary_password_request($1)',[peer.id]));}
 });
 await t.test('unassigned customers and anonymous visitors cannot read private accounts or portraits',async()=>{
  await as('anon');await deny(db.query('select * from list_staff_accounts(null)'));const id='b0000000-0000-4000-8000-000000000099';await as('root');await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'customer@icue.vn',now())",[id]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');await deny(db.query('select * from list_staff_accounts(null)'));assert.deepEqual((await db.query('select user_id from staff_profiles')).rows,[]);await deny(db.query('select * from staff_photo_directory()'));
 });
 await t.test('existing higher-level commission credit survives a review but cannot be newly assigned',async()=>{
  await as('root');const property=(await db.query("select id from properties where status='published' and listing_type='rent' limit 1")).rows[0].id;
  const report=(await db.query("insert into property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent)values($1,'Review Customer','review@example.invalid','Named Helper','phone','Hanoi',current_date,true)returning id",[property])).rows[0].id;
  const owner=people.find(person=>person.name==='owner'),otherOwner=people.find(person=>person.name==='owner_peer');await as('owner');await db.query("select review_property_assistance($1,'verified',$2,'Named Helper','Original review')",[report,owner.id]);
  await as('manager');assert.ok(!(await db.query('select * from list_attribution_staff()')).rows.some(person=>person.user_id===owner.id));await db.query("select review_property_assistance($1,'verified',$2,'Named Helper','Updated notes')",[report,owner.id]);assert.equal((await db.query('select credited_staff_id from assistance_reviews where report_id=$1',[report])).rows[0].credited_staff_id,owner.id);
  await assert.rejects(db.query("select review_property_assistance($1,'verified',$2,'Named Helper','Forbidden new credit')",[report,otherOwner.id]),error=>error.code==='23514');
  await as('editor');assert.equal((await db.query('select private.can_retain_assistance_credit($1,$2) as permitted',[report,owner.id])).rows[0].permitted,false);
 });
 await t.test('pagination filters protected roles in SQL, including after an explicitly supplied higher-role cursor',async()=>{
  await as('root');for(let n=0;n<55;n++){const id='d0000000-0000-4000-8000-'+String(n+1).padStart(12,'0'),email='zz-staff'+String(n).padStart(2,'0')+'@icue.vn';await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())',[id,email]);await db.query("insert into team_members(user_id,email,display_name,role)values($1,$2,'Pagination staff','editor')",[id,email]);}
  await as('admin');const first=await list(),second=await list(first[49].email);assert.equal(first.length,51);assert.ok(second.length>0);const shown=[...first.slice(0,50),...second];assert.ok(shown.every(person=>person.role!=='owner'));assert.equal(new Set(shown.map(person=>person.user_id)).size,shown.length);assert.ok((await list('owner@icue.vn')).every(person=>person.role!=='owner'));
 });
 await t.test('existing sessions immediately follow role demotion and revoked or unconfirmed access',async()=>{
  const admin=people.find(p=>p.name==='admin');await as('owner');await db.query("select set_staff_access($1,'editor',true)",[admin.id]);await as('admin');assert.ok((await list()).every(person=>person.role==='editor'));assert.equal((await db.query('select user_id from staff_profiles')).rows.length,3);await as('owner');await db.query("select set_staff_access($1,'editor',false)",[admin.id]);await as('admin');await deny(db.query('select * from list_staff_accounts(null)'));assert.deepEqual((await db.query('select user_id from staff_profiles')).rows,[]);await as('root');const manager=people.find(p=>p.name==='manager');await db.query('update auth.users set email_confirmed_at=null where id=$1',[manager.id]);await as('manager');await deny(db.query('select * from list_staff_accounts(null)'));
 });
});
