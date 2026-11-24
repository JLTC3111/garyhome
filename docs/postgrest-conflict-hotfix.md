# PostgREST application conflict hotfix

## Incident

PostgREST 14.18 retried transactions after deliberate application `40001` errors. These errors represented version mismatches or changed preconditions. Retrying the same arguments could not resolve them. Changing the raises to `PT409` makes PostgREST return HTTP 409. PostgreSQL retains its standard serialization and deadlock behavior. [Supabase advisory](https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)

The Jobs HAR covers 24 November 2026 from 19:12:27 to 19:21:05 UTC. It contains zero save or restore requests. In the same window the API edge logs returned four `jobs_capabilities` events and no matching save or restore completions. PostgreSQL recorded 518 identical `jobs.version_conflict` events. Live activity showed the affected statements under `authenticator` with application name `PostgREST 14.18`. The first snapshot matched PIDs 3613641 and 3614388. The second matched 3613641 and 3608033, with a transaction-ID wait visible on one session. A PID alone cannot identify the original client or justify termination.

The sole browser call to `jobs_cms_save` is in `dist/jobs-cms-save.js`. The Jobs CMS publishing adapter reaches it for explicit draft saves, a required save before publication, vacancy image changes, and inline reference creation. Jobs Talent Pool can also save a story draft through the adapter. The live catalog identifies the public save wrapper and the revision restore function as the two callers of `jobs_private.save_content`. Restore invokes it in the same transaction. The repository’s Jobs API handlers, workers and schedulers contained no separate caller, and the shared database has no `cron.job` catalog. Dirty-state, focus, visibility and token refresh code did not submit the draft. The slug retry is bounded and requires the exact `23505` URL uniqueness constraint.

The failed transactions can repeatedly initialize PostgREST request context before raising the same error. Context SQL can also succeed in transactions that subsequently fail. Statement counters and edge access events represent different units, so they cannot identify the number of original HTTP requests.

| Consecutive snapshot, 20:27:35 to 20:33:54 UTC | Observed difference |
| --- | ---: |
| Authenticated context statement, query ID `5360251647081715348` | +463,566 executions in 378.97 seconds, about 1,223 per second |
| Anonymous executions of the same context statement | +12 |
| Tracked successful Jobs saves, query ID `-2237572847033037030` | 44 to 44 |
| Realtime WAL statement, query ID `-5100739616020158138` | +627 calls and +63,804.09 ms, or 101.76 ms per call |

The Realtime query ran as `supabase_admin`. Its statement totals showed zero shared blocks read and zero temporary blocks written in the sampled inventory. The slower interval is consistent with resource pressure during the retry storm. The samples do not establish a direct lock dependency or exclude concurrent WAL and subscription workload. Compare the same query ID after the retry rate drops and review remaining waits before attributing the rest.

## Function review

All 35 listed raises become `PT409`. Deployed definitions were reviewed individually. The expanded application-schema inventory found no other matching functions and no deliberate `40P01` raise or genuine handler among these 24. Earlier migrations retain their historical definitions. The hotfix migrations use `CREATE OR REPLACE FUNCTION` and contain no grants, policy changes, trigger changes, or data statements.

### Teaching Jobs

| Function signature | Raises | Unchanged messages | Conflict condition | Prior migration versions |
| --- | ---: | --- | --- | --- |
| `jobs_private.save_content(p_record jsonb, p_expected_version integer)` | 2 | `jobs.version_conflict` | Existing draft has another version. New entry carries a version above zero. | 20261116043122 |
| `jobs_private.transition_application(p_id uuid, p_stage text, p_assignee uuid, p_expected_version integer)` | 1 | `jobs.version_conflict` | Recruitment stage or assignee uses an outdated application version. | 20261117202945 |
| `jobs_private.transition_content(p_id uuid, p_status text, p_expected_version integer)` | 1 | `jobs.version_conflict` | Publication transition uses an outdated draft version. | 20261117102706 |
| `jobs_private.update_staff(p_user_id uuid, p_role text, p_active boolean, p_display_name text, p_expected_version integer)` | 1 | `jobs.version_conflict` | Staff membership uses an outdated version. | 20261117195500 |

