# Gary Group staff workspace overhaul — 17 November 2026

Implemented locally across Home, Visa and Teaching Jobs. Home regains its attached right-side editor; Visa and Jobs keep their shared modal editors and gain independently controlled navigation. No deployment, database migration, permission change or production data write is part of this change.

## Home history and restoration

The original presentation was identified in these Home commits:

| Commit | Relevant implementation |
| --- | --- |
| `6e1f5aed3946d1002393b9e5a693706df167d811` (22 October) | Inline right-side, full-height editor in `components/admin-page.tsx`, styled in `app/globals.css`. |
| `95bda28bfea229a87332cea5707d45c25b7f4ef6` (6 November) | Extracted `components/editor-modal.tsx` and `app/editor-drawer.css`; 1120px listing drawer, left-edge resize and fullscreen/restore. |
| `ad94bb390695616058672827986688aa06822e50` (17 November) | Replaced drawer geometry with the inset, all-edge shared modal controller. |

The current implementation restores the earlier presentation through an opt-in drawer mode on the existing workspace controller. It does not check out historical form code. The current Home navigation, `admin-page.tsx`, fields, validation, uploads, EN/VI controls, SEO, autosave and publishing logic are unchanged.

Home drawers attach to the right edge at full viewport height. Listings default to 1120px; other drawer workflows default to 740px. The left grip supports dragging and keyboard resizing, normally from 640px to viewport width minus 24px. Maximize uses the entire usable viewport; restore returns to the preferred width. At 720px and below the editor uses fullscreen without overwriting desktop preferences. The header stays visible and the form scrolls independently with the current sticky action bar.

## Inventory and platform behavior

| Platform | Navigation | Applicable editors / content |
| --- | --- | --- |
| Home | Existing navigation and sidebar retained unchanged. | Shared drawer wraps property listings, neighbourhoods, enquiry/conversation editing, owner guides and staff profile editing. Existing full-page editorial/settings workspaces remain full-page. |
| Visa | Original navigation nodes grouped into Operations (Applications), CRM (Customers & leads, Chat inbox), Content & Media (Content management and its existing media library, Trash), Account (My profile). | Existing shared CMS, application, CRM and case editor modal shells retained. No editor form or publishing adapter replaced. |
| Teaching Jobs | Recruitment (Vacancies, permitted Recruitment applications), Directories (Employers, Job Categories, Locations), Guides & answers (Guides, FAQs), Content & media (Media Library). | Existing vacancy, employer, category, location, guide, FAQ and media workflows and shared modal shell retained. Candidate navigation remains unchanged. |

Only existing, permitted destinations are shown. No new Overview page, management system, route or privilege was introduced. Jobs' redundant horizontal collection navigation is removed only in the staff host; all implemented destinations remain reachable from the sidebar.

Visa enhances the existing sidebar by moving its original buttons, retaining handlers, IDs, translations and permission visibility. Jobs routes its sidebar through a small opt-in CMS navigation interface (`navigation:false`, guarded `navigate`, `navigationState`, `onNavigationChange`). The normal internal CMS navigation remains the default for other hosts. Busy state, capability checks and dirty-leave confirmation still apply.

| Preference | Storage and bounds |
| --- | --- |
| Home editor | Existing `gary-editor-workspace:v1:gary-home:<workflow>` keys; width/maximized state are per workflow. |
| Visa sidebar | `gary-visa:staff-sidebar:v1`; width 220–380px, additionally bounded to leave 520px for content; collapsed rail 76px. |
| Jobs sidebar | `gary-jobs:staff-sidebar:v1`; width 216–384px, additionally bounded to leave 640px for content when feasible; collapsed rail 68px. |
| Visa/Jobs editors | Existing `gary-editor-workspace:v1:...` keys and modal sizing behavior remain separate from sidebar preferences. |

Sidebar preferences contain presentation only: width, collapse and nested disclosure state. Resizing or collapsing navigation changes layout variables without replacing forms, inputs or file nodes. Denied/corrupt browser storage falls back safely. Editor and navigation dimensions do not reset each other.

