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
  create table storage.s3_multipart_uploads(bucket_id text,key text);
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
 if(retention){
  const codeMigration=await readFile(new URL('../supabase/migrations/20261102065952_short_listing_ids.sql',import.meta.url),'utf8');
  await pg.exec('create sequence public.property_listing_code_seq;');
  await pg.exec(codeMigration.match(/create or replace function private\.assign_listing_code\(\)[\s\S]*?end \$\$;/)[0]);
  await pg.exec('create trigger properties_assign_listing_code before insert or update of listing_code on public.properties for each row execute function private.assign_listing_code()');
  await pg.exec(await readFile(new URL('../supabase/migrations/20261126100000_home_media_retention.sql',import.meta.url),'utf8'));
 }
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
 await h.pg.query('update public.properties set images=$1,image_metadata=$2,image_filenames=$3 where id=$4',
   [urls,{[urls[1]]:h.caption},{[urls[1]]:'Saved filename.webp'},first]);
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
 const restored=await manage('restore',b.id);
 assert.equal(restored.restored,true);
 assert.notEqual(restored.listingId,first);
 const draft=await h.listing(restored.listingId);
 assert.deepEqual({status:draft.status,images:draft.images,metadata:draft.image_metadata,filenames:draft.image_filenames},
  {status:'draft',images:[urls[1]],metadata:{[urls[1]]:h.caption},filenames:{[urls[1]]:'Saved filename.webp'}});
 assert.deepEqual(await manage('restore',b.id),restored);
 assert.equal(await h.listing(first),null);
 await h.pg.query('update public.editorial_articles set image_url=$1',[urls[1]]);
 await h.pg.exec("update private.home_media_control set permanent_enabled=true");
 const empty=await worker('select public.home_media_claim() value');
 assert.deepEqual(empty.items,[]);
 assert.deepEqual(await worker('select public.home_media_claim() value'),{status:'busy'});
 await worker('select public.home_media_finish($1) value',empty.id);
 await h.pg.query("update private.home_media_items set expires_at=now()-interval '1 second' where id=$1",[a.id]);
 await assert.rejects(manage('restore',a.id),/restore_unavailable/);
 const manual=await worker('select public.home_media_claim($1) value',owner);
 await h.pg.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[owner]);
 await assert.rejects(worker('select public.home_media_target($1,$2,true) value',manual.id,a.id),error=>error.code==='42501');
 await worker('select public.home_media_finish($1) value',manual.id);
 await h.pg.query('update auth.users set banned_until=null where id=$1',[owner]);
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
 await h.pg.query('update public.editorial_articles set image_url=$1',[another]);
 await h.pg.query("update public.properties set images='{}',image_metadata='{}',image_filenames='{}' where id=$1",[restored.listingId]);
 assert.equal((await manage('status')).items.find(row=>row.id===b.id).state,'candidate');
 assert.equal((await manage('restore',b.id)).listingId,restored.listingId);
});

test('orphan scan holds active uploads, draft-scoped keys, shared references and uncertain legacy files',async t=>{
 const h=await setup(t,true);
 const uploader='authenticated';
 const upload=(key,actor=editor)=>h.role(uploader,actor,()=>h.pg.query("select public.home_media_upload_lease('property-media',$1)",[key]));
 const detached=`properties/${first}/abandoned.webp`, active=`properties/${first}/active.webp`;
 const draftPath=`properties/listings/${first}/${second}/draft.webp`;
 const shared=`properties/${first}/shared.webp`, legacy='properties/unknown-unused.jpg';
 const incomplete=`properties/${first}/incomplete.webp`;
 for(const key of [detached,active,draftPath,shared,incomplete])await upload(key);
 await assert.rejects(upload(active,admin),/retired_reference/);
 for(const key of [detached,active,draftPath,shared,legacy])await h.pg.query(
   "insert into storage.objects(bucket_id,name,owner_id) values('property-media',$1,$2)",[key,editor]);
 await h.pg.query('update public.editorial_articles set image_url=$1',[propertyPhotoUrl(origin,shared)]);
 await h.pg.query("update private.home_media_items set upload_until=now()-interval '1 hour' where name<>$1",[active]);
 const run=await h.role('authenticated',owner,()=>h.pg.query("select public.home_media_management('trash') value"));
 assert.equal(run.rows[0].value.newlyTrashed,1);
 assert.deepEqual(run.rows[0].value.items.filter(item=>item.state==='trashed').map(item=>item.name),[detached]);
 assert.equal(run.rows[0].value.items.find(item=>item.name===shared).state,'retained');
 assert.equal((await h.pg.query('select 1 from private.home_media_items where name=$1',[incomplete])).rows.length,0);
 assert.ok(run.rows[0].value.candidates>=3);
});

