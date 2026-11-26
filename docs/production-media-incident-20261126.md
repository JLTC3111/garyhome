# Gary Home listing and storage incident, 26 November 2026

## Production evidence

The audit inspected all 93 saved listings. The 82 covers and 1,174 saved gallery links all resolve to current image records in `property-media`. Their saved URLs use the public object path. The 509 WebP replacements match the object IDs, versions, ETags and MIME types in their completed retirement receipts. A catalogue check establishes the referenced object identity. HTTP delivery at a given public URL still needs a direct check when a broken image is reported.

Six Storage GETs returned HTTP 400 for retired originals after their recorded removals. Five requests identified their user agent as Googlebot and map to **GH-643**. One browser user-agent request maps to **GH-01**. The logs had no referrer for these requests. Both listings are currently published and reference their existing WebP replacements. The six old keys are absent from the live reference index. The same log window showed zero 401, 403 or 404 responses on this public object route and no property-media image-transform requests.

The 11 drafts with empty galleries have November 26 creation receipts attributed to two staff accounts. Their UUIDs are outside the 509-item map and the recorded media rename and deletion jobs. The audit found no same-title saved listing, same-code deletion receipt or matching deleted-listing snapshot for this group. The listing UI uses the first saved gallery link for the thumbnail. The deployed empty-draft path requested a generic asset via Next Image.

The per-listing audit is `work/property-media-audit-20261125.1T3KYQ/production-listing-recovery-20261126.json`. It contains listing UUIDs, recorded creation times, save versions and the precise IDs, paths, versions and ETags of the completed uploads. No image downloads were needed for this audit.

| Listing | Recovery |
| --- | --- |
| GH-645 | Fourteen completed uploads are scoped to its UUID and belong to its recorded creator. Review those files with that editor before attaching the intended gallery. |
| GH-56 | Two completed uploads are scoped to its UUID. Their uploader differs from the recorded creator. Confirm custody and intended use before attaching either. |
| GH-57, GH-618, GH-639, GH-59, GH-60, GH-579, GH-357, GH-634, GH-506 | The saved gallery is empty and the audit found no completed listing-scoped upload or WebP backup tied to these UUIDs. Obtain verified originals and the intended order from the responsible editor. Keep the draft when an approved source is unavailable. |

For GH-643 and GH-01, first fetch fresh listing pages and check that the rendered cover and gallery use the current WebP keys. A HEAD of the replacement URLs checks HTTP status and `Content-Type` without transferring images. Compare any reported failing URL with the failed keys and retirement times in the audit. If a current page still emits an old key, capture its URL, response cache headers and the exact old key before changing any reference. Those two current galleries already contain their replacements.

## Upload and save incident

GH-645's 14 files completed between 01:53:29 and 01:54:12 UTC on November 26. The properties POST returned 201 in the 01:55:12 UTC window, and the creation receipt identifies the same staff account as the uploads. The original insert has an empty gallery. GH-56's two uploads preceded its later update at 05:45 UTC and belong to a different staff account than its recorded creator. There were zero application upload-lease records for these 11 drafts. For the other nine, the catalogue had zero matching objects, leases, multipart entries or unscoped filename-code hints.

The uploader saves the object through resumable Storage and the editor receives the URL on success. The previous editor held that URL, ordering and photo fields in memory until the explicit listing save. There was no listing autosave. Drafts could be saved with a blank gallery, and closing the editor lost its in-memory changes. The API evidence shows the completed uploads and subsequent empty save. It does not record the editor interaction or POST body that led to that state.

The current lease RPC protects resumable uploads for 24 hours and renews during long sessions. The upload watchdog allows continued progress and stops after 120 seconds of inactivity. Listing JSON calls have a 20-second application deadline and a 15-second transport deadline. When a listing response is interrupted, the new editor does one version-aware read to check the submitted record. It keeps the edits open if the write cannot be confirmed. The user can resume gallery order, names, captions, alt text and pending upload paths on the same device. Pending files are checked through Storage metadata before entering the recovered gallery. Files remain staged until a normal listing save confirms their references. The checkpoint covers the gallery. It cannot follow a user to another device or survive clearing this site's browser storage.

The [orphan reconciliation](../work/property-media-audit-20261125.1T3KYQ/orphan-reconciliation-20261126.json) matches all 617 original candidates by Storage ID and version. They total 424,989,619 bytes and remain held. The 17 additional photos total 3,767,853 bytes and include 14 for GH-645, two held for GH-56 and one unscoped object. The five additional video candidates total 47,831,068 bytes. Four have published listing-scoped paths. The live reference index flags candidates for review, and permanent cleanup stays paused.

## Apply the GH-645 gallery recovery

Use the existing authenticated Home Owner session and publishable key from the approved media operation. From the Home checkout, use the private `gallery-recovery-packet-20261126.json` in the existing audit directory. The command checks 14 Storage identities and the saved listing version through metadata requests. It attaches in upload completion order, matching the sequential uploader. The first photo becomes the cover. The original gallery had no recorded caption, alt text or order to restore.

