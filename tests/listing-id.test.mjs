import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeListingId, listingIdError, previewListingId } from '../lib/listing-id.ts';

test('listing IDs normalize short numbers, prefixes and pasted dash variants',()=>{
  for(const value of ['5','000005','gh-000005',' GH 5 ','GH–000005'])assert.equal(normalizeListingId(value),'GH-000005');
  assert.equal(normalizeListingId('000000000000'),'GH-000000');
  assert.equal(normalizeListingId('GH-1000000'),'GH-1000000');
  for(const value of ['GH-test','1234567890123','other-000005','-1','1.5'])assert.equal(normalizeListingId(value),null);
  assert.equal(listingIdError('',true),null);assert.match(listingIdError('',false),/Enter a listing ID/);
});
test('browser preview assigns a free code when manual IDs occupy earlier numbers',()=>{
  assert.equal(previewListingId([{listing_code:'GH-000001'},{listing_code:'GH-000003'}]),'GH-000002');
});
