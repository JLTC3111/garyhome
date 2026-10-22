# Customer sign-in and staff accounts

The app separates customer identity from staff permissions. Customers use `/account` with Google, Apple, or a personal email and password. Email signup requires mailbox confirmation in the current project. OAuth creates a customer account when necessary; it never grants a team role. Staff use `/admin` with an explicitly assigned company account. The original confirmed owner account remains available for administration.

## Activate in the Gary Home project

Use project **`duyiihsmaqfgwezmsnjs`**, not the unrelated project visible through the current management connector.

1. Ensure the CMS and customer portal migrations are already applied. For an existing project, run **`supabase/migrations/20261022042327_customer_social_auth_staff_access.sql`** in its SQL Editor. Do not run the full setup file over an existing database. Fresh projects can use `supabase/setup.sql`, then `supabase/owner.sql` after creating and confirming the actual owner user.
2. The allowed staff email domains are **`@garyhome.com` and `@icue.vn`**. If the allowed company domains change, update the `public.staff_settings.email_domains` array as the database owner. Non-owner staff outside the configured domains lose Studio access immediately. Existing owner assignments are preserved, including the bootstrap owner's personal email.
3. Set the Auth Site URL to the actual production origin. Allow these exact redirect URLs for each deployed or local origin:

   - `/account` — email signup confirmation.
   - `/auth/callback` — Google and Apple return here.
   - `/auth/reset` — password recovery.
   - `/auth/invite` — invited staff set their own password.

   For the current preview, the origins may include `http://127.0.0.1:3000` and `http://localhost:3000`. Add only origins you actually use. Production redirects must use the production HTTPS origin.
4. Keep email/password signup and email confirmation enabled. Configure a production email sender/SMTP for customer confirmations, staff invitations, and password recovery. Keep the normal Supabase confirmation URL in the email templates; the browser SDK consumes the authenticated redirect. These browser flows use the SDK's implicit redirect handling rather than server cookie sessions.
5. For **new staff invitations only**, add `SUPABASE_SECRET_KEY` to the ignored `.env` file (and the production Worker's runtime secrets). Restart the local development server after changing it. This is a Supabase secret key, not the publishable key. The legacy server-only `SUPABASE_SERVICE_ROLE_KEY` is also supported. Never put either value in a `NEXT_PUBLIC_`/`VITE_` variable or share it in chat. Customer login and assigning an existing company account do not require the server secret. `/api/config` exposes only the project URL and publishable key.

Project links: [SQL Editor](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/sql/new), [Auth providers](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/providers), [redirect URLs](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/url-configuration).

## Google

Create a Web application OAuth client in the Google Cloud project for this business. Configure the consent screen for external customers, including personal Google accounts. Register the Supabase callback URI:

```text
https://duyiihsmaqfgwezmsnjs.supabase.co/auth/v1/callback
```

Enter the Google Client ID and Client Secret in Supabase's Google provider settings and enable the provider. Provider secrets belong in Supabase, not the app's public environment. The app checks the actual enabled status and enables its button when the provider is ready. Reload `/account` after changing provider settings.

Follow [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

## Apple

Use the business's Apple Developer account to configure an App ID with Sign in with Apple, a web Services ID, website domains, and the same Supabase HTTPS callback URI above. Set the Services ID as the first Client ID in Supabase's Apple provider configuration, supply the generated Apple client secret, and enable the provider.

Apple's web OAuth secret expires and must be rotated at least every six months. Keep the `.p8` signing key in the business's secure credential store. Apple may supply a private relay email and may omit the full name; customers can complete their details in My account.

Follow [Supabase's Apple setup guide](https://supabase.com/docs/guides/auth/social-login/auth-apple). Google and Apple were both disabled during the initial implementation check; no provider credentials were available to the agent.

## Manage staff in Studio

An owner or administrator opens **Studio → Team access**. Enter the full name, exact company email, and role:

| Role | Access |
| --- | --- |
| Owner | Studio, customer management, staff management, appoint/change administrators. Existing bootstrap owner preserved. |
| Administrator | Studio, customer management, create/assign/disable staff. Cannot edit owners, other admins, or their own access. |
| Staff | Properties, media, site content, neighbourhoods, and customer management. No staff management. |
| Customer | Own details, saved homes, enquiries, and viewings. No Studio access. |

For a new email, the server sends an Auth invitation; the recipient confirms the mailbox and chooses their own password at `/auth/invite`. Until mailbox confirmation, the assignment cannot access Studio. For an existing company Auth account, the role is assigned without sending another invitation. Its owner can use their existing password or the staff password-reset flow to set one. No account passwords are chosen or revealed to the administrator.

Disable access to revoke Studio permissions without deleting the person's Auth identity or customer records. Database policies check the current verified Auth email, an exact allowed company domain, and active membership on every protected operation. A valid old JWT, email-only signup, social login, or user-editable metadata cannot restore revoked privileges. Owner accounts and the acting administrator's own account are protected. Team listings use cursor pagination.

Auth invitations and database assignments are separate services. If delivery succeeds but permission assignment fails, the UI reports that partial outcome. The invited account has no new staff role; refresh the directory before retrying. Timed-out writes are never automatically replayed.

## Verify activation

Run the target project's Security Advisor after applying the migration. Then verify a real Google login, Apple login, confirmed personal email signup/login, staff invitation/password setup, and staff revocation in a browser. Confirm that customer accounts cannot open Studio or read another customer's records. Test Google/Apple cancellation and email links in the production domain as well as the preview.

Local tests cover the actual SDK public reads, Auth password identity binding, real Postgres policies in PGlite, API authorization, protected roles, invite partial failures, callback destinations, bilingual React forms, and recovery after inactivity. They do not replace provider-console configuration, real email delivery, or live end-to-end OAuth testing.
