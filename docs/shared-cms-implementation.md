# Gary Group CMS foundation and implementation record

Scope: Agency CMS, Teaching Jobs CMS/recruitment persistence, and Home SEO localization/report usability. Prior Home multilingual routing/favicon changes were preserved. The application code remains undeployed. The Agency and Jobs database migrations were authorized and applied on 16 November 2026; hosted Auth settings and staff memberships remain unchanged. See the [database rollout record](cms-database-rollout-2026-11-16.md).

## Implemented scope

| Area | Local implementation |
|---|---|
| Shared foundation | Framework-neutral design tokens/styles, responsive tables/forms/native dialogs, EN/VI editor/preview, draft validation/SEO checks, review/publish/archive controls, revision history/restore, media library, version conflicts and dirty-navigation guards |
| Agency | Services, eligibility, document requirements, process steps, FAQs, articles/guides, landing-page content; existing staff portal integration; public published-snapshot rendering |
| Teaching Jobs | Vacancies, employers, categories, locations, guides, FAQs; candidate portal, persistent applications/receipts, recruitment stages, staff assignments, notes/events, private CV handling; public content consumption |
| Home SEO | Stable issue protocol, shared EN/VI dictionaries, translated finding/search/group/status presentation, collapsible findings/groups/history/settings, bilingual summary and detailed printable reports |

The existing Supabase project is used as discussed with the user. Shared Auth identifies the same existing accounts, but app membership is independent. No new project, universal CMS administrator, global role, or cross-app database access was introduced. Signing in does not grant Jobs or Agency CMS permissions automatically.

## Source and release boundaries

- Canonical foundation: `shared/cms-foundation/` in Home.
- Agency copy: `gary_visa_service/website/dist/cms-foundation/`.
- Jobs copy: `gary_jobs/gary-teaching-jobs/dist/cms-foundation/`.
- Explicit maintainer sync: `scripts/sync-cms-foundation.mjs`; `--check` verifies byte equality. Each app retains a pinned local release and can deploy independently. Application builds never download the CMS from Home.
- Foundation API: [README](../shared/cms-foundation/README.md) and `index.d.ts`.
- Agency implementation/rollout: [CMS-IMPLEMENTATION.md](../../gary_visa_service/website/CMS-IMPLEMENTATION.md).
- Jobs implementation/rollout: [jobs-cms-and-recruitment.md](../../gary_jobs/gary-teaching-jobs/docs/jobs-cms-and-recruitment.md).
- Home finding/report protocol: [seo-localization-foundation.md](seo-localization-foundation.md).

## User-facing entry points

- Home: `/admin` -> SEO. Reports follow the selected staff interface language.
- Agency: `/portal.html?area=staff&view=cms` -> Content management.
- Jobs: `/portal.html?view=cms` -> Content management for authorized staff; recruitment and candidate views live in the same app-owned portal.

The Home SEO crawler remains Home-scoped. The new CMSs reuse draft SEO checks and issue presentation; they do not receive unrestricted access to Home audit data or silently inherit its crawling credentials.

## Publication, revisions, and privacy

Both CMS backends use working records, immutable revisions, and separate public snapshots. Draft save and revision restoration do not replace published content. Review precedes publishing; only app publishers/admins can publish or archive. Writes require the expected version and fail on stale data. The editor preserves unsaved work on conflicts and through interface-language changes.

Agency CMS editor/publisher/admin membership is independent and also requires Agency staff access. Jobs editor/publisher/recruiter/admin permissions are checked against Jobs membership. A content editor cannot read candidate recruitment records. Candidates can read their own applications/documents; internal notes remain recruiter-only. CVs use a private bucket and signed reads, separate from public editorial media.

Agency migration imports 19 existing bilingual public-content records without adding legal claims. Jobs' optional reference-content import creates drafts and does not publish stale vacancies. Vacancies require reviewed employer/category/location references and a valid closing date before publication. Published salary/profile fields affect public rendering. Active vacancy references prevent referenced taxonomy/profile withdrawal, including when the working draft has been renamed.

Application submission uses verified Auth identity, explicit consent, a daily limit, and a client request ID for idempotency. A durable receipt is returned before optional CV handling; a failed CV upload does not erase or conceal the successful application. Recruitment transitions and reassignment record events and reject stale writes.

## Hosted schema applied; staff and deployment pending

The user subsequently authorized the database migration files. Items 1–2 below were applied on 16 November 2026; items 3–4 remain unexecuted staff-bootstrap scripts:

1. Agency: `gary_visa_service/website/supabase/migrations/20261116043114_agency_cms_foundation.sql`.
2. Jobs: `gary_jobs/gary-teaching-jobs/supabase/migrations/20261116043122_teaching_jobs_cms_and_recruitment.sql`.
3. First Agency CMS administrator: `gary_visa_service/website/supabase/setup-cms-staff.sql` (replace the placeholder with an existing Agency staff email).
4. First Jobs administrator/recruiter/editor/publisher: `gary_jobs/gary-teaching-jobs/supabase/setup-jobs-staff.sql` (explicit existing verified account and selected Jobs role).

Hosted migration history, RLS, storage configuration, source-content counts, and representative anonymous/unassigned-role deny paths were verified after application. Staff role assignment, Auth callback/recovery allowlist verification, deployment, and authorized browser flows remain separate. Builds never apply SQL.

The hosted schema is now provisioned. Neither app has new CMS/staff role assignments yet, and neither application release has been deployed. Jobs has no published vacancies until editors create/review/publish them; the optional source seed remains unapplied. Publication/deployment and real uploaded-file tests are separate from the database rollout.

## Verification and limits

Automated verification covers app-specific database policies, publisher boundaries, public/draft isolation, revisions, conflicts, idempotent candidate intake, recruitment stages, CV restrictions under permissive cross-app storage policies, translated public rendering, safe text/URL handling, dirty browser-history navigation, shared-editor event isolation, and shared finding/score compatibility. SQL tests use in-memory PGlite; they do not migrate the hosted database.

Final local verification: Home's expanded SEO/foundation/locale suite passed **124/124** tests; Agency's existing suite passed **16/16** and its CMS/database/shared-editor suite **12/12**; Jobs passed **22/22**, including four in-memory database tests. Both native Next and Sites/Vinext Home builds, Agency build/check, and Jobs build/check passed. `git diff --check` passed in all three repositories. `scripts/sync-cms-foundation.mjs --check` verified identical app-local foundation source (release `1.0.0`, SHA-256 prefix `e61f28b141bd`).

Four report fixtures (EN/VI, summary/detailed) are generated from production report functions with `scripts/generate-seo-localization-fixtures.mjs`. HTML localization, safe escaping, and code-only dictionary resolution are tested. Native PDF rendering was attempted but the sandbox denied WebKit services; **actual PDF pagination/glyph/visual QA remains unverified**, and no final PDF artifact is claimed. Browser/print QA must run in an environment permitting it.

Public Agency/Jobs CMS content is currently rendered client-side in their retained static architectures. Dedicated server-rendered article/vacancy routes, a full cross-app crawler service, advanced media deletion/usage tracking, structured visa case management, and multi-author reviewer separation remain future work. This increment does not copy Home's complete portal or replace each application's framework.
