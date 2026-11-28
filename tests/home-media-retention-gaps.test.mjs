import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { supabasePlatform } from './supabase-platform.fixture.mjs';

const migration='20261128072734_home_media_retention_gaps.sql';
const owner='00000000-0000-4000-8000-000000000001',staff='00000000-0000-4000-8000-000000000002';
const bucket='property-media';
const photoUrl=key=>'https://fixture.example/storage/v1/object/public/property-media/'+key.split('/').map(encodeURIComponent).join('/');

test('expanded Home retention stays bounded and shares live evidence across Owner reads and cleanup',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(supabasePlatform);
  await db.exec(`create table public.jobs_cms_entries(body jsonb not null);
    create table public.gary_cms_entries(body jsonb not null);`);
  const setup=await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8');
  const migrationSql=await readFile(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8');
  await db.exec(setup.split('-- Migration: '+migration)[0]);
  await db.exec(`
    insert into auth.users(id,email,email_confirmed_at) values
      ('${owner}','owner@protonmail.com',now()),('${staff}','staff@example.invalid',now());
    insert into public.team_members(user_id,role,email,display_name,bootstrap_owner)
      values ('${owner}','owner','owner@protonmail.com','Fixture owner',true),('${staff}','editor','staff@example.invalid','Fixture editor',false);
    create table storage.s3_multipart_uploads(bucket_id text,key text);
    update private.home_media_control set permanent_enabled=true,listing_inactivity_enabled=false;
  `);
  const as=async(role='postgres',actor='')=>{
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await db.exec('set role '+role);
  };
  const value=async(sql,params=[]) => (await db.query(sql,params)).rows[0]?.value;
  const execute=(sql,params=[])=>db.query(sql,params);
  const add=(key,original=null,mediaBucket=bucket)=>execute(`
    insert into storage.objects(bucket_id,name,metadata,user_metadata,owner_id)
    values($1,$2,'{"size":20}',jsonb_build_object('original_filename',$3::text),$4)
  `,[mediaBucket,key,original,owner]);
  const hold=(name,reason='recovery_hold')=>execute(`
    insert into private.home_media_review_holds(bucket,name,actor,reason) values('property-media',$1,$2,$3)
  `,[name,owner,reason]);
  const holds=()=>value("select count(*)::int value from private.home_media_review_holds where reason='recovery_hold'");
  const listing=await value('select id value from public.properties order by id limit 1');
  const canonical='archive/gallery canonical.webp',missing='archive/missing anchor.webp';
  const scopedDuplicate=`properties/listings/${listing}/fixture/upload.webp`;
  const files=['archive/unused one.webp','archive/old.jpg','archive/uncertain.jpg','archive/loose.jpg','archive/raw-protected.webp',
    'archive/in-use-visa.webp','archive/leased.webp','archive/multipart.webp','archive/48-hour.webp','archive/abandoned-upload.webp',
    'archive/ordinary-hold.webp','archive/recovery-release.webp','archive/recovery-delete.webp','archive/recovery-late.webp',
    'archive/recovery-replaced.webp','archive/recovery-interrupted.webp'];
  for(const key of [...files,canonical])await add(key);
  await add(scopedDuplicate,'public-name.jpg');
  await add('legacy-tours/archive.mp4',null,'listing-videos');
  await execute(`update public.properties set images=$2,image_filenames=$3,image_metadata=$4 where id=$1`,
    [listing,[photoUrl(canonical),photoUrl(missing)],{[photoUrl(canonical)]:'old.jpg',[photoUrl(missing)]:'uncertain.jpg'},
      {[photoUrl(canonical)]:{public_filename:'public-name.jpg'}}]);
  await execute("insert into public.jobs_cms_entries values ($1)",[{hero:'archive/raw-protected.webp',filename:'loose.jpg'}]);
  await execute("insert into public.gary_cms_entries values ($1)",[{nested:{cover:photoUrl('archive/in-use-visa.webp')}}]);
  await db.exec(`
    insert into storage.objects(bucket_id,name,metadata)
      select 'property-media','archive/filler-'||i||'.webp','{"size":20}' from generate_series(1,34) i;
    insert into storage.s3_multipart_uploads values('property-media','archive/multipart.webp');
    insert into private.home_media_items(bucket,name,source,state,object_id,object_version,expires_at,unreferenced_since,upload_until,upload_owner)
      select bucket_id,name,case when name like '%48-hour%' then 'detached' else 'upload' end,
        case when name like '%48-hour%' then 'trashed' else 'uploading' end,id,version,now()+interval '40 hours',
        now()-interval '8 hours',case when name like '%leased%' then now()+interval '1 day'
          when name like '%abandoned%' then now()-interval '1 day' end,'${owner}'
      from storage.objects where name in ('archive/48-hour.webp','archive/leased.webp','archive/abandoned-upload.webp');
    update private.home_media_observation set state='running',cycle=5,checked=1,total=99,cursor_bucket='property-media',cursor_name='z';
  `);
  const legacy=()=>value("select to_jsonb(i) value from private.home_media_items i where name='archive/48-hour.webp'");
  const original48=await legacy();
  for(const key of files.filter(key=>key.includes('/recovery-')))await hold(key);
  await hold('archive/ordinary-hold.webp','owner_hold');
  await hold(canonical);
  await db.exec(migrationSql);
  assert.deepEqual(await legacy(),original48);
  const state=name=>value("select reason value from private.home_media_inactivity_inventory(null,$1)",[name]);
  assert.equal(await state('archive/old.jpg'),'awaiting_observation');
  assert.equal(await state(scopedDuplicate),'awaiting_observation');
  assert.equal(await state('archive/uncertain.jpg'),'filename_match');
  assert.equal(await state('archive/loose.jpg'),'filename_match');
  assert.equal(await state('archive/raw-protected.webp'),'reference');
  assert.equal(await state('archive/in-use-visa.webp'),'reference');
  assert.equal(await state('archive/leased.webp'),'active_upload');
  assert.equal(await state('archive/multipart.webp'),'active_upload');
  assert.equal(await state('archive/abandoned-upload.webp'),'legacy_lifecycle');

  const preview=()=>value('select public.home_media_retention_preview() value');
  const inventory=query=>value('select public.home_media_inventory_files(0,$1) value',[query]);
  const overview=()=>value("select public.home_media_dashboard('overview') value");
  const manifest=()=>value('select public.home_media_retention_manifest() value');
  const release=(ticket,confirm=true)=>value('select public.home_media_release_recovery($1,$2) value',[ticket,confirm]);
  const claim=(ticket,confirm=true)=>value('select public.home_media_claim_recovery($1,$2,$3) value',[owner,ticket,confirm]);
  const target=(job,id=job.items[0].id)=>value('select public.home_media_target($1,$2,true) value',[job.id,id]);
  const finish=job=>value('select public.home_media_finish($1) value',[job.id]);
  const settle=(job,ok)=>value('select public.home_media_settle($1,$2,$3) value',[job.id,job.items[0].id,ok]);
  await as('authenticated',staff);
  await assert.rejects(preview,error=>error.code==='42501');
  await assert.rejects(release({},true),error=>error.code==='42501');
  await as('authenticated',owner);
  const initial=await preview();
  assert.equal(initial.counts.recovery,5);
  assert.equal(initial.counts.protected,undefined);
  assert.ok(initial.items.every(row=>!row.saved_reference&&['awaiting','recovery'].includes(row.status)));
  assert.ok(initial.hasMore);
  assert.deepEqual((await overview()).retentionCounts,initial.retentionCounts);
  assert.deepEqual((await inventory('')).retentionCounts,initial.retentionCounts);
  const activeHeld=(await inventory(canonical)).items[0];
  assert.equal(activeHeld.status,'protected');
  assert.ok(activeHeld.recovery_target);
  const recoveryPage=await value("select public.home_media_filtered_files(0,'',true,'recovery') value");
  assert.equal(recoveryPage.items.length,5);
  assert.deepEqual(recoveryPage.counts,initial.counts);
  const tickets=Object.fromEntries((await manifest()).recoveryItems.map(ticket=>[ticket.name,ticket]));
  await assert.rejects(claim(tickets['archive/recovery-delete.webp']),error=>error.code==='42501');
  await assert.rejects(release(tickets['archive/recovery-release.webp'],false),error=>error.code==='22023');

  const progress=await value('select public.home_media_observation() value');
  assert.equal(progress.status,'idle');
  assert.equal(progress.cycle,6);
  const first=await value('select public.home_media_observation_step(6,0,true) value');
  assert.equal(first.checked,32);
  const end=await value('select public.home_media_observation_step(7,32,false) value');
  assert.equal(end.status,'complete',end.error);
  assert.equal(end.checked,53);
  const verified=(await manifest()).items;
  for(const key of ['archive/unused one.webp','archive/old.jpg',scopedDuplicate,'legacy-tours/archive.mp4'])
    assert.ok(verified.some(ticket=>ticket.name===key),key);
  const after=await preview();
  assert.equal(after.manualCount,verified.length);
  assert.equal(after.counts.verified,(await inventory('')).counts.verified);
  assert.deepEqual((await overview()).retentionCounts,after.retentionCounts);
  assert.ok(after.items.filter(row=>row.manual_target).every(row=>row.eligible_at));
  assert.equal((await release(activeHeld.recovery_target)).status,'released');
  assert.equal((await release(tickets['archive/recovery-release.webp'])).status,'released');

  await as();
  assert.deepEqual(await legacy(),original48);
  assert.equal(await state(canonical),'reference');
  assert.equal(await state('archive/recovery-release.webp'),'awaiting_observation');
  assert.equal(await value("select count(*)::int value from private.home_media_items where source='unused_listing' and expires_at-unreferenced_since=interval '96 hours'"),verified.length);
  await execute("insert into public.jobs_cms_entries values ($1)",[{filename:'old.jpg'}]);
  assert.equal(await state('archive/old.jpg'),'filename_match','an extra unbound occurrence keeps the duplicate protected');
  const old=verified.find(ticket=>ticket.name==='archive/old.jpg');
  await as('service_role');
  await assert.rejects(value('select public.home_media_claim_unused($1,$2,$3) value',[owner,old.id,old.expires_at]),error=>error.code==='PT409');
  const unused=verified.find(ticket=>ticket.name==='archive/unused one.webp');
  const unusedJob=await value('select public.home_media_claim_unused($1,$2,$3) value',[owner,unused.id,unused.expires_at]);
  assert.equal((await target(unusedJob)).name,unused.name);
  await as();
  await execute('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,unused.name]);
  await as('service_role');
  assert.equal(await settle(unusedJob,true),true);
  await finish(unusedJob);

  const late=tickets['archive/recovery-late.webp'],replaced=tickets['archive/recovery-replaced.webp'];
  await assert.rejects(claim(late,false),error=>error.code==='22023');
  const lateJob=await claim(late);
  await as();
  await execute("insert into public.gary_cms_entries values ($1)",[{key:late.name}]);
  await as('service_role');
  assert.equal(await target(lateJob),null);
  await finish(lateJob);
  await as();
  await execute("update storage.objects set version=gen_random_uuid()::text where name=$1",[replaced.name]);
  await as('service_role');
  await assert.rejects(claim(replaced),error=>error.code==='PT409'&&/manifest_changed/.test(error.message));
  await assert.rejects(claim(late),error=>error.code==='PT409'&&/recovery_protected/.test(error.message));

  const final=tickets['archive/recovery-delete.webp'];
  let job=await claim(final);
  assert.equal((await target(job)).name,final.name);
  assert.equal(await settle(job,false),false);
  await finish(job);
  await as();
  assert.equal(await holds(),4);
  await execute("update private.home_media_items set retry_after=now()-interval '1 second' where name=$1",[final.name]);
  await as('authenticated',owner);
  assert.equal((await overview()).overdue,0,'scheduled cleanup cannot remove a present recovery-held file');
  await as('service_role');
  job=await claim(final);
  assert.equal((await target(job)).name,final.name);
  await as();
  await execute('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,final.name]);
  await as('service_role');
  assert.equal(await settle(job,true),true);
  await finish(job);
  await as();
  assert.equal(await holds(),3);

  const interrupted=tickets['archive/recovery-interrupted.webp'];
  await as('service_role');
  job=await claim(interrupted);
  assert.equal((await target(job)).present,true);
  await as();
  await execute('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,interrupted.name]);
  assert.equal(await holds(),3);
  await execute("update private.home_media_items set retry_after=now()-interval '1 second' where name=$1",[interrupted.name]);
  await db.exec("update private.home_media_control set lease_until=now()-interval '1 second'");
  await as('service_role');
  let scheduled=await value('select public.home_media_claim() value');
  assert.deepEqual(scheduled.items.map(item=>item.id),[job.items[0].id]);
  assert.equal((await target(scheduled)).present,false);
  await as();
  assert.equal(await holds(),3,'even reconciliation leaves the hold until settlement');
  await db.exec("update private.home_media_control set lease_until=now()-interval '1 second'");
  await as('service_role');
  scheduled=await value('select public.home_media_claim() value');
  assert.equal((await target(scheduled)).present,false);
  assert.equal(await settle(scheduled,true),true);
  await finish(scheduled);
  await as();
  assert.equal(await holds(),2);
  await as('authenticated',owner);
  assert.equal((await preview()).counts.recovery,1,'the newly referenced hold is available in Inventory only');
  assert.ok((await inventory(late.name)).items[0].recovery_target);
  assert.deepEqual((await overview()).retentionCounts,(await inventory('')).retentionCounts);
  assert.equal((await value("select public.home_media_dashboard('trash_page') value")).items[0].expires_at,original48.expires_at);

  const video=verified.find(ticket=>ticket.name==='legacy-tours/archive.mp4');
  await as();
  await execute("update private.home_media_items set expires_at=now()-interval '1 second' where id=$1",[video.id]);
  await as('authenticated',owner);
  assert.equal((await overview()).overdue,0);
  await as('service_role');
  const paused=await value('select public.home_media_claim() value');
  assert.deepEqual(paused.items,[]);
  await finish(paused);
  await as();
  await db.exec('update private.home_media_control set listing_inactivity_enabled=true');
  await as('authenticated',owner);
  assert.equal((await overview()).overdue,1);
  await as('service_role');
  const due=await value('select public.home_media_claim() value');
  assert.deepEqual(due.items.map(item=>item.id),[video.id]);
  assert.equal((await target(due)).name,video.name);
});
