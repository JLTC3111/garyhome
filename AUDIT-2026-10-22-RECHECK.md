# Gary Home code audit — current-code recheck

Date: 22 October 2026. Audited commit: `d8eb61f96f91f34d932692b84af2e015bbf66cb2` in `gary-home/`.

There are **10 actionable findings: one P1, seven P2, and two P3**. Staff revocation after an email change and placeholder SEO URLs are newly identified. Eight findings from the earlier review remain reproducible or present in the current code. The earlier password-reset account-switch race is fixed.

This review includes current source, SQL policies/functions, the existing automated suite, isolated Postgres and React reproductions, HTTP responses from the running preview, credential checks, and a partial dependency review. Application source, live data, account settings, and GitHub were not changed. This report is outside the application repository; the earlier report is preserved.

## Findings

### 1. P1 — Administrative customer deletion fails when enquiries reference the account

Location: [customer portal migration:108](/Users/skycastle3/Desktop/gary_home_website/gary-home/supabase/migrations/20261021201948_customer_portal.sql:108).

The enquiry update trigger exempts only `private.is_editor()`. Administrative operations without an end-user `auth.uid()` fail its customer-cancellation checks. The foreign keys on `enquiries.user_id` and `enquiries.property_id` use `ON DELETE SET NULL`, which performs an update and invokes this trigger.

**Current reproduction:** apply the complete current `supabase/setup.sql` in isolated Postgres, create a customer with a viewing enquiry, clear the request identity, and delete either the Auth user or referenced property. Both fail with SQLSTATE `42501`: `Customers may only cancel their own active viewing requests.`

**Impact:** account cleanup/deletion through trusted administrative operations cannot complete for affected customers. Property cleanup is blocked as well. This is relevant to the data-deletion process now documented on the privacy page.

**Correction:** distinguish trusted referential-maintenance updates from customer mutations, retaining the restrictions on customer changes to status, appointment, ownership, and staff fields. Ship a forward migration and verify both parent-deletion cases under administrative roles. Do not simply remove the customer guard.

### 2. P2 — Changing a staff email prevents the owner/admin from disabling that membership

Locations: [staff access migration:113](/Users/skycastle3/Desktop/gary_home_website/gary-home/supabase/migrations/20261022042327_customer_social_auth_staff_access.sql:113), [membership update:120](/Users/skycastle3/Desktop/gary_home_website/gary-home/supabase/migrations/20261022042327_customer_social_auth_staff_access.sql:120).

`set_staff_access()` requires `find_staff_account(member.email, ...)` to resolve to the existing membership UUID even when the requested action is `enabled = false`. After the Auth user completes an email change, the membership still stores the old email and that lookup no longer resolves to the same user.

**Current reproduction:** assign a confirmed company account, change its confirmed Auth email, and call `set_staff_access(user_id, 'editor', false)` as the owner. The call fails with SQLSTATE `23514` and leaves `team_members.active = true`. Restoring the original verified email makes `private.is_editor()` return true again without an owner reassignment. All of these observations were asserted against the actual current SQL in isolated Postgres.

**Impact:** the normal revocation control cannot disable this stale membership. Access is blocked while the emails mismatch, but the unchanged active grant becomes effective again if they match later. The API reports an error; it does not silently claim successful revocation.

**Correction:** authorize revocation using the acting role and target membership UUID, including protected-owner/self/admin checks, and permit `active = false` regardless of the target's current email/domain validity. Retain verified-email/domain checks for restoration and assignment.

### 3. P2 — Direct Data API submissions bypass the enquiry endpoint's abuse protection

Locations: [insert grant:120](/Users/skycastle3/Desktop/gary_home_website/gary-home/supabase/migrations/20261021152453_gary_home_cms.sql:120), [insert policy:96](/Users/skycastle3/Desktop/gary_home_website/gary-home/supabase/migrations/20261021201948_customer_portal.sql:96), [application limiter:36](/Users/skycastle3/Desktop/gary_home_website/gary-home/app/api/enquiries/route.ts:36).

The anonymous database role can insert enquiries directly using the public project URL/key. That path does not execute `/api/enquiries`, so the endpoint's honeypot, origin check, and per-instance five-per-ten-minute limiter do not apply.

**Current reproduction:** the complete current schema accepted 20 valid anonymous enquiries in one SQL insert under the `anon` role. No submissions were made to the live database.

**Impact:** callers can flood the inbox and consume database resources through the Data API. Private enquiry reads and staff-controlled fields remain protected by the reviewed policies.

**Correction:** route every accepted submission through a trusted validation and abuse-control boundary, including durable rate limits. Preserve authenticated ownership and private-field restrictions. Strengthening only the current route leaves the direct database insert path open.

