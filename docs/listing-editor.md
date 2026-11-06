# Listing editor

New listings select the signed-in staff member as their author. A linked profile is reused; if none exists, the first save creates a staff-linked profile using the staff display name and company contact fallback. Private login contact details are not copied. Selecting another profile or the company contact overrides the default, and editing an existing listing preserves its author.

Listing links are generated automatically from the final English title, with a Vietnamese-title fallback. The editor shows a read-only full HTTPS preview; staff do not type a URL. Titles are converted to lowercase URL-safe words, Vietnamese accents are folded, and a numeric suffix resolves duplicate addresses. Unpublished drafts follow title changes until first publication. Previously published and archived listings retain their saved links when titles change. Listings use `/homes/<address>`. Article and neighbourhood editors retain their separate full-URL controls under `/tips-and-news/<address>` and `/homes?district=<area>`. Profile identifiers are generated internally.

English and Vietnamese titles are displayed as entered, including features such as “PETS ALLOWED” and “LAKE VIEW”. A title is generated from property facts only when neither language has an authored title. The optional location and furnishings text fills the matching sections of the public property page.

Each listing can have one MP4 video. Files must be nonempty and strictly smaller than 50,000,000 bytes. Uploading another replaces the listing's selected video when saved; removing it clears the listing's video. Saving is disabled during uploads, and late uploads cannot attach to a different draft. The public video player uses native controls and does not autoplay.

The `listing_mp4_video` migration adds the optional video URL, a staff-upload storage bucket with a 49,999,999-byte maximum, and database validation of stored video type and size. Video URLs must point to this project's upload bucket.

Form errors explain the affected field and constraint in the selected site language. Native submission checks remain enabled. Global notifications and profile-photo notifications use the React Bits Swipe Row with swipe, close-button, and keyboard dismissal.

Session restoration, reconnection and page loading use the React Bits Lattice Loader. Recovery retains the open draft; offline and failed connections show reconnect controls instead of an ongoing loading animation. Reduced-motion preferences use a static indicator.

The listing editor opens in a wider panel with a flowing left border. Drag the left handle or use its left/right arrow keys to resize; Home/End choose the narrowest/widest width. A full-screen toggle preserves the active draft and uploads. Phones use the full viewport. The decorative border and upload counters respect reduced-motion preferences.

Photos and videos upload in resumable chunks, with real percentage progress, an elapsed-time React Bits Counter, cancellation and retry. There is no total 120-second deadline. After 15 seconds without progress, a separate inactivity countdown appears; 120 seconds without any progress stops the transfer and offers retry. Successfully added photos stay in the draft.
