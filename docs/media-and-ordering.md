# Media, messaging and card ordering — 23 October 2026

The rental search now has a bilingual **Find Your Rental / Tìm nhà cho thuê** heading. The established cream/green theme, hero composition and single Favourites shortlist are retained.

## Listing image uploads — 6 November 2026

Listing image and MP4 uploads use TUS with 6 MiB chunks, automatic network retry, actual byte progress and cancellation. A progressing upload can continue beyond two minutes; only 120 seconds without progress stops it and offers a retry. Failed-file retries resume the same destination using an upload URL kept in tab memory and scoped to the signed-in user. Normal page and account requests retain their shorter deadlines. The file bytes determine the supported image type, so valid JPEG/PNG/WebP/AVIF files with missing browser MIME information still upload correctly. Storage uses unique generated keys; original filenames do not determine permissions or object paths.

The listing editor shows full filenames, including extensions, below the thumbnails and names the affected file when an upload fails. Original basenames are stored in `properties.image_filenames` and follow cover changes, removal and reopening. Existing uploads without recorded originals display their complete stored URL filename and are explicitly labelled “Stored filename”; unrecoverable original names are never inferred from a listing title. Browser-preview image names use compact metadata keys instead of duplicating large data URLs.

## Supplied media and reorganized paths

- All moved apartment, cover, area and activity paths are mapped to the actual files. The `feeback` folder typo is corrected to `feedback`. Existing image bytes are preserved; no listing pictures or feedback text were generated.
- Existing CMS values and browser snapshots are normalized through `data/asset-paths.json`. Permanent image redirects preserve earlier URLs on deployment. The backend migration updates stored arrays without changing image order or listing identity, including the private review draft.
- Ten supplied customer photos are added to the six existing customer photos. The existing six renamed `activities/activity-*.jpg` files remain in Customers, preserving the previous requested categorization. The home page initially shows six photos and provides Show more; the full activities page includes all 16.
- The supplied review screenshot is classified as a screenshot under Feedback. Its preview contains the whole image and opens the existing accessible lightbox. Captions are bilingual and do not invent names, ratings or quotations.
- `public/svg/WhatsApp.svg` and `public/svg/Zalo.svg` are used in listing contacts and floating buttons, with visible service names and accessible link labels. Embedded source comments remain intact.
- WhatsApp uses the international destination `84363327342`; Zalo uses `0363327342`. Company settings and the company placeholder profile use the updated destinations. The separate telephone hotline is preserved.

Source information is maintained in [asset-sources.json](asset-sources.json). The path/contact/content migration is [20261023124900_media_paths_and_messaging.sql](../supabase/migrations/20261023124900_media_paths_and_messaging.sql).

## Arrange property cards

Sign in with an assigned **Owner**, **Administrator** or **Manager** account, then open the home page or rental listings page and choose **Arrange cards**. Drag rows or use the up/down buttons, then **Save order**. The first six entries in the home-page order appear in its property grid. The listing-page order is managed separately and applies to its default view; explicit price/newest sorting still works.

With no saved custom order, posts appear newest first. **Reset to newest first** clears the page's custom order. New/unarranged posts follow newest-first order after explicitly arranged cards. Publication time is recorded by Postgres when a listing is published; ordinary edits cannot forge that timestamp. Existing listings retain their original creation date as the initial publication time.

Owners and administrators can assign the new Manager role through Studio → Team access. Managers have the existing content workspace permissions plus ordering, and cannot manage staff accounts. Ordinary Staff and customer accounts cannot save orders, including through direct API calls. Company-domain, email-confirmation and bootstrap-owner checks remain in place.

The ordering migration is [20261023125023_card_ordering_manager_access.sql](../supabase/migrations/20261023125023_card_ordering_manager_access.sql). `property_display_orders` has public reads and role-restricted writes with RLS. Its invoker RPC validates current public rental IDs, rejects duplicates and detects stale concurrent saves. No privileged public definer function was introduced. The two ordering scopes are independent. Data setup and runtime reads require no new environment value.

## Verification

The 173-test suite covers moved-asset integrity, the supplied media categories, messaging number normalization, role enforcement, manager assignment restrictions, stale-write conflicts, publication timestamps, keyboard ordering and draft retention through translation, alongside the existing auth/gallery/session checks. Both production builds and TypeScript checks pass. Client artifacts are checked for actual server-secret values before publication.

Browser visual review and a local HTTP preview remain unavailable because this environment blocks binding preview ports. Component rendering, framework build artifacts, real Postgres policy tests and connected live-project checks provide the available verification. The existing hosted leaked-password-protection notice remains unchanged; see the [Auth security setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
