// This module is also shipped with Visa and Jobs so each app can deploy independently.
export const propertyPhoto = {targetBytes:240_000, maxBytes:500_000, maxEdge:1920, minEdge:1280, adaptive:true};
export const editorialPhoto = {targetBytes:300_000, maxBytes:650_000, maxEdge:2400, minEdge:1600, keepProtectedResolution:true};
export const avatarPhoto = {targetBytes:45_000, maxBytes:100_000, maxEdge:384, minEdge:256};
export const imageEncodingQualities = [0.86, 0.78, 0.72];
const extensions = {'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/avif':'avif'};
export const imageTypes = Object.keys(extensions);

function imageError(code) {
  return Object.assign(new Error(code), {code});
}

export function imageOptimizationErrorText(error, language = 'en') {
  const messages = {
    IMAGE_SIZE:['Choose a smaller image file.','Hãy chọn tệp ảnh nhỏ hơn.'],
    IMAGE_TYPE:['Choose a supported still image.','Hãy chọn ảnh tĩnh có định dạng được hỗ trợ.'],
    IMAGE_PIXELS:['This image has too many pixels. Resize it and try again.','Ảnh có quá nhiều điểm ảnh. Hãy giảm kích thước rồi thử lại.'],
    IMAGE_UNREADABLE:['This image could not be opened. Choose another file.','Không thể mở ảnh này. Hãy chọn tệp khác.'],
    IMAGE_METADATA:['This image exceeds the upload limit with its embedded metadata. Choose a smaller copy that retains the metadata.','Ảnh vượt giới hạn tải lên khi giữ siêu dữ liệu. Hãy chọn bản nhỏ hơn có giữ siêu dữ liệu.'],
    IMAGE_QUALITY:['This image could not meet the upload size limit at the required quality. Choose a smaller copy.','Ảnh không đạt giới hạn dung lượng ở chất lượng yêu cầu. Hãy chọn bản nhỏ hơn.'],
  };
  return Object.hasOwn(messages,error?.code) ? messages[error.code][language==='vi'?1:0] : '';
}

const tag = (bytes, index, size = 4) => String.fromCharCode(...bytes.subarray(index, index + size));
const xmpHeader = 'http://ns.adobe.com/xap/1.0/\0';
const photoshopHeader = 'Photoshop 3.0\0';

function jpegDetails(bytes, view) {
  const metadata = [];
  let protectedMetadata = false, hasIcc = false, xmp, width, height;
  for (let index = 2; index + 4 < bytes.length;) {
    const start = index;
    if (bytes[index++] !== 255) break;
    while (bytes[index] === 255) index++;
    const marker = bytes[index++];
    if (marker === 0xda || marker === 0xd9 || index + 2 > bytes.length) break;
    const length = view.getUint16(index);
    const end = index + length;
    if (length < 2 || end > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
      height = view.getUint16(index + 3);
      width = view.getUint16(index + 5);
    }
    const data = index + 2;
    if (marker === 0xe2 && tag(bytes,data,12) === 'ICC_PROFILE\0') hasIcc = true;
    if (marker === 0xe1 && !xmp && tag(bytes,data,xmpHeader.length) === xmpHeader) {
      xmp = bytes.subarray(data+xmpHeader.length,end);
    }
    // The historical converter and other image profiles still use the protected flag.
    if (marker === 0xfe || marker === 0xed || marker === 0xe1 && tag(bytes,index + 2,6) === 'Exif\0\0') {
      metadata.push({start, end, data, marker, tiff:marker === 0xe1 ? index + 8 : 0});
    } else if (marker >= 0xe0 && marker <= 0xef &&
      !(marker === 0xe0 && tag(bytes,index + 2,5) === 'JFIF\0' && length === 16) &&
      !(marker === 0xee && tag(bytes,index + 2,5) === 'Adobe' && length === 14)) {
      protectedMetadata = true;
    }
    index = end;
  }
  return {type:'image/jpeg', width, height, metadata, protectedMetadata, hasIcc, xmp};
}

