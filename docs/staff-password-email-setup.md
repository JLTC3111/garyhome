# Staff password setup and Gary Home emails

## What changed

A staff invitation is expected to contain one action link. A valid link must open the Gary Home setup screen, verify the email and then display **New password** and **Confirm password**, with a minimum of 12 characters. Staff choose their own passwords; administrators never see them.

`/auth/callback` now supports older invitation redirects. The reported `error_code=otp_expired` means the old link is expired, invalid or already consumed; opening `/auth/invite` manually cannot restore its authority. Both pages now show a useful explanation and an email form to request a fresh password link. Use the newest email and discard older links. Existing invited users can use password recovery to confirm their mailbox and set their password; this does not create a new staff assignment.

Custom templates use a token hash in the URL fragment, which is not sent to the app server or in normal HTTP referrers. Gary Home removes it from the address bar and holds it in memory. Opening the page does not consume the link: the recipient presses **Continue to set password** before the app verifies it with Supabase. The verified account must match the authenticated session before the password form becomes available. There are no external redirect destinations or user-supplied confirmation URLs.

## Activate the custom messages in hosted Supabase

The connected Supabase tools can manage the database but cannot edit hosted Auth email templates. The files below are ready to paste into the dashboard. Updating the repository or its local `config.toml` does not apply these hosted settings.

1. Open project **`duyiihsmaqfgwezmsnjs` → Authentication → Email → Templates** (sometimes labelled **Email Templates**).
2. Select **Invite user**.
   - Subject: `Gary Home — Set your staff password / Đặt mật khẩu nhân viên`
   - Replace the message source with [supabase/templates/invite.html](../supabase/templates/invite.html) and save.
3. Select **Reset password**.
   - Subject: `Gary Home — Set or reset your password / Đặt lại mật khẩu`
   - Replace the message source with [supabase/templates/recovery.html](../supabase/templates/recovery.html) and save.
4. The templates include an English message, Vietnamese instructions, the recipient's account email, one password action button and clear instructions for an expired link. Keep the template variables intact. Disable your email provider's click tracking for authentication emails.
5. Deploy the matching app code before sending a new email. Previously delivered emails keep their old content and links.

For local Supabase, both templates are already selected in `supabase/config.toml`. Do not push the entire local configuration to a hosted project just to update these templates; it also contains local URL and other Auth settings.

## Correct the destinations

In **Authentication → URL Configuration**, set **Site URL** to the origin of the website being used, without an `/auth/...` path. For local testing this can be `http://127.0.0.1:3000`; in production use the actual deployed HTTPS origin.

Allow these paths under each origin where real email authentication is needed:

```text
/account
/auth/invite
/auth/reset
/auth/callback
```

The app sends invitations with `/auth/invite` as the requested redirect and recovery messages with `/auth/reset`. The custom template uses the requested redirect, falling back to Site URL for dashboard-generated invitations. The app routes recognized invitation and recovery fragments to the correct password screen, including when they initially land at the homepage.

## Verify one real invitation

1. Open **Studio → Team access**, create/assign the allowed email and open the newest invitation on the same local or production origin you configured.
2. The custom email opens a confirmation screen. Press **Continue to set password**; verify that no password form is offered before verification succeeds.
3. Enter and confirm a password, save it, then open Staff Studio.
4. Sign out and sign in with that email and the new password.
5. Check that an expired link offers a fresh email request and never changes the password. Test in English and Vietnamese.

Only email delivery and this real-mailbox check require a live recipient. Automated tests use mocked Auth boundaries and never send production email or change a production password. No database migration is needed for this change.

References: [Supabase email templates and email prefetching](https://supabase.com/docs/guides/auth/auth-email-templates), [verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp), [Auth recovery confirmation behavior](https://github.com/supabase/auth/blob/master/internal/api/verify.go).

## Adding an address that already exists

**Create / assign & send email** requests an invitation for a new Auth account. For an existing Auth account it saves the staff assignment, checks the actor and target again, then requests a fresh password-setup email to the actual assigned Auth address. It does not create a duplicate account. A recipient who failed to finish an earlier invitation can complete setup using this new recovery email.

Existing team rows expose **Send password link**, or **Send setup email** while email confirmation is pending. Only owners/admins can trigger these actions; protected owner/admin targets and inactive or mismatched assignments stay blocked. An unconfirmed recipient does not gain Studio access before verifying the new email link.

The result remains visible above Team access. Email request failures and unconfirmed requests are reported separately from a saved assignment, with actionable SMTP or sending-limit guidance. “Requested” means Auth accepted the request; it is not inbox delivery confirmation. Neither timeouts nor background refreshes replay email sends automatically. Use the row action to request a fresh link instead of removing and recreating the account.

This change uses [20261025033745_staff_password_setup_retries.sql](../supabase/migrations/20261025033745_staff_password_setup_retries.sql) to permit owner/admin setup-link requests for active pending staff. The existing role checks still require a confirmed actor, an eligible address and explicit membership.
