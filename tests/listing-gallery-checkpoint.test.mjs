import test from 'node:test';
import assert from 'node:assert/strict';
import {canResumeGallery, confirmedListingWrite, getGalleryCheckpoints, listingGallery, matchesPlannedPhoto,
  pendingListingPhotos, removeGalleryCheckpoint, sameListingVersion, storeGalleryCheckpoint} from '../lib/listing-gallery-checkpoint.ts';
import {recoverGallery} from '../scripts/recover-listing-gallery.mjs';

const listingId='003be3a7-963d-4e2c-911d-90774a70fe44';
const created='2026-11-26T01:38:24.861Z';
const version='2026-11-26T01:55:11.193001Z';
const updated='2026-11-26T01:55:11.193002Z';
const photo={path:`properties/listings/${listingId}/revision/photo.webp`,url:'https://example.test/photo.webp',filename:'Original.webp',bytes:100,mime:'image/webp'};
const saved={id:listingId,listing_code:'GH-645',status:'draft',created_at:created,updated_at:version,title_en:'Existing title',images:[],image_filenames:{},image_metadata:{}};
const gallery={images:[photo.url],image_filenames:{[photo.url]:photo.filename},image_metadata:{[photo.url]:{alt_en:'Balcony'}}};
const checkpoint={key:'00000000-0000-4000-8000-000000000001',listingId,baseVersion:version,baseGallery:listingGallery(saved),gallery,pending:[photo],title:'Draft',savedAt:1};

test('the actor-specific checkpoint retains gallery order, metadata and unacknowledged uploads across reload',()=>{
  const items=new Map();
  const storage={get length(){return items.size;},key:i=>[...items.keys()][i],getItem:k=>items.get(k),setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)};
  storeGalleryCheckpoint(storage,'first',checkpoint);
  assert.deepEqual(getGalleryCheckpoints(storage,'second'),[]);
  const [restored]=getGalleryCheckpoints(storage,'first');
  assert.deepEqual(restored,checkpoint);
  assert.deepEqual(pendingListingPhotos(restored,listingGallery(saved)),[photo]);
  assert.deepEqual(pendingListingPhotos(restored,gallery),[]);
  const object={name:photo.path,bucketId:'property-media',size:100,contentType:'image/webp'};
  assert.equal(matchesPlannedPhoto(photo,object),true);
  assert.equal(matchesPlannedPhoto(photo,{...object,size:99}),false);
  assert.equal(matchesPlannedPhoto(photo,{...object,name:'somewhere-else.webp'}),false);
  removeGalleryCheckpoint(storage,'first',checkpoint.key);
  assert.deepEqual(getGalleryCheckpoints(storage,'first'),[]);
});

test('resuming across newer edits uses the latest listing and rejects a diverged saved gallery',()=>{
  assert.equal(canResumeGallery(checkpoint,null),false);
  assert.equal(canResumeGallery({...checkpoint,baseVersion:null},null),true);
  assert.equal(canResumeGallery(checkpoint,{...saved,updated_at:updated,title_en:'Concurrent title'}),true);
  assert.equal(canResumeGallery(checkpoint,{...saved,updated_at:updated,images:['newer.jpg']}),false);
  assert.equal(canResumeGallery(checkpoint,{...saved,updated_at:updated,...gallery}),true);
});

test('an uncertain save is confirmed only by the intended data and an advanced server version',()=>{
  const submitted={...saved,...gallery,updated_at:'2026-11-26T01:56:00.001Z'};
  assert.equal(sameListingVersion(version,updated),false);
  assert.equal(sameListingVersion(created,'2026-11-26 01:38:24.861+00'),true);
  const observed={...submitted,updated_at:updated,created_at:'2026-11-26 01:38:24.861+00'};
  assert.equal(confirmedListingWrite(submitted,observed,version),true);
  assert.equal(confirmedListingWrite(submitted,{...observed,updated_at:version},version),false);
  assert.equal(confirmedListingWrite(submitted,{...observed,images:[]},version),false);
  assert.equal(confirmedListingWrite(submitted,{...observed,title_en:'Another edit'},version),false);
});

test('GH-645 recovery verifies 14 object identities, preserves metadata and reads back a lost acknowledgement once',async()=>{
  const uploads=Array.from({length:14},(_,i)=>({path:`properties/listings/${listingId}/revision-${i}/name.webp`,
    object_id:`object-${i}`,version:`version-${i}`,etag:`etag-${i}`,mime:'image/webp',bytes:'100',original_filename:`Original ${i}.webp`,
    uploaded_at:new Date(Date.parse(created)+i*1000).toISOString(),same_creator:true,referenced:false}));
  const packet=[{listing_code:'GH-645',id:listingId,created_at:created,updated_at:version,uploads:[...uploads].reverse()}];
  let current=saved, reads=0,writes=0,backups=0;
  const info=async path=>{const photo=uploads.find(x=>x.path===path);return {name:path,bucketId:'property-media',id:photo.object_id,version:photo.version,
    etag:`"${photo.etag}"`,contentType:photo.mime,size:100};};
  const actions={packet,info,read:async()=>{reads++;return current;},backup:async row=>{assert.deepEqual(row,saved);backups++;},
    update:async(id,expected,changes)=>{
      writes++;assert.equal(id,listingId);assert.equal(expected,version);
      assert.deepEqual(Object.keys(changes).sort(),['image_filenames','images']);
      assert.ok(changes.images[0].includes('/revision-0/'));
      current={...current,...changes,updated_at:updated};
      throw new Error('Connection dropped after commit');
    }};
  assert.deepEqual(await recoverGallery(actions),{status:'verified',photos:14});
  assert.deepEqual(await recoverGallery({...actions,apply:true}),{status:'attached',photos:14});
  assert.deepEqual(await recoverGallery({...actions,apply:true}),{status:'already-attached',photos:14});
  assert.deepEqual([reads,writes,backups],[4,1,1]);
  await assert.rejects(recoverGallery({...actions,apply:true,info:async path=>({...await info(path),version:'replaced'})}),/identity changed/);
  current={...saved,updated_at:updated};
  await assert.rejects(recoverGallery({...actions,apply:true}),/draft or gallery changed/);
  assert.equal(writes,1);
});
