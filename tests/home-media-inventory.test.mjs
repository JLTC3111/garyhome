import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { supabasePlatform } from './supabase-platform.fixture.mjs';

async function loadFunctions(db,file,names) {
  const source=await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');
  for(const name of names){
    const marker=source.indexOf('function '+name+'(');
    assert.ok(marker>=0,name);
    const start=source.lastIndexOf('\n',marker)+1;
    assert.match(source.slice(start,marker),/^create (or replace )?$/);
    await db.exec(source.slice(start,source.indexOf('$$;',marker)+3));
  }
}

test('both Owner inventory views share exact references and unused tickets, and preserve video detachment',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(supabasePlatform);
  // Load isolated function definitions into fixture tables. No migration scripts run.
  await db.exec(`
    create schema private;
    create table public.properties(id uuid primary key,listing_code text,title_en text,title_vi text,
      images text[] default '{}',image_filenames jsonb default '{}',image_metadata jsonb default '{}',source_url text,video_url text);
    create table private.home_media_control(singleton boolean primary key,permanent_enabled boolean,listing_inactivity_enabled boolean);
    insert into private.home_media_control values(true,true,false);
    create table private.home_media_review_holds(bucket text,name text,reason text);
    create table private.home_listing_deletion_media(bucket text,name text);
    create table private.property_photo_renames(id uuid,old_key text,new_key text,applied_at timestamptz);
    create table private.home_media_renamed_listings(rename_id uuid,listing_id uuid,before_media jsonb,after_media jsonb);
    create table private.home_media_items(id uuid primary key default gen_random_uuid(),bucket text,name text,source text,state text,
      object_id uuid,object_version text,upload_owner text,upload_until timestamptz,expires_at timestamptz,bytes bigint,
      source_id uuid,unreferenced_since timestamptz,restore_media jsonb,restored_to uuid,hold_reason text,attempts int,
      retry_after timestamptz,deletion_started_at timestamptz,deletion_run uuid,unique(bucket,name));
    create function private.staff_role() returns text language sql as $$ select 'owner'::text $$;
    create function private.home_media_provider_upload(text,text) returns boolean language sql as $$ select false $$;
    create function private.home_media_edit_referenced(text,text) returns boolean language sql as $$ select false $$;
    create function private.home_media_reference_documents() returns setof jsonb language sql stable as $$
      select to_jsonb(p) from public.properties p $$;
    create function private.home_media_identity(text,text) returns setof storage.objects language sql stable as $$
      select * from storage.objects where bucket_id=$1 and name=$2 $$;
  `);
  await loadFunctions(db,'20261119054408_property_photo_storage_rename.sql',['private.home_photo_key','private.require_home_photo_admin']);
  await loadFunctions(db,'20261119095000_property_deletion_media_cleanup.sql',['private.home_listing_storage_links']);
  await loadFunctions(db,'20261119183631_property_photo_rename_owner_only.sql',['private.require_home_photo_owner']);
  await loadFunctions(db,'20261126100000_home_media_retention.sql',['private.home_media_links','private.home_media_listing_fields']);
  await loadFunctions(db,'20261127141812_home_listing_media_inactivity.sql',[
    'private.home_media_scope_id','private.home_media_document_evidence','private.home_media_record_detached',
  ]);
  await loadFunctions(db,'20261127153844_home_listing_media_manual_removal.sql',['private.home_media_unused_ticket']);
  await loadFunctions(db,'20261127165022_home_media_inventory_controls.sql',[
    'private.home_media_file_states','private.home_media_inactivity_inventory','private.home_media_owner_files',
    'public.home_media_inventory_files','public.home_media_retention_preview','public.home_media_retention_manifest',
  ]);
  await db.exec(`create trigger fixture_detach after update of video_url on public.properties
    for each row execute function private.home_media_record_detached();`);

  const actor=crypto.randomUUID(),listing=crypto.randomUUID();
  const scoped=`properties/listings/${listing}/fixtures/`;
  const unused=scoped+'idle.jpg',alias=scoped+'original.jpg';
  const referenced='properties/renamed/gallery.webp',video=`${actor}/${listing}/tour.mp4`,trash='properties/file-trash.jpg';
  const url=(bucket,path)=>`https://fixture.example/storage/v1/object/public/${bucket}/${path}`;
  const gallery=url('property-media',referenced);
  await db.query("insert into public.properties(id,listing_code,title_en,title_vi,images,image_filenames,video_url) values($1,'GH-FIXTURE','Lake view','Hồ Tây',$2,$3,$4)",
    [listing,[gallery],{[gallery]:'original.jpg'},url('listing-videos',video)]);
  await db.exec("insert into storage.buckets(id) values('property-media'),('listing-videos')");
  for(const path of [unused,alias,referenced,video,trash]){
    const bucket=path===video?'listing-videos':'property-media';
    await db.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"size\":64}')",[bucket,path]);
  }
  await db.query(`insert into private.home_media_items(bucket,name,source,state,object_id,object_version,expires_at,bytes)
    select bucket_id,name,case when name=$1 then 'unused_listing' else 'historical' end,
    case when name=$1 then 'retained' else 'trashed' end,id,version,now()+interval '1 hour',64
    from storage.objects where name in ($1,$2)`,[unused,trash]);
  // An additional hold must not hide the exact reference in the inventory.
  await db.query("insert into private.home_media_review_holds values('property-media',$1,'owner_hold')",[referenced]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'owner@example.invalid',now())",[actor]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor})]);
  const query=async (sql,params=[]) => (await db.query(sql,params)).rows[0].value;
  const inventory=await query('select public.home_media_inventory_files() value');
  assert.equal(inventory.manualCount,1);
  assert.equal(inventory.items.length,5);
  assert.equal(inventory.items[0].name,unused);
  const byName=Object.fromEntries(inventory.items.map(row=>[row.name,row]));
  assert.equal(byName[alias].reason,'filename_match');
  assert.equal(byName[alias].saved_reference,false);
  assert.equal(byName[alias].manual_target,null);
  assert.equal(byName[referenced].reason,'owner_hold');
  assert.equal(byName[referenced].saved_reference,true);
  assert.equal(byName[referenced].listing_code,'GH-FIXTURE');
  assert.equal(byName[referenced].listing_title_en,'Lake view');
  assert.equal(byName[trash].reason,'legacy_lifecycle');
  assert.equal(byName[trash].manual_target,null);
  assert.equal(byName[video].saved_reference,true);
  const preview=await query('select public.home_media_retention_preview(0,$1) value',['Lake view']);
  assert.deepEqual(preview.items.find(row=>row.name===unused).manual_target,byName[unused].manual_target);
  assert.deepEqual((await query('select public.home_media_retention_manifest($1) value',['Hồ Tây'])).items,[byName[unused].manual_target]);

  await db.query('update public.properties set video_url=null where id=$1',[listing]);
  assert.deepEqual((await db.query(`select source,state,(extract(epoch from expires_at-unreferenced_since)/3600)::int hours
    from private.home_media_items where name=$1`,[video])).rows[0],{source:'detached',state:'candidate',hours:48});
  const detached=(await query('select public.home_media_inventory_files(0,$1) value',['tour.mp4'])).items[0];
  assert.equal(detached.saved_reference,false);
  assert.equal(detached.reason,'legacy_lifecycle');
  assert.equal(detached.manual_target,null);

  for(const field of ['deleted_at','banned_until','is_anonymous']){
    const value=field==='is_anonymous'?'true':"now()+interval '1 day'";
    await db.query(`update auth.users set ${field}=${value} where id=$1`,[actor]);
    await assert.rejects(query('select public.home_media_inventory_files() value'),error=>error.code==='42501');
    await db.query(`update auth.users set ${field}=null where id=$1`,[actor]);
  }
});
