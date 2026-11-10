# Gary Home SEO Engine Remediation Report

Date: 10 November 2026. Status: implemented and locally verified; production acceptance remains blocked. Production data was read directly from Supabase. Application changes and the new database migration have not been deployed. No historical audit records or published CMS content were rewritten.

## 1. Root Cause Analysis

- **High - runtime incompatibility.** Earlier production runs contain `The options.lookup option is not implemented`. The Node HTTP transport supplied a custom DNS lookup unsupported by the Cloudflare compatibility runtime. A runtime-specific transport was missing (`crawler.ts`, `runtime-env*.ts`). Confirmed in stored production errors and reproduced by a regression fixture.
- **High - premature terminal failure.** Run `f62a4c02-8343-4bdd-88e5-023624b37033` ended after 191.2 seconds, with 46 queued tasks, despite its 900-second configuration. `advanceAudit` caught both crawler and checkpoint errors, marked the run failed, and attempted another write. A simulated checkpoint failure at 191 seconds reproduces that path. The original exception was discarded, so the precise triggering exception in this historical run cannot be independently established.
- **High - fabricated defects and scores.** Six status-zero fetch failures were analyzed as empty HTML. Each generated both `technical-http` and `fetch-failed` critical findings, accounting for all 12 reported critical findings. Other paths assigned zero scores to pages blocked by unavailable robots data. Empty content reports displayed green passed icons. None established actual page SEO or indexability.
- **High - incomplete stream parsing.** Actual React streamed Suspense output places a resolved page after an already closed `main`, then inserts it at a boundary. The parser discarded these observed headings/body and analyzed loading fallback content. This is reproduced using React's real streaming renderer. The historical report contains 44 missing-H1 warnings; their individual live validity still requires reinspection.
- **Medium - retries and lost progress.** Request deadlines shrank near batch boundaries; transient transport errors were terminal; exhausted scans cleared the queue. Robots retries could restart with fresh attempt counters. Filter/contact query variants and irrelevant external destinations consumed requests.
- **Medium - multilingual discoverability.** EN/VI relied on cookies at shared URLs, with no crawlable language routes or alternate declarations. Many landing pages inherited the same description. Findings about weak photo links also identified empty decorative anchors adjacent to correctly named links.
- **Medium - retired alias and reporting.** `/about` intentionally redirects to `/services`; a render-time redirect can expose inherited homepage metadata in streamed intermediate HTML. It was still seeded and listed in the sitemap. Mean page percentages, duplicate findings and unversioned history made partial results misleading.

Evidence: `seo-evidence/production-before.json`, captured unchanged from the production database; `seo-evidence/baseline-reclassified.json`; regression fixtures listed below. Screenshots alone were not used to infer page defects.

## 2. Implementation Summary

- `lib/seo-audit/crawler.ts`: full request deadlines, three-attempt transient retries, bounded backoff, explicit inspection outcomes/diagnostics, preserved queues, deduplicated robots/redirect requests, and accurate incomplete states. Known public query variants consolidate only in localized URL mode; original destinations remain explicitly unverified.
- `lib/seo-audit/service.ts`, `store.ts`, `normalize.ts`, `presentation.ts`: recoverable checkpoints and leases, explicit resume segments preserving original history, unscored unknown pages, mandatory reinspection of legacy-parser observations on resume, deduplicated applicable checks, check-weighted aggregates, coverage counts and versioned score basis. New migration `20261110100526_seo_audit_reliability_and_score_basis.sql` adds summary provenance and a service-only resume RPC; fresh setup was regenerated.
- `lib/seo-audit-runtime.ts`, `runtime-env*.ts`: Node keeps DNS-pinned transport. Cloudflare explicitly uses platform fetch only for trusted configured origins; arbitrary external requests remain excluded. URL, redirect, private-address and robots guards remain enforced.
- `proxy.ts`, `lib/localized-routes.ts`, `components/localized-link.tsx`, language/context/navigation components and metadata/sitemap routes: crawlable localized URLs without duplicating page implementations or changing the design.
- `lib/seo-analysis/html.ts`, `technical.ts`, `types.ts`, `compare.ts`: inert reconstruction of observed streamed replacements, unknown-status guard, finding deduplication and refreshed cross-page comparisons.
- Dashboard/CSS and `print-report.ts`: neutral unknown states, separate request diagnostics, inspected/passed/failed/skipped/pending counts, explicit resume, safe advance retries, legacy-score warnings and professional Print / Save PDF export. JSON evidence export remains available. This document also has a standalone PDF.

No scoring thresholds were relaxed and no legitimate observed SEO finding was removed to obtain a higher score. No new application dependencies were added.

## 3. SEO Improvements

- **Implemented and fixture-verified:** `/en` and `/vi` public routes rewrite to existing page handlers. Explicit URL language overrides stale cookies/storage. Navigation, search, sorting and switching preserve the locale; legacy/private routes continue to work.
- **Canonicals and hreflang:** localized pages emit self-localized canonicals and reciprocal EN/VI alternates, with English as x-default. Structured-data URLs and sitemap entries use the same route helpers.
- **About alias:** legacy and localized `/about` now redirect with a pre-render HTTP 308 to the corresponding services route. The alias is removed from sitemap/discovery. No replacement About page was invented.
- **Metadata:** 12 public landing pages have specific bilingual descriptions instead of the common fallback. Existing editorial and listing metadata continue to use authored content.
- **Headings:** the parser now recognizes headings actually delivered in linked streamed replacements. It does not invent headings, promote unrelated footer/hidden content, or treat incomplete streams as successful content inspection.
- **Internal links:** property-photo anchors now carry their existing property title as an accessible label. Other descriptive labels and valid missing-heading findings remain subject to normal checks.
- **Verification boundary:** these changes pass source, renderer and route tests; none is yet verified on a newly deployed public response. A claim that all historical H1 warnings or canonical issues are fixed live would be unsupported.

