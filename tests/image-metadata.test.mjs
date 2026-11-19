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
  {caption:'Photo 1 of 1',filename:'',alt:''});
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
  {caption:original,filename:original,alt:''});
});

test('URL-keyed metadata follows cover reordering and prunes removed photos and empty fields',()=>{
 const first='/images/first.jpg',other='data:image/jpeg;base64,AAAA',key=imageFilenameKey(other);
 const records={[first]:{description_en:' Living room ',alt_vi:''},[key]:{alt_vi:' Ban công ',public_filename:'Balcony.JPG'}};
 assert.deepEqual(pruneImageMetadata([other,first],records),{[key]:{alt_vi:'Ban công',public_filename:'Balcony.JPG'},[first]:{description_en:'Living room'}});
 assert.deepEqual(pruneImageMetadata([first],records),{[first]:{description_en:'Living room'}});
 assert.deepEqual(pruneImageMetadata([first]),{});
});

test('the migration preserves listing photos and reloads all five metadata values independently',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const room='/images/room.jpg', balcony='/images/balcony.jpg', images=[room,balcony], filenames={[room]:'Living room.JPG',[balcony]:'Balcony.JPG'};
 await db.exec("create table public.properties(id integer primary key, images text[] not null, image_filenames jsonb not null)");
 await db.query("insert into public.properties(id,images,image_filenames) values (1,$1,$2)",[images,filenames]);
 const sql=await readFile(new URL('../supabase/migrations/20261119040445_property_photo_metadata.sql',import.meta.url),'utf8');
 await db.exec(sql);
 assert.deepEqual((await db.query('select image_metadata from public.properties')).rows[0].image_metadata,{});
 const caption={
  [room]:{description_en:'Morning sun',description_vi:'Nắng sáng',alt_en:'Window and sofa',alt_vi:'Cửa sổ và ghế',public_filename:filenames[room]},
  [balcony]:{description_vi:'Ban công rộng'},
 };
 const update=metadata=>db.query('update public.properties set image_metadata=$1 where id=1 returning image_metadata',[metadata]);
 assert.deepEqual((await update(caption)).rows[0].image_metadata,caption);
 const reload=async()=>(await db.query('select * from public.properties where id=1')).rows[0];
 const saved=await reload();
 assert.deepEqual(saved,{id:1,images,image_filenames:filenames,image_metadata:caption});
 const edited=pruneImageMetadata(images,{...saved.image_metadata,[room]:{...saved.image_metadata[room],alt_vi:'Cửa sổ cạnh ghế',public_filename:''}});
 await update(edited);
 const reopened=await reload();
 assert.deepEqual(reopened.images,images);
 assert.deepEqual(reopened.image_filenames,filenames);
 assert.deepEqual(reopened.image_metadata,{[room]:{description_en:'Morning sun',description_vi:'Nắng sáng',alt_en:'Window and sofa',alt_vi:'Cửa sổ cạnh ghế'},[balcony]:caption[balcony]});
 for(const invalid of [[],{'/images/room.jpg':'plain text'},{'':{alt_en:'Room'}},{'/images/room.jpg':{unknown:'value'}},
  {'/images/room.jpg':{description_en:12}},{'/images/room.jpg':{alt_en:'a'.repeat(241)}},
  Object.fromEntries(Array.from({length:41},(_,i)=>[`image-${i}`,{description_en:'x'}]))]){
  await assert.rejects(update(invalid),error=>error.code==='23514');
 }
 assert.deepEqual((await reload()).image_metadata,reopened.image_metadata,'invalid saves preserve the last successful metadata');
});
