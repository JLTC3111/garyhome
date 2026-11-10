# SEO analysis and audits

Studio → Assistance & publishing → **SEO Audit** opens the published-site audit. Live Content SEO reviews appear in the article/tip editor, listing editor, and homepage introduction settings. They analyze unsaved drafts locally; focus topics stay in panel memory. Nothing rewrites or publishes content, changes indexing directives, or edits metadata automatically.

## Architecture

- `lib/seo-analysis`: shared pure TypeScript HTML extraction, content analysis and technical analysis. The browser uses the same content checks as the crawler.
- `lib/seo-text.ts`: pure metadata text helpers shared by listing previews and the existing Next.js Metadata API.
- `lib/seo-audit`: trusted domain configuration, public-route discovery, resumable crawler, cross-page metadata comparison, database storage and worker orchestration.
- `app/api/admin/seo`: fresh staff authentication and membership checks for every request. Staff can read and run scans; owners, administrators and managers can change limits and scheduling.
- `app/api/cron/seo`: secret-authenticated, bounded scheduled-worker batches. No database key or staff login is sent to the runner.
- Supabase stores full structured state and the latest 20 runs. RLS permits current staff reads; worker writes and RPCs require server credentials. A single active run and expiring leases prevent concurrent workers from duplicating work; saves require the same lease token.

Content and Technical SEO have independent findings, scores and page reports. Scores are the percentage of applicable scored checks passed, averaged across inspected variants; they are inspection summaries, not Google ranking predictions. Advisory recommendations do not change scores. Critical technical findings remain visible when Content SEO is selected. An unavailable check does not pass by default.

## Deployment setup

1. Apply `supabase/migrations/20261110090607_seo_audit_system.sql` to the same project as the website. Fresh installations include it in `supabase/setup.sql`. The migration adds audit tables/RPCs only; it does not change existing content. The storage tests exercise SQL and staff access in local Postgres using PGlite.
2. Configure server environment `SITE_URL=https://your-production-domain` and the existing Supabase URL, publishable key, and **server-only** secret/service role key. Optional `SEO_ALLOWED_ORIGINS` is a comma-separated list of additional trusted HTTPS origins. Paths, credentials and nonstandard ports are rejected. Domains cannot be supplied by browser clients.
3. Configure a strong random `CRON_SECRET` in the website server environment. Never put it in `NEXT_PUBLIC_*` variables.
4. In the GitHub repository hosting this project, enable Actions and set repository secrets `SEO_SITE_URL` (the same production HTTPS origin) and `SEO_CRON_SECRET` (the value of `CRON_SECRET`). The included `.github/workflows/seo-audit.yml` checks for due work daily, then advances a due audit until completion. If this project lives inside a larger repository, install that workflow in the repository root `.github/workflows/` directory.
5. Enable weekly audits in Studio and save. They start on the next runner check; storage makes them due every seven days. GitHub scheduled runs may be delayed. The workflow can also be dispatched manually. Weekly auditing is disabled initially so setup never creates unsolicited scans.

Any external scheduler can replace Actions by repeatedly POSTing `{}` to `/api/cron/seo` with `Authorization: Bearer <CRON_SECRET>` until `{active:false}`. Each call is a short durable batch; one request alone does not guarantee a full audit. The runner can advance an already requested manual scan too. No paid SEO API or AI calls are used.

Keep Studio open during a manual scan: it advances batches automatically. Closing Studio pauses manual work unless a runner continues calling the worker. Reopening resumes the persisted run; once its wall-clock deadline is reached it becomes incomplete. Deployment restarts can recover a lease after 60 seconds. Changing the trusted domains invalidates an older active job. Missing database setup or credentials produce an actionable error, never a fabricated report.

## Crawl scope and safeguards

Discovery uses all public landing routes, current published articles/listings, sitemap indexes, robots sitemap declarations, and internal links. Homepage, articles, services, informational and landing pages are seeded directly, so they do not rely on a homepage link. Drafts stay in the editor. Public noindex responses are inspected and shown separately. Robots-blocked public URLs receive a technical finding with unknown content quality; they are not fetched around restrictions. Excluded private routes are skipped.

Defaults: 500 distinct URLs, depth 4, at most 2 concurrent requests, at least one second between requests per host, 10-second request deadlines and 15 minutes total wall time. The worker currently processes requests serially (one is within the configured concurrency ceiling). Redirect hops and auxiliary requests use the same throttle. Both response headers and bodies are bounded by the deadline. Bodies are limited to 2 MB, robots to 512 KB, external destinations to 100, total requests to 2,000, queue tasks to 2,000 and recorded skips to 1,000 (with an omitted count). All limits can make a large audit incomplete; a run explicitly records this instead of claiming full coverage.

English and Vietnamese currently use the **same public URL with the `gary-language` cookie**. Both server-rendered variants are inspected and counted separately in reports (up to 1,000 variants for 500 URLs, subject to time/request budgets). Canonical deduplication and duplicate metadata comparisons preserve language separation. Existing localized URLs are also discoverable; this feature does not create `/en` or `/vi` routes or invent hreflang alternates.

Page crawling is limited to configured HTTPS domains, with private/auth/admin/API/preview/staging paths, sensitive query parameters and static assets excluded. External link status checks also support public HTTP destinations on port 80, without crawling their content. DNS answers must be public addresses. The Node HTTP/HTTPS transports pin the validated address (retaining TLS hostname validation for HTTPS), including redirects, preventing DNS rebinding. Rate-limit responses respect Retry-After with bounded retries. External destination HTTP checks never recursively crawl their links and never receive the language cookie. Their robots rules are respected too. Audit routes use Node.js; on runtimes without the required DNS/HTTP transport support the network inspection fails closed.

## Interpreting results

- Content checks cover meaningful title/description presence, heading structure, topic coverage, repeated content, contextual internal link labels and missing/generic alt text. Word and sentence segmentation respects the content language. Human review recommendations address clarity, relevance and factual quality; an English reading-grade formula is not imposed on Vietnamese.
- Technical checks inspect delivered HTTP/HTML metadata, response status, indexing directives, canonical declarations and observed targets, robots rules, sitemap inclusion, redirects, observed broken destinations, JSON-LD syntax/shape, document language, hreflang syntax/observed reciprocal links and responsive viewport. Canonical and hreflang targets outside inspected scope remain explicitly unverified.
- Network timing and HTML size are recorded as diagnostics; intentional crawler throttle delays are excluded from timing. This is not a browser renderer, Core Web Vitals test, full schema validator, Google index-status API, semantic content judge or search-intent model. Use browser tools, schema validators and Search Console when the recommendation calls for them.
- Noindex can be intentional. Review restrictions before changing anything. Failed responses are non-indexable for different reasons; inspect their HTTP findings.
- Compare completed full-site runs with similar coverage. Individual-page rescans remain separate history entries and do not replace the full-site aggregate. Downloaded JSON includes both categories, page findings, scope, limits and skipped reasons.

The metadata integration follows the [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata); robots handling follows the [robots exclusion specification](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec). Audit tables follow [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) with writes confined to the server worker.
