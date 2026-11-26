import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {PROPERTY_IMAGE_MAX_BYTES,propertyPhotoFilename,propertyPhotoPath,propertyPhotoUrl,replacePropertyPhotoUrl} from '../lib/property-photo-files.ts';
import {propertyPhotoRenameHistory,renamePropertyPhoto,retirePropertyPhoto,trashOldPropertyPhoto} from '../lib/property-photo-rename-server.ts';
import {syncRenamedListingDraft} from '../lib/property-photo-rename-state.ts';
import {deleteListingAndMedia,listingDeletionQueue,retryDueListingCleanup,stageListingDeletion} from '../lib/property-deletion-server.ts';
import {continuationCheckpoint,readStagedBatch,reviewedContinuation,runMediaStage,sealContinuation} from '../scripts/migrate-property-media.mjs';
import {databaseStages,storageStages} from '../scripts/property-media-migration-transport.mjs';

const origin='https://duyiihsmaqfgwezmsnjs.supabase.co', bucket='property-media';
const first='10101010-1111-4111-8111-111111111111', second='20202020-2222-4222-8222-222222222222';
const admin='a0000000-0000-4000-8000-000000000001', editor='a0000000-0000-4000-8000-000000000002';
const manager='a0000000-0000-4000-8000-000000000003', owner='a0000000-0000-4000-8000-000000000004';
const version='2026-11-19T01:00:00.000Z', changedVersion='2026-11-19T01:04:00.000Z';
const oldKey='properties/Room.jpg (3).jpg', oldUrl=propertyPhotoUrl(origin,oldKey);
const newKey=`properties/renamed/${first}/room-03.jpg`, newUrl=propertyPhotoUrl(origin,newKey);
const transformed=oldUrl.replace('/object/public/','/render/image/public/')+'?width=600';
const transformedNew=newUrl.replace('/object/public/','/render/image/public/')+'?width=600';
const another=origin+'/storage/v1/object/public/property-media/properties/another.jpg';
const jpeg=new Uint8Array([255,216,255,224,0,0,0,1]), png=new Uint8Array([137,80,78,71,13,10,26,10]);
const signal=()=>new AbortController().signal;

test('scheduled cleanup retries only committed pending files and respects the manual cleanup lease',async t=>{
 const h=await setup(t),job=crypto.randomUUID(),name='properties/scheduled-unreferenced.jpg';
 await h.pg.query(`insert into private.home_listing_deletions(property_id,listing_code,requested_by,requested_at)
   values($1,'TEST',$2,now()-interval '25 hours')`,[job,admin]);
 await h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,name]);
 await h.pg.query(`insert into private.home_listing_deletion_media(property_id,bucket,name,object_id,object_version,evidence,state)
   select $1,bucket_id,name,id,version,'fixture','pending' from storage.objects where bucket_id=$2 and name=$3`,[job,bucket,name]);
 const asService=(sql,args=[])=>h.role('service_role',null,()=>h.pg.query(sql,args));
 await assert.rejects(h.role('authenticated',admin,()=>h.pg.query('select public.home_listing_delete_due()')),error=>error.code==='42501');
 const lease=(await asService('select public.home_listing_delete_claim($1,false) token',[job])).rows[0].token;
 const system=h.client('service_role');
 assert.deepEqual(await retryDueListingCleanup(system,signal()),{attempted:0,overdue:1});
 assert.deepEqual(h.calls,[]);
 await asService('select public.home_listing_delete_release($1,$2)',[job,lease]);
 await h.pg.query(`update private.home_listing_deletions set cleanup_retry_after=now() where property_id=$1`,[job]);
 assert.deepEqual(await retryDueListingCleanup(system,signal()),{attempted:1,overdue:0});
 assert.deepEqual(h.calls,[['remove',name]]);
 assert.equal((await h.pg.query('select state from private.home_listing_deletion_media where property_id=$1',[job])).rows[0].state,'removed');
});

test('filename normalization fixes duplicate and copy suffixes with the actual extension',()=>{
 for(const [input,want] of [
  ['photo.jpg.jpg','photo.jpg'],['photo.jpg (3).jpg','photo-03.jpg'],['photo-03 (3).JPEG','photo-03.jpg'],
  ['  Căn hộ  -   Tây Hồ.JPG  ','can-ho-tay-ho.jpg'],
 ]) assert.equal(propertyPhotoFilename(input,'jpg',true),want);
 for(const input of ['../photo.jpg','a\\photo.jpg','%2e%2e.jpg','photo.png','photo.exe','photo\n.jpg'])
  assert.equal(propertyPhotoFilename(input,'jpg',true),'',input);
 assert.equal(propertyPhotoFilename('mislabelled.JPG','png'),'mislabelled.png');
 assert.equal(propertyPhotoPath(transformed,origin),oldKey);
 assert.equal(propertyPhotoPath(transformed,'https://another.example.test'),null);
 assert.equal(propertyPhotoPath(origin+'/storage/v1/object/public/property-media/one%2Ftwo.jpg',origin),null);
});

