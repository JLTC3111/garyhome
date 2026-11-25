import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import {avatarPhoto,imageDetails,optimizeImage,propertyPhoto} from '../lib/image-optimization.mjs';

// Exercise the actual encoded and decoded pixels in Node without launching a browser.
function rasterEnvironment({webp=true, damage=false}={}) {
  let released = 0;
  return {
    Blob,
    get released(){return released;},
    async createImageBitmap(blob) {
      const {data,info}=await sharp(Buffer.from(await blob.arrayBuffer())).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
      return {pixels:data,width:info.width,height:info.height,close(){released++;}};
    },
    document:{createElement(){
      let pixels;
      const canvas={
        getContext:()=>({
          clearRect(){},
          drawImage(image,x,y,width,height){
            pixels=Buffer.alloc(width*height*4);
            for(let row=0;row<height;row++) for(let column=0;column<width;column++){
              const source=4*(Math.floor((row+.5)*image.height/height)*image.width+Math.floor((column+.5)*image.width/width));
              image.pixels.copy(pixels,4*(row*width+column),source,source+4);
            }
          },
          getImageData:()=>({data:pixels}),
        }),
        async toBlob(resolve,type,quality){
          if(type==='image/webp'&&!webp)type='image/png';
          const width=canvas.width,height=canvas.height;
          const buffer=damage?Buffer.alloc(pixels.length,255):pixels;
          const output=await sharp(buffer,{raw:{width,height,channels:4}}).toFormat(type.split('/')[1],{quality:Math.round(quality*100)}).toBuffer();
          resolve(new Blob([output],{type}));
        },
      };
      return canvas;
    }},
  };
}

async function photo({width=2560,height=1440,alpha=false,metadata}={}) {
  const channels=alpha?4:3, pixels=Buffer.alloc(width*height*channels);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++){
    const i=channels*(y*width+x), noise=(x*17+y*21+(x*y)%41)%36;
    pixels[i]=60+100*x/width+noise;
    pixels[i+1]=90+100*y/height+noise;
    pixels[i+2]=125+Math.round(40*Math.sin(x/71))+noise;
    if(channels===4) pixels[i+3]=x>width/2?255:0;
  }
  let input=sharp(pixels,{raw:{width,height,channels}});
  if(metadata)input=metadata(input);
  const bytes=await (alpha?input.png():input.jpeg({quality:100})).toBuffer();
  return new File([bytes],alpha?'Living room.png':'Living room.jpg',{type:'application/octet-stream'});
}

test('large property photos are delivered as WebP with verified dimensions and under the cap',async()=>{
  const file=await photo(), win=rasterEnvironment();
  assert.ok(file.size>500_000);
  const result=await optimizeImage(file,propertyPhoto,{win});
  assert.equal(result.contentType,'image/webp');
  assert.equal(result.extension,'webp');
  assert.ok(result.width>=1280&&result.width<=1920);
  assert.equal(result.width/result.height,16/9);
  assert.ok(result.body.size>0&&result.body.size<=propertyPhoto.targetBytes);
  assert.ok(win.released>=2);
});

test('small sources retain their actual MIME, bytes, and dimensions',async()=>{
  const file=await photo({width:64,height:56});
  const result=await optimizeImage(file,propertyPhoto,{win:rasterEnvironment()});
  assert.equal(result.contentType,'image/jpeg');
  assert.equal(result.width,64);
  assert.deepEqual(await result.body.arrayBuffer(),await file.arrayBuffer());
});

