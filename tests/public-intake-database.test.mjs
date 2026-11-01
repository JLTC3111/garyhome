import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('public intake requires the trusted boundary and durably enforces quotas and verified ownership', async t => {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,created_at timestamptz default now());
 alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const customer='90000000-0000-4000-8000-000000000001',other='90000000-0000-4000-8000-000000000002';
 await db.query('insert into auth.users(id,email,email_confirmed_at)values($1,$3,now()),($2,$3,now())',[customer,other,'customer@example.invalid']);
 const property=(await db.query("select id from public.properties where status='published' and listing_type='rent' limit 1")).rows[0].id;
 const details={name:'Audit Customer',email:'customer@example.invalid',message:'Please help me find a home.',consent:true,property_id:property,rating:5,publish_consent:true,helper_name:'Team Helper',channel:'phone',helped_where:'Hanoi',helped_on:'2026-01-12'};
 const as=async(role,uid='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role '+role);};
 const submit=async(channel,key,user=customer,input=details)=>(await db.query('select public.submit_public_intake($1,$2,$3,$4::jsonb) as id',[channel,key.repeat(64),user,JSON.stringify(input)])).rows[0].id;
 for(const role of ['anon','authenticated']){
  await as(role,role==='authenticated'?customer:'');
  for(const table of ['enquiries','feedback_submissions','property_assistance'])assert.equal((await db.query('select has_any_column_privilege(current_user,$1,\'INSERT\') as allowed',[table])).rows[0].allowed,false);
  await assert.rejects(db.exec("insert into enquiries(name,email,message,consent) values('Direct guest','guest@example.invalid','Bypassing the website is forbidden.',true)"),e=>e.code==='42501');
  await assert.rejects(submit('enquiry','a'),e=>e.code==='42501');
  await assert.rejects(db.exec('select * from private.public_intake_limits'),e=>e.code==='42501');
 }
 await as('service_role');
 const enquiry=await submit('enquiry','a',customer,{...details,user_id:other,status:'scheduled',notes:'forged',customer_update:'forged'});
 const stored=(await db.query('select user_id,status,notes,customer_update from enquiries where id=$1',[enquiry])).rows[0];
 assert.deepEqual(stored,{user_id:customer,status:'new',notes:'',customer_update:''});
 for(let n=1;n<5;n++)assert.ok(await submit('enquiry','a'));
 assert.equal(await submit('enquiry','a'),null,'the sixth request is rejected across server instances');
 assert.ok(await submit('enquiry','b'),'another visitor has its own quota');
 const feedback=await submit('feedback','a',null,{...details,user_id:other,status:'approved'});
 assert.deepEqual((await db.query('select user_id,status from feedback_submissions where id=$1',[feedback])).rows[0],{user_id:null,status:'pending'});
 const assistance=await submit('assistance','a');
 assert.deepEqual((await db.query('select user_id,status from property_assistance where id=$1',[assistance])).rows[0],{user_id:customer,status:'submitted'});
 await db.exec("update private.public_intake_limits set window_started=now()-interval '11 minutes' where channel='enquiry'");
 assert.ok(await submit('enquiry','a'),'quota becomes available after its window');
 await assert.rejects(submit('enquiry','c',customer,{...details,message:'short'}),e=>e.code==='23514');
 assert.equal((await db.query("select count(*)::int n from private.public_intake_limits where client_key=$1",['c'.repeat(64)])).rows[0].n,0,'a failed insert rolls back its reservation');
 await as('postgres');
 await db.query("update properties set status='draft' where id=$1",[property]);
 await as('service_role');
 await assert.rejects(submit('feedback','d'),e=>e.code==='23514','service writes still require a public rental');
});
