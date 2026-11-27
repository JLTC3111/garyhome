import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { addImageFilename } from '../lib/image-filenames.ts';
import { listingGallery, normalizeListingVersion, sameJson, sameListingVersion } from '../lib/listing-gallery-checkpoint.ts';
import { PROPERTY_IMAGE_BUCKET, PROPERTY_IMAGE_ORIGIN, propertyPhotoPath } from '../lib/property-photo-files.ts';
import { homeOwnerSession } from './property-media-session.mjs';

const focus = [
  { code: 'GH-645', id: '003be3a7-963d-4e2c-911d-90774a70fe44', count: 14 },
  { code: 'GH-56', id: '198b8547-8614-4a8e-b125-7e6d9846df57', count: 2 },
];
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const cleanTag = value => value?.replace(/^"|"$/g, '');
const snapshotPath = fileURLToPath(new URL('../work/property-media-audit-20261125.1T3KYQ/gallery-recovery-packet-20261126.json', import.meta.url));

function auditedListing(packet, { code, id, count }) {
  const draft = packet.find(row => row.listing_code === code && row.id === id);
  if (draft?.status !== 'draft' || draft.gallery !== 0 || draft.uploads?.length !== count ||
      !Number.isFinite(Date.parse(draft.created_at)) || !Number.isFinite(Date.parse(draft.updated_at))) {
    throw new Error(`The recovery packet does not match the audited ${code} draft.`);
  }
  if (code === 'GH-645' && (draft.blank_filenames !== true || draft.blank_metadata !== true)) {
    throw new Error('The GH-645 recovery packet must confirm empty filename and metadata fields.');
  }
  const photos = draft.uploads.map(upload => {
    const key = upload.path;
    const bytes = Number(upload.bytes);
    const etag = cleanTag(upload.etag);
    if (typeof key !== 'string' || !key.startsWith(`properties/listings/${id}/`) ||
        !uuid.test(upload.object_id) || !uuid.test(upload.version) || !/^[a-f\d]{32}(?:-\d+)?$/i.test(etag) ||
        !Number.isSafeInteger(bytes) || bytes < 1 || !/^image\/(?:jpeg|png|webp|avif)$/.test(upload.mime) ||
        !Number.isFinite(Date.parse(upload.uploaded_at)) ||
        (code === 'GH-645' && (upload.same_creator !== true || upload.referenced !== false || !upload.original_filename))) {
      throw new Error(`The ${code} upload identity is incomplete.`);
    }
    const url = `${PROPERTY_IMAGE_ORIGIN}/storage/v1/object/public/${PROPERTY_IMAGE_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`;
    if (propertyPhotoPath(url) !== key) throw new Error(`The ${code} upload path cannot be safely resolved.`);
    return { bucket: PROPERTY_IMAGE_BUCKET, key, objectId: upload.object_id, version: upload.version,
      bytes, etag, url, filename: upload.original_filename, mime: upload.mime, uploaded: upload.uploaded_at };
  }).sort((a, b) => a.uploaded.localeCompare(b.uploaded) || a.key.localeCompare(b.key));
  if (new Set(photos.map(photo => photo.key)).size !== count) throw new Error(`The ${code} packet repeats an upload.`);
  return { draft, photos };
}

const check = (expected, actual, matches = sameJson(expected, actual)) => ({ expected, actual: actual ?? null, matches });
const allMatch = checks => Object.values(checks).every(field => field.matches);

function timestampCheck(expected, actual) {
  const describe = raw => ({ raw: raw ?? null, normalized: normalizeListingVersion(raw) });
  return check(describe(expected), describe(actual), typeof actual === 'string' && sameListingVersion(expected, actual));
}

function describeImages(images) {
  if (Array.isArray(images)) return { type: 'array', count: images.length, contents: images };
  return { type: images === null ? 'null' : typeof images, count: null, contents: images ?? null };
}

function galleryMapCheck(expected, raw, comparedAs) {
  return { ...check(expected, raw, sameJson(expected, comparedAs)), ...(raw !== comparedAs && { comparedAs }) };
}

function draftIdentityChecks(draft, saved) {
  return {
    id: check(draft.id, saved.id),
    listing_code: check(draft.listing_code, saved.listing_code),
    status: check(draft.status, saved.status),
    created_at: timestampCheck(draft.created_at, saved.created_at),
  };
}