Visa uses a compact navigation disclosure at 900px and below. Jobs uses a rail/overlay below 1060px and a compact top entry on phones (520px and below). Drag handles hide where resizing is impractical. Mobile navigation keeps desktop preferences. Both platforms retain all permitted icon destinations when collapsed.

## Accessibility and themes

- Resize separators have localized accessible labels and support arrow keys, larger Shift increments, Home and End. Expand/restore controls retain localized labels.
- Native disclosure/button semantics, active `aria-current` states, mobile focus return and Jobs overlay Escape handling are preserved or added. Existing editor focus traps, Escape/close guards and opener restoration remain in place.
- Narrow forms use the existing responsive/modal behavior; Home adds drawer-scoped layout rules. Header and actions stay reachable while the form body scrolls.
- Sidebar and Home drawer styling support light/dark and reduced motion. Visa's new dark treatment is deliberately sidebar-scoped; its existing light content area and modal styling remain. Jobs' existing light CMS cards/modal surfaces likewise remain within the themed staff workspace.
- Central Access Portal Revision 2 is untouched.

## Changed files by platform

### Home

- `components/editor-modal.tsx`, `app/editor-drawer.css`: drawer shell and presentation around current form children.
- `shared/editor-workspace/index.js`, `index.d.ts`: optional drawer geometry, resize edges and initial width; default modal behavior retained.
- `shared/cms-foundation/index.js`, `index.d.ts`: canonical opt-in external navigation interface used by Jobs; defaults unchanged.
- `tests/editor-modal.test.mjs`: drawer options, state preservation, close/focus guards and geometry/preferences.
- `scripts/build-home-drawer-qa.mjs`: local visual fixture using current AdminPage, unchanged sidebar and current property editor.
- `docs/home-drawer-restoration.md`, this report.

### Visa

- `dist/staff-sidebar.js`, `dist/staff-sidebar.css`: enhancement of existing staff navigation, independent sizing, disclosure, persistence, responsive/theme styles.
- `dist/portal.html`: loads the enhancement.
- `dist/editor-workspace/index.js`, `index.d.ts`: vendored shared controller update; Visa stays on its default modal path.
- `scripts/staff-sidebar.test.mjs`, `scripts/site.test.mjs`, `package.json`: sidebar regressions and integration in the normal test run.
- `docs/staff-sidebar-refinement.md`.

Visa's `portal.js`, its form/editor implementation and pinned CMS implementation are unchanged.

### Teaching Jobs

- `dist/jobs-staff-sidebar.js`, `dist/jobs-staff-sidebar.css`: grouped navigation, independent geometry/preferences and responsive/theme styles.
- `dist/jobs-portal.js`, `dist/portal.html`: permission-filtered destinations and existing CMS/recruitment integration.
- `dist/cms-foundation/index.js`, `index.d.ts`, `release.json`: opt-in guarded external navigation and updated vendored hash/patch metadata.
- `dist/editor-workspace/index.js`, `index.d.ts`: vendored shared controller update; Jobs stays on its default modal path.
- `tests/jobs-staff-sidebar.test.mjs`, `tests/helpers/jobs-staff-portal.mjs`: real portal/CMS/sidebar integration using test adapters.
- `tests/jobs-auth-access.test.mjs`: assertions updated for the new navigation labels; existing access checks retained.
- `tests/jobs-editor-workspace.test.mjs`: regression for Home's optional drawer and unchanged default modal geometry.
- `docs/staff-sidebar-2026-11-17.md`.

## Verification results

