# Portal help and visual onboarding

Customers can open **Customer account → How to use**. Staff can open **Staff Studio → Help & onboarding**. Both overview pages also have a “New here? Start with a guide” shortcut.

Eleven editable starter guides cover portal navigation, customer favourites, property-ID search, enquiries/viewings, feedback and attribution, staff profile/password changes, listing/media work, customer care, publishing, team access and owner-managed guides. Customer and staff content is separated. Higher-level staff procedures can require a minimum role.

## Main video walkthrough

Both help pages feature `home_website_manual.mp4` above the written guides. The existing private upload was verified against the Desktop original (18,920,648 bytes; matching multipart checksum) and its guide is published for **Everyone signed in**. The original file is not copied into the public website or the Git repository.

The custom player offers play/pause, a scrubber, 10-second skips, volume, playback speed and fullscreen (including native iPhone fullscreen where supported). It loads metadata only and never autoplays. Space/K, left/right arrows, M and F work while the player itself is focused; these shortcuts leave form inputs alone. Mobile controls wrap to fit smaller screens. Labels follow the portal language without restarting playback; the recording remains in its original language.

The player obtains one 15-minute signed URL when the help page opens. Signing uses a bounded request with the already-ready session, preserving the session-loop fix in `portal-help.tsx`. If access expires while idle, **Reload video** renews it and retains the playhead, volume and speed. Signing out or changing account clears the viewer. Written guides and owner editing/upload controls continue to work below it.

To replace the featured recording, use **Manage guides**, unpublish the manual, replace its video with a file named `home_website_manual.mp4`, keep its audience **Everyone signed in**, then republish. An unpublished or staff-only recording is never featured for everyone. This is existing library content; no new database migration or environment variable is needed.

## Owner workflow

1. Sign in to Staff Studio as the **Owner**, then open **Help & onboarding**.
2. Choose **Manage guides** to see published guides and private drafts across both audiences.
3. Select **Add guide**. This creates a private draft immediately. Add English/Vietnamese titles, summaries and written steps. Written steps can also contain a transcript of an uploaded video.
4. Choose **Customers**, **Staff**, or **Everyone signed in**. Staff-only guides can be limited to Staff+, Manager+, Administrator+ or Owner only.
5. Use **Upload files** for videos, animations, PDFs or screenshots. Uploads are saved to the draft; confirm they are listed before leaving. The text is saved with **Save draft** / **Save changes**.
6. Check the guide in the library, then **Publish guide** to share it with the selected audience. **Unpublish** returns it to a private draft.
7. Before adding files to an already published guide, select **Unpublish**, then reopen its draft. New uploads can then be reviewed privately before republishing. Use the guide’s edit/delete controls to maintain the library. Only Owner has these controls and database permissions. Administrators and managers cannot upload or publish guides.

Supported files: MP4, WebM, MOV, GIF, WebP, PNG/APNG, JPEG and PDF. Limit: **50 MB per file, 12 files per guide**. MP4/WebM offer broader browser playback support; the original remains downloadable if a particular codec cannot play. Animations have explicit play/stop controls; videos do not autoplay. Mobile PDF viewing includes Open file and Download fallbacks.

For accessible walkthroughs, include written steps or a transcript in both languages and use captions in spoken videos. Uploading a video does not generate captions or translate it automatically.

## Upload and edit recovery

- Large files use TUS resumable uploads with 6 MB chunks, progress, bounded retries and cancellation. Interrupted chunks resume while the page remains open. Navigating away cancels the active transfer; select unfinished files again after returning.
- Upload progress never stores JWTs or upload fingerprints in browser storage. Each request obtains the current account token, and credentials are bound to the matching Supabase client/project.
- A guide version is checked when an upload is attached. An audience/text edit in another tab cannot silently redirect a file to a different audience. Review the latest guide before retrying a conflict.
- Text edits use an optimistic timestamp check. A stale editor cannot overwrite a newer save. Switching interface language preserves the open draft and media viewer.
- Previously completed files remain attached if a later upload is cancelled or fails. Refresh before reselecting files after an uncertain response. Metadata writes are not automatically replayed.
- On an uncertain attachment insert, cleanup first checks whether the metadata committed. It will not delete a possibly linked file.
- Removing the last visual file automatically unpublishes a guide without complete bilingual written instructions. Deleted metadata removes viewer access before physical file cleanup. If Storage cleanup cannot be confirmed, the UI reports it; unlinked objects remain owner-only and can be inspected in the `portal-guides` bucket.

## Database and Storage

The migration `20261028085344_portal_help_and_onboarding.sql` is already applied to Supabase project **`duyiihsmaqfgwezmsnjs`**. It is also included in `supabase/setup.sql` for fresh projects. Do not rerun the complete setup file on the existing project.

- `portal_guides`: bilingual text, audience, minimum staff role, publication and display order.
- `portal_guide_files`: attachment metadata and the guide version expected when uploading.
- Private Storage bucket `portal-guides`: approved MIME types and a 50 MB bucket file limit.
- RLS enforces owner-only writes and audience/role-aware reads. Restrictive Storage guards scope their effects to this bucket and prevent unrelated permissive policies from exposing the library.
- Files are opened on demand using **15-minute signed URLs**. Sharing such a URL grants temporary access until expiry; it is not DRM. The viewer clears on account/role changes, and new access checks use current membership.
- No server/service key or additional environment variable is required by the frontend.

Live verification confirmed the manual, attachment and Storage object are readable by a signed-in customer, while anonymous table access remains blocked. The bucket remains private. Database policy tests additionally cover lower roles, revoked membership, unrelated broad Storage policies, stale upload versions, and attachment limits.

## Apartment / post ID search

The homepage and rental listing filters now show **Apartment / Post ID** without opening Custom Requirements. Search accepts `GH-000005`, `gh000005`, `GH 000005`, `000005` or `5`, while retaining exact full UUID compatibility. IDs combine with the other selected filters and never reveal unpublished/rented/sold listings.

Supabase references: [resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control).
