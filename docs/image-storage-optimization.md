# Image storage and bandwidth

## Uploads and delivery

| Application | Upload policy | Delivery |
| --- | --- | --- |
| Home property-media | Source up to 8 MiB. Aim for 240 KB, with a 500 KB encoded cap. Use 1920, 1600 or 1280 px on the long edge and preserve aspect ratio. | Use Next's optimizer for thumbnails from the public Storage object. Resolve old Supabase transformation URLs at display and SEO boundaries. Open the stored full-size rendition when requested. |
| Home staff avatars | Source up to 2 MiB. Aim for 45 KB, with a 100 KB cap and a long edge up to 384 px. | Retain the immutable per-upload URL and the current avatar visibility. |
| Visa editorial media | Source up to 5 MiB. Aim for 300 KB, with a 650 KB cap and a long edge up to 2400 px. | Keep lazy article cards and the five-minute public Storage browser TTL. |
| Visa avatars | Keep the 384 px square crop and zoom controls. Encode toward 45 KB, with a 100 KB cap. | Keep the existing private bucket and short-lived signed previews. Use lazy images in the staff roster. |
| Jobs CMS and vacancy images | Aim for 300 KB, with a 650 KB encoded cap and a long edge up to 2400 px. The existing 8 MiB CMS and 4 MiB vacancy source limits stay in place. | Cache new public CMS keys for one day. Vacancy images use lazy previews and the existing published-image endpoint with immediate revalidation. |

There is no browser transcoding for Visa documents, Home private submissions or videos, Jobs CVs, or private candidate portraits. Authorization and RLS continue to govern uploads. The Jobs vacancy Edge Function still validates, reserves and publishes images. Its existing JPEG and PNG fallback encoding can normalize embedded metadata. The WebP path avoids that second encode. Visa's reservation stores the actual transmitted MIME and byte size. A legacy reservation with the original MIME and size can still use its original file. For an interrupted optimized upload, use the original file in the same browser so it can reproduce the reserved rendition. If Storage already has the object, the existing registration action can verify it.

The browser keeps efficient originals and prefers WebP for compatible content. It can transfer standard PNG physical density to WebP EXIF and retain transparency. Output with portable JPEG metadata can stay JPEG. The processor retains EXIF, IPTC and JPEG comments in those JPEGs and corrects the EXIF display orientation and dimensions after resizing. Files with metadata that requires their original container, such as a color profile or XMP, can pass through within Home's 1,920 px and 500 KB caps. Larger protected files need a compatible smaller source. Browser output is decoded again and checked for dimensions and sampled pixel differences. Review fine detail and transparency on real pilot images, especially floor plans, dense interiors and the Jobs 4× crop. [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container)

Home, Visa and Jobs ship byte-identical copies of the standalone browser module to preserve independent deployments. Update the Home source and mirror it into each static app's dist directory when the optimizer changes.

## Proposed Storage limits

| Bucket | Current repository limit | Proposed after the pilot |
| --- | ---: | ---: |
| Home property-media | 8 MiB | 500,000 bytes. Keep 8 MiB until larger originals needed by the same-byte rename and rollback flows have been handled. |
| Home staff-avatars | 2 MiB | 100,000 bytes, after verifying every writer and rollback source. |
| Visa gary-cms-media | 5 MiB | 650,000 bytes after completing or retiring oversize pending reservations. |
| Visa gary-visa-avatars | 5 MiB | 100,000 bytes after the browser rollout. The avatar endpoint should enforce the same cap at that point. |
| Jobs jobs-media | 8 MiB | 650,000 bytes after all supported upload clients use the policy. |
| Jobs jobs-vacancy-images | 4 MiB | Keep 4 MiB while the existing server JPEG/PNG fallback is permitted. Revisit after that encoder has an output cap. |

Keep current bucket visibility, policies and MIME allowlists. Apply separately approved limits through the Storage bucket settings or Storage API, using exact byte values. Supabase separates per-bucket limits from the project's global upload limit. [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

## Inventory and local staging

Start with Home's read-only [inventory query](../scripts/inventory-property-images.sql). Export the JSON value of its inventory column. It records current object identity, version, ETag, metadata, matching galleries and protected rename or deletion state. A historical rename record provides no evidence that either object still exists. Reference sightings can include multiple fields in one record. Review references outside Home separately before approving an object, including archives, other apps, third-party links and exports.

```sh
node scripts/plan-property-image-optimization.mjs inventory.json
node scripts/plan-property-image-optimization.mjs inventory.json stage /path/to/private-workspace 10
```

The first command reads the local inventory. It queues PNGs at or above 500 KB from largest to smallest, followed by JPEGs at or above 500 KB. It skips smaller files, WebP and AVIF. It reports reference mismatches, protected objects, shared galleries, size/ETag duplicate hints and modeled savings. Keep the export in a private directory. Confirm duplicate candidates with SHA-256 before considering any consolidation.

