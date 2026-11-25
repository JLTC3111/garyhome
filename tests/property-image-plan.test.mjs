import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import sharp from 'sharp';
import {planInventory,stageInventory} from '../scripts/plan-property-image-optimization.mjs';

const inventory=(objects,references)=>({schemaVersion:1,bucket:'property-media',objects,references});
const object=(key, extra)=>({key,id:key,version:'version',etag:'etag',mime:'image/jpeg',bytes:640000,protected:false,...extra});

test('the default plan separates protected assets, unknown links and duplicate candidates',()=>{
  const plan=planInventory(inventory([object('first.jpg'),object('another.jpg'),object('unlinked.jpg'),
    object('held.jpg',{protected:true}),object('bad.png')],{'first.jpg':2,'another.jpg':1,'held.jpg':1,'bad.png':1,'missing.jpg':1}));
  assert.deepEqual(plan.entries.map(row=>row.state),['candidate','candidate','unreferenced','protected','review']);
  assert.deepEqual(plan.missingReferences,['missing.jpg']);
  assert.equal(plan.etagDuplicateHints.length,1);
  assert.equal(plan.modeledSavingsBytes,830000);
});

test('the queue starts with oversized PNGs, skips modern or small files, and holds shared galleries',()=>{
  const ids=[{id:'first',version:'1'},{id:'second',version:'2'}];
  const inputs=[object('bigger.jpg',{bytes:2000000}),object('later.png',{mime:'image/png',bytes:800000}),
    object('first.png',{mime:'image/png',bytes:1250000}),object('small.jpg',{bytes:230000}),
    object('already.webp',{mime:'image/webp',bytes:900000}),object('shared.jpg')];
  const data=inventory(inputs,Object.fromEntries(inputs.map(row=>[row.key,1])));
  data.galleryListings=Object.fromEntries(inputs.map(row=>[row.key,ids.slice(0,row.key==='shared.jpg'?2:1)]));
  const plan=planInventory(data);
  assert.deepEqual(plan.entries.map(row=>row.state),['candidate','candidate','candidate','skip','skip','review']);
  assert.deepEqual(plan.queue, [plan.entries[2].token,plan.entries[1].token,plan.entries[0].token]);
});

test('local staging verifies backups, changes untagged JPEG to WebP and resumes with the same key',async t=>{
  const work=await mkdtemp(join(tmpdir(),'gary-photo-plan-'));
  t.after(()=>rm(work,{recursive:true,force:true}));
  await mkdir(join(work,'backups'));
  const width=1920,height=1280,pixels=Buffer.alloc(width*height*3);
  for(let index=0;index<width*height;index++){
    const x=index%width,y=Math.floor(index/width),noise=(x*17+y*21+(x*y)%41)%36;
    pixels[index*3]=60+120*x/width+noise;
    pixels[index*3+1]=90+100*y/height+noise;
    pixels[index*3+2]=125+Math.round(40*Math.sin(x/71))+noise;
  }
  const bytes=await sharp(pixels,{raw:{width,height,channels:3}}).jpeg({quality:100}).toBuffer();
  const plan=planInventory(inventory([object('room.jpg',{bytes:bytes.length})],{'room.jpg':1}));
  const {token,etag,id,version}=plan.entries[0];
  const original=join(work,'backups',token+'.original');
  await writeFile(original,bytes);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(work,'backups',token+'.json'),JSON.stringify({id,version,etag,sha256}));
  const initial=await stageInventory(plan,work,1);
  assert.equal(initial.results[0].state,'staged');
  assert.ok(initial.results[0].outputBytes<=500000);
  assert.ok(initial.stagedSavingsBytes>0);
  assert.equal(initial.results[0].outputMime,'image/webp');
  assert.match(initial.results[0].replacementKey,/^properties\/[a-f0-9-]{36}\/room\.webp$/);
  assert.equal((await sharp(await readFile(join(work,'staged-v2',token+'.optimized'))).metadata()).format,'webp');
  assert.deepEqual(await stageInventory(plan,work,1),initial);
  assert.deepEqual(await readFile(original),bytes);
  await writeFile(join(work,'staged-v2',token+'.optimized'),'changed');
  await assert.rejects(stageInventory(plan,work,1),/Staged checksum mismatch/);
});

test('the read-only query inventories object metadata, protects rename keys and reports missing links',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(`create schema storage; create schema private;
    create table storage.buckets(id text,name text,versioning_status text);
    create table storage.objects(id text, bucket_id text, name text, version text, metadata jsonb, user_metadata jsonb,
      is_versioned boolean not null default false, is_delete_marker boolean not null default false, archived_at timestamptz);
    create table private.home_listing_media_refs(bucket text,name text);
    create table properties(id uuid,images text[],updated_at timestamptz);
    create function private.home_photo_key(uri text, origin text) returns text language sql immutable as
      $$select substring(uri from '/property-media/(.*)$')$$;
    create table private.property_photo_renames(old_key text,new_key text);
    create table private.home_listing_deletion_media(bucket text,name text);
    insert into storage.buckets values ('property-media','property-media','DISABLED');
    insert into storage.objects(id,bucket_id,name,version,metadata,user_metadata)
      values ('a','property-media','room.jpg','v1','{"size":640000,"mimetype":"image/jpeg","eTag":"etag"}','{"original_filename":"Lake View.jpg"}');
    insert into private.home_listing_media_refs values ('property-media','room.jpg'),('property-media','missing.jpg');
    insert into properties values ('10000000-0000-4000-8000-000000000001',
      array['https://duyiihsmaqfgwezmsnjs.supabase.co/storage/v1/object/public/property-media/room.jpg'],now());
    insert into private.property_photo_renames values ('old.jpg','room.jpg');`);
  const {rows:[row]}=await db.query(await readFile(new URL('../scripts/inventory-property-images.sql',import.meta.url),'utf8'));
  const plan=planInventory(row.inventory);
  assert.equal(plan.storageBytes,640000);
  assert.deepEqual(plan.missingReferences,['missing.jpg']);
  assert.equal(plan.entries[0].state,'protected');
  assert.equal(plan.entries[0].userMetadata.original_filename,'Lake View.jpg');
  assert.equal(plan.entries[0].listing.id,'10000000-0000-4000-8000-000000000001');
});