### Home and shared

| Function signature | Raises | Unchanged messages | Conflict condition | Prior migration versions |
| --- | ---: | --- | --- | --- |
| `private.guard_home_listing_delete()` | 1 | `listing_cleanup.deleted` | A previous deletion prevents restoration of a retired listing ID. | 20261119095000 |
| `private.guard_home_listing_media_ref()` | 1 | `listing_cleanup.retired_reference` | A write would introduce a new reference to retired media. | 20261119095000 |
| `private.guard_home_photo_reference()` | 3 | `photo_rename.stale_reference` | A listing or setting, an editorial source, or a related record references a retired photo. | 20261119054408 |
| `private.home_photo_rename_apply(p_id uuid, p_version timestamp with time zone)` | 3 | `photo_rename.unverified`, `photo_rename.stale_listing`, `photo_rename.other_origin` | The copy is unverified, the listing changed, or another Storage origin owns a reference. | 20261119054408, 20261119183631 |
| `private.home_photo_rename_request_removal(p_id uuid, p_confirm boolean)` | 3 | `photo_rename.unverified`, `photo_rename.in_use`, `photo_rename.replacement_unavailable` | Rename is unverified, the original is referenced, or the replacement is unavailable. | 20261119095000, 20261119183631 |
| `private.home_photo_rename_reserve(p_property uuid, p_origin text, p_old_key text, p_name text, p_version timestamp with time zone)` | 2 | `photo_rename.pending_name`, `photo_rename.stale_listing` | A pending rename targets another name, or the listing version changed. | 20261119054408, 20261119183631 |
| `private.limit_portal_guide_files()` | 1 | `The guide changed during upload; review its audience before attaching this file` | The guide version or audience changed during upload. | 20261028085344 |
| `public.home_listing_delete_adopt(p_property uuid, p_manifest jsonb)` | 1 | `listing_cleanup.manifest_changed` | The reviewed Storage manifest no longer describes eligible objects. | 20261119095000 |
| `public.home_listing_delete_prepare(p_property uuid, p_version timestamp with time zone)` | 2 | `listing_cleanup.stale`, `listing_cleanup.rename_pending` | The listing version changed or a photo rename is pending. | 20261119095000 |
| `public.save_property_order(order_scope text, ordered_property_ids uuid[], expected_property_ids uuid[])` | 1 | `This order changed. Refresh the page before saving.` | The saved order differs from the editor’s expected order. | 20261023125023 |

### Visa

| Function signature | Raises | Unchanged messages | Conflict condition | Prior migration versions |
| --- | ---: | --- | --- | --- |
| `gary_private.cms_save(p_record jsonb, p_expected_version integer, p_action text)` | 2 | `CMS_VERSION_CONFLICT` | Existing CMS row has a stale or missing version. A new row is sent with an expected version. | 20261124052852 |
| `gary_private.cms_transition(p_id uuid, p_status text, p_expected_version integer)` | 1 | `CMS_VERSION_CONFLICT` | The transition uses a stale or missing CMS version. | 20261116043114 |
| `gary_private.edit_staff_member(p_user_id uuid, p_full_name text, p_expected_name text, p_operations_role text, p_expected_operations_role text, p_cms_role text, p_expected_cms_role text)` | 1 | `AGENCY_ROLE_CONFLICT` | A displayed name or either membership role changed. | 20261124151500 |
| `gary_private.permanently_delete_trash(p_kind text, p_id uuid, p_deleted_at timestamp with time zone, p_confirmed boolean)` | 2 | `AGENCY_TRASH_CHANGED` | The trash timestamp changed or the expected deletion row was absent. | 20261124170509 |
| `gary_private.remove_staff_member(p_user_id uuid, p_expected_operations_role text, p_expected_cms_role text)` | 1 | `AGENCY_ROLE_CONFLICT` | At least one current role differs from the reviewed role. | 20261124151500 |
| `gary_private.restore_record(p_kind text, p_id uuid, p_expected_version integer)` | 1 | `CMS_VERSION_CONFLICT` | Restoration uses a stale CMS version. | 20261117190000 |
| `gary_private.set_cms_role(p_user_id uuid, p_role text, p_expected_role text)` | 1 | `AGENCY_ROLE_CONFLICT` | The CMS role differs from the reviewed role. | 20261124151500 |
| `gary_private.set_operations_role(p_user_id uuid, p_role text, p_expected_role text)` | 1 | `AGENCY_ROLE_CONFLICT` | The Operations role differs from the reviewed role. | 20261124151500 |
| `gary_private.trash_record(p_kind text, p_id uuid, p_expected_version integer)` | 1 | `CMS_VERSION_CONFLICT` | Trash uses a stale CMS version. | 20261124170509 |
| `public.gary_cms_update_media(p_id uuid, p_version integer, p_alt_en text, p_alt_vi text, p_caption_en text, p_caption_vi text)` | 1 | `CMS_VERSION_CONFLICT` | The media version changed or the asset is no longer ready. | 20261124053400 |

