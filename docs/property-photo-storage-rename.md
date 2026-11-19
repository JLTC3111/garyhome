# Gary Home property photo rename

## Reference model

The public `property-media` bucket contains listing uploads. `properties.images` stores URLs in display order, with the cover first. `image_filenames` and `image_metadata` use those URLs as keys. The public listing query, gallery, thumbnails, staff preview, and cover consumers read this ordered list. The November 19 read-only inventory found 667 listing references to the bucket and one Home hero reference. It found no saved transformation or query URLs among the listing references.

The migration rewrites every matching listing photo and map key, plus the known Home hero, neighbourhood, author, activity, editorial image and source links. It preserves positions, public filename approval, EN/VI descriptions and alt text, and saved derivative query options. The operation blocks on an ambiguous Storage origin or incompatible metadata alias. A copied object retains the original bytes and embedded watermarks. Supabase Copy preserves file metadata and uses insert-only behavior by default. [Supabase Copy Objects](https://supabase.com/docs/guides/storage/management/copy-move-objects) · [Storage copy implementation](https://github.com/supabase/storage/blob/master/src/http/routes/object/copyObject.ts)

Uploaded files now use `properties/<upload UUID>/<normalized basename>`. Existing photos renamed by an Admin or Owner move to `properties/renamed/<listing ID>/<normalized basename>`. The original upload filename remains part of its existing metadata. The new key becomes the actual image URL.

## Deploy and verify

1. Review [the migration](../supabase/migrations/20261119054408_property_photo_storage_rename.sql) with the Home operator. Confirm the filename and image metadata columns are present. Reconcile any manually applied migration history before running an automated migration tool.
2. Apply the reviewed migration, then deploy the Home route and editor together. The server uses the existing configured Supabase service credential. Normal direct uploads remain insert-only and service operations own updates and deletes in the property-media bucket. The preview lists candidate names for the current listing. Each rename requires a separate action.
3. In the approved test environment, use an isolated photo with a duplicated extension. Confirm that an Editor or Manager is denied, an Admin or Owner can rename, a collision leaves both objects intact, and the first photo keeps its cover position. Reopen the listing to check each caption, alt description, and original-filename setting in both locales. Check the new public URL and keep the original while judging any external use.

## Retention and rollback

- A reservation precedes the Storage copy. The server compares the source and destination SHA-256 digests and MIME type before an atomic reference update. A timeout or stale edit leaves the job in history. Reload the listing and retry the same name. If a staged destination has unexpected bytes, stop the worker or quiesce the route, confirm the job is unapplied and the destination is unreferenced, then use the Storage API for any separately approved staged-file removal. Preserve the reservation for retry.
- A successful rename retains the old public object. Raw URLs in emails, bookmarks, exports, or external pages can keep working during review. Removal is a separate confirmed action. The server checks known saved Home references, verifies the current replacement, and uses the Storage API to remove the old object. After removal, old raw URLs and derived requests that miss their caches can fail. Global external uses and cached copies cannot be enumerated. [Supabase CDN caching](https://supabase.com/docs/guides/storage/cdn/smart-cdn)
- To reverse a committed rename, pause the rename and cleanup route. Verify the original file and its digest. If already removed, restore it to the exact old key via the Storage API with collision protection before changing references. Reconcile the registry and reverse the still-current references in one separately reviewed transaction, preserving edits since the rename. Keep the replacement until the restored public listing is checked. The audit row identifies the keys, original listing, affected versions, actors, and removal state.

The rollout requires approval. Fixture verification uses an isolated database and simulated Storage. Hosted copy, cache eviction, and the rendered editor require an approved environment to verify.
