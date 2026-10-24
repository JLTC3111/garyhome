# Interface simplification — 23 October 2026

This update supersedes the corresponding interface choices in the initial rental redesign audit.

- Restored the cream, forest-green, sage and terracotta theme. The footer uses its previous dark slate palette. Messaging service buttons retain their service colours.
- Restored “Find a place. Feel at home.” and “Tìm một nơi. Gọi là nhà.”, the previous introduction, two-line Tech Text presentation, curved photo frame, floating note card and real listing count. The selected CMS cover image is preserved.
- Removed Villa/Duplex, Office & Restaurant and Vinhomes from the main and footer menus. Their recorded property types and catalogue filters remain available; no listings were deleted.
- Kept Favourites as the single shortlist. Cart buttons, header link, provider, page UI and batch enquiry submission are removed. `/cart` redirects permanently to `/saved`; direct per-property viewing requests remain available.
- Existing authenticated cart selections are copied to the same customer's favourites, without duplicates, before legacy cart access is revoked. Historical cart rows are preserved privately. Guest browser selections merge into browser favourites; failed storage writes preserve the original data. Importing browser favourites into an authenticated account still requires the customer's explicit import action.
- Removed short/long-term search controls and footer links. Older `term` query parameters are ignored so old links do not hide listings. Stored lease facts remain editable and can still appear on listings.
- Moved published photographs from Feedback into Customers. Customers is the default activities tab; Feedback remains available for actual review screenshots. Source provenance and assets are preserved, without invented reviews or identities.

The migration is [20261023120537_restore_hero_and_unify_favourites.sql](../supabase/migrations/20261023120537_restore_hero_and_unify_favourites.sql). It was applied to project `duyiihsmaqfgwezmsnjs`. Verification confirmed both restored headlines, the same cover image, six Customers photographs, zero Feedback photographs, disabled legacy cart access and 15 public rentals. Fresh setup and fallback content use the same configuration. No environment change is required.

Validation covers 157 passing tests, including guest data migration, customer ownership, duplicate handling, retired-cart permissions, live database settings/media checks and the existing session/gallery/language suite. Both framework builds and TypeScript checks pass. Direct English/Vietnamese component SSR checks cover the rendered hero, navigation, search and Customers photos; the legacy cart route uses Next.js’s permanent redirect to Favourites. The previous preview server was unavailable, and the environment denied binding a temporary test server (EPERM). Local HTTP and browser visual verification therefore remain unavailable in this session.

## Mobile header and account controls — 25 October 2026

The mobile upper band keeps the hotline and My Favourites in one row, with equal text size. Customer login, staff login and the EN/VN switch live inside the hamburger menu; desktop entry points remain in the upper band. The narrowest layouts use the same smaller text size for both labels.

Search uses an explicitly labelled monthly USD budget and no longer exposes Month/Week/Night. Legacy `period` query parameters are ignored. A monthly budget range matches monthly quotations only; stored weekly/nightly facts are preserved without guessing conversions. Mobile homescreen icons now use 180px and 192px PNG versions of the existing castle mark. The expanded mobile chat graphic stays transparent, with a thin outline and a divider between WhatsApp and Zalo.