async function setup(t,retention=false) {
 const pg=new PGlite();
 const role=async (as,actor,operation)=>{
  await pg.exec('reset role');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
  if(as)await pg.exec('set role '+as);
  try{return await operation();}finally{await pg.exec('reset role');}
 };
 t.after(()=>pg.close());
 await pg.exec(`
  create role anon;create role authenticated;create role service_role;
  create schema auth;create schema private;create schema storage;
  create table auth.users(id uuid primary key,role text,email_confirmed_at timestamptz default now(),
    banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function private.staff_role() returns text language sql stable as $$select role from auth.users where id=auth.uid()$$;
  create function private.is_staff_admin() returns boolean language sql stable as $$select private.staff_role() in ('admin','owner')$$;
  create function private.is_editor() returns boolean language sql stable as $$select private.staff_role() is not null$$;
  create table public.properties(id uuid primary key,images text[] not null,image_metadata jsonb not null default '{}',
    image_filenames jsonb not null default '{}', source_url text,updated_at timestamptz not null,
    status text not null default 'draft',listing_code text not null default 'TEST',address text not null default 'Test address',
    video_url text,listing_type text default 'rent',availability text default 'available',slug text default 'fixture-home');
  create table public.neighbourhoods(image text);create table public.site_settings(hero_image text);
  create table public.listing_authors(portrait_url text);create table public.site_activities(image_url text,source_url text);
  create table public.editorial_articles(image_url text,sources jsonb not null default '[]');
  create table public.enquiries(id uuid primary key,property_id uuid references public.properties(id) on delete set null,message text);
  create table public.enquiry_notes(enquiry_id uuid primary key,notes text,property_code text,property_address text);
  create table public.feedback_public(message text);create table public.feedback_submissions(message text);
  create table public.property_assistance(notes text);create table public.assistance_reviews(internal_notes text);
  create table public.landlord_submissions(id uuid primary key,listing_id uuid references public.properties(id) on delete set null,message text);
  create table public.landlord_submission_files(submission_id uuid references public.landlord_submissions(id) on delete cascade,storage_path text);
  create table public.property_display_orders(property_ids uuid[]);
  create table public.saved_homes(property_id uuid references public.properties(id) on delete cascade);
  create table storage.buckets(id text primary key,versioning_status text not null default 'DISABLED');
  insert into storage.buckets(id) values('property-media'),('listing-videos');
  create table storage.objects(bucket_id text,name text,id uuid not null default gen_random_uuid(),
    version text default gen_random_uuid()::text,metadata jsonb default '{"size":8}',user_metadata jsonb,
    is_versioned boolean not null default false,is_delete_marker boolean not null default false,archived_at timestamptz,owner_id text,
    primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema storage,private to authenticated;
  grant select,insert,update,delete on storage.objects to authenticated;
  create policy legacy_storage_editor on storage.objects for all to authenticated using(true) with check(true);
  create policy listing_video_delete_guard on storage.objects as restrictive for delete to authenticated using(true);
  grant select,update,insert,delete on public.properties to authenticated;
  alter table public.properties enable row level security;
  create policy fixture_property_select on public.properties for select to authenticated using(true);
  create policy fixture_property_update on public.properties for update to authenticated using(true) with check(true);
 `);
 for(const [id,name] of [[admin,'admin'],[editor,'editor'],[manager,'manager'],[owner,'owner']])
  await pg.query('insert into auth.users(id,role) values($1,$2)',[id,name]);
 const caption={description_en:'Living area',description_vi:'Phòng khách',alt_en:'Sofa',alt_vi:'Ghế sofa',public_filename:'Room.JPG'};
 await pg.query('insert into public.properties values($1,$2,$3,$4,$5,$6)',[first,[oldUrl,another],{[oldUrl]:caption},{[oldUrl]:'Room.JPG'},null,version]);
 await pg.query('insert into public.properties values($1,$2,$3,$4,$5,$6)',[second,[another,transformed],{[transformed]:{alt_en:'Shared'}},{[transformed]:'Saved.JPG'},oldUrl,version]);
 await pg.query('insert into public.site_settings values($1)',[oldUrl]);
 await pg.query('insert into public.editorial_articles(image_url,sources) values($1,$2)',[another,[{title:'Photo',url:oldUrl}]]);
 // This table exists only in the PGlite fixture. The mock Storage API below
 // maintains its catalogue to emulate the provider's API side effects.
 await pg.query('insert into storage.objects values($1,$2)',[bucket,oldKey]);
 await pg.exec(await readFile(new URL('../supabase/migrations/20261119054408_property_photo_storage_rename.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/20261119073707_property_photo_rename_completion.sql',import.meta.url),'utf8'));
 const baseline=await readFile(new URL('../supabase/migrations/20261024173814_staff_gmail_inbox_and_deletion_controls.sql',import.meta.url),'utf8');
 await pg.exec(baseline.match(/create function private\.preserve_deleted_property\(\)[\s\S]*?create trigger preserve_deleted_property[\s\S]*?;/)[0]);
 await pg.exec(baseline.match(/create function public\.delete_property\(target_property uuid\)[\s\S]*?end; \$\$;/)[0]);
 await pg.exec(await readFile(new URL('../supabase/migrations/20261119095000_property_deletion_media_cleanup.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/20261119183631_property_photo_rename_owner_only.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/20261124102511_home_listing_cleanup_retry.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../supabase/migrations/20261124202612_home_postgrest_conflict_sqlstates.sql',import.meta.url),'utf8'));
 if(retention)await pg.exec(await readFile(new URL('../supabase/migrations/20261126100000_home_media_retention.sql',import.meta.url),'utf8'));
 const files=new Map([[oldKey,{mime:'image/jpeg',bytes:jpeg}]]), calls=[];
 let onCopy=()=>{}, onRemove=()=>{};
 const original=globalThis.fetch;
 globalThis.fetch=async target=>{
  const key=propertyPhotoPath(String(target),origin);
  assert.ok(key,'all object requests are restricted to the configured project');
  const file=files.get(key);
  return file?new Response(file.bytes,{headers:{'Content-Type':file.mime}}):new Response(null,{status:404});
 };
 t.after(()=>{globalThis.fetch=original;});
 const listing=async id=>(await pg.query('select to_jsonb(p) listing from public.properties p where id=$1',[id])).rows[0]?.listing||null;
 const client=(as,actor)=>({
  rpc(name,params){return {abortSignal:async()=>{
   const args=Object.entries(params).map(([key,value])=>key==='p_manifest'?JSON.stringify(value):value);
   const returnsRows=name==='home_listing_delete_targets';
   try {const rows=await role(as,actor,()=>pg.query((returnsRows?'select * from public.':'select public.')+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')'+(returnsRows?'':' value'),args));
    return {data:returnsRows?rows.rows:rows.rows[0]?.value};
   }catch(error){return {error:{code:error.code,message:error.message}};}
  }};},
  from(table){
   assert.equal(table,'properties');
   return {select:()=>({eq:(_,id)=>({abortSignal:()=>({maybeSingle:async()=>({data:await listing(id)})})})})};
  },
  storage:{from(name){
   assert.equal(as,'service_role');assert.ok([bucket,'listing-videos'].includes(name));
   return {
    async copy(from,to){
     calls.push(['copy',from,to]);
     if(files.has(to))return {error:{message:'Already exists'}};
     assert.ok(files.has(from));
     files.set(to,{...files.get(from)});
     await pg.query('insert into storage.objects values($1,$2)',[bucket,to]);
     await onCopy(to);
     return {error:null};
    },
    async remove(paths){
     calls.push(['remove',...paths]);
     await onRemove(paths[0],name);
     for(const key of paths){files.delete(key);await pg.query('delete from storage.objects where bucket_id=$1 and name=$2',[name,key]);}
     return {data:paths.map(name=>({name})),error:null};
    },
   };
  }},
 });
 return {pg,role,client,files,calls,caption,listing,
  onCopy:callback=>{onCopy=callback;},onRemove:callback=>{onRemove=callback;}};
}

