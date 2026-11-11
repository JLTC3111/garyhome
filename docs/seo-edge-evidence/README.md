# Property listing renderer hang

The original diagnosis and temporary-guard experiments below predate deployment. Later **actual production browser regression results** are recorded in `production-browser-regression.json` and the final section; those release checks used fresh documents with `guard=false`.

The Tứ Liên listing hang was reproduced in the actual native Microsoft Edge application on 10 November 2026. This was an existing normal profile displaying Vietnamese content, with DevTools open before direct navigation. Device emulation was disabled; Network had no throttling and disabled cache.

The page delivered its listing and completed its network activity in approximately 3.98 seconds, yet gallery/menu actions did not respond. Console showed no JavaScript errors or warnings. An ordinary `1 + 1` Console evaluation only returned after F8 paused page execution. The paused stack was the `DocumentTitle` MutationObserver callback in production layout chunk `layout-5eac3e655b6ea61b.js`, module 49927:

```js
n && document.title !== r && (document.title = r)
```

Evaluating the paused frame's values confirmed the difference:

```json
{
  "wanted": "Cho thuê căn hộ 2 phòng ngủ tại Tứ Liên, Tây Hồ · 90m² ·  Ban công | Gary Home",
  "actual": "Cho thuê căn hộ 2 phòng ngủ tại Tứ Liên, Tây Hồ · 90m² · Ban công | Gary Home",
  "equal": false
}
```

The authored title has two ASCII spaces before “Ban công”. The HTML `document.title` getter collapses such whitespace. Repeatedly setting the raw value therefore never satisfies the observer's equality check and queues another title mutation. This unbounded mutation/microtask loop blocks page input and pending initialization tasks. The evidence establishes a content- and locale-dependent application bug; it does not establish an Edge-specific browser defect, cache problem or extension cause.

