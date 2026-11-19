# Gary Home listing deletion and Storage cleanup

## Production audit

The read-only November 19, 2026 check covered `property-media` and `listing-videos` in `duyiihsmaqfgwezmsnjs`. The live `delete_property(uuid)` RPC deletes the property row for all three listing states. Its trigger preserves enquiry attribution and updates display ordering. The path leaves uploaded media in Storage. Both buckets reported `DISABLED` versioning with no archived versions or delete markers.

| Bucket | Evidence | Objects | Bytes | Proposed action |
| --- | --- | ---: | ---: | --- |
| `property-media` | Referenced by saved Home records | 716 | 450,947,666 | Keep. |
| `property-media` | Confirmed deleted-listing media through applied rename history | 3 | 673,721 | Review the exact allowlist and remove after approval. |
| `property-media` | Possible unused, replaced, or abandoned uploads. Listing ownership is ambiguous. | 584 | 403,832,134 | Keep until stronger evidence is available. |
| `listing-videos` | Referenced by saved Home records | 2 | 53,865,285 | Keep. |
| `listing-videos` | Possible unused or abandoned uploads. A listing UUID in the path is insufficient historical evidence. | 3 | 14,117,641 | Keep until prior listing ownership and removal can be verified. |

The audit verified zero orphaned videos and zero additional obsolete rename copies for surviving listings. All three verified objects relate to deleted listing `1de3e346-a4b0-4511-bd53-c911bd4953e4`. The applied rename records prove it was saved previously. Its row is now absent and the checked Home records contain zero references to the three keys. The original UUID object and two rename destinations are enumerated with exact observed object IDs and versions. [Reviewed candidate manifest](./listing-media-cleanup-verified.json)

The inventory checks saved Home listings in every state, content references, enquiries and their notes, feedback, assistance, and landlord submissions and attachments. It compares full Storage keys. A filename match, size match or staff uploader identity alone cannot establish ownership. External shared links, third-party sites, and other applications' records are outside this inventory. [Repeatable read-only audit query](../scripts/audit-property-media.sql)

## Permanent deletion

The Admin or Owner confirms the selected listing version. The guarded RPC takes a short, nonblocking snapshot lock and writes the verified object identities, size and ownership evidence before deleting the row in the same transaction. It preserves existing enquiry, landlord and assistance history and protects any object with a remaining saved reference. Archiving stays a status change and keeps the files. Unclear ownership is recorded as retained. The old raw listing DELETE and legacy RPC are denied so that a listing cannot bypass the manifest.

The server holds the privileged credential and removes eligible immutable objects with Supabase Storage. It rechecks current references, object identity and bucket versioning before dispatch. **Listing media cleanup** displays jobs after reload and supports retry. A removal requires both an API acknowledgement for that key and catalogue absence. An empty catalogue with an unacknowledged delete stays under review because a transport failure may have occurred between catalogue and provider cleanup. The code stores enough information to reconcile with the provider's removal event or support. [Supabase Delete Objects](https://supabase.com/docs/guides/storage/management/delete-objects) · [Storage deletion implementation](https://github.com/supabase/storage/blob/master/src/storage/object.ts)

New listing photos have a listing UUID in their path. Existing app-generated gallery keys and applied rename chains remain supported. The snapshot and upload guards coordinate with the Storage catalogue, reject writes to retired keys, and give at most one server request a claim to copy a reserved rename destination. An outstanding rename blocks deletion of its listing or its shared source. An unresolved copy can be checked again against the reserved destination. If provider logs and the catalogue cannot confirm its outcome, resolve the reservation under separate review. [Supabase upload finalization implementation](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts)

## Approval and release

1. Verify the existing filename, image metadata, rename, and rename-completion schema. Reconcile manually applied migration history and keep a restorable backup of the affected database and Storage assets. Review the [completion migration](../supabase/migrations/20261119095000_property_deletion_media_cleanup.sql). It changes no listing or Storage object during deployment.
2. Verify against disposable data on an isolated backend before production. Use the isolated project's origin in the media ownership checks and the existing video configuration. Exercise an actual resumable upload finishing during deletion and a copy in flight. Validate the hosted `remove()` acknowledgement for both buckets. PGlite and mocked Storage cover the application protocol only.
3. Coordinate the approved migration and Gary Home deployment. Drain the old rename requests and legacy listing uploads before switching traffic. Supabase resumable upload URLs can last 24 hours, so outstanding old sessions and unscoped upload keys need explicit cutover review. The legacy delete RPC is disabled when the migration commits. [Supabase resumable upload URL lifetime](https://supabase.com/docs/guides/storage/uploads/resumable-uploads#upload-url)
4. Rerun the read-only audit, review the three current IDs and versions, and obtain approval for that exact set. Review shared links and export or back up the objects if needed. The script previews the local allowlist by default. The execution path requires the exact listing UUID, a current Home Admin or Owner token supplied through the environment, and the deployed guarded API. It rejects a changed identity or new stored reference. [Reviewed cleanup script](../scripts/cleanup-reviewed-listing-media.mjs)
5. After approved execution, confirm the API reports three removals with zero pending or review and that the three keys are absent from the Storage catalogue. Recheck the read-only audit. The assessed database still contains no live Home links to scrub for this group. External direct URLs and cached derivatives can outlive the listing and stop resolving after removal or cache expiry.

The audit manifest preserves keys, sizes, attribution and attempts. Restoring a permanently deleted listing or object requires a backup. To roll back the release, pause deletion and cleanup and retain both manifests and retirement guards. A reviewed recovery can restore media first, verify the bytes, and then restore the listing and applicable relationships. Preserve already recorded removal outcomes and CRM history during recovery.
