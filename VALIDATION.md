# Validation

## Live Supabase connection

Project: `duyiihsmaqfgwezmsnjs`. The project URL and publishable key are in the ignored `.env` file. The user reports running `supabase/setup.sql`, creating and confirming the Auth owner, and running `supabase/owner.sql`. The agent did not modify the unrelated JLTC3111 project.

Verified through the live API:

- 16 published listings with 58 photo entries, four neighbourhoods, and one main settings record are publicly readable.
- Anonymous enquiries and team-membership reads return HTTP 401 / Postgres `42501`, as intended. Do not follow the generic API hint to grant public SELECT.
- A direct anonymous insert attempting to set the protected enquiry status returns HTTP 401 / `42501`.
- The app homepage, catalogue, and configuration endpoint return HTTP 200.
- The app renders 16 catalogue cards, reports configured mode, and has no fallback warning.
- An invalid form submission returns HTTP 400.
- A labelled viewing request through `/api/enquiries` returns HTTP 201 and `{ "ok": true }`.

One synthetic inbox record was intentionally retained for review: **QA — Gary Home setup verification**, using `qa@example.invalid`. No email was sent, and no real viewing was requested. It may be marked closed from the CMS.

## Build and local checks

- Production build and TypeScript check pass.
- 14 tests pass: combined/accent-insensitive search, sorting, draft visibility, role isolation, private enquiry access, blocked self-promotion, editor writes, Storage policies, RLS coverage, and repeatable seeding.
- Owner SQL was checked separately in PGlite: missing and unconfirmed users are rejected; a confirmed owner is granted; repeat execution is safe.
- HTTP 200 verified for homepage, catalogue, contact, neighbourhoods, and a property detail page.
- Rendered search results: 16 total; 1 in Long Biên; 2 studios at or below $300; 1 matching `to ngoc van` without accents.
- Rendered pages reference existing local images.
- Without configuration, the enquiry API returns HTTP 503 with an explicit message.
- Cross-origin enquiry submission returns HTTP 403.
- Robots exclude admin, login, auth, and API routes. Sitemap contains 21 public entries.

## Login discoverability update

- Added a bordered **Team login** link to desktop navigation and the mobile menu; authenticated editors see **Open studio**.
- Added `/login` as an entry route to the existing `/admin` portal, with search indexing disabled.
- The email/password form is rendered immediately, with submission disabled while the connection initializes and a reconnect message if initialization fails. Sign-in accepts existing passwords without imposing a new minimum length.
- Navigation switches to its mobile menu at 800 px to accommodate the additional link. The contact button is hidden below 1100 px, with Contact available in the menu on mobile.
- Production build and TypeScript check pass after this update. Live route and browser checks were unavailable: the sandbox could not reach the running local server, elevated terminal access was automatically rejected, and native computer-use permission was unavailable.

## Language switcher and Studio localization

- A shared EN/VI control is used in the public header, Studio sign-in, authenticated toolbar, loading screen, and editor dialogs. Password reset uses the public header control.
- Studio navigation, dashboard, property/area/settings editors, media labels, enquiry statuses, form hints, application validation messages, and password reset support Vietnamese. Dates and displayed numbers follow the selected locale.
- The preference uses the existing browser storage and now syncs between open tabs. Language updates do not remount forms, replace content values, or restart authentication.
- Production build and TypeScript checks pass. Eighteen server-render checks with a controlled site context passed across EN/VI for the header, sign-in, authenticated overview, loading, reset, editor dialog, property editor, site settings, and language control. They also verified stable bilingual draft values and untranslated property-type option values.
- Translation coverage checks passed for 199 display calls and 255 dictionary entries, including template variable preservation. These checks do not exercise browser clicks, real authentication, or responsive screenshots; those remain subject to the browser permission limit below.

## Idle and connection recovery hardening

