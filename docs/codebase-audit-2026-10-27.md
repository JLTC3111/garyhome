# Gary Home codebase audit — 27 October 2026

Scope: public rentals and editorial pages, customer and staff authentication, permissions, intake APIs, favourites, Studio notifications, image delivery, accessibility, SEO, dependency advisories, and read-only Supabase security/performance advisors for project `duyiihsmaqfgwezmsnjs`.

## Findings fixed

| Priority | Finding and effect | Change |
| --- | --- | --- |
| High | Installed Next.js, React Server Components, Sharp and validation/tooling dependencies matched published security advisories. Exploitability depends on which features are used; a matching version alone does not establish exploitation. | Upgrade Next/ESLint configuration to 16.4.3, React/React DOM/RSC/test renderer to 19.2.8, Sharp to 0.35.5, Zod to 4.6.6, and Vite to 8.1.6. Apply compatible, version-scoped transitive patches. Update the connector-preview record schemas for Zod 4. |
| High | JSON limits were checked after `request.text()` buffered the entire body. Missing or forged `Content-Length` bypassed the early size check; character counts also underestimated multibyte input. | Add an incremental UTF-8 byte-limited reader shared by enquiry, feedback/assistance, landlord and team/password APIs. Cancel oversized, aborted and stalled streams. Retain existing validation and permission checks. |
| Medium | App Router retains its layout across navigation. A newly published/updated property could reach the server page while its client detail view still searched an older context snapshot. | Pass the selected public record and neighbourhood to the detail view, render them immediately and synchronize the shared snapshot before paint. Preserve newer CMS changes, unrelated records and form state. |
| Medium | A late editorial page response could restore an article that had since been withdrawn in Studio. | Compare update timestamps while synchronizing and rendering incoming published articles; preserve newer withdrawals and private drafts. |
| Medium | A temporary content-read failure fell back to seed data and could produce a false property/article 404 or an incomplete sitemap. | Require a successful read before deciding that a URL is absent or publishing a sitemap. Add a bilingual retry screen with generic error text; genuine missing records still return 404. |
| Medium | A notification refresh begun before “Mark all read” could arrive later and restore stale unread badges. | Invalidate earlier reads after the write, reconcile with the current server state and prevent repeated marking while the write is pending. |
| Low | Password visibility reset happened after paint for controlled inputs; clearing an uncontrolled login did not reset visibility. | Mask cleared inputs before paint, support clearing uncontrolled fields, and retain the ability to enable visibility before typing. |
| Low | Sidebar expansion used an extra effect-driven render; dialog cleanup read a ref after it could detach. | Open newly selected sidebar groups during guarded state adjustment and capture dialog nodes for reliable cleanup. Correct notification/team effect dependencies and remove unsupported ARIA from a decorative picture. |

## Performance changes

The logo, hero, listing cards, customer/team photos and Vinhomes covers now use responsive framework image optimization for local raster assets. Their `sizes` declarations let smaller viewports request smaller images. Existing lazy loading is retained below the fold; the hero remains eager with high fetch priority.

External CMS URLs keep their existing native-image behavior. SVG/GIF assets and API paths are excluded from the optimizer. No broad remote-host allowlist was introduced. Both Next.js and Vinext support the local image pipeline, and a regression test exercises the real Next.js server-rendered `srcSet` output.

This improves delivery without rewriting or replacing the supplied photographs. A measured LCP/CLS or mobile transfer-size improvement requires a browser/network performance run; no such numbers are claimed here.

## Dependency review

The official npm bulk-advisory response was compared against the exact locked versions, using advisory semver ranges. Downloaded packages were checked against their registry integrity hashes before installation. The final comparison leaves **one matching advisory**, in a development-only dependency:

- `@esbuild-kit/core-utils → esbuild@0.18.20`, brought in by Drizzle Kit. [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) concerns its development server. Gary Home does not use that esbuild server to serve the production website. Update/replace the upstream database-tooling chain when a compatible version is available; do not expose a legacy esbuild development server. A forced cross-version override was deliberately avoided for this old loader.

