import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {propertyPhotoFilename,propertyPhotoPath,propertyPhotoUrl,replacePropertyPhotoUrl} from '../lib/property-photo-files.ts';
import {propertyPhotoRenameHistory,renamePropertyPhoto,retirePropertyPhoto} from '../lib/property-photo-rename-server.ts';
import {syncRenamedListingDraft} from '../lib/property-photo-rename-state.ts';
import {deleteListingAndMedia,listingDeletionQueue,retryDueListingCleanup} from '../lib/property-deletion-server.ts';

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

async function setup(t) {
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
  create table public.properties(id uuid primary key,images text[] not null,image_metadata jsonb not null default '{}',
    image_filenames jsonb not null default '{}', source_url text,updated_at timestamptz not null,
    status text not null default 'draft',listing_code text not null default 'TEST',address text not null default 'Test address',
    video_url text,listing_type text default 'rent',availability text default 'available');
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
    version text default gen_random_uuid()::text,metadata jsonb default '{"size":8}',primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema storage,private to authenticated;
  grant select,insert,update,delete on storage.objects to authenticated;
  create policy legacy_storage_editor on storage.objects for all to authenticated using(true) with check(true);
  grant select,update,insert,delete on public.properties to authenticated;
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