test('Owner queues a verified renamed original for 48 hours through the existing rename guard',async t=>{
 const h=await setup(t,true);
 const write=h.client('authenticated',owner),service=h.client('service_role');
 const beforeFirst=await h.listing(first),beforeSecond=await h.listing(second);
 const {id}=await renamePropertyPhoto(write,service,origin,{propertyId:first,source:oldUrl,filename:'room-03.jpg',version},signal());
 const result=await trashOldPropertyPhoto(write,origin,id,signal());
 assert.equal(result.removed,false);
 assert.ok(Date.parse(result.expiresAt)>Date.now());
 assert.equal((await propertyPhotoRenameHistory(write,first,signal()))[0].trash_expires_at,result.expiresAt);
 assert.ok(h.files.has(oldKey));
 assert.deepEqual(h.calls.map(([operation])=>operation),['copy']);
 const panel=payload=>h.role('authenticated',owner,()=>h.pg.query('select public.home_media_management($1,$2) value',payload))
  .then(r=>r.rows[0].value);
 const item=(await panel(['status',null])).items.find(row=>row.name===oldKey);
 assert.equal(item.restore_mode,'rename');
 const after=await h.listing(first);
 await h.pg.query('update public.properties set image_metadata=$1 where id=$2',[{[newUrl]:{alt_en:'New edit'}},first]);
 await assert.rejects(panel(['restore',item.id]),/restore_conflict/);
 assert.equal((await panel(['status',null])).items.find(row=>row.id===item.id).state,'trashed');
 await h.pg.query('update public.properties set image_metadata=$1 where id=$2',[after.image_metadata,first]);
 assert.equal((await panel(['restore',item.id])).listingId,first);
 for(const before of [beforeFirst,beforeSecond]) {
  const saved=await h.listing(before.id);
  for(const field of ['images','image_metadata','image_filenames','source_url'])assert.deepEqual(saved[field],before[field]);
 }
});

test('saved removals create recoverable entries and preserve files another record still uses',async t=>{
 const h=await setup(t,true);
 const shared=`properties/listings/${first}/${first}/shared.webp`;
 const removed=`properties/listings/${first}/${second}/removed.webp`;
 const sharedUrl=propertyPhotoUrl(origin,shared);
 for(const name of [shared,removed])await h.pg.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,name]);
 const removedUrl=propertyPhotoUrl(origin,removed);
 await h.pg.query('update public.properties set images=$1,image_metadata=$2,image_filenames=$3 where id=$4',
  [[sharedUrl,removedUrl,another],{[removedUrl]:h.caption},{[removedUrl]:'Restored.webp'},first]);
 await h.pg.query('update public.editorial_articles set image_url=$1',[sharedUrl]);
 await h.pg.query("update public.properties set images=$1,image_metadata='{}',image_filenames='{}' where id=$2",[[another],first]);
 const manage=(action,id=null)=>h.role('authenticated',owner,()=>h.pg.query('select public.home_media_management($1,$2) value',[action,id]))
   .then(({rows})=>rows[0].value);
 const pending=(await manage('status')).items.find(row=>row.name===removed);
 assert.equal(pending.state,'candidate');
 assert.deepEqual(await manage('restore',pending.id),{id:pending.id,restored:true,listingId:first});
 const restored=await h.listing(first);
 assert.deepEqual(restored.images,[removedUrl,another]);
 assert.deepEqual(restored.image_metadata,{[removedUrl]:h.caption});
 assert.deepEqual(restored.image_filenames,{[removedUrl]:'Restored.webp'});
 const report=await manage('trash');
 assert.equal(report.items.find(row=>row.name===shared).state,'retained');
 assert.equal(report.items.find(row=>row.name===removed).state,'restored');
 assert.deepEqual(h.calls,[]);
});

test('historical review joins the retention queue only after its current identity and dependencies pass',async t=>{
 const h=await setup(t,true);
 const enroll=(review,confirm=true,actor=owner)=>h.role('authenticated',actor,()=>h.pg.query(
   'select public.home_media_enroll_historical($1,$2) value',[review,confirm])).then(result=>result.rows[0].value);
 const key='properties/verified-historical.webp', filename='Legacy Living Room.webp';
 const {rows:[object]}=await h.pg.query(`insert into storage.objects(bucket_id,name,metadata,user_metadata)
   values('property-media',$1,$2,$3) returning id,version`,[key,{size:8,eTag:'known'},{original_filename:filename}]);
 const review={key,objectId:object.id,version:object.version,bytes:8,etag:'known',
   backupSha256:'a'.repeat(64),evidenceRef:'fixture-audit-lease-42'};
 await assert.rejects(enroll(review,true,admin),error=>error.code==='42501');
 await assert.rejects(enroll(review,false),error=>error.code==='22023');
 await assert.rejects(enroll({...review,etag:'different'}),/manifest_changed/);
 await h.pg.query('update public.editorial_articles set sources=$1',[JSON.stringify([{name:filename}])]);
 await assert.rejects(enroll(review),/manifest_changed/);
 await h.pg.query("update public.editorial_articles set sources='[]'");
 await h.pg.query("insert into storage.s3_multipart_uploads values('property-media',$1)",[key]);
 await assert.rejects(enroll(review),/manifest_changed/);
 await h.pg.exec('delete from storage.s3_multipart_uploads');
 const result=await enroll(review);
 assert.deepEqual(await enroll(review),result);
 const {rows:[record]}=await h.pg.query('select * from private.home_media_items where id=$1',[result.id]);
 assert.equal(record.source,'historical');
 assert.equal(record.state,'trashed');
 assert.equal(record.historical_review.actor,owner);
 assert.ok(Date.parse(result.expiresAt)-Date.now()>47*60*60*1000);
 assert.equal((await h.pg.query('select count(*) n from private.home_listing_deletions')).rows[0].n,0);
 assert.equal((await h.pg.query('select count(*) n from private.property_photo_renames')).rows[0].n,0);
});

