import test from 'node:test';import assert from 'node:assert/strict';
import {filterProperties} from '../lib/property-search.ts';import {applyPropertyOrder} from '../lib/property-order.ts';import {canReorderProperties,isStaffRole,canManageStaff} from '../lib/staff.ts';
const p=(id,date,extra={})=>({id,created_at:date,title_en:id,title_vi:id,address:'Hanoi',district_slug:'tay-ho',property_type:'Apartment',amenities:[],images:[],status:'published',availability:'on_request',listing_type:'rent',price:600,bedrooms:1,featured:false,sort_order:0,...extra});
test('default catalogue ordering follows publication time rather than featured flags or legacy ranks',()=>{
 const rows=[p('older','2026-01-01',{featured:true,sort_order:-100}),p('new','2026-03-01'),p('published-later','2025-12-01',{published_at:'2026-04-01'})];assert.deepEqual(filterProperties(rows,{}).map(p=>p.id),['published-later','new','older']);
});
test('manual ordering is stable, ignores unavailable IDs and leaves unarranged posts newest first',()=>{
 const rows=[p('a','2026-01-01'),p('b','2026-02-01'),p('c','2026-03-01')];assert.deepEqual(applyPropertyOrder(rows,['missing','b']).map(p=>p.id),['b','c','a']);assert.deepEqual(applyPropertyOrder(rows,[]).map(p=>p.id),['c','b','a']);assert.deepEqual(rows.map(p=>p.id),['a','b','c']);
});
test('only owner, admin and manager assignments allow card ordering',()=>{
 for(const role of ['owner','admin','manager'])assert.equal(canReorderProperties(role),true);
 for(const role of ['editor','customer',undefined,null])assert.equal(canReorderProperties(role),false);
 assert.equal(isStaffRole('manager'),true);assert.equal(canManageStaff('manager'),true);
});
