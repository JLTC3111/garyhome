# Gary Home SEO and listing repair report

11 November 2026. **Deployed and verified:** production `www.garyhome.vn` and GitHub `main` use commit `beea67e63a11b8ef48dfd37f0132c7f23cbe120c`. Final production deployment: `dpl_8uavBmB497s5qbmCxg7wHwMJEpm8`. Both additive database migrations are applied. [Release evidence](seo-evidence/main-production-release.json).

## 1. Root cause analysis

| Severity | Confirmed defect and cause | Affected components |
| --- | --- | --- |
| High | Vietnamese titles containing repeated ASCII spaces caused an infinite MutationObserver loop: `document.title` normalizes whitespace, so comparison with the raw CMS title never settled. Edge froze despite completed network requests and no JS exception. Chrome reproduced the same loop after a controlled head mutation. | DocumentTitle; listing hydration and interaction |
| High | The original worker combined crawler/checkpoint exceptions, attempted a second terminal write, and lost the triggering exception. Six uninspected pages were analyzed as empty HTML, producing twelve artificial critical findings. The exact exception behind the historical 191-second stop cannot be recovered. | Audit service, transport, unknown-page analysis |
| High | Cookie-mode tasks duplicated explicit locale URLs and treated the requested cookie as the server response language. Ninety-two opposite-cookie labels created misleading locale warnings. | Crawl tasks, response language, observation counts |
| Medium | Literal comparison of known UI-query/legacy aliases with preferred localized URLs invented canonical and hreflang conflicts. Streamed HTML parsing had also discarded real headings in resolved React boundaries. | URL identity, technical rules, HTML parser |
| Medium | Resume retained sitemap URLs, inspections and visited tasks across deployments. Its 26-entry old inventory was mixed with later responses, yielding 276 sitemap warning occurrences. | Resume inventory and derived findings |
| Medium | Raw observations, distinct variants, attempts, page outcomes and skipped URLs were conflated. Repeated findings and unversioned aggregate percentages obscured evidence. Checklist messages lacked complete localization; reports lacked a short executive format. | Dashboard, scoring, localization, PDF export |

[Initial failure evidence](seo-remediation-report.md), [original retained audit](seo-evidence/latest-audit-input.json), [renderer reproduction and stack](seo-edge-evidence/README.md). The current sitemap has 50 localized entries; the old 26-entry snapshot is **not evidence of a current sitemap defect**.

## 2. Implementation summary

- **Crawler and reports:** `lib/seo-audit/{crawler,normalize,presentation,service,store}.ts`, `lib/seo-analysis/{technical,url-identity,types}.ts`. Explicit URL locale is authoritative; requested, URL and server languages remain separate. Retries/backoff, request deadlines, preserved queues and recoverable checkpoints distinguish operational interruption from SEO defects. Resume archives old sitemap evidence, fetches current roots and retains real omissions. Query consolidation is restricted to known UI parameters; unknown semantics remain inspectable.
- **Renderer and URLs:** `components/document-title.tsx`, `site-context.tsx`, `property-detail.tsx`. Normalize only the browser title comparison/write; preserve authored content. Public language switching and sharing produce localized URLs while preserving slug, query and hash. Existing links continue to work.
- **Live editor:** `lib/seo-analysis/{localization,content}.ts`, `components/seo-editor-panel.tsx`, `seo-draft-panels.tsx`. Shared EN/VI keys cover all 16 rules, explanations, recommendations, severity, dynamic counts, controls and accessibility labels. URLs and user-written evidence are never translated.
- **Dashboard/export:** `components/seo-audit-dashboard.tsx`, `app/seo.css`, `lib/seo-audit/print-report.ts`. Independent scored-check denominators, explicit coverage, grouped causes and versioned history; **Summary only** and **Full report** exports retain the detailed evidence/JSON. Executive output is two A4 sections with up to eight distinct causes.
- **Listing management:** `components/admin-page.tsx`, `use-listing-provenance.ts`, `lib/listing-provenance.ts`, `app/listing-management.css`, `app/layout.tsx`, `data/studio-vi.json`. Added creation date/time in Hanoi time (GMT+7) and poster columns. A server trigger captures immutable creation identity separately from editable contact/author data. Historical unknown creators display **Not recorded**.
- **Database:** applied `20261110145521_listing_creation_provenance.sql` and `20261110150224_seo_audit_method_v3.sql`; regenerated fresh setup. Live verification confirms creator-table RLS, no anonymous read and no authenticated client inserts. No guessed creator backfill.

