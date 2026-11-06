import test from 'node:test';
import assert from 'node:assert/strict';
import {imageOriginalFilename, imageFilenameKey, imageFilename, imageFilenameDetails, addImageFilename, pruneImageFilenames} from '../lib/image-filenames.ts';

const first='https://media.example/properties/first.jpg',second='https://media.example/properties/second.jpg';

test('original image names preserve special characters, complete names and extension while excluding local paths',()=>{
 for(const name of ['3-bedroom-apartment-tay-ho-*-*-*.jpg','Căn hộ Tây Hồ – 3 phòng (Ảnh 1).JPEG','image #1 & balcony+.png']){
  assert.equal(imageOriginalFilename(name),name);
  assert.equal(imageFilename(first,addImageFilename(undefined,first,name)),name);
 }
 assert.equal(imageOriginalFilename('C:\\fakepath\\photo.jpg'),'photo.jpg');
 assert.equal(imageOriginalFilename('/Users/name/private/photo.jpg'),'photo.jpg');
 assert.equal(imageOriginalFilename('photo\u0000\n\u0085.jpg'),'photo.jpg');
 assert.equal(imageOriginalFilename(undefined),'');
 assert.throws(()=>imageOriginalFilename('a'.repeat(513)+'.jpg'),/512 characters/);
});

test('existing, external and signed image URLs show their decoded stored basename without query strings',()=>{
 assert.equal(imageFilename(first),'first.jpg');
 assert.equal(imageFilename('/images/apartments/3-bedroom-apartment-tay-ho.jpg'),'3-bedroom-apartment-tay-ho.jpg');
 assert.equal(imageFilename('https://media.example/C%C4%83n%20h%E1%BB%99%20%231.JPEG?token=private#ignored'),'Căn hộ #1.JPEG');
 assert.equal(imageFilename('https://media.example/broken%escape.jpg'),'broken%escape.jpg');
 assert.equal(imageFilename('data:image/jpeg;base64,AAAA'),'');assert.equal(imageFilename('blob:https://media.example/id'),'');
 assert.equal(imageFilename('https://media.example/'),'');
});

test('cover changes retain URL-linked names, removal prunes stale metadata, and repeated basenames remain distinct uploads',()=>{
 let names=addImageFilename(undefined,first,'Living room.JPG');names=addImageFilename(names,second,'Living room.JPG');
 assert.equal(imageFilename(second,pruneImageFilenames([second,first],names)),'Living room.JPG');
 assert.deepEqual(pruneImageFilenames([second],names),{[second]:'Living room.JPG'});
 assert.deepEqual(pruneImageFilenames([],names),{});assert.deepEqual(pruneImageFilenames([first]),{});
 assert.equal(Object.keys(names).length,2);assert.equal(imageFilename(first,{[first]:'a'.repeat(513)}),'first.jpg');
});

test('inline browser previews persist compact filename keys instead of duplicating their image data',()=>{
 const one='data:image/jpeg;base64,'+'A'.repeat(100000),two=one.slice(0,-1)+'B';
 const key=imageFilenameKey(one);assert.match(key,/^inline:[a-f0-9]{32}$/);assert.equal(key,imageFilenameKey(one));assert.notEqual(key,imageFilenameKey(two));
 const names=addImageFilename(undefined,one,'Preview image.jpg');assert.equal(imageFilename(one,names),'Preview image.jpg');
 assert.ok(JSON.stringify(names).length<100);assert.deepEqual(pruneImageFilenames([one],JSON.parse(JSON.stringify(names))),names);
});

test('filename provenance distinguishes recorded originals, complete stored filenames and unavailable names',()=>{
 assert.deepEqual(imageFilenameDetails(first,{[first]:'Original complete name.JPG'}),{filename:'Original complete name.JPG',source:'original'});
 assert.deepEqual(imageFilenameDetails(first),{filename:'first.jpg',source:'stored'});
 assert.deepEqual(imageFilenameDetails('data:image/jpeg;base64,AAAA'),{filename:'',source:'unavailable'});
 assert.deepEqual(imageFilenameDetails(first,{[first]:'a'.repeat(513)}),{filename:'first.jpg',source:'stored'});
});
