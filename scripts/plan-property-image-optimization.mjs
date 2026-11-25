// Local-only inventory and staging. Storage credentials are never used here.
import {createHash, randomUUID} from 'node:crypto';
import {link, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {imageDetails, imageEncodingQualities, imageEncodingSizes, imagePixelError, propertyPhoto, webpWithDensity, webpWithExif} from '../lib/image-optimization.mjs';
import {canPreserveWebpMetadata} from './property-photo-webp-metadata.mjs';
import {PROPERTY_IMAGE_BUCKET, PROPERTY_IMAGE_MAX_BYTES, propertyPhotoStorageKey} from '../lib/property-photo-files.ts';

const formats = {'image/jpeg':'jpeg','image/png':'png'};
const extensions = {'image/jpeg':/\.jpe?g$/i,'image/png':/\.png$/i};
const batchCutoff = propertyPhoto.maxBytes;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const stagedDirectory = 'staged-v2';
const snapshotKey = ({key,id,version}) => digest(JSON.stringify([key,id,version]));
const approved = format => Object.hasOwn(formats,format);

function groups(entries, keyOf) {
  const entriesByKey = new Map();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!key) continue;
    if (!entriesByKey.has(key)) entriesByKey.set(key,[]);
    entriesByKey.get(key).push(entry.token);
  }
  return [...entriesByKey.values()].filter(tokens=>tokens.length>1);
}

export function planInventory(inventory) {
  const {bucket, schemaVersion, objects, references, galleryListings} = inventory;
  if (bucket !== PROPERTY_IMAGE_BUCKET || schemaVersion !== 1 || !Array.isArray(objects) ||
      !references || typeof references !== 'object' || Array.isArray(references)) throw new Error('Expected a Home property-media inventory.');
  const keys = new Map();
  for (const entry of objects) {
    if (typeof entry.key !== 'string' || !entry.key || entry.bytes !== null &&
        (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0)) throw new Error('Invalid inventory row.');
    keys.set(entry.key,(keys.get(entry.key) || 0)+1);
  }
  const entries = objects.map(entry=>{
    const sightings = Object.hasOwn(references,entry.key) ? references[entry.key] : 0;
    if (!Number.isSafeInteger(sightings) || sightings<0) throw new Error('Invalid reference count.');
    const protectedKey = entry.protected !== false || typeof entry.version !== 'string' || !entry.version ||
      typeof entry.id !== 'string' || !entry.id || !entry.etag || keys.get(entry.key)>1;
    const supported = approved(entry.mime) && extensions[entry.mime].test(entry.key) && entry.bytes<=PROPERTY_IMAGE_MAX_BYTES;
    const owners = galleryListings && Object.hasOwn(galleryListings,entry.key) ? galleryListings[entry.key] : [];
    const listing = Array.isArray(owners) && owners.length===1 ? owners[0] : null;
    let state = 'candidate';
    if (protectedKey) state = 'protected';
    else if (!sightings) state = 'unreferenced';
    else if (entry.mime==='image/webp' || entry.mime==='image/avif' || entry.bytes && entry.bytes<batchCutoff) state = 'skip';
    else if (!entry.bytes || !supported || galleryListings && !listing) state = 'review';
    return {...entry,sightings,state,listing,token:snapshotKey(entry)};
  });
  const candidates = entries.filter(entry=>entry.state==='candidate').sort((a,b)=>
    Number(b.mime==='image/png')-Number(a.mime==='image/png') || b.bytes-a.bytes || a.key.localeCompare(b.key));
  const storageBytes = entries.reduce((sum,entry)=>sum+(entry.bytes||0),0);
  const modeledSavingsBytes = candidates.reduce((sum,entry)=>sum+Math.max(0,entry.bytes-225_000),0);
  return {
    entries,queue:candidates.map(entry=>entry.token),storageBytes,unknownSizes:entries.filter(entry=>entry.bytes===null).length,
    missingReferences:Object.keys(references).filter(key=>!keys.has(key)),
    etagDuplicateHints:groups(entries,entry=>entry.bytes && entry.etag ? JSON.stringify([entry.bytes,entry.etag]) : ''),
    modeledSavingsBytes,modeledStorageBytes:storageBytes-modeledSavingsBytes,
    modeledBytesSavedPerReadOfEachCandidate:modeledSavingsBytes,
  };
}

