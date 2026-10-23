# Rental redesign and audit — 23 October 2026

The existing Next.js/Vinext, React and Supabase architecture is retained. The Vercel build still uses `npm run build:vercel`; Sites uses `npm run build`. No new framework, database service or social authentication was introduced.

## Implemented

- White/navy branding with orange accents, the original Gary Home castle logo, a prominent hotline and bilingual navigation. Apartments have district submenus; Villa/Duplex, Office & Restaurant, Vinhomes, Team Activities and Feedback have working destinations. Customer and staff access remain separate.
- A rental-only homepage with the requested English headline and a Vietnamese equivalent. Sale controls and old promotional/partner sections are removed. Legacy sale values remain supported privately in the database; public reads and policies exclude them.
- Short-term and Long-term rental choices, plus an Any duration reset. Filters cover district, four property groups, bedrooms, bathrooms, minimum/maximum USD price, price period, exact property ID, keywords and multiple required amenities. Existing custom, keyboard-accessible selects are reused.
- Responsive cards with image navigation, visible permanent `GH-` IDs, favourites and cart controls. Detail pages have thumbnails, a fullscreen native-dialog gallery, failure placeholders, keyboard navigation, focus return and scrolling cleanup.
- My Favourites is back in the upper band with a labelled dropdown dialog, saved-item links, prices and removal controls. Its heart icon appears for signed-in users only.
- Guest viewing carts persist in the current browser. Signed-in carts use customer-owned Supabase rows and persist across devices. Cart additions reserve space during pending writes; up to 12 properties can be submitted together. One database INSERT makes a batch request atomic. A viewing request does not reserve or pay for a property.
- Public listing contact profiles support portrait, bilingual biography, phone, email, WhatsApp and Zalo. They are separate from private staff Auth assignments. The approved company number `+84 356 175 046` is used for both messaging services and the floating contact buttons.
- Property descriptions use Property Information, Overview, Location & Nearby, and Furnishings & Facilities. Missing facts remain requests for confirmation. No Rooms or Materials editor fields are introduced.
- Generated bilingual listing titles use recorded property type, bedrooms, location, known area and confirmed optional amenities. Request-time metadata, social previews, real-estate JSON-LD, canonical URLs, sitemap, robots and translated page titles use public rental data. Missing properties return a real 404. Private portals, carts and saved lists are not indexed.
- Studio includes Authors & activities and the new rental/description fields. Approved public content, customer photographs, feedback media and team media can be edited independently of staff access. Existing form draft and session recovery behavior is retained.

## Findings addressed

| Finding | Change and evidence |
| --- | --- |
| Language started in English and restored browser preferences after paint. | A language cookie supplies SSR, `<html lang>` and metadata. The head bootstrap migrates legacy browser preferences before paint; a layout effect settles hydration and document titles. English and Vietnamese HTTP responses were checked. Forms are not keyed to language. |
| A changed gallery collection could leave an invalid image index or a locked body after removal. | The index is clamped; an empty collection closes the viewer and releases scrolling. Thumbnails scroll without shrinking. Native dialog layering places a single backdrop behind the contained image. Tests cover image replacement/removal, failed images, reopening, keyboard controls, translation and focus. Browser visual confirmation of the reported curtain remains outstanding. |
| Cart/account changes could allow late work to display previous-account state. | Cart reads and writes use identity/version guards. Previous-account IDs and pending operations are hidden immediately. Tests cover account changes, late reads/writes, refresh races and concurrent additions. |
| A successful CMS edit could be followed by sign-out restoring an older public snapshot. | Committed public content updates the filtered public snapshot; drafts, unpublished profiles and unpublished media are excluded. Existing recovery and draft tests still pass. |
| Public catalogue reads were not rental-only at every boundary. | Server reads, client filters and database public SELECT policies all require a published rental with available/on-request status. Cart, saved-home and enquiry inserts reject nonpublic inventory. Real Postgres tests cover anonymous, customer and staff permissions. |
| The source entry now identified as `GH-000013` says Lào Cai but was imported under Tây Hồ. | The original source also contains this conflict. The record remains in the live database as a staff draft; it is omitted from public fallback data and search. No replacement address, area, bedroom count or price was invented. |
| An unnecessary public execution grant existed on the platform's `rls_auto_enable()` function. | The migration revokes that grant while preserving its event-trigger role. Anonymous-role verification confirms it cannot be executed publicly. |

