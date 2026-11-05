# Listing editor

New listings select the signed-in staff member as their author. A linked profile is reused; if none exists, the first save creates a staff-linked profile using the staff display name and company contact fallback. Private login contact details are not copied. Selecting another profile or the company contact overrides the default, and editing an existing listing preserves its author.

The URL controls show complete HTTPS addresses on the configured public website. Listings use `/homes/<address>`, articles use `/tips-and-news/<address>`, and neighbourhood links use `/homes?district=<area>`. Existing routes remain unchanged. Profile identifiers are generated internally rather than requiring staff to enter a slug.

English and Vietnamese titles are displayed as entered, including features such as “PETS ALLOWED” and “LAKE VIEW”. A title is generated from property facts only when neither language has an authored title. The optional location and furnishings text fills the matching sections of the public property page.

Each listing can have one MP4 video. Files must be nonempty and strictly smaller than 50,000,000 bytes. Uploading another replaces the listing's selected video when saved; removing it clears the listing's video. Saving is disabled during uploads, and late uploads cannot attach to a different draft. The public video player uses native controls and does not autoplay.

The `listing_mp4_video` migration adds the optional video URL, a staff-upload storage bucket with a 49,999,999-byte maximum, and database validation of stored video type and size. Video URLs must point to this project's upload bucket.

Form errors explain the affected field and constraint in the selected site language. Native submission checks remain enabled. Global notifications and profile-photo notifications use the React Bits Swipe Row with swipe, close-button, and keyboard dismissal.

Session restoration, reconnection and page loading use the React Bits Lattice Loader. Recovery retains the open draft; offline and failed connections show reconnect controls instead of an ongoing loading animation. Reduced-motion preferences use a static indicator.
