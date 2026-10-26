# Landlord introductions

Public intake: **About Us → Landlords**, `/landlords`. A visitor can send their contacts, address, area, property type, bedroom/bathroom counts, optional size/asking rent and a message. Asking rent uses USD to match the existing property editor. Optional attachments support up to six JPG/PNG/WebP/AVIF images or PDF plans, at most 5 MiB each and 25 MiB in total. The form requires consent, retains its draft after failures and does not replay mutations automatically. Completed file uploads are reused on an explicit retry. Language switches preserve the form; switching accounts clears private upload state.

## Database and environment

Existing project `duyiihsmaqfgwezmsnjs` needs **only** `supabase/migrations/20261026042448_landlord_introductions_and_private_uploads.sql`. The new-project `setup.sql` includes it; never rerun setup over a live project. This feature reuses server-only `SUPABASE_SECRET_KEY` (or legacy service-role key), the configured Supabase URL/publishable key and the existing auth session. No extra environment variable is required. The server key must never enter a browser bundle.

The `landlord-files` bucket is private. `/api/landlords` first validates a manifest and reserves a durable IP-HMAC quota (five starts/day, with a conservative byte allowance). It issues random per-file signed upload capabilities and an account-bound HMAC permit, both valid for two hours. Files go directly to Supabase so Vercel's function request-body limit does not truncate uploads. The server checks actual stored size/MIME before an atomic, idempotent finalisation RPC creates the introduction, private attachment records, a linked landlord enquiry and Studio activity. The browser cannot insert/read these tables as a customer, assign staff, forge review fields or publish a listing. Guests can submit; signed-in senders can see their linked enquiry in their customer portal. No email is sent automatically.

## Staff workflow

Open **Studio → Customer care → Introduced properties**.

- Active staff can read the private queue, owner contacts and attachments, add internal notes and set New / Reviewing / Needs details / Ready / Declined / Archived status.
- Owner, admin and manager can assign an active team member and create a listing draft from a reviewed introduction. Confirm the district first. Repeating draft creation opens the same draft.
- Drafts contain structured property facts only, start unpublished with no photos, and open in the existing property editor. Private owner messages, contacts and uploads are never automatically copied into public descriptions or public media. Review the material and add only approved photos before publishing.
- Owner/admin can explicitly delete an introduction and its linked enquiry. A previously created listing is kept. Activity logs store record IDs and workflow changes, not owner messages or email addresses.
- Private download links expire in two minutes. Use **Refresh attachments** to renew them. RLS rechecks active staff access before signing each link. An already issued link remains usable until it expires.

The queue loads 50 records at a time, newest first; status filters are server-side and search applies to loaded records. Reading does not trigger the auth recovery/write cycle. Pending reviews survive language changes. Mutations revalidate current role permissions and require an explicit retry if their outcome is uncertain.

## Upload maintenance

Failed/abandoned attempts can leave private unlinked files. Finalisation attempts a bounded cleanup of unlinked files older than 24 hours. Owner/admin also have **Clean unused uploads** in the queue; one run removes up to 50 eligible files. Run it periodically on a quiet site. Linked introduction files and listing photos are excluded. Storage objects are deleted through the Storage API, never with SQL. The private quota table prunes windows older than seven days when another upload session is reserved.

For a deletion request, delete the introduction and linked enquiry in Studio, then clean its newly unlinked attachments after they pass the 24-hour threshold. Keep any explicitly retained listing under separate review. Contact details, retention and correction/deletion instructions are covered on `/privacy`.

## Verification

`tests/landlord-database.test.mjs` runs the real full schema under PGlite roles: anonymous/customer isolation, quotas, atomic retries, fresh staff permissions, assignment, draft conversion, deletion and orphan cleanup. `tests/landlord-api.test.mjs` covers HMAC permits, account binding, actual file metadata, validation and abuse limits. React recovery tests cover interrupted file retries, language persistence and queue behaviour. Both Vinext and Next/Vercel builds must pass.
