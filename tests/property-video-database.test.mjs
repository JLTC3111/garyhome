import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('listing videos enforce one stored MP4 below 50 MB with staff-only uploads and normal publication privacy',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,created_at timestamptz default now());
 alter table storage.objects enable row level security;grant usage on schema auth,public,storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated;`);
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const owner='00000000-0000-4000-8000-000000000001',customer='00000000-0000-4000-8000-000000000002',file='00000000-0000-4000-8000-000000000003';
 await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@protonmail.com',now()),('${customer}','customer@example.invalid',now());insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)values('${owner}','owner','owner@protonmail.com','QA owner',true);`);
 const bucket=(await db.query("select * from storage.buckets where id='listing-videos'")).rows[0];assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),49_999_999);assert.deepEqual(bucket.allowed_mime_types,['video/mp4']);
 const home=(await db.query('select id from properties order by sort_order limit 1')).rows[0],path=`${owner}/${home.id}/${file}.mp4`,url='https://duyiihsmaqfgwezmsnjs.supabase.co/storage/v1/object/public/listing-videos/'+path;
 const as=async(role='postgres',id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);};
 await as('authenticated',owner);
 await db.query("insert into storage.objects(bucket_id,name,metadata)values('listing-videos',$1,$2)",[path,{size:49_999_999,mimetype:'video/mp4'}]);
 assert.equal((await db.query('update properties set video_url=$1 where id=$2 returning video_url',[url,home.id])).rows[0].video_url,url);
 await assert.rejects(db.query("delete from storage.objects where bucket_id='listing-videos' and name=$1 returning id",[path]).then(result=>{if(!result.rows.length)throw Object.assign(new Error(),{code:'42501'});}),error=>error.code==='42501');
 for(const value of ['https://example.com/tour.mp4',url+'?other=video',url.replace('.mp4','.webm')])await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[value,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:50_000_000,mimetype:'video/mp4'}]);
 await as('authenticated',owner);await db.query('update properties set video_url=null where id=$1',[home.id]);await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[url,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:1,mimetype:'video/webm'}]);
 await as('authenticated',owner);await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[url,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:1024,mimetype:'video/mp4'}]);
 await as('authenticated',owner);await db.query('update properties set video_url=$1 where id=$2',[url,home.id]);
 await as('anon');assert.equal((await db.query('select video_url from properties where id=$1',[home.id])).rows[0].video_url,url);
 // Unrelated broad storage policies cannot grant customers or guests video writes.
 await as();await db.exec('create policy unrelated_permissive_storage on storage.objects for all to anon,authenticated using(true)with check(true)');
 for(const [role,id] of [['anon',''],['authenticated',customer]]){await as(role,id);await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata)values('listing-videos',$1,$2)",[`${customer}/${home.id}/${file}.mp4`,{size:5,mimetype:'video/mp4'}]),error=>error.code==='42501');assert.equal((await db.query("delete from storage.objects where bucket_id='listing-videos' returning id")).rows.length,0);assert.equal((await db.query("update storage.objects set name='forged.mp4' where bucket_id='listing-videos' returning id")).rows.length,0);}
 await as('authenticated',owner);await db.query('update properties set video_url=null where id=$1',[home.id]);assert.equal((await db.query("delete from storage.objects where bucket_id='listing-videos' and name=$1 returning id",[path])).rows.length,1);
});
