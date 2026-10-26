import test from 'node:test';
import assert from 'node:assert/strict';
import {readBrowserFavourites,claimBrowserFavourites,acknowledgeBrowserFavourites,releaseBrowserFavouriteClaim} from '../lib/favourites.ts';

function storage(values,fail=false){const rows=new Map(Object.entries(values));return {rows,getItem:key=>rows.get(key)||null,setItem(key,value){if(fail)throw new Error('Storage unavailable');rows.set(key,value);},removeItem:key=>rows.delete(key)};}
test('retired guest cart selections merge once into favourites without duplicates',()=>{
 const s=storage({'gary-saved':'["saved","shared"]','gary-rental-cart':'["shared","cart"]'});
 assert.deepEqual(readBrowserFavourites(s),['saved','shared','cart']);assert.equal(s.getItem('gary-rental-cart'),null);
 assert.deepEqual(readBrowserFavourites(s),['saved','shared','cart']);
});
test('a failed browser migration keeps the original cart for recovery',()=>{
 const s=storage({'gary-saved':'["saved"]','gary-rental-cart':'["cart"]'},true);
 assert.deepEqual(readBrowserFavourites(s),['saved','cart']);assert.equal(s.getItem('gary-rental-cart'),'["cart"]');
});
test('invalid browser favourites do not discard valid retired-cart selections',()=>{
 const s=storage({'gary-saved':'invalid JSON','gary-rental-cart':'[null,123,"valid","valid"]'});
 assert.deepEqual(readBrowserFavourites(s),['valid']);
});

test('a pending favourites transfer stays bound to its first account and acknowledgements preserve unrelated guest selections',()=>{
 const s=storage({'gary-saved':'["one","two","later"]'});assert.deepEqual(claimBrowserFavourites(s,'account-a',['one','two']),['one','two']);assert.deepEqual(claimBrowserFavourites(s,'account-b',['one','later']),['later']);acknowledgeBrowserFavourites(s,'account-a',['one']);assert.deepEqual(readBrowserFavourites(s),['two','later']);assert.deepEqual(claimBrowserFavourites(s,'account-b',['two']),[]);releaseBrowserFavouriteClaim(s,'two');assert.deepEqual(claimBrowserFavourites(s,'account-b',['two']),['two']);
});
test('failed claim persistence prevents an ambiguous cross-account transfer',()=>{const s=storage({'gary-saved':'["one"]'},true);assert.throws(()=>claimBrowserFavourites(s,'account-a',['one']));assert.deepEqual(readBrowserFavourites(s),['one']);});
