**Fixes for the 1 November 2026 audit**

The source changes address all ten findings in `AUDIT-2026-11-01.md`. Existing customer history, staff roles, listings and enquiries are preserved.

| Finding | Change |
| --- | --- |
| Staff onboarding | Existing-password assignment requires an already verified login. Explicit replacement sets the password and confirms email before assigning membership. Failure cannot create a new staff grant. |
| Revocation | Disabling a lower-role membership uses its UUID and current hierarchy even if its email changed. Restoration still checks eligibility. |
| Administrative deletion | The enquiry trigger permits narrowly scoped nested foreign-key reference cleanup by trusted maintenance roles. Customer mutation restrictions remain enforced. |
| Public-form abuse | Direct browser database inserts are revoked. Validated server requests use a service-only RPC with durable, atomic quotas shared across instances. |
| Attribution | Direct assistance-review writes enforce the same credited-account eligibility as the RPC, including retention of existing higher-role credit. |
| Favourites | Imports reserve pending additions and merge only additions, preserving newer removals of existing saved homes. |
| CRM drafts | Drafts remain above the auth gate for same-account recovery and clear on account changes or explicit sign-out. |
| CRM refresh | Refresh loads profiles, CRM records and enquiries together; conversation history updates without replacing unsaved fields. |
| Pagination | Public, Studio, CRM and saved-home reads use stable ordering and advance by the actual page length, including projects with a lower API cap. Later-page errors reject the whole read. |
| Fresh setup | The generated setup includes every migration and all eleven neighbourhoods. Seed rows are inserted before migrations that backfill their rental details. |

**Existing installation**

Apply these forward migrations in order to the Gary Home project, then deploy the application changes:

1. `supabase/migrations/20261101151843_audit_staff_and_enquiry_security.sql`
2. `supabase/migrations/20261101152018_trusted_public_intake.sql`

Public enquiry, feedback and assistance endpoints now require the server-only `SUPABASE_SECRET_KEY` (or existing `SUPABASE_SERVICE_ROLE_KEY` fallback). Set it on the deployment; never expose it as a frontend variable. A missing key or failed RPC fails closed and returns an unavailable response. The public `/api/config` response still contains only the URL and publishable key.

The public-intake RPC accepts only the three supported forms, projects allowed fields, and receives account ownership from the server's verified Auth response. It requires a public rental when a property is supplied. Quotas allow five accepted submissions per visitor and form type in ten minutes, shared across server instances. Quota keys store digests instead of raw addresses. The database reservation and insert commit together. Customer read isolation and staff moderation remain governed by RLS.

If the seven-neighbourhood expansion was never applied, also apply `20261026173334_expand_hanoi_neighbourhoods.sql`; its inserts preserve existing neighbourhood edits. Do not rerun the combined fresh setup over an existing installation.

**Fresh installation and checks**

`supabase/setup.sql` is for a new project only. Rebuild it with `node scripts/build-setup.mjs`; `node scripts/build-setup.mjs --check` detects drift.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build:vercel` and `npm run build`. Build the two targets sequentially: Vinext and Next.js share generated `.next/types`, so typecheck after the Next.js build to regenerate compatible route types.

Regression tests exercise verified onboarding, failure ordering, real Postgres permissions and quotas, trusted ownership, administrative deletion, attribution hierarchy, same-account draft recovery, refreshed conversations, favourite races, pagination below the requested page size, and the complete fresh neighbourhood catalogue.

Local verification on 1 November 2026: **473 tests passed, zero failed or skipped**. TypeScript, both production builds, setup synchronization, and diff whitespace checks passed. Repository lint exited successfully with zero errors; existing warnings remain, primarily in generated runtime bundles. The live database and production deployment have not been changed.