## Manual rollout

1. Run the catalog query below and retain its results, including OIDs, owner, ACL and `proconfig`. Use the supplied prior hashes to check the exact catalog bodies. Save the current `pg_get_functiondef` output for the 24 signatures in a restricted operator file. Resolve any definition drift against the current definitions before applying that batch.
2. Apply the migration `20261124202611_jobs_postgrest_conflict_sqlstates.sql` from Teaching Jobs first. If the batch cannot acquire its DDL locks promptly, review the blocker and retry the authorized migration as a separate operation.
3. After the Jobs catalog verifies, review existing looping Jobs sessions using the procedure below. An authorized operator can end individually confirmed sessions if they remain stuck.
4. Apply `20261124202612_home_postgrest_conflict_sqlstates.sql` from Home and then `20261124202613_visa_postgrest_conflict_sqlstates.sql` from Visa. Keep each migration version unique in the shared project’s migration history.
5. Release the corresponding application conflict handlers. In an authorized staging environment use two editor sessions to commit one version, then submit a stale copy. Confirm a single HTTP 409 with `code=PT409`, the error message in the table, the stored winner unchanged, and the stale edit still open. Repeat with protected staff, media and trash roles where applicable. Production checks can use passive logs and catalog reads.

### Catalog preflight and verification

Run in a read-only session with `search_path` containing `public`, as used for the catalog snapshots. Before each batch, each target should exist with `before_matches` true. After it, confirm `only_conflict_codes_changed` is true and the identity and security metadata match the preflight output.

