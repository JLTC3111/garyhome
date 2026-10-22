# Customer sign-in and staff accounts

The app separates customer identity from staff permissions. Customers use `/account` with Google, Facebook, or a personal email and password. Apple is removed from the customer login and signup screens, including when Supabase reports that provider as enabled. Email signup requires mailbox confirmation in the current project. OAuth creates a customer account when necessary; it never grants a team role. Staff use `/admin` with an explicitly assigned company account. The original confirmed owner account remains available for administration.

## Activate in the Gary Home project

Use project **`duyiihsmaqfgwezmsnjs`**, not the unrelated project visible through the current management connector.

1. Ensure the CMS and customer portal migrations are already applied. For an existing project, run **`supabase/migrations/20261022042327_customer_social_auth_staff_access.sql`** in its SQL Editor. Do not run the full setup file over an existing database. Fresh projects can use `supabase/setup.sql`, then `supabase/owner.sql` after creating and confirming the actual owner user.
2. The allowed staff email domains are **`@garyhome.com` and `@icue.vn`**. If the allowed company domains change, update the `public.staff_settings.email_domains` array as the database owner. Non-owner staff outside the configured domains lose Studio access immediately. Existing owner assignments are preserved, including the bootstrap owner's personal email.
3. Set the Auth Site URL to the actual production origin. Allow these exact redirect URLs for each deployed or local origin:

   - `/account` — email signup confirmation.
   - `/auth/callback` — Google and Facebook return here.
   - `/auth/reset` — password recovery.
   - `/auth/invite` — invited staff set their own password.

   For the current preview, the origins may include `http://127.0.0.1:3000` and `http://localhost:3000`. Add only origins you actually use. Production redirects must use the production HTTPS origin.