test('approved WebP switch checks storage identities and references, preserves gallery metadata and rolls back exactly',async t=>{
 const h=await setup(t);
 await h.pg.exec(await readFile(new URL('../scripts/switch-optimized-property-photo.sql',import.meta.url),'utf8'));
 const optimizedKey=`properties/listings/${first}/${second}/room.webp`, optimizedUrl=propertyPhotoUrl(origin,optimizedKey);
 const metadata={original_filename:'Room.JPG'};
 const identity=async(key,mime,bytes,etag)=>{
  const result=await h.pg.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
    values($1,$2,$3,$4) on conflict(bucket_id,name) do update set metadata=excluded.metadata,user_metadata=excluded.user_metadata
    returning id,version`,[bucket,key,{size:bytes,mimetype:mime,eTag:etag},metadata]);
  return {...result.rows[0],key,mime,bytes,etag,sha256:'a'.repeat(64)};
 };
 const original=await identity(oldKey,'image/jpeg',900000,'before');
 const optimized=await identity(optimizedKey,'image/webp',232000,'after');
 const call=(apply=false,undo=null,expected=version,src=original,actor=owner)=>h.pg.query(
   'select pg_temp.switch_optimized_property_photo($1,$2,$3,$4,$5,$6,$7) as result',
   [first,expected,src,optimized,apply,undo,actor]).then(({rows})=>rows[0].result);

 await assert.rejects(h.role('authenticated',owner,()=>call(true)),error=>error.code==='42501');
 await assert.rejects(call(false,null,version,original,editor),/photo_rename.forbidden/);
 await assert.rejects(call(false,null,version,original,null),/photo_rename.forbidden/);
 await assert.rejects(call(false,null,changedVersion),error=>error.code==='PT409'&&/stale_listing/.test(error.message));
 await assert.rejects(call(false,null,version,{...original,version:'missing'}),/object_changed/);
 await assert.rejects(call(true),/shared_reference/);
 assert.deepEqual((await h.listing(first)).images,[oldUrl,another]);

 await h.pg.query("update public.properties set images=$1,image_metadata='{}',image_filenames='{}',source_url=null where id=$2",[[another],second]);
 await h.pg.query('update public.site_settings set hero_image=$1',[another]);
 await h.pg.exec("update public.editorial_articles set sources='[]'");
 await h.pg.query('update public.properties set images=$1,image_metadata=$2,image_filenames=$3 where id=$4',
   [[transformed,another],{[transformed]:h.caption},{[transformed]:'Room.JPG'},first]);
 const preview=await call();
 assert.deepEqual(preview.before.images,[transformed,another]);
 assert.deepEqual(preview.after.images,[optimizedUrl,another]);
 assert.deepEqual(preview.after.image_metadata,{[optimizedUrl]:h.caption});
 assert.deepEqual((await h.listing(first)).images,preview.before.images);

 await h.pg.query("update storage.objects set user_metadata='{}' where name=$1",[optimizedKey]);
 await assert.rejects(call(true),/storage_metadata_changed/);
 await h.pg.query('update storage.objects set user_metadata=$1 where name=$2',[metadata,optimizedKey]);
 await h.pg.exec('alter policy fixture_property_update on public.properties using(false)');
 await assert.rejects(call(true),/reference_verification/);
 assert.deepEqual((await h.listing(first)).images,preview.before.images);
 await h.pg.exec('alter policy fixture_property_update on public.properties using(true)');
 const applied=await call(true);
 assert.deepEqual(applied.after.image_filenames,{[optimizedUrl]:'Room.JPG'});
 assert.deepEqual((await h.listing(first)).images,preview.after.images);
 assert.equal((await h.pg.query("select count(*)::integer count from storage.objects where bucket_id='property-media'")).rows[0].count,2);
 await assert.rejects(call(true),/stale_listing/);
 const undone=await call(true,applied,applied.versionAfter);
 assert.deepEqual(undone.after,preview.before);
 assert.deepEqual((await h.listing(first)).image_metadata,preview.before.image_metadata);
 assert.equal((await h.pg.query('select count(*)::integer count from private.property_photo_renames')).rows[0].count,0);
 assert.deepEqual(h.calls,[]);
});

test('local media stages reconcile interrupted writes, guard retirement and roll back in listing order',async t=>{
 const h=await setup(t);
 const directory=await mkdtemp(join(tmpdir(),'gary-media-stages-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const work=join(directory,'batch'), inventory=join(directory,'inventory.json');
 const source=await sharp(await readFile(new URL('../public/images/apartments/lux-apartment-in-dang-thai-ma-tay-ho-1.jpg',import.meta.url))).png().toBuffer();
 const keys=['properties/pilot-room.png','properties/pilot-living.png'];
 const urls=keys.map(key=>propertyPhotoUrl(origin,key));
 const saved={original_filename:'Căn hộ (3).png'};
 const register=async(key,body,mime,metadata)=>{
  h.files.set(key,{mime,bytes:body});
  await h.pg.query('insert into storage.objects(bucket_id,name,metadata,user_metadata) values($1,$2,$3,$4)',
    [bucket,key,{size:body.length,mimetype:mime,eTag:'fixture-etag'},metadata]);
 };
 for(const key of keys)await register(key,source,'image/png',saved);
 await h.pg.query('update public.properties set images=$1,image_metadata=$2,image_filenames=$3 where id=$4',
   [[another,...urls],Object.fromEntries(urls.map(uri=>[uri,h.caption])),Object.fromEntries(urls.map(uri=>[uri,saved.original_filename])),first]);
 const {rows:[captured]}=await h.pg.query(await readFile(new URL('../scripts/inventory-property-images.sql',import.meta.url),'utf8'));
 await writeFile(inventory,JSON.stringify(captured.inventory));
 const helpers=(await Promise.all(['switch-optimized-property-photo.sql','property-media-migration-state.sql']
   .map(name=>readFile(new URL('../scripts/'+name,import.meta.url),'utf8')))).join('\n');
 const db=databaseStages(async sql=>{
  const result=await h.pg.exec(sql);
  return Object.values(result.at(-1).rows[0])[0];
 },helpers);
 let loseSwitch=true,opens=0,reads=0,uploads=0,applies=0,retirements=0;
 const lostWriteAck=storageStages({key:'sb_publishable_fixture',token:'owner-fixture',pace:async()=>{},
  fetcher:async()=>Response.json({error:'unavailable'},{status:503})});
 const transport={
  ...db,owner:async()=>owner,
  async read(identity){reads++;return h.files.get(identity.key).bytes;},
  async verifyPublic(identity,bytes){assert.deepEqual(h.files.get(identity.key).bytes,bytes);},
  async upload(key,body,mime,metadata){
   uploads++;
   await register(key,body,mime,metadata);
   if(uploads===1) await lostWriteAck.upload(key,body,mime,metadata);
   if(uploads===2) throw new Error('fixture lost upload response');
  },
  async switchPhotos(args){
   const result=await db.switchPhotos(args);
   if(args.apply){applies++;if(loseSwitch){loseSwitch=false;throw new Error('fixture lost switch response');}}
   return result;
  },
  async retire(id){
   retirements++;
   await retirePropertyPhoto(h.client('authenticated',owner),h.client('service_role'),origin,id,signal());
   await lostWriteAck.retire(id);
  },
 };
 const factory=async()=>{opens++;return transport;};
 const audit=await runMediaStage('audit',{inventory,work,apply:true,limit:2,egressBytes:50_000_000,storageBytes:1_000_000});
 const [a,b]=audit.selected.map(entry=>entry.token);
 const run=(stage,extra={})=>runMediaStage(stage,{work,apply:true,approve:audit.batchId,...extra},factory);
 assert.equal((await run('backup',{apply:false})).dryRun,true);
 await assert.rejects(run('backup',{approve:'wrong'}),/explicit approval/);
 assert.equal(opens,0);
 const tiny=await runMediaStage('audit',{inventory,work:join(directory,'tiny'),apply:true,limit:1,
   egressBytes:source.length-1,storageBytes:500000});
 const capped=await run('backup',{work:join(directory,'tiny'),approve:tiny.batchId});
 assert.match(capped.results[0].reason,/budget would be exceeded/);
 assert.equal(reads,0);
 const retryWork=join(directory,'retry');
 const retry=await runMediaStage('audit',{inventory,work:retryWork,apply:true,limit:1,
   egressBytes:source.length*4,storageBytes:500000});
 let retries=0;
 const failRead=()=>({...transport,read:async()=>{retries++;throw new Error('fixture stalled transfer');}});
 for(let attempt=0;attempt<4;attempt++){
  const outcome=await runMediaStage('backup',{work:retryWork,apply:true,approve:retry.batchId},failRead);
  assert.equal(outcome.blocked,true);
  if(attempt===3)assert.match(outcome.results[0].reason,/attempt limit/);
 }
 assert.equal(retries,3);

 assert.equal((await run('backup')).blocked,false);
 assert.equal((await run('backup')).blocked,false);
 assert.equal(reads,2);
 const conversion=await run('convert');
 assert.equal(conversion.results.length,2);
 assert.ok(conversion.results.every(result=>result.outputMime==='image/webp'&&result.replacementKey.endsWith('/can-ho-03.webp')));
 const sourceBatch=await readStagedBatch(work);
 const rows=sourceBatch.photos.map(({entry,result})=>({token:entry.token,listing:first,old_key:entry.key,new_key:result.replacementKey}));
 await h.pg.query('update public.properties set updated_at=$1 where id=$2',[changedVersion,first]);
 const review=await db.review(rows);
 const reviewed=reviewedContinuation(sourceBatch,review);
 assert.equal(Date.parse(reviewed.entries[0].listing.version),Date.parse(changedVersion));
 assert.equal(reviewed.sourceBatchId,audit.batchId);
 assert.notEqual(reviewed.id,audit.batchId);
 const resumedWork=join(directory,'continuation');
 await sealContinuation(resumedWork,work,reviewed);
 assert.equal((await continuationCheckpoint(resumedWork,sourceBatch)).batch.id,reviewed.id);
 await h.pg.query('update public.editorial_articles set image_url=$1',[urls[0]]);
 const sharedReview=await db.review(rows);
 assert.throws(()=>reviewedContinuation(sourceBatch,sharedReview),/live reference or object audit failed/);
 await h.pg.query('update public.editorial_articles set image_url=$1',[another]);
 await h.pg.query('update public.properties set updated_at=$1 where id=$2',[version,first]);
 assert.equal((await run('upload')).blocked,true);
 assert.equal((await run('upload')).blocked,false);
 assert.equal(uploads,2);
 assert.equal((await run('migrate')).blocked,true);
 assert.equal(applies,1);
 assert.equal((await run('migrate')).blocked,false);
 assert.equal(applies,2);
 assert.equal((await run('verify')).blocked,false);
 assert.equal((await run('rollback',{tokens:[b]})).blocked,false);
 const restored=await h.listing(first);
 const bUrl=urls[keys.indexOf(audit.selected[1].key)];
 assert.ok(restored.images.includes(bUrl));
 assert.deepEqual(restored.image_metadata[bUrl],h.caption);
 const oldAsset=audit.selected[0].key;
 await assert.rejects(run('cleanup',{tokens:[a]}),/retire-originals/);
 const handoff={tokens:[a],retireOriginals:true};
 const manifestFile=join(work,'batch.json');
 const manifest=await readFile(manifestFile,'utf8');
 const cap=JSON.parse(manifest).budget.egressBytes;
 const journalFile=join(work,'journal.json');
 const journal=JSON.parse(await readFile(journalFile,'utf8'));
 // Simulate previous charges that left the current retirement one byte short.
 journal.spent.egressBytes=cap-PROPERTY_IMAGE_MAX_BYTES+1;
 await writeFile(journalFile,JSON.stringify(journal));
 const blocked=await run('cleanup',handoff);
 assert.equal(blocked.results[0].reason,'egressBytes budget would be exceeded.');
 assert.equal(retirements,0);
 assert.deepEqual(JSON.parse(await readFile(journalFile,'utf8')),journal);
 assert.equal((await run('cleanup',{...handoff,egressIncreaseBytes:1})).blocked,false);
 assert.equal(h.files.has(oldAsset),false);
 assert.equal((await run('cleanup',handoff)).blocked,false);
 assert.equal(retirements,1);
 const cleanupCalls=h.calls.filter(([action])=>action==='remove');
 assert.deepEqual(cleanupCalls,[['remove',oldAsset]]);
 assert.equal((await run('report')).items.find(item=>item.token===a).state,'cleaned');
 const {items,spent}=JSON.parse(await readFile(journalFile,'utf8'));
 assert.equal(spent.egressBytes,cap+1);
 assert.equal(await readFile(manifestFile,'utf8'),manifest);
 const {uploaded,retirementId}=items[a];
 const retired=[{listing:first,old_key:oldAsset,new_key:uploaded.key,job:retirementId,identity:uploaded}];
 await h.pg.query("update public.properties set status='published' where id=$1",[first]);
 const productionCheck=await db.verifyRun(retired);
 assert.equal(productionCheck.confirmed,1);
 assert.deepEqual(productionCheck.sample,{slug:'fixture-home',key:uploaded.key});
 await h.pg.query("update storage.objects set metadata=metadata||'{\"eTag\":\"new\"}'::jsonb where name=$1",[uploaded.key]);
 assert.equal((await db.verifyRun(retired)).confirmed,0);
 await assert.rejects(h.pg.query('update site_settings set hero_image=$1',[propertyPhotoUrl(origin,oldAsset)]),/retired_reference|stale_reference/);
});

test('Owner-only copy, stale edit retry, atomic references, retained originals and explicit removal',async t=>{
 const h=await setup(t), write=h.client('authenticated',owner), system=h.client('service_role');
 const input={propertyId:first,source:oldUrl,filename:'room.jpg (3).jpg',version};
 const rename=(db=write,extra={})=>renamePropertyPhoto(db,system,origin,{...input,...extra},signal());
 const photos=h.listing;
 for(const actor of [admin,manager,editor])await assert.rejects(rename(h.client('authenticated',actor)),/forbidden/);
 assert.equal(h.calls.length,0);
 await h.pg.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[owner]);
 await assert.rejects(rename(),/forbidden/);
 await h.pg.query('update auth.users set banned_until=null where id=$1',[owner]);
 await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('insert into storage.objects values($1,$2)',[bucket,newKey])),/policy/);
 assert.equal((await h.role('authenticated',editor,()=>h.pg.query('delete from storage.objects where name=$1',[oldKey]))).affectedRows,0);
 await h.pg.query('insert into storage.objects values($1,$2)',[bucket,newKey]);
 await assert.rejects(rename(),/collision/);
 await h.pg.query('delete from storage.objects where name=$1',[newKey]);
 await assert.rejects(rename(write,{source:oldUrl.replace(origin,'https://foreign.example.test')}),/unsupported_source/);
 h.files.set(oldKey,{mime:'image/png',bytes:png});
 await assert.rejects(rename(),/invalid_name/);
 h.files.set(oldKey,{mime:'image/jpeg',bytes:jpeg});

 h.onCopy(async ()=>{
  await h.pg.query('update public.properties set updated_at=$1 where id=$2',[changedVersion,first]);
 });
 await assert.rejects(rename(),/stale_listing/);
 assert.deepEqual((await photos(first)).images,[oldUrl,another]);
 assert.equal(h.files.has(oldKey),true);
 assert.equal((await propertyPhotoRenameHistory(write,first,signal()))[0].applied_at,null);
 const result=await rename(write,{version:changedVersion});
 assert.equal(result.url,newUrl);
 assert.equal(result.properties.length,2);
 assert.deepEqual(result.cleanup,{status:'pending',reason:'review_required'});
 assert.deepEqual(result.savedListing,await photos(first));
 assert.deepEqual((await photos(first)).images,[newUrl,another]);
 assert.deepEqual((await photos(second)).images,[another,transformedNew]);
 assert.deepEqual((await photos(first)).image_metadata,{[newUrl]:h.caption});
 assert.deepEqual((await photos(first)).image_filenames,{[newUrl]:'Room.JPG'});
 assert.deepEqual((await photos(second)).image_metadata,{[transformedNew]:{alt_en:'Shared'}});
 assert.equal((await photos(second)).source_url,newUrl);
 assert.equal((await h.pg.query('select hero_image from public.site_settings')).rows[0].hero_image,newUrl);
 assert.deepEqual((await h.pg.query('select sources from public.editorial_articles')).rows[0].sources,[{title:'Photo',url:newUrl}]);
 assert.deepEqual(h.files.get(newKey)?.bytes,jpeg);
 assert.equal(h.files.has(oldKey),true,'the old URL remains available by default');
 await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('update public.properties set images=$1 where id=$2',[[transformed],first])),
  error=>error.code==='PT409'&&error.message==='photo_rename.stale_reference');
 assert.equal((await rename()).id,result.id,'a lost success response can be retried');
 assert.deepEqual((await rename(write,{cleanupConfirmed:true})).cleanup,{status:'pending',reason:'review_required'},
  'retrying an older operation cannot upgrade it to automatic removal');
 assert.equal(h.calls.filter(call=>call[0]==='remove').length,0);
 const renameRpcs=[
  ['lookup',[first,origin,oldKey,'room-03.jpg']],['reserve',[first,origin,oldKey,'room-03.jpg',version]],
  ['resume',[first,origin,oldKey]],['reserve_v2',[first,origin,oldKey,'room-03.jpg',version,true]],
  ['apply',[result.id,version]],['history',[first]],['request_removal',[result.id,true]],
 ];
 for(const [action,args] of renameRpcs){
  const params=args.map((_,i)=>'$'+(i+1)).join(',');
  await assert.rejects(h.role('authenticated',admin,()=>h.pg.query(`select public.home_photo_rename_${action}(${params})`,args)),/forbidden/,action);
 }
 await assert.rejects(h.role('authenticated',admin,()=>h.pg.query('select private.home_photo_rename_history($1)',[first])),/permission denied/);
 await assert.rejects(h.role('authenticated',owner,()=>h.pg.query('select public.home_photo_rename_request_removal($1,false)',[result.id])),/confirm_required/);
 h.files.set(newKey,{mime:'image/jpeg',bytes:new Uint8Array([255,216,255,224,0,0,0,2])});
 await assert.rejects(retirePropertyPhoto(write,system,origin,result.id,signal()),/integrity_failed/);
 assert.equal(h.files.has(oldKey),true);
 h.files.set(newKey,{mime:'image/jpeg',bytes:jpeg});
 await retirePropertyPhoto(write,system,origin,result.id,signal());
 await retirePropertyPhoto(write,system,origin,result.id,signal());
 assert.equal(h.files.has(oldKey),false);
 assert.equal(h.files.has(newKey),true);
 await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('insert into storage.objects values($1,$2)',[bucket,oldKey])),/policy/);
 assert.equal(h.calls.filter(call=>call[0]==='remove').length,1);
 assert.ok((await propertyPhotoRenameHistory(write,first,signal()))[0].removed_at);
});

test('permanent deletion captures each listing state and leaves shared CRM and gallery files available',async t=>{
 const h=await setup(t), db=h.client('authenticated',admin), system=h.client('service_role');
 for(const [i,status] of ['draft','published','archived'].entries()){
  const id=`30303030-0000-4000-8000-00000000000${i}`;
  const photo=`properties/listings/${id}/${first}/photo.jpg`, shared=`properties/listings/${id}/${second}/shared.jpg`;
  const video=`${admin}/${id}/${first}.mp4`, old=`properties/${id}.jpg`, renamed=`properties/renamed/${id}/cover.jpg`;
  const incoming=propertyPhotoUrl(origin,shared).replace('/object/public/','/render/image/public/')+'?width=600';
  const enquiry=crypto.randomUUID(), landlord=crypto.randomUUID();
  const images=[propertyPhotoUrl(origin,renamed),propertyPhotoUrl(origin,photo),propertyPhotoUrl(origin,shared)];
  const videoUrl=origin+'/storage/v1/object/public/listing-videos/'+video;
  await h.pg.query('insert into properties(id,images,updated_at,status,video_url) values($1,$2,$3,$4,$5)',[id,images,version,status,videoUrl]);
  await h.pg.query('insert into public.enquiries values($1,$2,$3)',[enquiry,id,`More photos: ${incoming}.`]);
  await h.pg.query('insert into public.landlord_submissions values($1,$2,$3)',[landlord,id,`Saved photo ${incoming}`]);
  await h.pg.query('insert into public.landlord_submission_files values($1,$2)',[landlord,'private-file.pdf']);
  await h.pg.query('insert into public.saved_homes values ($1)',[id]);
  for(const key of [photo,shared,old,renamed])await h.pg.query('insert into storage.objects values($1,$2)',[bucket,key]);
  await h.pg.query('insert into storage.objects values($1,$2)',['listing-videos',video]);
  await h.pg.query(`insert into private.property_photo_renames(property_id,origin,old_key,new_key,started_by,applied_at)
    values($1,$2,$3,$4,$5,now())`,[id,origin,old,renamed,admin]);
  // A second active listing also uses the same transformed object.
  await h.pg.query('update properties set images=array_append(images,$1) where id=$2',[incoming,second]);
  if(status==='archived'){
   await h.pg.query("update properties set status='published' where id=$1",[id]);
   await h.pg.query("update properties set status='archived' where id=$1",[id]);
   assert.equal((await h.pg.query('select name from storage.objects where name=$1',[video])).rows.length,1);
  }
  await assert.rejects(h.role('authenticated',admin,()=>h.pg.query('delete from properties where id=$1',[id])),/permission denied/);
  await assert.rejects(h.role('authenticated',admin,()=>h.pg.query('select public.delete_property($1)',[id])),/permission denied/);
  await assert.rejects(deleteListingAndMedia(h.client('authenticated',editor),system,editor,id,{version},signal()),/forbidden/);
  await assert.rejects(deleteListingAndMedia(db,system,admin,id,{version:changedVersion},signal()),/stale/);
  if(status==='draft'){
   h.onRemove((_key,b)=>{if(b===bucket)throw new Error('Simulated storage failure');});
  }
  const result=await deleteListingAndMedia(db,system,admin,id,{version},signal());
  assert.equal(await h.listing(id),null);
  assert.equal(result.retained,1);
  assert.equal(result.pending,status==='draft'?3:0);
  assert.equal((await h.pg.query('select property_id from enquiries where id=$1',[enquiry])).rows[0].property_id,null);
  assert.equal((await h.pg.query('select property_code from enquiry_notes where enquiry_id=$1',[enquiry])).rows[0].property_code,'TEST');
  assert.equal((await h.pg.query('select * from landlord_submission_files where submission_id=$1',[landlord])).rows.length,1);
  assert.equal((await h.pg.query('select * from saved_homes where property_id=$1',[id])).rows.length,0);
  assert.equal((await h.pg.query('select name from storage.objects where name=$1',[video])).rows.length,0);
  assert.equal((await h.pg.query('select name from storage.objects where name=$1',[shared])).rows.length,1);
  assert.equal((await h.pg.query('select previous_status from private.home_listing_deletions where property_id=$1',[id])).rows[0].previous_status,status);
  await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('insert into storage.objects values($1,$2)',
    [bucket,`properties/listings/${id}/${first}/late.jpg`])),/policy/);
  await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('insert into storage.objects values($1,$2)',
    ['listing-videos',`${admin}/${id}/${second}.mp4`])),/policy/);
 await assert.rejects(h.pg.query('insert into feedback_public values($1)',[`Please use ${images[1]}.`]),
  error=>error.code==='PT409'&&error.message==='listing_cleanup.retired_reference');
  if(status==='draft'){
   assert.equal((await listingDeletionQueue(db,signal()))[0].propertyId,id);
   h.onRemove(()=>{});
   const recovered=await deleteListingAndMedia(db,system,admin,id,{retry:true},signal());
   assert.equal(recovered.pending,0);assert.equal(recovered.removed,4);
  }
  const calls=h.calls.length;
  const repeat=await deleteListingAndMedia(db,system,admin,id,{version},signal());
  assert.equal(repeat.removed,4);assert.equal(h.calls.length,calls);
 }
 assert.deepEqual(await listingDeletionQueue(db,signal()),[]);
});

test('a changed object or an undocumented provider removal is held for review',async t=>{
 const h=await setup(t), db=h.client('authenticated',admin), system=h.client('service_role');
 const gone=`properties/listings/${first}/${first}/gone.jpg`, changed=`properties/listings/${first}/${second}/changed.jpg`;
 for(const key of [gone,changed])await h.pg.query('insert into storage.objects values($1,$2)',[bucket,key]);
 h.onRemove(async()=>{
  await h.pg.query('delete from storage.objects where name=$1',[gone]);
  await h.pg.query("update storage.objects set version='new-object' where name=$1",[changed]);
  throw new Error('Simulated provider failure after one catalogue commit');
 });
 const result=await deleteListingAndMedia(db,system,admin,first,{version},signal());
 assert.equal(result.pending,2);assert.equal(result.removed,0);
 const calls=h.calls.length;
 const retry=await deleteListingAndMedia(db,system,admin,first,{retry:true},signal());
 assert.equal(retry.pending,0);assert.equal(retry.review,2);assert.equal(retry.removed,0);
 assert.equal(h.calls.length,calls);
 assert.ok((await h.pg.query('select 1 from storage.objects where name=$1',[changed])).rows.length);
});

test('an in-flight rename blocks deletion and historical recovery checks the reviewed object identity',async t=>{
 const h=await setup(t), db=h.client('authenticated',owner), system=h.client('service_role');
 const find=async key=>(await h.pg.query('select bucket_id as bucket,name,id,version from storage.objects where name=$1',[key])).rows[0];
 h.onCopy(async()=>{
  await assert.rejects(deleteListingAndMedia(db,system,owner,first,{version},signal()),/rename_pending/);
 });
 await renamePropertyPhoto(db,system,origin,{propertyId:first,source:oldUrl,filename:'room-03',version},signal());

 // Reproduce a deletion that happened before the cleanup migration existed.
 await h.pg.exec('alter table properties disable trigger guard_home_listing_delete');
 await h.pg.query('delete from properties where id in ($1,$2)',[first,second]);
 await h.pg.exec('alter table properties enable trigger guard_home_listing_delete');
 await h.pg.exec("update site_settings set hero_image=''; update editorial_articles set sources='[]';");
 const reviewed=await find(newKey);
 await assert.rejects(deleteListingAndMedia(db,system,owner,first,{manifest:[{...reviewed,version:'stale'}]},signal()),/manifest_changed/);
 await h.pg.query('insert into feedback_submissions values($1)',[newUrl]);
 await assert.rejects(deleteListingAndMedia(db,system,owner,first,{manifest:[reviewed]},signal()),/manifest_changed/);
 await h.pg.exec('delete from feedback_submissions');
 const result=await deleteListingAndMedia(db,system,owner,first,{manifest:[reviewed]},signal());
 assert.equal(result.removed,1);assert.equal(await find(newKey),undefined);
 assert.ok(await find(oldKey),'an object absent from the approved manifest is retained');
 assert.equal((await deleteListingAndMedia(db,system,owner,first,{manifest:[reviewed]},signal())).removed,1);
});

test('confirmed cleanup is recoverable after a stale update, failed removal, and lost response',async t=>{
 const h=await setup(t), db=h.client('authenticated',owner), system=h.client('service_role');
 const input={propertyId:first,source:oldUrl,filename:'room-03',version,cleanupConfirmed:true};
 const rename=extra=>renamePropertyPhoto(db,system,origin,{...input,...extra},signal());
 const read=()=>h.listing(first);
 h.onCopy(()=>h.pg.query('update public.properties set updated_at=$1 where id=$2',[changedVersion,first]));
 await assert.rejects(rename(),/stale_listing/);
 assert.deepEqual((await read()).images,[oldUrl,another]);
 assert.ok(h.files.has(oldKey)&&h.files.has(newKey));
 assert.equal(h.calls.some(call=>call[0]==='remove'),false);
 h.onCopy(()=>{});

 h.onRemove(()=>{throw new Error('Simulated Storage failure');});
 const result=await rename({version:changedVersion});
 assert.deepEqual(result.cleanup,{status:'pending',reason:'remove_failed'});
 assert.deepEqual(result.savedListing,await read(),'the returned listing comes from a fresh saved read');
 assert.deepEqual(result.savedListing.images,[newUrl,another]);
 assert.deepEqual(result.savedListing.image_metadata,{[newUrl]:h.caption});
 assert.deepEqual(result.savedListing.image_filenames,{[newUrl]:'Room.JPG'});
 assert.ok(h.files.has(oldKey));
 const pending=(await propertyPhotoRenameHistory(db,first,signal()))[0];
 assert.equal(pending.auto_cleanup_requested,true);
 assert.equal(pending.removed_at,null);

 h.onRemove(()=>{});
 const callsBefore=h.calls.length;
 const resumed=await rename();
 assert.equal(resumed.id,result.id);
 assert.deepEqual(resumed.cleanup,{status:'removed'});
 assert.deepEqual(h.calls.slice(callsBefore),[['remove',oldKey]],'a bare basename resumes without another copy');
 assert.equal(h.files.has(oldKey),false);
 assert.deepEqual((await rename()).cleanup,{status:'removed'});
 assert.equal(h.calls.length,callsBefore+1,'retry after losing the success response performs no Storage writes');

 const current=await read();
 const repeated=await renamePropertyPhoto(h.client('authenticated',owner),system,origin,{
  ...input,source:newUrl,filename:'living-room.jpg',version:current.updated_at,
 },signal());
 assert.deepEqual(repeated.cleanup,{status:'removed'});
 assert.deepEqual((await read()).images,[repeated.url,another]);
 assert.deepEqual((await read()).image_metadata,{[repeated.url]:h.caption});
 assert.deepEqual(h.files.get(propertyPhotoPath(repeated.url,origin))?.bytes,jpeg);
 assert.equal(h.files.has(newKey),false);
});

test('authoritative rename refresh merges open edits and retains the stale-save guard on competing writes',()=>{
 const before={id:first,title_en:'Saved title',images:[oldUrl,another],updated_at:version,
  image_filenames:{[oldUrl]:'Room.JPG'},image_metadata:{[oldUrl]:{description_en:'Saved caption'}}};
 const savedListing={...before,images:[newUrl,another],updated_at:changedVersion,
  image_filenames:{[newUrl]:'Room.JPG'},image_metadata:{[newUrl]:{description_en:'Saved caption'}}};
 const result={savedListing,properties:[{id:first,previous_updated_at:version,updated_at:changedVersion}]};
 const replace=url=>replacePropertyPhotoUrl(url,origin,oldKey,newUrl);
 assert.equal(syncRenamedListingDraft({...before},before,result,replace),savedListing);
 const draft={...before,title_en:'Unsaved title',images:[another,oldUrl],
  image_metadata:{[oldUrl]:{description_en:'Unsaved caption'}}};
 const synced=syncRenamedListingDraft(draft,before,result,replace);
 assert.deepEqual(synced,{...savedListing,title_en:'Unsaved title',images:[another,newUrl],
  image_metadata:{[newUrl]:{description_en:'Unsaved caption'}}});
 const competing={...result,savedListing:{...savedListing,updated_at:'2026-11-19T01:05:00.000Z'}};
 const stale=syncRenamedListingDraft(draft,before,competing,replace);
 assert.equal(stale.updated_at,version);
 assert.equal(stale.title_en,'Unsaved title');
 assert.deepEqual(stale.images,[another,newUrl]);
});

test('media Trash reserves listing files, admits only Owners, and confirms expiry and interrupted removal',async t=>{
 const h=await setup(t,true);
 const as=(role,actor,sql,args=[])=>h.role(role,actor,()=>h.pg.query(sql,args)).then(result=>result.rows[0]?.value);
 const manage=(action,id=null,actor=owner)=>as('authenticated',actor,'select public.home_media_management($1,$2) value',[action,id]);
 const worker=(sql,...args)=>as('service_role',null,sql,args);
 const tracked=`properties/listings/${first}/${second}/owned.webp`;
 const kept=`properties/listings/${first}/${first}/restorable.webp`;
 const urls=[propertyPhotoUrl(origin,tracked),propertyPhotoUrl(origin,kept)];
 for(const key of [tracked,kept])await h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,key]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[urls,first]);
 await stageListingDeletion(h.client('authenticated',admin),first,{version},signal());
 await assert.rejects(manage('status',null,admin),error=>error.code==='42501');
 await assert.rejects(manage('trash',null,editor),error=>error.code==='42501');
 await assert.rejects(as('authenticated',admin,'select public.home_listing_delete_status() value'),error=>error.code==='42501');
 await assert.rejects(as('authenticated',owner,'select public.home_media_claim() value'),error=>error.code==='42501');
 await assert.rejects(worker('select public.home_listing_delete_targets($1,null) value',first),error=>error.code==='42501');
 assert.deepEqual(await worker('select public.home_media_claim() value'),{status:'disabled'});
 const {items}=await manage('scan');
 const a=items.find(x=>x.name===tracked),b=items.find(x=>x.name===kept);
 assert.equal(a.state,'trashed');
 assert.ok(Date.parse(a.expires_at)-Date.now()>47*60*60*1000);
 await assert.rejects(h.pg.query('update public.editorial_articles set image_url=$1',[urls[0]]),/retired_reference/);
 await assert.rejects(h.pg.query("update public.editorial_articles set sources=jsonb_build_array(jsonb_build_object('url',$1::text))",[tracked]),/retired_reference/);
 assert.deepEqual(await manage('restore',b.id),{id:b.id,restored:true});
 await h.pg.query('update public.editorial_articles set image_url=$1',[urls[1]]);
 await h.pg.exec("update private.home_media_control set permanent_enabled=true");
 const empty=await worker('select public.home_media_claim() value');
 assert.deepEqual(empty.items,[]);
 assert.deepEqual(await worker('select public.home_media_claim() value'),{status:'busy'});
 await worker('select public.home_media_finish($1) value',empty.id);
 await h.pg.query("update private.home_media_items set expires_at=now()-interval '1 second' where id=$1",[a.id]);
 await assert.rejects(manage('restore',a.id),/restore_unavailable/);
 const run=await worker('select public.home_media_claim() value');
 assert.deepEqual(run.items.map(item=>item.id),[a.id]);
 assert.equal((await worker('select public.home_media_target($1,$2,true) value',run.id,a.id)).present,true);
 assert.equal(await worker('select public.home_media_settle($1,$2,true) value',run.id,a.id),false);
 await h.pg.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,tracked]);
 await worker('select public.home_media_finish($1) value',run.id);
 await h.pg.query("update private.home_media_items set retry_after=now()-interval '1 sec' where id=$1",[a.id]);
 const recovery=await worker('select public.home_media_claim() value');
 assert.equal((await worker('select public.home_media_target($1,$2,true) value',recovery.id,a.id)).present,false);
 assert.equal(await worker('select public.home_media_settle($1,$2,true) value',recovery.id,a.id),true);
 assert.equal((await manage('status')).items.find(row=>row.id===a.id).state,'removed');
 await assert.rejects(manage('restore',a.id),/restore_unavailable/);
});

test('orphan scan holds active uploads, draft-scoped keys, shared references and uncertain legacy files',async t=>{
 const h=await setup(t,true);
 const uploader='authenticated';
 const upload=(key,actor=editor)=>h.role(uploader,actor,()=>h.pg.query("select public.home_media_upload_lease('property-media',$1)",[key]));
 const detached=`properties/${first}/abandoned.webp`, active=`properties/${first}/active.webp`;
 const draftPath=`properties/listings/${first}/${second}/draft.webp`;
 const shared=`properties/${first}/shared.webp`, legacy='properties/unknown-unused.jpg';
 for(const key of [detached,active,draftPath,shared])await upload(key);
 await assert.rejects(upload(active,admin),/retired_reference/);
 for(const key of [detached,active,draftPath,shared,legacy])await h.pg.query(
   "insert into storage.objects(bucket_id,name,owner_id) values('property-media',$1,$2)",[key,editor]);
 await h.pg.query('update public.editorial_articles set image_url=$1',[propertyPhotoUrl(origin,shared)]);
 await h.pg.query("update private.home_media_items set upload_until=now()-interval '1 hour' where name<>$1",[active]);
 const run=await h.role('authenticated',owner,()=>h.pg.query("select public.home_media_management('trash') value"));
 assert.equal(run.rows[0].value.newlyTrashed,1);
 assert.deepEqual(run.rows[0].value.items.map(item=>item.name),[detached]);
 assert.ok(run.rows[0].value.candidates>=3);
});

test('Owner queues a verified renamed original for 48 hours through the existing rename guard',async t=>{
 const h=await setup(t,true);
 const write=h.client('authenticated',owner),service=h.client('service_role');
 const {id}=await renamePropertyPhoto(write,service,origin,{propertyId:first,source:oldUrl,filename:'room-03.jpg',version},signal());
 const result=await trashOldPropertyPhoto(write,origin,id,signal());
 assert.equal(result.removed,false);
 assert.ok(Date.parse(result.expiresAt)>Date.now());
 assert.equal((await propertyPhotoRenameHistory(write,first,signal()))[0].trash_expires_at,result.expiresAt);
 assert.ok(h.files.has(oldKey));
 assert.deepEqual(h.calls.map(([operation])=>operation),['copy']);
});
