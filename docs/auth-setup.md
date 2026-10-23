# Customer email sign-in and staff accounts

Customers register and sign in with a personal email and password at `/account`. Email signup requires mailbox confirmation. Staff use `/admin` with a company account explicitly assigned by an owner or administrator. Registering with a company address does not grant Studio access. The existing confirmed owner account remains available for administration.

`/login` is a portal chooser. The public header and footer label customer and staff access separately. Each login page has a portal switcher and a link to the other login; switching portals does not change the current session or grant staff access. Password recovery returns confirmed staff to Studio and customers to their account.

## Configure the Gary Home project

Use project **`duyiihsmaqfgwezmsnjs`**. Confirm the project ID before editing its configuration.

1. Ensure the CMS and customer portal migrations are applied. For an existing project, apply the existing [staff access migration](../supabase/migrations/20261022042327_customer_social_auth_staff_access.sql) after the earlier migrations. Its applied filename is retained; its SQL defines staff domains, membership and role management. Fresh projects can use `supabase/setup.sql`, then `supabase/owner.sql` after creating and confirming the owner user. Do not run the full setup file over an existing database.
2. In [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/providers), enable **Email**, email/password signup and email confirmation. Keep other sign-in methods disabled. Hosted settings are managed in the dashboard; changing the repository's local configuration does not update the hosted project.
3. Configure production email delivery/SMTP for confirmations, password recovery and staff invitations. Keep the normal Supabase confirmation URL in the email templates. The browser SDK consumes the authenticated email redirect.
4. In [URL Configuration](https://supabase.com/dashboard/project/duyiihsmaqfgwezmsnjs/auth/url-configuration), set **Site URL** to the website origin currently in use. The local preview uses `http://127.0.0.1:3000`; production uses the actual deployed HTTPS origin.
5. Add these exact local **Redirect URLs** for the origins you use:

   ```text
   http://127.0.0.1:3000/account
   http://127.0.0.1:3000/auth/reset
   http://127.0.0.1:3000/auth/invite
   http://localhost:3000/account
   http://localhost:3000/auth/reset
   http://localhost:3000/auth/invite
   ```

   At deployment, add the same three paths under the actual production HTTPS origin. The routes handle signup confirmation, password recovery and staff password setup respectively. Remove obsolete application redirect entries from the hosted allow list.
6. Set the app's existing `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the ignored `.env` file and the production runtime. For new staff invitations, also set the server-only `SUPABASE_SECRET_KEY`. The legacy `SUPABASE_SERVICE_ROLE_KEY` is supported as a server-only fallback. Never prefix a secret with `NEXT_PUBLIC_` or `VITE_`, commit it, or share it in chat. Restart the development server after environment changes.

Hosting audience and platform access controls are separate from these application accounts.

## Customer accounts

- Open `/account` and choose **Create an account**.
- Enter a name, personal email and password of at least 12 characters. Re-enter the same password in **Confirm password** and agree to the privacy policy.
- Follow the mailbox confirmation link, then sign in with email and password.
- Use **Forgot password?** to request a reset link. Complete password recovery at `/auth/reset` using the link from the email.
- Customers can save homes, manage their details, see their enquiries and viewing requests, and read team updates. Customer registration creates no staff membership.

Auth sessions stay in the browser and use the SDK's automatic refresh. Email-link handling remains enabled for confirmation, recovery and invitation flows. Password setup is bound to the email link's intended account; changing accounts cannot redirect that password write to another user.

## Company staff and owner access

Allowed company email domains are **`@garyhome.com` and `@icue.vn`**. The existing bootstrap owner is preserved. If company domains change, update `public.staff_settings.email_domains` as the database owner and verify staff access afterwards.

An owner or administrator opens **Studio → Team access** and enters the staff member's full name, exact company email and role.

| Role | Access |
| --- | --- |
| Owner | Studio, customers and staff management; can appoint administrators. |
| Administrator | Studio, customers, staff invitations and assignments; cannot edit owners, other administrators or their own access. |
| Manager | Properties, customers and site content, plus public card ordering. No staff access management. |
| Staff | Properties, media, site content, neighbourhoods and customers. No staff management or public card ordering. |
| Customer | Their own details, saved homes, enquiries and viewings. No Studio access. |

For a new email, the server sends an Auth invitation. The recipient confirms their company mailbox and chooses a password at `/auth/invite`. The administrator never chooses or sees that password. Confirmation is required before the assignment can access Studio.

For an existing company Auth account, the role is assigned without another invitation. The account owner uses their existing password or the staff password-reset flow. Assigning an existing account does not require the server invitation secret.

Use **Disable access** to revoke an ordinary staff assignment without deleting their Auth identity or customer data. Database policies check the current confirmed email, exact allowed domain and active membership. Authorization uses server-managed membership; user-editable profile metadata cannot grant a staff role. Owners and the acting administrator's own account are protected.

Auth invitations and permission assignment are separate operations. If delivery succeeds but assignment fails, the UI reports the partial result. Refresh the directory before retrying. Timed-out writes are never automatically replayed.

## Verify the setup

- [ ] Register with a personal email, follow the confirmation email and sign in.
- [ ] Confirm registration does not grant Studio access or another customer's data.
- [ ] Sign out and sign in again; reload the account page.
- [ ] Request a password reset and complete it from the email link.
- [ ] Invite an eligible company address, confirm it and set a staff password.
- [ ] Assign an existing company account and verify its role permissions.
- [ ] Disable an ordinary staff assignment and confirm Studio access is revoked.
- [ ] Confirm the existing owner can still administer the site.
- [ ] Check English/Vietnamese forms and recovery after inactivity.
- [ ] Repeat confirmation, reset and invitation links on the production domain.

Run the target project's Security Advisor when applying database migrations. Local tests cover password identity binding, Postgres policies, API authorization, staff roles, invitation failures, bilingual forms and recovery after inactivity. They do not replace real email delivery and browser verification.

## Diagnose an unavailable customer portal

If the account shows “The customer portal is not available yet,” run the read-only [customer portal diagnostic](../supabase/diagnostics/customer-portal.sql) in the target project's SQL Editor. It returns a single row with missing tables, missing columns and the staff function checks. Empty `missing_tables` and `missing_columns` arrays mean those schema items exist; both function flags should be `true`. This diagnostic reads schema metadata only.

The customer schema is defined by [the customer portal migration](../supabase/migrations/20261021201948_customer_portal.sql). Apply it only when its four new tables and enquiry columns are absent. If only some items are missing, inspect the result before preparing a targeted repair: the migration is transactional but is not designed to be rerun on an already-created schema. Do not rerun `setup.sql` on an existing project.

References: [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
