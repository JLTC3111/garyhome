import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPropertyPrice, propertyPrice, propertyPriceError, propertyPriceOffers } from '../lib/property-pricing.ts';
const rate = {usdToVnd:25000,updatedAt:new Date(Date.now()-3600000).toISOString(),nextUpdateAt:new Date(Date.now()+86400000).toISOString()};

test('price formatting preserves fixed, zero, unknown and bilingual range prices', () => {
  const property = { price: 1200.5, currency: 'USD' };
  assert.equal(formatPropertyPrice(property, 'en'), '$1,200.5');
  assert.equal(formatPropertyPrice({ ...property, price_max: 1800 }, 'en'), '$1,200.5–$1,800');
  assert.equal(formatPropertyPrice({ ...property, price_max: 1800 }, 'vi'), '$1.200,5–$1.800');
  assert.equal(formatPropertyPrice({ ...property, price_max: 1200.5 }, 'en'), '$1,200.5');
  assert.equal(formatPropertyPrice({ ...property, price: 0, price_max: 100 }, 'en'), '$0–$100');
  assert.equal(formatPropertyPrice({ ...property, price: null }, 'en'), null);
});

test('entered USD and VND quotes take precedence over conversion in both directions',()=>{
  const p={price:600,price_max:800,price_vnd:16000000,price_vnd_max:21000000,currency:'USD'};
  assert.equal(formatPropertyPrice(p,'en','USD',rate),'$600–$800');
  assert.equal(formatPropertyPrice(p,'vi','VND',rate),'16.000.000–21.000.000 ₫');
  assert.equal(propertyPrice(p,'VND',rate).approximate,false);
  assert.equal(formatPropertyPrice({...p,price_vnd:null,price_vnd_max:null},'en','VND',rate),'≈ 15,000,000–20,000,000 ₫');
  assert.equal(formatPropertyPrice({...p,price:null,price_max:null},'en','USD',rate),'≈ $640–$840');
});

test('missing or expired rates retain the entered currency without comparing unlike currencies',()=>{
  const p={price:null,price_vnd:15000000,currency:'USD'};
  assert.equal(formatPropertyPrice(p,'en','USD',null),'15,000,000 ₫');
  assert.equal(propertyPrice(p,'USD',null).fallback,true);
  assert.equal(propertyPrice(p,'USD',null,false),null);
  assert.equal(propertyPrice(p,'USD',{...rate,updatedAt:'2000-01-01T00:00:00Z'},false),null);
  assert.equal(propertyPrice({...p,price_vnd:null},'USD',rate),null);
  assert.equal(formatPropertyPrice({...p,price_vnd:0},'en','USD',rate),'≈ $0');
});

test('each currency validates independently and VND prices use whole đồng',()=>{
  assert.equal(propertyPriceError({price:null,price_vnd:15000000,price_vnd_max:20000000}),null);
  assert.match(propertyPriceError({price:600,price_vnd:null,price_vnd_max:20000000}),/Add a From/);
  assert.match(propertyPriceError({price:null,price_vnd:20000000,price_vnd_max:15000000}),/equal to or higher/);
  assert.match(propertyPriceError({price:null,price_vnd:123.45}),/whole đồng/);
  assert.match(propertyPriceError({price:null,price_vnd:1e15}),/too large/);
});

test('structured prices contain only entered quotes, including VND-only and dual-currency listings',()=>{
  const p={price:null,price_vnd:15000000,price_vnd_max:20000000,currency:'USD',price_period:'month'};
  const offer=propertyPriceOffers(p,'https://gary.example/home').offers;
  assert.equal(offer.priceCurrency,'VND');assert.equal(offer.priceSpecification.minPrice,15000000);assert.equal(offer.priceSpecification.maxPrice,20000000);assert.equal(offer.price,undefined);
  assert.deepEqual(propertyPriceOffers({...p,price:600},'url').offers.map(o=>o.priceCurrency),['USD','VND']);
  assert.deepEqual(propertyPriceOffers({...p,price_vnd:null,price_vnd_max:null},'url'),{});
});

test('price validation rejects reversed, upper-only, negative and nonfinite amounts', () => {
  for (const property of [{ price: null }, { price: 0 }, { price: 600, price_max: null }, { price: 600, price_max: 600 }, { price: 600, price_max: 800 }]) {
    assert.equal(propertyPriceError(property), null);
  }
  assert.match(propertyPriceError({ price: null, price_max: 800 }), /Add a From price/);
  assert.match(propertyPriceError({ price: 900, price_max: 800 }), /equal to or higher/);
  for (const value of [-1, NaN, Infinity]) {
    assert.match(propertyPriceError({ price: value }), /valid prices/);
    assert.match(propertyPriceError({ price: 600, price_max: value }), /valid prices/);
  }
});