test('inventory diagnostics preserve the Owner boundary and distinguish the schedule from the permanent gate',async t=>{
 const h=await setup(t,true);
 await h.pg.exec(await readFile(new URL('../supabase/migrations/20261126114500_home_media_inventory_diagnostics.sql',import.meta.url),'utf8'));
 const inventory=(user,action='status')=>h.role('authenticated',user,()=>
  h.pg.query('select public.home_media_management($1) value',[action])).then(result=>result.rows[0].value);
 await assert.rejects(inventory(admin),error=>error.code==='42501');
 await assert.rejects(h.role('authenticated',admin,()=>h.pg.query("select private.home_media_management('status')")),error=>error.code==='42501');
 const initial=await inventory(owner);
 assert.equal(initial.enabled,false);
 assert.equal(initial.automaticScheduled,false);
 assert.equal(initial.lastScanAt,null);
 assert.equal(initial.verifiedCandidates,0);

 const key=`properties/listings/${first}/${first}/detached.webp`;
 const url=propertyPhotoUrl(origin,key);
 await h.pg.query("insert into storage.objects(bucket_id,name) values('property-media',$1)",[key]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[[url],first]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[[another],first]);
 await h.pg.exec(`create schema cron;create table cron.job(jobname text,active boolean);
  insert into cron.job values('gary-home-media-expiry',true);`);
 const scanned=await inventory(owner,'scan');
 assert.equal(scanned.enabled,false);
 assert.equal(scanned.automaticScheduled,true);
 assert.ok(scanned.lastScanAt);
 assert.equal(scanned.verifiedCandidates,0);
 const staged=await inventory(owner,'trash');
 assert.equal(staged.verifiedCandidates,1);
 assert.equal(staged.verifiedCandidateBytes,8);
 assert.ok(staged.items.some(item=>item.name===key&&item.state==='trashed'));
 await assert.rejects(h.pg.query('update public.editorial_articles set image_url=$1',[url]),error=>error.code==='PT409');
 await h.pg.query("update storage.objects set version='changed' where name=$1",[key]);
 const changed=await inventory(owner);
 assert.equal(changed.verifiedCandidates,0);
 assert.equal(changed.heldCandidates,staged.heldCandidates+1);
});

