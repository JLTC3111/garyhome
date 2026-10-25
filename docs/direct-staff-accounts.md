# Direct staff accounts, profile photos and activity

This is the current staff workflow. It supersedes invitation-first staff onboarding in earlier notes. Customer registration still requires email confirmation; the global Supabase confirmation setting is unchanged.

## Role hierarchy

| Signed-in role | Can create or assign | Can change or disable | Can delete access |
| --- | --- | --- | --- |
| Owner | Administrator, Manager, Staff | Lower roles | Lower roles |
| Administrator | Manager, Staff | Lower roles | Lower roles |
| Manager | Staff | Staff | None |
| Staff | None | None | None |

Nobody can create a peer or a higher role. In particular, the website does not create another Owner. Own-role changes are protected. Database functions and server routes enforce the hierarchy independently of the dropdown. The directory shows the current account and lower roles; the full matrix is explained in the right-hand panel of Team access. Historical SQL owner bootstrap remains the way to establish the initial owner.

## Create a confirmed account

Open **Studio → Team access → Create new account**. Enter the name, eligible company or Gmail address, assigned role, temporary password and matching confirmation. Passwords require at least 12 characters. The server uses Supabase Auth Admin `createUser` with `email_confirm: true`, then assigns the role through a fresh database permission check. There is no invitation email step.

Share the temporary password privately with the staff member. Passwords are not put in user metadata, the activity log or API responses. On first login, a reminder offers **Change password**. The bottom-left profile button opens the same profile form. **Save changes** saves a supplied password and closes the dialog; leave both password fields blank for a photo-only save. Photo updates show an in-dialog success toast. A successful password change clears the reminder; the log records that the reminder was cleared, rather than claiming to independently verify a password change.

Direct creation requires `SUPABASE_SECRET_KEY` (or the existing service-role fallback) in the server environment. It must be configured in Vercel separately from the ignored local `.env`; it must never be exposed through a public environment variable. Team access displays whether the server has creation configuration. Hosted Auth creation and inbox delivery are not exercised by local automated tests.

The Auth account and database assignment are separate operations. If the account is created but the creator loses permission before assignment, the server reports a partial result. Refresh and choose **Assign existing login** to finish an authorized assignment. The app does not automatically replay writes or delete the new Auth account.

## Assign an existing login

Choose **Assign existing login** for an email that already exists in Supabase. It confirms the email and assigns a permitted lower role while preserving the person's current password and customer history. The mode does not overwrite an existing customer's credentials. Password inputs are shown only for new accounts. Existing staff can change their password in their profile; the directory's optional **Send password link** remains available for recovery.

## Existing staff who cannot sign in

There is no separate temporary or first-time login page. All staff sign in at `/admin`. A new account uses the temporary password entered during creation; assigning an existing account keeps its current password.

For an existing staff member, open **Studio → Team access → Your team → Set temporary password**. Enter a new password and matching confirmation, then choose **Replace password**. This explicit action changes that staff account’s Auth password and confirms its email, without changing its role or customer history. Give the password to the staff member privately. No email link is sent. They sign in through the regular Staff portal and see the password-change reminder.

Only an active, assigned account below the creator’s level is eligible. You cannot reset your own password here or reset a peer/higher role; use the bottom-left profile for your own password. Disabled access must be restored first. The server verifies the current manager and target against the database immediately before the Auth update, and only reports success when Auth returns the expected user, email and email-confirmation state. Failed or uncertain writes are not automatically replayed.

Passwords never enter the database RPCs, notification records, metadata or API responses. The activity log records reset requests and failures, while Supabase Auth records the actual user update. The reminder is re-enabled when a reset is requested, including after an uncertain result, so it remains advisory.

The staff login form now normalizes surrounding email whitespace and letter case, preserves password characters exactly, and explains in English/Vietnamese why reassigned accounts still need their existing password.

## Staff photos

Use the photo control at the bottom-left of Studio. JPG, PNG, WebP and AVIF uploads are limited to 2 MB and stored in `staff-avatars` under the authenticated user's folder. Storage policies and profile policies prevent staff from uploading to, or modifying, another person's profile. Current images cannot be deleted through the client while referenced.

The avatar follows the account in Studio, the team directory, notification actor thumbnails and explicitly linked public listing profiles. Customer header controls and the customer account sidebar use customer identity rather than a staff portrait. Realtime events update open clients and normal session recovery refreshes the own profile.

