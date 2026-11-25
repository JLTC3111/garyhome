# Image storage and bandwidth

## Uploads and delivery

| Application | Upload policy | Delivery |
| --- | --- | --- |
| Home property-media | Source up to 8 MiB. Aim for 240 KB, with a 500 KB encoded cap. Use 1920, 1600 or 1280 px on the long edge and preserve aspect ratio. | Serve covers, thumbnails, and full-size views directly from the stored public object. Resolve old Supabase transformation URLs at display and SEO boundaries. |
| Home staff avatars | Source up to 2 MiB. Aim for 45 KB, with a 100 KB cap and a long edge up to 384 px. | Retain the immutable per-upload URL and the current avatar visibility. |
| Visa editorial media | Source up to 5 MiB. Aim for 300 KB, with a 650 KB cap and a long edge up to 2400 px. | Keep lazy article cards and the five-minute public Storage browser TTL. |
| Visa avatars | Keep the 384 px square crop and zoom controls. Encode toward 45 KB, with a 100 KB cap. | Keep the existing private bucket and short-lived signed previews. Use lazy images in the staff roster. |
| Jobs CMS and vacancy images | Aim for 300 KB, with a 650 KB encoded cap and a long edge up to 2400 px. The existing 8 MiB CMS and 4 MiB vacancy source limits stay in place. | Cache new public CMS keys for one day. Vacancy images use lazy previews and the existing published-image endpoint with immediate revalidation. |

There is no browser transcoding for Visa documents, Home private submissions or videos, Jobs CVs, or private candidate portraits. Authorization and RLS continue to govern uploads. The Jobs vacancy Edge Function still validates, reserves and publishes images. Its existing JPEG and PNG fallback encoding can normalize embedded metadata. The WebP path avoids that second encode. Visa's reservation stores the actual transmitted MIME and byte size. A legacy reservation with the original MIME and size can still use its original file. For an interrupted optimized upload, use the original file in the same browser so it can reproduce the reserved rendition. If Storage already has the object, the existing registration action can verify it.

The browser keeps efficient originals and prefers WebP for compatible content. It can transfer standard PNG physical density to WebP EXIF and retain transparency. Output with portable JPEG metadata can stay JPEG. The processor retains EXIF, IPTC and JPEG comments in those JPEGs and corrects the EXIF display orientation and dimensions after resizing. Files with metadata that requires their original container, such as a color profile or XMP, can pass through within Home's 1,920 px and 500 KB caps. Larger protected files need a compatible smaller source. Browser output is decoded again and checked for dimensions and sampled pixel differences. Review fine detail and transparency on real pilot images, especially floor plans, dense interiors and the Jobs 4× crop. [WebP container specification](https://developers.google.com/speed/webp/docs/riff_container)

Home's browser and local Sharp converter share the encoding profile and filename generator. The 1,920, 1,600 and 1,280 px choices are alternatives for a single stored image. Next.js provides display sizes from that image.

## Proposed Storage limits

| Bucket | Current repository limit | Proposed after the pilot |
| --- | ---: | ---: |
| Home property-media | 8 MiB | 500,000 bytes. Keep 8 MiB until larger originals needed by the same-byte rename and rollback flows have been handled. |
| Home staff-avatars | 2 MiB | 100,000 bytes, after verifying every writer and rollback source. |
| Visa gary-cms-media | 5 MiB | 650,000 bytes after completing or retiring oversize pending reservations. |
| Visa gary-visa-avatars | 5 MiB | 100,000 bytes after the browser rollout. The avatar endpoint should enforce the same cap at that point. |
| Jobs jobs-media | 8 MiB | 650,000 bytes after all supported upload clients use the policy. |
| Jobs jobs-vacancy-images | 4 MiB | Keep 4 MiB while the existing server JPEG/PNG fallback is permitted. Revisit after that encoder has an output cap. |

Keep current bucket visibility, policies and MIME allowlists. Apply separately approved limits through the Storage bucket settings or Storage API, using exact byte values. Supabase separates per-bucket limits from the project's global upload limit. [Storage upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

## Gary Home migration commands

Run from the Gary Home repository with Node 24 and the existing dependencies. The continuation command signs in with the existing Home Owner account and verifies access through Home's Owner-only rename history RPC. The PostgreSQL operator performs the private catalogue checks. The reference update runs as the verified Home Owner under the existing listing RLS policies. The SQL helpers are session-local.

### Connect and resume an existing staging run

1. Make `psql` available in your local Terminal. On macOS with Homebrew, use the standalone client if you do not already have `psql`.

   ```sh
   command -v psql
   # If needed, install the client and add it to this shell.
   brew install libpq
   export PATH="$(brew --prefix libpq)/bin:$PATH"
   psql --version
   ```

