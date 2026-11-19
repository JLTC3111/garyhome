import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {galleryPhotoMetadata, publicPhotoFilename, pruneImageMetadata} from '../lib/image-metadata.ts';
import {imageFilenameKey} from '../lib/image-filenames.ts';

test('gallery captions use description, alt, a readable filename, then the localized count',()=>{
 const src='https://storage.example/public/listing/123e4567-e89b-12d3-a456-426614174000.jpg';
 const describe=entry=>galleryPhotoMetadata(src,{[src]:entry},'vi','Ảnh 1 trên 1');
 const original={public_filename:'Bright_living room.JPG'};
 assert.deepEqual(describe({...original,description_en:'Afternoon light',alt_vi:'Phòng khách'}),
  {caption:'Afternoon light',alt:'Phòng khách',filename:original.public_filename});
 assert.equal(describe({...original,description_en:'English',description_vi:'Nắng chiều'}).caption,'Nắng chiều');
 assert.equal(describe({...original,alt_en:'A wide-angle photo'}).caption,'A wide-angle photo');
 assert.equal(describe(original).caption,'Bright living room');
 assert.equal(describe({}).caption,'Ảnh 1 trên 1');
 assert.deepEqual(galleryPhotoMetadata('/images/apartments/riverside-balcony.jpg',undefined,'en','Photo 1 of 1'),
  {caption:'riverside balcony',filename:'',alt:''});
});

test('gallery refuses paths, identifiers and sensitive-looking names even in the approved field',()=>{
 for(const input of [
  '/private/documents/family.JPG','C:\\Users\\alex\\room.jpg','private%2Froom.jpg','https://example.test/photo.jpg',
  '123e4567-e89b-12d3-a456-426614174000.jpg','a654458a36f044f5834d73841bd89a22.webp','IMG_20261119040445.jpg',
  'owner@example.test.jpg','contact-090-123-4567.jpg','Hộ chiếu.JPG','Lease invoice.jpg','room.jpg?token=secret'
 ]){
  assert.equal(publicPhotoFilename(input),'',input);
 }
 const original='IMG_0142.JPG';
 assert.deepEqual(galleryPhotoMetadata('/not-a-listing-asset.jpg',{'/not-a-listing-asset.jpg':{public_filename:original}},'en','Photo 2 of 3'),
  {caption:'Photo 2 of 3',filename:original,alt:''});
});

test('URL-keyed metadata follows cover reordering and prunes removed photos and empty fields',()=>{
 const first='/images/first.jpg',other='data:image/jpeg;base64,AAAA',key=imageFilenameKey(other);
 const records={[first]:{description_en:' Living room ',alt_vi:''},[key]:{alt_vi:' Ban công ',public_filename:'Balcony.JPG'}};
 assert.deepEqual(pruneImageMetadata([other,first],records),{[key]:{alt_vi:'Ban công',public_filename:'Balcony.JPG'},[first]:{description_en:'Living room'}});
 assert.deepEqual(pruneImageMetadata([first],records),{[first]:{description_en:'Living room'}});
 assert.deepEqual(pruneImageMetadata([first]),{});
});

test('the prepared column preserves existing rows and constrains the per-photo JSON shape',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec("create table public.properties(id integer primary key, images text[] not null default '{}'); insert into public.properties(id) values (1)");
 const sql=await readFile(new URL('../supabase/migrations/20261119040445_property_photo_metadata.sql',import.meta.url),'utf8');
 await db.exec(sql);
 assert.deepEqual((await db.query('select image_metadata from public.properties')).rows[0].image_metadata,{});
 const caption={'/images/room.jpg':{description_vi:'Cửa sổ rộng',alt_en:'Window and sofa',public_filename:'Window.JPG'}};
 const update=metadata=>db.query('update public.properties set image_metadata=$1 where id=1 returning image_metadata',[metadata]);
 assert.deepEqual((await update(caption)).rows[0].image_metadata,caption);
 for(const invalid of [[],{'/images/room.jpg':'plain text'},{'':{alt_en:'Room'}},{'/images/room.jpg':{unknown:'value'}},
  {'/images/room.jpg':{description_en:12}},{'/images/room.jpg':{alt_en:'a'.repeat(241)}},
  Object.fromEntries(Array.from({length:41},(_,i)=>[`image-${i}`,{description_en:'x'}]))]){
  await assert.rejects(update(invalid),error=>error.code==='23514');
 }
});
