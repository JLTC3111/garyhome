# Feedback, navigation and guest favourites

The header has **Apartments → About Us → Feedback**. Feedback is the rightmost navigation button. About Us opens on desktop mouse hover; a pointer bridge covers the small dropdown gap. It closes when the pointer leaves its container or keyboard focus leaves it, and still supports click/tap, arrows and Escape. Desktop and mobile use one **Sign in / Login** link to the existing `/login` portal chooser. Mobile keeps this link and the language switcher inside the hamburger menu.

## Published feedback

Customers submit private feedback with separate permission to publish. Staff approve/publish it in Studio → Customer feedback. The existing `moderate_feedback` transaction creates the sanitized `feedback_public` copy. Homepage **Our activities → Feedback**, the full Activities page and `/feedback` all use that same public source. The homepage shows the six newest reviews. No duplicate entry or manual copy to homepage content is needed.

The public reader uses an anonymous, session-independent Supabase client, never a customer's auth lock or private feedback submissions. It listens for changes to `feedback_public`, refreshes on focus/reconnection and has a 30-second read fallback. Realtime and polling pause while hidden or offline and release listeners/timers on unmount. Moderation and withdrawal also notify other tabs in the same browser without transmitting review content. Declining or withdrawing feedback removes its public copy and refreshes the visible list. Names, ratings, original customer messages, public staff replies and linked public rental IDs may be shown; email, account IDs and private moderation fields are excluded.

`supabase/migrations/20261026064510_published_feedback_realtime.sql` adds only the public copy to the existing Supabase Realtime publication. Hosts without that publication keep the bounded polling/recovery fallback. No extra environment variable or provider account is needed.

## Portrait feedback photos

All approved images in the Feedback category share the feedback gallery, including images labelled Photograph or Screenshot in Studio. Its inline image keeps its natural dimensions, supporting 9:16, taller mobile screenshots and landscape photos. Thumbnails and the keyboard-accessible lightbox contain the entire image. Rental property galleries retain their existing cover/mosaic presentation. No source image is cropped or modified.

## Automatic guest-favourite sync

When a customer logs in, the app first loads their account's saved homes, then merges available rental IDs from `gary-saved` and the retired browser cart. It preserves existing account favourites and uses the database's `(user_id, property_id)` key with duplicate-safe inserts. Confirmed transfers are removed from the guest cache, so another account on the device does not automatically inherit them.

A pending transfer is claimed by the account that started it. Switching accounts or an uncertain response keeps that claim and the guest cache with the original account. Cache cleanup happens only after a confirmed write and a matching current session. Each authenticated generation starts at most one automatic attempt; auth recovery and language changes do not loop writes. The account's **Sync browser favourites** control remains as an explicit retry after a failed connection. Unavailable/unpublished rentals are not inserted. Current imports are bounded to 100 homes per attempt.

Tests cover live approval/removal, public-only reads, hidden/offline recovery, portrait/landscape gallery navigation, hover/touch menus, login routing, duplicate-free favourite merging, failed writes and account changes.
