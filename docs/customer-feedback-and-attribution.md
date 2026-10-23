# Feedback and property assistance

The Feedback navigation link opens `/feedback`. The Team Activities link has been removed from the top navigation; supplied customer, feedback and team photos remain available in Our Activities.

## Customer feedback

- Guests and signed-in customers can submit a name, email, 1–5 rating, message and optional property reference.
- Every submission starts as **Awaiting moderation**. Publication requires the customer's separate optional permission and approval by a staff editor, manager, admin or owner.
- In **Studio → Customer feedback**, select a submission, optionally add a public Gary Home reply, choose a decision and save.
- Public reviews contain only the submitted name, rating, message, optional property, staff reply and publication date. Email and account IDs are not in the public table.
- Signed-in customers can review or withdraw their own feedback in **Customer Portal → Feedback & help** or at the bottom of `/feedback`. Withdrawal also deletes the published copy. Guest submissions do not attach to a future account by matching email; correction/deletion requests go through the team.
- No sample reviews or ratings are seeded. The public review list is empty until real submissions are approved.

## Assistance and commission attribution

Each property sidebar has a telephone Hotline button and a private assistance form. The customer records who helped, the channel, where, date, optional time (Hanoi), notes and their own contact information.

In **Studio → Assistance attribution**, an owner, admin or manager can verify the report, confirm the helper's name, optionally assign an active staff account and keep internal verification notes. The system stores the reviewer and review time. An external referrer can be recorded by name without a staff account. Editors and customers cannot assign credit or access internal verification notes. Customers see their own report and its verification status.

This is an attribution record for commission review. It does not calculate or transfer money. Verification and the actual payout process remain with the team.

## Rental requirements

The three-dot **Requirements / Nhu cầu riêng** button in Find Your Rental opens the existing animated filter panel. It includes bedrooms, bathrooms, property ID, keyword and amenities, including pets, gym, BBQ, outdoor shower and lake view. Amenities match **all** selected choices; a listing is never assumed to have an unrecorded facility. Common legacy spellings such as `Pet-friendly`, `BBQ` and `Lakeview` normalize to the same filters. Editors use the shared amenity list in the property editor.

## Backend

Migration: `supabase/migrations/20261023134954_feedback_and_assistance_reports.sql`.

This migration was applied to the connected Gary Home project `duyiihsmaqfgwezmsnjs`. Other existing projects should apply this migration once, after the earlier migrations. Fresh projects can use the regenerated `supabase/setup.sql`; do not run the complete setup over an existing database. No new environment variables are required.

All four new tables use RLS. Private submission identity comes from `auth.uid()`; insert grants exclude ownership, status and verification fields. Public-facing POST routes validate consent and payloads, verify optional bearer sessions, reject cross-origin requests and provide best-effort per-instance abuse limits. Public and customer reads use explicit field lists. Server writes have timeouts and are never automatically replayed after ambiguous failures.

Verification includes isolated Postgres role/consent/ownership checks, request validation and spoofing tests, existing idle recovery checks, bilingual component rendering, both production builds and TypeScript checks. No production customer submissions were created for testing.
