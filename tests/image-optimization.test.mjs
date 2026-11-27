import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import sharp from 'sharp';
import {avatarPhoto,imageDetails,optimizeImage,propertyPhoto} from '../lib/image-optimization.mjs';

// Exercise the actual encoded and decoded pixels in Node without launching a browser.
function rasterEnvironment({webp=true, damage=false, onEncode, onDraw}={}) {
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
        get pixels(){return pixels;},
        toDataURL:()=>webp?'data:image/webp;base64,':'data:image/png;base64,',
        getContext:()=>({
          clearRect(){},
          drawImage(image,x,y,width,height){
            onDraw?.(image.width,width);
            if (width===image.width && height===image.height) {
              pixels=Buffer.from(image.pixels);
              return;
            }
            pixels=Buffer.alloc(width*height*4);
            // Model the difference between point and area sampling for fine textures.
            const samples=(from,to)=>this.imageSmoothingQuality==='high'?Math.min(8,Math.max(1,Math.floor(from/to))):1;
            const xs=samples(image.width,width),ys=samples(image.height,height),count=xs*ys;
            const input=image.pixels;
            for(let row=0;row<height;row++) for(let column=0;column<width;column++){
              let r=0,g=0,b=0,a=0;
              for(let dy=0;dy<ys;dy++){
                const base=Math.floor((row+(dy+.5)/ys)*image.height/height)*image.width;
                for(let dx=0;dx<xs;dx++){
                  const i=4*(base+Math.floor((column+(dx+.5)/xs)*image.width/width));
                  r+=input[i];g+=input[i+1];b+=input[i+2];a+=input[i+3];
                }
              }
              const i=4*(row*width+column);
              pixels[i]=Math.round(r/count);pixels[i+1]=Math.round(g/count);
              pixels[i+2]=Math.round(b/count);pixels[i+3]=Math.round(a/count);
            }
          },
          getImageData:()=>({data:pixels}),
        }),
        async toBlob(resolve,type,quality){
          if(type==='image/webp'&&!webp)type='image/png';
          const width=canvas.width,height=canvas.height;
          onEncode?.({width,height,quality});
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
  assert.ok(result.body.size>0&&result.body.size<=propertyPhoto.maxBytes);
  assert.ok(win.released>=2);
});

test('property optimization stops on the first acceptable finished file',async()=>{
  const attempts=[];
  const bytes=await sharp({create:{width:2560,height:1440,channels:3,background:'#63788d'}}).jpeg().toBuffer();
  const result=await optimizeImage(new File([bytes],'solid.jpg'),{...propertyPhoto,targetBytes:1},{
    win:rasterEnvironment({onEncode:attempt=>attempts.push(attempt)})
  });
  assert.deepEqual(attempts,[{width:1920,height:1080,quality:.86}]);
  assert.ok(result.body.size>1&&result.body.size<=500_000);
});

test('browsers without WebP encoding use a staged resize and try JPEG directly',async()=>{
  const draws=[],attempts=[];
  const bytes=await sharp({create:{width:4000,height:2000,channels:3,background:'#63788d'}}).jpeg().toBuffer();
  const result=await optimizeImage(new File([bytes],'wide.jpg'),propertyPhoto,{
    win:rasterEnvironment({webp:false,onEncode:attempt=>attempts.push(attempt),onDraw:(from,to)=>draws.push([from,to])})
  });
  assert.equal(result.contentType,'image/jpeg');
  assert.deepEqual(attempts,[{width:1920,height:960,quality:.86}]);
  assert.ok(draws.some(([from,to])=>from===4000&&to===2000));
  assert.ok(draws.some(([from,to])=>from===2000&&to===1920));
});

const stressPhoto=process.env.GARY_HOME_STRESS_JPEG;
test('the exact 28.15 MB Gary Home stress JPEG passes separate resize and encoding validation',{
  skip: !stressPhoto && 'Set GARY_HOME_STRESS_JPEG to the original gary-home-large-test.jpg'
},async()=>{
  const source=await readFile(stressPhoto);
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '23d95079d564f990e5e3eb5b1653d43f1d5b487d82a7a2ffa2b0f29cdacec958');
  const attempts=[];
  const result=await optimizeImage(new File([source],'gary-home-large-test.jpg'),propertyPhoto,{
    inputMax:32*1024*1024,win:rasterEnvironment({onEncode:attempt=>attempts.push(attempt)})
  });
  assert.equal(result.contentType,'image/webp');
  assert.ok(result.body.size<=500_000);
  assert.ok(Math.abs(result.width*2/3-result.height)<=.5);
  assert.deepEqual([result.width,result.height],[attempts.at(-1).width,attempts.at(-1).height]);
  assert.ok(attempts.length>1&&attempts.length<35);
});

test('small sources retain their actual MIME, bytes, and dimensions',async()=>{
  const file=await photo({width:64,height:56});
  const result=await optimizeImage(file,propertyPhoto,{win:rasterEnvironment()});
  assert.equal(result.contentType,'image/jpeg');
  assert.equal(result.width,64);
  assert.deepEqual(await result.body.arrayBuffer(),await file.arrayBuffer());
});

