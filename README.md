# Gary Home

A redesigned Hanoi property website and Supabase CMS, based on https://garyhome.vn/en/ and the supplied screenshots.

## Run locally

Requires Node 22.13+ (Node 24 is recommended for the TypeScript search tests).

```sh
npm ci
npm run dev -- --host 127.0.0.1 --port 3000
```

Website: http://127.0.0.1:3000 · Team login: http://127.0.0.1:3000/login · CMS: http://127.0.0.1:3000/admin

Use **Team login** in the desktop header or mobile navigation menu. `/login` opens the CMS sign-in page at `/admin`. The email/password form appears immediately while the secure connection initializes; an authenticated editor opens the studio directly.

Without Supabase configuration, the website uses 16 imported reference listings. Their photos are stored locally. The CMS has an explicitly labelled browser preview: edits and enquiries are saved in browser storage, and no request is sent to Gary Home. Saved homes and language preference also stay on the visitor’s device.

## Connect the authorized Supabase project

The application is connected to project `duyiihsmaqfgwezmsnjs` through the ignored `.env` file. The user reports applying `supabase/setup.sql` and `supabase/owner.sql` in the selected project’s SQL Editor. Live checks confirmed 16 published listings, 58 photo entries, four neighbourhoods, and site settings. Anonymous requests cannot read enquiries or team memberships. The configured app renders live data without its fallback warning, and a labelled QA viewing request was successfully saved through the app API. **No changes were made to the existing JLTC3111 organization or project.** Admin sign-in, authenticated edits, and uploads still need browser verification; the management connector cannot access this project for advisors.

1. Select or create the dedicated Gary Home project after confirming its organization and any cost.
2. Apply `supabase/migrations/20261021152453_gary_home_cms.sql` to that project. This creates listings, neighbourhoods, settings, team membership, enquiries, and the `property-media` Storage bucket.
3. Apply `supabase/seed.sql`. It imports the reference listings, four neighbourhoods, and initial site content. It uses `ON CONFLICT DO NOTHING` to preserve existing CMS edits.

   For manual initial setup through Supabase SQL Editor, `supabase/setup.sql` combines steps 2 and 3 in a single file. Select the intended dedicated project before running it. Auth user creation and membership provisioning remain separate steps below.