```sql
with expected(app, signature, raises, before_md5) as (
  values
    ('jobs','jobs_private.save_content(jsonb,integer)',2,'158d1700b4ee88472a69aadec66e2a6f'),
    ('jobs','jobs_private.transition_application(uuid,text,uuid,integer)',1,'3d3fd54f60b457df6fe2b68374106c0c'),
    ('jobs','jobs_private.transition_content(uuid,text,integer)',1,'97043c351cc3e50c34e74422467ae293'),
    ('jobs','jobs_private.update_staff(uuid,text,boolean,text,integer)',1,'2fb2b7f20ab3c15beffb1482919c66d2'),
    ('home','private.guard_home_listing_delete()',1,'de36036319c15ae8d660ba4087059532'),
    ('home','private.guard_home_listing_media_ref()',1,'e4246bda5dfe50bb7437585613701e56'),
    ('home','private.guard_home_photo_reference()',3,'9ea6b9da08fb121365735901648ddb18'),
    ('home','private.home_photo_rename_apply(uuid,timestamp with time zone)',3,'26a6d8bc0f0aa53e6836f13e96183f07'),
    ('home','private.home_photo_rename_request_removal(uuid,boolean)',3,'7ed969468d27af5af011de534c2dbbb3'),
    ('home','private.home_photo_rename_reserve(uuid,text,text,text,timestamp with time zone)',2,'786d3b6b995e027d3e44d162a27f4245'),
    ('home','private.limit_portal_guide_files()',1,'cf7e12de07e08f71a5f33194308072dc'),
    ('home','public.home_listing_delete_adopt(uuid,jsonb)',1,'4012d1fc156ec73d7d00e56c067aeeae'),
    ('home','public.home_listing_delete_prepare(uuid,timestamp with time zone)',2,'4bfe3f0e31a93c43d2ca242e920d336e'),
    ('home','public.save_property_order(text,uuid[],uuid[])',1,'2e636e4f23c31c50ced5cf64abcc6277'),
    ('visa','gary_private.cms_save(jsonb,integer,text)',2,'2cfeefc3583cb32671180c46da3d48e1'),
    ('visa','gary_private.cms_transition(uuid,text,integer)',1,'113b7dc82a3f7a7804f75e5fdadfe163'),
    ('visa','gary_private.edit_staff_member(uuid,text,text,text,text,text,text)',1,'20045f7c091c735a539d7f55a5ea95a7'),
    ('visa','gary_private.permanently_delete_trash(text,uuid,timestamp with time zone,boolean)',2,'4403bd1e8176b41556134ab5ee2f52a4'),
    ('visa','gary_private.remove_staff_member(uuid,text,text)',1,'eb882f72d6256fa846cda3e60cc18e66'),
    ('visa','gary_private.restore_record(text,uuid,integer)',1,'81273350215669a4889d447c18990f67'),
    ('visa','gary_private.set_cms_role(uuid,text,text)',1,'e9fac2293a5a0fe589b9e72bd8969512'),
    ('visa','gary_private.set_operations_role(uuid,text,text)',1,'7494f1eaba26a9f1a85a22b43d7132f0'),
    ('visa','gary_private.trash_record(text,uuid,integer)',1,'f97a07c4b38d5fdf097b8fb7992ba8db'),
    ('visa','public.gary_cms_update_media(uuid,integer,text,text,text,text)',1,'62aebfa82cb49d10e042e15e77b1364b')
), installed as (
  select e.*, p.oid, pg_get_userbyid(p.proowner) as owner, p.proacl,
    p.proconfig, p.prosecdef, pg_get_functiondef(p.oid) as definition
  from expected e
  left join pg_proc p on p.oid = to_regprocedure(e.signature)
)
select app, signature, oid, owner, proacl, proconfig, prosecdef,
  md5(definition) = before_md5 as before_matches,
  md5(replace(definition, '''PT409''', '''40001''')) = before_md5
    and (length(definition) - length(replace(definition, '''PT409''', ''))) / 7 = raises
    as only_conflict_codes_changed
from installed
order by app, signature;
```

To check for remaining literal retry codes and named conditions in application functions, inspect each result in context.

```sql
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prokind = 'f'
  and n.nspname ~ '^(public|private|gary_.*|jobs_.*|home_.*)$'
  and p.prosrc ~* '(40001|40P01|serialization_failure|deadlock_detected)'
order by 1, 2, 3;
```

### Existing retry sessions

Correlate repeated identical Jobs errors with the PostgreSQL log `process_id` and recent timestamps. Run this read-only query, then record the current PID and `backend_start` pairs for the confirmed loops. A transaction-ID waiter may simply be blocked by a different session. Follow `blockers` and verify each session independently.

```sql
select pid, backend_start, xact_start, query_start, usename, application_name,
  state, wait_event_type, wait_event, pg_blocking_pids(pid) as blockers
from pg_stat_activity
where backend_type = 'client backend'
  and usename = 'authenticator'
  and application_name like 'PostgREST %'
  and query ~* '\\m(jobs_cms_save|jobs_cms_restore|jobs_private\\.save_content)\\M'
order by backend_start;
```

After the Jobs hotfix verifies and termination is separately authorized, an operator can enter **one newly confirmed** PID and backend start into the guarded command below. The placeholder values match no session. Repeat the read-only query immediately before each operation. Termination rolls back any open transaction for the selected connection.