test('paged media panel separates permanent receipts, records scans and stages only a verified live identity',async t=>{
 const h=await setup(t,true);
 for(const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql']){
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 const panel=(action,offset=0,actor=owner,role='authenticated')=>h.role(role,actor,()=>
  h.pg.query('select public.home_media_management($1,null,$2) value',[action,offset])).then(result=>result.rows[0].value);
 for(const action of ['overview','inventory_scan','inventory_page','trash_page','removed_page','run_page','trash']){
  await assert.rejects(panel(action,0,admin),error=>error.code==='42501');
  await assert.rejects(panel(action,0,null,'anon'),error=>error.code==='42501');
 }
 await h.pg.query(`insert into private.property_photo_renames(property_id,origin,old_key,new_key,started_by,removed_at)
  select $1,$2,'properties/old-'||n||'.jpg','properties/replacement-'||n||'.webp',$3,now()-n*interval '1 second'
  from generate_series(1,509) n`,[first,origin,owner]);
 await h.pg.exec("insert into storage.objects(bucket_id,name) select 'property-media','properties/inventory-'||n||'.webp' from generate_series(1,32) n");
 const empty=await panel('overview');
 assert.equal(empty.panelVersion,2);assert.equal(empty.lastScanAt,null);assert.equal(empty.enabled,false);
 assert.equal(empty.items,undefined);assert.equal((await panel('inventory_page')).available,false);
 await assert.rejects(panel('trash'),error=>error.message==='listing_cleanup.scan_required');
 const removed=await panel('removed_page'),removedNext=await panel('removed_page',30);
 assert.equal(removed.items.length,30);assert.equal(removed.hasMore,true);
 assert.notEqual(removed.items.at(-1).name,removedNext.items[0].name);
 assert.equal(removed.items[0].name,'properties/old-1.jpg');
 assert.equal((await panel('removed_page',480)).items.length,29);
 assert.deepEqual((await panel('trash_page')).items,[]);

 const attached=`properties/listings/${first}/${first}/owner-panel.webp`,unreviewed=`properties/listings/${second}/${second}/protected.webp`;
 const link=propertyPhotoUrl(origin,attached);
 await h.pg.query("insert into storage.objects(bucket_id,name) values('property-media',$1),('property-media',$2)",[attached,unreviewed]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[[link],first]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[[another],first]);
 const scan=await panel('inventory_scan');
 assert.ok(scan.lastScanAt);assert.equal(scan.checkedQueue,1);assert.equal(scan.readyToTrash,1);
 assert.equal(scan.protectedCandidates,1);assert.equal(scan.items,undefined);assert.equal(scan.entries,undefined);
 const firstPage=await panel('inventory_page');
 assert.equal(firstPage.items.length,30);assert.equal(firstPage.hasMore,true);
 const remaining=await panel('inventory_page',30);
 assert.ok([...firstPage.items,...remaining.items].some(item=>item.name===unreviewed&&item.reason==='listing'));
 assert.equal((await panel('overview')).lastScanAt,scan.lastScanAt);
 const original=(await h.pg.query('select version from storage.objects where name=$1',[attached])).rows[0].version;
 await h.pg.query("update storage.objects set version='changed' where name=$1",[attached]);
 assert.equal((await panel('trash')).newlyTrashed,0);
 await h.pg.query('update storage.objects set version=$1 where name=$2',[original,attached]);
 const staged=await panel('trash');
 assert.equal(staged.newlyTrashed,1);assert.equal(staged.readyToTrash,0);
 assert.equal(staged.enabled,false);assert.equal(staged.lastScanAt,scan.lastScanAt);
 const trash=await panel('trash_page');
 assert.equal(trash.items.length,1);assert.equal(trash.items[0].name,attached);assert.equal(trash.items[0].restore_mode,'listing');
 assert.ok(Date.parse(trash.items[0].expires_at)-Date.now()>47*60*60*1000);
 const restored=await h.role('authenticated',owner,()=>h.pg.query("select public.home_media_management('restore',$1) as result",[trash.items[0].id]));
 assert.equal(restored.rows[0].result.restored,true);
 assert.ok((await h.pg.query('select images from public.properties where id=$1',[first])).rows[0].images.includes(link));
 await h.pg.exec(`create or replace function private.home_media_take_inventory(p_scan boolean,p_after uuid default null) returns jsonb
   language plpgsql stable set search_path='' as $$begin raise exception 'unexpected inventory rebuild';end;$$;`);
 assert.equal((await panel('overview')).lastScanAt,scan.lastScanAt);
 assert.deepEqual(await panel('inventory_page'),firstPage);
 assert.deepEqual(await panel('removed_page'),removed);
 assert.deepEqual((await panel('run_page')).items,[]);
});

test('Owner orphan review protects draft paths and holds while enrollment still requires exact evidence',async t=>{
 const h=await setup(t,true);
 for(const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql','20261126175956_home_media_orphan_review.sql'])
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const query=(role,actor,sql,args=[])=>h.role(role,actor,()=>h.pg.query(sql,args)).then(result=>result.rows[0]?.value);
 const review=(action,payload={},actor=owner,role='authenticated')=>query(role,actor,'select public.home_media_review($1,$2) value',[action,payload]);
 const current=await h.pg.query('select listing_code from public.properties where id=$1',[first]);
 await h.pg.query("update public.properties set listing_code='GH-645' where id=$1",[first]);
 assert.notEqual(current.rows[0].listing_code,'GH-645');
 const draft=`properties/listings/${first}/${second}/Recovered Draft.webp`;
 const free='properties/legacy-review.webp',upload='properties/incomplete.webp';
 for(const name of [draft,free,upload]) await h.pg.query("insert into storage.objects(bucket_id,name,metadata) values('property-media',$1,'{\"size\":8,\"eTag\":\"fixture\"}')",[name]);
 await h.pg.query("insert into storage.s3_multipart_uploads values('property-media',$1)",[upload]);
 await query('authenticated',owner,"select public.home_media_management('inventory_scan') value");
 await assert.rejects(review('page',{},admin),error=>error.code==='42501');
 await assert.rejects(review('page',{},null,'anon'),error=>error.code==='42501');
 const draftPage=await review('page',{query:'gh-645'});
 assert.deepEqual(draftPage.items.map(row=>[row.key,row.listingCode,row.reason]),[[draft,'GH-645','listing']]);
 const byKey=Object.fromEntries((await review('page')).items.map(row=>[row.key,row]));
 assert.deepEqual(await review('verify',byKey[draft]),{result:'listing'});
 assert.deepEqual(await review('verify',byKey[upload]),{result:'upload'});
 const proof={...byKey[free],confirm:true,backupSha256:'a'.repeat(64),evidenceRef:'reviewed-backup-fixture'};
 await assert.rejects(review('enroll',{...proof,...byKey[draft]}),/manifest_changed/);
 await assert.rejects(review('hold',proof,admin),error=>error.code==='42501');
 assert.deepEqual(await review('verify',byKey[free]),{result:'evidence_required'});
 assert.deepEqual(await review('hold',proof),{held:true});
 assert.equal((await review('page')).holds,1);
 assert.deepEqual(await review('verify',byKey[free]),{result:'owner_hold'});
 await assert.rejects(query('authenticated',owner,'select public.home_media_enroll_historical($1,true) value',[proof]),/manifest_changed/);
 assert.deepEqual(await review('release',proof),{held:false});
 await assert.rejects(review('enroll',{...proof,backupSha256:undefined}),/invalid_manifest/);
 await assert.rejects(review('enroll',{...proof,confirm:false}),/invalid_manifest/);
 const receipt=await review('enroll',proof);
 assert.deepEqual(await review('enroll',proof),receipt);
 assert.ok(Date.parse(receipt.expiresAt)-Date.now()>47*60*60*1000);
 assert.equal((await h.pg.query('select count(*) n from private.home_media_items')).rows[0].n,1);
 assert.deepEqual(await review('hold',proof),{held:true});
 await h.pg.query("update private.home_media_items set expires_at=now()-interval '1 second' where id=$1",[receipt.id]);
 await h.pg.exec('update private.home_media_control set permanent_enabled=true where singleton');
 const claimed=await query('service_role',null,'select public.home_media_claim() value');
 assert.equal(claimed.items[0].id,receipt.id);
 assert.equal(await query('service_role',null,'select public.home_media_target($1,$2,true) value',[claimed.id,receipt.id]),null);
 assert.equal((await h.pg.query('select count(*) n from storage.objects where name=$1',[free])).rows[0].n,1);
});

test('bulk historical intake preserves exact receipts and fences GH-56 through final cleanup', async t => {
 const h=await setup(t,true);
 for (const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql',
   '20261126175956_home_media_orphan_review.sql','20261126200632_home_media_historical_bulk_enrollment.sql']) {
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 const call=(as,actor,sql,args=[])=>h.role(as,actor,()=>h.pg.query(sql,args)).then(result=>result.rows[0].value);
 const authorizationId='e3a34065-c066-4cbb-ae43-3ce02418887a';
 const intake=(action,payload,actor=owner,as='authenticated')=>call(as,actor,'select public.home_media_historical_intake($1,$2) value',
   [action,{authorizationId,...payload}]);
 const gh='198b8547-8614-4a8e-b125-7e6d9846df57', prefix=`properties/listings/${gh}/`;
 await h.pg.query("insert into public.properties(id,images,updated_at,listing_code) values($1,'{}','2026-11-26T05:45:17.517353+00','GH-56')",[gh]);
 const add=async (key,objectId,version,bytes,etag,scope='historical')=>{
  await h.pg.query("insert into storage.objects(bucket_id,name,id,version,metadata) values('property-media',$1,$2,$3,$4)",
    [key,objectId,version,{size:bytes,eTag:etag,mimetype:'image/webp'}]);
  return {key,objectId,version,bytes,etag,scope,confirm:true,evidenceRef:'recorded Owner fixture approval',backupSha256:'a'.repeat(64)};
 };
 const scoped=await add(prefix+'37e55a65-d019-447b-bb88-99c03a0bca07/jobs-staff-portal-header.webp',
   '5cdcb39e-b324-418b-a447-71886cac26f2','8e02bfef-0ea4-4b4f-ab34-510a0289f39a',7704,'12c8bd03f06507b71526120002e96df9-1','GH-56');
 const later=await add(prefix+'fd2c8e2f-4e52-4df3-aa4a-610c946830b2/manual-cleanup-fronend-1.jpg',
   '16a878a9-f1b2-4c9b-a4cd-966e4c2e82ea','6adbf40f-494e-490c-b553-1967119cca30',36021,'5d67a55b687a2c33fdf29adff2506821-1','GH-56');
 const other=await add(prefix+'unrelated.webp','bcda8547-8614-4a8e-b125-7e6d9846df57','test-version',8,'b'.repeat(32),'GH-56');
 const ordinary=await add('properties/bulk-test.webp','bcda8547-8614-4a8e-b125-7e6d9846df58','test-version',8,'c'.repeat(32));
 const objects=[scoped,later,ordinary];
 const members=Object.fromEntries(objects.map(o=>[o.objectId,[o.scope,o.version,o.bytes,o.key]]));
 await h.pg.query('insert into private.home_media_bulk_authorizations(id,actor,manifest_sha256,gh56_sha256,initial_egress_budget,members) values($1,$2,$3,$4,100000,$5)',
   [authorizationId,owner,'a'.repeat(64),'b'.repeat(64),members]);
 await assert.rejects(intake('inspect',scoped,admin),error=>error.code==='42501');
 await assert.rejects(intake('receipt',scoped,null,'anon'),error=>error.code==='42501');
 await assert.rejects(intake('inspect',{...scoped,authorizationId:other.objectId}),error=>error.code==='42501');
 assert.equal((await intake('inspect',other)).status,'outside_authorized_manifest');
 assert.equal((await intake('inspect',{...scoped,scope:'historical'})).status,'outside_authorized_manifest');
 assert.equal((await intake('inspect',{...scoped,version:'changed'})).status,'outside_authorized_manifest');
 await h.pg.query("update storage.objects set version='changed' where name=$1",[scoped.key]);
 assert.equal((await intake('inspect',scoped)).status,'identity');
 await h.pg.query('update storage.objects set version=$2 where name=$1',[scoped.key,scoped.version]);
 await assert.rejects(intake('enroll',{...scoped,confirm:false}),error=>error.code==='22023');
 await h.pg.query("insert into storage.s3_multipart_uploads values('property-media',$1)",[scoped.key]);
 assert.equal((await intake('inspect',scoped)).status,'dependency');
 await h.pg.exec('delete from storage.s3_multipart_uploads');
 await h.pg.query("insert into public.editorial_articles(image_url) values($1)",[propertyPhotoUrl(origin,scoped.key)]);
 assert.equal((await intake('enroll',scoped)).status,'reference');
 await h.pg.exec('delete from public.editorial_articles');
 for (const object of [scoped,later,ordinary]) assert.equal((await intake('inspect',object)).status,'evidence_required');
 const [one,two,normal]=[await intake('enroll',scoped),await intake('enroll',later),await intake('enroll',ordinary)];
 for (const receipt of [one,two,normal]) {
  assert.equal(receipt.state,'trashed');
  assert.equal(Date.parse(receipt.expiresAt)-Date.parse(receipt.enrolledAt),172800000);
 }
 const {rows:[audit]}=await h.pg.query('select historical_review from private.home_media_items where id=$1',[normal.id]);
 assert.equal(audit.historical_review.evidenceRef,`owner-bulk-authorization:${authorizationId}`);
 assert.equal(audit.historical_review.intake.authorizationId,authorizationId);
 assert.deepEqual(await intake('enroll',scoped),one);
 assert.deepEqual(await intake('receipt',ordinary),normal);
 assert.equal((await intake('receipt',{...ordinary,backupSha256:'d'.repeat(64)})).status,'tracked');
 await assert.rejects(h.pg.query("insert into public.editorial_articles(image_url) values($1)",[propertyPhotoUrl(origin,later.key)]),/retired_reference/);
 await h.pg.query("insert into public.editorial_articles(sources) values($1)",[JSON.stringify([{name:'manual-cleanup-fronend-1.jpg'}])]);
 assert.equal((await h.pg.query("select private.home_media_referenced('property-media',$1,true) protected",[later.key])).rows[0].protected,true);
 await h.pg.exec('delete from public.editorial_articles');
 await h.pg.exec("update private.home_media_control set permanent_enabled=true; update private.home_media_items set unreferenced_since=now()-interval '49 hours', expires_at=now()-interval '1 hour'");
 const worker=(sql,...args)=>call('service_role',null,sql,args);
 const job=await worker('select public.home_media_claim() value');
 const target=id=>worker('select public.home_media_target($1,$2,true) value',job.id,id);
 assert.equal((await target(one.id)).present,true);
 await h.pg.query("delete from storage.objects where bucket_id='property-media' and name=$1",[scoped.key]);
 assert.equal(await worker('select public.home_media_settle($1,$2,true) value',job.id,one.id),true);
 const settled=await intake('receipt',scoped);
 assert.equal(settled.id,one.id);
 assert.equal(settled.state,'removed');
 assert.equal(settled.storagePresent,false);
 await call('authenticated',owner,'select public.home_listing_delete_prepare($1,$2) value',[gh,'2026-11-26T05:45:17.517353+00']);
 assert.equal((await h.pg.query('select count(*) n from public.properties where id=$1',[gh])).rows[0].n,0);
 assert.equal(await target(two.id),null,'the scoped receipt becomes blocked when the original draft disappears');
});

test('bulk authorization seals the audited manifest and records only one authenticated confirmation', async t => {
 const root=new URL('../work/property-media-audit-20261125.1T3KYQ/',import.meta.url);
 const artifacts=await Promise.all(['production-orphan-classification-20261126.json','gallery-recovery-packet-20261126.json']
   .map(name=>readFile(new URL(name,root),'utf8').then(JSON.parse))).catch(error=>{ if(error.code!=='ENOENT')throw error; return null; });
 if (!artifacts) return t.skip('The local operator audit artifacts are required for the exact manifest test.');
 const { buildBulkManifest }=await import('../scripts/enroll-historical-property-media.mjs');
 const plan=buildBulkManifest(...artifacts);
 const h=await setup(t,true);
 for (const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql',
   '20261126175956_home_media_orphan_review.sql','20261126200632_home_media_historical_bulk_enrollment.sql']) {
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 const request='e3a34065-c066-4cbb-ae43-3ce02418887a';
 const authorize=(confirm,actor=owner,manifest=plan.manifest)=>h.role('authenticated',actor,()=>h.pg.query(
   'select public.home_media_authorize_bulk($1,$2,$3,$4,$5) value',[request,manifest,plan.gh56Manifest,355094895,confirm]))
   .then(result=>result.rows[0].value);
 await assert.rejects(authorize(false,admin),error=>error.code==='42501');
 await assert.rejects(authorize(true,owner,plan.manifest.replace('properties/', 'replacement')),error=>error.code==='22023');
 const preview=await authorize(false);
 assert.equal(preview.files,499);
 assert.equal(preview.excluded,118);
 assert.equal(preview.bytes,355051170);
 assert.equal(preview.gh56Files,2);
 assert.equal((await h.pg.query('select count(*) n from private.home_media_bulk_authorizations')).rows[0].n,0);
 const receipt=await authorize(true);
 assert.deepEqual(await authorize(true),receipt);
 assert.equal(receipt.reference,`owner-bulk-authorization:${request}`);
 const {rows:[saved]}=await h.pg.query('select actor,gh56_prior_decision,(select count(*) from jsonb_object_keys(members)) as members from private.home_media_bulk_authorizations');
 assert.equal(saved.actor,owner);
 assert.equal(saved.members,501);
 assert.match(saved.gh56_prior_decision,/intentionally deleted/);
 const differentOwner='97a34065-c066-4cbb-ae43-3ce02418887a';
 await h.pg.query("insert into auth.users(id,role) values($1,'owner')",[differentOwner]);
 await assert.rejects(authorize(true,differentOwner),error=>error.code==='42501');
});

test('permanent controls protect cross-app documents and refresh live inventory after confirmed removal',async t=>{
 const h=await setup(t,true);
 for(const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql',
   '20261126175956_home_media_orphan_review.sql','20261126200632_home_media_historical_bulk_enrollment.sql']) {
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 await h.pg.exec(`create table public.jobs_cms_revisions(body jsonb); create table public.gary_cms_public(body jsonb);`);
 const shared='properties/linked job photo.webp',alias='properties/visa-legacy.webp',clean='properties/clear.webp',held='properties/on-hold.webp';
 await h.pg.query('insert into public.jobs_cms_revisions values($1)',[{content:`<img src="${origin}/storage/v1/object/public/property-media/properties/linked%20job%20photo.webp">`}]);
 await h.pg.query('insert into public.gary_cms_public values($1)',[{original:' Porto Header.JPG '}]);
 const {rows:items}=await h.pg.query(`with files as (
   insert into storage.objects(bucket_id,name,metadata,user_metadata)
   select 'property-media',name,'{"size":12,"eTag":"fixture"}',case when name=$2 then '{"original_filename":"Porto Header.jpg"}'::jsonb else '{}'::jsonb end
   from unnest($1::text[]) name returning *
 ) insert into private.home_media_items(bucket,name,source,object_id,object_version,bytes,state,unreferenced_since,expires_at,historical_review)
   select 'property-media',name,'historical',id,version,12,'trashed',now()-interval '3 days',
     case when name in ($3,$4) then now()+interval '1 hour' else now()-interval '1 day' end,'{"etag":"fixture"}' from files
   returning id,name,expires_at`,[[shared,alias,clean,held],alias,shared,held]);
 const byKey=Object.fromEntries(items.map(item=>[item.name,item]));
 await h.pg.query("insert into private.home_media_review_holds(bucket,name,actor) values('property-media',$1,$2)",[held,owner]);
 await h.pg.exec(await readFile(new URL('../supabase/migrations/20261127062248_home_media_permanent_controls.sql',import.meta.url),'utf8'));
 const as=(role,actor,sql,args=[])=>h.role(role,actor,()=>h.pg.query(sql,args)).then(result=>result.rows[0].value);
 const dashboard=(action,actor=owner)=>as('authenticated',actor,'select public.home_media_dashboard($1,0) value',[action]);
 const worker=(sql,...args)=>as('service_role',null,sql,args);
 await assert.rejects(dashboard('readiness',admin),error=>error.code==='42501');
 await assert.rejects(h.pg.query('insert into public.jobs_cms_revisions values($1)',[{url:propertyPhotoUrl(origin,clean)}]),/retired_reference/);
 await h.pg.query('insert into public.jobs_cms_revisions values($1)',[{url:'https://jobs.example.test/header.webp'}]);
 assert.equal((await dashboard('trash_page')).items.find(row=>row.id===byKey[held].id).purge_block,'owner_hold');
 await as('authenticated',owner,"select public.home_media_management('inventory_scan') value");
 const before=await dashboard('overview');
 assert.equal(before.crossAppProtection,true);
 assert.equal(before.overdue,2);
 assert.ok(Date.parse(before.nextExpiry)>Date.now());
 await h.pg.exec('update private.home_media_control set permanent_enabled=true where singleton');
 const early=await worker('select public.home_media_claim($1,$2,$3) value',owner,byKey[shared].id,byKey[shared].expires_at);
 assert.equal(await worker('select public.home_media_target($1,$2,true) value',early.id,byKey[shared].id),null);
 await worker('select public.home_media_finish($1) value',early.id);
 const expired=await worker('select public.home_media_claim() value');
 assert.equal(await worker('select public.home_media_target($1,$2,true) value',expired.id,byKey[alias].id),null);
 assert.equal((await worker('select public.home_media_target($1,$2,true) value',expired.id,byKey[clean].id)).present,true);
 await h.pg.query("delete from storage.objects where bucket_id='property-media' and name=$1",[clean]);
 assert.equal(await worker('select public.home_media_settle($1,$2,true) value',expired.id,byKey[clean].id),true);
 const after=await dashboard('overview');
 assert.equal(after.objects,before.objects-1);
 assert.equal(after.bytes,before.bytes-12);
 assert.equal(after.checkedAt,before.checkedAt);
});

test('File Trash counts and whole-manifest reads follow enrollment, restore, scan and confirmed removal',async t=>{
 const h=await setup(t,true);
 for(const name of ['20261126114500_home_media_inventory_diagnostics.sql','20261126170756_home_media_panel_pagination.sql',
   '20261126175956_home_media_orphan_review.sql','20261126200632_home_media_historical_bulk_enrollment.sql',
   '20261127062248_home_media_permanent_controls.sql','20261127064432_home_media_bulk_trash_reads.sql']){
  await h.pg.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 }
 const as=(role,actor,sql,args=[])=>h.role(role,actor,()=>h.pg.query(sql,args)).then(result=>result.rows[0].value);
 const dashboard=(action,actor=owner)=>as('authenticated',actor,'select public.home_media_dashboard($1,0) value',[action]);
 const receipt=(item,actor=owner,expiry=item.expires_at)=>as('authenticated',actor,'select public.home_media_trash_receipt($1,$2) value',[item.id,expiry]);
 const worker=(sql,...args)=>as('service_role',null,sql,args);
 const {rows}=await h.pg.query(`with files as (
   insert into storage.objects(bucket_id,name,metadata)
   select 'property-media','properties/bulk-'||n||'.webp','{"size":16,"eTag":"fixture"}' from generate_series(1,42) n
   returning *
 ) insert into private.home_media_items(bucket,name,source,object_id,object_version,bytes,state,expires_at,historical_review)
   select 'property-media',name,'historical',id,version,16,'trashed',now()+interval '1 hour','{"etag":"fixture"}' from files
   returning id,name,expires_at`);
 const find=n=>rows.find(row=>row.name===`properties/bulk-${n}.webp`);
 await h.pg.query("insert into private.home_media_review_holds(bucket,name,actor) values('property-media',$1,$2)",[find(1).name,owner]);
 await h.pg.query("update private.home_media_items set expires_at=now()-interval '1 hour' where id=$1",[find(2).id]);
 await h.pg.query("update private.home_media_items set upload_until=now()+interval '1 day' where id=$1",[find(3).id]);
 await h.pg.query("update storage.objects set version='changed' where name=$1",[find(4).name]);
 await assert.rejects(dashboard('trash_manifest',admin),error=>error.code==='42501');
 await assert.rejects(receipt(find(5),admin),error=>error.code==='42501');
 assert.equal((await dashboard('overview')).earlyEligible,38);
 assert.equal((await dashboard('overview')).overdue,1);
 const page=await dashboard('trash_page');
 assert.equal(page.items.length,30);
 assert.ok(page.items.every(item=>item.bytes===16));
 const manifest=await dashboard('trash_manifest');
 assert.equal(manifest.items.length,38);
 assert.ok([1,2,3,4].every(n=>!manifest.items.some(item=>item.id===find(n).id)));
 assert.equal((await receipt(find(4))).status,'identity_changed');
 await as('authenticated',owner,"select public.home_media_management('inventory_scan') value");
 assert.equal((await dashboard('overview')).earlyEligible,38);
 assert.equal((await as('authenticated',owner,"select public.home_media_management('restore',$1) value",[find(6).id])).restored,true);
 assert.equal((await dashboard('overview')).earlyEligible,37);
 const key='properties/new-enrollment.webp',tag='known';
 const {rows:[object]}=await h.pg.query("insert into storage.objects(bucket_id,name,metadata) values('property-media',$1,$2) returning id,version",
   [key,{size:32,eTag:tag}]);
 await as('authenticated',owner,'select public.home_media_enroll_historical($1,true) value',[
   {key,etag:tag,bytes:32,objectId:object.id,version:object.version,backupSha256:'a'.repeat(64),evidenceRef:'different verified file'},
 ]);
 const before=await dashboard('overview');
 assert.equal(before.earlyEligible,38);
 const target=find(5);
 await h.pg.exec('update private.home_media_control set permanent_enabled=true where singleton');
 const job=await worker('select public.home_media_claim($1,$2,$3) value',owner,target.id,target.expires_at);
 assert.equal((await receipt(target)).status,'removal_in_progress');
 assert.equal((await worker('select public.home_media_target($1,$2,true) value',job.id,target.id)).present,true);
 await h.pg.query("delete from storage.objects where bucket_id='property-media' and name=$1",[target.name]);
 assert.equal(await worker('select public.home_media_settle($1,$2,true) value',job.id,target.id),true);
 assert.deepEqual(await receipt(target),{status:'removed',bytes:16});
 assert.equal((await receipt(target,owner,'2001-01-01')).status,'selection_changed');
 const after=await dashboard('overview');
 assert.equal(after.earlyEligible,37);
 assert.equal(after.bytes,before.bytes-16);
});

test('confirmed early purge scopes the job to one file and reconciles a lost final acknowledgement',async t=>{
 const h=await setup(t,true);
 const query=(as,user,sql,args=[])=>h.role(as,user,()=>h.pg.query(sql,args)).then(result=>result.rows[0].value);
 const worker=(sql,...args)=>query('service_role',null,sql,args);
 const keys=['early','shared','changed'].map((name,index)=>`properties/listings/${first}/${index?second:first}/${name}.webp`);
 for(const key of keys)await h.pg.query("insert into storage.objects(bucket_id,name) values('property-media',$1)",[key]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[keys.map(key=>propertyPhotoUrl(origin,key)),first]);
 await h.pg.query('update public.properties set images=$1 where id=$2',[[another],first]);
 const list=await query('authenticated',owner,"select public.home_media_management('status') value");
 const [early,shared,changed]=keys.map(key=>list.items.find(item=>item.name===key));
 const claim=(actor,item,expiry=item.expires_at)=>worker('select public.home_media_claim($1,$2,$3) value',actor,item.id,expiry);
 const target=(job,item)=>worker('select public.home_media_target($1,$2,true) value',job.id,item.id);
 const finish=job=>worker('select public.home_media_finish($1) value',job.id);
 await assert.rejects(claim(null,early),error=>error.code==='42501');
 await assert.rejects(claim(admin,early),error=>error.code==='42501');
 assert.deepEqual(await claim(owner,early),{status:'disabled'});
 await h.pg.exec('update private.home_media_control set permanent_enabled=true');
 await assert.rejects(claim(owner,early,'2001-01-01'),/purge_unavailable/);
 for(const item of [shared,changed]) {
  const job=await claim(owner,item);
  if(item===shared)await h.pg.query('update public.editorial_articles set image_url=$1',[propertyPhotoUrl(origin,item.name)]);
  else await h.pg.query("update storage.objects set version='changed' where name=$1",[item.name]);
  assert.equal(await target(job,item),null);
  await finish(job);
 }
 await h.pg.query('update private.home_media_items set attempts=3 where id=$1',[early.id]);
 const job=await claim(owner,early);
 assert.equal(job.items.length,1);
 assert.equal(await target(job,shared),null);
 assert.equal((await target(job,early)).present,true);
 assert.equal(await worker('select public.home_media_settle($1,$2,false) value',job.id,early.id),false);
 await finish(job);
 // The provider completed the removal after the acknowledgement was lost.
 await h.pg.query("delete from storage.objects where bucket_id='property-media' and name=$1",[early.name]);
 await h.pg.query("update private.home_media_items set retry_after=now()-interval '1 second' where id=$1",[early.id]);
 const recovery=await worker('select public.home_media_claim() value');
 assert.equal((await target(recovery,early)).present,false);
 assert.equal(await worker('select public.home_media_settle($1,$2,false) value',recovery.id,early.id),true);
 assert.equal(await worker('select public.home_media_settle($1,$2,false) value',recovery.id,early.id),true);
 const {rows:[final]}=await h.pg.query('select state,attempts,expires_at from private.home_media_items where id=$1',[early.id]);
 assert.equal(final.state,'removed');
 assert.equal(final.attempts,4);
 assert.ok(Date.parse(final.expires_at)>Date.now());
});
