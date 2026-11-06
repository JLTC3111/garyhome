import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('filename metadata accepts complete basenames and preserves older image updates while rejecting malformed records',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;
 create table public.properties(id integer primary key,images text[] not null default '{}');
 grant usage on schema private,public to authenticated,service_role;grant select,insert,update on public.properties to authenticated,service_role;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261106061652_property_image_filenames.sql',import.meta.url),'utf8'));
 await db.exec("insert into public.properties(id,images)values(1,array['/first.jpg']);set role authenticated");
 const url='https://media.example/properties/id.jpg',original='3-bedroom-apartment-tay-ho-*-*-*.JPEG';
 assert.deepEqual((await db.query('update public.properties set image_filenames=$1 where id=1 returning image_filenames',[{[url]:original}])).rows[0].image_filenames,{[url]:original});
 await db.exec("update public.properties set images=array['/different.jpg'] where id=1");
 assert.equal((await db.query('select image_filenames from public.properties where id=1')).rows[0].image_filenames[url],original);
 for(const metadata of [null,[],{[url]:123},{[url]:''},{[url]:'../photo.jpg'},{[url]:'C:\\fakepath\\photo.jpg'},{[url]:'a\n.jpg'},{[url]:'a'.repeat(513)},Object.fromEntries(Array.from({length:41},(_,i)=>['url'+i,'photo.jpg']))]){
  await assert.rejects(db.query('update public.properties set image_filenames=$1 where id=1',[metadata]),error=>['23514','23502'].includes(error.code));
 }
 await db.query('update public.properties set image_filenames=$1 where id=1',[{['inline:'+'a'.repeat(32)]:'Ảnh đầy đủ.JPEG'}]);
 await db.exec('reset role;set role service_role');
 await db.exec("update public.properties set image_filenames='{}' where id=1");
 assert.deepEqual((await db.query('select image_filenames from public.properties where id=1')).rows[0].image_filenames,{});
});
