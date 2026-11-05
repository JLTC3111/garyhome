import test from 'node:test';
import assert from 'node:assert/strict';
import {LISTING_VIDEO_MAX_BYTES, propertyVideoFileError, propertyVideoUrlError, validatePropertyVideoFile} from '../lib/property-video.ts';
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',url=`https://duyiihsmaqfgwezmsnjs.supabase.co/storage/v1/object/public/listing-videos/${uid}/${uid}/${uid}.mp4`;
const mp4=brand=>{const bytes=new Uint8Array(24);new DataView(bytes.buffer).setUint32(0,24);bytes.set(new TextEncoder().encode('ftyp'+brand),4);bytes.set(new TextEncoder().encode(brand),16);return bytes;};
test('only one uploaded video URL is accepted and ordinary external videos cannot bypass upload limits',()=>{
 for(const value of [null,undefined,'',url])assert.equal(propertyVideoUrlError(value),null);
 for(const value of [[url,url],'https://example.com/tour.mp4',url+'?download=true',url+'#video',url.replace('https:','http:'),url.replace('.mp4','.webm'),url.replace('duyiihsmaqfgwezmsnjs.supabase.co','user:pass@duyiihsmaqfgwezmsnjs.supabase.co'),url.replace('duyiihsmaqfgwezmsnjs.supabase.co','attacker.example.com')])assert.ok(propertyVideoUrlError(value));
});
test('video files must be nonempty MP4s strictly below decimal 50 MB',()=>{
 assert.equal(LISTING_VIDEO_MAX_BYTES,50_000_000);
 const file={name:'Tour.MP4',type:'video/mp4',size:49_999_999};assert.equal(propertyVideoFileError(file),null);
 for(const size of [0,50_000_000,50_000_001])assert.ok(propertyVideoFileError({...file,size}));
 for(const [name,type] of [['video.mov','video/quicktime'],['video.webm','video/webm'],['video.mp4','image/png']])assert.ok(propertyVideoFileError({...file,name,type}));
});
test('an MP4 filename alone is insufficient; ISO MP4 brands are checked before uploading',async()=>{
 for(const brand of ['isom','mp42','avc1','M4V '])assert.equal(await validatePropertyVideoFile(new File([mp4(brand)],'tour.mp4',{type:'video/mp4'})),null);
 for(const body of ['not a video',mp4('qt  ')])assert.match(await validatePropertyVideoFile(new File([body],'tour.mp4',{type:'video/mp4'})),/not a valid MP4/);
});