## Live data and content limits

The migrations were applied to project `duyiihsmaqfgwezmsnjs`. Live anonymous-role checks confirmed **15 public rentals, one clearly marked company contact placeholder, and six approved source photographs**. Existing listing IDs are permanent; hiding GH-000013 does not renumber the other listings.

The public data snapshot was refreshed from this project. Real prices, photos and existing descriptions are preserved. The source descriptions often lack precise area, furnishings detail and lease length; these values were not inferred. Short/long filters only include listings explicitly classified as short, long or both in Studio. The initial catalogue remains discoverable through Any duration.

Individual author portraits and biographies have not been supplied. The public company placeholder is labelled as pending and uses Gary Home's real contact information. Add approved profiles in Studio, then assign them to listings. Placeholder profiles do not create Auth users or grant staff permissions.

The original Gary Home Feedback tab contains six photographs. They are presented as photographs, not written testimonials or feedback screenshots. The original customer/team tabs had no usable media. Those categories and the screenshot section show honest empty states until approved assets are added. Asset provenance is recorded in [asset-sources.json](asset-sources.json); the public photo credits are bilingual. No competitor portrait, contact details, ratings or review text was reused.

## Backend and setup

- [Rental schema migration](../supabase/migrations/20261023093632_rental_catalogue_brand_and_authors.sql): listing IDs, public authors, activities, structured descriptions, rental classification, contact settings, customer carts and RLS.
- [Location-review migration](../supabase/migrations/20261023113426_quarantine_unverified_rental_location.sql): preserves the conflicting source entry as a private draft.
- `supabase/setup.sql` contains the full fresh-project migration chain and source seed. Do not rerun it on an existing project. `seed:generate` retains compatibility with the original schema; additional rental fields receive migration defaults.
- No new mandatory environment variable is required. `SITE_URL` optionally sets the canonical production origin. See [Vercel deployment](vercel-deployment.md).

The new public tables have RLS, explicit grants and indexed foreign keys. Anonymous users cannot edit profiles/media or read carts; customers cannot access each other's carts or unpublished content. Staff publishing continues to use verified company membership. No privileged public RPC was introduced.

The live Security Advisor still reports **leaked password protection disabled**. This is a hosted Auth setting, not a schema migration; account/plan configuration was not changed. See [Supabase's remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The four existing `gary_private` tables with RLS and no public policies retain their deny-by-default behavior. Existing performance notices on unrelated staff/enquiry policies and the staff assignment foreign key were not altered in this redesign.

## Verification

- **158 tests passed**, including the original auth/session/customer suite, rental filtering, batch enquiry validation, cart privacy and races, gallery recovery, language bootstrap, real Postgres permissions and the complete fresh-project setup.
- Both `npm run build` and `npm run build:vercel` passed; the Next build produces `.next/routes-manifest.json`. `npm run typecheck` passed after both builds.
- ESLint passed with **zero errors and 24 warnings**, primarily the project's native-image optimization recommendations and existing unused honeypot bindings.
- English and Vietnamese homepage SSR, headline, title, language attribute and rental controls were checked over HTTP. Live Supabase anonymous-role checks verified the expected catalogue/media counts, rental-only visibility, hidden review draft and restricted grants.
- Source/client artifacts were checked for actual server-secret values before publication. Environment files and build products remain ignored.
- Browser visual review was unavailable in this session. Automated React/DOM-platform tests and HTTP/SSR checks are not a substitute for a final real-device visual pass.
- The dependency advisory scan could not complete because the npm registry audit endpoint failed DNS resolution. No clean dependency-vulnerability result is claimed. Local direct REST checks also lacked DNS access to Supabase; live SQL checks used the connected project instead.

Real email delivery, staff invitations and customer requests were not generated as test traffic in production. Existing email-only account and invitation setup remains documented in [auth-setup.md](auth-setup.md).