## 4. Test Results

- **649 regression tests passed; zero failed.** Evidence: `seo-evidence/regression-tests.log`.
- TypeScript passed after route type generation. Next.js production build compiled the proxy; Cloudflare/Vinext production build also completed. Logs: `seo-evidence/next-build.log`, `seo-evidence/vinext-build.log`.
- Feature ESLint passed with no errors or warnings; `git diff --check` passed. Evidence: `seo-evidence/feature-lint.log`.
- Coverage includes near-batch request timing, transient retries/exhaustion, queue preservation, 191-second checkpoint failure, stale leases, resume authorization/history, robots retry budgets, private-IP/redirect safety, unsupported lookup, URL/query deduplication, real streamed H1 reconstruction, canonical/hreflang/locale behavior, unknown-page scores, weighted summaries, legacy normalization and PDF print escaping.
- The database upgrade was exercised against local Postgres via PGlite, including service-only access and atomic resume. The migration has not been applied to production. Reproduce with `npm test`, `npm run typecheck`, `npm run build:vercel` and `npm run build`.

## 5. Production Verification

The historical run was independently retrieved from the production Supabase project. It contains **59 HTTP-200 observations, 6 failed inspections, 29 pending page variants and 17 other queued tasks**. There were 27 distinct skipped URL records, which include ancillary requests and failures and are not an additional disjoint page count.

A fresh credential-free audit was attempted against `https://www.garyhome.vn` using the repaired engine and the currently deployed cookie-language route mode. It covered 25 known public URLs/50 EN-VI variants after removing search filters and the retired alias from seed scope.

- Inspected: **0**; passed: **0**; failed inspections: **50**; skipped page variants: **0**; pending page variants: **0**.
- Run status: **incomplete**. Content and Technical scores: **not available**. Critical SEO findings: **none established**, because no HTML was inspected.
- Root failure: the task host could not resolve the production hostname. Robots inspection exhausted its retry budget; dependent pages were recorded as failed inspections without fetching or inventing page defects. Network requests reaching the server: **0**. The 50 failures are not 50 observed website errors.
- Public web fetchers also could not access the site; the available Vercel connection returned 403 and no authorized teams; the browser host was unavailable. These conditions do not prove that the public website is down.

Evidence: `seo-evidence/production-after.json`, `seo-evidence/live-attempt.log`. Reproduce: `node scripts/run-seo-audit.mjs --origin https://www.garyhome.vn --mode cookie --seed-file docs/seo-evidence/production-before.json`. Use `--mode url` after deploying localized routes. Successful live deployment and a completed live audit remain unverified.

## 6. Before/After Comparison

The middle column below reclassifies the SAME saved observations; it is not an improved production crawl. The final column is the separate fresh attempt.

| Metric | Stored report | Same evidence, corrected interpretation | Fresh live attempt |
| --- | --- | --- | --- |
| Content SEO | 78/100 | 78/100 on inspected checks only | Not available |
| Technical SEO | 90/100 | 98/100 on inspected checks only | Not available |
| Critical findings | 12 | 0 supported; 12 transport artifacts removed | None established; no inspection |
| Inspection outcome | 65 recorded variants | 59 inspected, 6 failed, 29 pending | 0 inspected, 50 failed, 0 pending |
| Known inspection completion | Not separately reported | 59/94 known page variants (62.8%) | 0/50 attempted variants (0%) |
| Run state | Failed at 191.2 seconds | Historical state preserved | Incomplete with explicit DNS failure |

Technical 98 is a methodological correction, not evidence that the website became healthier. The successful-observation set is unchanged; suspect H1 and other observed warnings remain in that historical interpretation. A valid before/after production SEO comparison must wait for deployment, successful HTML inspection and comparable route coverage.

## 7. Remaining Issues

- **High - production acceptance not met:** identify/authorize the actual deployment target, deploy the code and additive migration, confirm the preferred production origin, then run the repaired audit to completion from a network-capable environment. This task did not deploy or change production data.
- **High - live SEO reinspection:** verify actual EN/VI HTTP responses, canonical/hreflang reciprocity, streamed heading/body delivery and language switching. Recheck the 44 historical H1 warnings and remaining content warnings rather than suppressing them. The exact historical 191-second triggering exception remains unknown because the old code discarded it; new worker/checkpoint diagnostics retain structured operational context.
- **Medium - bounded coverage:** Node can inspect safe external destinations with pinned DNS. Cloudflare platform transport intentionally leaves nonconfigured external hosts unverified. Robots exclusions, private routes and filter variants are reported, not fetched around restrictions. Independent scores remain partial when coverage is incomplete.
- **Medium - measurement limits:** response timing/HTML size are not Core Web Vitals; JSON-LD syntax checks are not full rich-result validation; relevance/readability advisories are not a semantic quality or ranking model. Use browser performance tools, schema validators and Search Console for those questions.

Acceptance conclusion: code fixes, reproducible regressions and professional reporting are delivered. Reliable completion against the live deployment and measured live SEO improvement are explicitly not claimed.