No application dependencies were added. No published content or SEO metadata was automatically rewritten. [Complete release file manifest](seo-evidence/changed-files.json).

## 3. Verified SEO improvements

The fresh scan inspected **25 EN and 25 VI pages** with **zero explicit-URL/server-language mismatches**. All 50 preferred URLs appear in the freshly fetched, HTTP-200 sitemap; no canonical, hreflang, sitemap or missing-H1 scored failures remain.

Independent HTTP inspection confirms Tứ Liên `/en/homes/[slug]` and `/vi/homes/[slug]` return HTTP 200 with matching server language, localized title/H1, self-localized canonicals, reciprocal EN/VI and English x-default. Filter/contact aliases consolidate appropriately. Redirect-following inspection of `/about` yields the services canonical, rather than the homepage. [HTTP evidence](seo-evidence/production-route-checks.json).

Actual Edge/Chrome UI language switches preserve the listing slug and produce distinct locale URLs; direct loading and refresh remain responsive. Existing Vietnamese title spacing is preserved. These observations verify the reported routes and tested browsers, not every possible browser/profile. The eight repeated-text warnings remain visible for editorial review.

Native Edge also verified both listing-table column languages, Hanoi timestamps and honest historical creator placeholders. The live listing editor's translated rules, expanded explanations/recommendations, accessibility labels, separate content-language selector and Vietnamese mobile preview were inspected without saving content. [Admin UI evidence](seo-edge-evidence/admin-ui-verification.json).

## 4. Test results

**674 regression tests passed; zero failed or skipped.** TypeScript, focused ESLint and diff checks passed. Next.js and Vinext production builds passed. [Full test log](seo-evidence/release-regression-tests.log), [Next.js build](seo-evidence/release-next-build.log), [Vinext build](seo-evidence/release-vinext-build.log), [resume tests](seo-evidence/resume-sitemap-tests.log).

Coverage includes title normalization under StrictMode/late metadata, real streamed headings, unknown-page scores, retries/deadlines/checkpoint failures, resume inventory refresh and genuine missing-page negatives, wrong-locale responses, known/unknown queries, canonical/hreflang negatives, duplicate-check weighting, all checklist translations, export escaping/summary bounds, listing timestamps and creator-record permissions/immutability.

**Actual native browser regressions:** Edge 155 normal profile with existing VI state, Edge InPrivate with controlled locale reset, and Chrome 157 Guest on macOS passed the recorded direct, refresh, switch, internal-navigation and gallery checks. The original head-mutation trigger no longer hangs either browser without a temporary guard. Other tested listings include Vũ Miên in Edge and the second Tây Hồ listing in Chrome. [Browser matrix and limitations](seo-edge-evidence/production-browser-regression.json).

InPrivate shared an existing QA session; it was not a pristine profile. A contrary-cookie explicit-URL browser case was initiated but not fully captured. Windows Edge and all extension combinations were not tested.

## 5. Production verification

Fresh run **`78eb112e-86d8-422a-abcf-0c5c15f4996d`** completed from **19:32:45 to 19:35:49 UTC on 10 November** (02:32–02:35 Hanoi, 11 November), taking **183.91 seconds** within the 15-minute limit.

| Metric | Verified result |
| --- | --- |
| Public URLs / locale variants / resources | 50 / 50 / 25 |
| Inspected | 50: 25 EN, 25 VI |
| Passed scored page checks / pages with warnings | 42 / 8 |
| Failed / skipped / pending page inspections | 0 / 0 / 0 |
| Queue tasks remaining / duplicate observations | 0 / 0 |
| Critical findings / public noindex pages observed | 0 / 0 |
| Content / Technical checks | 350/358 = 98; 576/576 = 100 |
| Page attempts / network requests | 50 / 86 |
| Skipped URL records | 60 |

“Passed” is a subset of inspected pages with no scored failure, not an additional outcome or a guarantee about unscored checks. The 60 skipped URL records comprise **42 UI-query consolidations, 14 private/static exclusions, two social destinations and two records for one unverified external government link**.