export function imageDetails(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return jpegDetails(bytes, view);
  if (bytes.length >= 33 && view.getUint32(0) === 0x89504e47 &&
      view.getUint32(4) === 0x0d0a1a0a && tag(bytes,12) === 'IHDR') {
    let protectedMetadata = false, animated = false, alpha = [4,6].includes(bytes[25]), density;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), type = tag(bytes,offset+4);
      if (offset + length + 12 > bytes.length) return null;
      if (type === 'tRNS') alpha = true;
      if (type === 'acTL') animated = true;
      if (type === 'pHYs' && length === 9 && !density && bytes[offset+16] <= 1) {
        const x = view.getUint32(offset+8), y = view.getUint32(offset+12);
        if (x && y) density = {x,y,metres:bytes[offset+16]===1};
        else protectedMetadata = true;
      } else if (!['IHDR','IDAT','IEND','PLTE','tRNS','sRGB','gAMA','cHRM'].includes(type)) protectedMetadata = true;
      offset += length + 12;
    }
    return {type:'image/png',width:view.getUint32(16),height:view.getUint32(20),alpha,animated,protectedMetadata,density};
  }
  if (bytes.length >= 20 && tag(bytes,0) === 'RIFF' && tag(bytes,8) === 'WEBP' &&
      view.getUint32(4,true) + 8 === bytes.length && ['VP8 ','VP8L','VP8X'].includes(tag(bytes,12))) {
    let width, height, alpha = false, animated = false, protectedMetadata = false, hasExif = false, hasIcc = false;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset+4,true), type = tag(bytes,offset), start = offset+8;
      if (start+length > bytes.length) break;
      if (type === 'VP8X' && length === 10) {
        alpha = Boolean(bytes[start] & 16);
        animated = Boolean(bytes[start] & 2);
        width = 1 + (view.getUint32(start+4,true) & 0xffffff);
        height = 1 + (view.getUint16(start+7,true) | bytes[start+9] << 16);
      } else if (type === 'VP8 ' && length >= 10 && !width) {
        width = view.getUint16(start+6,true) & 0x3fff;
        height = view.getUint16(start+8,true) & 0x3fff;
      } else if (type === 'VP8L' && length >= 5 && !width) {
        const bits = view.getUint32(start+1,true);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
        alpha = Boolean(bits & 0x10000000);
      } else if (type === 'ALPH') alpha = true;
      if (type === 'ANIM' || type === 'ANMF') animated = true;
      if (type === 'EXIF') hasExif = true;
      if (type === 'ICCP') hasIcc = true;
      if (!['VP8X','VP8 ','VP8L','ALPH','ANIM','ANMF'].includes(type)) protectedMetadata = true;
      offset = start + length + length % 2;
    }
    return {type:'image/webp',width,height,alpha,animated,protectedMetadata,hasExif,hasIcc};
  }
  if (bytes.length >= 16 && tag(bytes,4) === 'ftyp') {
    const boxSize = view.getUint32(0);
    if (boxSize >= 16 && boxSize <= bytes.length &&
        (['avif','avis'].includes(tag(bytes,8)) ||
          Array.from({length:Math.floor((Math.min(boxSize,4096)-16)/4)},(_,i)=>tag(bytes,16+i*4)).some(brand=>brand==='avif'||brand==='avis'))) {
      return {type:'image/avif',protectedMetadata:true};
    }
  }
  return null;
}

// WebP carries physical density as EXIF resolution rationals. Converting
// pixels/metre to pixels/centimetre keeps the original values exactly.
export function webpWithDensity(bytes, density) {
  const exif = new Uint8Array(66), tiff = new DataView(exif.buffer);
  exif.set([73,73,42,0,8,0,0,0,3,0]);
  for (const [offset, field, pointer, count] of [[10,282,50,density.x],[22,283,58,density.y]]) {
    tiff.setUint16(offset,field,true);
    tiff.setUint16(offset+2,5,true);
    tiff.setUint32(offset+4,1,true);
    tiff.setUint32(offset+8,pointer,true);
    tiff.setUint32(pointer,count,true);
    tiff.setUint32(pointer+4,density.metres?100:1,true);
  }
  tiff.setUint16(34,296,true);
  tiff.setUint16(36,3,true);
  tiff.setUint32(38,1,true);
  tiff.setUint16(42,density.metres?3:1,true);
  return webpWithExif(bytes,exif);
}