No production dependency version matched the returned advisories after these changes. This is a point-in-time dependency check, not a guarantee that the application has no vulnerabilities.

Patch references: [Next.js advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr), [React Server Components advisory](https://github.com/advisories/GHSA-wx67-qw84-cm4g), [Sharp/Next image advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), and [Zod 4 migration guide](https://zod.dev/v4/changelog).

The `package.json` overrides pin security patches within the relevant dependency families. Review those pins during future framework/tooling upgrades rather than removing them without a fresh advisory check.

## Remaining operational and scaling work

1. **Supabase leaked-password protection is disabled.** The advisor recommends enabling it; [Supabase documents this as a Pro-plan-or-higher feature](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No billing or Auth settings were changed during this audit.
2. **Public-form throttling is best effort per server instance.** The enquiry and feedback/assistance API maps do not provide a durable quota across cold starts or multiple workers. Their counters also do not cover direct Supabase REST submissions allowed by the existing anonymous-insert policies. Before a larger public launch, design a shared server-verified intake quota and coordinate any policy restrictions with the live forms. Existing consent, field validation and RLS remain in effect; landlord upload preparation already has a database-backed quota.
3. **Public inventory reads need pagination as the catalogue grows.** The shared public loader reads the published catalogue with seven parallel queries and no explicit paging. Supabase's configured row cap can eventually truncate results. Add paginated listing reads and dedicated property/article lookups before reaching that cap; avoid increasing the cap indefinitely or loading the whole catalogue for every detail route.
4. **A small database indexing follow-up remains.** The performance advisor flagged the unindexed `team_members.assigned_by` foreign key. Add a suitable index when staff volume or Auth-user cleanup makes it material. Multiple permissive SELECT policies currently express intentional public-or-staff/customer-or-staff access; consolidate only with equivalent permission tests and measured query evidence. Do not drop “unused” indexes from short-lived statistics alone.
5. **35 non-blocking lint warnings remain:** 28 native image tags and seven intentionally omitted/unused bindings. Further image conversion should preserve remote CMS compatibility, gallery resolution and avatar behavior. There are no remaining lint errors, ARIA warnings or effect-dependency warnings.

The database advisors were read-only. No migrations, policies, roles, production records, billing settings or unrelated Gary Visa/chat schemas were changed.

## Verification

- Full automated suite: **360 passing tests**, including database/RLS, role hierarchy, account isolation, direct staff creation/password updates, guest-favourite import, public feedback, gallery, bilingual UI, reduced motion and idle recovery coverage.
- New regression coverage includes streamed/forged-length request limits, split UTF-8 characters, timeout/abort cancellation, fresh property navigation, newer CMS withdrawal protection, false-404/sitemap recovery, notification read/write ordering, password clearing and real responsive image markup. Cross-platform lockfile tests also check optional package versions and dependency completeness.
- `npm run lint`: zero errors, 35 warnings described above.
- `npm run build`: Vinext/Vite production build passes.
- `npm run build:vercel`: Next.js production build passes and generates its route manifest.
- `npm run typecheck` and `git diff --check`: pass.
- Client-artifact/server-secret scan: passes. macOS and Linux/x64 dependency-install dry runs: pass.

### Deployment handoff

The first automatic Vercel deployment of the audit commit failed during dependency installation (`Invalid Version`), before the application build. The generated lockfile contained incomplete records in optional WASM dependency branches. These records were resolved again from complete official registry metadata, and cross-platform lockfile checks now cover this failure.

The application changes are already pushed in `a525f6c`. The final lockfile correction and tests are committed locally for the owner to push/deploy. No additional Vercel deployment was requested after the owner chose to handle publishing. Production HTTP verification of this release remains pending that deployment.

Browser visual and interactive performance testing was unavailable in this session. Automated component tests and server-rendered HTML checks do not replace real-device layout, Lighthouse or accessibility testing.
