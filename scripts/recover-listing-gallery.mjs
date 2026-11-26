import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { sameJson, sameListingVersion } from '../lib/listing-gallery-checkpoint.ts';
import { imageFilenameKey, imageOriginalFilename } from '../lib/image-filenames.ts';
import { PROPERTY_IMAGE_ORIGIN, propertyPhotoUrl } from '../lib/property-photo-files.ts';
import { storageStages } from './property-media-migration-transport.mjs';

const listingId = '003be3a7-963d-4e2c-911d-90774a70fe44';
const bucket = 'property-media';
const select = 'id,listing_code,status,created_at,updated_at,images,image_filenames,image_metadata';
const normalizeEtag = value => String(value ?? '').replace(/^"|"$/g, '');

export async function recoverGallery({ packet, read, info, update, backup, apply = false }) {
  const draft = packet.find(row => row.listing_code === 'GH-645' && row.id === listingId);
  if (!draft || draft.uploads.length !== 14 || !draft.uploads.every(photo => photo.same_creator && !photo.referenced &&
    photo.path.startsWith(`properties/listings/${listingId}/`) && photo.object_id && photo.version && photo.etag && Number(photo.bytes) > 0) ||
    new Set(draft.uploads.map(photo => photo.path)).size !== 14) throw new Error('The manifest must contain the 14 independently verified GH-645 uploads.');
  const uploads = [...draft.uploads].sort((a, b) => Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at) || a.path.localeCompare(b.path));
  const images = uploads.map(photo => propertyPhotoUrl(PROPERTY_IMAGE_ORIGIN, photo.path));
  const image_filenames = Object.fromEntries(uploads.map((photo, i) => [imageFilenameKey(images[i]),
    imageOriginalFilename(photo.original_filename || photo.path.split('/').at(-1))]));
  const before = await read(listingId);
  if (!before || before.id !== listingId || before.listing_code !== 'GH-645' || before.status !== 'draft' ||
    !sameListingVersion(before.created_at, draft.created_at)) throw new Error('GH-645 no longer matches the reviewed draft.');
  const attached = row => row?.id === listingId && row.status === 'draft' && sameListingVersion(row.created_at, before.created_at) &&
    sameJson(row.images, images) && sameJson(row.image_filenames, image_filenames) && sameJson(row.image_metadata, before.image_metadata);
  if (!attached(before) && (!sameListingVersion(before.updated_at, draft.updated_at) || before.images.length ||
    !sameJson(before.image_filenames, {}) || !sameJson(before.image_metadata, {}))) throw new Error('The draft or gallery changed. Review the current state before recovering photos.');

  for (const photo of uploads) {
    const object = await info(photo.path);
    if (!object || object.name !== photo.path || object.bucketId !== bucket || object.id !== photo.object_id ||
      object.version !== photo.version || normalizeEtag(object.etag) !== photo.etag || object.contentType !== photo.mime ||
      object.size !== Number(photo.bytes)) throw new Error('A reviewed Storage identity changed or could not be read. The gallery update stopped.');
  }
  if (attached(before)) return {status:'already-attached',photos:images.length};
  if (!apply) return {status:'verified',photos:images.length};
  await backup(before);
  try {
    await update(listingId, before.updated_at, {images,image_filenames});
  } catch { /* The conditional write may have committed before a transport failure. Read back once. */ }
  if (!attached(await read(listingId))) throw new Error('The gallery update could not be confirmed. Check the current draft before retrying.');
  return {status:'attached',photos:images.length};
}

async function main() {
  const [manifest, flag] = process.argv.slice(2);
  if (!manifest || !['--verify','--apply'].includes(flag) || process.argv.length !== 4) {
    throw new Error('Usage: node scripts/recover-listing-gallery.mjs <reviewed manifest> --verify|--apply');
  }
  const {GARY_MEDIA_PUBLISHABLE_KEY:key,GARY_MEDIA_OWNER_TOKEN:token}=process.env;
  if (!key || !token) throw new Error('Set the existing Home publishable key and authenticated Owner session in this terminal.');
  const packet = JSON.parse(await readFile(manifest,'utf8'));
  const transport = storageStages({key,token});
  await transport.owner(listingId);
  const db = createClient(PROPERTY_IMAGE_ORIGIN,key,{accessToken:async()=>token,global:{fetch:(url,init)=>fetch(url,
    {...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15_000)})}});
  const read = async id => {
    const {data,error}=await db.from('properties').select(select).eq('id',id).maybeSingle();
    if (error) throw new Error('The authenticated listing read failed. Verify the current Owner session and connectivity.');
    return data;
  };
  const info = async path => (await db.storage.from(bucket).info(path)).data;
  // The guarded update rechecks the saved draft and version before writing gallery fields.
  const update = async (id,version,changes) => {
    const {error}=await db.from('properties').update(changes).eq('id',id).eq('status','draft')
      .eq('updated_at',version).eq('images','{}').select('id').maybeSingle();
    if (error) throw new Error('The conditional gallery write was rejected.');
  };
  const backup = async before => writeFile(`${manifest}.GH-645.before-${Date.now()}.json`,JSON.stringify(before,null,2)+'\n',{mode:0o600,flag:'wx'});
  const result=await recoverGallery({packet,read,info,update,backup,apply:flag==='--apply'});
  console.log(`GH-645 ${result.status}. Photos confirmed: ${result.photos}.`);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error instanceof Error?error.message:'Gallery recovery could not be confirmed.');process.exitCode=1;});
}
