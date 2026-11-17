# Recruitment section and cross-platform editor workspaces

Implemented locally on 17 November 2026. No website was deployed, and no database, permission, or publishing-service changes were made for this UI task. The user subsequently confirmed successful application of the earlier vacancy-publication migration. Website deployment remains pending.

## Recruitment section

The Teaching Jobs recruitment photo is replaced by a semantic ordered recruitment journey: **Connect → Get Guidance → Find Your Fit → Move Forward**. The four connected cards use subtle lavender, fine borders, restrained glass surfaces, and the site's existing typography and icons. Desktop keeps its original two-column layout; mobile stacks the content and diagram without horizontal scrolling. The three benefit statements retain their existing EN/VI text. Headings, descriptions, and icons have independently defined light/dark palettes, including brighter dark-mode benefit headings. No animation was added; existing reduced-motion behavior is preserved.

The exact recruitment section headline and eyebrow are identical across themes:

- EN eyebrow: `A LITTLE LOCAL KNOWLEDGE GOES A LONG WAY`
- EN headline: `A recruitment team. In your corner.`
- VI eyebrow: `HIỂU ĐỊA PHƯƠNG, ĐỒNG HÀNH LÂU DÀI`
- VI headline: `Đội ngũ tuyển dụng. Luôn đồng hành.`

Audit found these recruitment strings were already unconditional. The actual theme-conditioned headline was the hero above it. That hero now consistently uses the exact existing dark-mode variant, **“Build your career. Explore a new culture.”**, and its existing shared eyebrow **“VIETNAM ENGLISH TEACHING JOBS”** in both themes. Its existing Vietnamese dark-mode translation is likewise shared. The obsolete light headline and theme-triggered headline update were removed. The static/loading fallback matches the shared headline and eyebrow. Theme switching now changes presentation without rewriting either message.

## Editor inventory and implementation

| Platform | Substantial create/edit workflow | Shared workspace integration |
| --- | --- | --- |
| Home | Property listing, photos/video, SEO | `EditorModal`, key `gary-home:property` |
| Home | Neighbourhood listing | `EditorModal`, key `gary-home:neighbourhood` |
| Home | Enquiry/conversation, scheduling and internal notes | `EditorModal`, key `gary-home:enquiry` |
| Home | Owner guide, bilingual text and visual uploads | Same `EditorModal`, key `gary-home:guide` |
| Home | Staff profile/photo/password form | Same `EditorModal`, key `gary-home:staff-profile` |
| Teaching Jobs | CMS vacancies, employers, categories, locations, guides, FAQs | Existing CMS modal, key `jobs:cms:<kind>` |
| Teaching Jobs | Public fallback application email composer | Existing detail dialog only while it contains the application form; key `jobs.application-email` |
| Visa | CMS services, eligibility, documents, processes, FAQs, articles/guides, landing content | Existing CMS modal, key `visa:cms:<kind>` |
| Visa | Service application create/edit | Existing request dialog; key `visa.application` |
| Visa | CRM contact create/edit | Existing contact editor; key `visa.contact` |
| Visa | Case workspace: messages, documents, private notes and status | Existing tabbed case dialog; key `visa.case` |
| Visa | Relationship/contact details and notes | Existing CRM detail dialog; key `visa.relationship` |

Home articles/rental tips, settings, team/customer/account forms, Jobs candidate applications/CV uploads and recruitment forms, and Visa's inline public enquiry/account forms already occupy normal page workspaces and remain inline. Compact authentication/security prompts, deletion confirmations, preferences, read-only service/media dialogs, and the nonmodal chat widget are not substantial editing modals and retain their existing behavior.

Gary Home's property drawer was the reference: it previously supported left-edge width resizing and an optional fullscreen toggle. The new reusable controller extends that approach with all eight edges/corners, remembered width/height/maximized state, keyboard controls, viewport bounds, and a consistent header button across all listed workflows.

## Behavior and preservation

- Resize from any edge/corner. Minimum desktop workspace is 640×400 where space permits; all edges remain within the viewport with 12px desktop margins. Maximized editors fill that usable viewport. Mobile widths ≤720px use the entire usable viewport automatically, with no drag handles.
- A visible, localized maximize/restore button appears in each editor header. On mobile it indicates the already-fullscreen state. Keyboard handles support arrow keys, Shift for larger steps, and Home/End sizes.
- Headers remain outside the independently scrolling body. CMS and Visa create/edit forms keep actions outside that body; Home forms retain sticky action bars. Save/submit and Cancel/Close stay accessible. Case tabs keep conversation/document lists independently scrollable and compose/upload actions accessible.
- Size and maximized preference persist in local storage under `gary-editor-workspace:v1:<workflow key>`, shared across records of the same workflow. Preferences contain geometry/state only, never draft text, files, credentials, or form content. Mobile's automatic fullscreen does not overwrite the saved desktop preference. Blocked/corrupt storage falls back safely.
- Resizing/maximizing changes geometry only: no form cloning, innerHTML replacement, component remount, submission, reset, or draft serialization. Drafts, selected uploads, progress, exact errors, current tabs and native validation remain attached to their existing form nodes and state. Existing autosave, close guards, unsaved warnings, Escape handling, focus trap/restore, and submission functions remain in control.
- Field grids respond to editor width through container queries as well as viewport media queries. Body and action bar spacing stays usable when narrowed. EN/VI control labels refresh without changing preferences.

## Changed-file summary

