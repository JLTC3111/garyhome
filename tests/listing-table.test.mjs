import test from 'node:test';
import assert from 'node:assert/strict';
import { filterStudioListings, listingPriceBound } from '../lib/listing-table.ts';

const now = new Date();
const rate = { usdToVnd: 25000, updatedAt: now.toISOString(), nextUpdateAt: new Date(now.getTime() + 86400000).toISOString() };
const row = (id, price, status, priceVnd = null) => ({
  id, status, price, price_vnd: priceVnd, price_max: null, price_vnd_max: null,
  currency: price == null && priceVnd != null ? 'VND' : 'USD',
});
const text = property => property.id;
const base = { query: '', status: '', priceSort: '', currency: 'USD', exchangeRate: rate, text };

test('studio listings keep their order until a price sort or status filter is chosen', () => {
  const rows = [row('b', 900, 'draft'), row('a', 200, 'published'), row('c', null, 'archived')];
  assert.deepEqual(filterStudioListings(rows, { ...base, text }).map(property => property.id), ['b', 'a', 'c']);
  assert.deepEqual(filterStudioListings(rows, { ...base, query: 'a', status: 'published' }).map(property => property.id), ['a']);
});

test('price sort compares monthly amounts in the selected currency and leaves other rows after them', () => {
  const rows = [
    row('high', 900, 'published'),
    row('ask', null, 'published'),
    row('low', 200, 'draft'),
    row('mid', null, 'archived', 10000000),
    { ...row('night', 40, 'published'), price_period: 'night' },
    { ...row('week', 80, 'draft'), price_period: 'week' },
  ];
  assert.deepEqual(filterStudioListings(rows, { ...base, priceSort: 'low' }).map(property => property.id), ['low', 'mid', 'high', 'night', 'week', 'ask']);
  assert.deepEqual(filterStudioListings(rows, { ...base, priceSort: 'high' }).map(property => property.id), ['high', 'mid', 'low', 'week', 'night', 'ask']);
  assert.deepEqual(filterStudioListings(rows, { ...base, status: 'published', priceSort: 'low' }).map(property => property.id), ['high', 'night', 'ask']);
});

test('monthly min and max use stored currency and do not treat other periods as monthly', () => {
  const ranged = { ...row('range', 400, 'published'), price_max: 800 };
  const rows = [ranged, row('low', 200, 'draft'), row('high', 900, 'published'), { ...row('night', 450, 'published'), price_period: 'night' }];
  assert.deepEqual(filterStudioListings(rows, { ...base, priceMin: '300', priceMax: '700' }).map(property => property.id), ['range']);
  assert.deepEqual(filterStudioListings(rows, { ...base, priceMin: '800', priceMax: '100' }).map(property => property.id), []);
  assert.equal(listingPriceBound(''), null);
  assert.equal(listingPriceBound('-1'), null);
  assert.deepEqual(filterStudioListings(rows, { ...base, priceMin: 'abc' }).map(property => property.id), rows.map(property => property.id));
});

test('a VND filter uses stored đồng and converts USD with the exchange rate', () => {
  const rows = [row('usd', 500, 'published'), row('vnd', null, 'published', 20000000)];
  assert.deepEqual(filterStudioListings(rows, { ...base, currency: 'VND', priceSort: 'low' }).map(property => property.id), ['usd', 'vnd']);
  assert.deepEqual(filterStudioListings(rows, { ...base, currency: 'VND', priceMin: '15000000' }).map(property => property.id), ['vnd']);
});

test('equal prices keep the original order', () => {
  const rows = [row('first', 500, 'published'), row('second', 500, 'draft')];
  assert.deepEqual(filterStudioListings(rows, { ...base, priceSort: 'low' }).map(property => property.id), ['first', 'second']);
  assert.deepEqual(filterStudioListings(rows, { ...base, priceSort: 'high' }).map(property => property.id), ['first', 'second']);
});
