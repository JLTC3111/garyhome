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
3. Open Inventory files, File Trash and Cleanup History separately. Each request carries up to 30 rows. Verify that a missing or failed page read leaves the scan time visible. Confirm that the migration originals appear in Cleanup History and there are no permanent receipts in File Trash. If there are zero verified files, the disabled Move action should explain that the potential files still need review. The 617 historical candidates still require the enrollment procedure below. When a file is ready, moving it to Trash rechecks its current identity, dependencies and lease and uses its existing restore window.

   ```sql
   select to_regprocedure('private.home_media_panel_page(text,integer)') as panel_page_helper,
          last_scan_at, inventory_sample is not null as snapshot_recorded, permanent_enabled
   from private.home_media_control where singleton;
   ```

4. Separately, deploy the worker while removal remains paused. The worker authenticates Owner requests itself and also accepts a dedicated Cron credential for scheduled runs. Use **Check cleanup worker** in the Owner panel to verify the deployment and report whether its Cron credential is configured. The check cannot claim or remove files. [Deploying Edge Functions](https://supabase.com/docs/guides/functions/deploy)

   ```sh
   supabase functions deploy media-orphan-cleanup --project-ref duyiihsmaqfgwezmsnjs --no-verify-jwt
   ```

### Activate permanent cleanup only after recovery review

Keep `permanent_enabled=false` and leave Cron unscheduled while the affected draft galleries are recovered and verified. At inspection GH-645 and GH-56 still had empty galleries. Review the unresolved drafts and current public gallery delivery before approving any activation. [Gallery recovery instructions](production-media-incident-20261126.md)

After approval, enable the `pg_cron` and `pg_net` extensions in the existing project. Set `HOME_MEDIA_CRON_SECRET` for the Edge Function using a protected local env file and put the identical value in Vault as `gary_home_media_cron_secret`. Keep the secret out of checked-in files, command arguments and logs. Use the Owner health check before enabling the gate. [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)

```sh
supabase secrets set --project-ref duyiihsmaqfgwezmsnjs --env-file "$GARY_HOME_MEDIA_SECRET_FILE"
```

Then run the following manual activation SQL and the existing hourly schedule script. The schedule script verifies the gate and the Vault credential before it installs the job for minute 7 of each hour.

```sql
update private.home_media_control set permanent_enabled=true where singleton;
```

```sh
psql -X -w -d 'service=gary-home-media sslmode=verify-full' -v ON_ERROR_STOP=1 \
  -f supabase/ops/schedule-home-media-cleanup.sql
```

With the Cron extension installed, verify the referenced job and its recent status without selecting its command or Vault values.

```sql
select jobname,schedule,active from cron.job where jobname='gary-home-media-expiry';
select r.start_time,r.end_time,r.status
from cron.job_run_details r join cron.job j using(jobid)
where j.jobname='gary-home-media-expiry' order by r.start_time desc limit 10;
```

A successful Cron invocation confirms dispatch. Check the worker logs and Cleanup runs for the actual outcome.

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

## Coordinated cutover

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