export function webpWithExif(bytes, exif) {
  return webpWithMetadata(bytes,exif);
}

const webpChunkSize = bytes => bytes ? 8+bytes.length+bytes.length%2 : 0;

function webpWithMetadata(bytes, exif, xmp) {
  const image = imageDetails(bytes);
  if (image?.type !== 'image/webp' || !image.width || !image.height || image.animated || image.hasExif) {
    throw imageError('IMAGE_METADATA');
  }
  const extended = tag(bytes,12)==='VP8X';
  const addedHeader = extended?0:18;
  const output = new Uint8Array(bytes.length+addedHeader+webpChunkSize(exif)+webpChunkSize(xmp));
  const view = new DataView(output.buffer);
  output.set(bytes.subarray(0,12));
  view.setUint32(4,output.length-8,true);
  output.set(bytes.subarray(12),12+addedHeader);
  if (!extended) {
    output.set([86,80,56,88],12); // VP8X
    view.setUint32(16,10,true);
    if (image.alpha) output[20] = 16;
    view.setUint32(24,image.width-1,true);
    view.setUint16(27,(image.height-1)&0xffff,true);
    output[29] = (image.height-1)>>>16;
  }
  let offset = bytes.length+addedHeader;
  for (const [type,flag,payload] of [['EXIF',8,exif],['XMP ',4,xmp]]) {
    if (!payload) continue;
    output[20] |= flag;
    output.set(new TextEncoder().encode(type),offset);
    view.setUint32(offset+4,payload.length,true);
    output.set(payload,offset+8);
    offset += webpChunkSize(payload);
  }
  return output;
}

function jpegMetadata(bytes, segments, width, height, colorSpace) {
  return segments.map(({start,end,tiff}) => {
    const segment = bytes.slice(start,end);
    if (!tiff) return segment;
    const original = segment.subarray(tiff-start);
    const view = new DataView(original.buffer,original.byteOffset,original.length);
    const endian = tag(original,0,2), little = endian === 'II';
    if (view.byteLength < 8 || !['II','MM'].includes(endian) || view.getUint16(2,little) !== 42) throw imageError('IMAGE_METADATA');
    let exif = 0;
    function editDirectory(offset, fields, root = false) {
      if (offset < 8 || offset+2 > view.byteLength) throw imageError('IMAGE_METADATA');
      const count = view.getUint16(offset,little);
      if (offset+2+12*count+4 > view.byteLength) throw imageError('IMAGE_METADATA');
      for (let index = offset+2; index < offset+2+12*count; index+=12) {
        const field = view.getUint16(index,little), type = view.getUint16(index+2,little);
        if (view.getUint32(index+4,little) !== 1) continue;
        if (root && field === 0x8769 && type === 4) exif = view.getUint32(index+8,little);
        if (!(field in fields)) continue;
        if (type === 3) view.setUint16(index+8,fields[field],little);
        else if (type === 4) view.setUint32(index+8,fields[field],little);
        else throw imageError('IMAGE_METADATA');
      }
      // The old embedded JPEG preview may have different geometry. Keep the EXIF data
      // and leave the obsolete preview unreferenced.
      if (root) view.setUint32(offset+2+12*count,0,little);
    }
    editDirectory(view.getUint32(4,little), {0x112:1,0x100:width,0x101:height}, true);
    if (exif) editDirectory(exif, {0xa002:width,0xa003:height,
      ...(colorSpace ? {0xa001:colorSpace==='srgb'?1:65535} : {})});
    return segment;
  });
}

function jpegSegment(marker, parts) {
  const length = 2+parts.reduce((total,part)=>total+part.length,0);
  if (length>65535) throw imageError('IMAGE_METADATA');
  return [Uint8Array.of(255,marker,length>>>8,length&255),...parts];
}