For each separately approved backup, use the Storage API or S3 `GetObject` with the observed ETag as a precondition. Export originals to `backups/<token>.original` under the private workspace and save `backups/<token>.json` with `id`, `version`, `etag` and the original's `sha256`. The token comes from the inventory report. Keep an independent backup with the object key, body, system and user metadata, and the affected reference rows and their versions. Verify your recovery copy before staging.

The second command reads only those local files. It verifies the original checksum, encodes eligible PNG and JPEG photos as WebP, and can retain EXIF-bearing JPEGs in their original format. It compares sampled pixels at 192 and 720 px and holds files when the metadata or quality check fails. It writes candidates and checkpoints to `staged-v2/`, leaving earlier staging records available. Each checkpoint records the actual output MIME, bytes and SHA-256, scores, dimensions and a proposed Storage key with the correct extension. Reruns revalidate the output and reuse the proposed key. Run this phase with one writer per workspace. Older exports can stage files, but a fresh inventory must identify the current listing and version before a reference switch. This batch procedure covers Home. Visa and Jobs need independent reference audits that include CMS revisions and published snapshots.

## Proposed production procedure

1. Obtain approval for the exact inventory entries, backup egress budget, pilot size, and database operator. Review external references and test fine detail, color and transparency on the backed-up originals and staged renditions. Skip uncertain metadata or protected references.
2. Upload the reviewed file through the Storage API using its proposed listing-scoped key, actual MIME and the original user metadata. Use an authorized Home account and a create-only request. Read the new key through a fresh request, confirm its SHA-256 and MIME, and capture the Storage identity, version, ETag and bytes. Keep the original. Supabase documents conditional reads and no S3 versioning. [S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility)
3. In the approved maintenance session, load [the temporary SQL helper](../scripts/switch-optimized-property-photo.sql). It uses the rename and deletion snapshot lock. The Owner's normal rename API continues to require a byte-identical copy. The helper uses the operator's existing database privileges, checks both Storage identities, rejects existing rename or deletion history, and refuses a switch when another known reference uses the source or target. It replaces the listing gallery and rekeys the metadata and original-filename maps in one transaction. Old transformed URLs become direct public URLs while gallery order and descriptive fields are preserved.
4. Supply the reviewed listing ID and version plus the two identity JSON objects with `key`, `id`, `version`, `etag`, `bytes`, `mime` and `sha256`. In the same SQL session, call `pg_temp.switch_optimized_property_photo(listing_id, listing_version, original_identity, optimized_identity, false)` to preview. After explicit approval, call with `true` and record the returned snapshot in the private journal. Apply one switch per short transaction. Use the last confirmed version and preview again before switching another image on the same listing. After an interrupted response, compare the stored fields with the preview and recheck both objects before deciding whether a switch committed.
5. Keep both objects during the observation window. Verify the new URL, descriptions, alt text and ordering, then rerun the reference audit. To roll back, pass both identities in their original order, the last verified listing version, `false` to preview or `true` to apply, and the saved applied result as the sixth argument. Roll back multiple switches on one listing in reverse order. The helper restores the exact previous fields when the current image fields equal the recorded post-switch fields and both object identities still match. Original retirement needs separate approval and another reference audit. Historical external URLs may require retaining the original. [Smart CDN and browser caching](https://supabase.com/docs/guides/storage/cdn/smart-cdn)

## Estimates from the supplied inventory

Target the 784 files at or above 500 KB. They currently use 1,017.69 MB. At 200–250 KB per replacement, this group uses 156.80–196.00 MB, saving 821.69–860.89 MB after separately approved retirement. The property bucket would reach 424.55–463.75 MB with everything else held constant. The 395 files at or above 1 MB are part of that group. Processing that subset alone models savings of 644.40–664.15 MB. These estimates assume all members qualify. Shared references, richer metadata and ineligible formats can reduce savings. Keeping both versions increases storage during the observation window. A full backup read of the 784 targets transfers about 1.02 GB plus verification traffic.

At the same traffic mix, 1,000 full-size deliveries of the target group at 200–250 KB would transfer about 200–250 MB, compared with about 1,298 MB at its current average. Use per-key requests, bytes and cache HIT/MISS from comparable windows. Next derivatives and browser cache hits affect how much of this savings appears in Supabase totals. [Storage egress measurement](https://supabase.com/docs/guides/storage/serving/bandwidth)

## Local compression measurements

The inputs below were generated from three checked-in Home property photos. They exercise oversized inputs without retrieving production assets. Byte counts include encoded metadata.

| Fixture | Input | Output | Smaller | 720 px pixel RMSE |
| --- | ---: | ---: | ---: | ---: |
| Living room PNG | 3,327,303 B | 201,902 B WebP | 93.9% | 3.55 |
| Apartment PNG | 3,049,149 B | 236,338 B WebP | 92.2% | 3.55 |
| Studio high-quality JPEG | 1,219,630 B | 235,028 B WebP | 80.7% | 4.08 |

The three outputs averaged 224 KB. The original 351,947-byte repository JPEG was skipped by the batch cutoff. Visual quality and production eligibility need the approved pilot.