export async function recoverAuditedDraftGallery(packet, api, apply = false) {
  const [recovery, protectedDraft] = focus.map(target => auditedListing(packet, target));
  const page = await api.review({ action: 'orphan_page', offset: 0 });
  if (page.available !== true || !Array.isArray(page.items)) throw new Error('The signed Owner inventory page could not be confirmed.');

  for (const { draft, photos } of [recovery, protectedDraft]) {
    for (const { bucket, key, objectId, version, bytes, etag } of photos) {
      const answer = await api.review({ action: 'orphan_verify', bucket, key, objectId, version, bytes, etag });
      if (answer.result !== 'listing') throw new Error(`A ${draft.listing_code} upload changed protection or identity. Review the file before continuing.`);
    }
  }
  for (const photo of recovery.photos) await api.verifyDelivery(photo);

  const { draft, photos } = recovery;
  // The packet's blank flags attest to empty objects in the saved row.
  const baseline = { images: [], image_filenames: {}, image_metadata: {} };
  const gallery = { ...baseline, images: photos.map(photo => photo.url), image_filenames: photos.reduce(
    (names, photo) => addImageFilename(names, photo.url, photo.filename), baseline.image_filenames) };
  const saved = await api.readListing(draft.id);
  const savedGallery = listingGallery(saved);
  const identity = draftIdentityChecks(draft, saved);
  const checks = {
    ...identity,
    updated_at: timestampCheck(draft.updated_at, saved.updated_at),
    images: check(describeImages(baseline.images), describeImages(saved.images)),
    image_filenames: galleryMapCheck(baseline.image_filenames, saved.image_filenames, savedGallery.image_filenames),
    image_metadata: galleryMapCheck(baseline.image_metadata, saved.image_metadata, savedGallery.image_metadata),
  };
  const preconditions = {
    recoveryPacket: {
      path: snapshotPath, expectedRecordVersion: checks.updated_at.expected,
      blank_filenames: draft.blank_filenames, blank_metadata: draft.blank_metadata,
    },
    checks,
  };
  const report = { ownerPageRows: page.items.length, ownerPageHasMore: page.hasMore, GH56Protected: protectedDraft.photos.length,
    GH645IdentitiesVerified: photos.length, GH645Restored: false, ...(!apply && { preconditions }) };
  if (allMatch(identity) && sameJson(savedGallery, gallery)) return { ...report, GH645Restored: true };
  if (!allMatch(checks)) {
    throw new Error(`The GH-645 draft failed recovery preconditions.\n${JSON.stringify(preconditions, null, 2)}`);
  }
  if (!apply) return report;
  let failure;
  try {
    await api.saveGallery(saved, gallery);
  } catch (error) {
    failure = error;
  }
  const confirmed = await api.readListing(draft.id);
  if (!allMatch(draftIdentityChecks(draft, confirmed)) || !sameJson(listingGallery(confirmed), gallery)) {
    throw failure ?? new Error('The GH-645 gallery could not be confirmed. Check the saved listing before retrying.');
  }
  return { ...report, GH645Restored: true };
}

function recoveryApi({ GARY_MEDIA_PUBLISHABLE_KEY: key, GARY_MEDIA_OWNER_TOKEN: token }) {
  const auth = { Authorization: `Bearer ${token}` };
  const db = createClient(PROPERTY_IMAGE_ORIGIN, key, { global: { headers: auth },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return {
    async review(input) {
      const response = await fetch('https://staff.garyhome.vn/api/admin/storage-media', { method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`The signed Owner review request returned HTTP ${response.status}.`);
      }
      return response.json();
    },
    async verifyDelivery(photo) {
      const response = await fetch(photo.url, { method: 'HEAD', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok || response.headers.get('content-length') !== String(photo.bytes) ||
          cleanTag(response.headers.get('etag')) !== photo.etag || response.headers.get('content-type')?.split(';')[0] !== photo.mime) {
        throw new Error('An audited GH-645 photo did not match the current Storage delivery headers.');
      }
    },
    async readListing(id) {
      const { data, error } = await db.from('properties').select('id,listing_code,status,created_at,updated_at,images,image_filenames,image_metadata')
        .eq('id', id).abortSignal(AbortSignal.timeout(15_000)).maybeSingle();
      if (error || !data) throw new Error('The existing GH-645 listing could not be read with this Owner session.');
      return data;
    },
    async saveGallery(listing, gallery) {
      const { error, status } = await db.from('properties').update(gallery).eq('id', listing.id).eq('listing_code', 'GH-645')
        .eq('status', 'draft').eq('updated_at', listing.updated_at).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw new Error(`The GH-645 save returned HTTP ${status}. The saved gallery could not be confirmed.`);
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length && !['--diagnose', '--apply'].includes(args[0]))) {
      throw new Error('Use --diagnose for the read-only report or --apply to recover the gallery.');
    }
    const apply = args[0] === '--apply';
    const packet = JSON.parse(await readFile(snapshotPath, 'utf8'));
    const connect = await homeOwnerSession({ env: process.env, connect: recoveryApi });
    console.log(JSON.stringify(await recoverAuditedDraftGallery(packet, await connect(), apply), null, apply ? 0 : 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The draft recovery could not be confirmed.');
    process.exitCode = 1;
  }
}