Paths below are relative to the named project. This list describes this UI task; earlier vacancy-publication changes and unrelated concurrent navigation/localization edits remain separate.

| Project | Files |
| --- | --- |
| Home shared implementation | `shared/editor-workspace/{geometry.js,index.js,index.d.ts,styles.css}`, `scripts/sync-editor-workspace.mjs` |
| Home React workflows | `components/editor-modal.tsx`, `admin-page.tsx`, `portal-guide-editor.tsx`, `staff-profile.tsx`, `app/editor-drawer.css`, `app/layout.tsx` |
| Home CMS source | `shared/cms-foundation/index.js`, `styles.css` (imports shared controller and adds body/actions shell) |
| Home tests/docs | `tests/editor-modal.test.mjs`, `tests/studio-recovery.test.mjs`, `docs/editor-workspaces.md`, this report |
| Jobs shared workspace | `dist/editor-workspace/{geometry.js,index.js,index.d.ts,styles.css}` |
| Jobs CMS adapter shell | `dist/cms-foundation/index.js`, `styles.css`, `release.json` |
| Jobs recruitment/theme content | `dist/app.js`, `index.html`, `styles.css`, `jobs-public-theme.css` |
| Jobs application composer | `dist/jobs-public-editors.js`, `jobs-public-editors.css`, corresponding `index.html` imports |
| Jobs tests | `tests/jobs-editor-workspace.test.mjs`, `jobs-public-editors.test.mjs`, `jobs-career-landing.test.mjs`, `jobs-section-theme.test.mjs` |
| Visa shared workspace | `dist/editor-workspace/{geometry.js,index.js,index.d.ts,styles.css}` |
| Visa CMS adapter shell | `dist/cms-foundation/index.js`, `styles.css`, `release.json` |
| Visa portal integration | `dist/portal-editors.js`, `portal-editors.css`, `portal.js`, `portal.html` |
| Visa tests | `scripts/portal-editors.test.mjs`, `site.test.mjs`, `workspace.test.mjs`, `package.json` test command |

The Home source is canonical. The synchronization script vendors byte-identical controller/geometry/types/CSS into Jobs and Visa; `--check` detects drift. Each application keeps its existing CMS-specific extensions. No application was overwritten by a different application's CMS version.

## Verification

Automated controller and integration coverage includes pointer resizing, all edge/corner bounds, keyboard resizing, maximize/restore, per-workflow persistence/reopening, mobile fullscreen, viewport changes, independent scrolling shell structure, retained form/input/file identity, selected files, validation errors, dirty-leave guard, language changes, real form submission, and teardown/capture cleanup. Existing upload, case-message, CRM, guide/profile, and vacancy publication tests remain applicable.

Recruitment tests assert exact headline/eyebrow equality through theme switches in EN/VI, all four stage names/order, unchanged benefit statements, responsive CSS at 360/390/720/1000/1440px, and text contrast ≥4.5:1 in both palettes.

Native Chrome browser review used local fixtures built from the actual application markup, CSS, and shared controller (no production data or live submissions). Verified desktop editor maximize/restore, keyboard resizing 1120px →1104px, unsaved text retention, fixed header/action bar, and independent body scrolling. iPhone 16 emulation at 393×852 verified fullscreen, hidden drag handles, single-column fields and accessible bottom actions while scrolling. Recruitment light/dark desktop and dark mobile layouts were visually reviewed, with identical accessibility headline/eyebrow content across theme changes and stacked mobile cards. The connected browser host was unavailable, so these checks used native Chrome UI and file-backed fixtures rather than a production session.

Home's broader studio test run had 13 URL/navigation expectation failures; all were reproduced against original pre-change sources (www-origin/language-route test drift). The targeted editor tests, uploads, saves, errors, and cancellation checks pass. These unrelated navigation assertions were not changed.

## Earlier function-only migration clarification

The file is `gary_jobs/gary-teaching-jobs/supabase/migrations/20261117102706_simplify_vacancy_publication.sql`. It belongs to the preceding vacancy-publication fix, not this UI work. It replaces `jobs_private.check_publication` and `jobs_private.transition_content` to remove publication dependencies and return field-specific validation errors. It does not alter tables, records, permissions, or RLS. The user has confirmed that it was successfully applied remotely. No new migration is needed for the recruitment diagram or editor workspace changes.

Final checks:

| Check | Result |
| --- | --- |
| Teaching Jobs `npm test` | **175 passed, 0 failed** |
| Teaching Jobs `npm run build` | Passed; 76 asset references and 58 supplied photos checked |
| Visa `npm test` | **84 passed, 0 failed** |
| Visa `npm run test:cms` | **15 passed, 0 failed** |
| Visa `npm run check` | Passed; 2 pages and 47 asset references checked |
| Home editor shell + default shared CMS checks | **7 passed, 0 failed** |
| Home targeted recovery/upload/submission checks | **9 passed, 0 failed** |
| Home `tsc --noEmit` | Passed |
| Home broader editor/recovery tests | 129/142; all 13 unrelated navigation failures reproduced on original sources |
| Shared workspace `sync-editor-workspace.mjs --check` | Passed; static copies byte-identical to canonical source |
| `git diff --check` | Passed in all three repositories |
| Native Chrome local fixture review | Desktop + 393×852 mobile; recruitment themes and editor scrolling/actions verified |

CMS close/Escape additionally restores keyboard focus to the relevant workspace control after list refresh. Home captures the opener before commit-time autofocus and restores that original connected opener on close. These focus changes do not alter close guards or unsaved-change handling.