| Check | Result and coverage |
| --- | --- |
| Home `node --test tests/editor-modal.test.mjs tests/cms-foundation.test.mjs` | **8/8 passed**. Shell state, EN/VI refresh, current upload/error/form nodes, close/focus guards, default CMS compatibility. |
| Home targeted `tests/studio-recovery.test.mjs` selection | **10/10 passed**. Slow uploads with concurrent edits, profile upload/save errors, branch drafts, guide bilingual upload/publish, unsaved CRM notes, original filenames, upload retry and cancellation. |
| Home TypeScript | `tsc --noEmit --incremental false` passed. |
| Jobs `npm test` | **181/181 passed**, including sidebar/capability/candidate compatibility, dirty-leave refusal, create/save/publish after sidebar changes, media file submission, and shared editor geometry/state/persistence. Database tests use the suite's local test database, not production. |
| Jobs `npm run build` | Passed JavaScript syntax, 76 asset references and 58 supplied photos. |
| Visa `npm test` | **90/90 passed**, including original navigation node identity/handlers, permission visibility, customer restoration, sidebar/editor independence with unsaved text and selected files, persistence and mobile behavior. |
| Visa `npm run test:cms` | **15/15 passed**. Existing CMS validation, save/publish, dirty state and modal resize/maximize behavior. |
| Visa `npm run check` | Passed 2 pages, 49 asset references, labels, links, translations and public-client configuration. |
| Shared controller consistency | `node scripts/sync-editor-workspace.mjs --check` passes for both vendored copies. |
| Whitespace/integrity | `git diff --check` passes in all three repositories. |

The controller tests cover desktop drag/keyboard resize, maximize, restore, mobile fullscreen, viewport bounds, preserved form/file/error node identity, submission after geometry changes, remembered workflow geometry and maximized state, and unchanged eight-handle default modal behavior. Sidebar tests additionally prove independent preferences and form preservation through navigation layout changes. Home's browser fixture confirmed actual property form scrolling and usable sticky actions; desktop keyboard resizing, fullscreen and restoration retained the preferred width.

Successful Jobs publishing was exercised through the actual portal/CMS UI logic with a test adapter: fill one complete vacancy, resize/collapse navigation, press Publish, assert one save and one transition to `published`. Media submission likewise retained the selected file. This is an integration publishing test, not a production browser-to-database publication.

## Screenshot evidence

[Open the screenshot gallery](../../visual-verification/2026-11-17-staff-workspaces/README.md) or [the contact sheet](../../visual-verification/2026-11-17-staff-workspaces/contact-sheet.jpg).

| Platform | Desktop light | Desktop dark | Mobile light | Mobile dark |
| --- | --- | --- | --- | --- |
| Home | [PNG](../../visual-verification/2026-11-17-staff-workspaces/home-desktop-light.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/home-desktop-dark.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/home-mobile-light-page.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/home-mobile-dark-page.png) |
| Visa | [PNG](../../visual-verification/2026-11-17-staff-workspaces/visa-desktop-light.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/visa-desktop-dark.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/visa-mobile-light-page.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/visa-mobile-dark-page.png) |
| Jobs | [PNG](../../visual-verification/2026-11-17-staff-workspaces/jobs-desktop-light.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/jobs-desktop-dark.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/jobs-mobile-light-page.png) | [PNG](../../visual-verification/2026-11-17-staff-workspaces/jobs-mobile-dark-page.png) |

Also captured: [Home maximized editor](../../visual-verification/2026-11-17-staff-workspaces/home-desktop-maximized.png).

Screenshots were captured in native Chrome using isolated local fixtures and demo data, with actual application markup/styles/controllers. Desktop is approximately 1728 CSS pixels wide; mobile uses Chrome's iPhone 16 viewport, 393 × 852 CSS pixels. Home uses the actual current AdminPage/sidebar/property editor. Jobs uses the actual portal/CMS/sidebar with mocked service adapters. Visa uses the actual portal markup/sidebar/CMS/editor controllers with fixture view switching. These are visual evidence of the frontend implementation, not authenticated production sessions.

## Compatibility and remaining limits

No SQL or migration is required for this frontend task. The previous vacancy SQL was already successfully applied by the user and is unchanged here. APIs, authorization, RLS, authentication, database schemas and publishing contracts are untouched. Existing records and published content do not need conversion.

The work is not deployed. Live authenticated uploads/publishing and a full Home test suite were not run for this task; Home verification is the targeted coverage listed above. Existing unrelated Home routing-suite failures previously reported are outside this change. Dark styling on Visa remains scoped to its enhanced sidebar, and existing CMS content/modal palettes on Visa/Jobs were preserved.

Minor Jobs behavior: on constrained screens, selecting a destination closes the navigation overlay even if the editor's dirty-leave confirmation is declined. The current editor, draft and active destination remain intact. Final independent review found no concrete permission or form-state regression; no known blocker remains in the exercised frontend workflows.
