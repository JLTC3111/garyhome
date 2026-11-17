# Persistent editor workspaces

Gary Home's existing listing drawer is the reference for the shared editor workspace controller used by Home, Teaching Jobs, and Visa. The controller changes only modal geometry and header controls. It never replaces form inputs, copies files, submits, or serializes form data.

## Home inventory

| Workflow | Implementation | Preference key suffix |
| --- | --- | --- |
| Create/edit property listing, including photos/video and SEO | `EditorModal` in `components/admin-page.tsx` | `gary-home:property` |
| Create/edit neighbourhood | `EditorModal` in `components/admin-page.tsx` | `gary-home:neighbourhood` |
| Edit enquiry/conversation, schedule and internal notes | `EditorModal` in `components/admin-page.tsx` | `gary-home:enquiry` |
| Owner guide editing, EN/VI text and visual uploads | `components/portal-guide-editor.tsx`, same `EditorModal` wrapper | `gary-home:guide` |
| Staff profile/photo/password editing | `components/staff-profile.tsx`, same `EditorModal` wrapper | `gary-home:staff-profile` |

Articles/rental tips, site settings, team access, customer records, and account forms are existing inline page workspaces; no modal size constrains them. They remain inline. Delete confirmations, a temporary-password security prompt, photo/video galleries, notifications, preferences, and favourites are compact prompts or read-only surfaces rather than substantial content editors, so they retain their existing behavior.

## Behavior

- Eight edge/corner handles resize within the viewport. Minimum desktop workspace is 640×400 pixels where the viewport permits, with 12-pixel outer margins.
- Header maximize/restore controls use the shared EN/VI labels. Normal width/height and maximized state persist under `gary-editor-workspace:v1:<workflow key>` in local storage. Storage denial/corruption falls back safely. Saved preferences contain size/state only, never form content.
- Mobile screens at or below 720 pixels use the usable viewport automatically and do not overwrite the desktop preference. Visual viewport changes are respected when a phone keyboard opens.
- Header controls remain outside the independently scrollable form body. Save/cancel action bars remain sticky inside the body. Container queries stack field grids when editors narrow, independently of browser viewport width.
- Resize/maximize does not remount React form components. Draft inputs, file controls, validation errors, upload progress, state, and existing submission/close guards remain in place. Escape and overlay closing use the existing guarded callback; keyboard focus is contained and restored on close. Handles support arrow keys, Shift for larger steps, and Home/End sizing.

## Files

Shared controller/geometry/CSS: `shared/editor-workspace/`. Home adapter: `components/editor-modal.tsx`, `app/editor-drawer.css`, and the shared stylesheet import in `app/layout.tsx`. Workflow integration: `components/admin-page.tsx`, `components/portal-guide-editor.tsx`, `components/staff-profile.tsx`.

No database, permission, publication, validation, or upload service logic was changed.

## Verification

`tests/editor-modal.test.mjs` checks the shared controller integration, stable form/upload/error nodes on locale refresh, guarded Escape/overlay behavior, all eight constrained resize directions, mobile bounds, and persisted preference validation. Targeted `studio-recovery.test.mjs` runs cover real property upload/edit flows, guide editing/upload/publication, profile saves and failures, conversation state, upload retry, and cancellation. Geometry/controller browser rendering is verified separately by the cross-platform task owner.

Local results: 4/4 editor shell/geometry tests, 9/9 targeted recovery/upload/submission tests, TypeScript `tsc --noEmit`, and `git diff --check` pass. The larger editor/recovery run reports 129/142 passing; its 13 URL/navigation expectation failures were reproduced with the original pre-change Home React sources, so they are existing test drift (www origin and language-prefixed routes), not workspace regressions. No source or tests for those unrelated routes were changed.

The shared controller is vendored to the two static applications using `node scripts/sync-editor-workspace.mjs`; `--check` verifies byte-identical geometry, behavior, types, and CSS. The CMS foundation imports that same controller. Visa's existing recoverable-delete extension and Jobs' existing vacancy-publishing extension remain intact; the foundation is not blindly copied over either application.