2. Reuse your approved Home libpq service if it connects over TCP to project `duyiihsmaqfgwezmsnjs`. Otherwise open that project's **Connect → Session pooler**. Copy the host, database and user into a new section of `~/.pg_service.conf`. Use the existing PostgreSQL operator login. Save the project's SSL CA from **Database → Settings → SSL Configuration** outside the repository and set its absolute path below. A direct TCP connection also works when your network can reach it. [Supabase psql and SSL setup](https://supabase.com/docs/guides/database/psql) · [PostgreSQL service file](https://www.postgresql.org/docs/current/libpq-pgservice.html)

   ```ini
   [gary-home-media]
   host=EXACT_HOST_FROM_HOME_CONNECT
   port=5432
   dbname=postgres
   user=EXACT_USER_FROM_HOME_CONNECT
   sslmode=verify-full
   sslrootcert=/absolute/path/to/home-prod-supabase.cer
   ```

3. In the same Terminal, check both connections and the existing audit. Set the service name to your approved section. Use `PGSERVICEFILE` if your service file is in a custom location. The command obtains the public Home key from Home's configuration endpoint. It asks for your existing Home Owner email and password with terminal echo disabled. `--prompt-db-password` also asks for the existing PostgreSQL password. The CLI stores it in a mode-0600 libpq passfile in a private system temporary directory and removes the file when it exits. Omit that flag when your approved service already uses a private passfile. Keep credentials out of command arguments and shell history.

   ```sh
   cd /Users/skycastle3/Desktop/gary_group/gary_home_website
   chmod 600 ~/.pg_service.conf
   export PGSERVICE=gary-home-media
   GARY_MEDIA_STAGING=work/property-media-audit-20261125.1T3KYQ/execution
   node scripts/resume-property-media.mjs --work "$GARY_MEDIA_STAGING" \
     --expected-count 509 --check-auth --prompt-db-password
   ```

4. After the connection check, run the continuation in the same Terminal. For an already approved run, use the command below directly to enter credentials once. The continuation rechecks staged checksums locally, re-audits current object identities and listing references, and starts with the staged pilot. It seals a write manifest for each batch using the reviewed current listing versions and a transfer budget that covers guarded retirement. It checkpoints each confirmed upload, reference switch, verification and retirement under `guarded-write/`. Each photo must finish before the next upload. The same command resumes completed stages using that checkpoint. Resolve any reported failure before restarting.

   ```sh
   node scripts/resume-property-media.mjs --work "$GARY_MEDIA_STAGING" \
     --expected-count 509 --apply --prompt-db-password
   ```

   Keep the complete staging directory so each checkpoint can read its original and optimized file. The final report is `guarded-write/completion.json`. The continuation checks confirmed retirement records, live bucket totals and a public gallery. The individual stage commands below also accept a publishable API key and an existing signed Owner access token from a local credential manager through `GARY_MEDIA_PUBLISHABLE_KEY` and `GARY_MEDIA_OWNER_TOKEN`.

### Audit and seal a batch

Prepare an inventory through the read-only SQL export. Run the export only when approved. It reads metadata and reference sightings from Home's existing media index.

```sh
umask 077
GARY_MEDIA_ROOT="$PWD/work/property-media"
GARY_MEDIA_INVENTORY="$GARY_MEDIA_ROOT/inventory.json"
GARY_MEDIA_WORK="$GARY_MEDIA_ROOT/pilot-01"
mkdir -p "$GARY_MEDIA_ROOT"
psql -X -w -qAt -v ON_ERROR_STOP=1 -c 'BEGIN READ ONLY' \
  -c "SET TIME ZONE 'UTC'" -f scripts/inventory-property-images.sql \
  -c 'COMMIT' > "$GARY_MEDIA_INVENTORY"
```

Preview a five-image batch, taking the largest eligible PNGs before JPEGs. The tool skips files below 500 KB and existing WebP or AVIF. It flags missing, shared and protected references and reports duplicate ETag hints. Supply repeated `--token` options to choose exact candidates from the audit output. A batch can contain up to 20 images.

```sh
node scripts/migrate-property-media.mjs audit --inventory "$GARY_MEDIA_INVENTORY" \
  --limit 5 --egress-bytes 100000000 --storage-bytes 2500000
```

After review, add explicit local approval to seal that selection and its budgets. Set `GARY_MEDIA_APPROVAL` to the printed `batchId`. It identifies the reviewed manifest.

```sh
node scripts/migrate-property-media.mjs audit --inventory "$GARY_MEDIA_INVENTORY" \
  --limit 5 --egress-bytes 100000000 --storage-bytes 2500000 \
  --work "$GARY_MEDIA_WORK" --apply
```

### Run each approved stage separately

Without `--apply`, each command reports local state and opens no remote connection. A remote transfer or mutation also requires `--approve` with the sealed batch ID. Repeated `--token` options narrow the selected items for any stage.

**Backup** downloads exact original bytes through the Storage API. It checks object identity before and after transfer and saves SHA-256, system metadata and user metadata under `backups/`. Keep an independent copy of the workspace for recovery.

```sh
node scripts/migrate-property-media.mjs backup --work "$GARY_MEDIA_WORK" \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

**Convert** works from those originals in the local workspace. It uses the frontend's quality settings and skips redundant sizes without upscaling. Untagged sources can become WebP. EXIF-bearing JPEGs can stay JPEG. It holds unsupported metadata and encodes that fail the 192 and 720 px pixel comparisons. Output and checkpoints are in `staged-v2/`.

```sh
node scripts/migrate-property-media.mjs convert --work "$GARY_MEDIA_WORK" --apply
node scripts/migrate-property-media.mjs report --work "$GARY_MEDIA_WORK"
```

**Upload** creates the reviewed output at a versioned listing key with the appropriate MIME, original user metadata, and frontend cache settings. The command verifies the uploaded bytes against the local SHA-256. Review quality and temporary storage capacity before approving it.

```sh
node scripts/migrate-property-media.mjs upload --work "$GARY_MEDIA_WORK" \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

**Migrate** previews and applies the switch using the existing media snapshot lock. It checks the listing version, object identities and known references. Gallery order, descriptions, alt text and the original filename maps are preserved. Legacy transform URLs become direct public URLs. Shared or unaccounted references require review.

```sh
node scripts/migrate-property-media.mjs migrate --work "$GARY_MEDIA_WORK" \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

**Verify** checks both object identities and references, then reads the new public URL and verifies its bytes. Review the pilot's public rendering and check external references, including exports and links from other apps, before approving retirement.

```sh
node scripts/migrate-property-media.mjs verify --work "$GARY_MEDIA_WORK" \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

**Rollback** restores the previous gallery fields during the observation window. It checks the latest reviewed listing version and exact media fields and rolls back multiple changes to one listing in reverse order. Retain both objects until the rollback window closes.

```sh
node scripts/migrate-property-media.mjs rollback --work "$GARY_MEDIA_WORK" \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

**Cleanup** requires separate approval after verification and the rollback window. Set `GARY_MEDIA_OBJECT_TOKEN` to one reviewed item token. The CLI rechecks the original and optimized object identities, confirms zero known original references, reserves retirement through the existing rename guard, and calls the Owner-only Storage removal route. It confirms the recorded removal and catalogue absence before marking the item complete.

```sh
node scripts/migrate-property-media.mjs cleanup --work "$GARY_MEDIA_WORK" \
  --token "$GARY_MEDIA_OBJECT_TOKEN" --retire-originals \
  --apply --approve "$GARY_MEDIA_APPROVAL"
```

Retirement is the rollback boundary. To recover afterward, use the separately verified original backup and an approved Storage upload to a fresh key. Restore the saved gallery fields with version checks and map the original reference to the recovered key. Keep the retirement guard and audit history. Retain originals that still serve external URLs.

### Resume and budget accounting

Rerun the same stage with the same workspace and approval after an interruption. The journal checks for a matching committed upload, reference switch or removal before sending another write. An unresolved listing conflict requires a fresh review. Exit code 2 indicates a blocked item. If a process left `.migration.lock`, verify the recorded PID has exited before removing that local lock.

Each payload or mutation attempt is reserved in the journal before transmission, with up to three attempts per operation and item. Egress reservations cover original reads, upload readback, public verification, and up to 8 MiB per retirement call for the existing server-side digest check. The storage budget reserves every attempted upload and is conservative after lost responses. Reported savings distinguish staged estimates from confirmed retirement. Both versions occupy Storage until cleanup. [Standard Storage uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) · [Storage egress measurement](https://supabase.com/docs/guides/storage/serving/bandwidth)

## Estimates from the supplied inventory

Target the 784 files at or above 500 KB. They currently use 1,017.69 MB. At 200–250 KB per replacement, this group uses 156.80–196.00 MB, saving 821.69–860.89 MB after separately approved retirement. The property bucket would reach 424.55–463.75 MB with everything else held constant. The 395 files at or above 1 MB are part of that group. Processing that subset alone models savings of 644.40–664.15 MB. These estimates assume all members qualify. Shared references, richer metadata and ineligible formats can reduce savings. Keeping both versions increases storage during the observation window. A full backup read of the 784 targets transfers about 1.02 GB plus verification traffic.

At the same traffic mix, 1,000 full-size deliveries of the target group at 200–250 KB would transfer about 200–250 MB, compared with about 1,298 MB at its current average. Use per-key requests, bytes and cache HIT/MISS from comparable windows. Next derivatives and browser cache hits affect how much of this savings appears in Supabase totals. [Storage egress measurement](https://supabase.com/docs/guides/storage/serving/bandwidth)

## Local compression measurements

The inputs below were generated from three checked-in Home property photos. They exercise oversized inputs without retrieving production assets. Byte counts include encoded metadata.

| Fixture | Input | Output | Smaller | 720 px pixel RMSE |
| --- | ---: | ---: | ---: | ---: |
| Living room PNG | 3,327,303 B | 201,902 B WebP | 93.9% | 3.55 |
| Apartment PNG | 3,049,149 B | 236,338 B WebP | 92.2% | 3.55 |
| Studio high-quality JPEG | 1,219,630 B | 235,028 B WebP | 80.7% | 4.08 |

The three outputs averaged 224 KB. The original 351,947-byte repository JPEG was skipped by the batch cutoff. Visual quality and production eligibility need the approved pilot.
