# Gary CMS foundation 1.0.0

Framework-neutral editor, design tokens, and EN/VI issue presentation. This module has no Supabase SDK, credentials, routes, global administrator, or database connection. Applications supply their own adapters; all permissions and state transitions must also be enforced in their databases.

## Independent releases

Canonical source is this directory in the Home repository. Agency and Teaching Jobs hold tracked copies under their own `dist/cms-foundation/`, with a version/hash in `release.json`. Their builds and deployments do not import Home remotely, require a sibling repository, or update automatically when Home changes.

From a maintainer workspace with all three repositories:

```sh
node scripts/sync-cms-foundation.mjs
node scripts/sync-cms-foundation.mjs --check
```

Review and release each application's copied version independently. Changes to domain schemas, memberships, Auth settings, public routes, or storage rules are not part of this sync.

## Mount contract

```js
import {mountCms} from './cms-foundation/index.js';
const cms = mountCms(root, {
  appId: 'visa', appName: 'Gary Agency', language: 'vi',
  collections, adapter,
});
await cms.ready;
cms.setLanguage('en');
if (cms.canLeave()) cms.destroy({force: true});
```

The returned controller exposes `ready`, `isDirty`, `canLeave`, `refresh`, `setLanguage`, and `destroy`. Navigation must respect `canLeave`; signout must call `destroy({force:true})` to clear private state regardless of unsaved work. Browser history requires the same guard as tab navigation. Owned CMS actions stop event propagation to avoid colliding with host queue controls.

An adapter supplies:

- `capabilities()` -> `{read,edit,publish,media,role}`. Initial access is denied until verified.
- `list({kind,query,status,page,pageSize})` -> `{records,total}`. Pages are one-based.
- `save(record,{expectedVersion})` -> persisted normalized record.
- `transition(id,status,{expectedVersion})` -> persisted record. Publishing is available only after review.
- `revisions(id)` -> immutable revision descriptors.
- `restore(id,revisionId,{expectedVersion})` -> a new working draft.
- `listMedia()` and `uploadMedia(file,{alt_en,alt_vi})`.
- Optional `mediaPolicy: {mimeTypes,maxBytes}` and `errorText(error,language)` for app-specific, localized recovery guidance.

Record fields and type declarations are in `index.d.ts`. Custom collection fields support `data.*` paths or bilingual declarations that expand to `data.<key>_en` and `_vi`. `requireBody:false` is available for taxonomy/profile collections. Publication requires complete bilingual content; server-side app validation remains authoritative.

Collections may opt into `automaticSlug:true` and a `publicPath` such as `/jobs/`. This removes the manual Page Address control and derives a new draft's URL name with `titleSlug(record)` from its English title, falling back to Vietnamese. Existing saved URL names remain stable. The application's adapter must resolve duplicate names and return the persisted name; the shared UI does not reserve URLs or override database uniqueness and permissions. Manual-address collections retain their existing behavior. This optional policy is pinned in the Jobs release independently of Agency's existing copy.

Saving never implies publication. Each application maintains a separate public snapshot, so editing or restoring a draft does not remove or alter the live copy. Shared UI handles stale-version errors without discarding the draft. Media policy is app-specific; editorial images must never be mixed with private visa documents or candidate CVs. This release deliberately omits destructive media deletion until usage tracking exists.

## SEO findings

`contentSeoFindings` returns stable codes, parameters, severity, and category for draft checks. These are advisory content checks, not a crawl of the published website or a search-ranking prediction.

`seo-findings.js` is the single presentation catalogue used by the shared editor and Home SEO interface/full/summary report renderers:

```js
const finding = {
  id: 'technical-http', code: 'technical-http',
  params: {status: 404}, severity: 'critical',
  category: 'technical', schemaVersion: 1,
};
localizeFinding(finding, 'vi');
```

IDs remain stable for scoring and historical deduplication. Presentation never rewrites evidence, severity, or score. Older English fields remain readable, while known code-only findings resolve in either language. Unknown future codes receive explicit localized fallback guidance. A UI acknowledgement must not be presented as a verified fix; Home uses rescans for verification.

## Verification

Core validation/issue tests are in Home's `tests/cms-foundation.test.mjs`. DOM interaction, unsaved drafts, conflict retention, permission denial, review gates, event ownership, and teardown are tested in Agency's `scripts/shared-cms.test.mjs` against the app-local vendored release. Each application's separate database tests verify its server-side permissions and workflow contracts in an in-memory database.