4. Keep email/password signup and email confirmation enabled. Configure a production email sender/SMTP for customer confirmations, staff invitations, and password recovery. Keep the normal Supabase confirmation URL in the email templates; the browser SDK consumes the authenticated redirect. These browser flows use the SDK's implicit redirect handling rather than server cookie sessions.
5. For **new staff invitations only**, add `SUPABASE_SECRET_KEY` to the ignored `.env` file (and the production Worker's runtime secrets). Restart the local development server after changing it. This is a Supabase secret key, not the publishable key. The legacy server-only `SUPABASE_SERVICE_ROLE_KEY` is also supported. Never put either value in a `NEXT_PUBLIC_`/`VITE_` variable or share it in chat. Customer login and assigning an existing company account do not require the server secret. `/api/config` exposes only the project URL and publishable key.

Project links: [SQL Editor](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/sql/new), [Auth providers](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/providers), [redirect URLs](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/url-configuration).

## Google: step-by-step initialization

A regular Google account and a free Google Cloud project are sufficient for this login integration. Google does not require a paid developer membership. The website uses the hosted Supabase project even when its frontend runs on your computer; use the hosted callback below throughout this setup.

1. Open [Google Cloud Console](https://console.cloud.google.com/), use the project selector, and select **New Project** if needed. Name the project **Gary Home** and select it after creation. Use an account the business will retain access to.
2. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) in that project. Select **Get started** if prompted. Set the app name to **Gary Home**, choose a monitored support email, set the audience to **External** so personal Google accounts can sign in, and provide the developer contact email. Complete Google's setup form.
3. Under **Google Auth Platform → Data Access**, select **Add or remove scopes**. Include only these basic identity scopes, then save:

   ```text
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   ```

   No Gmail, Drive, Calendar, or other data permissions are needed for customer login.
4. Under **Audience**, add the Google account you will use for initial testing under **Test users** if that section is available. Keep the audience **External**. Before opening sign-in to all customers, use **Publish app** / **In production** and complete any verification Google requests. Publishing status and brand verification are separate; publishing does not automatically verify the displayed name or logo.
5. Under **Clients**, choose **Create client** and select **Web application**. Name it **Gary Home Web**. Set these fields:

   | Field | Value |
   | --- | --- |
   | Authorized JavaScript origins | `http://127.0.0.1:3000` and `http://localhost:3000`, as separate entries if you use both |
   | Authorized redirect URIs | `https://duyiihsmaqfgwezmsnjs.supabase.co/auth/v1/callback` |

   Add the actual production HTTPS origin when the site is deployed. An origin has no path; the Google redirect URI must contain the exact Supabase callback path. This web client is for human customer sign-in, not an AI agent workflow.
6. Click **Create**. Copy the **Client ID** and the full **Client Secret** immediately into a secure credential store. Google only displays the full secret when it is created. If it is lost, create a replacement secret rather than using the masked value. Keep the downloaded credential JSON out of the repository and chat.
7. Open the [Gary Home Supabase Auth providers](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/providers), select **Google**, turn **Enable Sign in with Google** on, and enter that web Client ID and Client Secret. Save. Keep nonce validation enabled. No Google credential needs to be added to the app's `.env` file.
8. Open [Supabase URL Configuration](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/url-configuration). Set **Site URL** to the origin you currently use, such as `http://127.0.0.1:3000` for this preview. Add these exact **Redirect URLs** if you use both local origins:

   ```text
   http://127.0.0.1:3000/auth/callback
   http://localhost:3000/auth/callback
   ```

   Keep the existing `/account`, `/auth/reset`, and `/auth/invite` redirects. At deployment, set Site URL to the actual production HTTPS origin and add that origin's `/auth/callback` URL.
9. Reload [customer login](http://127.0.0.1:3000/account). **Continue with Google** becomes available after the app reads the enabled provider. Complete Google sign-in and confirm that you return to **My account**. Verify the user under **Supabase → Authentication → Users**. Also check cancellation and returning to the sign-in page. Google authentication does not grant Studio access.

The two callback URLs serve different steps: Google returns to the hosted Supabase `/auth/v1/callback`, then Supabase returns to the website's `/auth/callback`. A `redirect_uri_mismatch` from Google means the former does not exactly match the OAuth client's redirect list. Returning to the wrong website origin means the Supabase Site URL or redirect allow list needs checking. A disabled Google button means provider availability could not be confirmed; email remains available.

References: [Google Auth Platform setup](https://support.google.com/cloud/answer/15544987), [OAuth client creation and secret handling](https://support.google.com/cloud/answer/15549257), [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Facebook: step-by-step initialization

1. Open [Meta for Developers](https://developers.facebook.com/apps/), create a **Gary Home** app, and select the **Facebook Login / Authentication and Account Creation** use case for customer sign-in.
2. Under **Facebook Login → Settings**, add this exact **Valid OAuth Redirect URI** and save:

   ```text
   https://duyiihsmaqfgwezmsnjs.supabase.co/auth/v1/callback
   ```

3. In the authentication use case, enable **public_profile** and **email**. Supabase needs the customer's confirmed Facebook email; the app requests `email` explicitly.
4. Copy **Settings → Basic → App ID / App Secret** into [Supabase Auth providers](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/providers) → **Facebook**, enable it, and save. Keep the secret out of chat, GitHub, and frontend `.env` variables.
5. Reuse the website `/auth/callback` allow list from Google step 8. No new SQL or app environment variables are required.
6. In Development mode, test with an accepted app administrator/developer/tester. Before public use, configure the actual HTTPS domain, public privacy URL (`/privacy`), and data-deletion instructions URL (`/privacy#data-deletion`), complete Meta's required review/verification, and switch to **Live**.
7. Reload `/account`, test **Continue with Facebook**, cancellation, and returning to **My account**. Email remains available if Facebook cannot return an email.

Reference: [Supabase Facebook setup](https://supabase.com/docs/guides/auth/social-login/auth-facebook). Google and Facebook availability are checked separately; Apple remains absent.

## Apple: disabled for this release

Apple sign-in is removed from the login and signup interface at the owner's request. The customer UI initiates only Google or Facebook OAuth, even if an Apple provider flag is enabled in Supabase. Keep the Apple provider disabled in Supabase. Enabling Apple later requires restoring the UI as well as completing Apple's developer account and provider configuration.

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

Run the target project's Security Advisor after applying the migration. Then verify real Google and Facebook logins, confirmed personal email signup/login, staff invitation/password setup, and staff revocation in a browser. Confirm that customer accounts cannot open Studio or read another customer's records. Test Google/Facebook cancellation and email links in the production domain as well as the preview. Confirm that Apple is absent from both customer login and signup screens in English and Vietnamese.

Local tests cover the actual SDK public reads, Auth password identity binding, real Postgres policies in PGlite, API authorization, protected roles, invite partial failures, callback destinations, bilingual React forms, and recovery after inactivity. They do not replace provider-console configuration, real email delivery, or live end-to-end OAuth testing.