export const readJson = async path=>JSON.parse(await readFile(path,'utf8'));
export async function writeAtomic(path, data, createOnly=false) {
  const temp = path+'.'+randomUUID()+'.tmp';
  await writeFile(temp,data,{mode:0o600,flag:'wx'});
  if (createOnly) {
    try {await link(temp,path);} finally {await unlink(temp);}
  } else await rename(temp,path);
}

export async function measuredRendition(sharp, original, mime) {
  const make = bytes => sharp(bytes,{limitInputPixels:32_000_000,failOn:'warning'});
  const source = await make(original).metadata();
  const details = imageDetails(original);
  if (source.format !== formats[mime] || details?.type!==mime || source.pages > 1 || source.depth !== 'uchar' ||
      details.animated || details.metadata?.some(segment=>!segment.tiff)) return null;
  const preserveWebpMetadata=details.protectedMetadata&&canPreserveWebpMetadata(original,source,details);
  if(details.protectedMetadata&&!preserveWebpMetadata)return null;
  // Keep EXIF-bearing JPEGs in the original container. Untagged photographs
  // and ordinary PNGs with physical density can use WebP.
  const outputMime = details.metadata?.length&&!preserveWebpMetadata ? 'image/jpeg' : 'image/webp';
  const sample = (bytes,size)=>make(bytes).rotate().resize(size,size,{fit:'fill'}).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const reference = await sample(original,192);
  const detailedReference = await sample(original,720);
  const {targetBytes,maxBytes} = propertyPhoto;
  let fallback;
  for (const [width,height] of imageEncodingSizes(source.width,source.height,propertyPhoto)) {
    for (const encodedQuality of imageEncodingQualities) {
      const quality = Math.round(encodedQuality*100);
      const resized = make(original).resize(width,height,{fit:'fill',withoutEnlargement:true});
      if(preserveWebpMetadata&&source.icc)resized.keepIccProfile();
      if(preserveWebpMetadata&&source.xmp)resized.keepXmp();
      const compressed = outputMime==='image/jpeg' ?
        await resized.keepMetadata().jpeg({quality}).toBuffer() :
        await resized.webp({quality}).toBuffer();
      const encoded = preserveWebpMetadata&&source.exif ? Buffer.from(webpWithExif(compressed,source.exif)) :
        details.density ? Buffer.from(webpWithDensity(compressed,details.density)) : compressed;
      if (encoded.length>=original.length || encoded.length>maxBytes) continue;
      const actual = await make(encoded).metadata();
      const sameMetadata = ['exif','icc','iptc','xmp'].every(key=>!source[key] ||
        actual[key] && Buffer.compare(source[key],actual[key])===0);
      if (actual.width!==width || actual.height!==height || !sameMetadata || (actual.orientation??1)!==(source.orientation??1) ||
          outputMime==='image/jpeg' && source.density && actual.density!==source.density || source.comments &&
          JSON.stringify(actual.comments)!==JSON.stringify(source.comments)) continue;
      const error = imagePixelError(await sample(encoded,192),reference);
      const detailError = imagePixelError(await sample(encoded,720),detailedReference);
      if (error>15 || detailError>15) continue;
      const result = {encoded,outputMime,width:actual.width,height:actual.height,quality,
        rmse:Number(error.toFixed(3)),detailRmse:Number(detailError.toFixed(3))};
      if (encoded.length<=targetBytes) return result;
      fallback ??= result;
    }
  }
  return fallback || null;
}

