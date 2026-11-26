# Gary Group profile photos

This is a local release draft. Home, Visa and Teaching Jobs have independent photo permissions and buckets, even where they share Supabase Auth. The migration files use distinct versions for a shared migration history.

| App | Active reference | Read access and compatibility |
| --- | --- | --- |
| Home | `home_avatar_profiles` and the existing `staff_profiles.avatar_path` updated in one transaction | Staff keep their existing directory visibility. The public listing route uses the existing published-portrait RLS check. Legacy paths remain in `staff-avatars`. |
| Visa | `visa_avatar_profiles` | Customers can read their own avatar. Team Access retains its existing readers. An account with no record can still display its legacy `user-id/avatar` object. A removal has a record with an empty path. |
| Teaching Jobs | `jobs_avatar_profiles` | One private photo per authenticated identity for both portals. Only the identity can read or change it. Jobs recruitment records, vacancy images and CVs retain their existing storage and permissions. |

All three editors reuse Visa's center crop, keyboard and touch zoom, and square preview. The encoder produces a fresh WebP from pixels at a maximum of 512 × 512, keeps quality at or above 0.82, and reduces the output dimensions when necessary to fit within 100 KiB. Simple images can be smaller than 30 KB. The Edge handler checks the byte limit, dimensions and WebP chunks before upload. The browser displays the optimized crop and reports a successful save or removal after the backend confirms the current reference.

## Required for release

1. Check this draft against the hosted schema in an approved staging environment. Verify that Storage records the service-written `x-metadata` in `storage.objects.user_metadata`. Exercise the new read policies as the relevant Home staff, published and unpublished Home readers, Visa customer and Team Access identities, and Jobs staff and candidates. Check the supported browsers' WebP encoders and themes.
2. Coordinate a short photo-write cutover. Prepare the three frontends and Edge Functions together, then apply the three app migrations once in the target project's migration history. Home's existing path constraint stays in force. Removal deletes the photo row and clears linked listing portrait aliases in the same transaction. Legacy Home Storage becomes read-only for browser clients at this step, so open tabs using the old uploader need to reload.
3. Deploy `home-profile-avatar`, the updated `visa-profile-avatar`, `jobs-profile-avatar`, and the matching site code. Verify legacy display, replace/remove, Home listing publication, Visa public account menu and staff directory, and the same avatar in both Jobs portals. An older Visa tab needs the new client before it can save.
4. Enable bounded retry processing separately for each avatar function. The scheduled request is a POST to the function with the `cleanup` query parameter and the configured `x-avatar-cleanup-key` header. Keep the `PROFILE_AVATAR_CLEANUP_KEY` server-side. Each call claims up to eight files in that app's registry. Successful mutations also attempt cleanup for their own account. A scheduled request is necessary for orphan and deletion retries when no further mutation occurs.

A database reservation binds a unique path to the signed-in identity. The commit takes a per-identity lock, checks the expected revision, confirms the exact Storage receipt, and writes the new reference before making the old object eligible for deletion. Cleanup independently checks the reservation, receipt, and active references. Home also checks its staff row and retains any existing direct listing portrait reference. Claims prevent reattachment and are retried after the lease. If only the acknowledgement failed, the next claim can finish without another Storage delete. The cleanup worker never scans legacy buckets and leaves objects with missing or mismatched ownership receipts in place. [Storage deletion API](https://supabase.com/docs/guides/storage/management/delete-objects)

## Rollback

Pause the avatar endpoints' writes and scheduled cleanup first. Retain the migrations, buckets and compatible read paths while investigating. Existing references continue to resolve, including new private photos, Visa removals and Home listing portraits. Resume writes with the corrected handler. If any new references exist, a full return to the legacy-only readers requires a separately reviewed reference restoration and data preservation plan. Keep legacy objects and the new registries intact during that decision.

## Optional improvements

Add monitoring for expired reservations, repeated cleanup failures and ownership holds if operators need alerts. Any future review of legacy avatars requires a separate inventory and authorization. The draft keeps legacy objects outside automatic cleanup.

The browser editor and Edge handler are checked-in copies so that each repository can ship independently. Keep their behavior in sync when changing the crop or lifecycle.