// APP13 can carry IPTC attribution as well as much larger image previews and
// Photoshop state. Only rebuild the standard IPTC-IIM resources.
function jpegIptc(bytes, segments) {
  const header = new TextEncoder().encode(photoshopHeader);
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const result = [];
  for (const {marker,data,end} of segments) {
    if (marker!==0xed || tag(bytes,data,header.length)!==photoshopHeader) continue;
    const resources = [];
    for (let offset=data+header.length; offset+12<=end && tag(bytes,offset)==='8BIM';) {
      const sizeOffset = offset+6+2*Math.ceil((bytes[offset+6]+1)/2);
      if (sizeOffset+4>end) break;
      const size = view.getUint32(sizeOffset), next = sizeOffset+4+size+size%2;
      if (next>end) break;
      if (view.getUint16(offset+4)===0x0404 && size) resources.push(bytes.subarray(offset,next));
      offset = next;
    }
    if (resources.length) result.push(...jpegSegment(0xed,[header,...resources]));
  }
  return result;
}

function resizedXmp(packet, win, width, height, colorSpace) {
  if (!packet?.length || !win.DOMParser || !win.XMLSerializer) return packet;
  const xml = new TextDecoder().decode(packet);
  if (/<!DOCTYPE/i.test(xml)) return undefined;
  const doc = new win.DOMParser().parseFromString(xml,'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return undefined;
  const fields = [
    ['http://ns.adobe.com/tiff/1.0/', {Orientation:1,ImageWidth:width,ImageLength:height}],
    ['http://ns.adobe.com/exif/1.0/', {PixelXDimension:width,PixelYDimension:height,ColorSpace:colorSpace==='srgb'?1:65535}],
  ];
  const note = 'http://ns.adobe.com/xmp/note/';
  for (const node of [...doc.getElementsByTagNameNS(note,'HasExtendedXMP')]) node.remove();
  for (const node of doc.getElementsByTagName('*')) {
    node.removeAttributeNS(note,'HasExtendedXMP');
    for (const [namespace,values] of fields) for (const [name,value] of Object.entries(values)) {
      if (node.namespaceURI===namespace && node.localName===name) node.textContent = String(value);
      const attribute = node.getAttributeNodeNS(namespace,name);
      if (attribute) attribute.value = String(value);
    }
  }
  return new TextEncoder().encode(new win.XMLSerializer().serializeToString(doc));
}

const byteSize = parts => parts.reduce((total,part)=>total+part.length,0);

function dimensions(width, height, limit) {
  const scale = Math.min(1, limit / Math.max(width,height));
  return [Math.max(1,Math.round(width*scale)), Math.max(1,Math.round(height*scale))];
}

export function* imageEncodingSizes(width, height, profile) {
  const edges = new Set([profile.maxEdge, Math.round((profile.maxEdge+profile.minEdge)/2), profile.minEdge]);
  const tried = new Set();
  for (const edge of edges) {
    const [w,h] = dimensions(width,height,edge);
    const key = w+':'+h;
    if (tried.has(key)) continue;
    tried.add(key);
    yield [w,h];
  }
}

async function decode(blob, win) {
  if (typeof win.createImageBitmap === 'function') {
    try {
      const image = await win.createImageBitmap(blob,{imageOrientation:'from-image'});
      return {image, width:image.width, height:image.height, release:()=>image.close()};
    } catch { /* Some browsers can decode additional formats using HTMLImageElement. */ }
  }
  const url = win.URL.createObjectURL(blob);
  try {
    const image = new win.Image();
    image.src = url;
    await image.decode();
    return {image,width:image.naturalWidth,height:image.naturalHeight,release:()=>win.URL.revokeObjectURL(url)};
  } catch {
    win.URL.revokeObjectURL(url);
    throw imageError('IMAGE_UNREADABLE');
  }
}

function canvasFor(win, width, height) {
  const canvas = win.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawResampled(context, source, width, height) {
  context.imageSmoothingQuality = 'high';
  context.drawImage(source,0,0,width,height);
}

function snapshot(canvas, source, colorSpace) {
  const context = canvas.getContext('2d', {willReadFrequently:true,colorSpace});
  context.clearRect(0,0,canvas.width,canvas.height);
  drawResampled(context,source,canvas.width,canvas.height);
  return context.getImageData(0,0,canvas.width,canvas.height).data;
}

// The RGB value of a fully transparent pixel has no visible effect.
export function imagePixelError(a, b) {
  if (a.length !== b.length || !a.length || a.length % 4) return Infinity;
  let squared = 0;
  for (let index = 0; index < a.length; index+=4) {
    const alphaA = a[index+3], alphaB = b[index+3];
    squared += (alphaA-alphaB)**2;
    for (let channel = 0; channel < 3; channel++) {
      squared += ((a[index+channel]*alphaA-b[index+channel]*alphaB)/255)**2;
    }
  }
  return Math.sqrt(squared/a.length);
}

function encode(canvas, type, quality) {
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}

const maxPixelError = 15;

export async function optimizeImage(file, profile, options = {}) {
  const {win = globalThis, signal, inputMax = 8*1024*1024, types = imageTypes, stillOnly = false} = options;
  signal?.throwIfAborted();
  if (!file?.size || file.size > inputMax) throw imageError('IMAGE_SIZE');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const source = imageDetails(bytes);
  if (!source || !types.includes(source.type) || stillOnly && source.animated) throw imageError('IMAGE_TYPE');
  const listingJpeg = profile.adaptive && source.type==='image/jpeg';
  const maxPixels = listingJpeg ? 50_000_000 : 32_000_000;
  const allowedPixels = (width,height) => width > 0 && height > 0 &&
    width <= 12000 && height <= 12000 && width * height <= maxPixels;
  if (source.width !== undefined && !allowedPixels(source.width,source.height)) throw imageError('IMAGE_PIXELS');
  const original = file.slice(0,file.size,source.type);
  const decoded = await decode(original,win);
  try {
    const {image,width,height} = decoded;
    signal?.throwIfAborted();
    if (!allowedPixels(width,height)) throw imageError('IMAGE_PIXELS');
    const result = (body,w,h) => ({body,contentType:body.type,extension:extensions[body.type],width:w,height:h});
    const withinResolution = Math.max(width,height) <= profile.maxEdge;
    if (original.size <= profile.targetBytes && withinResolution) return result(original,width,height);
    if ((!listingJpeg && source.protectedMetadata) || source.animated) {
      // Canvas cannot preserve the embedded color profile and other PNG chunks.
      const keepListingPng = profile.adaptive && source.type==='image/png' && !source.animated;
      if (original.size <= profile.maxBytes && (withinResolution || profile.keepProtectedResolution || keepListingPng)) return result(original,width,height);
      throw imageError('IMAGE_METADATA');
    }
    const sized = (body,w,h) => {
      signal?.throwIfAborted();
      return result(body,w,h);
    };
    const render = canvasFor(win,1,1);
    const sample = canvasFor(win,64,64);
    const comparison = profile.adaptive ? canvasFor(win,1,1) : sample;
    const primaryExif = listingJpeg ? source.metadata.find(segment=>segment.tiff) : null;
    const iptc = listingJpeg ? jpegIptc(bytes,source.metadata) : [];
    if (byteSize(iptc)>=profile.maxBytes) throw imageError('IMAGE_METADATA');
    let format = (listingJpeg ? iptc.length : source.metadata?.length) ? 'image/jpeg' : 'image/webp';
    const jpegFallback = profile.adaptive && !source.alpha && format==='image/webp' &&
      render.toDataURL && !render.toDataURL('image/webp').startsWith('data:image/webp');
    if (jpegFallback) format = 'image/jpeg';
    const context = render.getContext('2d',{
      colorSpace:listingJpeg && source.hasIcc ? 'display-p3' : 'srgb',willReadFrequently:!!jpegFallback
    });
    const colorSpace = context.getContextAttributes?.()?.colorSpace ?? 'srgb';
    const sourceSample = snapshot(sample,image,colorSpace);
    const sizes = [...imageEncodingSizes(width,height,profile)];
    if (profile.adaptive) for (const edge of [1024,768]) {
      const next = dimensions(width,height,edge);
      if (Math.max(...next)<Math.max(...sizes.at(-1))) sizes.push(next);
    }
    const qualities = profile.adaptive ? [...imageEncodingQualities,0.64,0.56,0.48,0.40] : imageEncodingQualities;
    let fallback = null;
    let resizeSource = image;
    for (const [w,h] of sizes) {
      signal?.throwIfAborted();
      // Reduce extreme downscales in stages when JPEG is the browser's only
      // lossy encoder. A single large step can alias fine detail into noise.
      while (jpegFallback && resizeSource.width>2*w && resizeSource.height>2*h) {
        const half = canvasFor(win,Math.round(resizeSource.width/2),Math.round(resizeSource.height/2));
        drawResampled(half.getContext('2d',{colorSpace,willReadFrequently:true}),resizeSource,half.width,half.height);
        resizeSource = half;
      }
      render.width = w;
      render.height = h;
      drawResampled(context,resizeSource,w,h);
      // Check the resampling once per size, before spending time on encoding.
      if (profile.adaptive && imagePixelError(sourceSample,snapshot(sample,render,colorSpace))>maxPixelError) continue;
      let reference;
      const exifSegment = primaryExif ? jpegMetadata(bytes,[primaryExif],w,h,colorSpace)[0] : null;
      const exif = exifSegment?.subarray(primaryExif.tiff-primaryExif.start);
      const xmp = listingJpeg ? resizedXmp(source.xmp,win,w,h,colorSpace) : null;
      for (const quality of qualities) {
        signal?.throwIfAborted();
        let body = await encode(render,format,quality);
        if (format==='image/webp' && body?.type!=='image/webp') {
          body = await encode(render,source.alpha ? 'image/png' : 'image/jpeg',quality);
        }
        signal?.throwIfAborted();
        if (!body?.size || body.size>profile.maxBytes || !types.includes(body.type) || (format==='image/jpeg' && body.type!=='image/jpeg')) continue;
        if (listingJpeg) {
          const webp = body.type==='image/webp';
          const encoded = webp && (exif || xmp) || colorSpace==='display-p3'
            ? new Uint8Array(await body.arrayBuffer()) : null;
          // The encoder's profile describes the converted pixels. Reusing the
          // source ICC bytes here would assign the wrong colors to those pixels.
          if (colorSpace==='display-p3' && !imageDetails(encoded)?.hasIcc) continue;
          if (webp && encoded && (exif || xmp)) {
            const extra = (tag(encoded,12)==='VP8X'?0:18)+webpChunkSize(exif)+webpChunkSize(xmp);
            if (body.size+extra>profile.maxBytes) continue;
            body = new win.Blob([webpWithMetadata(encoded,exif,xmp)],{type:'image/webp'});
          } else if (body.type==='image/jpeg') {
            const segments = [...iptc];
            if (exifSegment) segments.push(exifSegment);
            if (xmp) segments.push(...jpegSegment(0xe1,[new TextEncoder().encode(xmpHeader),xmp]));
            if (body.size+byteSize(segments)>profile.maxBytes) continue;
            if (segments.length) body = new win.Blob([body.slice(0,2),...segments,body.slice(2)],{type:'image/jpeg'});
          } else if (!webp) continue;
        } else if (source.metadata?.length) {
          body = new win.Blob([body.slice(0,2),...jpegMetadata(bytes,source.metadata,w,h),body.slice(2)],{type:'image/jpeg'});
        }
        if (source.density) {
          if (body.type !== 'image/webp') continue;
          body = new win.Blob([webpWithDensity(new Uint8Array(await body.arrayBuffer()),source.density)],{type:'image/webp'});
        }
        if (body.size > profile.maxBytes || withinResolution && body.size >= original.size) continue;
        const check = await decode(body,win);
        try {
          signal?.throwIfAborted();
          if (check.width !== w || check.height !== h) continue;
          if (profile.adaptive && !reference) {
            // Read the exact raster sent to the encoder, at its full output size.
            comparison.width = w;
            comparison.height = h;
            reference = context.getImageData(0,0,w,h).data;
          }
          if (imagePixelError(reference??sourceSample,snapshot(comparison,check.image,colorSpace))>maxPixelError) continue;
          if (profile.adaptive || body.size<=profile.targetBytes) return sized(body,w,h);
          fallback ??= {body,w,h};
        } finally {
          check.release();
        }
      }
    }
    if (fallback) return sized(fallback.body,fallback.w,fallback.h);
    if (withinResolution && original.size <= profile.maxBytes) return sized(original,width,height);
    throw imageError('IMAGE_QUALITY');
  } finally {
    decoded.release();
  }
}
