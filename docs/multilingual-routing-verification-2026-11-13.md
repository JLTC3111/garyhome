# Gary Home multilingual routing, metadata, and favicon verification

Date: 13 November 2026. Scope: `gary_home_website/` only. Changes are local and have **not been deployed**. No migrations, hosted content edits, dependency installation, Jobs changes, or Agency changes were performed.

## Outcome

- Public English and Vietnamese pages have real, separately addressable `/en/...` and `/vi/...` routes. Locale wrappers reuse the existing page components and metadata functions.
- Legacy public paths permanently redirect to deterministic English destinations. Explicit locale paths override cookie, localStorage, and browser-language preferences.
- Language switching keeps the page, slug, repeated query parameters, and hash; listing search/filter navigation and public links retain locale.
- Metadata uses one production origin, **https://www.garyhome.vn**, matching the existing deployed apex-to-www redirect. Preview/deployment environment URLs cannot become canonicals.
- Page titles, descriptions, Open Graph/Twitter copy, headings, navigation, and primary content are localized. Canonicals are self-referencing for each clean locale URL, with reciprocal EN/VI alternates and English `x-default`.
- Final Metadata API output is included in the initial HTML head. HTML `lang` follows the URL and stays synchronized during pathname/history changes.
- Existing recognized PNG, SVG, and Apple favicon assets and their URLs were preserved. A compatible `/favicon.ico` was added using the exact existing 32px PNG byte stream; no pixels were redesigned or resampled.

## Initial findings and implementation decisions

The repository already had localized metadata, sitemap generation, and locale rewrite helpers. The central gap was that legacy unprefixed public routes still returned indexable `200` responses. Public links and several CTAs could also bypass locale handling, while browser history could leave a persistent provider using stale locale props.

An integration check exposed a further problem with combining internal locale rewrites and legacy redirects in native Next proxy handling: a rewritten `/vi/homes` request could re-enter the redirect for `/homes`. The final implementation uses actual `app/[locale]/` routes and forwards verified locale headers without rewriting to legacy routes. This also makes page identity explicit in routing.

The canonical hostname remains **www**, because existing production infrastructure redirects `garyhome.vn` to `www.garyhome.vn`. Switching application canonicals to the bare domain would conflict with that infrastructure. No hosting settings were changed.

Most authored CMS content was already bilingual. Read-only inspection confirmed 8 current public rental records with distinct translated titles/overviews and 6 published editorial records with translated titles/summaries/sections. Existing hosted property descriptions are blank, but their translated overviews are present and are already preferred by the SEO helper. Seven older seed title fields were corrected locally; their old records were absent from the current hosted catalogue. No runtime language-detection heuristics or database content mutations were added.

## URL and redirect matrix

Canonical production origin below is `https://www.garyhome.vn`.

| Request | Expected application behavior |
|---|---|
| `/` | `308` → `/en` |
| `/homes?district=tay-ho&sort=price` | `308` → `/en/homes?district=tay-ho&sort=price` |
| `/homes/<slug>?ref=legacy` | `308` → `/en/homes/<slug>?ref=legacy` |
| `/tips-and-news/<slug>?ref=legacy` | `308` → `/en/tips-and-news/<slug>?ref=legacy` |
| `/about?ref=old` | `308` → `/en/services?ref=old` |
| `/en/about` | `308` → `/en/services` |
| `/vi/about?ref=old` | `308` → `/vi/services?ref=old` |
| `/en`, `/vi` | Independent `200` indexable homepages |
| `/en/homes`, `/vi/homes` | Independent `200` listing pages |
| `/en/homes/<published-slug>`, `/vi/homes/<published-slug>` | Independent `200` property pages |
| `/en/tips-and-news`, `/vi/tips-and-news` | Independent `200` news/tips indexes |
| `/en/tips-and-news/<published-slug>`, `/vi/tips-and-news/<published-slug>` | Independent `200` articles |
| Other public landing pages | Both `/en/...` and `/vi/...` routes |
| Public URLs on `garyhome.vn` | Normalize to HTTPS `www.garyhome.vn`, preserving locale/path/query |
| `/admin`, `/account`, `/login`, `/saved`, `/cart`, `/auth/...`, `/api/...` | No public-locale redirects or locale wrappers |
| `/favicon.*`, `/images/...`, `/fonts/...`, `/shared/...` | Asset paths remain unprefixed |
| Unsupported locale such as `/fr/homes` | `404`; no alternate-language content fallback |

Public landing routes are `/`, `/homes`, `/neighbourhoods`, `/services`, `/vinhomes`, `/tips-and-news`, `/landlords`, `/contact`, `/activities`, `/feedback`, `/privacy`, and `/credits`.

The existing deployment-level apex redirect can occur before application routing; legacy apex URLs may therefore retain an additional hop until hosting configuration is separately reviewed. No deployment or domain configuration was changed.

Language-switch example:

```text
/en/homes?district=tay-ho&amenity=Balcony&amenity=Lake+view#results
→ /vi/homes?district=tay-ho&amenity=Balcony&amenity=Lake+view#results
```

