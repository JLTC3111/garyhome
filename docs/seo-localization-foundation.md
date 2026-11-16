# SEO finding protocol and bilingual presentation

The engine returns stable finding identity, severity, and parameters. UI and report presentation share `shared/cms-foundation/seo-findings.js`, a framework-neutral module with no browser, Auth, or database access.

## Contract

```js
{
  id: "hreflang-reciprocal-vi",   // Existing scoring/dedup identity is preserved.
  code: "hreflang-reciprocal",    // Stable translation catalogue key.
  params: { language: "vi" },     // Typed facts; never translated in storage.
  severity: "warning",
  category: "technical",
  schemaVersion: 1,
  // Existing English title/explanation/recommendation/evidence remain for
  // historical compatibility and raw evidence exports.
}
```

`normalizeFinding(finding)` adds the protocol fields to new and legacy findings without changing IDs or severities. Existing `report()` and audit-read normalization apply it, so stored JSON does not need a database migration. Locale-specific hreflang IDs retain distinct scoring identities while sharing a stable code with `params.language`. Status, element counts, timing/byte counts, and JSON-LD counts have typed parameters where observed.

`localizeFinding(finding, "en" | "vi")` (also exported as `tFinding`) returns presentation copy without editing the source finding. Unknown legacy codes receive safe Vietnamese generic guidance instead of leaking untranslated engine prose. The code remains visible. Raw URLs, snippets, and diagnostic source evidence remain intact and are identified as evidence.

`findingLabel(key, language)` supplies shared severity, category, status, and action labels. The existing live content-editor localization wrapper delegates finding translation to this module. The audit dashboard and full/summary printable HTML renderers call the same resolver.

The catalogue also contains reusable CMS checks: `cms-title-missing`, `cms-summary-missing`, `cms-body-missing`, `cms-seo-title-length`, `cms-seo-description-length`, `cms-slug`, and `cms-translation-complete`.

## Management interface

- Individual findings, grouped causes, history, and crawl settings use native keyboard-accessible disclosure controls.
- Search matches localized finding titles and stable codes.
- EN/VI full and summary export labels follow the workspace language.
- Application context is Home-only; it grants no access to Agency or Jobs.
- Findings are not marked resolved through a cosmetic button. Page rescans verify current checks; passed findings are explicitly tied to the observed inspection.
- Score calculations, severity, coverage, deduplication, partial-run behavior, and staff account isolation remain unchanged.

## Verification

The focused SEO suite passed 70 tests covering analysis, crawler behavior, score/locale reconciliation, bilingual live editor, dashboard, stable parameters, unknown legacy codes, CMS checks, and full/summary print output.

```sh
node --test tests/seo-finding-protocol.test.mjs tests/seo-analysis.test.mjs \
  tests/seo-crawler.test.mjs tests/seo-print-report.test.mjs \
  tests/seo-dashboard.test.mjs tests/seo-editor-localization.test.mjs \
  tests/seo-metrics-locale.test.mjs
```

Generate all four fixture documents through the same production report functions:

```sh
node scripts/generate-seo-localization-fixtures.mjs /private/tmp/seo-localization-html
```

On an unrestricted macOS QA machine, render the HTML using native print pagination:

```sh
swift -module-cache-path /private/tmp/gary-seo-swift-cache \
  scripts/render-seo-html-pdf.swift \
  /private/tmp/seo-localization-html/gary-home-seo-summary-vi.html \
  output/pdf/gary-home-seo-summary-vi.pdf
```

Repeat for `summary-en`, `full-en`, and `full-vi`, then inspect PDF text and rendered pages. The renderer disables JavaScript and uses a nonpersistent WebKit data store; generated HTML loads no external resources.

**Verification limit:** this session's sandbox denied the WebKit process/mach services needed by native PDF printing; rendering timed out. No new PDF file was produced or visually approved. Printable HTML, translated strings, escaping, and equivalent guidance were verified automatically. Actual PDF pagination, glyph rendering, and browser print behavior still require visual QA in an environment that permits rendering. No claims of final PDF visual verification are made.

No hosted migrations, changes to audit data, or deployment were performed.