- Production build, TypeScript, and **36 tests** pass: the original 14 database/search checks, 15 session/request/wake-event checks, and seven React component integration checks.
- The installed Supabase SDK was exercised with an expired stored JWT and a controlled Auth/Data API transport. A real `getSession()` refresh rotated the test token and authenticated the membership query with the refreshed token. No real credentials were used in these tests.
- Recovery tests cover repeated same-user events without losing editor state, synchronous auth callbacks, offline/online recovery, terminal session loss, confirmed role removal, stale membership/session results after sign-out or account changes, coalesced recovery, hung reads, cleanup, response-body timeouts, and no automatic replay of writes.
- React integration checks cover unsaved settings across token refresh, offline/online recovery, and same-user reauthentication; transient permission lookup errors; isolation between accounts; stale background reads after local saves; late private reads after sign-out; writes completing after an account change; new text edits made during a slow save; and slow uploads that preserve text edits and cannot update a different property editor.
- Configuration, SDK fetches, server content reads, and editor requests have deadlines. Mutation authorization is rechecked; the RLS policies and database schema are unchanged. The auth client remains pinned at 2.118.0, and the browser client is reused without disabling SDK refresh coordination.
- The live read check attempted `GET /rest/v1/properties?select=id&status=eq.published` in project `duyiihsmaqfgwezmsnjs`, but this session could not resolve its hostname. No live write or account setting was changed. Browser control was rechecked and still reports that Computer Use permissions are not granted. Actual browser sleep/resume and live owner-session recovery therefore remain unverified; no guarantee of zero future idle issues is claimed.

## Verification limits

Browser interaction and responsive screenshot QA remain unverified because computer-use permission was unavailable. An owner login, authenticated CMS edits, and a real Storage upload have not been independently exercised. The project management connector does not have access to the selected project, so live Supabase advisors could not be run. Password-reset redirect and email delivery configuration should be checked before public launch.

The private Sites project was registered, but publishing could not complete: its source helper could not resolve `git.chatgpt-team.site` under the execution environment’s network restrictions. No hosted deployment is claimed.

## Customer portal and staff CRM

- Added `/account` with customer sign-in, registration, password reset, a private dashboard, account-synced saved homes, enquiry tracking, viewing cancellation and profile preferences. `/login` now routes to the customer account; staff access remains `/admin`.
- Added Studio customer management with searchable customer/guest/contact records, stages, internal notes, follow-up dates, customer preferences and enquiry history. Staff can publish customer-visible updates and confirmed Hanoi viewing times using an atomic RLS-preserving RPC.
- The incremental migration is `supabase/migrations/20261021201948_customer_portal.sql`. Fresh `setup.sql` includes both migrations and the seed. Legacy notes are preserved and isolated from all customer SELECT access. No additional environment variables are needed.
- **59 automated checks pass**: existing database/search/session checks, customer RLS tests in real Postgres, API authentication/input/rate-limit tests, and React lifecycle tests. These cover profile ownership, saved-home isolation, blocked self-promotion, unclaimed guest history, private notes, staff-only confirmation and CRM access, cancellation restrictions, atomic RPC rollback, stale customer reads/writes, language changes, pending drafts, and staff contact creation/search.
- TypeScript and the production build pass. Targeted lint for the new portal, CRM, provider, data helpers and enquiry API has no errors; the existing project convention of a local `<img>` produces one performance advisory on the account welcome photograph.
- The current dev server returned HTTP 200 for `/account`; its server-rendered document contains the sign-in UI, customer navigation and portal stylesheet. Native browser review could not initialize (the app-selection call timed out), so actual responsive screenshots, real customer email confirmation, and browser sleep/resume remain unverified.
- The Supabase management connector still exposes only `idkfmgdfzcsydrqnjcla`, not the intended Gary Home project. The owner was asked to run the incremental migration in `duyiihsmaqfgwezmsnjs`. Live customer migration status, two-account access checks and advisors remain pending; no unrelated database was modified.
