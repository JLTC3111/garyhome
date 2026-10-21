import test from 'node:test';
import assert from 'node:assert/strict';
import { filterProperties } from '../lib/property-search.ts';
const home={id:'one',title_en:'A home in Tay Ho',title_vi:'Căn hộ Tây Hồ',address:'Tô Ngọc Vân',district_slug:'tay-ho',property_type:'Apartment',amenities:['Balcony'],status:'published',availability:'on_request',listing_type:'rent',price:600,bedrooms:2,featured:false,sort_order:0,created_at:'2026-10-21'};
test('Vietnamese search works with and without diacritics',()=>{for(const q of ['tay ho','TÂY HỒ','to ngoc van'])assert.equal(filterProperties([home],{q}).length,1);});
test('combined filters apply together and exclude unpriced homes within a budget',()=>{const homes=[home,{...home,id:'two',price:null},{...home,id:'three',district_slug:'ba-dinh'}];assert.deepEqual(filterProperties(homes,{district:'tay-ho',max:'600',beds:'2',amenity:'Balcony'}).map(x=>x.id),['one']);});
test('draft, archived, rented, and sold listings stay out of search',()=>{const homes=[home,{...home,status:'draft'},{...home,status:'archived'},{...home,availability:'rented'},{...home,availability:'sold'}];assert.equal(filterProperties(homes,{}).length,1);});
test('unknown prices stay last in either price order',()=>{const homes=[home,{...home,id:'unknown',price:null},{...home,id:'low',price:200}];assert.deepEqual(filterProperties(homes,{sort:'price-low'}).map(x=>x.id),['low','one','unknown']);assert.deepEqual(filterProperties(homes,{sort:'price-high'}).map(x=>x.id),['one','low','unknown']);});
test('sale searches never include rentals and no-match searches return an empty result',()=>{assert.equal(filterProperties([home],{listing:'sale'}).length,0);assert.equal(filterProperties([home],{q:'nonexistent'}).length,0);});