test('WebP carries JPEG EXIF descriptions and writes the new orientation and geometry',async()=>{
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
  assert.equal(result.contentType,'image/webp');
  assert.ok(result.height>=1280&&result.height<=1920);
  assert.equal(result.height/result.width,16/9);
  const metadata=await sharp(Buffer.from(await result.body.arrayBuffer())).metadata();
  assert.match(metadata.exif.toString(),/Lake view/);
  assert.equal(metadata.orientation,1);
  assert.equal(metadata.width,result.width);
  assert.ok(result.body.size<=500_000);
});

const cameraSample = new URL('../public/images/neighbourhoods/hai-ba-trung.jpg',import.meta.url).pathname;

function appSegment(marker,payload) {
  const header=Buffer.alloc(4);
  header.set([255,marker]);
  header.writeUInt16BE(payload.length+2,2);
  return Buffer.concat([header,payload]);
}

function photoshopResource(id,value) {
  const header=Buffer.alloc(12);
  header.write('8BIM');
  header.writeUInt16BE(id,4);
  header.writeUInt32BE(value.length,8);
  return Buffer.concat(value.length%2?[header,value,Buffer.alloc(1)]:[header,value]);
}

test('large profiled JPEGs with substantial XMP and optional data fit the finished WebP budget',async()=>{
  const copyright='Gary Home photo fixture';
  const xmp=`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:app="https://example.invalid/edit/" dc:rights="${copyright}" app:editHistory="${'edit record '.repeat(4500)}"/></rdf:RDF></x:xmpmeta>`;
  const bytes=await sharp(cameraSample).resize(6000,4000,{fit:'cover'}).withIccProfile('p3')
    .withExif({IFD0:{Copyright:copyright}}).withXmp(xmp).jpeg({quality:97,chromaSubsampling:'4:4:4'}).toBuffer();
  const comment=appSegment(0xfe,Buffer.alloc(62_000,65));
  const original=new File([bytes.subarray(0,2),...Array(9).fill(comment),bytes.subarray(2)],'high-resolution.jpg');
  assert.ok(original.size>8*1024*1024);
  const attempts=[];
  const result=await optimizeImage(original,propertyPhoto,{win:rasterEnvironment({onEncode:value=>attempts.push(value)}),inputMax:32*1024*1024});
  const metadata=await sharp(Buffer.from(await result.body.arrayBuffer())).metadata();
  assert.equal(metadata.format,'webp');
  assert.ok(result.body.size<=500_000);
  assert.ok(result.width<=1920);
  assert.ok(Math.abs(result.width*2/3-result.height)<=.5);
  assert.match(metadata.exif.toString(),/Gary Home photo fixture/);
  assert.match(metadata.xmp.toString(),/Gary Home photo fixture/);
  assert.ok(attempts.length>1,'metadata and raster bytes require adaptive encoding');
  assert.ok(attempts.some(attempt=>attempt.quality<.86));
});

test('an ICC-tagged image under the byte cap still fits the 1920 px bound',async()=>{
  const bytes=await sharp({create:{width:2200,height:900,channels:3,background:'#745c46'}}).withIccProfile('p3').jpeg().toBuffer();
  const file=new File([bytes],'oversize.jpg',{type:'image/jpeg'});
  assert.ok(file.size<propertyPhoto.targetBytes);
  const result=await optimizeImage(file,propertyPhoto,{win:rasterEnvironment()});
  assert.equal(result.contentType,'image/webp');
  assert.deepEqual([result.width,result.height],[1920,785]);
});

test('IPTC attribution uses JPEG compatibility and excludes optional Photoshop data',async()=>{
  const copyright=Buffer.from('Gary Home IPTC copyright');
  const dataset=Buffer.concat([Buffer.from([0x1c,2,116,0,copyright.length]),copyright]);
  const iptc=appSegment(0xed,Buffer.concat([Buffer.from('Photoshop 3.0\0'),photoshopResource(0x0404,dataset),
    photoshopResource(0x0409,Buffer.alloc(45_000,67))]));
  const original=Buffer.from(await (await photo()).arrayBuffer());
  const file=new File([original.subarray(0,2),iptc,original.subarray(2)],'property.jpg');
  const result=await optimizeImage(file,propertyPhoto,{win:rasterEnvironment()});
  const out=Buffer.from(await result.body.arrayBuffer());
  const metadata=await sharp(out).metadata();
  assert.equal(result.contentType,'image/jpeg');
  assert.ok(out.length<=500_000);
  assert.ok(metadata.iptc.includes(copyright));
  assert.ok(!out.includes(Buffer.alloc(128,67)));
});

test('tight output budgets fall back to smaller resolutions as well as lower quality',async()=>{
  const file=await photo(),attempts=[];
  const result=await optimizeImage(file,{...propertyPhoto,targetBytes:55_000,maxBytes:70_000},{
    win:rasterEnvironment({onEncode:attempt=>attempts.push(attempt)})
  });
  assert.ok(result.body.size<=70_000);
  assert.ok(result.width<1920);
  assert.ok(attempts.some(attempt=>attempt.quality<.72));
  assert.ok(new Set(attempts.map(attempt=>attempt.width)).size>1);
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