```sql
with confirmed(pid, started) as (values (0, null::timestamptz))
select a.pid, pg_terminate_backend(a.pid) as terminated
from confirmed c
join pg_stat_activity a on a.pid = c.pid and a.backend_start = c.started
where a.pid <> pg_backend_pid()
  and a.backend_type = 'client backend'
  and a.usename = 'authenticator'
  and a.application_name like 'PostgREST %'
  and a.state in ('active', 'idle in transaction', 'idle in transaction (aborted)')
  and a.query ~* '\\m(jobs_cms_save|jobs_cms_restore|jobs_private\\.save_content)\\M';
```

### Post-deployment sampling

Capture the following twice at least a minute apart using fresh read-only sessions. Compare matching roles and query IDs. Compute rates as the call delta divided by elapsed seconds, and interval mean WAL time as the total execution-time delta divided by the call delta. Treat negative differences or a changed statistics reset time as a new baseline. Keep the cumulative statistics intact.

```sql
select now() as observed_at, r.rolname, s.queryid, s.calls, s.rows,
  s.total_exec_time, s.shared_blks_read, s.temp_blks_written
from extensions.pg_stat_statements s
join pg_roles r on r.oid = s.userid
where s.queryid in (5360251647081715348, -2237572847033037030, -5100739616020158138)
order by r.rolname, s.queryid;

select stats_reset from extensions.pg_stat_statements_info;
```

Sample logical replication lag alongside the Realtime statement if its interval mean stays elevated.

```sql
select plugin, active, count(*) as slots,
  max(pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)) as max_flush_lag_bytes
from pg_replication_slots
where slot_type = 'logical'
group by plugin, active
order by plugin, active;
```

In Logs Explorer, match `jobs.version_conflict` and SQLSTATE 40001 in PostgreSQL logs. Group the API edge logs for `POST /rest/v1/rpc/jobs_cms_save` and `jobs_cms_restore` by status. Confirm the repeating SQL errors stop and any new application conflicts appear as 409. Compare the target PIDs against fresh activity and measure Realtime again. A separate source or request log is needed to attribute an original client.

### Rollback

If a migration fails inside its transaction, verify the batch stayed at its preflight hashes. Application code can be rolled back independently while the database fix remains active. For a database regression, prefer restoring the prior function body from the operator backup with its deliberate conflicts still using `PT409`. Restoring deliberate `40001` on PostgREST 14 can recreate the incident. A full database rollback requires a separate decision, traffic drained or a fixed PostgREST version, and the exact backed-up definitions applied in reverse batch order. Verify unchanged ownership and ACL afterward.

## Home dashboard HAR

The staff capture showed four dashboard cycles. Each included seven paged datasets and one settings read. The paged datasets issued a second empty GET because the old helper used an empty response to prove exhaustion. The 120 HAR entries for this group comprise 60 GETs and 60 CORS preflights. The combined capture includes the overlapping staff session and a public page with four enquiry GETs and 26 route prefetches. Counting the whole combined and the whole staff files together would double-count captured events.

| Metric | Captured baseline | Local evidence after changes |
| --- | --- | --- |
| Staff data GETs | Four cycles, 60 requests | Eight reads per cycle. Replaying four wake times produced two cycles and 16 reads. |
| Authenticated public staff data | Public page included dashboard properties and enquiries | Public route fixture opened without a Studio dataset request or staff portrait subscription. |
| Property list | 76 rows, 1,067,714 decoded bytes | The same rows projected to the shipped field list serialize to 296,065 bytes, down 72.3%. The editor requests a full row on demand. |
| Staff property images | 76 originals transferred 59,193,250 bytes. Staff images overall transferred about 60.3 MB. | Offline resizing of the 76 recorded originals to 128px WebP at quality 75 yielded 190,836 bytes of image bodies. This excludes HTTP overhead and mobile or high-DPR variation. |
| Public and staff images | 132,728,970 transferred bytes in the combined file, including 129,799,075 bytes of property originals | Listing views request responsive image sizes. The gallery fetches the selected original when opened. Production bytes still need a capture. |
| Staff profile subscription | Three initialization attempts reported in the capture analysis | One channel in the focused fixture. It survives recovery and clears when access is revoked. Its filters cover the signed-in staff member’s inserts and updates. |
| Manifest and membership | Ten manifest GETs and five team membership GETs in the staff capture | Manifest checks use a five-minute freshness window. Membership verification still runs immediately for a new wake event. Duplicate events in one burst share the check. |
| Rendering | Reported LCP 6 seconds. The staff HAR shows the first property GET at 5.13 seconds, with 31 script requests having started earlier and about 621 KB of total script transfer from those requests. The initial document spent 2.31 seconds waiting for response headers. | The initial data payload is smaller and listing links skip automatic prefetch. Document waiting time and JavaScript execution still need a post-release trace. |

