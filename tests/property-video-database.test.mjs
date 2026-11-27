import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {supabasePlatform} from './supabase-platform.fixture.mjs';

test('listing videos enforce one stored MP4 below 50 MB with staff-only uploads and normal publication privacy',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(supabasePlatform);
 await db.exec('grant select,insert,update,delete on storage.objects to anon,authenticated');
 await db.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
 const owner='00000000-0000-4000-8000-000000000001',customer='00000000-0000-4000-8000-000000000002',file='00000000-0000-4000-8000-000000000003';
 await db.exec(`insert into auth.users(id,email,email_confirmed_at)values('${owner}','owner@protonmail.com',now()),('${customer}','customer@example.invalid',now());insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)values('${owner}','owner','owner@protonmail.com','QA owner',true);`);
 const bucket=(await db.query("select * from storage.buckets where id='listing-videos'")).rows[0];assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),49_999_999);assert.deepEqual(bucket.allowed_mime_types,['video/mp4']);
 const home=(await db.query("select id from properties where status='published' order by sort_order limit 1")).rows[0],path=`${owner}/${home.id}/${file}.mp4`,url='https://duyiihsmaqfgwezmsnjs.supabase.co/storage/v1/object/public/listing-videos/'+path;
 const as=async(role='postgres',id='')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role);};
 await as('authenticated',owner);
 await db.query("insert into storage.objects(bucket_id,name,metadata)values('listing-videos',$1,$2)",[path,{size:49_999_999,mimetype:'video/mp4'}]);
 for(const value of ['https://example.com/tour.mp4',url+'?other=video',url.replace('.mp4','.webm')])await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[value,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:50_000_000,mimetype:'video/mp4'}]);
 await as('authenticated',owner);await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[url,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:1,mimetype:'video/webm'}]);
 await as('authenticated',owner);await assert.rejects(db.query('update properties set video_url=$1 where id=$2',[url,home.id]),error=>error.code==='23514');
 await as();await db.query("update storage.objects set metadata=$2 where name=$1",[path,{size:1024,mimetype:'video/mp4'}]);
 await as('authenticated',owner);
 assert.equal((await db.query('update properties set video_url=$1 where id=$2 returning video_url',[url,home.id])).rows[0].video_url,url);
 const directDelete=()=>db.query("delete from storage.objects where bucket_id='listing-videos' and name=$1 returning id",[path]);
 assert.equal((await directDelete()).rows.length,0);
 await as('anon');assert.equal((await db.query('select video_url from properties where id=$1',[home.id])).rows[0].video_url,url);
 // Unrelated broad storage policies cannot grant customers or guests video writes.
 await as();await db.exec('create policy unrelated_permissive_storage on storage.objects for all to anon,authenticated using(true)with check(true)');
 for(const [role,id] of [['anon',''],['authenticated',customer]]){await as(role,id);await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata)values('listing-videos',$1,$2)",[`${customer}/${home.id}/${file}.mp4`,{size:5,mimetype:'video/mp4'}]),error=>error.code==='42501');assert.equal((await db.query("delete from storage.objects where bucket_id='listing-videos' returning id")).rows.length,0);assert.equal((await db.query("update storage.objects set name='forged.mp4' where bucket_id='listing-videos' returning id")).rows.length,0);}
 await as('authenticated',owner);
 await db.query('update properties set video_url=null where id=$1',[home.id]);
 assert.equal((await directDelete()).rows.length,0,'direct Storage deletion stays blocked after detach');
 await as();
 const {rows:[receipt]}=await db.query(`select id,source,state,
   (extract(epoch from expires_at-unreferenced_since)/3600)::int as hours
   from private.home_media_items where bucket='listing-videos' and name=$1`,[path]);
 assert.deepEqual({source:receipt.source,state:receipt.state,hours:receipt.hours},{source:'detached',state:'candidate',hours:48});
 await db.exec('update private.home_media_control set permanent_enabled=true where singleton');

 const claim=async()=> (await db.query('select public.home_media_claim() value')).rows[0].value;
 const finish=job=>db.query('select public.home_media_finish($1)',[job.id]);
 await as('service_role');
 const beforeExpiry=await claim();
 assert.deepEqual(beforeExpiry.items,[]);
 await finish(beforeExpiry);
 await as();
 await db.query("update private.home_media_items set expires_at=now()-interval '1 second' where id=$1",[receipt.id]);
 await as('service_role');
 const afterExpiry=await claim();
 assert.deepEqual(afterExpiry.items.map(item=>item.id),[receipt.id]);
 const {rows:[target]}=await db.query('select public.home_media_target($1,$2,true) value',[afterExpiry.id,receipt.id]);
 assert.deepEqual(target.value,{bucket:'listing-videos',name:path,present:true,replacementKey:null,replacementSha256:null});
 await finish(afterExpiry);
 await as();
 assert.equal((await db.query('select 1 from storage.objects where bucket_id=$1 and name=$2',['listing-videos',path])).rows.length,1);
});
