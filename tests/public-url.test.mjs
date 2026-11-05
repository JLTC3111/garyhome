import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicUrl, publicUrlFor } from '../lib/public-url.ts';

const origin='https://garyhome.vn';
test('full public URLs map to the existing routes and stored keys',()=>{
 for(const [kind,key,url] of [
  ['property','apartment-in-tay-ho',origin+'/homes/apartment-in-tay-ho'],
  ['article','renting-in-hanoi',origin+'/tips-and-news/renting-in-hanoi'],
  ['neighbourhood','tay-ho',origin+'/homes?district=tay-ho'],
 ]){
  assert.equal(publicUrlFor(key,origin,kind),url);
  assert.deepEqual(parsePublicUrl(url,origin,kind),{key,issue:null});
 }
 assert.deepEqual(parsePublicUrl(origin+'/homes/a-home/',origin),{key:'a-home',issue:null});
 assert.equal(publicUrlFor('https://unfinished',origin),'https://unfinished');
});
test('URL input rejects unsupported hosts, protocols, routes and address names with specific reasons',()=>{
 for(const [value,issue] of [
  ['','required'],['a-home','format'],['http://garyhome.vn/homes/a-home','format'],
  ['https://garyhome.vn.evil.example/homes/a-home','origin'],['https://other.example/homes/a-home','origin'],
  [origin+'/tips-and-news/a-home','route'],[origin+'/homes/a-home?x=1','route'],[origin+'/homes/a-home#view','route'],
  [origin+'/homes/Apartment','address'],[origin+'/homes/căn-hộ','address'],[origin+'/homes/a--home','address'],
  [origin+'/homes/a/home','address'],[origin+'/homes/','address'],[origin+'/homes/'+'a'.repeat(181),'address'],
 ])assert.equal(parsePublicUrl(value,origin).issue,issue,value);
 assert.equal(parsePublicUrl(origin+'/homes?district=tay-ho&district=ba-dinh',origin,'neighbourhood').issue,'route');
});
