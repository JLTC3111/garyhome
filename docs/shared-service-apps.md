# Shared Gary apps and services

Home, Jobs and Visa use one browser component released by Gary Home. The canonical source is `shared/gary-apps/`: `catalogue.ts`, `gary-apps.tsx` and `styles.css`. Update those files to change the links, English/Vietnamese copy, menu, directory, accessibility behavior or common presentation across the network.

| Site | Address | Integration |
| --- | --- | --- |
| Gary Home | https://garyhome.vn/ | `components/service-apps.tsx`: public header, mobile navigation, Staff Studio and services directory |
| Gary Jobs | https://jobs.garyhome.vn/ | `src/components/GaryAppsMount.jsx`: desktop and mobile header |
| Gary Visa Service | https://visa.garyhome.vn/ | `dist/gary-apps.js`: marketing desktop/mobile and customer/staff portal |

Travel links to Jobs' **Life beyond the classroom** section. Each site marks its own service as current and uses relative links for it; other sites open in a new tab with `noopener noreferrer`. Language follows the host site. Menu callbacks continue to close the surrounding mobile navigation. No authentication, customer data or credentials are shared.

## How a release reaches every site

1. `npm run build:gary-apps` bundles the canonical React component and its dependencies into a standalone ES module. The same build emits a matching stylesheet, scoped to that release so it cannot restyle an older, open menu.
2. Both filenames contain the same content-derived release hash. A public `manifest.json` points to that exact pair under `/shared/gary-apps/v1/`.
3. Each site uses the small `client.js` protocol adapter to fetch `https://garyhome.vn/shared/gary-apps/v1/manifest.json`, then loads and mounts the matching component. Home previews use their own origin, allowing a release to be reviewed before publishing.
4. The manifest is fetched without browser caching or credentials. Home supplies revalidation and public CORS headers. All mounts on a page share one manifest request/poll and one copy of each release's assets.
5. New visits receive the current release. Visible, already-open pages check every 60 seconds and when returning to the tab. Open or focused menus defer replacement until the visitor finishes interacting. Hidden tabs check on return. A literal simultaneous change in every browser is not guaranteed.

The runtime contains React and icons, so consumers can use React, Next.js or vanilla HTML without matching framework versions. This isolated root uses native links; the local Home fallback retains Next links and useful server-rendered HTML.

## Publishing and rollback

The first rollout needs **one deployment of each of the three sites**: deploy Home first so the manifest and assets exist, then Jobs and Visa with their adapters and Visa's explicit CSP host permissions. Until that rollout is published, live sites continue using their previous copies.

After the initial rollout, edit the canonical component in Home, verify it, and deploy **Home only**. Jobs and Visa pick up the shared release without rebuilding or redeploying their sites. `predev`, `prebuild` and `prebuild:vercel` generate the release automatically. Generated files live in ignored `public/shared/gary-apps/v1/`; do not edit them by hand. Use the existing Home deployment pipeline and publish the manifest and its matching files in the same deployment.

Rollback the Home deployment to restore its earlier manifest/component pair. Consumers detect the older release through the same polling mechanism. If publishing assets separately from the site, upload both hashed assets before changing the manifest and retain previous hashed assets for in-flight requests. The generator preserves old files already present in its output directory; clean deployment environments must restore earlier assets explicitly if needed.

## Fallback and host layout

Each site retains an offline snapshot of the existing menu. It stays usable while the first release loads, if the network is unavailable, if CSP blocks the host, or if an invalid manifest/asset fails. After a successful mount, a failed refresh keeps the last working release. The loader stages a new root before removing the previous one and cleans up timers, roots and stylesheet references on unmount.

Header placement, responsive breakpoints and local typography/background overrides stay with each site's layout. Shared menu content, behavior and base styling come from Home. A central failure can leave a visitor on an older component or the offline snapshot; updates resume when loading succeeds.

`client.js` is a deliberately small, stable protocol adapter copied into Jobs (`src/gary-apps/client.js`) and Visa (`dist/gary-apps-client.js`). Routine component/catalogue/style edits do not change it. If changing that adapter or the v1 protocol, sync and deploy the adapters deliberately; incompatible protocols require a new versioned path. Local component copies are fallback snapshots and should not become a second source for normal edits.

## Verification

Home: `npm test`, `npm run typecheck`, `npm run build:vercel`. Jobs: `npm run test:shared`, `npm run build`. Visa: `npm test`, `npm run build`. During integration QA, serve one Home release to all adapters and check English/Vietnamese, relative links/current-site labels, keyboard operation, failed first loads, failed subsequent refreshes, and deferred release changes/rollback.