The Studio uses a separate in-memory snapshot with up to five minutes of reuse on foreground recovery. Workspace refresh remains immediate when explicitly requested. Authentication and permission checks are independent from this data cache. The workstation test records the outbound request counts. The image numbers come from the captured image bodies and are an offline size comparison.

Visa and Jobs staff HARs had much smaller initial image traffic, approximately 434 KB and 45 KB, respectively. Both contain an independent permission refresh path that coalesces overlapping checks. Teaching Jobs now uses the explicit auth bootstrap for the initial session instead of requesting it again from the SDK callback. Visa's initialization guard already coalesces its profile startup. Visa's public CMS and Jobs' public catalogue use independent paging and assume the server cap is at least the requested batch size. Those catalogue reads were outside the staff captures. The Home provider, pagination, thumbnail and manifest changes are scoped to Home.

## Changed files

### Home

- Dashboard and data reads in `components/site-context.tsx`, `components/admin-page.tsx`, `components/customer-manager.tsx`, `lib/studio-catalogue.ts`, `lib/pagination.ts`, `lib/public-content.ts`, and `lib/session-recovery.ts`.
- Image delivery and navigation in `components/content-image.tsx`, `components/property-card.tsx`, `components/property-gallery.tsx`, `components/property-photo-grid.tsx`, `components/embla-carousel-listing-card.tsx`, `lib/optimized-property-images.ts`, `next.config.ts`, and `shared/gary-apps/client.js`.
- Conflict handling in `components/property-order-controls.tsx`, `components/listing-deletion-queue.tsx`, `components/portal-guide-editor.tsx`, `lib/conflict-response.ts`, `lib/property-deletion-server.ts`, and `lib/property-photo-rename-server.ts`.
- Checks in `tests/studio-recovery.test.mjs`, `tests/pagination.test.mjs`, `tests/public-content.test.mjs`, `tests/property-order-ui.test.mjs`, `tests/property-order-database.test.mjs`, `tests/portal-help-database.test.mjs`, `tests/property-photo-rename.test.mjs`, and `tests/property-photo-grid.test.mjs`.

### Teaching Jobs

- `dist/conflict-response.js`, `dist/cms-foundation/index.js`, `dist/jobs-backend.js`, `dist/jobs-cms-save.js`, `dist/jobs-portal.js`, `dist/jobs-publishing-adapter.js`, `dist/jobs-staff-management.js`, and `dist/jobs-talent-pool.js`.
- `tests/jobs-cms-save.test.mjs`, `tests/jobs-cms-references.test.mjs`, `tests/jobs-database.test.mjs`, `tests/jobs-publishing-adapter.test.mjs`, `tests/jobs-staff-management.test.mjs`, and `tests/jobs-staff-management-db.test.mjs`.

### Visa

- `dist/conflict-response.js`, `dist/cms-foundation/index.js`, `dist/cms.js`, `dist/staff-access.js`, `dist/trash.js`, and `dist/workspace-ui.js`.
- `scripts/cms-delete.test.mjs`, `scripts/roles-database.test.mjs`, `scripts/shared-cms.test.mjs`, and `scripts/staff-access.test.mjs`.

The migration files are listed in rollout order above. The read-only catalog preflight matched all 24 original definition hashes. The three local migration files were compared against those deployed definitions and changed exactly the 35 SQLSTATE literals in the reviewed raises.