In **Authors & activities → Listing authors**, select **Linked staff photo** to connect an approved public listing profile to a staff account. Subsequent profile-photo changes update every linked author portrait. Separate approved portraits remain supported. Public portrait redirects use an anonymous client and return only portraits linked to a published profile of an active verified member; the lookup is not cached. The storage bucket is public because these images are intended for visible profiles. Names, email addresses and role-management data are not added to the public portrait endpoint.

## Persistent notifications

The bell opens **Activity & notifications** with older-page loading and **Mark all read**. It records team creation, assignment, role changes, disable/restore/delete actions, details changes, profile-photo updates and password-reminder changes. Optional password-email requests and failures are logged. Enquiries, feedback and commission-assistance submissions/status changes also create entries.

Read markers are private to the account. Owners see team history; administrators/managers see their own activity and lower-level account activity. Staff see their own account events plus the enquiry/feedback events already permitted in Studio. Commission events require the existing manager-or-higher permission. Clients cannot insert or delete log entries directly. Logs contain roles, names and record IDs, not passwords, email addresses, enquiry messages or review text.

History starts when the migration is applied; previous actions are not fabricated. Failed Auth operations remain in Supabase's Auth logs, and partial account creation is reported to the initiating administrator. Realtime subscriptions are released when the account or role changes. Reads are bounded and do not trigger a session-recovery reload loop.

## Database and site changes

Applied to project `duyiihsmaqfgwezmsnjs` on 25 October 2026. The existing two staff assignments were preserved, and earlier activity was not backfilled. All three new tables have RLS enabled and both live-update tables are in the Realtime publication. Database advisor checks reported no new security or policy warnings. The follow-up [staff activity deletion migration](../supabase/migrations/20261025064523_staff_activity_account_deletion.sql) is also applied: Auth-account deletion preserves name/role snapshots without leaving foreign-key references to removed users. The website’s Delete access action continues to preserve the Auth/customer account.

For another existing project, apply [20261025055215_direct_staff_accounts_profiles_and_notifications.sql](../supabase/migrations/20261025055215_direct_staff_accounts_profiles_and_notifications.sql) once after the previous migrations. Fresh `setup.sql` includes it. It adds RLS-protected profile, notification and read-state tables, the avatar bucket, author links, strict hierarchy functions and activity triggers. Realtime publication updates are conditional on the host having `supabase_realtime` configured. Apply the follow-up activity deletion migration afterwards; fresh `setup.sql` includes both.

The homepage links to `https://garyvisaservice.vercel.app/` in a new tab. Enquiries and customer feedback use distinct sidebar icons. Feedback and commission headings/sidebar labels have additional left spacing. All new account guidance, controls and notifications support English and Vietnamese.

Applied to project `duyiihsmaqfgwezmsnjs` on 25 October 2026. For another project, the explicit temporary-password controls require [20261025080124_staff_temporary_password_controls.sql](../supabase/migrations/20261025080124_staff_temporary_password_controls.sql) after the migrations above; fresh `setup.sql` includes it.


## Re-adding someone after deleting staff access

**Delete access** removes only the team assignment. It preserves the underlying Supabase Auth login and customer history. Creating another login for the same email is therefore a conflict, not a reason to delete the Auth user.

The form now keeps action errors separate from directory-loading errors, so a background refresh cannot erase an unsuccessful creation message. For an existing email it offers **Assign and keep existing password** or **Assign and set temporary password**. The second option retains the entered password locally and shows an explicit replacement choice before the final submit. Existing credentials are never silently ignored or replaced.

When replacement is selected, the server confirms the Auth email, assigns a permitted lower role, rechecks the target through the guarded temporary-password helper and sets the supplied password. If assignment succeeds but the password update cannot be confirmed, the response reports that partial outcome and loads the directory; it never reports password success. Password fields have a labelled visibility toggle, stay out of the parent draft and are masked again after clearing or changing setup mode.

A live Supabase Auth check on 25 October 2026 created a disposable confirmed account, verified email/password sign-in, deleted that account, and confirmed that no disposable accounts remained. No real team member's credentials were changed by that check. HTTP transport was used because the local Node fetch transport could not reach the service. The role and partial-failure boundaries are tested separately in the API/database suites.