### 4. P2 — Shortlist import can restore a home removed by a later action

Location: [site-context.tsx:302](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/site-context.tsx:302).

`importSaved()` does not coordinate imported IDs with `savedFlight`/`pendingSaved`. When its response arrives it unconditionally merges the imported IDs into the displayed shortlist at line 314, even if a more recent removal has completed.

**Current reproduction:** the real React components/provider imported an already-saved home with a delayed response. A subsequent removal completed in the simulated database. Releasing the older import response restored the heart in the UI while the database remained empty.

**Correction:** serialize conflicting operations per home, or reconcile against an authoritative read after pending mutations settle. Ensure a later removal wins over an earlier import response.

### 5. P2 — CRM drafts disappear after same-user reauthentication

Locations: [customer-manager.tsx:14](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/customer-manager.tsx:14), [Studio authentication gate:85](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/admin-page.tsx:85).

The CRM's selected customer and unsaved notes are local to `CustomerManager`. Session loss unmounts that component when Studio renders its sign-in screen. Restoring the same staff identity creates a fresh manager. Parent-held property, settings, and team drafts do not have this particular problem.

**Current reproduction:** enter unsaved private CRM notes, emit session loss, and restore the same owner session. The current real component loses the draft. Leaving and reopening the Customers tab also unmounts its state.

**Correction:** retain CRM drafts in account-scoped memory above the authentication/tab gate; clear them on explicit sign-out or a different identity. Preserve newer edits during pending saves.

### 6. P2 — CRM Refresh omits the enquiries that supply incoming contacts

Location: [customer-manager.tsx:27](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/customer-manager.tsx:27).

The directory is derived from profiles, records, and shared `enquiries`, but its Refresh button fetches only profiles and records. Newly received guest enquiries and their contact/history entries remain stale.

**Current reproduction:** add a guest enquiry at the mocked network boundary after the directory loads, then click CRM Refresh. The contact does not appear. A full shared CMS refresh makes that same contact appear.

**Correction:** refresh all three inputs together and retain the existing identity, sequence, and version guards. Update the selected customer's history without discarding unsaved CRM fields.

### 7. P2 — Catalogue, CMS, and CRM queries silently truncate at the Data API row cap

Locations: [public-content.ts:24](/Users/skycastle3/Desktop/gary_home_website/gary-home/lib/public-content.ts:24), [site-context.tsx:103](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/site-context.tsx:103), [customer-manager.tsx:28](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/customer-manager.tsx:28).

These list queries issue a single request and perform filtering/search/counts in the browser without requesting subsequent pages or reporting truncation. Supabase documents a configurable default maximum of 1,000 returned rows. The target project's actual cap was not inspected. [Supabase select documentation](https://supabase.com/docs/reference/javascript/select)

**Current reproduction:** the current React directory, given 1,001 stored records behind a simulated 1,000-row API cap, cannot find contact 1,001 through its search. The same public-content query feeds the sitemap. The newer team directory has cursor pagination and is not included in this finding.

**Correction:** use deterministic pagination and server-side filtering/counts for interactive lists. Fetch all necessary pages for sitemap/export generation.

### 8. P2 — SEO URLs use a hardcoded placeholder hostname

Locations: [layout.tsx:9](/Users/skycastle3/Desktop/gary_home_website/gary-home/app/layout.tsx:9), [sitemap.ts:2](/Users/skycastle3/Desktop/gary_home_website/gary-home/app/sitemap.ts:2), [robots.ts:1](/Users/skycastle3/Desktop/gary_home_website/gary-home/app/robots.ts:1).

`metadataBase`, every sitemap URL, and the robots sitemap pointer are hardcoded to `https://gary-home-hanoi.lsd99999999.chatgpt.site`. There is no source configuration for replacing this with the actual production origin.

**Current reproduction:** `/sitemap.xml` returned HTTP 200 with 21 URLs, all using that placeholder host. `/robots.txt` returned the same placeholder sitemap pointer.

**Impact:** deploying the unchanged code on the real website will advertise the wrong sitemap/location and use the wrong base for relative social metadata images.

**Correction:** derive these values from one validated production site-origin setting. Verify the emitted sitemap, robots file, and social-image URLs against the actual deployed domain.

### 9. P3 — Missing property URLs still return HTTP 200

Location: [property route:8](</Users/skycastle3/Desktop/gary_home_website/gary-home/app/homes/[slug]/page.tsx:8>).

The route imports `notFound()` but does not call it. The client component renders a missing-listing message within a successful response.

**Current reproduction:** `GET /homes/audit-missing-20261022-recheck` returned HTTP 200 containing `This home has turned a new page.`

