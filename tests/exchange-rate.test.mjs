import test from 'node:test';
import assert from 'node:assert/strict';
import { createExchangeRateLoader, parseExchangeRate, parseVietcombankRate } from '../lib/exchange-rate-server.ts';
import { convertBudget, MAX_RATE_AGE_MS } from '../lib/currency.ts';

const now=Date.now(),payload={result:'success',base_code:'USD',rates:{USD:1,VND:25000},time_last_update_unix:Math.floor(now/1000),time_next_update_unix:Math.floor(now/1000)+86400};
const json=value=>Response.json(value);
const bankXml=(time=now,sell='25,980.00')=>{
  const date=new Date(time+7*3600000),hour=date.getUTCHours(),pad=value=>String(value).padStart(2,'0');
  return `<!--For reference only. Only one request every 5 minutes!--><ExrateList><DateTime>${date.getUTCMonth()+1}/${date.getUTCDate()}/${date.getUTCFullYear()} ${hour%12||12}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} ${hour>=12?'PM':'AM'}</DateTime><Exrate CurrencyCode="EUR" Sell="30,000.00"/><Exrate CurrencyCode="USD" Buy="25,570.00" Transfer="25,600.00" Sell="${sell}"/></ExrateList>`;
};
const xml=value=>new Response(value,{headers:{'content-type':'text/xml; charset=utf-8'}});
test('rates require the correct base, sensible finite values and recent timestamps',()=>{
  assert.equal(parseExchangeRate(payload,now).usdToVnd,25000);
  for(const value of [null,{}, {...payload,result:'error'},{...payload,base_code:'VND'},{...payload,rates:{USD:1,VND:0}},{...payload,rates:{USD:1,VND:'25000'}},{...payload,rates:{USD:1,VND:Infinity}},{...payload,time_last_update_unix:now/1000+301},{...payload,time_last_update_unix:(now-MAX_RATE_AGE_MS-1000)/1000},{...payload,time_next_update_unix:0}])assert.equal(parseExchangeRate(value,now),null);
});
test('the bank feed parses USD selling prices with an explicit Vietnam timezone',()=>{
  const rate=parseVietcombankRate(bankXml(),now);assert.equal(rate.usdToVnd,25980);assert.equal(rate.provider,'vietcombank');assert.equal(rate.basis,'sell');assert.equal(Date.parse(rate.updatedAt),Math.floor(now/1000)*1000);
  for(const body of [bankXml(now,'25,98.00'),bankXml(now,'-1'),bankXml(now,'NaN'),bankXml(now+600000),bankXml(now-MAX_RATE_AGE_MS-1000),bankXml().replace('</ExrateList>','<Exrate CurrencyCode="USD" Sell="1"/></ExrateList>'),'<!DOCTYPE data SYSTEM "file:///etc/passwd">'+bankXml(),bankXml().replace('CurrencyCode="USD"','CurrencyCode="OTHER"'),bankXml().replace('<DateTime>','<Unexpected>')])assert.equal(parseVietcombankRate(body,now),null);
});
test('the server coalesces requests, uses the official bank endpoint and caches validated data',async()=>{
  const calls=[];const load=createExchangeRateLoader(async(url,options)=>{calls.push({url,options});return xml(bankXml());},()=>now);
  const values=await Promise.all([load(),load(),load()]);assert.equal(calls.length,1);assert.ok(values.every(value=>value.usdToVnd===25980));
  assert.equal(calls[0].url,'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.next.revalidate,300);
  await load();assert.equal(calls.length,1);
});
test('manual redirect rejection works on Cloudflare and fails over only to the fixed backup endpoint',async()=>{
  const calls=[];const load=createExchangeRateLoader(async(url,options)=>{
    if(options.redirect==='error')throw new TypeError('Cloudflare does not implement redirect:error');
    calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:'https://untrusted.example/'}}):json(payload);
  },()=>now);
  const rate=await load();assert.equal(rate.usdToVnd,25000);assert.equal(rate.provider,'exchange-rate-api');assert.deepEqual(calls,['https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx','https://open.er-api.com/v6/latest/USD']);
});
test('a temporary bank failure recovers after five minutes rather than remaining unavailable for an hour',async()=>{
  let time=now,healthy=false,calls=0;const load=createExchangeRateLoader(async()=>{calls++;if(!healthy)throw new Error('temporary outage');return xml(bankXml(time));},()=>time);
  assert.equal(await load(),null);assert.equal(calls,2);assert.match(load.diagnostics(),/temporary outage/);
  healthy=true;time+=299999;assert.equal(await load(),null);assert.equal(calls,2);
  time+=1;assert.equal((await load()).provider,'vietcombank');assert.equal(calls,3);assert.equal(load.diagnostics(),null);
});
test('outages retain the last valid rate for at most 72 hours and throttle retries',async()=>{
  let time=now,calls=0;const load=createExchangeRateLoader(async()=>{if(++calls===1)return xml(bankXml());throw new Error('offline');},()=>time);
  assert.equal((await load()).usdToVnd,25980);time+=25*3600000;assert.equal((await load()).usdToVnd,25980);await load();assert.equal(calls,3);
  time=now+MAX_RATE_AGE_MS+1000;assert.equal(await load(),null);
});
test('malformed, oversized, non-JSON and HTTP error responses cannot supply a rate',async()=>{
  for(const response of [json({...payload,result:'error'}),new Response('not JSON',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}),new Response('{}',{status:503,headers:{'content-type':'application/json'}})]){
    assert.equal(await createExchangeRateLoader(async()=>response.clone(),()=>now)(),null);
  }
});
test('a hung response body has a deadline and aborts the upstream request',async()=>{
  let signal;const load=createExchangeRateLoader(async(_url,options)=>{signal=options.signal;return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(new Error('aborted')));}}),{headers:{'content-type':'application/json'}});},()=>now,20);
  assert.equal(await load(),null);assert.equal(signal.aborted,true);
});
test('budget conversions round bounds outward and never reinterpret values without a rate',()=>{
  const rate=parseExchangeRate(payload,now);
  assert.equal(convertBudget('600','USD','VND',rate,'min'),'15000000');
  assert.equal(convertBudget('15000001','VND','USD',rate,'min'),'600');
  assert.equal(convertBudget('15000001','VND','USD',rate,'max'),'600.01');
  assert.equal(convertBudget('600','USD','VND',null,'min'),null);
});
