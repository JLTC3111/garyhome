# Gary Home media retention

The protected Gary Home Owner can open **Properties → Storage & Media Management**. The inventory covers the listing photo and video buckets, saved listing states, editorial links and the existing media ledgers. A potential orphan is an audit finding. The queue records the evidence that makes a file eligible for cleanup.

## Production panel rollout, 27 November 2026

Production has `20261126100000_home_media_retention.sql` and `20261126114500_home_media_inventory_diagnostics.sql`. The Owner RPC and its diagnostics wrapper are installed. At inspection, `last_scan_at` was empty, the queue and execution ledger were empty, and permanent removal was paused. The project had no `media-orphan-cleanup` deployment, `pg_cron` or `pg_net`.

The inventory contained **1,815 objects and 776.93 MB**. The reference index flagged **639 potential orphans and 476.59 MB**. These figures include files under saved listing paths. The removal ledgers contained **519 distinct receipts**, comprising 510 photo retirements including the 509 migration originals and nine listing file removals. The paged panel puts those receipts in Cleanup History. File Trash represents currently reserved files with a restore deadline.

The legacy RPC rebuilt the normalized reference inventory and assembled a file history in one response. A read-only production plan measured 1.27 seconds for the reference inventory and 2.88 seconds for a single full negative reference check. The authenticated database statement limit is eight seconds. A recent gateway sample contained three HTTP 200 responses and one HTTP 400 for the RPC. Those logs do not establish a statement timeout or identify the failed action. The new route distinguishes actual timeouts, scan contention, missing schema, and worker failures.

### Install the panel with removal paused

1. From the Home repository, apply just the outstanding panel migration with the existing approved operator database service. Check that the protected Owner RPC and the private diagnostics function exist before running it.

   ```sql
   select to_regprocedure('public.home_media_management(text,uuid,integer)') as owner_rpc,
          to_regprocedure('private.home_media_management(text,uuid,integer)') as installed_diagnostics;
   select permanent_enabled,last_scan_at from private.home_media_control where singleton;
   ```

   ```sh
   psql -X -w -d 'service=gary-home-media sslmode=verify-full' -v ON_ERROR_STOP=1 \
     -f supabase/migrations/20261126170756_home_media_panel_pagination.sql
   ```

2. Release the reviewed Home application to the existing Vercel project serving `staff.garyhome.vn` and `garyhome.vn`. Sign in as the protected Owner and run a storage scan. It records a completion timestamp and an inventory snapshot, and performs full verification for one tracked file per scan. Further scans advance through the guarded queue. An authenticated Admin or Editor request must receive 403.
3. Open Inventory files, File Trash and Cleanup History separately. Each request carries up to 30 rows. Verify that a missing or failed page read leaves the scan time visible. Confirm that the migration originals appear in Cleanup History and there are no permanent receipts in File Trash. If there are zero verified files, the disabled Move action should explain that the potential files still need review. Historical candidates require the enrollment procedure below. When a file is ready, moving it to Trash rechecks its current identity, dependencies and lease and uses its existing restore window.

   ```sql
   select to_regprocedure('private.home_media_panel_page(text,integer)') as panel_page_helper,
          last_scan_at, inventory_sample is not null as snapshot_recorded, permanent_enabled
   from private.home_media_control where singleton;
   ```

