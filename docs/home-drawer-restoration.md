# Home right-side editor restoration

## Git evidence

The original drawer was traced through local Git history:

| Commit | Date | Evidence |
| --- | --- | --- |
| `6e1f5aed3946d1002393b9e5a693706df167d811` — Build Gary Home website and Supabase CMS | 22 October 2026 | Introduced the inline `EditorModal` in `components/admin-page.tsx` and `.editor-overlay` / `.editor-drawer` in `app/globals.css`. Presentation was right aligned, full height, approximately 700px wide, with a sticky header. |
| `95bda28bfea229a87332cea5707d45c25b7f4ef6` — updates Nov 6 | 6 November 2026 | Extracted `components/editor-modal.tsx`, introduced `app/editor-drawer.css`, widened the property drawer to 1120px, and added left-edge width resizing and fullscreen/restore. Its commit explicitly records “Wider listing editor, draggable left edge, full-screen toggle and flowing border.” |
| `ad94bb390695616058672827986688aa06822e50` — updates Nov172026 | 17 November 2026 | Replaced the drawer's sizing behavior with the generic cross-platform workspace controller: inset, rounded modal geometry and all-edge resizing. Modern form content, sticky actions and upload/state protection remained. |

The restoration uses the earlier presentation as a reference rather than checking out old components. Current `admin-page.tsx`, property fields, video/photo upload logic, EN/VI controls, SEO panels, validation, autosave, publishing, and navigation are not reverted.

## Current implementation

`EditorModal` opts into `presentation: 'drawer'` and `resizeEdges: ['w']` on the existing sizing controller. The default controller presentation remains the existing Visa/Jobs modal. The Home drawer:

- Attaches to the right edge and occupies the full usable viewport height.
- Defaults to 1120px for property editing and the original narrower 740px presentation for other Home editors, unless an existing workflow preference is present.
- Resizes only from its left edge, with a keyboard-accessible grip and 640px minimum where space permits. Normal mode leaves at least a 24px strip of the underlying workspace; maximizing covers the usable viewport.
- Keeps mobile editing fullscreen at widths of 720px or less, without overwriting the preferred desktop width or maximized state.
- Keeps the header outside the independent scrolling form area and retains the current sticky Save/Cancel bars. Container queries reflow current fields at narrow drawer widths.
- Reuses the existing preference keys `gary-editor-workspace:v1:gary-home:<workflow>`, independent of navigation state.
- Changes geometry without remounting forms or replacing input/file elements. Existing focus trap, opener restoration, close guards and Escape behavior remain.
- Restores a restrained right-side shadow and slide-in presentation. Reduced-motion disables the entry animation. The existing `data-home-theme=dark` preference changes only the drawer's scoped palette; Home navigation and branding remain untouched.

Affected editor shells: property listings, neighbourhoods, enquiry/conversation editing, owner guides, and staff profile editing. Existing full-page article/rental-tip and settings workspaces remain full-page.

## Changed files

- `components/editor-modal.tsx`: selects the Home drawer presentation and left-only width resizing around existing children.
- `app/editor-drawer.css`: restores attached, square, full-height presentation and scoped light/dark styling.
- `shared/editor-workspace/index.js` / `index.d.ts`: adds optional drawer sizing, handle selection, and initial width without changing the default modal path.
- `tests/editor-modal.test.mjs`: verifies Home-specific controller options, persistent form/upload/error nodes, narrow-content default width, focus restoration, and close guards.
- `scripts/build-home-drawer-qa.mjs`: builds a local file-backed visual fixture from the actual current AdminPage, sidebar, EditorModal and PropertyEditor. Only framework/context/service-menu dependencies are fixture adapters; no live login/database/publication occurs.
- This report.

## Verification

- `node --test tests/editor-modal.test.mjs`: **5 passed**.
- `tsc --noEmit --incremental false`: passed.
- Targeted `studio-recovery.test.mjs` run: **10 passed**, including slow uploads with concurrent edits, profile upload/save errors, branch disclosures retaining drafts, guide bilingual upload/publish, unsaved CRM notes, original filenames through save/reopen, upload retry and cancellation on closing.
- `git diff --check`: passed.

The cross-platform owner verifies the actual controller's drawer geometry and unchanged default modal geometry using the existing DOM tests, and captures desktop/mobile browser screenshots.

## Local screenshot fixture

Run `node scripts/build-home-drawer-qa.mjs`, then open `file:///private/tmp/gary-home-drawer-qa/index.html`. The actual unchanged Home staff sidebar is present. Open **Rentals & content → Listings**, then select an existing listing or New listing to display the actual current form in the restored drawer. Add `?theme=dark` and/or `?lang=vi` to the fixture URL for those variants. Uploads/saves use Home's browser demo behavior only.
