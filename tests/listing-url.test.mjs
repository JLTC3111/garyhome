import test from 'node:test';
import assert from 'node:assert/strict';
import { generateListingSlug, isListingUrlAutomatic } from '../lib/listing-url.ts';

const property=(title_en='',title_vi='',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')=>({id,title_en,title_vi});
const valid=slug=>assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

test('new and never-published drafts get automatic links while existing public links stay stable',()=>{
 assert.equal(isListingUrlAutomatic(true),true);
 assert.equal(isListingUrlAutomatic(false),false);
 for(const published_at of [null,undefined])assert.equal(isListingUrlAutomatic(false,{status:'draft',published_at}),true);
 assert.equal(isListingUrlAutomatic(false,{status:'draft',published_at:'2026-11-05T00:00:00Z'}),false);
 for(const status of ['published','archived'])for(const published_at of [null,undefined,'2026-11-05T00:00:00Z'])assert.equal(isListingUrlAutomatic(false,{status,published_at}),false);
});

test('new listing links follow the complete final authored title, including its highlights',()=>{
 const draft=property('  3 Bedroom Apartment in Tây Hồ — PETS ALLOWED / LAKE VIEW!  ');
 assert.equal(generateListingSlug(draft),'3-bedroom-apartment-in-tay-ho-pets-allowed-lake-view');
 assert.equal(generateListingSlug({...draft,title_en:'Final title: 4 bedrooms & balcony'}),'final-title-4-bedrooms-balcony');
 assert.equal(draft.title_en,'  3 Bedroom Apartment in Tây Hồ — PETS ALLOWED / LAKE VIEW!  ','generation never edits the displayed title');
});

test('one canonical address prefers English and folds Vietnamese when English is not yet entered',()=>{
 const vi='Căn hộ đường Đặng Thai Mai — 160m², Tây Hồ';
 assert.equal(generateListingSlug(property('',vi)),'can-ho-duong-dang-thai-mai-160m2-tay-ho');
 assert.equal(generateListingSlug(property('   ',vi.normalize('NFD'))),'can-ho-duong-dang-thai-mai-160m2-tay-ho');
 assert.equal(generateListingSlug(property('English title',vi)),'english-title');
 assert.equal(generateListingSlug(property('Ａｐａｒｔｍｅｎｔ １２')),'apartment-12');
});

test('existing addresses reserve local uniqueness while the current listing is excluded',()=>{
 const current=property('Lake view'),rows=[{id:'other-1',slug:'lake-view'},{id:'other-2',slug:'lake-view-2'},{id:current.id,slug:'lake-view-3'},{id:'other-4',slug:'lake-view-4'}];
 assert.equal(generateListingSlug(current,rows),'lake-view-3');
 assert.equal(generateListingSlug(current,rows,['lake-view-3']),'lake-view-5');
 assert.equal(generateListingSlug(current,[{id:current.id,slug:'lake-view'}]),'lake-view');
 assert.equal(generateListingSlug(current,[{id:'other',slug:'lake-view'}]),'lake-view-2');
});

test('long titles and collision suffixes stay within the 180-character address limit',()=>{
 const current=property('A'.repeat(250)),base='a'.repeat(180);
 assert.equal(generateListingSlug(current),base);
 const two=generateListingSlug(current,[{id:'other',slug:base}]);assert.equal(two,'a'.repeat(178)+'-2');assert.equal(two.length,180);valid(two);
 const rows=Array.from({length:10},(_,index)=>{const suffix='-'+(index+1);return {id:String(index),slug:index===0?base:'a'.repeat(180-suffix.length)+suffix};});
 const eleven=generateListingSlug(current,rows);assert.equal(eleven,'a'.repeat(177)+'-11');assert.equal(eleven.length,180);valid(eleven);
 const boundary=generateListingSlug(property('a'.repeat(179)+' '+'Z'));assert.equal(boundary,'a'.repeat(179));valid(boundary);
});

test('blank titles stay blank while non-Latin and symbol-only titles get stable usable addresses',()=>{
 assert.equal(generateListingSlug(property('  ','\n')),'');
 for(const title of ['湖景公寓','✨🏠!!!']){
  const current=property(title),first=generateListingSlug(current);valid(first);assert.ok(first.startsWith('listing-'));assert.equal(generateListingSlug(current),first);
  assert.notEqual(generateListingSlug(property(title,'','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),first);
  assert.equal(generateListingSlug(current,[{id:'other',slug:first}]),first+'-2');
 }
 const nonLatinId=generateListingSlug(property('湖景公寓','','房屋'));valid(nonLatinId);assert.equal(generateListingSlug(property('湖景公寓','','房屋')),nonLatinId);
});
