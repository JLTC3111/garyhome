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

async function inventoryFixture(t) {
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
    create table private.home_media_edit_checkpoints(links jsonb not null);
    create index fixture_checkpoint_links on private.home_media_edit_checkpoints using gin(links jsonb_path_ops);
    create table storage.s3_multipart_uploads(bucket_id text,key text);
    create index fixture_multipart_upload_keys on storage.s3_multipart_uploads(bucket_id,key);
    alter table storage.objects add column archived_at timestamptz;
    create table private.fixture_documents(body jsonb not null);
    create function private.home_media_reference_documents() returns setof jsonb language sql stable as $$
      select to_jsonb(p) from public.properties p union all select body from private.fixture_documents $$;
  `);
  await loadFunctions(db,'20261119054408_property_photo_storage_rename.sql',['private.home_photo_key','private.require_home_photo_admin']);
  await loadFunctions(db,'20261119095000_property_deletion_media_cleanup.sql',['private.home_listing_storage_links']);
  await loadFunctions(db,'20261119183631_property_photo_rename_owner_only.sql',['private.require_home_photo_owner']);
  await loadFunctions(db,'20261126100000_home_media_retention.sql',['private.home_media_links','private.home_media_listing_fields','private.home_media_provider_upload','private.home_media_identity']);
  await loadFunctions(db,'20261127141812_home_listing_media_inactivity.sql',[
    'private.home_media_scope_id','private.home_media_document_evidence','private.home_media_edit_referenced','private.home_media_record_detached',
  ]);
  await loadFunctions(db,'20261127153844_home_listing_media_manual_removal.sql',['private.home_media_unused_ticket']);
  await loadFunctions(db,'20261127165022_home_media_inventory_controls.sql',[
    'private.home_media_file_states','private.home_media_inactivity_inventory','private.home_media_owner_files',
    'public.home_media_inventory_files','public.home_media_retention_preview','public.home_media_retention_manifest',
  ]);
  await db.exec(`create trigger fixture_detach after update of video_url on public.properties
    for each row execute function private.home_media_record_detached();`);
  return db;
}

async function loadPageFirstFunctions(db) {
  await db.exec('create type private.home_media_reference_key as (bucket text,name text)');
  await loadFunctions(db,'20261127173831_home_media_page_first_inventory.sql',[
    'private.home_media_document_evidence','private.home_media_reference_snapshot','private.home_media_pending_upload_keys','private.home_media_file_states_batch',
    'private.home_media_file_states','private.home_media_retained_observations','private.home_media_owner_files','public.home_media_retention_manifest',
  ]);
}

test('both Owner inventory views share exact references and unused tickets, and preserve video detachment',async t=>{
  const db=await inventoryFixture(t);
  const listingPath='properties/listings/11111111-1111-4111-8111-000000000001/revision/';
  const payload={
    text:'<img src="https://fixture.example/storage/v1/render/image/public/PROPERTY-MEDIA/properties/lake%20view.webp?width=90">',
    direct:'https://fixture.example/storage/v1/object/public/property-media/properties/extensionless',
    video:'https://fixture.example/storage/v1/object/public/listing-videos/11111111-1111-4111-8111-000000000001/11111111-1111-4111-8111-000000000002/video.mp4',
    raw:[listingPath+'literal%25.webp',listingPath+'escaped%2Fname.jpg','Room.JPG','',null],
    image_filenames:{[listingPath+'saved%20key.webp']:'Original.JPG'},
    image_metadata:{[listingPath+'metadata.webp']:{caption:'Long title'}},
  };
  const evidence=async()=> (await db.query(
    'select * from private.home_media_document_evidence($1) order by bucket,name',[payload])).rows;
  const originalEvidence=await evidence();
  await loadPageFirstFunctions(db);
  assert.deepEqual(await evidence(),originalEvidence);
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

test('production-scale inventory preserves search, pagination and live eligibility after limiting the detail work',async t=>{
  const db=await inventoryFixture(t);
  await db.exec(`
    insert into storage.buckets(id) values('property-media'),('listing-videos');
    create temp table fixture_files(seq int,bucket text,name text,listing int);
    insert into fixture_files
      select g,case when g>1344 then 'listing-videos' else 'property-media' end,case
        when g>1344 then '22222222-2222-4222-8222-222222222222/'||('11111111-1111-4111-8111-'||lpad(l::text,12,'0'))||'/tour-'||g||'.mp4'
        when g<=806 then 'properties/listings/11111111-1111-4111-8111-'||lpad(l::text,12,'0')||'/revision/fixture-'||g||'.webp'
        else 'properties/renamed/fixture-'||g||'.webp' end,l
      from generate_series(1,1354) g cross join lateral (select (g-1)%106+1 l) ids;
    insert into storage.objects(bucket_id,name,metadata,user_metadata)
      select bucket,name,jsonb_build_object('size',seq*64),jsonb_build_object('original_filename','original-'||seq||'.jpg')
      from fixture_files;
    insert into public.properties(id,listing_code,title_en,title_vi,images,image_metadata,image_filenames,video_url)
      select ('11111111-1111-4111-8111-'||lpad(l::text,12,'0'))::uuid,'GH-'||l,
        'Lake view listing '||l,'Hồ Tây số '||l,
        coalesce(array_agg(x.url order by x.seq) filter(where x.url is not null),'{}'),
        coalesce(jsonb_object_agg(x.url,jsonb_build_object('caption',repeat('Lake view apartment. ',18),
          'caption_vi',repeat('Ban công và phòng khách. ',12),'alt_en','Gallery '||x.seq))
          filter(where x.url is not null),'{}'),
        coalesce(jsonb_object_agg(x.url,'original-'||x.seq||'.jpg') filter(where x.url is not null),'{}'),
        (select 'https://fixture.example/storage/v1/object/public/'||v.bucket||'/'||v.name
          from fixture_files v where v.listing=l and v.seq between 1345 and 1349)
      from generate_series(1,106) l
      left join lateral (
        select f.seq,'https://fixture.example/storage/v1/object/public/'||f.bucket||'/'||f.name url
        from fixture_files f where f.listing=l and (f.seq<=721 or f.seq between 807 and 1262)
      ) x on true group by l;
    insert into private.fixture_documents(body)
      select jsonb_build_object('body_en',repeat('Published area guide and transport. ',150)||
        (select string_agg(md5(f.seq||'/'||n),' ' order by n) from generate_series(1,72) n),
        'body_vi',repeat('Thông tin khu vực và đi lại. ',100),
        'cover','<img src="https://fixture.example/storage/v1/render/image/public/property-media/'||f.name||'?width=480">')
      from fixture_files f where f.seq between 1 and 295;
    insert into private.property_photo_renames(id,old_key,new_key,applied_at)
      select gen_random_uuid(),'properties/old-'||seq||'.jpg',name,now() from fixture_files where seq between 840 and 1339;
    insert into private.home_media_items(bucket,name,source,state)
      select 'property-media','properties/removed-'||g||'.jpg','historical','removed' from generate_series(1,537) g;
    insert into private.home_media_review_holds(bucket,name,reason)
      select bucket,name,'recovery_hold' from fixture_files where seq between 722 and 735;
  `);
  const stats=(await db.query(`select (select count(*) from storage.objects)::int objects,
    (select count(*) from public.properties)::int listings,(select count(*) from private.home_media_reference_documents())::int documents,
    (select sum(pg_column_size(d))::int from private.home_media_reference_documents() d) json_bytes`)).rows[0];
  assert.equal(stats.objects,1354);
  assert.equal(stats.listings,106);
  assert.equal(stats.documents,401);
  assert.ok(stats.json_bytes>=2_150_000,stats.json_bytes);
  t.diagnostic(`Fixture: ${stats.objects} objects, ${stats.listings} listings, ${stats.documents} reference documents, ${stats.json_bytes} JSON bytes`);

  const fetch=async (offset,search,scoped=false)=>
    (await db.query('select private.home_media_owner_files($1,$2,$3) value',[offset,search,scoped])).rows[0].value;
  await db.exec(`create function pg_temp.measure_inventory(p_offset int,p_query text,p_scoped boolean)
    returns table(page jsonb,elapsed_ms double precision) language plpgsql as $$
    declare started timestamptz:=clock_timestamp();
    begin
      page:=private.home_media_owner_files(p_offset,p_query,p_scoped);
      elapsed_ms:=extract(epoch from clock_timestamp()-started)*1000;
      return next;
    end;
    $$;`);
  const measure=async (...args)=>(await db.query('select * from pg_temp.measure_inventory($1,$2,$3)',args)).rows[0];
  const cases=[['Inventory first page',0,'',false],['Inventory at offset 1200',1200,'',false],
    ['Inventory listing-title search',0,'Lake view listing 1',false],['Retention first page',0,'',true]];
  const before=[];
  for(const [label,...args] of cases)before.push({label,args,...await measure(...args)});
  const stateCounts=()=>db.query(`select reason,count(*)::int files from private.home_media_file_states(null,null,false)
    group by reason order by reason`).then(result=>result.rows);
  const oldCounts=await stateCounts();

  await loadPageFirstFunctions(db);
  for(const {label,args,elapsed_ms,page} of before){
    const after=await measure(...args);
    assert.deepEqual(after.page,page,label);
    t.diagnostic(`${label}: ${elapsed_ms.toFixed(1)} ms before, ${after.elapsed_ms.toFixed(1)} ms after (Postgres execution time)`);
  }
  assert.deepEqual(await stateCounts(),oldCounts);
  const finalPage=await fetch(1350,'');
  assert.equal(finalPage.items.length,4);
  assert.equal(finalPage.hasMore,false);
  assert.equal((await fetch(0,'never-matching-fixture')).items.length,0);

  // A late reference or protection can invalidate an already-observed candidate.
  await db.exec(`
    insert into private.home_media_items(bucket,name,source,state,object_id,object_version,expires_at,bytes)
      select o.bucket_id,o.name,'unused_listing','retained',o.id,o.version,now()+interval '1 day',123
      from storage.objects o join fixture_files f on f.bucket=o.bucket_id and f.name=o.name
      where f.seq between 750 and 758;
    insert into storage.s3_multipart_uploads select bucket,name from fixture_files where seq=751;
    insert into private.home_media_edit_checkpoints select jsonb_build_array(bucket||'/'||name) from fixture_files where seq=752;
    insert into private.home_media_review_holds select bucket,name,'owner_hold' from fixture_files where seq=753;
    insert into private.fixture_documents select jsonb_build_object('cover',name) from fixture_files where seq=754;
    insert into private.fixture_documents values ('{"alias":"original-755.jpg"}');
    update storage.objects o set version='replaced' from fixture_files f where f.name=o.name and f.seq=756;
    update storage.objects o set archived_at=now() from fixture_files f where f.name=o.name and f.seq=757;
    insert into private.home_listing_deletion_media select bucket,name from fixture_files where seq=758;
  `);
  const candidatePage=await fetch(0,'fixture-75');
  assert.equal(candidatePage.manualCount,1);
  assert.match(candidatePage.items[0].name,/fixture-750\.webp$/);
  const blocked={751:'active_upload',752:'editing_session',753:'owner_hold',754:'reference',
    755:'filename_match',756:'awaiting_observation',757:'identity',758:'legacy_lifecycle'};
  for(const [seq,reason] of Object.entries(blocked)){
    const item=candidatePage.items.find(row=>row.name.endsWith('/fixture-'+seq+'.webp'));
    assert.equal(item.reason,reason);
    assert.equal(item.manual_target,null);
  }
  const actor=crypto.randomUUID();
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'fixture@example.invalid',now())",[actor]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const manifest=(await db.query("select public.home_media_retention_manifest('') value")).rows[0].value;
  assert.deepEqual(manifest.items,[candidatePage.items[0].manual_target]);
});
