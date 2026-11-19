import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {propertyPhotoFilename,propertyPhotoPath,propertyPhotoUrl} from '../lib/property-photo-files.ts';
import {propertyPhotoRenameHistory,renamePropertyPhoto,retirePropertyPhoto} from '../lib/property-photo-rename-server.ts';

const origin='https://storage.example.test', bucket='property-media';
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
  create table public.properties(id uuid primary key,images text[] not null,image_metadata jsonb not null default '{}',
    image_filenames jsonb not null default '{}', source_url text,updated_at timestamptz not null);
  create table public.neighbourhoods(image text);create table public.site_settings(hero_image text);
  create table public.listing_authors(portrait_url text);create table public.site_activities(image_url text,source_url text);
  create table public.editorial_articles(image_url text,sources jsonb not null default '[]');
  create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
  alter table storage.objects enable row level security;
  grant usage on schema storage,private to authenticated;
  grant select,insert,update,delete on storage.objects to authenticated;
  create policy legacy_storage_editor on storage.objects for all to authenticated using(true) with check(true);
  grant select,update on public.properties to authenticated;
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
 const files=new Map([[oldKey,{mime:'image/jpeg',bytes:jpeg}]]), calls=[];
 let onCopy=()=>{};
 const original=globalThis.fetch;
 globalThis.fetch=async target=>{
  const key=propertyPhotoPath(String(target),origin);
  assert.ok(key,'all object requests are restricted to the configured project');
  const file=files.get(key);
  return file?new Response(file.bytes,{headers:{'Content-Type':file.mime}}):new Response(null,{status:404});
 };
 t.after(()=>{globalThis.fetch=original;});
 const client=(as,actor)=>({
  rpc(name,params){return {abortSignal:async()=>{
   const args=Object.values(params);
   try {const rows=await role(as,actor,()=>pg.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') value',args));
    return {data:rows.rows[0]?.value};
   }catch(error){return {error:{code:error.code,message:error.message}};}
  }};},
  from(table){
   assert.equal(table,'properties');
   return {select:()=>({eq:(_,id)=>({abortSignal:()=>({maybeSingle:async()=>({data:(await pg.query('select * from public.properties where id=$1',[id])).rows[0]||null})})})})};
  },
  storage:{from(name){
   assert.equal(as,'service_role');assert.equal(name,bucket);
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
     assert.equal(paths.length,1);calls.push(['remove',...paths]);
     for(const key of paths){files.delete(key);await pg.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,key]);}
     return {error:null};
    },
   };
  }},
 });
 return {pg,role,client,files,calls,caption,onCopy:callback=>{onCopy=callback;}};
}

test('guarded copy, stale edit retry, atomic references, retained originals and explicit removal',async t=>{
 const h=await setup(t), write=h.client('authenticated',admin), system=h.client('service_role');
 const input={propertyId:first,source:oldUrl,filename:'room.jpg (3).jpg',version};
 const rename=(db=write,extra={})=>renamePropertyPhoto(db,system,origin,{...input,...extra},signal());
 const photos=async id=>(await h.pg.query('select * from public.properties where id=$1',[id])).rows[0];
 for(const actor of [editor,manager])await assert.rejects(rename(h.client('authenticated',actor)),/forbidden/);
 assert.equal(h.calls.length,0);
 const active=h.client('authenticated',owner);
 await h.pg.query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[owner]);
 await assert.rejects(rename(active),/forbidden/);
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
 await assert.rejects(h.role('authenticated',editor,()=>h.pg.query('update public.properties set images=$1 where id=$2',[[transformed],first])),/stale_reference/);
 assert.equal((await rename()).id,result.id,'a lost success response can be retried');
 await assert.rejects(h.role('authenticated',admin,()=>h.pg.query('select public.home_photo_rename_request_removal($1,false)',[result.id])),/confirm_required/);
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