That external host's robots DNS lookup returned `EBUSY` after three attempts; its dependent link was left unverified. This does not establish a Gary Home failure, broken external link or critical SEO finding. Completed describes the configured public-page crawl; external coverage remains explicitly limited. [Raw audit](seo-evidence/fresh-production-audit.json), [independent count/formula summary](seo-evidence/fresh-production-summary.json).

## 6. Before/after metric reconciliation

| Measure | Latest stored old run | Same evidence, corrected method | Fresh production run |
| --- | --- | --- | --- |
| Status | Incomplete | Historical state preserved | Completed |
| Observations / exact URLs | 276 / 138 | 276 / 138; 92 repeats | 50 / 50; zero repeats |
| Distinct inspected URL/server-language variants | Not separated | 184 | 50 canonical localized variants |
| Passed / with scored issues | 0 / unspecified | 0 / 184 | 42 / 8 |
| Failed / skipped / pending inspections | 0 / 0 / 0 | 0 / 0 / 0 in retained scope | 0 / 0 / 0 |
| Content | 98 | 1288/1308 = 98 | 350/358 = 98 |
| Technical | 68 | 1892/2076 = 91 | 576/576 = 100 |
| Critical findings | 0 | 0 | 0 |
| Skipped URL records / requests | 32 / 381 | Same retained records | 60 / 86 |

Formula, independently per category: **round(100 × passed applicable checks / evaluated applicable checks)**. Recommendations and unavailable checks are unscored. Failed, skipped and pending inspections supply no passing checks or numeric page scores. Repeated URL/server-language/check observations are counted once; conflicting repeats retain the worst observed severity.

The old 68→91 change is **historical reclassification**, removing evidence-disproven scanner artifacts and duplicate weighting. The fresh Technical 100 uses current sitemap/locale evidence; it does not mean all recommendations, external links, browser performance or Google indexing passed. Coverage differs: the fresh crawl consolidates UI aliases and inspects 25 real resources in two languages. It is not a like-for-like content improvement claim. [Reconciliation details](seo-evidence/latest-audit-reconciled.json).

The original earlier 65-observation report (78/90, twelve critical findings) contained 59 inspected, six failed and 29 pending known page variants: 59/94 = 62.8% inspected. All twelve critical findings were unsupported transport artifacts. That original snapshot and the later 276-observation snapshot are different stages of the old run, not interchangeable baselines. The fresh known-page completion is 50/50 = 100%.

## 7. Remaining issues and follow-up

1. **Medium - editorial review:** eight observed repeated-text warnings cover Vinhomes rental disclaimers and title recurrence on four property listings, across eight localized variants in total. Preserve and review intent before editing; repetition alone does not prove poor quality or a ranking penalty. The full audit retains exact excerpts and affected URLs.
2. **Medium - external verification:** retry the Hanoi government reference when its robots/DNS endpoint is reachable. Do not call it broken without an HTTP result.
3. **Medium - scheduling:** weekly execution is supported by the durable worker and `.github/workflows/seo-audit.yml`, but production `weekly_enabled` is currently **false**. Repository scheduling secrets were not independently verified. Enable/configure scheduling as an explicit operational follow-up.
4. **Low - historical attribution:** old poster identities remain unknown; backfill only from independent trusted records. New staff-created listings acquire server provenance.
5. **Verification limits:** browser performance, Core Web Vitals, schema eligibility, pristine/Windows browser profiles and actual Google indexing remain separate measurements. Native window control recovered; production table/editor inspection and fresh Chrome PDF exports were completed. The new-creator trigger was tested with database regressions rather than inserting test listings into production.

Deliverables: [two-page executive PDF](../output/pdf/gary-home-fresh-executive-summary.pdf), [full evidence PDF](../output/pdf/gary-home-fresh-full-audit.pdf), [raw JSON](seo-evidence/fresh-production-audit.json). The full PDF retains 84 pages of grouped causes, page-level evidence, diagnostics and skipped URLs; the executive export shows eight distinct priorities.

The configured live crawl completed reliably, retained legitimate warnings and scored only evaluated checks. Evidence, historical corrections and operational limitations remain available rather than being hidden behind a success score.
