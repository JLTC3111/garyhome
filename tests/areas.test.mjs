import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {browseAreas,areaPage,areaPhotograph,areaEnquiry} from '../lib/areas.ts';

const data=JSON.parse(await readFile(new URL('../data/site-content.json',import.meta.url),'utf8'));
const properties=JSON.parse(await readFile(new URL('../data/properties.json',import.meta.url),'utf8'));
const photos=JSON.parse(await readFile(new URL('../data/neighbourhood-photos.json',import.meta.url),'utf8'));

test('all twelve area choices are reachable in groups of four, with real counts and a separate Vinhomes collection',()=>{
 const areas=browseAreas(data.neighbourhoods,properties);
 assert.equal(data.neighbourhoods.length,11);assert.equal(areas.length,12);assert.equal(new Set(areas.map(a=>a.slug)).size,12);
 assert.equal(areas[3].slug,'vinhomes');assert.equal(areas[3].href,'/vinhomes');assert.equal(areas[3].collection,true);assert.equal(areas[3].count,3);
 assert.equal(data.neighbourhoods.some(n=>n.slug==='vinhomes'),false);
 assert.deepEqual([0,1,2].flatMap(page=>areaPage(areas,page).cards.map(a=>a.slug)),areas.map(a=>a.slug));
 assert.equal(areaPage(areas,99).page,2);assert.equal(areaPage(areas,-1).page,0);assert.equal(areaPage([],4).pages,1);assert.deepEqual(areaPage([],4).cards,[]);
 const cau=areas.find(a=>a.slug==='cau-giay');assert.equal(cau.count,0);assert.equal(cau.href,'/contact?area=cau-giay');
 const sample={...properties[0],district_slug:'cau-giay'};
 const live=browseAreas(data.neighbourhoods,[{...sample,status:'draft'}, {...sample,status:'published',availability:'rented'}, {...sample,status:'published',listing_type:'sale'}, {...sample,status:'published',listing_type:'rent',availability:'available'}]).find(a=>a.slug==='cau-giay');
 assert.equal(live.count,1);assert.equal(live.href,'/homes?district=cau-giay');
 assert.deepEqual(browseAreas([...data.neighbourhoods].reverse(),properties).map(a=>a.slug),areas.map(a=>a.slug));
});

test('area enquiry context validates CMS areas and translates without accepting arbitrary query text',()=>{
 assert.equal(areaEnquiry('cau-giay',data.neighbourhoods,'en'),'Rental search in Cầu Giấy');
 assert.equal(areaEnquiry('ha-dong',data.neighbourhoods,'vi'),'Tìm nhà thuê tại Hà Đông');
 assert.equal(areaEnquiry('<script>',data.neighbourhoods,'en'),'');assert.equal(areaEnquiry(null,data.neighbourhoods,'vi'),'');
});

test('all new photographs have high-resolution originals, smaller previews and reusable source attribution',async()=>{
 assert.equal(photos.length,8);
 for(const photo of photos){
  assert.ok(Math.max(photo.width,photo.height)>=1920);assert.equal(photo.preview_width,960);assert.ok(photo.preview_bytes<photo.bytes);
  assert.match(photo.source_page,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);assert.ok(photo.author);assert.match(photo.license,/^CC BY/);assert.match(photo.license_url,/^https:\/\/creativecommons\.org\/licenses\//);
  for(const [key,size]of [['image',photo.bytes],['preview',photo.preview_bytes]]){const file=await readFile(new URL('../public'+photo[key],import.meta.url));assert.equal(file.length,size);assert.equal(file.subarray(0,3).toString('hex'),'ffd8ff');}
  const delivery=areaPhotograph(photo.image);assert.equal(delivery.src,photo.preview);assert.match(delivery.srcSet,/960w,/);assert.ok(delivery.srcSet.includes(photo.image));
 }
 assert.equal(areaPhotograph('https://uploads.example/area.jpg').src,'https://uploads.example/area.jpg');assert.equal(areaPhotograph('https://uploads.example/area.jpg').srcSet,undefined);
});

test('area migration can be reapplied and preserves previously edited CMS content',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('create table public.neighbourhoods(slug text primary key,name text not null,tagline_en text,tagline_vi text,description_en text,description_vi text,image text,sort_order integer);');
 const migration=await readFile(new URL('../supabase/migrations/20261026173334_expand_hanoi_neighbourhoods.sql',import.meta.url),'utf8');
 await db.query("insert into neighbourhoods(slug,name,image,sort_order)values('cau-giay','Existing CMS edit','https://uploads.example/custom.jpg',42)");
 await db.exec(migration);await db.exec(migration);
 const rows=(await db.query('select * from neighbourhoods order by slug')).rows;assert.equal(rows.length,7);
 const preserved=rows.find(r=>r.slug==='cau-giay');assert.equal(preserved.name,'Existing CMS edit');assert.equal(preserved.image,'https://uploads.example/custom.jpg');assert.equal(preserved.sort_order,42);
 for(const row of rows.filter(r=>r.slug!=='cau-giay'))assert.deepEqual(row,data.neighbourhoods.find(n=>n.slug===row.slug));
});
