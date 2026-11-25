// Accept only recognised container blocks whose contents Sharp can retain.
// Originals with any additional or conflicting metadata stay in review.
const exifPrefix=Buffer.from('Exif\0\0');
const jpegXmpPrefix=Buffer.from('http://ns.adobe.com/xap/1.0/\0');
const iccPrefix=Buffer.from('ICC_PROFILE\0');
const pngXmpPrefix=Buffer.from('XML:com.adobe.xmp\0\0\0\0\0');
const startsWith=(value,prefix)=>value.subarray(0,prefix.length).equals(prefix);
const tiff=value=>startsWith(value,exifPrefix)?value.subarray(exifPrefix.length):value;

function exifResolution(exif) {
  if (!exif) return null;
  try {
    const data=tiff(exif);
    const endian=data.toString('ascii',0,2);
    if (endian!=='II'&&endian!=='MM') return null;
    const u16=offset=>endian==='II'?data.readUInt16LE(offset):data.readUInt16BE(offset);
    const u32=offset=>endian==='II'?data.readUInt32LE(offset):data.readUInt32BE(offset);
    if(u16(2)!==42)return null;
    const start=u32(4);
    const count=u16(start);
    if (start+2+count*12+4>data.length) return null;
    const values={};
    for(let i=0;i<count;i++){
      const offset=start+2+i*12;
      const tag=u16(offset),format=u16(offset+2);
      if (u32(offset+4)!==1) continue;
      if (tag===296&&format===3) values.unit=u16(offset+8);
      if ((tag===282||tag===283)&&format===5){
        const at=u32(offset+8);
        const value=u32(at)/u32(at+4);
        if(!Number.isFinite(value)||value<=0)return null;
        values[tag===282?'x':'y']=value;
      }
    }
    return values.x&&values.y?values:null;
  } catch {return null;}
}

function jpegTags(bytes, source) {
  const seen=new Set();
  const equal=(name,payload)=>!seen.has(name)&&source[name]?.equals(payload)&&seen.add(name);
  for (let offset=2;offset+4<=bytes.length;){
    if(bytes[offset++]!==255)return false;
    while(bytes[offset]===255)offset++;
    const marker=bytes[offset++];
    if(marker===0xda)return true;
    if(offset+2>bytes.length)return false;
    const length=bytes.readUInt16BE(offset);
    if(length<2||offset+length>bytes.length)return false;
    const block=bytes.subarray(offset+2,offset+length);
    offset+=length;
    if(marker===0xe0&&length===16&&block.toString('ascii',0,5)==='JFIF\0'){
      if(seen.has('jfif'))return false;
      seen.add('jfif');
      const mode=block[7],x=block.readUInt16BE(8),y=block.readUInt16BE(10);
      if(mode===0&&x===y&&x>0)continue;
      const density=exifResolution(source.exif);
      if(!density||(mode!==1&&mode!==2)||density.unit!==mode+1||density.x!==x||density.y!==y)return false;
    } else if(marker===0xe1&&startsWith(block,exifPrefix)){
      if(!equal('exif',block))return false;
    } else if(marker===0xe1&&startsWith(block,jpegXmpPrefix)){
      if(!equal('xmp',block.subarray(jpegXmpPrefix.length)))return false;
    } else if(marker===0xe2&&startsWith(block,iccPrefix)){
      if(block[iccPrefix.length]!==1||block[iccPrefix.length+1]!==1||
        !equal('icc',block.subarray(iccPrefix.length+2)))return false;
    } else if(marker===0xfe||(marker>=0xe0&&marker<=0xef)){
      return false;
    }
  }
  return false;
}

function pngTags(bytes,source,details) {
  const seen=new Set();
  for(let offset=8;offset+12<=bytes.length;){
    const size=bytes.readUInt32BE(offset);
    const name=bytes.toString('ascii',offset+4,offset+8);
    if(offset+12+size>bytes.length)return false;
    const block=bytes.subarray(offset+8,offset+8+size);
    offset+=size+12;
    if(name==='iTXt'){
      if(seen.has(name)||!startsWith(block,pngXmpPrefix)||!source.xmp?.equals(block.subarray(pngXmpPrefix.length)))return false;
      seen.add(name);
    } else if(name==='eXIf'){
      if(seen.has(name)||!source.exif||!tiff(source.exif).equals(block))return false;
      seen.add(name);
    } else if(name==='pHYs'){
      const density=details.density;
      if(!density||seen.has(name))return false;
      if(source.exif){
        const tags=exifResolution(source.exif);
        const scale=tags?.unit===2?100/2.54:tags?.unit===3?100:0;
        if(!tags||!density.metres||!scale||Math.round(tags.x*scale)!==density.x||
          Math.round(tags.y*scale)!==density.y)return false;
      }
      seen.add(name);
    } else if(!['IHDR','IDAT','IEND','PLTE','tRNS','sRGB','gAMA','cHRM'].includes(name)){
      return false;
    }
    if(name==='IEND')return offset===bytes.length;
  }
  return false;
}

export function canPreserveWebpMetadata(bytes, source, details) {
  if(source.space!=='srgb'||source.iptc||source.comments?.length||!(source.icc||source.exif||source.xmp))return false;
  return source.format==='jpeg'?jpegTags(bytes,source):source.format==='png'&&pngTags(bytes,source,details);
}