test('JPEG compression carries EXIF descriptions and writes the new orientation and geometry',async()=>{
  const original=await photo({metadata:image=>image.withExif({IFD0:{ImageDescription:'Lake view'}})});
  const bytes=Buffer.from(await original.arrayBuffer());
  const tiff=bytes.indexOf('Exif\0\0')+6;
  const little=bytes.toString('ascii',tiff,tiff+2)==='II';
  const short=little?'readUInt16LE':'readUInt16BE', long=little?'readUInt32LE':'readUInt32BE';
  const directory=tiff+bytes[long](tiff+4), count=bytes[short](directory);
  const orientation=Array.from({length:count},(_,i)=>directory+2+i*12).find(i=>bytes[short](i)===0x112);
  assert.ok(orientation);
  bytes[little?'writeUInt16LE':'writeUInt16BE'](6,orientation+8);
  const file=new File([bytes],original.name);
  const result=await optimizeImage(file,propertyPhoto,{win:rasterEnvironment()});
  assert.equal(result.contentType,'image/jpeg');
  assert.ok(result.height>=1280&&result.height<=1920);
  assert.equal(result.height/result.width,16/9);
  const metadata=await sharp(Buffer.from(await result.body.arrayBuffer())).metadata();
  assert.match(metadata.exif.toString(),/Lake view/);
  assert.equal(metadata.orientation,1);
  assert.equal(metadata.width,result.width);
  assert.ok(result.body.size<=500_000);
});

test('an over-budget image with a color profile is held for review',async()=>{
  const file=await photo({metadata:image=>image.withIccProfile('p3')});
  assert.ok(file.size>propertyPhoto.maxBytes);
  await assert.rejects(optimizeImage(file,propertyPhoto,{win:rasterEnvironment()}),{code:'IMAGE_METADATA'});
});

test('a protected image under the byte cap cannot bypass the 1920px limit',async()=>{
  const bytes=await sharp({create:{width:2200,height:900,channels:3,background:'#745c46'}}).withIccProfile('p3').jpeg().toBuffer();
  const file=new File([bytes],'oversize.jpg',{type:'image/jpeg'});
  assert.ok(file.size<propertyPhoto.targetBytes);
  await assert.rejects(optimizeImage(file,propertyPhoto,{win:rasterEnvironment()}),{code:'IMAGE_METADATA'});
});

test('JPEG fallback and avatar resize use the applicable cap without upscaling',async()=>{
  const file=await photo({width:800,height:600});
  const result=await optimizeImage(file,avatarPhoto,{win:rasterEnvironment({webp:false})});
  assert.equal(result.contentType,'image/jpeg');
  assert.deepEqual([result.width,result.height],[384,288]);
  assert.ok(result.body.size<=avatarPhoto.maxBytes);
});

test('a PNG with transparency and physical density converts to WebP and retains both',async()=>{
  const file=await photo({width:850,height:440,alpha:true});
  const density=imageDetails(new Uint8Array(await file.arrayBuffer())).density;
  assert.ok(density.metres);
  const result=await optimizeImage(file,avatarPhoto,{win:rasterEnvironment()});
  assert.equal(result.contentType,'image/webp');
  const out=Buffer.from(await result.body.arrayBuffer());
  const pixels=await sharp(out).ensureAlpha().raw().toBuffer();
  assert.equal(pixels[3],0);
  const exif=out.indexOf('EXIF')+8;
  assert.equal(out.toString('ascii',exif,exif+2),'II');
  assert.equal(out.readUInt32LE(exif+50),density.x);
  assert.equal(out.readUInt32LE(exif+54),100);
  assert.equal(out.readUInt32LE(exif+58),density.y);
});

test('unsupported or visibly damaged encodes are rejected',async()=>{
  await assert.rejects(optimizeImage(new File(['<svg/>'],'bad.jpg'),propertyPhoto),{code:'IMAGE_TYPE'});
  await assert.rejects(optimizeImage(await photo(),propertyPhoto,{win:rasterEnvironment({damage:true})}),{code:'IMAGE_QUALITY'});
});

test('aborted uploads skip reading input bytes',async()=>{
  const controller=new AbortController();
  controller.abort();
  await assert.rejects(optimizeImage({size:999,arrayBuffer(){assert.fail('unexpected input read');}},propertyPhoto,{signal:controller.signal}),{name:'AbortError'});
});
