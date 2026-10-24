import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {assetPath,contentAssets} from '../lib/content-assets.ts';
import {channelUrl} from '../lib/rentals.ts';
const root=path.resolve(import.meta.dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name+'.json'),'utf8'));
test('every referenced local media asset and moved destination exists',()=>{
 const files=new Set();function collect(value){if(typeof value==='string'&&/^\/(images|svg)\//.test(value))files.add(value);else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect);}
 for(const name of ['properties','site-content','activities','authors'])collect(read(name));Object.values(read('asset-paths')).forEach(collect);
 files.add('/svg/WhatsApp.svg');files.add('/svg/Zalo.svg');assert.ok(files.size>65);
 for(const file of files)assert.ok(fs.existsSync(path.join(root,'public',file)),file);
 assert.equal(assetPath('/images/hero.jpg'),'/images/apartments/hero.jpg');assert.equal(assetPath('/images/activities/feedback-1.jpg'),'/images/activities/activity-1.jpg');
 assert.equal(assetPath('https://media.example/photo.jpg'),'https://media.example/photo.jpg');
});
test('legacy CMS paths normalize without changing content identity or external uploads',()=>{
 const content={properties:[{id:'unchanged',images:['/images/hero.jpg','https://media.example/p.jpg']}],neighbourhoods:[{slug:'tay-ho',image:'/images/area-tay-ho.jpg'}],settings:{hero_image:'/images/hero.jpg'},activities:[{id:'photo',image_url:'/images/activities/feedback-2.jpg'}]};
 const next=contentAssets(content);assert.equal(next.properties[0].id,'unchanged');assert.deepEqual(next.properties[0].images,['/images/apartments/hero.jpg','https://media.example/p.jpg']);assert.equal(content.properties[0].images[0],'/images/hero.jpg');assert.equal(next.activities[0].image_url,'/images/activities/activity-2.jpg');
});
test('provided photos and review screenshots remain in separate activity categories',()=>{
 const rows=read('activities');assert.equal(rows.filter(a=>a.category==='customers'&&a.media_kind==='photo').length,16);assert.equal(rows.filter(a=>a.category==='feedback'&&a.media_kind==='screenshot').length,1);assert.ok(rows.find(a=>a.image_url==='/images/feedback/1.jpg'));
 const team=rows.filter(a=>a.category==='team');assert.equal(team.length,1);assert.equal(team[0].image_url,'/images/ourteam/gary-home-team.png');assert.equal(team[0].published,true);
});
test('Vietnamese local and international numbers open the same messaging contact',()=>{
 for(const number of ['0363327342','+84 363 327 342']){assert.equal(channelUrl('whatsapp',number),'https://wa.me/84363327342');assert.equal(channelUrl('zalo',number),'https://zalo.me/0363327342');}
 assert.match(channelUrl('whatsapp','0363327342','GH-000001 & viewing'),/text=GH-000001%20%26%20viewing/);assert.equal(channelUrl('whatsapp','not a phone'),'');
 const settings=read('site-content').settings,author=read('authors').find(a=>a.slug==='gary-home-team');assert.equal(settings.whatsapp_phone,'+84363327342');assert.equal(settings.zalo_phone,'0363327342');assert.equal(author.whatsapp_phone,settings.whatsapp_phone);assert.equal(author.zalo_phone,settings.zalo_phone);
});