```sh
GARY_GALLERY_PACKET=work/property-media-audit-20261125.1T3KYQ/gallery-recovery-packet-20261126.json
# Use the existing GARY_MEDIA_PUBLISHABLE_KEY and active GARY_MEDIA_OWNER_TOKEN.
node scripts/recover-listing-gallery.mjs "$GARY_GALLERY_PACKET" --verify
node scripts/recover-listing-gallery.mjs "$GARY_GALLERY_PACKET" --apply
node scripts/recover-listing-gallery.mjs "$GARY_GALLERY_PACKET" --verify
```

In zsh, `read -rs 'GARY_MEDIA_OWNER_TOKEN?Home Owner session token: '` accepts the existing user token without echo. Export it only for the command and unset it afterward. The tool checks the protected Owner RPC before contacting the write path. It keeps a mode 0600 copy of the pre-update gallery fields next to the manifest. `--apply` updates the known GUID, Draft state and exact version conditionally through the authorized Data API. The last `--verify` should report `already-attached` and 14 photos. Preserve GH-56's record and objects until the creator and uploader confirm custody. The packet includes both identities for that review.

Release the reviewed Home frontend through the existing Vercel project. Gallery checkpoints use the deployed upload lease and normal listing save, so this workflow needs no additional Home SQL. In an approved test listing, interrupt an upload, reload, resume the gallery, and save. Confirm that the preserved order and metadata match the saved row. Simulate a failed save response and a newer conflicting gallery in the test environment. An ambiguous response must leave the editable gallery available. Verify the deployed revision and read GH-645's status, creation date and gallery after the authorized repair. Keep the bulk cleanup gate off during this verification.

## Reference-only recovery

1. Locate the exact existing UUID in the audit. Before editing, export that record's current fields and check its current `updated_at`, status, creation date and recorded creator. The file path is evidence of custody only after the uploader and intended listing have been confirmed.
2. For each selected file, recheck its current Storage key, ID, version, ETag and MIME type against the evidence. A HEAD of a specific approved public object URL can check current HTTP delivery without an image transfer. Reuse its validated public object URL. Confirm order, captions and alt text with the editor. A filesystem name or upload order supplies no description or placement evidence.
3. Apply only the approved gallery fields to that exact existing draft. Use the existing staff session and the normal listing workflow. For a reference-only API repair, the existing authorized Supabase client can use the following optimistic update. Supply the reviewed photo metadata and retain unrelated saved metadata. Stop on a changed version or an empty result.

   ```js
   const { data, error } = await homeStaffClient.from('properties')
     .update({ images: approvedPublicUrls, image_filenames: reviewedNames, image_metadata: reviewedPhotoMetadata })
     .eq('id', reviewedListingId)
     .eq('status', 'draft')
     .eq('updated_at', reviewedUpdatedAt)
     .eq('images', '{}')
     .select('id, status, created_at, images, image_filenames, image_metadata')
     .maybeSingle()
   if (error || !data) throw new Error('Refresh the current draft and review the changes.')
   ```

4. Re-read the saved gallery, order and owner provenance. Confirm the new cover and approved gallery URLs and check that the row is still a draft. Publication can go through the usual editorial approval after recovery.

## Storage panel rollout while deletion stays paused

Production already has the Home retention tables, Owner RPC and cleanup gate. The gate is disabled. Cron has no job catalogue, and three observed calls to `media-orphan-cleanup` returned 404. The deployed admin route forwarded inventory requests to that missing function. Its existing error handler converted the upstream response into a generic failure.

The live inventory contains 1,809 photo objects (708,518,928 bytes) and six video objects (68,409,369 bytes). The index flagged 634 photos and five videos without an indexed reference. The retention queue had no verified removals or completed cleanup runs. The potential counts include objects awaiting individual review, and the original 617-file audit stays paused.

The admin route now sends status, scan, soft staging and restore directly to the Owner RPC. Existing authenticated Owner checks remain in the route and database. Permanent requests still use the Edge worker.

1. Check the current production baseline through the approved database operator connection.

   ```sql
   select to_regprocedure('public.home_media_management(text,uuid,integer)') as owner_rpc,
          to_regclass('cron.job') as cron_catalog;
   select permanent_enabled, last_scan_at from private.home_media_control where singleton;
   ```

2. Review and manually run the diagnostics-only migration on the Home project's existing retention installation. It adds the scheduled status and classified inventory totals to the existing RPC and leaves the permanent gate paused.

   ```sh
   export PGSERVICE=gary-home-media
   psql -X -w -d "service=$PGSERVICE sslmode=verify-full" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20261126114500_home_media_inventory_diagnostics.sql
   ```

3. Deploy the reviewed Home revision to the existing Vercel project serving `garyhome.vn` and `staff.garyhome.vn`. The route and UI can also ship before the diagnostics migration for basic inventory, scan and File Trash access. Under the protected Owner session, open Properties → Storage & Media Management and run the scan. Verify the checked time, scan time, held and verified counts, File Trash and cleanup history. An authenticated non-Owner request to `POST /api/admin/storage-media` with `{"action":"status"}` must receive 403. These actions use the deployed RPC independent of the worker.
4. Once the listing discrepancies and delivery checks are closed, follow the coordinated activation for permanent operations in [Home media retention](home-media-retention.md). This stage uses the exact project and worker credentials procedure. Keep the permanent gate off and leave the schedule unscheduled during the inventory rollout.
