# CMS database rollout — 16 November 2026

Applied to the existing Supabase project `duyiihsmaqfgwezmsnjs` following the user's explicit instruction to apply the SQL database migration files. No website deployment, Auth setting change, staff-role assignment, or optional Jobs draft-content import was performed.

## Applied migrations

| Application | Hosted migration version | Name | Source SHA-256 |
|---|---|---|---|
| Agency / Visa | `20261116043114` | `agency_cms_foundation` | `232ea4600e7efa70ac717a5d2b1e38d239ad8f4851d1b4d8e1ee1718b7798157` |
| Teaching Jobs | `20261116043122` | `teaching_jobs_cms_and_recruitment` | `26bd03c1f545feef5ff46e08cd07c5bb9cb0c88edab6b9db64b7f7aae2beb970` |

Both Supabase `apply_migration` calls returned success, and both entries were subsequently confirmed in the hosted migration ledger. The tool assigned the hosted versions above. Local filenames were aligned to those actual versions without changing SQL bytes, and test/document references were updated, preventing a later CLI deployment from treating the same migrations as pending.

Original prepared filenames were `20261113073227_agency_cms_foundation.sql` and `20261113073319_teaching_jobs_cms_and_recruitment.sql`. Current source paths:

- `gary_visa_service/website/supabase/migrations/20261116043114_agency_cms_foundation.sql`
- `gary_jobs/gary-teaching-jobs/supabase/migrations/20261116043122_teaching_jobs_cms_and_recruitment.sql`

## Preflight

- Confirmed the project/account matched both applications' existing public configuration.
- Neither migration was already installed; no target table/function/bucket collisions existed.
- Existing Agency private schema, staff table, authorization helper and authenticated schema access were present.
- Source review confirmed transactional scripts, RLS on new tables, checked private implementations, public invoker wrappers, and storage guards scoped to new buckets.
- In-memory regression tests passed: Agency 1/1 and Jobs 4/4.

## Hosted verification

- All **15 new tables** have RLS enabled: 13 public application tables and two private membership tables.
- Agency has **19 published content snapshots and 19 initial revisions** from the authorized source-content import.
- Jobs has **zero content entries**; stale reference vacancies were not published or imported.
- Created storage buckets:
  - `gary-cms-media`: public editorial images, 5 MiB, JPEG/PNG/WebP/AVIF.
  - `jobs-media`: public editorial images, 8 MiB, JPEG/PNG/WebP/AVIF.
  - `jobs-cv`: private candidate files, 10 MiB, PDF/DOCX.
- Anonymous-role checks verified public snapshot access and denied private-table/write-RPC privileges.
- Read-only transactions using an unassigned authenticated identity verified no CMS/recruitment capabilities, no private records visible, and both CMS write RPCs rejected with insufficient privilege. Transactions were rolled back; no test identity, membership, application or content record was created.
- Existing Home staff/property counts and Agency staff/case counts matched the preflight observations: 5 Home staff rows, 29 properties, 1 Agency staff membership and 1 existing Agency case.
- New Agency CMS memberships and Jobs staff memberships remain **zero**. No account was promoted automatically.

These checks verify installed schema, metadata and representative deny paths. They do not replace browser flows, authorized staff CRUD/upload tests, application deployment or real candidate submission testing.

## Security advisor

No new warning/error advisory was reported. The pre-existing leaked-password protection warning remains unchanged; it was not modified as part of applying these migrations. [Supabase password-protection remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

Informational “RLS enabled, no policy” notices also appear for the two new private membership tables. Their direct application-role access is revoked and access is mediated through checked private functions; the notices were reviewed rather than treated as public exposure. [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)

## Remaining activation steps

1. Explicitly assign selected existing accounts app-scoped roles using the reviewed Agency/Jobs bootstrap scripts. Placeholder emails have not been executed.
2. Verify the intended Jobs Auth callback/recovery allowlists without broadening unrelated settings.
3. Deploy the already prepared application changes when authorized.
4. Verify real authorized publishing, private CV/media handling, and cross-role browser flows after deployment.

Do not rerun the applied non-idempotent migrations. Use new reviewed migrations for future schema changes.
