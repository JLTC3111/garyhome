import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProperties, readFilters } from '../lib/property-search.ts';
import { propertyTitle, listingCode, amenityLabel } from '../lib/rentals.ts';
const home={id:'one',title_en:'A home in Tay Ho',title_vi:'Căn hộ Tây Hồ',address:'Tô Ngọc Vân',district_slug:'tay-ho',property_type:'Apartment',amenities:['Balcony'],status:'published',availability:'on_request',listing_type:'rent',price:600,bedrooms:2,featured:false,sort_order:0,created_at:'2026-10-21'};
test('Vietnamese search works with and without diacritics',()=>{for(const q of ['tay ho','TÂY HỒ','to ngoc van'])assert.equal(filterProperties([home],{q}).length,1);});
test('combined filters apply together and exclude unpriced homes within a budget',()=>{const homes=[home,{...home,id:'two',price:null},{...home,id:'three',district_slug:'ba-dinh'}];assert.deepEqual(filterProperties(homes,{district:'tay-ho',max:'600',beds:'2',amenity:'Balcony'}).map(x=>x.id),['one']);});
test('draft, archived, rented, and sold listings stay out of search',()=>{const homes=[home,{...home,status:'draft'},{...home,status:'archived'},{...home,availability:'rented'},{...home,availability:'sold'}];assert.equal(filterProperties(homes,{}).length,1);});
test('unknown prices stay last in either price order',()=>{const homes=[home,{...home,id:'unknown',price:null},{...home,id:'low',price:200}];assert.deepEqual(filterProperties(homes,{sort:'price-low'}).map(x=>x.id),['low','one','unknown']);assert.deepEqual(filterProperties(homes,{sort:'price-high'}).map(x=>x.id),['one','low','unknown']);});
test('sale searches never include rentals and no-match searches return an empty result',()=>{assert.equal(filterProperties([home],{listing:'sale'}).length,0);assert.equal(filterProperties([home],{q:'nonexistent'}).length,0);});

test('retired duration parameters do not hide rentals in older bookmarks',()=>{
 const homes=['short','long','both','on_request'].map(term=>({...home,id:term,rental_term:term}));
 const filters=readFilters(new URLSearchParams('term=short&district=tay-ho'));
 assert.equal(filters.term,undefined);assert.equal(filterProperties(homes,filters).length,4);
});
test('IDs, bathroom count, price bounds, period and repeated amenities apply together',()=>{
 const p={...home,listing_code:'GH-000123',bathrooms:2,price_period:'night',price:60,amenities:['Balcony','Wi-Fi']};
 const filters=readFilters(new URLSearchParams('id=gh-000123&min=50&max=80&baths=2&period=night&amenity=Balcony&amenity=Wi-Fi'));
 assert.equal(filterProperties([p],filters).length,1);
 assert.equal(filterProperties([p],{...filters,period:'month'}).length,0);
 assert.equal(filterProperties([p],{...filters,amenity:'Balcony,Elevator'}).length,0);
 assert.equal(filterProperties([p],{id:'000123'}).length,1);
 assert.equal(filterProperties([p],{id:'one'}).length,1);
 assert.equal(filterProperties([p],{id:'123'}).length,0);
 assert.equal(filterProperties([p],{min:'61'}).length,0);
});
test('rental type groups preserve legacy studios and villas and never expose a published sale',()=>{
 const homes=[{...home,id:'studio',bedrooms:0,property_type:'Studio'},{...home,id:'villa',property_type:'House & Villa'},{...home,id:'vin',address:'Vinhomes Metropolis'},{...home,id:'sale',listing_type:'sale'}];
 assert.deepEqual(filterProperties(homes,{type:'Apartment',beds:'0'}).map(p=>p.id),['studio']);
 assert.deepEqual(filterProperties(homes,{type:'Villa/Duplex'}).map(p=>p.id),['villa']);
 assert.deepEqual(filterProperties(homes,{type:'Vinhomes'}).map(p=>p.id),['vin']);
 assert.equal(filterProperties(homes,{}).length,3);
});
test('generated titles use recorded facts and confirmed features without inventing area or commercial bedrooms',()=>{
 const p={...home,area_sqm:null,bathrooms:null,seo_features:['Lake view','Balcony']};
 assert.match(propertyTitle(p,'en','Tây Hồ'),/^2-bedroom apartment for rent in Tây Hồ · Balcony$/);
 assert.match(propertyTitle({...p,area_sqm:80},'vi','Tây Hồ'),/2 phòng ngủ.*80 m²/);
 assert.doesNotMatch(propertyTitle({...p,property_type:'Office & Restaurant',bedrooms:0},'en'),/studio|bedroom/);
 assert.doesNotMatch(propertyTitle({...p,property_type:'Studio',bedrooms:0},'en'),/studio studio/i);
 assert.equal(listingCode({id:'full-real-uuid'}),'full-real-uuid');
});
test('requirements match legacy amenity spellings without inventing facilities or weakening all-selected matching',()=>{
 const homes=[{...home,id:'matching',amenities:['Pet-friendly','Gym','BBQ','Outdoor Shower','Lakeview']},{...home,id:'partial',amenities:['Pet friendly','Gym']}];
 assert.deepEqual(filterProperties(homes,{amenity:'Pet,Gym,Barbecue,Outdoor shower,Lake view'}).map(p=>p.id),['matching']);
 assert.equal(filterProperties(homes,{amenity:'Sauna'}).length,0);
 assert.equal(amenityLabel('Barbeque','vi'),'BBQ / Khu nướng');assert.equal(amenityLabel('Outdoor Shower','vi'),'Vòi tắm ngoài trời');
});