function replacementKey(entry, outputMime) {
  const id = entry.listing?.id;
  const savedName = entry.userMetadata?.original_filename;
  const name = typeof savedName==='string' && savedName ? savedName : entry.key.split('/').at(-1);
  return propertyPhotoStorageKey(name,outputMime==='image/webp'?'webp':'jpg',randomUUID(),
    id && /^[a-f0-9-]{36}$/.test(id) ? id : undefined);
}

export async function stageInventory(plan, work, limit) {
  if (!Number.isSafeInteger(limit)||limit<1) throw new Error('Provide a positive maximum number of new candidates to stage.');
  const {default:sharp} = await import('sharp');
  const output = join(work,stagedDirectory), backups = join(work,'backups');
  await mkdir(output,{recursive:true,mode:0o700});
  const results = [];
  let attempted = 0;
  const byToken = new Map(plan.entries.map(entry=>[entry.token,entry]));
  for (const candidate of plan.queue) {
    const entry = byToken.get(candidate);
    const {token,key,version,id,etag,bytes,mime} = entry;
    const reportPath = join(output,token+'.json'), outputPath = join(output,token+'.optimized');
    const previous = await readJson(reportPath).catch(error=>error.code==='ENOENT' ? null : Promise.reject(error));
    if (attempted>=limit && !previous) break;
    const meta = await readJson(join(backups,token+'.json')).catch(error=>error.code==='ENOENT' ? null : Promise.reject(error));
    if (!meta) { results.push({token,state:'awaiting-backup'}); continue; }
    const originalPath = join(backups,token+'.original');
    if (meta.id!==id || meta.version!==version || meta.etag!==etag || !/^[a-f0-9]{64}$/.test(meta.sha256) ||
        (await stat(originalPath)).size!==bytes) throw new Error('Backup identity or size mismatch for '+token);
    const original = await readFile(originalPath);
    const sha256 = digest(original);
    if (sha256!==meta.sha256 || original.length!==bytes) throw new Error('Backup checksum mismatch for '+token);
    if (previous?.originalSha256===sha256 && previous.state==='staged') {
      if (digest(await readFile(outputPath))!==previous.outputSha256) throw new Error('Staged checksum mismatch for '+token);
      results.push(previous);continue;
    }
    if (previous?.originalSha256===sha256 && previous.state==='review') { results.push(previous); continue; }
    if (attempted>=limit) break;
    attempted++;
    let reason = 'quality-or-metadata';
    const prepared = await measuredRendition(sharp,original,mime).catch(()=>{reason='unreadable';return null;});
    const result = {token,key,id,version,etag,mime,originalBytes:bytes,originalSha256:sha256,
      state:prepared ? 'staged' : 'review'};
    if (prepared) {
      const {encoded,...quality} = prepared;
      await writeAtomic(outputPath,encoded);
      Object.assign(result,quality,{outputBytes:encoded.length,outputSha256:digest(encoded),
        replacementKey:replacementKey(entry,quality.outputMime),listing:entry.listing});
    } else result.reason=reason;
    await writeAtomic(reportPath,JSON.stringify(result,null,2)+'\n');
    results.push(result);
  }
  const stagedSavingsBytes = results.reduce((sum,row)=>sum+(row.state==='staged'?row.originalBytes-row.outputBytes:0),0);
  return {results,stagedSavingsBytes,verifiedDuplicateBackups:groups(results,row=>row.originalSha256)};
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [inventoryFile, command, work, limit, ...extra] = process.argv.slice(2);
  if (!inventoryFile || extra.length || command && (command!=='stage'||!work||!limit)) {
    throw new Error('Usage: node scripts/plan-property-image-optimization.mjs inventory.json [stage work-directory max-new-items]');
  }
  const plan=planInventory(await readJson(inventoryFile));
  const report=command==='stage' ? await stageInventory(plan,work,Number(limit)) : plan;
  console.log(JSON.stringify(report,null,2));
}