4. Separately, deploy the worker while removal remains paused. The worker authenticates Owner requests itself and also accepts a dedicated Cron credential for scheduled runs. Use **Check cleanup worker** in the Owner panel to verify the deployment and report whether its Cron credential is configured. The check cannot claim or remove files. [Deploying Edge Functions](https://supabase.com/docs/guides/functions/deploy)

   ```sh
   supabase functions deploy media-orphan-cleanup --project-ref duyiihsmaqfgwezmsnjs --no-verify-jwt
   ```

## Current Owner orphan review and cleanup activation

Production manual cleanup is enabled. The deployed worker `media-orphan-cleanup` is active and the verification queue was empty at activation. Cron is pending its dedicated Edge and Vault credential and the scheduler extensions. All 14 GH-645 recovery objects and both GH-56 objects matched their existing protected listing paths. Keeping these and other unresolved files out of enrollment preserves their custody without disabling cleanup for eligible files.

### Release orphan review

The inventory counts unlinked Storage identities. The scan can verify existing queue records with known provenance. Historical objects enter File Trash only after independent custody review and a checksum-verified local backup. This is why 639 inventory candidates and 49 reported protected candidates can coexist with an empty verification queue.

The review RPC and holds table are installed in production. Apply the review migration only to an environment where it is missing, then release the reviewed Staff application. Cron activation is separate.

```sh
psql -X -w -d 'service=gary-home-media sslmode=verify-full' -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20261126175956_home_media_orphan_review.sql
```

Under **Properties → Storage & Media Management → Orphan review**, search by listing code or filename. Inspect the exact Storage identity and protection reason. Select up to eight files for a batch of individual dependency checks. Use **Protect file** for an unresolved file that needs a durable hold. **Release review hold** removes that hold while the existing dependency and backup requirements still apply. The historical procedure below remains the enrollment path. A completed dependency check does not indicate ownership. The application sends no file bytes during review or enrollment. Back up only files whose custody is resolved, using the verified identity and existing egress limits.

### Configure the hourly scheduler from the authenticated local terminal

The same high-entropy value belongs in the Edge secret `HOME_MEDIA_CRON_SECRET` and in project Vault as `gary_home_media_cron_secret`. The existing function is already deployed. Run the command from Gary Home with an authenticated Supabase CLI v3 session. The local `supabase/config.toml` uses `[local_smtp]`, as required by CLI v3. Confirm the operation if prompted for the production project. The command copies the value to the clipboard only after the Edge secret is saved. [CLI v3 upgrade guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3) · [Vault](https://supabase.com/docs/guides/database/vault) · [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

```sh
(
  set +x
  set -e -o pipefail
  umask 077
  GARY_HOME_MEDIA_SECRET_FILE="$(mktemp -t gary-home-media-cron)"
  trap 'rm -f "$GARY_HOME_MEDIA_SECRET_FILE"' EXIT
  openssl rand -hex 32 | sed 's/^/HOME_MEDIA_CRON_SECRET=/' > "$GARY_HOME_MEDIA_SECRET_FILE"
  supabase secrets set --remote=duyiihsmaqfgwezmsnjs --env-file "$GARY_HOME_MEDIA_SECRET_FILE"
  sed 's/^HOME_MEDIA_CRON_SECRET=//' "$GARY_HOME_MEDIA_SECRET_FILE" | tr -d '\n' | pbcopy
  printf '%s\n' 'Cron secret copied for the Gary Home Vault.'
)
```

In Supabase project `duyiihsmaqfgwezmsnjs`, open **Vault**, save the clipboard value as `gary_home_media_cron_secret`, and clear the clipboard. The command removes the temporary file on exit. Using the Vault form keeps the value out of SQL statements and database query logs.

```sh
printf '' | pbcopy
```

Use **Check cleanup worker** under the protected Owner session. It should confirm Worker access and report a configured Cron credential. Enable the Cron Postgres module and `pg_net` on this project through Supabase Integrations and Extensions, or use the following operational SQL. [Install Supabase Cron](https://supabase.com/docs/guides/cron/install) · [Enable pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)

```sql
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema extensions;
```

The permanent deletion gate is already enabled in production. The exact idempotent activation command, if needed, is shown below. The scheduler script checks the gate and Vault credential and sets the job for minute 7 of each hour. It is an operational script and does not apply any pending application migrations. [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)

```sql
update private.home_media_control set permanent_enabled=true where singleton and not permanent_enabled;
```

```sh
psql -X -w -d 'service=gary-home-media sslmode=verify-full' -v ON_ERROR_STOP=1 \
  -f supabase/ops/schedule-home-media-cleanup.sql
```

After the first scheduled dispatch, check the job status and the corresponding scheduler-authenticated worker run. A successful Cron dispatch alone does not establish worker success. With an empty queue, expect a completed run with zero attempted and zero removed. The panel's **Cleanup runs** should show the same record. Credentials stay out of these results.

```sql
select jobname,schedule,active from cron.job where jobname='gary-home-media-expiry';
select r.start_time,r.end_time,r.status
from cron.job_run_details r join cron.job j using(jobid)
where j.jobname='gary-home-media-expiry' order by r.start_time desc limit 10;
select started_at,finished_at,attempted,removed,failed
from private.home_media_runs where actor is null order by started_at desc limit 10;
select source,state,unreferenced_since,expires_at,expires_at-unreferenced_since as retention_window
from private.home_media_items where state in ('trashed','deleting') order by expires_at limit 20;
```

Check that an approved historical receipt gets 48 hours from its enrollment and is excluded from scheduled work before expiration. Keep drafts, upload leases, existing holds, and unresolved historical receipts protected throughout verification. Older untracked videos do not have a historical photo enrollment path. Keep them in custody review or use their existing guarded listing/upload workflow when applicable.

## Restore and permanent removal

- A saved photo or video removal captures its actual listing media fields. Restore puts the original link and captured filename, caption and alt text back on that listing. It uses the saved gallery neighbours to place the photo and preserves other current links.
- Restoring media from a deleted listing creates a recovered **draft** with a new listing ID. Later restores reuse that draft. Each recovery puts back the chosen file and the metadata captured for it. This keeps the original deletion receipt and its CRM history intact.
- A recoverable rename records the affected listing media before and after the switch. Restore reapplies the saved listing fields only while the captured after-state still matches each affected listing. A newer media edit produces a conflict for review. Other records can keep their valid replacement links.
- Entries without a historical listing link, such as verified abandoned uploads, offer **Keep file**. An older deletion or rename whose original listing fields were never captured shows why Restore is unavailable.

Files remain at their original Storage paths during the 48-hour recovery window. An Owner can explicitly confirm **Permanently delete now** for a single eligible file. The server binds the confirmation to that queue entry and expiry, verifies the current Owner, and checks leases, references and object identity again. Both manual removal and the separately authenticated hourly worker use the same gate and Removal API. Hourly cleanup attempts an eligible batch at the first run after its deadline. If a previously attempted removal loses its acknowledgement, the worker confirms catalogue absence using its recorded intent, including after the last allowed delete attempt.

## Historical orphan enrollment

The original audit cohort has 617 files. A read-only follow-up found that all 115 filename-only hits share an alias with a different referenced object. The 29 listing-scoped candidates still sit under published listings. Sixteen other unindexed objects sit under draft paths. A filename, shared alias, missing index hit and saved-listing prefix are clues for the review.

1. Use the existing per-object classification report under `work/property-media-audit-20261125.1T3KYQ/`. Reconcile the exact current bucket key, object ID, version, ETag and byte count against its original row and the completed WebP replacement map. Check published and draft listings, gallery and cover fields, captions and other metadata, embedded URLs, editorial and historical records, rename and deletion manifests, pending uploads and the scoped listing ownership. Treat encoded versions of the same path as a single key. Keep ambiguous filename aliases and live listing or unresolved draft ownership in review.
2. Verify custody using independent evidence such as the original upload or change audit with the complete key and identity, or a documented file release supported by the owning workflow. Record what was checked, the reviewer and the evidence reference. Reference a real record or retained audit artifact. Protect shared, archived, pending, versioned and unproven objects.
3. Back up the exact object using the Storage API. Verify the local checksum and retain the backup and identity manifest in private operator storage. Confirm that the live identity is unchanged after backup.
4. In the authenticated Home Owner session submit the reviewed identity and checked SHA-256 to the guarded intake RPC. Enroll a verified object as part of completing its review.

   ```js
   const { data, error } = await homeOwnerClient.rpc('home_media_enroll_historical', {
     p_review: { key, objectId, version, etag, bytes, backupSha256, evidenceRef },
     p_confirm: true,
   })
   if (error) throw error
   console.log(data.id, data.expiresAt)
   ```

   A successful receipt creates a historical review entry directly in File Trash and starts its 48-hour window in the same transaction. A retry with the same identity and review returns the same receipt. A held or changed object remains in review with its evidence. Historical enrollment has its own audit record and uses the existing snapshot lock and media guards.

## Original WebP cutover procedure

These steps describe the earlier migration cutover. The live cleanup activation instructions are above.

1. Keep the deployed app and database on their current releases while the existing 509-image runner is active. Keep its staging root, source backups and sealed journals. The existing retirement API returns `removed: true` after confirmed removal. The retention release changes that path to return a Trash deadline. Applying the new SQL or serving the new route during the job risks incomplete retirement checkpoints.
2. Confirm the runner released its lock and recorded 509 completed retirements and a public gallery check in `guarded-write/completion.json`. Use the current runner for a fresh read-only check when needed.

   ```sh
   cd /Users/skycastle3/Desktop/gary_group/gary_home_website
   GARY_WEBP_STAGE=work/property-media-audit-20261125.1T3KYQ/execution
   test ! -e "$GARY_WEBP_STAGE/guarded-write/.migration.lock"
   node scripts/resume-property-media.mjs --work "$GARY_WEBP_STAGE" \
     --expected-count 509 --verify-complete --prompt-db-password
   ```

   Require `confirmed: 509` and `site.gallery: true`. Recheck any separately reported broken gallery URL and its affected image delivery before rollout. Keep the prior local originals available for recovery.
3. During the coordinated release, retire the old listing cleanup schedule, apply `supabase/migrations/20261126100000_home_media_retention.sql` manually, deploy the Edge Function and switch the staff app together. The migration starts with permanent removal paused. The staff uploader depends on its new lease RPC.

   ```sh
   supabase functions deploy media-orphan-cleanup --project-ref duyiihsmaqfgwezmsnjs
   ```

   The function configuration delegates authentication to the handler. Set the dedicated `HOME_MEDIA_CRON_SECRET` in the Edge secret manager and the same value in Supabase Vault as `gary_home_media_cron_secret`. [Edge Function authentication](https://supabase.com/docs/guides/functions/auth) · [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
4. Keep removal paused while checking the Owner panel and direct Admin denials. Remove and restore a test photo or video and confirm the saved property fields. Test a recovered draft, an early-delete preview and an interrupted cleanup in the approved test environment. Review the historical intake results and unresolved holds.
5. Once activation is approved, enable permanent operations through the database operator connection and run `supabase/ops/schedule-home-media-cleanup.sql` manually to install the hourly schedule.

   ```sql
   update private.home_media_control set permanent_enabled=true where singleton;
   ```

## Stop and reconcile

Set `permanent_enabled=false` and unschedule `gary-home-media-expiry` to pause new permanent work. Inspect the lease, cleanup receipt and live Storage identity for any interrupted request. Keep the queue and existing guards in place while resolving interrupted jobs. The legacy immediate retirement route is a separate deployment contract. Reverting to that route requires a coordinated rollback review of pending recoverable files.