The normalization behavior is also specified by the [HTML Standard's document.title getter](https://html.spec.whatwg.org/multipage/dom.html#document.title). This supports the mechanism; it does not replace actual Chrome or clean-profile verification.

`components/document-title.tsx` now collapses HTML ASCII whitespace before comparing or writing the browser title. The authored CMS value, URLs and page content remain unchanged. A regression using React StrictMode and a browser-normalizing title property delivers the observer 100 times without a second mutation, preserves the raw CMS title and settles correctly after late framework metadata.

Validation command: `node --test tests/document-titles.test.mjs` (8 passed). The complete structured evidence and test-matrix limitations are in `renderer-hang.json`.

An initial temporary tab-memory setter guard was attempted to validate recovery live. Native UI control then lost its window handle (`cgWindowNotFound`) for both Edge and Chrome, including after a CUA kernel reset. Recovery could not be observed during that initial attempt. The controlled follow-up below records the later successful guard verification. Neither experiment was a deployment.


## Recovered native-browser follow-up (11 November)

Native control later recovered. A fresh **Edge InPrivate** session loaded the unprefixed listing in English, and its gallery opened and closed normally. Locale-only inspection found both the language cookie and localStorage set to `en` after initialization.

In the same tab, Console confirmed installation of a temporary native-title setter guard. The UI then switched to Vietnamese. The Vietnamese gallery opened and remained responsive despite the authored double-space title. This is direct browser evidence for the guard's mechanism, **not** verification of the source fix on a deployed release. The current deployed legacy language switch kept the address unprefixed; the source changes address that separately.

Credential-free fetches from the browser independently verified both `/en/homes/2-bedroom-apartment-for-rent-tu-lien-tay-ho` and `/vi/homes/2-bedroom-apartment-for-rent-tu-lien-tay-ho`: HTTP 200, matching server `html lang`, localized title and H1, self-localized canonical, and reciprocal EN/VI plus English x-default links. Response scripts were not executed during this metadata check. The Vietnamese raw server title and H1 retain two spaces before “Ban công”; the English ones do not. Exact results are recorded in `renderer-hang.json`.

A fresh **Chrome Guest** session also loaded the English listing and its gallery responded. After switching to Vietnamese, preferences initially remained responsive. Console confirmed one title element, no guard, `html lang=vi`, a double-space raw title, and a single-space native getter. One deliberately inserted diagnostic comment in `document.head` then triggered the same infinite observer loop: the Console statement stopped before returning and the gallery no longer opened. F8 paused the same production chunk and observer frame; the raw-versus-normalized equality was again `false`. This is a diagnostic reproduction in Chrome, not a claim that ordinary direct Chrome navigation failed naturally. It establishes that a later head mutation exposes the application bug in both tested browsers.

A temporary title setter guard was installed while Chrome was paused. After resuming, the pending Console statement returned and the Vietnamese gallery opened. The guard was confined to the Guest tab and is lost on reload. In an inert HTMLDocument, Chrome also delivered one mutation when its native title setter was given the identical raw double-space title; the native getter continued returning collapsed whitespace.

Browser user agents captured in Console identify **Edge 155** and **Chrome 157** on macOS. UA-reported versions are not full build/channel diagnostics. Subsequent environmental network errors (`ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED`, `ERR_NAME_NOT_RESOLVED`) are separate from the original Edge reproduction, which had no JavaScript errors. Credentials and websocket query parameters are deliberately excluded from saved logs.

A second direct Edge InPrivate navigation to `/en/homes/2-bedroom-apartment-for-rent-in-tay-ho` delivered an English title, header and footer, but remained at `Loading…` while the document stream, one chunk and configuration requests were pending. The debugger pause control was disabled. This run is **incomplete**, not a passing compatibility test and not confirmed to have the title-loop root cause. Full direct/refresh/internal-navigation coverage for multiple listings, cookie permutations, existing-profile extensions, and a deployed source-fix release remains unverified.

## Executive export pagination

The actual generated `output/reports/gary-home-latest-executive-summary.html` was opened in Chrome Guest and rendered through native print preview. The PDF preview reported **2 pages**. Page 1 visually fit its completeness table, independent check-based scores, methodology, action items and footer without clipping; page 2 contained the prioritized distinct findings and limitations. No physical print action was performed. The final native **Save as PDF** export, with browser date/file headers disabled and background graphics enabled, is `output/pdf/gary-home-latest-executive-summary.pdf` (289,440 bytes). `pdfinfo` confirms two A4 pages. This verifies this English evidence fixture's browser pagination, not every possible report/language combination.

## Production rollout regression (11 November)

After the user approved rollout, production alias deployment `dpl_3v4kmnhYfz3X4BPzgM6YCMa1SEJj` (`ce39`) was independently checked in the native browsers. No temporary title guards or prototype patches were installed in these fresh test documents. Console evaluations explicitly returned `guard=false`.

**Edge 155, existing normal profile:** direct navigation to the legacy Tứ Liên URL with a pre-existing Vietnamese locale rendered the listing, completed initialization and opened/closed its gallery. Console had no JavaScript errors or warnings. The original head-comment mutation trigger no longer blocked subsequent Console expressions or native gallery input. The raw authored title still had two spaces, as intended. UI language switching produced `/en/homes/[same-slug]` and `/vi/homes/[same-slug]`; both refreshes returned the matching language, title and canonical, with Console `navigation=reload`. An actual related-listing link opened the Vietnamese Vũ Miên listing and its ten-photo gallery.

**Edge InPrivate:** a new test window loaded `/en/homes/[Tứ-Liên-slug]`, opened the English gallery, switched to `/vi/homes/[same-slug]`, opened the Vietnamese gallery, and survived refresh plus the original diagnostic mutation. New production layout chunk `layout-5dc1246deaf9c42a.js` was observed. Another QA InPrivate window existed, so this is not claimed as a pristine browser profile. For a controlled fresh-locale case, only `gary-language` cookie/localStorage were removed and independently read as null; direct legacy navigation then rendered English and initialized both to `en`. No authentication cookies or other storage were inspected or changed.

**Chrome 157 Guest:** direct `/vi/homes/[Tứ-Liên-slug]` navigation, original head-comment loop trigger, gallery input and refresh all passed without a guard. Console confirmed the correct `/vi` canonical and reload. The UI then switched to `/en/homes/[same-slug]`. An actual related-listing link opened `/en/homes/2-bedroom-apartment-for-rent-in-tay-ho`, whose eleven-photo gallery responded.

These checks verify the observed routes/actions on the tested browser builds; they do not certify every extension, profile or browser version. An initial asynchronous animation-frame diagnostic remained displayed as a pending Promise, so no frame duration or mutation-count benchmark is claimed. Synchronous Console completion and native UI responses establish the regression result.

The final `beea67e63a11b8ef48dfd37f0132c7f23cbe120c` server-worker release retains that renderer implementation. Its admin was refreshed and a **new** method-3 full-site audit was started through the authenticated production dashboard (not resumed from historical evidence): `78eb112e-86d8-422a-abcf-0c5c15f4996d`, started 11 November at 02:32:45 Hanoi time. At the first browser progress observation it correctly showed 13 inspected, 0 inspection failures and 37 pending; pending pages explicitly showed unknown SEO quality and no numeric score. Final audit evidence is recorded separately by the release owner.