4. Copy `.env.example` to `.env`, and fill in `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from the selected project. These are the only credentials the application needs. **Never add a service-role or secret key to frontend configuration.** For Sites hosting, set the same two values in the Site’s runtime environment.
5. Create or invite the actual CMS user through Supabase Auth. A Supabase dashboard login is separate from this application’s Auth user. No account password needs to be shared with the agent.
6. For the supplied owner email, run `supabase/owner.sql` in SQL Editor after creating and confirming `skycastle3@protonmail.com` in Authentication > Users. It checks that the confirmed user exists before granting access. For other owners or CLI operation, use `scripts/bootstrap-owner.sql` (psql variable `owner_email`). User-editable metadata is never used for authorization.
7. Set the Auth Site URL and allow the exact `/auth/reset` redirect for each deployed origin. Configure email delivery for password resets if required. The public website does not provide account registration.
8. Run the project’s security/performance advisors and verify a real editor login, upload, published edit, and enquiry against the selected project.

The app automatically switches from preview to live mode when both configuration values are present. Public forms store enquiries in the CMS inbox; they do **not** send email notifications. Staff contact visitors directly and update status/notes. Viewing dates are requests until confirmed by the team.

## CMS

- Overview with actual listing, draft, photo, and enquiry counts.
- Create/edit bilingual properties; publish, draft, and archive; mark available/rented/sold.
- Upload original photos, choose a cover, and remove images from listings. Removed photos remain in Storage to avoid accidental data loss.
- Browse the media library and jump to each property’s editor.
- Read private enquiries, update status, and add internal notes.
- Edit neighbourhood introductions, images, homepage copy, and contact details.
- Password sign-in, reset flow, editor authorization, and sign-out.

Public browsing includes accent-insensitive Vietnamese search, combined filters, budget filtering, price/newest sorting, saved homes, three-home comparisons, property galleries, map links, landlord enquiries, and an English/Vietnamese interface. The website, Studio, sign-in, password reset, and editor dialogs share an English/Vietnamese switcher. The language preference persists across page visits and reloads and syncs between open tabs. Switching languages keeps the current Studio tab and unsaved form values; bilingual content fields and stored values stay intact. Unconfirmed property facts are not fabricated; price can be “on request,” and missing floor area is omitted or marked for confirmation.

## Recovery after inactivity

The Studio rechecks the current session and editor membership when its tab becomes visible, the window receives focus, the browser restores the page, or the network returns. Concurrent wake events share recovery work, and an online event arriving during a failed request is queued for another attempt. Supabase keeps its built-in token refresh and cross-tab session coordination; the auth callback stays synchronous and defers membership queries.

A same-user token refresh or temporary connection error keeps the current Studio screen and drafts mounted. Settings drafts also survive signing back in to the same account after session expiry while this page remains open. Explicit sign-out clears drafts, and switching accounts clears them before the next editor workspace opens. These drafts are kept in memory; closing or reloading the page does not save them.

Configuration has a 10-second deadline, session and membership checks each have a 12-second deadline, and editor operations have a 20-second deadline. SDK fetches include response-body deadlines. Public server content reads fall back with a warning within 12 seconds. Saves, uploads, password actions, and public enquiries release their loading state on failure. Writes are never automatically replayed by the app: a timeout can have an uncertain server outcome, and the UI asks you to check current data before retrying.

A bilingual connection banner and reconnect controls are available, including inside editor dialogs. Saves recheck editor access; a timeout or role-check failure blocks writes while preserving the draft. Private caches are cleared on sign-out or confirmed access loss, and old requests cannot repopulate them. Background reads cannot overwrite a later completed save. Slow saves and uploads preserve newer text edits, completed photos are appended as they finish, and a late upload cannot attach to a different property editor.

The tests include the installed SDK refreshing an expired stored token, simulated network failures, a hung response body, sign-out/account races, and real React component lifecycles. They do not replace a live browser sleep/resume test. Browser control is unavailable in this session, and the most recent live API check could not resolve the selected project's hostname.

Auth behavior was checked against the pinned SDK source and [Supabase auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange), [session guidance](https://supabase.com/docs/guides/auth/sessions), and [the changelog](https://supabase.com/changelog).

## Validate

```sh
npm run typecheck
npm test
npm run build
```

Tests exercise combined searches and real Postgres row-level policies in PGlite. The local fixture emulates Supabase-owned Auth/Storage schemas and permissive default table grants. It tests anonymous access, non-editor access, editor writes, private enquiry isolation, blocked self-promotion, Storage writes, and repeatable seeding. These checks supplement, and do not replace, live Supabase Auth/Storage integration tests after connection.

Browser QA requires the session’s computer-use permissions. That permission was unavailable during the initial build; HTTP and build checks remain possible.

## Source and hosting

Source is in this `gary-home` subdirectory of `Desktop/gary_home_website`. The Sites identity is in `.openai/hosting.json`; preserve its `project_id`. The application uses the supplied Vinext/React/Cloudflare Workers integration. No D1/R2 database is used. Supabase serves the shared backend.

An owner-private Site was registered, but source synchronization could not complete because the source helper could not resolve its repository host under the current network restrictions. It is not a verified hosted deployment. Reuse the registered Site identity when publishing becomes available.

Update reference seed data through `data/properties.json` and `data/site-content.json`, then run `npm run seed:generate`. After connection, ongoing content editing belongs in the CMS, not in those reference files.

Photos and font attribution are documented at `/credits`. Self-hosted fonts include their SIL Open Font License files in `public/fonts/`. Neighbourhood images are Wikimedia Commons photographs of Hanoi, with attribution and license links. The original site’s testimonials and partner endorsements were not reproduced as new claims.

The enquiry endpoint validates input, enforces same-origin submissions, uses a honeypot, and applies a best-effort per-Worker request limit. Public direct database insert permissions are intentionally narrow; database constraints and RLS protect private data. For high-volume public operation, add persistent edge rate limiting or CAPTCHA to control distributed spam.