**Correction:** validate public listing availability on the server and return the framework's 404 response, keeping the bilingual recovery UI. Handle genuine backend outages separately from confirmed missing listings.

### 10. P3 — Full repository lint still fails

`npm run lint` exits 1 with **3 errors and 32 warnings**:

- [admin-page.tsx:32](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/admin-page.tsx:32): synchronous effect state updates.
- [property-detail.tsx:13](/Users/skycastle3/Desktop/gary_home_website/gary-home/components/property-detail.tsx:13): synchronous effect state updates.
- [enquiry-api.test.mjs:17](/Users/skycastle3/Desktop/gary_home_website/gary-home/tests/enquiry-api.test.mjs:17): the configured Next rule rejects a test-loader variable named `module`.

**Correction:** resolve the component findings and use an appropriate name/configuration for the Node VM loader. The passing build/type checks do not establish a clean lint result.

## Previously reported issue that is fixed

The password-reset account-switch race is fixed by binding the form to the email-link identity and freezing the JWT used for the actual password write. The current tests cover wrong-account rejection, changed shared sessions, expired links, and invitation identity handling. [password-actions.ts:19](/Users/skycastle3/Desktop/gary_home_website/gary-home/lib/password-actions.ts:19)

## Dependency review

The installed tree still includes `next@16.3.4`, `sharp@0.35.4`, and `vite@8.0.13`. Current maintainer advisories intersect those versions:

- Next image-optimization advisory GHSA-2464-fhr4-w9xw lists Next through 16.4.0 and identifies `sharp >= 0.35.5` as a workaround; Next 16.4.1 is patched. Its stated RCE condition involves image processing on glibc Linux. This application targets Cloudflare Workers, uses ordinary image tags, and its installed Vinext image handler uses passthrough/Cloudflare Images rather than the affected Next sharp processing path. No reachable exploit was established. [Maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)
- GHSA-vcvr-r3jv-pc5j affects Node `next/og` ImageResponse with attacker-controlled SVG input, fixed in 16.3.6. No application `next/og`/ImageResponse usage was found. [Maintainer advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)
- Vite GHSA-rq7h-c2jc-7f22 affects 8.0.13 under particular development-server project/import-path conditions. Patched branches include 8.1.6, 8.2.4, and 8.3.3. Those exploitation conditions were not demonstrated here. [Maintainer advisory](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)

Upgrade compatible versions and recheck the Vinext build. Do not interpret these observations as proof of exploitable RCE in this deployment. `npm audit --json` could not contact `registry.npmjs.org` because of DNS failure, so this was not a complete dependency scan.

## Verification

| Check | Current result |
| --- | --- |
| Existing automated suite | 112 passed, 0 failed |
| TypeScript | Passed |
| Production build | Passed |
| Full lint | Failed: 3 errors, 32 warnings |
| Isolated current-component React probes | Four confirmed defects: shortlist race, CRM refresh, CRM draft loss, capped directory search |
| Current full SQL setup in PGlite | Applied successfully |
| Staff email-change/revocation probe | Disable failed with 23514; old-email restoration restored access |
| Administrative Auth user/property deletion probes | Both failed with 42501 |
| Anonymous bulk-insert probe | 20 rows accepted in one statement |
| Missing property HTTP check | 200 with the missing-property message |
| Sitemap/robots HTTP checks | 200; placeholder hostname confirmed |
| Tracked credential scan | No configured key values or `sb_secret_` credentials found in 274 tracked files |
| Environment tracking | `.env` ignored; no `.env` commits found in local Git history |
| Working tree after audit | Clean at the audited commit |

The standard SQL/API tests also continue to cover customer row isolation, private-note restrictions, protected staff hierarchy, forged metadata rejection, current-email/domain checks, and revocation for an unchanged staff email. Those positive checks do not cover or negate the failures above.

## Live verification limits

The Supabase management connector still exposes only the unrelated project `idkfmgdfzcsydrqnjcla`, not the intended Gary Home project `duyiihsmaqfgwezmsnjs`. No advisors or SQL were run against the unrelated project. The current live database policies, complete platform-specific Auth behavior, and project row-cap configuration could not be independently audited through that connector.

The running preview's provider-status endpoint reports Google, Facebook, and Apple disabled; email sign-in/signup are enabled. Google/Facebook end-to-end login and Meta review settings therefore remain unverified. Browser control is unavailable because computer-use permissions are not granted, so real browser sleep/resume and multi-account UI sessions were not repeated.

No live rows were created, changed, or deleted for this audit. Isolated reproduction scripts and logs are under `/private/tmp/gary-audit-current-*`; the report's SQL results derive from the tracked schema in a local PGlite instance, not destructive tests on the live service.