Fragments are not sent in HTTP requests. Exact hash preservation was verified in the helper and real provider tests with a mocked router, not in an interactive browser. Canonicals intentionally omit listing filters/tracking parameters, while language switching preserves them.

## Actual verification results

### Build and automated tests

| Check | Result |
|---|---|
| Native Next production build, `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack` | Passed; localized routes present in build manifest |
| Sites/Vinext production build, `npm run build` | Passed; localized routes present in build manifest |
| TypeScript, `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed |
| Focused routing, metadata, navigation, media, search, CTA, and shared-navigation tests | **66 passed, 0 failed** |
| `git diff --check` | Passed |

Focused test command:

```sh
node --test \
  tests/locale-routing-contract.test.mjs \
  tests/language-navigation.test.mjs \
  tests/seo-localized.test.mjs \
  tests/document-titles.test.mjs \
  tests/media-assets.test.mjs \
  tests/public-routes.test.mjs \
  tests/search.test.mjs \
  tests/shiny-button.test.mjs \
  tests/gary-apps.test.mjs
```

The five navigation tests exercise the real `SiteProvider` and `useSite`, mocking only browser/router/network boundaries. They cover stale preferences, persistent-layout back/forward pathname changes, repeated query/hash preservation, cross-tab preference events, and unchanged staff/auth navigation. They do not claim full browser end-to-end coverage.

Only focused tests were run; database migration tests were not executed. Existing nonfatal React test-renderer deprecation/multiple-renderer warnings were observed. The native build also reports an unrelated parent-directory lockfile warning.

### HTTP and raw source

The production Vinext/Workers build was served locally with `npm start` at `http://127.0.0.1:8787`, using bundled bilingual preview content. **43 HTTP cases** passed their expected checks:

- All **24** locale landing pages returned `200`.
- EN/VI property detail and article detail pages returned `200` (**4 detail responses**).
- Every inspected public page had translated title, description, H1, Open Graph copy, correct HTML `lang`, one matching self-canonical, and reciprocal EN/VI alternates in the initial HTML head.
- Public anchors on inspected pages used localized destinations.
- Two conflicting cookie/browser-language cases still rendered the explicitly requested locale.
- Legacy homepage/property/article and About redirects returned `308` with preserved query parameters.
- Staff and password-reset pages retained unprefixed `200` routes; configuration API retained `200` JSON.
- Unsupported locale returned `404`.
- `robots.txt` returned `200`; localized sitemap returned `200` XML with **66 unique preview URLs**, all localized and with reciprocal alternates. The deployed sitemap size will depend on its current published catalogue.
- PNG/192px PNG/ICO returned `200` with image content types.

Earlier native Next development HTTP checks also returned correct bilingual homepage/listing source using configured public CMS content. After resuming, sandbox port restrictions blocked starting the native production server, so final detailed HTTP coverage used the supported alternate production runtime. Native production compilation still passed.

Machine-readable local response summary: [multilingual-routing-http-results.json](multilingual-routing-http-results.json).

## Favicon investigation

Actual live responses before deployment of this patch:

| Path | `https://garyhome.vn` | `https://www.garyhome.vn` |
|---|---|---|
| `/favicon.png` | `308` to www, then `200 image/png` | `200`; 704 bytes; 32×32 |
| `/favicon-192.png` | `308` to www, then `200 image/png` | `200`; 4,230 bytes; 192×192 |
| `/apple-touch-icon.png` | `308` to www, then `200 image/png` | `200`; 4,549 bytes; 180×180 |
| `/favicon.svg` | `308` to www, then `200 image/svg+xml` | `200`; 344 bytes |
| `/favicon.ico` | `308` to www, then **404** | **404** |
| `/robots.txt` | `308` to www, then `200` | `200`; favicon paths permitted |

The live PNG bytes matched existing local assets. Requests using Bingbot and Googlebot-Image user-agent strings also returned healthy PNG responses without `X-Robots-Tag`. These tests do not establish access from genuine search-engine crawler IPs.

Preserved SHA-256 values:

```text
favicon.png          e9d512fdc645817675777ebe97d9b37c8c1b326dda0f217b2f59df28d9f330da
favicon-192.png      f8c43902cb4fd4db3a8a619e646d917c5ac5d1304c109421e6cefbac9b84f380
apple-touch-icon.png aca1bf197d88a7c9b95cad75b7e696c698e4b6dfa7a0ec76638e257694dd57cf
favicon.svg          5ab8618face36d8192f03bf15e3685536023487a86e56546a911085e04615d62
```

The added ICO is 726 bytes and embeds `favicon.png` byte-for-byte. Existing PNG/SVG/Apple declarations and shortcut PNG are retained; ICO is an additional declaration. Local production HTTP returned `200 image/vnd.microsoft.icon` for it.

**Bing’s precise reason for not displaying the icon remains unverified.** No current PNG availability, MIME, robots, or user-agent serving failure was found. Missing ICO was a compatibility gap, not a proven cause. No existing recognized asset was replaced or cache-busted.

## Changed files

### Routing and locale state

