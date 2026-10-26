import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';

test('direct staff roles, profile photos and persistent activity obey fresh database permissions',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());alter table storage.objects enable row level security;
 grant usage on schema auth,public,storage to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const ids={},emails={};let next=0;
 for(const name of ['owner','admin','admin2','manager','manager2','staff','customer','pending','unassigned']){
  const id='30000000-0000-4000-8000-'+String(++next).padStart(12,'0');ids[name]=id;emails[name]=name==='owner'?'owner@protonmail.com':name+'@gmail.com';
  await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$2,$3)',[id,emails[name],name==='pending'?null:new Date().toISOString()]);
  if(!['customer','pending','unassigned'].includes(name))await db.query('insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)values($1,$2,$3,$4,$5)',[id,name==='admin2'?'admin':name==='manager2'?'manager':name==='staff'?'editor':name,emails[name],name+' team',name==='owner']);
 }
 const as=async(name)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);await db.exec('set role '+(name==='root'?'postgres':name==='anon'?'anon':'authenticated'));};
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const denied=p=>assert.rejects(p,e=>e.code==='42501');
 const assign=(name,role)=>db.query('select public.assign_staff_account($1,$2,$3) as id',[emails[name],name+' assigned',role]);
 const notifications=async(args=[])=> (await one('select public.get_studio_notifications('+args.map((_,i)=>'$'+(i+1)).join(',')+') as data',args)).data;
 let author,firstPhoto;
 await t.test('every creator is restricted to lower roles, including when demoting an existing peer',async()=>{
  for(const [actor,allowed] of [['owner',['admin','manager','editor']],['admin',['manager','editor']],['manager',['editor']]]){
   await as(actor);
   for(const role of ['owner','admin','manager','editor']){
    if(allowed.includes(role))assert.equal((await db.query('select public.find_staff_account($1,$2) as id',[emails.unassigned,role])).rows[0].id,ids.unassigned);
    else await denied(db.query('select public.find_staff_account($1,$2)',[emails.unassigned,role]));
   }
  }
  await as('admin');await denied(assign('admin2','editor'));await assert.rejects(assign('owner','editor'));
  await as('manager');await denied(assign('manager2','editor'));await denied(assign('manager','editor'));
  await as('staff');await denied(assign('unassigned','editor'));assert.ok((await db.query('select * from public.list_staff_accounts(null)')).rows.every(member=>member.role==='editor'));
 });
 await t.test('managers can add and control staff; directory results include peers and omit higher roles',async()=>{
  await as('manager');await assign('customer','editor');await db.query("select public.set_staff_access($1,'editor',false)",[ids.customer]);
  const directory=(await db.query('select * from public.list_staff_accounts(null)')).rows;
  assert.ok(directory.some(m=>m.user_id===ids.manager));assert.ok(directory.some(m=>m.user_id===ids.staff));assert.ok(directory.some(m=>m.user_id===ids.manager2));assert.ok(!directory.some(m=>[ids.owner,ids.admin,ids.admin2].includes(m.user_id)));
  await denied(db.query('select public.remove_staff_access($1)',[ids.staff]));
  await db.query("select public.set_staff_access($1,'editor',true)",[ids.customer]);
 });
 await t.test('a pending mailbox can be assigned but cannot use staff tools until verified',async()=>{
  await as('owner');await assign('pending','editor');await as('pending');assert.equal((await one('select private.is_editor() as allowed')).allowed,false);await denied(db.query('select public.get_staff_profile()'));await denied(db.query('select public.get_studio_notifications()'));
  await as('root');await db.query('update auth.users set email_confirmed_at=now() where id=$1',[ids.pending]);await as('pending');assert.equal((await one('select private.is_editor() as allowed')).allowed,true);
 });
 await t.test('new accounts have a password reminder which only they can clear; profile reads cannot select another user',async()=>{
  await as('staff');let profile=(await one('select public.get_staff_profile() as data')).data;assert.equal(profile.user_id,ids.staff);assert.equal(profile.password_change_reminder,true);
  await denied(db.query('update public.team_members set password_change_reminder=false where user_id=$1',[ids.admin]));
  await db.query('select public.acknowledge_staff_password_reminder()');profile=(await one('select public.get_staff_profile() as data')).data;assert.equal(profile.password_change_reminder,false);
  assert.ok((await notifications()).items.some(n=>n.action==='password.reminder_cleared'&&n.target_user_id===ids.staff));
 });
 await t.test('photo upload and profile writes are scoped to the authenticated staff owner',async()=>{
  await as('staff');firstPhoto=ids.staff+'/40000000-0000-4000-8000-000000000001.png';
  await denied(db.query("insert into storage.objects(bucket_id,name)values('staff-avatars',$1)",[ids.admin+'/40000000-0000-4000-8000-000000000001.png']));
  await db.query("insert into storage.objects(bucket_id,name)values('staff-avatars',$1)",[firstPhoto]);
  await db.query('insert into public.staff_profiles(user_id,avatar_path)values($1,$2) on conflict(user_id) do update set user_id=excluded.user_id,avatar_path=excluded.avatar_path returning user_id',[ids.staff,firstPhoto]);
  await db.query('insert into public.staff_profiles(user_id,avatar_path)values($1,$2) on conflict(user_id) do update set user_id=excluded.user_id,avatar_path=excluded.avatar_path returning user_id',[ids.staff,firstPhoto]);
  await denied(db.query('update public.staff_profiles set user_id=$1 where user_id=$2',[ids.admin,ids.staff]));
  await denied(db.query('insert into public.staff_profiles(user_id,avatar_path)values($1,$2)',[ids.admin,ids.admin+'/40000000-0000-4000-8000-000000000001.png']));
  await assert.rejects(db.query('update public.staff_profiles set avatar_path=$1 where user_id=$2',[ids.staff+'/missing.png',ids.staff]));
  const stored=await one('select avatar_path from public.staff_profiles where user_id=$1',[ids.staff]);assert.equal(stored.avatar_path,firstPhoto);
 });
 await t.test('linked published authors follow photo updates; unlinked private avatars stay out of anonymous reads',async()=>{
  await as('owner');author=(await one("insert into public.listing_authors(slug,display_name,staff_user_id,published)values('staff-contact','Approved Staff Contact',$1,true)returning id,portrait_url",[ids.staff]));assert.ok(author.portrait_url.startsWith('/api/staff-avatar/'+ids.staff));
  const ownPath=ids.owner+'/40000000-0000-4000-8000-000000000002.jpg';await db.query("insert into storage.objects(bucket_id,name)values('staff-avatars',$1)",[ownPath]);await db.query('insert into public.staff_profiles(user_id,avatar_path)values($1,$2)',[ids.owner,ownPath]);
  await as('anon');const visible=(await db.query('select user_id,avatar_path from public.staff_profiles')).rows;assert.deepEqual(visible.map(p=>p.user_id),[ids.staff]);
  await as('staff');const nextPhoto=ids.staff+'/40000000-0000-4000-8000-000000000003.webp';await db.query("insert into storage.objects(bucket_id,name)values('staff-avatars',$1)",[nextPhoto]);await db.query('update public.staff_profiles set avatar_path=$1 where user_id=$2',[nextPhoto,ids.staff]);
  const changed=await one('select portrait_url from public.listing_authors where id=$1',[author.id]);assert.ok(changed.portrait_url.startsWith('/api/staff-avatar/'+ids.staff));assert.notEqual(changed.portrait_url,author.portrait_url);
  assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',['staff-avatars',nextPhoto])).rows.length,0,'The current photo cannot be deleted while referenced');
  await db.query('delete from storage.objects where bucket_id=$1 and name=$2',['staff-avatars',firstPhoto]);
 });
 await t.test('team activity is durable, permissions hide higher-role activity, and clients cannot forge notifications',async()=>{
  await as('owner');const all=await notifications();assert.ok(all.items.some(n=>n.action==='team.created'));assert.ok(all.items.some(n=>n.action==='team.disabled'));assert.ok(all.items.some(n=>n.action==='profile.photo_changed'));
  assert.ok(all.items.every(n=>!Object.hasOwn(n.details,'password')&&!Object.hasOwn(n.details,'email')));
  await as('manager');const manager=await notifications();assert.ok(!manager.items.some(n=>n.target_user_id===ids.admin||n.target_user_id===ids.owner));
  await as('staff');const staff=await notifications();assert.ok(staff.items.filter(n=>['team','profile'].includes(n.category)).every(n=>n.target_user_id===ids.staff||n.actor_user_id===ids.staff));
  await denied(db.query("insert into public.studio_notifications(category,action)values('team','Forged')"));
  await denied(db.query('delete from public.studio_notifications'));
 });
 await t.test('new enquiries, feedback and assistance create staff notifications without exposing customer messages or email',async()=>{
  await as('root');const property=(await one("select id from public.properties where status='published' limit 1")).id;
  await as('anon');await db.query("insert into public.enquiries(name,email,message,consent)values('Guest Name','guest@example.invalid','Private customer message',true)");
  await db.query("insert into public.feedback_submissions(name,email,rating,message,consent)values('Guest Name','guest@example.invalid',4,'Private review message',true)");
  await db.query("insert into public.property_assistance(property_id,name,email,helper_name,channel,helped_where,helped_on,consent)values($1,'Guest Name','guest@example.invalid','Named helper','phone','Hanoi',current_date,true)",[property]);
  await denied(db.query('select public.get_studio_notifications()'));
  await as('staff');const visible=await notifications();assert.ok(visible.items.some(n=>n.category==='enquiry'));assert.ok(visible.items.some(n=>n.category==='feedback'));assert.ok(!visible.items.some(n=>n.category==='commission'));assert.ok(!JSON.stringify(visible).includes('guest@example.invalid'));assert.ok(!JSON.stringify(visible).includes('Private customer message'));
  await as('manager');assert.ok((await notifications()).items.some(n=>n.category==='commission'));
 });
 await t.test('Auth account deletion preserves activity snapshots without blocking the cascade',async()=>{
  await as('root');await db.query('delete from auth.users where id=$1',[ids.customer]);
  await as('owner');const log=await notifications();assert.ok(log.items.some(n=>n.action==='team.deleted'&&n.target_name==='customer assigned'&&n.target_user_id===null));
 });
 await t.test('read markers are private and older pages keep stable non-duplicated cursors',async()=>{
  await as('staff');assert.ok((await notifications()).unread_count>0);await db.query('select public.mark_studio_notifications_read()');assert.equal((await notifications()).unread_count,0);
  await as('owner');assert.ok((await notifications()).unread_count>0);const page1=await notifications([null,null,2]);const last=page1.items.at(-1);const page2=await notifications([last.created_at,last.id,2]);assert.ok(page1.items.every(a=>page2.items.every(b=>a.id!==b.id)));
  await as('unassigned');await denied(db.query('select public.get_studio_notifications()'));
 });
 await t.test('temporary-password requests enforce lower roles, reactivate the reminder and never accept or log passwords',async()=>{
  await as('staff');await db.query('select public.acknowledge_staff_password_reminder()');
  for(const [actor,target] of [['owner','admin'],['admin','manager'],['manager','staff']]){
   await as(actor);assert.equal((await one('select public.staff_temporary_password_request($1,false) as email',[ids[target]])).email,emails[target]);
  }
  await as('staff');assert.equal((await one('select public.get_staff_profile() as data')).data.password_change_reminder,true);
  for(const [actor,target] of [['owner','owner'],['admin','admin'],['admin','admin2'],['admin','owner'],['manager','manager'],['manager','manager2'],['manager','admin'],['staff','pending']]){
   await as(actor);await denied(db.query('select public.staff_temporary_password_request($1,false)',[ids[target]]));
  }
  await as('owner');await assert.rejects(db.query('select public.staff_temporary_password_request($1,false)',[ids.unassigned]),e=>e.code==='23514');
  await db.query("select public.set_staff_access($1,'editor',false)",[ids.pending]);await assert.rejects(db.query('select public.staff_temporary_password_request($1,false)',[ids.pending]),e=>e.code==='23514');await db.query("select public.set_staff_access($1,'editor',true)",[ids.pending]);
  await as('staff');await db.query('select public.acknowledge_staff_password_reminder()');await as('owner');await db.query('select public.staff_temporary_password_request($1,true)',[ids.staff]);
  const log=await notifications();assert.ok(log.items.some(n=>n.action==='password.temporary_requested'));assert.ok(log.items.some(n=>n.action==='password.temporary_failed'));assert.ok(log.items.every(n=>!Object.hasOwn(n.details,'password')&&!Object.hasOwn(n.details,'email')));
  await as('staff');assert.equal((await one('select public.get_staff_profile() as data')).data.password_change_reminder,false,'Recording failure alone must not re-enable the reminder');
  await as('anon');await denied(db.query('select public.staff_temporary_password_request($1,false)',[ids.staff]));
 });

});