- `proxy.ts`
- `lib/site-origin.ts` (new canonical-origin constant)
- `app/[locale]/layout.tsx` (new locale validation)
- `app/[locale]/page.tsx`
- `app/[locale]/activities/page.tsx`
- `app/[locale]/contact/page.tsx`
- `app/[locale]/credits/page.tsx`
- `app/[locale]/feedback/page.tsx`
- `app/[locale]/homes/page.tsx`
- `app/[locale]/homes/[slug]/page.tsx`
- `app/[locale]/landlords/page.tsx`
- `app/[locale]/neighbourhoods/page.tsx`
- `app/[locale]/privacy/page.tsx`
- `app/[locale]/services/page.tsx`
- `app/[locale]/tips-and-news/page.tsx`
- `app/[locale]/tips-and-news/[slug]/page.tsx`
- `app/[locale]/vinhomes/page.tsx`
- `components/site-context.tsx`
- `components/localized-link.tsx`
- `components/search-form.tsx`
- `components/homes-page.tsx`
- `components/service-apps.tsx`
- `shared/gary-apps/gary-apps.tsx`

### Metadata, translations, and favicon

- `lib/seo.ts`
- `lib/document-titles.ts`
- `lib/rentals.ts`
- `next.config.ts`
- `app/layout.tsx`
- `components/about-sections.tsx`
- `components/site-shell.tsx`
- `components/property-detail.tsx`
- `components/magicui/shiny-button.tsx`
- `data/properties.json` (seven old preview translation fields only)
- `public/favicon.ico` (new compatibility container; existing icon files untouched)

Existing `app/sitemap.ts`, `app/robots.ts`, `lib/localized-routes.ts`, and `lib/language.ts` already provided the required localized sitemap/alternate/bootstrap behavior and were verified without unnecessary implementation edits.

### Tests and evidence

- `tests/locale-routing-contract.test.mjs` (new)
- `tests/language-navigation.test.mjs` (new)
- `tests/seo-localized.test.mjs`
- `tests/document-titles.test.mjs`
- `tests/media-assets.test.mjs`
- `tests/search.test.mjs`
- `tests/shiny-button.test.mjs`
- `tests/gary-apps.test.mjs`
- This report and `docs/multilingual-routing-http-results.json`

Ignored build output was regenerated for validation. The incidental `next dev`-generated `AGENTS.md` was removed; the pre-existing untracked `clients_requirements/Search_Optimisation/` directory was preserved.

## Outstanding verification and follow-up

1. **No deployment was performed.** New redirects/routes/ICO are not yet verified on production.
2. **Interactive browser verification was unavailable:** browser access host unavailable; native browser access also failed. Real provider navigation behavior is covered by tests, but visual switching, browser Back/Forward, hash scrolling, mobile interaction, and browser console/hydration observations still need a browser pass.
3. **Bing display/crawl history is unknown:** inspect Webmaster Tools rather than asserting the absent ICO caused the issue.
4. The final alternate-runtime HTTP run used preview data. Current hosted public content was inspected read-only, and earlier native HTTP home/listing checks used configured content. Recheck representative currently published detail URLs after deployment.
5. Native and alternate builds passed. Blocking metadata can delay the initial response until content-backed metadata resolves; no new performance benchmark was performed.
6. The local preview remains on `127.0.0.1:8787`: session approval policy blocked sending its stop command, and the sandbox denied terminating its process. This does not publish the site or change production.

## Google and Bing reindexing instructions — after an authorized deployment

Do not submit indexing requests while production still serves the old code.

1. Verify the live `/en`, `/vi`, both listing indexes, one current property pair, and one article pair. Confirm `200`, translated raw HTML, matching canonical, reciprocal alternates, and crawlable icons. Confirm old URLs return permanent redirects with query/deep-link preservation.
2. Keep `https://www.garyhome.vn` as the canonical host and retain the bare-domain redirect. Check both hostnames’ icon responses again. Do not replace or rename the recognized PNGs.
3. In Google Search Console, submit `https://www.garyhome.vn/sitemap.xml`. Use URL Inspection → live test → request indexing for the two locale homepages and representative listing/property/article URLs. Check Google-selected canonical after recrawl. A request does not guarantee indexing or immediate refresh. [Google recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)
4. In Bing Webmaster Tools, submit the same canonical sitemap; inspect EN/VI homepages and sample detail URLs with URL Inspection/Live URL and request indexing through the available controls. Review downloaded HTML, redirect targets, crawl errors, and the favicon response. [Bing URL Inspection](https://www.bing.com/webmasters/help/URL-Inspection-55a30305), [Bing sitemaps](https://www2.bing.com/webmasters/help/sitemaps-3b5cf6ed)
5. Monitor discovery/indexing and favicon display after recrawl. If Bing still omits the icon despite healthy serving, use Webmaster support with the exact canonical hostname, icon URLs, statuses, and crawl evidence. No favicon display deadline is guaranteed. [Google favicon guidance](https://developers.google.com/search/docs/appearance/favicon-in-search), [Bing support](https://www.bing.com/webmasters/help/webmaster-support-24ab5ebf)
